"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { clinicApi } from "@/lib/api";
import { useClinicSSE } from "@/lib/sse";
import {
  Stethoscope,
  UserCheck,
  Play,
  CheckCircle,
  Radio,
  Clock,
  AlertCircle,
  Coffee,
  Check,
  Calendar,
  Users,
  Timer,
  ChevronDown,
  Sparkles,
  PhoneCall,
  ListOrdered,
  X,
  FileCheck2,
  ShieldAlert
} from "lucide-react";

export default function DoctorDashboard() {
  const [doctors, setDoctors] = useState<any[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>("");
  const [appointments, setAppointments] = useState<any[]>([]);
  const [liveQueue, setLiveQueue] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);

  // Modals state
  const [showBreakModal, setShowBreakModal] = useState<boolean>(false);
  const [breakReason, setBreakReason] = useState<string>("Emergency procedure");
  const [showFollowUpModal, setShowFollowUpModal] = useState<boolean>(false);
  const [followUpTask, setFollowUpTask] = useState<string>("");
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Persistent live elapsed seconds for active consultation
  const [nowTimestamp, setNowTimestamp] = useState<number>(Date.now());

  useEffect(() => {
    const timerInterval = setInterval(() => {
      setNowTimestamp(Date.now());
    }, 1000);
    return () => clearInterval(timerInterval);
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [docs, apts, queue] = await Promise.all([
        clinicApi.getDoctors(),
        clinicApi.getAppointments(),
        clinicApi.getLiveQueue()
      ]);
      setDoctors(docs);
      setAppointments(apts);
      setLiveQueue(queue);

      if (docs.length > 0 && !selectedDoctorId) {
        setSelectedDoctorId(docs[0].id);
      }
    } catch (err) {
      console.error("Failed to load doctor dashboard:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedDoctorId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Real-time SSE sync: reception check-in updates doctor cabin in <500ms
  const { isConnected } = useClinicSSE(undefined, (event, data) => {
    console.log("SSE Event Received in Doctor Cabin:", event, data);
    loadData();
  });

  const selectedDoctor = useMemo(() => {
    return doctors.find(d => d.id === selectedDoctorId) || doctors[0] || null;
  }, [doctors, selectedDoctorId]);

  // Filter appointments strictly for this doctor
  const doctorAppointments = useMemo(() => {
    if (!selectedDoctorId) return [];
    return appointments.filter(a => a.doctor_id === selectedDoctorId);
  }, [appointments, selectedDoctorId]);

  // Current active consultation or called patient
  const inConsultationPatient = useMemo(() => {
    return doctorAppointments.find(a => a.status === "IN_CONSULTATION") || null;
  }, [doctorAppointments]);

  const calledPatient = useMemo(() => {
    return doctorAppointments.find(a => a.status === "CALLED") || null;
  }, [doctorAppointments]);

  const activeCabinPatient = inConsultationPatient || calledPatient;

  // Waiting Patients in queue for selected doctor (CHECKED_IN)
  const waitingPatients = useMemo(() => {
    return doctorAppointments.filter(a => a.status === "CHECKED_IN");
  }, [doctorAppointments]);

  // Up Next list (CALLED not consulting + CHECKED_IN)
  const upNextList = useMemo(() => {
    return doctorAppointments.filter(a => a.status === "CALLED" || a.status === "CHECKED_IN");
  }, [doctorAppointments]);

  // KPI Metrics
  const scheduledCount = doctorAppointments.length;
  const waitingCount = doctorAppointments.filter(a => a.status === "CHECKED_IN" || a.status === "CALLED").length;
  const consultingCount = inConsultationPatient ? 1 : 0;
  const completedCount = doctorAppointments.filter(a => a.status === "COMPLETED").length;

  // Derived timer: derived directly from stored consultation_started_at in DB
  const formattedTimer = useMemo(() => {
    if (!inConsultationPatient || !inConsultationPatient.consultation_started_at) {
      return "00:00";
    }
    const started = new Date(inConsultationPatient.consultation_started_at).getTime();
    const elapsedSeconds = Math.max(0, Math.floor((nowTimestamp - started) / 1000));
    const mins = Math.floor(elapsedSeconds / 60);
    const secs = elapsedSeconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }, [inConsultationPatient, nowTimestamp]);

  // Call Next Patient (Idempotent: exactly one waiting visit is called per doctor)
  const handleCallNext = async () => {
    if (!selectedDoctorId) return;
    try {
      setActionLoading(true);
      setActionNotice(null);
      const res = await clinicApi.callNext(selectedDoctorId);
      if (res.status === "NO_PATIENTS_WAITING") {
        setActionNotice("No checked-in patients currently waiting in queue.");
      } else if (res.status === "ALREADY_CALLED") {
        setActionNotice(`Token ${res.queue_token} is already called and awaiting entry. Repeat taps do not duplicate calls.`);
      } else if (res.status === "PATIENT_CALLED") {
        setActionNotice(`Token ${res.queue_token} (${res.patient_name}) called to Cabin.`);
      }
      await loadData();
    } catch (err: any) {
      setActionNotice(`Error: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Start Consultation (Transition CALLED -> IN_CONSULTATION and persist start timestamp)
  const handleStartConsultation = async (appointmentId: string) => {
    try {
      setActionLoading(true);
      setActionNotice(null);
      await clinicApi.startConsultation(appointmentId);
      setActionNotice("Consultation started. Live consultation timer initiated.");
      await loadData();
    } catch (err: any) {
      setActionNotice(`Error starting consultation: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // End Consultation (Transition IN_CONSULTATION -> COMPLETED and persist duration & audit)
  const handleEndConsultation = async (appointmentId: string) => {
    try {
      setActionLoading(true);
      setActionNotice(null);
      const res = await clinicApi.completeConsultation(appointmentId);
      setActionNotice(`Consultation completed for Token ${res.queue_token} (${res.duration_seconds || 0}s).`);
      await loadData();
    } catch (err: any) {
      setActionNotice(`Error ending consultation: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Assign Non-Clinical Follow-up Task
  const handleAssignFollowUp = async () => {
    if (!activeCabinPatient || !followUpTask.trim()) return;
    try {
      setActionLoading(true);
      await clinicApi.assignFollowUpTask(activeCabinPatient.id, followUpTask.trim());
      setShowFollowUpModal(false);
      setFollowUpTask("");
      setActionNotice("Follow-up task logged and synced to Reception.");
      await loadData();
    } catch (err: any) {
      alert(`Error saving follow-up task: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Toggle Doctor Break
  const handleToggleBreak = async () => {
    if (!selectedDoctor) return;
    const currentOnBreak = Boolean(selectedDoctor.is_on_break);
    const newStatus = !currentOnBreak;
    try {
      setActionLoading(true);
      await clinicApi.toggleDoctorBreak(selectedDoctor.id, newStatus, newStatus ? breakReason : undefined);
      setShowBreakModal(false);
      setActionNotice(newStatus ? `Doctor placed on break (${breakReason}). Queue paused.` : "Doctor resumed consultation. Queue active.");
      await loadData();
    } catch (err: any) {
      alert(`Error updating break status: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-2 sm:px-4 pb-12">
      {/* Top Header & Doctor Selector (Matches Reference Design) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800/90 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-teal-700 dark:text-teal-400">
              Clinic / Hospital • Pilot
            </span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${isConnected
                ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40"
                : "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/40"
              }`}>
              <Radio className={`w-3 h-3 ${isConnected ? "animate-pulse text-emerald-500" : "text-amber-500"}`} />
              {isConnected ? "Live Sync Active" : "Connecting..."}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight mt-0.5">
            Doctor workspace
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            A focused schedule and current consultation — only the selected doctor&apos;s demo queue.
          </p>
        </div>

        {/* Doctor Selector Dropdown */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <select
              value={selectedDoctorId}
              onChange={(e) => setSelectedDoctorId(e.target.value)}
              className="appearance-none bg-slate-50 dark:bg-slate-800/90 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 pr-10 text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 shadow-2xs hover:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 cursor-pointer transition-all"
            >
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.specialty} • {d.room_number || "Room"})
                </option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-3.5 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Action Notice Banner (if any) */}
      {actionNotice && (
        <div className="bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800/50 rounded-xl p-3 text-xs sm:text-sm font-semibold text-teal-900 dark:text-teal-200 flex items-center justify-between shadow-2xs">
          <span>{actionNotice}</span>
          <button
            onClick={() => setActionNotice(null)}
            className="text-teal-600 hover:text-teal-900 dark:hover:text-white p-1 rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 4 Metric Cards (Scheduled, Waiting, Consulting, Completed) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Scheduled */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800/90 rounded-2xl p-5 shadow-xs border-l-4 border-l-slate-400 dark:border-l-slate-500">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Scheduled</span>
          <div className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white mt-1">
            {scheduledCount}
          </div>
          <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-1">
            Appointments for selected doctor
          </p>
        </div>

        {/* Waiting */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800/90 rounded-2xl p-5 shadow-xs border-l-4 border-l-amber-500">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Waiting</span>
          <div className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white mt-1">
            {waitingCount}
          </div>
          <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-1">
            Ready for next call
          </p>
        </div>

        {/* Consulting */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800/90 rounded-2xl p-5 shadow-xs border-l-4 border-l-teal-600 dark:border-l-teal-400">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Consulting</span>
          <div className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white mt-1">
            {consultingCount}
          </div>
          <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-1">
            In progress
          </p>
        </div>

        {/* Completed */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800/90 rounded-2xl p-5 shadow-xs border-l-4 border-l-blue-600">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Completed</span>
          <div className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white mt-1">
            {completedCount}
          </div>
          <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-1">
            Finished visits
          </p>
        </div>
      </div>

      {/* 3-Column Content Layout (Today's schedule, Current consultation, Up next) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Column 1: Today's schedule (lg:col-span-4) */}
        <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800/90 rounded-2xl p-5 shadow-xs flex flex-col justify-between min-h-[500px]">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                Today&apos;s schedule
              </h2>
              {selectedDoctor?.is_on_break ? (
                <span className="text-[11px] font-bold bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300/60 dark:border-amber-700/60 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                  <Coffee className="w-3 h-3 text-amber-600" />
                  On Break
                </span>
              ) : (
                <span className="text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-300/40 dark:border-emerald-700/50 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  Available
                </span>
              )}
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 font-medium">
              {selectedDoctor?.specialty || "Physician"} • {selectedDoctor?.room_number || "Room 02"}
            </p>

            {/* List of today's slots */}
            <div className="mt-4 space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
              {doctorAppointments.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400 dark:text-slate-500 font-medium">
                  No appointments scheduled for this doctor today.
                </div>
              ) : (
                doctorAppointments.map((apt) => {
                  const isCurrent = activeCabinPatient?.id === apt.id;
                  return (
                    <div
                      key={apt.id}
                      className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-2 ${isCurrent
                          ? "bg-teal-50/70 dark:bg-teal-950/40 border-teal-300 dark:border-teal-700/60 ring-1 ring-teal-500/20"
                          : "bg-slate-50/60 dark:bg-slate-800/40 border-slate-200/70 dark:border-slate-800/70 hover:border-slate-300 dark:hover:border-slate-700"
                        }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold text-slate-500 dark:text-slate-400">
                            {apt.slot_time}
                          </span>
                          <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {apt.patient_name}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                          {apt.queue_token}
                        </p>
                      </div>

                      {/* Status Badges */}
                      <div>
                        {apt.status === "CHECKED_IN" && (
                          <span className="text-[11px] font-bold text-teal-700 dark:text-teal-300 bg-teal-100/70 dark:bg-teal-950/80 px-2 py-0.5 rounded-md border border-teal-300/40">
                            Checked-in
                          </span>
                        )}
                        {apt.status === "CALLED" && (
                          <span className="text-[11px] font-bold text-purple-700 dark:text-purple-300 bg-purple-100/70 dark:bg-purple-950/80 px-2 py-0.5 rounded-md border border-purple-300/40 animate-pulse">
                            Called
                          </span>
                        )}
                        {apt.status === "IN_CONSULTATION" && (
                          <span className="text-[11px] font-bold text-blue-700 dark:text-blue-300 bg-blue-100/70 dark:bg-blue-950/80 px-2 py-0.5 rounded-md border border-blue-300/40">
                            In consultation
                          </span>
                        )}
                        {apt.status === "COMPLETED" && (
                          <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100/70 dark:bg-emerald-950/80 px-2 py-0.5 rounded-md border border-emerald-300/40">
                            Completed
                          </span>
                        )}
                        {apt.status === "BOOKED" && (
                          <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700">
                            Booked
                          </span>
                        )}
                        {apt.status === "CANCELLED" && (
                          <span className="text-[11px] font-medium text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/80 px-2 py-0.5 rounded-md border border-rose-200 dark:border-rose-900">
                            Cancelled
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Bottom Button: Take a break / Resume */}
          <div className="pt-4 mt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              onClick={() => setShowBreakModal(true)}
              className={`w-full py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all ${selectedDoctor?.is_on_break
                  ? "bg-amber-100 hover:bg-amber-200 text-amber-900 dark:bg-amber-950/80 dark:text-amber-200 border border-amber-300/60"
                  : "bg-slate-100 hover:bg-slate-200/80 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-2xs"
                }`}
            >
              <Coffee className="w-4 h-4" />
              {selectedDoctor?.is_on_break ? "Resume Queue (End Break)" : "Take a break"}
            </button>
          </div>
        </div>

        {/* Column 2: Current consultation (lg:col-span-5) */}
        <div className="lg:col-span-5 rounded-2xl p-6 shadow-xl min-h-[500px] flex flex-col justify-between text-white transition-all bg-[#0a3532] dark:bg-[#072422] border border-teal-700/60">
          <div>
            {/* Header: Title & Room Badge */}
            <div className="flex items-center justify-between border-b border-teal-700/40 pb-3">
              <h2 className="text-sm font-bold text-teal-100 tracking-wide">
                Current consultation
              </h2>
              <span className="text-xs font-mono font-bold bg-teal-800/80 text-teal-200 border border-teal-600/60 px-2.5 py-0.5 rounded-md">
                {selectedDoctor?.room_number || "Room 02"}
              </span>
            </div>

            {/* Active Patient Card / Empty State */}
            {activeCabinPatient ? (
              <div className="mt-5 space-y-4">
                <div>
                  <h3 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                    {activeCabinPatient.patient_name}
                  </h3>
                  <p className="text-xs text-teal-200 font-semibold mt-1">
                    Token {activeCabinPatient.queue_token} •{" "}
                    {activeCabinPatient.status === "CALLED"
                      ? "Called (Awaiting patient entry)"
                      : "In consultation"}
                  </p>
                </div>

                {/* Big Live Monospace Timer (Derived directly from DB stored start timestamp) */}
                <div className="pt-2 pb-1">
                  <div className="text-5xl sm:text-6xl font-black font-mono tracking-tight text-teal-100">
                    {activeCabinPatient.status === "IN_CONSULTATION" ? formattedTimer : "00:00"}
                  </div>
                  <p className="text-[11px] text-teal-300/80 mt-1">
                    {activeCabinPatient.status === "IN_CONSULTATION"
                      ? "• Live consultation duration (persisted on server)"
                      : "• Patient called into room; tap Start Consultation below."}
                  </p>
                </div>

                {/* Patient-provided reason (NO clinical notes per strict pilot guidelines) */}
                <div className="bg-teal-950/60 border border-teal-700/50 rounded-xl p-3.5">
                  <span className="text-[11px] uppercase tracking-wider text-teal-300 font-bold block">
                    Patient-provided reason
                  </span>
                  <p className="text-xs sm:text-sm text-teal-100 font-medium mt-0.5">
                    {activeCabinPatient.symptoms || "General OPD checkup"}
                  </p>
                </div>

                {/* Display Non-Clinical Follow-up Task if set */}
                {activeCabinPatient.follow_up_task && (
                  <div className="bg-teal-900/50 border border-teal-600/50 rounded-xl p-3 flex items-start gap-2">
                    <FileCheck2 className="w-4 h-4 text-teal-300 mt-0.5 shrink-0" />
                    <div>
                      <span className="text-[11px] font-bold text-teal-200 uppercase tracking-wide">
                        Follow-up Task Assigned
                      </span>
                      <p className="text-xs text-teal-100 font-medium">
                        {activeCabinPatient.follow_up_task}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-16 text-center space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-teal-800/40 text-teal-300 border border-teal-700/40 mx-auto flex items-center justify-center">
                  <Stethoscope className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-bold text-white">Cabin Ready</h3>
                <p className="text-xs text-teal-200/80 max-w-xs mx-auto">
                  {waitingPatients.length > 0
                    ? `${waitingPatients.length} patient(s) waiting in queue. Click Call Next to invite the patient inside.`
                    : "No patient currently inside cabin. All checked-in patients have been attended."}
                </p>

                {waitingPatients.length > 0 && (
                  <div className="pt-2">
                    <button
                      onClick={handleCallNext}
                      disabled={actionLoading}
                      className="px-5 py-2.5 bg-white text-teal-950 hover:bg-teal-50 rounded-xl text-xs sm:text-sm font-extrabold inline-flex items-center gap-2 shadow-lg active:scale-95 transition-all"
                    >
                      <PhoneCall className="w-4 h-4" />
                      {actionLoading ? "Calling..." : `Call Next (${waitingPatients[0].queue_token})`}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action Buttons inside consultation card */}
          {activeCabinPatient && (
            <div className="pt-4 border-t border-teal-700/40 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2.5">
                {activeCabinPatient.status === "CALLED" && (
                  <button
                    onClick={() => handleStartConsultation(activeCabinPatient.id)}
                    disabled={actionLoading}
                    className="flex-1 py-2.5 px-4 bg-white text-teal-950 hover:bg-teal-100 rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 shadow-md active:scale-98 transition-all"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    {actionLoading ? "Starting..." : "Start consultation"}
                  </button>
                )}

                {activeCabinPatient.status === "IN_CONSULTATION" && (
                  <button
                    onClick={() => handleEndConsultation(activeCabinPatient.id)}
                    disabled={actionLoading}
                    className="flex-1 py-2.5 px-4 bg-white text-teal-950 hover:bg-teal-100 rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 shadow-md active:scale-98 transition-all"
                  >
                    <Check className="w-4 h-4 stroke-[3]" />
                    {actionLoading ? "Ending..." : "End consultation"}
                  </button>
                )}

                <button
                  onClick={() => setShowFollowUpModal(true)}
                  disabled={actionLoading}
                  className="py-2.5 px-4 bg-teal-800/80 hover:bg-teal-700/80 text-white border border-teal-600/70 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all"
                >
                  <FileCheck2 className="w-4 h-4" />
                  Follow-up task
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Column 3: Up next (lg:col-span-3) */}
        <div className="lg:col-span-3 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800/90 rounded-2xl p-5 shadow-xs flex flex-col justify-between min-h-[500px]">
          <div>
            <div className="pb-3 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
                Up next
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Updates in this demo sync across its role views.
              </p>
            </div>

            {/* List of next patients */}
            <div className="mt-4 space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
              {upNextList.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400 dark:text-slate-500 font-medium">
                  No upcoming patients waiting in queue.
                </div>
              ) : (
                upNextList.map((apt) => (
                  <div
                    key={apt.id}
                    className="p-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/60 px-1.5 py-0.5 rounded border border-teal-200/60 dark:border-teal-800/40">
                          {apt.queue_token}
                        </span>
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                          {apt.patient_name}
                        </span>
                      </div>
                      <div className="mt-1">
                        {apt.status === "CALLED" ? (
                          <span className="text-[10px] font-bold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/60 px-2 py-0.5 rounded border border-purple-200 dark:border-purple-800/40">
                            Called
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                            Waiting
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Single Call Action Button */}
                    {apt.status === "CHECKED_IN" && !inConsultationPatient && (
                      <button
                        onClick={handleCallNext}
                        disabled={actionLoading}
                        className="px-3 py-1 bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-bold shadow-2xs transition-all shrink-0"
                      >
                        Call
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Strict Non-EMR Disclaimer Box (Per User Specification) */}
          <div className="pt-4 mt-4 border-t border-slate-100 dark:border-slate-800">
            <div className="bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/50 rounded-xl p-3 flex items-start gap-2 text-amber-800 dark:text-amber-300">
              <ShieldAlert className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
              <p className="text-[11px] leading-relaxed font-medium">
                This pilot is not an EMR: no diagnosis, prescriptions or clinical notes.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Break / Queue Pause Modal */}
      {showBreakModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
                <Coffee className="w-5 h-5 text-amber-600" />
                {selectedDoctor?.is_on_break ? "Resume Queue" : "Take a Break / Defer Queue"}
              </h3>
              <button
                onClick={() => setShowBreakModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {!selectedDoctor?.is_on_break ? (
              <div className="space-y-3">
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Select a documented reason for pausing queue calls. This updates Reception and waiting queue monitors in real-time.
                </p>
                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide block mb-1">
                    Documented Reason
                  </label>
                  <select
                    value={breakReason}
                    onChange={(e) => setBreakReason(e.target.value)}
                    className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs sm:text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="Emergency procedure">Emergency clinical procedure</option>
                    <option value="Inpatient ward rounds">Inpatient ward rounds</option>
                    <option value="Administrative meeting">Administrative / Clinician meeting</option>
                    <option value="Lunch & rest break">Lunch & rest break</option>
                    <option value="Temporary absence">Temporary absence</option>
                  </select>
                </div>
              </div>
            ) : (
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                Doctor is currently on break ({selectedDoctor.break_reason || "Documented break"}). Click confirm to mark doctor Available and resume queue calling.
              </p>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setShowBreakModal(false)}
                className="px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleToggleBreak}
                disabled={actionLoading}
                className="px-5 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md active:scale-95 transition-all"
              >
                {selectedDoctor?.is_on_break ? "Resume Queue" : "Confirm Break"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Non-Clinical Follow-up Task Modal */}
      {showFollowUpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
                <FileCheck2 className="w-5 h-5 text-teal-600" />
                Non-Clinical Follow-up Task
              </h3>
              <button
                onClick={() => setShowFollowUpModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Log administrative or scheduling follow-up instructions for Front Desk. (No diagnostic notes or prescriptions per pilot rules).
              </p>
              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide block mb-1">
                  Follow-up Instruction
                </label>
                <input
                  type="text"
                  placeholder="e.g., Schedule follow-up visit in 2 weeks"
                  value={followUpTask}
                  onChange={(e) => setFollowUpTask(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs sm:text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {/* Quick suggestions */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {[
                  "Schedule 2-week follow-up",
                  "Collect lab reports at desk",
                  "BP monitoring check in 3 days",
                  "Referral to radiology"
                ].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setFollowUpTask(s)}
                    className="text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-1 rounded-md hover:bg-teal-50 dark:hover:bg-teal-950/40 hover:text-teal-700 transition-colors"
                  >
                    + {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setShowFollowUpModal(false)}
                className="px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleAssignFollowUp}
                disabled={actionLoading || !followUpTask.trim()}
                className="px-5 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md active:scale-95 transition-all disabled:opacity-50"
              >
                Save Task
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
