"use client";

import { useEffect, useState, useCallback } from "react";
import { clinicApi } from "@/lib/api";
import { useClinicSSE } from "@/lib/sse";
import { UserCheck, Plus, AlertCircle, RefreshCw, Radio, Clock, CheckCircle2, Phone, Calendar, ArrowRight } from "lucide-react";

export default function ReceptionDashboard() {
  const [appointments, setAppointments] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

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

  // Metrics
  const total = appointments.length;
  const checkedIn = appointments.filter(a => a.status === "CHECKED_IN").length;
  const inConsultation = appointments.filter(a => a.status === "IN_CONSULTATION").length;
  const completed = appointments.filter(a => a.status === "COMPLETED").length;

  return (
    <div className="space-y-6">
      {/* Top Banner & Actions (3D Card) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl p-6 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 shadow-xl dark:shadow-slate-950/50">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Reception Front Desk
            </h1>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
              isConnected 
                ? "bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300/40 dark:border-emerald-700/50" 
                : "bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300/40 dark:border-amber-700/50"
            }`}>
              <Radio className={`w-3.5 h-3.5 ${isConnected ? "animate-pulse text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`} />
              {isConnected ? "Live SSE (<500ms)" : "Connecting..."}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            Real-time patient intake, 1-click arrival check-in, and WhatsApp delay notifications.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowWalkInModal(true)}
            className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 shadow-lg shadow-emerald-600/25 active:translate-y-0.5 transition-all"
          >
            <Plus className="w-4 h-4" />
            Walk-in Patient
          </button>
          <button
            onClick={() => setShowDelayModal(true)}
            className="px-4 py-2.5 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-700/60 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 active:translate-y-0.5 transition-all shadow-sm"
          >
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            Delay Broadcast
          </button>
          <button
            onClick={loadData}
            className="p-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 active:translate-y-0.5 transition-all"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Metrics Row (3D Cards) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 shadow-lg dark:shadow-slate-950/40 transform hover:-translate-y-0.5 transition-all">
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Today Total</p>
          <p className="text-3xl font-black text-slate-900 dark:text-white mt-1">{total}</p>
        </div>
        <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 shadow-lg dark:shadow-slate-950/40 transform hover:-translate-y-0.5 transition-all">
          <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Checked In (Waiting)</p>
          <p className="text-3xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{checkedIn}</p>
        </div>
        <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 shadow-lg dark:shadow-slate-950/40 transform hover:-translate-y-0.5 transition-all">
          <p className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">In Cabin</p>
          <p className="text-3xl font-black text-blue-600 dark:text-blue-400 mt-1">{inConsultation}</p>
        </div>
        <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 shadow-lg dark:shadow-slate-950/40 transform hover:-translate-y-0.5 transition-all">
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Completed</p>
          <p className="text-3xl font-black text-slate-600 dark:text-slate-400 mt-1">{completed}</p>
        </div>
      </div>

      {/* Appointments Table (3D Glass Elevation) */}
      <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl rounded-2xl border border-slate-200/90 dark:border-slate-800/90 overflow-hidden shadow-xl dark:shadow-slate-950/50">
        <div className="p-4 border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-800/50 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-200 text-sm">Today's Appointment & Queue Roster</h2>
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{appointments.length} Records</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700 dark:text-slate-300">
            <thead className="bg-slate-50/50 dark:bg-slate-800/40 text-xs uppercase text-slate-500 dark:text-slate-400 border-b border-slate-200/80 dark:border-slate-800/80">
              <tr>
                <th className="px-6 py-3.5 font-bold">Token</th>
                <th className="px-6 py-3.5 font-bold">Patient</th>
                <th className="px-6 py-3.5 font-bold">Doctor</th>
                <th className="px-6 py-3.5 font-bold">Slot Time</th>
                <th className="px-6 py-3.5 font-bold">Symptoms</th>
                <th className="px-6 py-3.5 font-bold">Status</th>
                <th className="px-6 py-3.5 font-bold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
              {appointments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-400 dark:text-slate-500 font-medium">
                    No appointments scheduled for today.
                  </td>
                </tr>
              ) : (
                appointments.map((apt) => {
                  const isCheckedIn = apt.status === "CHECKED_IN";
                  const isConsulting = apt.status === "IN_CONSULTATION";
                  const isCompleted = apt.status === "COMPLETED";

                  return (
                    <tr key={apt.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-6 py-4 font-mono font-black text-slate-900 dark:text-white">
                        <span className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-xs">
                          {apt.queue_token}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-semibold text-slate-900 dark:text-white">
                        {apt.patient_name}
                      </td>
                      <td className="px-6 py-4 text-slate-600 dark:text-slate-400 font-medium">
                        {doctors.find(d => d.id === apt.doctor_id)?.name || "Doctor"}
                      </td>
                      <td className="px-6 py-4 text-slate-600 dark:text-slate-400 font-mono text-xs">
                        {apt.slot_time}
                      </td>
                      <td className="px-6 py-4 text-slate-500 dark:text-slate-400 text-xs max-w-xs truncate">
                        {apt.symptoms || "General OPD"}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${
                          isConsulting ? "bg-blue-100 dark:bg-blue-950/80 text-blue-800 dark:text-blue-300 border border-blue-300/40 dark:border-blue-700/50 animate-pulse" :
                          isCheckedIn ? "bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300/40 dark:border-emerald-700/50" :
                          isCompleted ? "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700" :
                          "bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300/40 dark:border-amber-700/50"
                        }`}>
                          {apt.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {apt.status === "BOOKED" ? (
                          <button
                            onClick={() => handleCheckIn(apt.id)}
                            disabled={actionLoading === apt.id}
                            className="px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg text-xs font-bold transition-all shadow-md shadow-emerald-600/20 active:translate-y-0.5"
                          >
                            {actionLoading === apt.id ? "Checking In..." : "1-Click Check In"}
                          </button>
                        ) : isCheckedIn ? (
                          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold flex items-center justify-end gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Waiting in Area
                          </span>
                        ) : isConsulting ? (
                          <span className="text-xs text-blue-600 dark:text-blue-400 font-bold">In Cabin</span>
                        ) : (
                          <span className="text-xs text-slate-400 dark:text-slate-500">Finished</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Walk-In Modal */}
      {showWalkInModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Register Walk-in Patient</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Issues instant sequential queue token and marks as checked in.</p>

            <form onSubmit={handleWalkInSubmit} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Patient Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Asad Ali"
                  value={walkInForm.patient_name}
                  onChange={e => setWalkInForm({ ...walkInForm, patient_name: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Patient WhatsApp Phone</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 923001234567"
                  value={walkInForm.patient_phone}
                  onChange={e => setWalkInForm({ ...walkInForm, patient_phone: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Select Consulting Doctor</label>
                <select
                  value={walkInForm.doctor_id}
                  onChange={e => setWalkInForm({ ...walkInForm, doctor_id: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  {doctors.map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.specialty})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Chief Complaint / Symptoms</label>
                <input
                  type="text"
                  placeholder="e.g. High fever, abdominal pain"
                  value={walkInForm.symptoms}
                  onChange={e => setWalkInForm({ ...walkInForm, symptoms: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3">
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
                  className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-emerald-600/30"
                >
                  {actionLoading === "walkin" ? "Registering..." : "Assign Token & Check In"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delay Broadcast Modal */}
      {showDelayModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Broadcast Doctor Delay</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Dispatches automated WhatsApp outbox alerts to all affected patients today.</p>

            <form onSubmit={handleDelaySubmit} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Select Doctor</label>
                <select
                  value={delayForm.doctor_id}
                  onChange={e => setDelayForm({ ...delayForm, doctor_id: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 outline-none"
                >
                  {doctors.map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.specialty})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Delay Duration (Minutes)</label>
                <input
                  type="number"
                  min="5"
                  max="180"
                  step="5"
                  value={delayForm.delay_minutes}
                  onChange={e => setDelayForm({ ...delayForm, delay_minutes: Number(e.target.value) })}
                  className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Reason for Delay</label>
                <input
                  type="text"
                  placeholder="e.g. Traffic / Emergency surgery"
                  value={delayForm.reason}
                  onChange={e => setDelayForm({ ...delayForm, reason: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3">
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
                  className="px-4 py-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-amber-600/30"
                >
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
