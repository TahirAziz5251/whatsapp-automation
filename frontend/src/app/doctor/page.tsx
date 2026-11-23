"use client";

import { useEffect, useState, useCallback } from "react";
import { clinicApi } from "@/lib/api";
import { useClinicSSE } from "@/lib/sse";
import { Stethoscope, UserCheck, Play, CheckCircle, Radio, Clock, AlertCircle, FileText } from "lucide-react";

export default function DoctorDashboard() {
  const [doctors, setDoctors] = useState<any[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>("");
  const [appointments, setAppointments] = useState<any[]>([]);
  const [liveQueue, setLiveQueue] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [clinicalNotes, setClinicalNotes] = useState<string>("");

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

  // Real-time SSE sync: reception check-in updates doctor screen in <500ms!
  const { isConnected } = useClinicSSE(undefined, (event, data) => {
    console.log("SSE Event Received in Doctor Cabin:", event, data);
    loadData();
  });

  const selectedDoctor = doctors.find(d => d.id === selectedDoctorId) || doctors[0];

  // Current In-Consultation Patient
  const currentPatient = appointments.find(
    a => a.doctor_id === selectedDoctorId && a.status === "IN_CONSULTATION"
  );

  // Waiting Patients List (Checked In and ready)
  const waitingPatients = appointments.filter(
    a => a.doctor_id === selectedDoctorId && a.status === "CHECKED_IN"
  );

  // Call Next Patient
  const handleCallNext = async () => {
    if (!selectedDoctorId) return;
    try {
      setActionLoading(true);
      const res = await clinicApi.callNext(selectedDoctorId);
      if (res.status === "NO_PATIENTS_WAITING") {
        alert("No checked-in patients are currently waiting in the queue.");
      }
      await loadData();
    } catch (err: any) {
      alert(`Error calling next patient: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Complete Consultation
  const handleCompleteVisit = async () => {
    if (!currentPatient) return;
    try {
      setActionLoading(true);
      await clinicApi.completeConsultation(currentPatient.id, clinicalNotes);
      setClinicalNotes("");
      await loadData();
    } catch (err: any) {
      alert(`Error completing visit: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Bar with Doctor Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">Doctor Consultation Cabin</h1>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
              isConnected ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
            }`}>
              <Radio className={`w-3 h-3 ${isConnected ? "animate-pulse text-emerald-600" : "text-amber-600"}`} />
              {isConnected ? "Live SSE Active (<500ms)" : "Connecting..."}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Real-time patient queue, next-in-line calling, and visit completion.
          </p>
        </div>

        {/* Doctor Switcher */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-bold text-slate-600 uppercase">Consulting As:</label>
          <select
            value={selectedDoctorId}
            onChange={e => setSelectedDoctorId(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
          >
            {doctors.map(d => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.specialty} • {d.room_number})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Grid: Active Consultation (Hero) & Waiting Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Consultation Hero Card (2 Cols) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-5">
              <div className="flex items-center gap-2">
                <Stethoscope className="w-5 h-5 text-blue-600" />
                <h2 className="font-bold text-slate-900 text-base">Current Patient In Cabin</h2>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                currentPatient ? "bg-blue-100 text-blue-800 animate-pulse" : "bg-slate-100 text-slate-600"
              }`}>
                {currentPatient ? "IN CONSULTATION" : "CABIN READY"}
              </span>
            </div>

            {currentPatient ? (
              <div className="space-y-6">
                <div className="flex items-start justify-between bg-blue-50/60 p-5 rounded-2xl border border-blue-100">
                  <div>
                    <span className="text-xs font-bold text-blue-700 uppercase tracking-wider">Serving Token</span>
                    <p className="text-4xl font-extrabold text-blue-900 font-mono mt-0.5">
                      {currentPatient.queue_token}
                    </p>
                    <h3 className="text-xl font-bold text-slate-900 mt-3">{currentPatient.patient_name}</h3>
                    <p className="text-sm text-slate-600 mt-1">
                      <span className="font-semibold text-slate-700">Chief Complaint:</span> {currentPatient.symptoms || "General"}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-500">Scheduled Slot</span>
                    <p className="text-sm font-mono font-bold text-slate-800">{currentPatient.slot_time}</p>
                    <p className="text-xs text-blue-600 mt-2 font-medium">{selectedDoctor?.room_number}</p>
                  </div>
                </div>

                {/* Clinical Notes */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-slate-500" />
                    Doctor Consultation Notes / Advice (Optional)
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Enter diagnostic impression, prescription notes, or follow-up instructions..."
                    value={clinicalNotes}
                    onChange={e => setClinicalNotes(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                  />
                </div>

                {/* Complete Visit Button */}
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    onClick={handleCompleteVisit}
                    disabled={actionLoading}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold flex items-center gap-2 shadow-sm transition-all"
                  >
                    <CheckCircle className="w-4 h-4" />
                    {actionLoading ? "Completing..." : "Complete Consultation & Next"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-slate-50 text-slate-400 mx-auto flex items-center justify-center">
                  <UserCheck className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">No Patient Inside Cabin</h3>
                  <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
                    {waitingPatients.length > 0
                      ? `${waitingPatients.length} patient(s) waiting in the OPD area. Click below to call the next patient.`
                      : "All checked-in patients have been seen."}
                  </p>
                </div>
                {waitingPatients.length > 0 && (
                  <button
                    onClick={handleCallNext}
                    disabled={actionLoading}
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold inline-flex items-center gap-2 shadow-md transition-all animate-bounce"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    {actionLoading ? "Calling..." : `Call Next Patient (${waitingPatients[0].queue_token})`}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Waiting Queue List Sidebar (1 Col) */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-600" />
                Waiting Queue ({waitingPatients.length})
              </h3>
              <span className="text-xs bg-emerald-50 text-emerald-700 font-semibold px-2 py-0.5 rounded-full">
                Checked In
              </span>
            </div>

            <div className="mt-4 space-y-2.5 max-h-[500px] overflow-y-auto">
              {waitingPatients.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">
                  No patients waiting in queue.
                </p>
              ) : (
                waitingPatients.map((apt, idx) => (
                  <div
                    key={apt.id}
                    className="p-3 bg-slate-50 hover:bg-slate-100/80 rounded-xl border border-slate-200 flex items-center justify-between transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-900">
                          {apt.queue_token}
                        </span>
                        <span className="text-xs text-slate-500 font-mono">#{idx + 1}</span>
                      </div>
                      <p className="text-sm font-bold text-slate-800 mt-1">{apt.patient_name}</p>
                      <p className="text-xs text-slate-500 truncate max-w-[180px]">{apt.symptoms || "General"}</p>
                    </div>

                    {!currentPatient && idx === 0 && (
                      <button
                        onClick={handleCallNext}
                        disabled={actionLoading}
                        className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm"
                      >
                        Call
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
