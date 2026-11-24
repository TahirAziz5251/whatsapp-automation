"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { clinicApi } from "@/lib/api";
import { useClinicSSE } from "@/lib/sse";
import {
  UserCheck,
  Plus,
  AlertCircle,
  RefreshCw,
  Radio,
  Clock,
  CheckCircle2,
  Phone,
  Search,
  ExternalLink,
  MessageCircle,
  Stethoscope,
  Filter,
  X,
  Bell,
  Check,
  User,
  Activity,
  ChevronRight
} from "lucide-react";

export default function ReceptionDashboard() {
  const [appointments, setAppointments] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>("ALL");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");

  // Real-time Toast Alert State
  const [recentNotification, setRecentNotification] = useState<{
    message: string;
    type: "new_booking" | "check_in" | "called";
  } | null>(null);

  // Modals state
  const [showWalkInModal, setShowWalkInModal] = useState<boolean>(false);
  const [walkInForm, setWalkInForm] = useState({
    patient_name: "",
    patient_phone: "",
    doctor_id: "",
    symptoms: ""
  });

  const [showDelayModal, setShowDelayModal] = useState<boolean>(false);
  const [delayForm, setDelayForm] = useState({
    doctor_id: "",
    delay_minutes: 30,
    reason: "Clinical emergency procedure"
  });

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [apts, docs] = await Promise.all([
        clinicApi.getAppointments(),
        clinicApi.getDoctors()
      ]);
      setAppointments(apts);
      setDoctors(docs);
      if (docs.length > 0 && !walkInForm.doctor_id) {
        setWalkInForm(prev => ({ ...prev, doctor_id: docs[0].id }));
        setDelayForm(prev => ({ ...prev, doctor_id: docs[0].id }));
      }
    } catch (err) {
      console.error("Failed to load appointments:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Real-time SSE synchronization
  const { isConnected, lastEvent } = useClinicSSE(undefined, (event, data) => {
    console.log("SSE Event Received in Reception:", event, data);
    if (event === "BOOKING_CREATED" || event === "WALK_IN_ADDED") {
      setRecentNotification({
        message: `New Patient Registered: ${data?.patient_name || "Patient"} (${data?.queue_token || "Token Issued"})`,
        type: "new_booking"
      });
      setTimeout(() => setRecentNotification(null), 6000);
    } else if (event === "PATIENT_CALLED") {
      setRecentNotification({
        message: `Doctor Called Token ${data?.current_serving_token || "Next Patient"} into Cabin`,
        type: "called"
      });
      setTimeout(() => setRecentNotification(null), 6000);
    }
    loadData();
  });

  // Handle 1-Click Check-In
  const handleCheckIn = async (appointmentId: string) => {
    try {
      setActionLoading(appointmentId);
      await clinicApi.checkIn(appointmentId);
      await loadData();
    } catch (err: any) {
      alert(`Check-in failed: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Walk-In Submission
  const handleWalkInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setActionLoading("walkin");
      await clinicApi.walkIn(walkInForm);
      setShowWalkInModal(false);
      setWalkInForm({ patient_name: "", patient_phone: "", doctor_id: doctors[0]?.id || "", symptoms: "" });
      await loadData();
    } catch (err: any) {
      alert(`Walk-in entry failed: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle Delay Broadcast
  const handleDelaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setActionLoading("delay");
      const res = await clinicApi.broadcastDelay(delayForm.doctor_id, delayForm.delay_minutes, delayForm.reason);
      alert(`Emergency delay broadcasted: ${res.patients_notified_count} patients notified via WhatsApp outbox.`);
      setShowDelayModal(false);
      await loadData();
    } catch (err: any) {
      alert(`Delay broadcast failed: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  // Filtered Appointments
  const filteredAppointments = useMemo(() => {
    return appointments.filter(apt => {
      // 1. Doctor Filter
      if (selectedDoctorId !== "ALL" && apt.doctor_id !== selectedDoctorId) {
        return false;
      }
      // 2. Status Filter
      if (selectedStatus !== "ALL" && apt.status !== selectedStatus) {
        return false;
      }
      // 3. Search Query Filter (Name, Phone, Token, Number)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const pName = (apt.patient_name || "").toLowerCase();
        const pPhone = (apt.customer_phone || "").toLowerCase();
        const token = (apt.queue_token || "").toLowerCase();
        const aptNum = (apt.appointment_number || "").toLowerCase();
        return pName.includes(q) || pPhone.includes(q) || token.includes(q) || aptNum.includes(q);
      }
      return true;
    });
  }, [appointments, selectedDoctorId, selectedStatus, searchQuery]);

  // Metrics
  const total = appointments.length;
  const checkedIn = appointments.filter(a => a.status === "CHECKED_IN").length;
  const inConsultation = appointments.filter(a => a.status === "IN_CONSULTATION").length;
  const completed = appointments.filter(a => a.status === "COMPLETED").length;
  const bookedWaitingArrival = appointments.filter(a => a.status === "BOOKED").length;

  return (
    <div className="space-y-6">
      {/* Real-time Toast Banner */}
      {recentNotification && (
        <div className="flex items-center justify-between p-3.5 px-5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-2xl shadow-lg shadow-emerald-600/30 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-center gap-2.5 text-xs sm:text-sm font-bold">
            <Bell className="w-4 h-4 animate-bounce" />
            <span>{recentNotification.message}</span>
          </div>
          <button
            onClick={() => setRecentNotification(null)}
            className="p-1 hover:bg-white/20 rounded-lg text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Banner & Primary Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl p-6 rounded-3xl border border-slate-200/90 dark:border-slate-800/90 shadow-xl dark:shadow-slate-950/50">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              Reception Front Desk
            </h1>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
              isConnected 
                ? "bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300/40 dark:border-emerald-700/50" 
                : "bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300/40 dark:border-amber-700/50"
            }`}>
              <Radio className={`w-3.5 h-3.5 ${isConnected ? "animate-pulse text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`} />
              {isConnected ? "Live OPD Connected" : "Connecting..."}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            Real-time patient check-in, walk-in registration, digital queue tokens, and WhatsApp alerts.
          </p>
        </div>

        {/* Quick Operations Buttons */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowWalkInModal(true)}
            className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 shadow-lg shadow-emerald-600/30 active:scale-95 transition-all"
          >
            <Plus className="w-4 h-4" />
            + New Walk-in Patient
          </button>
          <button
            onClick={() => setShowDelayModal(true)}
            className="px-3.5 py-2.5 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-700/60 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 active:scale-95 transition-all shadow-xs"
            title="Broadcast emergency delay alert to waiting patients"
          >
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            Delay Broadcast
          </button>
          <button
            onClick={loadData}
            className="p-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 active:scale-95 transition-all"
            title="Refresh List"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* 4 Metric KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Today Total */}
        <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl p-5 rounded-3xl border border-slate-200/90 dark:border-slate-800/90 shadow-lg dark:shadow-slate-950/40">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Today Bookings</p>
            <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400">
              <User className="w-4 h-4" />
            </div>
          </div>
          <p className="text-3xl font-black text-slate-900 dark:text-white mt-1.5">{total}</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
            {bookedWaitingArrival} pending patient arrival
          </p>
        </div>

        {/* Checked In (Waiting in Lounge) */}
        <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl p-5 rounded-3xl border border-emerald-200/70 dark:border-emerald-800/50 shadow-lg dark:shadow-slate-950/40">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">In Waiting Lounge</p>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/80 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <Clock className="w-4 h-4 animate-spin-slow" />
            </div>
          </div>
          <p className="text-3xl font-black text-emerald-600 dark:text-emerald-400 mt-1.5">{checkedIn}</p>
          <p className="text-[11px] text-emerald-700/70 dark:text-emerald-400/70 mt-1">
            Checked in & ready for doctor
          </p>
        </div>

        {/* In Doctor Cabin */}
        <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl p-5 rounded-3xl border border-blue-200/70 dark:border-blue-800/50 shadow-lg dark:shadow-slate-950/40">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">In Doctor Cabin</p>
            <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/80 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <Stethoscope className="w-4 h-4 animate-pulse" />
            </div>
          </div>
          <p className="text-3xl font-black text-blue-600 dark:text-blue-400 mt-1.5">{inConsultation}</p>
          <p className="text-[11px] text-blue-700/70 dark:text-blue-400/70 mt-1">
            Active consultations in progress
          </p>
        </div>

        {/* Completed */}
        <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl p-5 rounded-3xl border border-slate-200/90 dark:border-slate-800/90 shadow-lg dark:shadow-slate-950/40">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Completed Visits</p>
            <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            </div>
          </div>
          <p className="text-3xl font-black text-slate-700 dark:text-slate-300 mt-1.5">{completed}</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
            Discharged & prescriptions sent
          </p>
        </div>
      </div>

      {/* Search, Doctor Pills & Status Filter Bar */}
      <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl p-4 sm:p-5 rounded-3xl border border-slate-200/90 dark:border-slate-800/90 shadow-lg dark:shadow-slate-950/40 space-y-3.5">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Real-time Patient Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by patient name, phone (0300... / 923...), token (T-01), or booking ID..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-9 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Status Filter Buttons */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 text-xs font-bold">
            <button
              onClick={() => setSelectedStatus("ALL")}
              className={`px-3 py-1.5 rounded-xl border transition-all ${
                selectedStatus === "ALL"
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-transparent shadow-xs"
                  : "bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              All ({appointments.length})
            </button>
            <button
              onClick={() => setSelectedStatus("BOOKED")}
              className={`px-3 py-1.5 rounded-xl border transition-all ${
                selectedStatus === "BOOKED"
                  ? "bg-amber-500 text-white border-transparent shadow-xs"
                  : "bg-slate-100 dark:bg-slate-800/60 text-amber-700 dark:text-amber-400 border-slate-200 dark:border-slate-700 hover:bg-amber-50 dark:hover:bg-amber-950/40"
              }`}
            >
              Booked ({bookedWaitingArrival})
            </button>
            <button
              onClick={() => setSelectedStatus("CHECKED_IN")}
              className={`px-3 py-1.5 rounded-xl border transition-all ${
                selectedStatus === "CHECKED_IN"
                  ? "bg-emerald-600 text-white border-transparent shadow-xs"
                  : "bg-slate-100 dark:bg-slate-800/60 text-emerald-700 dark:text-emerald-400 border-slate-200 dark:border-slate-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
              }`}
            >
              Waiting ({checkedIn})
            </button>
            <button
              onClick={() => setSelectedStatus("IN_CONSULTATION")}
              className={`px-3 py-1.5 rounded-xl border transition-all ${
                selectedStatus === "IN_CONSULTATION"
                  ? "bg-blue-600 text-white border-transparent shadow-xs"
                  : "bg-slate-100 dark:bg-slate-800/60 text-blue-700 dark:text-blue-400 border-slate-200 dark:border-slate-700 hover:bg-blue-50 dark:hover:bg-blue-950/40"
              }`}
            >
              In Cabin ({inConsultation})
            </button>
          </div>
        </div>

        {/* Doctor Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-2 border-t border-slate-100 dark:border-slate-800/80 text-xs font-semibold text-slate-600 dark:text-slate-400">
          <span className="flex items-center gap-1 text-[11px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500 mr-1">
            <Filter className="w-3 h-3" /> Doctor:
          </span>
          <button
            onClick={() => setSelectedDoctorId("ALL")}
            className={`px-3 py-1 rounded-xl transition-all ${
              selectedDoctorId === "ALL"
                ? "bg-emerald-600 text-white shadow-xs font-bold"
                : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
            }`}
          >
            All Doctors
          </button>
          {doctors.map(d => {
            const countForDoc = appointments.filter(a => a.doctor_id === d.id).length;
            return (
              <button
                key={d.id}
                onClick={() => setSelectedDoctorId(d.id)}
                className={`px-3 py-1 rounded-xl transition-all whitespace-nowrap ${
                  selectedDoctorId === d.id
                    ? "bg-emerald-600 text-white shadow-xs font-bold"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                {d.name} ({countForDoc})
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Queue & Appointment Roster Table */}
      <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl rounded-3xl border border-slate-200/90 dark:border-slate-800/90 overflow-hidden shadow-xl dark:shadow-slate-950/50">
        <div className="p-5 border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="font-extrabold text-slate-900 dark:text-white text-base tracking-tight">
              Today's Live Queue & Appointment Roster
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Showing {filteredAppointments.length} of {appointments.length} appointments today
            </p>
          </div>
          <span className="text-xs font-bold text-slate-600 dark:text-slate-300 px-3 py-1 bg-white dark:bg-slate-800 rounded-full border border-slate-200 dark:border-slate-700 self-start sm:self-auto">
            {filteredAppointments.length} Active Records
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700 dark:text-slate-300">
            <thead className="bg-slate-50/70 dark:bg-slate-800/40 text-xs uppercase text-slate-500 dark:text-slate-400 border-b border-slate-200/80 dark:border-slate-800/80">
              <tr>
                <th className="px-6 py-4 font-black">Token</th>
                <th className="px-6 py-4 font-black">Patient Details</th>
                <th className="px-6 py-4 font-black">Consulting Doctor</th>
                <th className="px-6 py-4 font-black">Slot Time</th>
                <th className="px-6 py-4 font-black">Symptoms / Reason</th>
                <th className="px-6 py-4 font-black">Queue Status</th>
                <th className="px-6 py-4 font-black text-right">Desk Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
              {filteredAppointments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center text-slate-400 dark:text-slate-500">
                    <div className="max-w-sm mx-auto space-y-3">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                        <UserCheck className="w-6 h-6" />
                      </div>
                      <p className="font-bold text-base text-slate-700 dark:text-slate-300">
                        {searchQuery || selectedDoctorId !== "ALL" || selectedStatus !== "ALL"
                          ? "No matching appointments found"
                          : "No appointments scheduled for today"}
                      </p>
                      <p className="text-xs text-slate-400">
                        {searchQuery || selectedDoctorId !== "ALL"
                          ? "Try clearing the search input or changing doctor filters."
                          : "Patients booking via WhatsApp or reception walk-in will appear here in real-time."}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredAppointments.map((apt) => {
                  const isCheckedIn = apt.status === "CHECKED_IN";
                  const isConsulting = apt.status === "IN_CONSULTATION";
                  const isCompleted = apt.status === "COMPLETED";
                  const isBooked = apt.status === "BOOKED";

                  const cleanPhone = (apt.customer_phone || "").replace(/\D/g, "");
                  const doc = doctors.find(d => d.id === apt.doctor_id);

                  return (
                    <tr
                      key={apt.id}
                      className={`hover:bg-slate-50/70 dark:hover:bg-slate-800/60 transition-colors ${
                        isConsulting ? "bg-blue-50/30 dark:bg-blue-950/20" : ""
                      }`}
                    >
                      {/* Token # */}
                      <td className="px-6 py-4 font-mono font-black text-slate-900 dark:text-white">
                        <span className="px-3 py-1.5 bg-gradient-to-tr from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700/80 rounded-xl border border-slate-300/80 dark:border-slate-600/80 text-sm tracking-wide shadow-2xs">
                          {apt.queue_token}
                        </span>
                      </td>

                      {/* Patient Details & Phone */}
                      <td className="px-6 py-4">
                        <div className="font-extrabold text-slate-900 dark:text-white text-sm">
                          {apt.patient_name || "Valued Patient"}
                        </div>
                        {cleanPhone ? (
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                              +{cleanPhone}
                            </span>
                            <a
                              href={`https://wa.me/${cleanPhone}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-emerald-600 hover:text-emerald-500 transition-colors"
                              title="Chat on WhatsApp"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">Phone not recorded</span>
                        )}
                      </td>

                      {/* Doctor & Room */}
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm">
                          {doc?.name || "Consulting Doctor"}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {doc?.specialty || "OPD"} • {doc?.room_number || "Room 101"}
                        </div>
                      </td>

                      {/* Slot Time */}
                      <td className="px-6 py-4 font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
                        {apt.slot_time}
                      </td>

                      {/* Symptoms */}
                      <td className="px-6 py-4 text-xs text-slate-600 dark:text-slate-300 max-w-xs truncate">
                        {apt.symptoms || "General OPD Checkup"}
                      </td>

                      {/* Status Badge */}
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold ${
                          isConsulting ? "bg-blue-100 dark:bg-blue-950/80 text-blue-800 dark:text-blue-300 border border-blue-300/40 dark:border-blue-700/50" :
                          isCheckedIn ? "bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300/40 dark:border-emerald-700/50" :
                          isCompleted ? "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700" :
                          "bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300/40 dark:border-amber-700/50"
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            isConsulting ? "bg-blue-500 animate-pulse" :
                            isCheckedIn ? "bg-emerald-500 animate-pulse" :
                            isCompleted ? "bg-slate-400" :
                            "bg-amber-500"
                          }`}></span>
                          {isConsulting ? "IN CABIN" :
                           isCheckedIn ? "WAITING" :
                           isCompleted ? "COMPLETED" :
                           "BOOKED"}
                        </span>
                      </td>

                      {/* Action Buttons */}
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {isBooked ? (
                            <button
                              onClick={() => handleCheckIn(apt.id)}
                              disabled={actionLoading === apt.id}
                              className="px-3.5 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-600/20 active:scale-95 flex items-center gap-1.5"
                            >
                              <Check className="w-3.5 h-3.5" />
                              {actionLoading === apt.id ? "Checking In..." : "1-Click Check In"}
                            </button>
                          ) : isCheckedIn ? (
                            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" /> In Lounge
                            </span>
                          ) : isConsulting ? (
                            <span className="text-xs text-blue-600 dark:text-blue-400 font-bold flex items-center gap-1">
                              <Stethoscope className="w-3.5 h-3.5" /> With Doctor
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400 dark:text-slate-500">Discharged</span>
                          )}

                          {/* Digital Ticket Live Link */}
                          <Link
                            href={`/ticket/${apt.appointment_number}`}
                            target="_blank"
                            className="p-1.5 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                            title="View Patient Live Digital Ticket"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Walk-In Registration Modal */}
      {showWalkInModal && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">Register Walk-in Patient</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Issues instant queue token and checks in patient immediately.</p>
              </div>
              <button
                onClick={() => setShowWalkInModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleWalkInSubmit} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Patient Full Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Asad Ali Khan"
                  value={walkInForm.patient_name}
                  onChange={e => setWalkInForm({ ...walkInForm, patient_name: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Patient WhatsApp Phone <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 03021234567 or 923021234567"
                  value={walkInForm.patient_phone}
                  onChange={e => setWalkInForm({ ...walkInForm, patient_phone: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none font-mono"
                />
                <span className="text-[11px] text-slate-400 mt-0.5 block">
                  Confirmation token & live tracking URL will be bound to this number.
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Consulting Doctor <span className="text-rose-500">*</span>
                </label>
                <select
                  value={walkInForm.doctor_id}
                  onChange={e => setWalkInForm({ ...walkInForm, doctor_id: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none font-medium"
                >
                  {doctors.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.name} — {d.specialty} ({d.room_number || "Room 101"}) • PKR {Number(d.fee_pkr || 2000).toLocaleString()}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Chief Complaint / Symptoms (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Chest tightness, routine ECG, high blood pressure"
                  value={walkInForm.symptoms}
                  onChange={e => setWalkInForm({ ...walkInForm, symptoms: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowWalkInModal(false)}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl text-xs sm:text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading === "walkin"}
                  className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-emerald-600/30 flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  {actionLoading === "walkin" ? "Registering..." : "Assign Token & Check In"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delay Broadcast Modal */}
      {showDelayModal && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">Broadcast Doctor Delay</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Dispatches automated WhatsApp outbox alerts to all scheduled patients today.</p>
              </div>
              <button
                onClick={() => setShowDelayModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleDelaySubmit} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Select Doctor</label>
                <select
                  value={delayForm.doctor_id}
                  onChange={e => setDelayForm({ ...delayForm, doctor_id: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 outline-none"
                >
                  {doctors.map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.specialty})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Delay Duration</label>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {[15, 30, 45, 60].map(mins => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => setDelayForm({ ...delayForm, delay_minutes: mins })}
                      className={`py-1.5 text-xs font-bold rounded-xl border transition-all ${
                        delayForm.delay_minutes === mins
                          ? "bg-amber-600 text-white border-amber-600 shadow-xs"
                          : "bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                      }`}
                    >
                      +{mins} min
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min="5"
                  max="180"
                  step="5"
                  value={delayForm.delay_minutes}
                  onChange={e => setDelayForm({ ...delayForm, delay_minutes: Number(e.target.value) })}
                  className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Reason for Delay</label>
                <input
                  type="text"
                  placeholder="e.g. Critical ICU procedure / Traffic delay"
                  value={delayForm.reason}
                  onChange={e => setDelayForm({ ...delayForm, reason: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowDelayModal(false)}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl text-xs sm:text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading === "delay"}
                  className="px-5 py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-amber-600/30 flex items-center gap-1.5"
                >
                  <MessageCircle className="w-4 h-4" />
                  {actionLoading === "delay" ? "Broadcasting..." : "Broadcast via WhatsApp"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
