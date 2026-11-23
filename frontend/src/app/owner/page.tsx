"use client";

import { useEffect, useState, useCallback } from "react";
import { clinicApi, billingApi, crmApi, DEFAULT_TENANT_ID } from "@/lib/api";
import { useClinicSSE } from "@/lib/sse";
import { 
  BarChart3, 
  Users, 
  Stethoscope, 
  MessageSquare, 
  Zap, 
  CreditCard, 
  ShieldCheck, 
  Clock, 
  AlertTriangle,
  RefreshCw,
  Activity,
  CheckCircle2
} from "lucide-react";

export default function OwnerDashboard() {
  const [tenantId, setTenantId] = useState<string>(DEFAULT_TENANT_ID);
  const [subscription, setSubscription] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [auditEvents, setAuditEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [subData, usageData, apts, docs, audits] = await Promise.all([
        billingApi.getSubscription(tenantId).catch(() => null),
        billingApi.getUsage(tenantId).catch(() => null),
        clinicApi.getAppointments(tenantId).catch(() => []),
        clinicApi.getDoctors(tenantId).catch(() => []),
        crmApi.getAuditEvents(tenantId).catch(() => [])
      ]);
      setSubscription(subData);
      setUsage(usageData);
      setAppointments(apts);
      setDoctors(docs);
      setAuditEvents(audits.slice(0, 10));
    } catch (err) {
      console.error("Failed to load owner metrics:", err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Live SSE sync
  const { isConnected } = useClinicSSE(tenantId, () => {
    loadData();
  });

  // Calculate high-level stats
  const totalBooked = appointments.length;
  const waitingPatients = appointments.filter(a => a.status === "WAITING" || a.status === "CHECKED_IN").length;
  const inConsultation = appointments.filter(a => a.status === "IN_CONSULTATION").length;
  const completedVisits = appointments.filter(a => a.status === "COMPLETED").length;

  const waUsed = usage?.usage?.whatsapp_inbound || 0;
  const waLimit = usage?.limits?.max_whatsapp_messages || 5000;
  const waPercent = Math.min(100, Math.round((waUsed / (waLimit || 1)) * 100));

  const tokensUsed = usage?.usage?.ai_tokens || 0;
  const tokenLimit = usage?.limits?.max_ai_tokens || 500000;
  const tokenPercent = Math.min(100, Math.round((tokensUsed / (tokenLimit || 1)) * 100));

  return (
    <div className="py-4 sm:py-6 max-w-6xl mx-auto space-y-8">
      {/* Header (3D Card) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl p-6 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 shadow-xl dark:shadow-slate-950/50">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Clinic Owner & Executive Console
            </h1>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
              isConnected 
                ? "bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300/40 dark:border-emerald-700/50" 
                : "bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300/40 dark:border-amber-700/50"
            }`}>
              <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
              {isConnected ? "Live Telemetry" : "Connecting"}
            </span>
          </div>
          <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            Real-time business performance, doctor utilization, WhatsApp message metering & subscription controls.
          </p>
        </div>

        {/* Tenant Selector for Multi-Tenant Review */}
        <div className="flex items-center gap-3">
          <select
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            className="text-xs sm:text-sm font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-slate-800 dark:text-slate-200 shadow-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="11111111-1111-1111-1111-111111111111">Alpha Heart Clinic (Lahore)</option>
            <option value="33333333-3333-3333-3333-333333333333">City Dental Clinic (Karachi)</option>
            <option value="44444444-4444-4444-4444-444444444444">Noor Children Clinic (Islamabad)</option>
          </select>
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 active:translate-y-0.5 transition-all"
            title="Refresh Metrics"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* KPI Overview Grid (3D Elevated Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl rounded-2xl p-5 border border-slate-200/90 dark:border-slate-800/90 shadow-xl dark:shadow-slate-950/40 transform hover:-translate-y-0.5 transition-all">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-bold uppercase tracking-wider">Today's Total Patients</span>
            <Users className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <p className="text-3xl font-black text-slate-900 dark:text-white mt-2">{totalBooked}</p>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 font-medium">
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{completedVisits} completed</span>
            <span>•</span>
            <span>{waitingPatients} in queue</span>
          </div>
        </div>

        <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl rounded-2xl p-5 border border-slate-200/90 dark:border-slate-800/90 shadow-xl dark:shadow-slate-950/40 transform hover:-translate-y-0.5 transition-all">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-bold uppercase tracking-wider">Active Consultation</span>
            <Activity className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <p className="text-3xl font-black text-blue-600 dark:text-blue-400 mt-2">{inConsultation}</p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 font-medium">
            Patients currently inside doctor cabins
          </p>
        </div>

        <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl rounded-2xl p-5 border border-slate-200/90 dark:border-slate-800/90 shadow-xl dark:shadow-slate-950/40 transform hover:-translate-y-0.5 transition-all">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-bold uppercase tracking-wider">Plan & Status</span>
            <CreditCard className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="text-2xl font-black text-slate-900 dark:text-white mt-2">
            {subscription?.plan_id || "PROFESSIONAL"}
          </p>
          <p className="mt-2 text-xs font-bold text-emerald-600 dark:text-emerald-400">
            PKR {subscription?.monthly_price_pkr?.toLocaleString() || "12,000"} / month • ACTIVE
          </p>
        </div>

        <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl rounded-2xl p-5 border border-slate-200/90 dark:border-slate-800/90 shadow-xl dark:shadow-slate-950/40 transform hover:-translate-y-0.5 transition-all">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-bold uppercase tracking-wider">Active Doctors</span>
            <Stethoscope className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          </div>
          <p className="text-3xl font-black text-purple-600 dark:text-purple-400 mt-2">{doctors.length}</p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 font-medium">
            Consultants on schedule for this tenant
          </p>
        </div>
      </div>

      {/* Metering & Resource Entitlements Section (3D Progress Bars) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl rounded-2xl p-6 border border-slate-200/90 dark:border-slate-800/90 shadow-xl dark:shadow-slate-950/50">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white">WhatsApp Messaging Quota</h2>
            </div>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {waUsed.toLocaleString()} / {waLimit.toLocaleString()} msgs
            </span>
          </div>

          <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-3.5 overflow-hidden p-0.5 border border-slate-200 dark:border-slate-700">
            <div 
              className={`h-full transition-all rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 ${
                waPercent > 90 ? "from-rose-500 to-red-600" : waPercent > 70 ? "from-amber-500 to-orange-500" : ""
              }`}
              style={{ width: `${waPercent}%` }}
            />
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-medium">
            <span>{waPercent}% utilized</span>
            <span>{(waLimit - waUsed).toLocaleString()} remaining this month</span>
          </div>
        </div>

        <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl rounded-2xl p-6 border border-slate-200/90 dark:border-slate-800/90 shadow-xl dark:shadow-slate-950/50">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white">AI Tokens Consumption</h2>
            </div>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {tokensUsed.toLocaleString()} / {tokenLimit.toLocaleString()} tokens
            </span>
          </div>

          <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-3.5 overflow-hidden p-0.5 border border-slate-200 dark:border-slate-700">
            <div 
              className={`h-full transition-all rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 ${
                tokenPercent > 90 ? "from-rose-500 to-red-600" : tokenPercent > 70 ? "from-amber-500 to-orange-500" : ""
              }`}
              style={{ width: `${tokenPercent}%` }}
            />
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-medium">
            <span>{tokenPercent}% utilized</span>
            <span>{(tokenLimit - tokensUsed).toLocaleString()} tokens remaining</span>
          </div>
        </div>
      </div>

      {/* Doctor Performance & Roster Table */}
      <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl rounded-2xl border border-slate-200/90 dark:border-slate-800/90 shadow-xl dark:shadow-slate-950/50 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-800/50 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Stethoscope className="w-5 h-5 text-slate-700 dark:text-slate-300" />
            Doctor Rosters & Queue Loads
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Auto-synced with live OPD engine</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50/50 dark:bg-slate-800/40 text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200/80 dark:border-slate-800/80">
              <tr>
                <th className="py-3 px-6 font-bold">Doctor Name</th>
                <th className="py-3 px-6 font-bold">Specialty</th>
                <th className="py-3 px-6 font-bold">Consultation Fee</th>
                <th className="py-3 px-6 font-bold">Assigned Patients</th>
                <th className="py-3 px-6 font-bold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {doctors.map((doc) => {
                const docApts = appointments.filter(a => a.doctor_id === doc.id);
                return (
                  <tr key={doc.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="py-4 px-6 font-semibold text-slate-900 dark:text-white">{doc.name}</td>
                    <td className="py-4 px-6 text-slate-600 dark:text-slate-400">{doc.specialty}</td>
                    <td className="py-4 px-6 font-semibold text-slate-900 dark:text-white">PKR {doc.fee_pkr?.toLocaleString()}</td>
                    <td className="py-4 px-6">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                        {docApts.length} bookings
                      </span>
                    </td>
                    <td className="py-4 px-6">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Active
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Real-time Audit Events Trail */}
      <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl rounded-2xl border border-slate-200/90 dark:border-slate-800/90 shadow-xl dark:shadow-slate-950/50 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Real-Time Tenant Audit Trail
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Immutable PostgreSQL Row-Level Security Ledger</span>
        </div>

        <div className="space-y-3">
          {auditEvents.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500 py-6 text-center font-medium">No recent audit events logged.</p>
          ) : (
            auditEvents.map((evt) => (
              <div 
                key={evt.id} 
                className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 shadow-xs"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200 px-2 py-0.5 bg-white dark:bg-slate-900 rounded-md border border-slate-200 dark:border-slate-700">
                    {evt.event_type}
                  </span>
                  <span className="text-slate-700 dark:text-slate-300 font-medium">{evt.actor_type}: {evt.actor_id || "SYSTEM"}</span>
                </div>
                <span className="text-slate-400 dark:text-slate-500 font-mono">
                  {new Date(evt.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
