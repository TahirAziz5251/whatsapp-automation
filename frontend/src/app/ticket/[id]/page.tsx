"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { clinicApi, DEFAULT_TENANT_ID } from "@/lib/api";
import { useClinicSSE } from "@/lib/sse";
import { 
  Clock, 
  User, 
  MapPin, 
  AlertTriangle, 
  CheckCircle2, 
  Activity, 
  RefreshCw, 
  ArrowRight,
  ShieldCheck,
  Stethoscope,
  Volume2
} from "lucide-react";

interface TicketData {
  ticket_number: string;
  appointment_id: string;
  patient_name: string;
  status: string;
  appointment_date: string;
  appointment_time: string;
  doctor_name: string;
  doctor_specialty: string;
  room_number: string;
  queue_status: string;
  current_serving_token: string;
  people_ahead: number;
  estimated_wait_minutes: number;
  delay_minutes: number;
  last_updated: string;
}

export default function PatientTicketPage() {
  const params = useParams();
  const ticketId = params?.id as string;

  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string>("");

  const loadTicket = useCallback(async () => {
    if (!ticketId) return;
    try {
      setError(null);
      const data = await clinicApi.getPatientTicket(ticketId, DEFAULT_TENANT_ID);
      setTicket({
        ticket_number: data.queue_token || data.ticket_number || data.appointment_number,
        appointment_id: data.appointment_id || ticketId,
        patient_name: data.patient_name || "Patient",
        status: data.status || "BOOKED",
        appointment_date: data.appointment_date || "",
        appointment_time: data.slot_time || data.appointment_time || "Walk-In",
        doctor_name: data.doctor_name || "Doctor",
        doctor_specialty: data.specialty || data.doctor_specialty || "OPD",
        room_number: data.room_number || "",
        queue_status: data.queue_status || "WAITING",
        current_serving_token: data.current_serving_token || "None",
        people_ahead: data.tokens_ahead !== undefined ? data.tokens_ahead : (data.people_ahead || 0),
        estimated_wait_minutes: data.estimated_wait_minutes || 0,
        delay_minutes: data.delay_minutes || 0,
        last_updated: new Date().toLocaleTimeString(),
      });
      setLastRefreshed(new Date().toLocaleTimeString());
    } catch (err: any) {
      console.error("Failed to load patient ticket:", err);
      setError("Unable to load ticket details. Please verify your link or ask reception.");
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    loadTicket();
  }, [loadTicket]);

  // Real-time SSE listener
  const { isConnected } = useClinicSSE(DEFAULT_TENANT_ID, (event, data) => {
    // If any queue or consultation event fires, refresh ticket data in real-time
    if (
      event === "PATIENT_CALLED" ||
      event === "CONSULTATION_STARTED" ||
      event === "CONSULTATION_COMPLETED" ||
      event === "PATIENT_CHECKED_IN" ||
      event === "WALK_IN_ADDED" ||
      event === "DELAY_BROADCASTED" ||
      event === "QUEUE_UPDATED"
    ) {
      loadTicket();
    }
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin" />
          <p className="text-slate-400 text-sm font-medium">Loading live queue ticket...</p>
        </div>
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-800/80 border border-red-500/30 rounded-2xl p-6 text-center">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <h2 className="text-xl font-bold text-white mb-2">Ticket Not Found</h2>
          <p className="text-slate-400 text-sm mb-6">{error || "Invalid or expired ticket link."}</p>
          <button
            onClick={() => {
              setLoading(true);
              loadTicket();
            }}
            className="w-full py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm font-semibold transition"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const isServingMe =
    ticket.status === "IN_CONSULTATION" ||
    (ticket.current_serving_token && ticket.current_serving_token === ticket.ticket_number);

  const isCompleted = ticket.status === "COMPLETED";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 sm:p-6 max-w-lg mx-auto">
      {/* Top Header */}
      <header className="flex items-center justify-between pb-4 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 via-teal-400 to-cyan-300 flex items-center justify-center font-black text-slate-950 shadow-lg shadow-emerald-500/25">
            GT
          </div>
          <div>
            <h1 className="text-base font-bold text-white leading-tight">GlimsTech AI Clinic</h1>
            <p className="text-xs text-slate-400">Live OPD Queue Tracker</p>
          </div>
        </div>

        {/* Live SSE Badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs">
          <span
            className={`w-2 h-2 rounded-full ${
              isConnected ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
            }`}
          />
          <span className="text-[11px] font-medium text-slate-400">
            {isConnected ? "Live Sync" : "Connecting"}
          </span>
        </div>
      </header>

      {/* Main Content Card */}
      <main className="my-6 space-y-4">
        {/* Urgent Callout if patient is currently being called / in consultation */}
        {isServingMe && !isCompleted && (
          <div className="bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border-2 border-emerald-500/80 rounded-2xl p-4 flex items-center gap-3 animate-pulse">
            <Volume2 className="w-8 h-8 text-emerald-400 shrink-0" />
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">It's Your Turn!</p>
              <p className="text-sm font-semibold text-white">
                Please proceed directly to {ticket.room_number ? `Room ${ticket.room_number}` : "the doctor's consultation room"}.
              </p>
            </div>
          </div>
        )}

        {/* Delay Announcement Banner */}
        {ticket.delay_minutes > 0 && (
          <div className="bg-amber-500/15 border border-amber-500/40 rounded-2xl p-3.5 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs">
              <span className="font-bold text-amber-300">OPD Delay Notice: </span>
              <span className="text-slate-300">
                Doctor schedule is running approximately {ticket.delay_minutes} minutes behind due to emergency cases. Thank you for your patience.
              </span>
            </div>
          </div>
        )}

        {/* Ticket Hero Badge */}
        <div className="bg-gradient-to-b from-slate-900 to-slate-900/90 border border-slate-800 rounded-3xl p-6 text-center shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
            Your Token Number
          </p>
          <div className="text-5xl font-black tracking-tight text-white my-2 font-mono">
            {ticket.ticket_number}
          </div>

          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold mt-1 bg-slate-800 border border-slate-700">
            <span
              className={`w-2 h-2 rounded-full ${
                ticket.status === "CHECKED_IN"
                  ? "bg-emerald-400"
                  : ticket.status === "IN_CONSULTATION"
                  ? "bg-blue-400"
                  : ticket.status === "COMPLETED"
                  ? "bg-purple-400"
                  : "bg-slate-400"
              }`}
            />
            <span className="capitalize">{ticket.status.replace("_", " ").toLowerCase()}</span>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-center justify-around text-xs text-slate-400">
            <div>
              <p className="text-[11px] text-slate-400">Patient</p>
              <p className="font-semibold text-slate-200 mt-0.5">{ticket.patient_name}</p>
            </div>
            <div className="h-6 w-px bg-slate-800" />
            <div>
              <p className="text-[11px] text-slate-400">Time</p>
              <p className="font-semibold text-slate-200 mt-0.5">{ticket.appointment_time || "Walk-In"}</p>
            </div>
          </div>
        </div>

        {/* Live Queue Radar */}
        {!isCompleted ? (
          <div className="grid grid-cols-2 gap-3">
            {/* Current Serving */}
            <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-4 flex flex-col justify-between">
              <span className="text-[11px] font-semibold uppercase text-slate-400 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-blue-400" />
                Now Serving
              </span>
              <div className="my-2">
                <span className="text-2xl font-bold font-mono text-blue-400">
                  {ticket.current_serving_token || "—"}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Currently in consultation</p>
            </div>

            {/* Estimated Wait / People Ahead */}
            <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-4 flex flex-col justify-between">
              <span className="text-[11px] font-semibold uppercase text-slate-400 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-emerald-400" />
                Estimated Wait
              </span>
              <div className="my-2 flex items-baseline gap-1">
                <span className="text-2xl font-bold font-mono text-emerald-400">
                  {ticket.estimated_wait_minutes}
                </span>
                <span className="text-xs text-slate-400">mins</span>
              </div>
              <p className="text-[11px] text-slate-400">
                {ticket.people_ahead === 0
                  ? "Next in line"
                  : `${ticket.people_ahead} patient${ticket.people_ahead > 1 ? "s" : ""} ahead`}
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-purple-950/20 border border-purple-500/30 rounded-2xl p-5 text-center">
            <CheckCircle2 className="w-10 h-10 text-purple-400 mx-auto mb-2" />
            <h3 className="text-base font-bold text-white">Consultation Finished</h3>
            <p className="text-xs text-slate-400 mt-1">Thank you for visiting GlimsTech AI Clinic!</p>
          </div>
        )}

        {/* Doctor and Clinic Info Card */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-emerald-400 shrink-0">
              <Stethoscope className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-bold text-white truncate">{ticket.doctor_name}</h4>
              <p className="text-xs text-slate-400 truncate">{ticket.doctor_specialty || "General OPD"}</p>
            </div>
            {ticket.room_number && (
              <div className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs font-semibold text-emerald-400 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                <span>Room {ticket.room_number}</span>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer & Live Refresh Info */}
      <footer className="pt-4 border-t border-slate-900 flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span>Private Patient Link</span>
        </div>

        <button
          onClick={() => {
            loadTicket();
          }}
          className="flex items-center gap-1.5 text-slate-400 hover:text-white transition px-2 py-1 rounded-lg hover:bg-slate-800"
        >
          <RefreshCw className="w-3 h-3" />
          <span>{lastRefreshed ? `Refreshed ${lastRefreshed}` : "Refresh"}</span>
        </button>
      </footer>
    </div>
  );
}
