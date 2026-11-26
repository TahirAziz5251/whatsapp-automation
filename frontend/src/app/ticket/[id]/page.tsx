"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { clinicApi, DEFAULT_TENANT_ID } from "@/lib/api";
import { useClinicSSE } from "@/lib/sse";
import { getBusinessTemplateMeta } from "@/lib/business-templates";
import {
  Clock,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  Activity,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  Volume2,
  MessageCircle,
  CalendarClock,
  XCircle,
  Phone,
  Copy,
  Check,
  Building2,
} from "lucide-react";

interface TicketData {
  tenant_id: string;
  business_template_id: string;
  business_name: string;
  business_address: string;
  business_phone: string;
  map_url?: string;
  whatsapp_number: string;
  currency: string;
  ticket_number: string;
  appointment_number: string;
  appointment_id: string;
  patient_name: string;
  status: string;
  appointment_date: string;
  appointment_time: string;
  doctor_name: string;
  doctor_specialty: string;
  room_number: string;
  fee_pkr: number;
  symptoms: string;
  follow_up_task?: string;
  current_serving_token: string;
  people_ahead: number;
  estimated_wait_minutes: number;
  delay_minutes: number;
  available_days: string[];
  available_slots: string[];
}

export default function PatientTicketPage() {
  const params = useParams();
  const ticketId = params?.id as string;

  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);

  // Self-service UI state
  const [showReschedule, setShowReschedule] = useState<boolean>(false);
  const [rescheduleDate, setRescheduleDate] = useState<string>("");
  const [rescheduleSlot, setRescheduleSlot] = useState<string>("");
  const [showCancelModal, setShowCancelModal] = useState<boolean>(false);
  const [cancelReason, setCancelReason] = useState<string>("");
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [actionMsg, setActionMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadTicket = useCallback(async () => {
    if (!ticketId) return;
    try {
      setError(null);
      const data = await clinicApi.getPatientTicket(ticketId, DEFAULT_TENANT_ID);
      const loaded: TicketData = {
        tenant_id: data.tenant_id || DEFAULT_TENANT_ID,
        business_template_id: data.business_template_id || "CLINIC_OPD",
        business_name: data.business_name || data.clinic_name || "Alpha Heart & Medical Centre",
        business_address: data.business_address || data.clinic_address || "",
        business_phone: data.business_phone || "",
        map_url: data.map_url || "",
        whatsapp_number: data.whatsapp_number || "923127118485",
        currency: data.currency || "PKR",
        ticket_number: data.queue_token || data.appointment_number,
        appointment_number: data.appointment_number || ticketId,
        appointment_id: data.appointment_id || ticketId,
        patient_name: data.patient_name || "Valued Customer",
        status: data.status || "BOOKED",
        appointment_date: data.appointment_date || new Date().toISOString().slice(0, 10),
        appointment_time: data.slot_time || "Walk-In",
        doctor_name: data.doctor_name || "Specialist",
        doctor_specialty: data.specialty || "General",
        room_number: data.room_number || "",
        fee_pkr: Number(data.fee_pkr || 0),
        symptoms: data.symptoms || "",
        follow_up_task: data.follow_up_task || "",
        current_serving_token: data.current_serving_token || "—",
        people_ahead: data.tokens_ahead ?? 0,
        estimated_wait_minutes: data.estimated_wait_minutes ?? 0,
        delay_minutes: data.delay_minutes ?? 0,
        available_days: data.available_days || [],
        available_slots: data.available_slots || ["10:30 AM", "11:00 AM", "11:30 AM"],
      };
      setTicket(loaded);
      setRescheduleDate((prev) => prev || loaded.appointment_date);
      setRescheduleSlot((prev) => prev || loaded.available_slots[0] || loaded.appointment_time);
      setLastRefreshed(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch (err: any) {
      console.error("Failed to load client ticket:", err);
      setError("Unable to load booking pass. Please verify your link or contact support on WhatsApp.");
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    loadTicket();
  }, [loadTicket]);

  // Real-time SSE listener scoped dynamically to resolved tenant
  const { isConnected } = useClinicSSE(ticket?.tenant_id || DEFAULT_TENANT_ID, (event) => {
    if (
      [
        "PATIENT_CALLED",
        "CONSULTATION_STARTED",
        "CONSULTATION_COMPLETED",
        "PATIENT_CHECKED_IN",
        "WALK_IN_ADDED",
        "DELAY_BROADCASTED",
        "QUEUE_UPDATED",
      ].includes(event)
    ) {
      loadTicket();
    }
  });

  const handleCopyLink = () => {
    if (typeof window !== "undefined") {
      navigator.clipboard?.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleReschedule = async () => {
    if (!ticket || !rescheduleDate || !rescheduleSlot) return;
    try {
      setActionBusy(true);
      setActionMsg(null);
      await clinicApi.rescheduleTicket(ticket.appointment_number, rescheduleDate, rescheduleSlot, ticket.tenant_id);
      setActionMsg({
        type: "success",
        text: `Rescheduled to ${rescheduleDate} at ${rescheduleSlot}. Confirmation queued to your WhatsApp.`,
      });
      setShowReschedule(false);
      await loadTicket();
    } catch (err: any) {
      setActionMsg({ type: "error", text: err.message || "Unable to reschedule slot." });
    } finally {
      setActionBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!ticket) return;
    try {
      setActionBusy(true);
      setActionMsg(null);
      await clinicApi.cancelTicket(
        ticket.appointment_number,
        cancelReason || "Customer cancelled via WhatsApp ticket link",
        ticket.tenant_id
      );
      setActionMsg({
        type: "success",
        text: "Booking cancelled. Updated confirmation has been queued to your WhatsApp.",
      });
      setShowCancelModal(false);
      await loadTicket();
    } catch (err: any) {
      setActionMsg({ type: "error", text: err.message || "Unable to cancel booking." });
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin" />
          <p className="text-slate-400 text-sm font-medium">Loading live WhatsApp booking pass...</p>
        </div>
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-red-500/30 rounded-2xl p-6 text-center">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <h2 className="text-xl font-bold text-white mb-2">Pass Not Found</h2>
          <p className="text-slate-400 text-sm mb-6">{error || "Invalid or expired link."}</p>
          <button
            onClick={() => {
              setLoading(true);
              loadTicket();
            }}
            className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-semibold transition"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const tpl = getBusinessTemplateMeta(ticket.business_template_id);
  const initials = ticket.business_name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

  const isServingMe =
    ticket.status === "CALLED" ||
    ticket.status === "IN_CONSULTATION" ||
    (ticket.current_serving_token && ticket.current_serving_token === ticket.ticket_number && ticket.status === "CHECKED_IN");

  const isCompleted = ticket.status === "COMPLETED";
  const isCancelled = ticket.status === "CANCELLED";
  const canSelfManage = ticket.status === "BOOKED" || ticket.status === "CONFIRMED";

  const stepIndexMap: Record<string, number> = {
    BOOKED: 0,
    CONFIRMED: 0,
    CHECKED_IN: 1,
    CALLED: 2,
    IN_CONSULTATION: 2,
    COMPLETED: 3,
  };
  const currentStep = stepIndexMap[ticket.status] ?? 0;

  const waHref = `https://wa.me/${ticket.whatsapp_number}?text=${encodeURIComponent(
    `Assalam-o-Alaikum, I need assistance with my booking ${ticket.appointment_number} (Token ${ticket.ticket_number}) at ${ticket.business_name}.`
  )}`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 sm:p-6 max-w-lg mx-auto">
      {/* Branded White-Label Header */}
      <header className="flex items-center justify-between pb-4 border-b border-slate-800/80 gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-10 h-10 rounded-xl bg-gradient-to-tr ${tpl.accentGradient} flex items-center justify-center font-black text-slate-950 shadow-lg shrink-0`}
          >
            {initials || "GT"}
          </div>
          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-bold text-white leading-tight truncate">
              {ticket.business_name}
            </h1>
            <p className="text-[11px] text-slate-400 truncate">{tpl.subtitle}</p>
          </div>
        </div>

        {/* Live SSE Indicator */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs shrink-0">
          <span
            className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
              }`}
          />
          <span className="text-[11px] font-medium text-slate-300">
            {isConnected ? "Live Sync" : "Syncing"}
          </span>
        </div>
      </header>

      {/* Main Content */}
      <main className="my-5 space-y-4">
        {actionMsg && (
          <div
            className={`p-3 rounded-2xl border text-xs font-medium flex items-center gap-2 ${actionMsg.type === "success"
                ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-200"
                : "bg-rose-500/15 border-rose-500/40 text-rose-200"
              }`}
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{actionMsg.text}</span>
          </div>
        )}

        {/* Turn Alert */}
        {isServingMe && !isCompleted && !isCancelled && (
          <div className="bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border-2 border-emerald-500/80 rounded-2xl p-4 flex items-center gap-3 animate-pulse">
            <Volume2 className="w-8 h-8 text-emerald-400 shrink-0" />
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">{tpl.servingLabel}</p>
              <p className="text-sm font-semibold text-white">
                {tpl.servingAction} {ticket.room_number || "the assigned counter"}.
              </p>
            </div>
          </div>
        )}

        {/* Delay Notice */}
        {ticket.delay_minutes > 0 && !isCancelled && !isCompleted && (
          <div className="bg-amber-500/15 border border-amber-500/40 rounded-2xl p-3.5 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs">
              <span className="font-bold text-amber-300">Schedule Delay Notice: </span>
              <span className="text-slate-300">
                Running approximately {ticket.delay_minutes} minutes behind schedule. Thank you for your patience.
              </span>
            </div>
          </div>
        )}

        {/* Digital WhatsApp Pass Hero Card */}
        <div className="bg-gradient-to-b from-slate-900 to-slate-900/90 border border-slate-800 rounded-3xl p-6 text-center shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-3">
            <span className="font-mono">{ticket.appointment_number}</span>
            <button
              onClick={handleCopyLink}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-slate-300 transition"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? "Copied" : "Copy Pass"}</span>
            </button>
          </div>

          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
            {tpl.tokenLabel}
          </p>
          <div className="text-5xl font-black tracking-tight text-white my-2 font-mono">
            {ticket.ticket_number}
          </div>

          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold mt-1 bg-slate-800 border border-slate-700">
            <span
              className={`w-2 h-2 rounded-full ${isCancelled
                  ? "bg-rose-400"
                  : ticket.status === "CHECKED_IN"
                    ? "bg-emerald-400"
                    : ticket.status === "IN_CONSULTATION" || ticket.status === "CALLED"
                      ? "bg-blue-400"
                      : isCompleted
                        ? "bg-purple-400"
                        : "bg-amber-400"
                }`}
            />
            <span className="capitalize">{ticket.status.replace("_", " ").toLowerCase()}</span>
          </div>

          {/* 4-Step Progress Bar (Reusable across verticals) */}
          {!isCancelled && (
            <div className="mt-5 grid grid-cols-4 gap-1.5 text-center">
              {tpl.steps.map((st, idx) => {
                const active = idx <= currentStep;
                return (
                  <div key={st.key} className="space-y-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-all ${active ? "bg-emerald-400" : "bg-slate-800"
                        }`}
                    />
                    <span
                      className={`block text-[10px] font-semibold ${active ? "text-emerald-300" : "text-slate-500"
                        }`}
                    >
                      {st.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-5 pt-4 border-t border-slate-800/80 grid grid-cols-3 gap-2 text-xs text-slate-400">
            <div>
              <p className="text-[11px] text-slate-500">Client</p>
              <p className="font-semibold text-slate-200 mt-0.5 truncate">{ticket.patient_name}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">Date</p>
              <p className="font-semibold text-slate-200 mt-0.5">{ticket.appointment_date}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">Slot</p>
              <p className="font-semibold text-slate-200 mt-0.5">{ticket.appointment_time}</p>
            </div>
          </div>
        </div>

        {/* Status Radar or Completion / Cancellation Card */}
        {isCancelled ? (
          <div className="bg-rose-950/20 border border-rose-500/30 rounded-2xl p-5 text-center">
            <XCircle className="w-10 h-10 text-rose-400 mx-auto mb-2" />
            <h3 className="text-base font-bold text-white">Booking Cancelled</h3>
            <p className="text-xs text-slate-400 mt-1">
              Need a new appointment? Message {ticket.business_name} on WhatsApp anytime.
            </p>
          </div>
        ) : isCompleted ? (
          <div className="bg-purple-950/20 border border-purple-500/30 rounded-2xl p-5 text-center space-y-1.5">
            <CheckCircle2 className="w-10 h-10 text-purple-400 mx-auto mb-1" />
            <h3 className="text-base font-bold text-white">{tpl.completedTitle}</h3>
            <p className="text-xs text-slate-400">Thank you for choosing {ticket.business_name}!</p>
            {ticket.follow_up_task && (
              <p className="text-xs text-purple-300 font-medium pt-1">
                Follow-up Note: {ticket.follow_up_task}
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-4 flex flex-col justify-between">
              <span className="text-[11px] font-semibold uppercase text-slate-400 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-blue-400" />
                Now Serving
              </span>
              <div className="my-2">
                <span className="text-2xl font-bold font-mono text-blue-400">
                  {ticket.current_serving_token}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Live active queue</p>
            </div>

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
                  ? "Next in line (Estimate, not a guarantee)"
                  : `${ticket.people_ahead} ${ticket.people_ahead > 1 ? "clients" : "client"} ahead (Estimate, not a guarantee)`}
              </p>
            </div>
          </div>
        )}

        {/* Provider, Location & Fee Card */}
        <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-emerald-400 shrink-0">
              <Stethoscope className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-slate-400">{tpl.providerLabel}</p>
              <h4 className="text-sm font-bold text-white truncate">{ticket.doctor_name}</h4>
              <p className="text-xs text-slate-400 truncate">{ticket.doctor_specialty}</p>
            </div>
            {ticket.room_number && (
              <div className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs font-semibold text-emerald-400 flex items-center gap-1 shrink-0">
                <MapPin className="w-3.5 h-3.5" />
                <span>{ticket.room_number}</span>
              </div>
            )}
          </div>

          <div className="pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400 gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Building2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span className="truncate">{ticket.business_address || ticket.business_name}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {ticket.map_url && (
                <a
                  href={ticket.map_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-semibold hover:bg-emerald-500/25 transition"
                >
                  <MapPin className="w-3 h-3" />
                  <span>Maps</span>
                </a>
              )}
              {ticket.fee_pkr > 0 && (
                <span className="font-bold text-emerald-300">
                  {ticket.currency} {ticket.fee_pkr.toLocaleString()}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Customer Self-Service Controls */}
        <div className="space-y-2.5">
          {canSelfManage && (
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => {
                  setShowReschedule((v) => !v);
                  setShowCancelModal(false);
                }}
                className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-bold text-slate-200 transition cursor-pointer"
              >
                <CalendarClock className="w-4 h-4 text-sky-400" />
                Reschedule Slot
              </button>
              <button
                onClick={() => {
                  setShowCancelModal((v) => !v);
                  setShowReschedule(false);
                }}
                className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-rose-950/40 border border-rose-500/30 text-xs font-bold text-rose-300 transition cursor-pointer"
              >
                <XCircle className="w-4 h-4 text-rose-400" />
                Cancel Booking
              </button>
            </div>
          )}

          {/* Reschedule Drawer */}
          {showReschedule && canSelfManage && (
            <div className="p-4 rounded-2xl bg-slate-900 border border-sky-500/30 space-y-3">
              <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                <CalendarClock className="w-4 h-4 text-sky-400" />
                Choose New Date & Available Slot
              </h4>
              <div className="space-y-2">
                <label className="text-[11px] text-slate-400 block">Date</label>
                <input
                  type="date"
                  value={rescheduleDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] text-slate-400 block">Open Time Slots</label>
                <div className="flex flex-wrap gap-1.5">
                  {ticket.available_slots.map((s) => (
                    <button
                      key={s}
                      onClick={() => setRescheduleSlot(s)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${rescheduleSlot === s
                          ? "bg-sky-500/20 border-sky-400 text-sky-200"
                          : "bg-slate-950 border-slate-800 text-slate-400 hover:text-white"
                        }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  disabled={actionBusy}
                  onClick={handleReschedule}
                  className="flex-1 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-bold transition cursor-pointer"
                >
                  {actionBusy ? "Updating..." : "Confirm Reschedule"}
                </button>
                <button
                  onClick={() => setShowReschedule(false)}
                  className="px-3 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {/* Cancel Confirmation Box */}
          {showCancelModal && canSelfManage && (
            <div className="p-4 rounded-2xl bg-slate-900 border border-rose-500/30 space-y-3">
              <h4 className="text-xs font-bold text-rose-300">Cancel This Booking?</h4>
              <input
                type="text"
                placeholder="Optional reason (e.g. schedule conflict)"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder:text-slate-500"
              />
              <div className="flex gap-2">
                <button
                  disabled={actionBusy}
                  onClick={handleCancel}
                  className="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold transition cursor-pointer"
                >
                  {actionBusy ? "Cancelling..." : "Yes, Cancel Booking"}
                </button>
                <button
                  onClick={() => setShowCancelModal(false)}
                  className="px-3 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Keep Booking
                </button>
              </div>
            </div>
          )}

          {/* Direct WhatsApp & Call Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/20 transition"
            >
              <MessageCircle className="w-4 h-4" />
              Message on WhatsApp
            </a>
            {ticket.business_phone && (
              <a
                href={`tel:${ticket.business_phone}`}
                className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-bold transition"
              >
                <Phone className="w-4 h-4 text-emerald-400" />
                Call Desk ({ticket.business_phone})
              </a>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="pt-4 border-t border-slate-900 flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span>Private WhatsApp Pass</span>
        </div>

        <button
          onClick={() => loadTicket()}
          className="flex items-center gap-1.5 text-slate-400 hover:text-white transition px-2 py-1 rounded-lg hover:bg-slate-800 cursor-pointer"
        >
          <RefreshCw className="w-3 h-3" />
          <span>{lastRefreshed ? `Updated ${lastRefreshed}` : "Refresh"}</span>
        </button>
      </footer>
    </div>
  );
}
