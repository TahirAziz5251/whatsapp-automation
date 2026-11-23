"use client";

import { useEffect, useState, useCallback } from "react";
import { clinicApi } from "@/lib/api";
import { useClinicSSE } from "@/lib/sse";
import { UserCheck, Plus, AlertCircle, RefreshCw, Radio, Clock, CheckCircle2, Phone, Calendar } from "lucide-react";

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
      {/* Top Banner & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">Reception Front Desk</h1>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
              isConnected ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
            }`}>
              <Radio className={`w-3 h-3 ${isConnected ? "animate-pulse text-emerald-600" : "text-amber-600"}`} />
              {isConnected ? "Live SSE (<500ms)" : "Connecting..."}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Real-time patient intake, 1-click arrival check-in, and WhatsApp delay notifications.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowWalkInModal(true)}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold flex items-center gap-2 shadow-sm transition-all"
          >
            <Plus className="w-4 h-4" />
            Walk-in Patient
          </button>
          <button
            onClick={() => setShowDelayModal(true)}
            className="px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all"
          >
            <AlertCircle className="w-4 h-4 text-amber-600" />
            Delay Broadcast
          </button>
          <button
            onClick={loadData}
            className="p-2 text-slate-600 hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Today Total</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{total}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <p className="text-xs font-medium text-emerald-600 uppercase tracking-wider">Checked In (Waiting)</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1">{checkedIn}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <p className="text-xs font-medium text-blue-600 uppercase tracking-wider">In Cabin</p>
          <p className="text-2xl font-bold text-blue-700 mt-1">{inConsultation}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Completed</p>
          <p className="text-2xl font-bold text-slate-600 mt-1">{completed}</p>
        </div>
      </div>

      {/* Appointments Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 text-sm">Today's Appointment & Queue Roster</h2>
          <span className="text-xs text-slate-500">{appointments.length} Records</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3 font-semibold">Token</th>
                <th className="px-6 py-3 font-semibold">Patient</th>
                <th className="px-6 py-3 font-semibold">Doctor</th>
                <th className="px-6 py-3 font-semibold">Slot Time</th>
                <th className="px-6 py-3 font-semibold">Symptoms</th>
                <th className="px-6 py-3 font-semibold">Status</th>
                <th className="px-6 py-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {appointments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-slate-400">
                    No appointments scheduled for today.
                  </td>
                </tr>
              ) : (
                appointments.map((apt) => {
                  const isCheckedIn = apt.status === "CHECKED_IN";
                  const isConsulting = apt.status === "IN_CONSULTATION";
                  const isCompleted = apt.status === "COMPLETED";

                  return (
                    <tr key={apt.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 font-mono font-bold text-slate-900">
                        <span className="px-2.5 py-1 bg-slate-100 rounded-md border border-slate-200">
                          {apt.queue_token}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-medium text-slate-900">
                        {apt.patient_name}
                      </td>
                      <td className="px-6 py-4 text-slate-600">
                        {doctors.find(d => d.id === apt.doctor_id)?.name || "Doctor"}
                      </td>
                      <td className="px-6 py-4 text-slate-600 font-mono text-xs">
                        {apt.slot_time}
                      </td>
                      <td className="px-6 py-4 text-slate-500 text-xs max-w-xs truncate">
                        {apt.symptoms || "General"}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          isConsulting ? "bg-blue-100 text-blue-800 animate-pulse" :
                          isCheckedIn ? "bg-emerald-100 text-emerald-800" :
                          isCompleted ? "bg-slate-100 text-slate-600" :
                          "bg-amber-100 text-amber-800"
                        }`}>
                          {apt.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {apt.status === "BOOKED" ? (
                          <button
                            onClick={() => handleCheckIn(apt.id)}
                            disabled={actionLoading === apt.id}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm"
                          >
                            {actionLoading === apt.id ? "Checking In..." : "1-Click Check In"}
                          </button>
                        ) : isCheckedIn ? (
                          <span className="text-xs text-emerald-600 font-semibold flex items-center justify-end gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Waiting in Area
                          </span>
                        ) : isConsulting ? (
                          <span className="text-xs text-blue-600 font-semibold">In Cabin</span>
                        ) : (
                          <span className="text-xs text-slate-400">Finished</span>
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
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <h3 className="text-lg font-bold text-slate-900">Register Walk-in Patient</h3>
            <p className="text-xs text-slate-500 mt-1">Issues instant sequential queue token and marks as checked in.</p>

            <form onSubmit={handleWalkInSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Patient Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Asad Ali"
                  value={walkInForm.patient_name}
                  onChange={e => setWalkInForm({ ...walkInForm, patient_name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Patient WhatsApp Phone</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 923001234567"
                  value={walkInForm.patient_phone}
                  onChange={e => setWalkInForm({ ...walkInForm, patient_phone: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Select Consulting Doctor</label>
                <select
                  value={walkInForm.doctor_id}
                  onChange={e => setWalkInForm({ ...walkInForm, doctor_id: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none bg-white"
                >
                  {doctors.map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.specialty})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Chief Complaint / Symptoms</label>
                <input
                  type="text"
                  placeholder="e.g. High fever, abdominal pain"
                  value={walkInForm.symptoms}
                  onChange={e => setWalkInForm({ ...walkInForm, symptoms: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowWalkInModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading === "walkin"}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold shadow-sm"
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
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <h3 className="text-lg font-bold text-slate-900">Broadcast Doctor Delay</h3>
            <p className="text-xs text-slate-500 mt-1">Dispatches automated WhatsApp outbox alerts to all affected patients today.</p>

            <form onSubmit={handleDelaySubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Select Doctor</label>
                <select
                  value={delayForm.doctor_id}
                  onChange={e => setDelayForm({ ...delayForm, doctor_id: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none bg-white"
                >
                  {doctors.map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.specialty})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Delay Duration (Minutes)</label>
                <input
                  type="number"
                  min="5"
                  max="180"
                  step="5"
                  value={delayForm.delay_minutes}
                  onChange={e => setDelayForm({ ...delayForm, delay_minutes: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Reason for Delay</label>
                <input
                  type="text"
                  placeholder="e.g. Traffic / Emergency surgery"
                  value={delayForm.reason}
                  onChange={e => setDelayForm({ ...delayForm, reason: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowDelayModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading === "delay"}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-sm font-bold shadow-sm"
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
