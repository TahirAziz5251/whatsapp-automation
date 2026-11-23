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
    <div className="py-6 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Clinic Owner & Executive Console
            </h1>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
              isConnected ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
            }`}>
              <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
              {isConnected ? "Live Telemetry" : "Connecting"}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Real-time business performance, doctor utilization, WhatsApp message metering & subscription controls.
          </p>
        </div>

        {/* Tenant Selector for Multi-Tenant Review */}
        <div className="flex items-center gap-3">
          <select
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            className="text-sm font-semibold rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="11111111-1111-1111-1111-111111111111">Alpha Heart Clinic (Lahore)</option>
            <option value="33333333-3333-3333-3333-333333333333">City Dental Clinic (Karachi)</option>
            <option value="44444444-4444-4444-4444-444444444444">Noor Children Clinic (Islamabad)</option>
          </select>
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
            title="Refresh Metrics"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* KPI Overview Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Today's Total Patients</span>
            <Users className="w-5 h-5 text-indigo-600" />
          </div>
          <p className="text-3xl font-extrabold text-slate-900 mt-2">{totalBooked}</p>
          <div className="mt-2 text-xs text-slate-500 flex items-center gap-1.5">
            <span className="text-emerald-600 font-semibold">{completedVisits} completed</span>
            <span>•</span>
            <span>{waitingPatients} in queue</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Active Consultation</span>
            <Activity className="w-5 h-5 text-blue-600" />
          </div>
          <p className="text-3xl font-extrabold text-blue-600 mt-2">{inConsultation}</p>
          <p className="mt-2 text-xs text-slate-500">
            Patients currently inside doctor cabins
          </p>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Plan & Status</span>
            <CreditCard className="w-5 h-5 text-emerald-600" />
          </div>
          <p className="text-2xl font-black text-slate-900 mt-2">
            {subscription?.plan_id || "PROFESSIONAL"}
          </p>
          <p className="mt-2 text-xs font-semibold text-emerald-600">
            PKR {subscription?.monthly_price_pkr?.toLocaleString() || "12,000"} / month • ACTIVE
          </p>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Active Doctors</span>
            <Stethoscope className="w-5 h-5 text-purple-600" />
          </div>
          <p className="text-3xl font-extrabold text-purple-600 mt-2">{doctors.length}</p>
          <p className="mt-2 text-xs text-slate-500">
            Consultants on schedule for this tenant
          </p>
        </div>
      </div>

      {/* Metering & Resource Entitlements Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-emerald-600" />
              <h2 className="text-base font-bold text-slate-900">WhatsApp Messaging Quota</h2>
            </div>
            <span className="text-xs font-semibold text-slate-500">
              {waUsed.toLocaleString()} / {waLimit.toLocaleString()} msgs
            </span>
          </div>

          <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
            <div 
              className={`h-full transition-all rounded-full ${
                waPercent > 90 ? "bg-rose-500" : waPercent > 70 ? "bg-amber-500" : "bg-emerald-500"
              }`}
              style={{ width: `${waPercent}%` }}
            />
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <span>{waPercent}% utilized</span>
            <span>{(waLimit - waUsed).toLocaleString()} remaining this month</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-indigo-600" />
              <h2 className="text-base font-bold text-slate-900">AI Tokens Consumption</h2>
            </div>
            <span className="text-xs font-semibold text-slate-500">
              {tokensUsed.toLocaleString()} / {tokenLimit.toLocaleString()} tokens
            </span>
          </div>

          <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
            <div 
              className={`h-full transition-all rounded-full ${
                tokenPercent > 90 ? "bg-rose-500" : tokenPercent > 70 ? "bg-amber-500" : "bg-indigo-500"
              }`}
              style={{ width: `${tokenPercent}%` }}
            />
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <span>{tokenPercent}% utilized</span>
            <span>{(tokenLimit - tokensUsed).toLocaleString()} tokens remaining</span>
          </div>
        </div>
      </div>

      {/* Doctor Performance & Roster Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Stethoscope className="w-5 h-5 text-slate-700" />
            Doctor Rosters & Queue Loads
          </h2>
          <span className="text-xs text-slate-500 font-medium">Auto-synced with live OPD engine</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50/75 text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-3 px-6">Doctor Name</th>
                <th className="py-3 px-6">Specialty</th>
                <th className="py-3 px-6">Consultation Fee</th>
                <th className="py-3 px-6">Assigned Patients</th>
                <th className="py-3 px-6">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {doctors.map((doc) => {
                const docApts = appointments.filter(a => a.doctor_id === doc.id);
                return (
                  <tr key={doc.id} className="hover:bg-slate-50/50">
                    <td className="py-4 px-6 font-semibold text-slate-900">{doc.name}</td>
                    <td className="py-4 px-6 text-slate-600">{doc.specialty}</td>
                    <td className="py-4 px-6 font-medium text-slate-900">PKR {doc.fee_pkr?.toLocaleString()}</td>
                    <td className="py-4 px-6">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700">
                        {docApts.length} bookings
                      </span>
                    </td>
                    <td className="py-4 px-6">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
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
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-indigo-600" />
            Real-Time Tenant Audit Trail
          </h2>
          <span className="text-xs text-slate-500">Immutable PostgreSQL Row-Level Security Ledger</span>
        </div>

        <div className="space-y-3">
          {auditEvents.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">No recent audit events logged.</p>
          ) : (
            auditEvents.map((evt) => (
              <div 
                key={evt.id} 
                className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs text-slate-600"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-slate-800 px-2 py-0.5 bg-white rounded border border-slate-200">
                    {evt.event_type}
                  </span>
                  <span className="text-slate-700 font-medium">{evt.actor_type}: {evt.actor_id || "SYSTEM"}</span>
                </div>
                <span className="text-slate-400">
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
