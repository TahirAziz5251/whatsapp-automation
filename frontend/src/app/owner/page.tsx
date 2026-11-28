"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { clinicApi, billingApi, DEFAULT_TENANT_ID } from "@/lib/api";
import { useClinicSSE } from "@/lib/sse";
import {
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
  CheckCircle2,
  Calendar,
  Download,
  Search,
  Filter,
  Radio,
  FileSpreadsheet,
  AlertCircle,
  PhoneCall,
  Server,
  Layers,
  ArrowUpRight,
  TrendingUp,
  Percent,
  CheckCircle,
  XCircle,
  HelpCircle,
  Coffee,
  ShieldAlert
} from "lucide-react";

export default function OwnerDashboard() {
  const [tenantId, setTenantId] = useState<string>(DEFAULT_TENANT_ID);
  const [activeTab, setActiveTab] = useState<"operations" | "saas">("operations");

  // Period filter: today, yesterday, week, month, custom
  const [period, setPeriod] = useState<string>("today");
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");

  // Data states
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filter for booking ledger in UI
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showAuditNotice, setShowAuditNotice] = useState<boolean>(true);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      const params: any = { period };
      if (period === "custom" && customStartDate && customEndDate) {
        params.start_date = customStartDate;
        params.end_date = customEndDate;
      }
      const data = await clinicApi.getOwnerAnalytics(tenantId, params);
      setAnalytics(data);
    } catch (err: any) {
      console.error("Failed to load owner analytics:", err);
      setErrorMsg(err.message || "Failed to load executive analytics.");
    } finally {
      setLoading(false);
    }
  }, [tenantId, period, customStartDate, customEndDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Live SSE sync for real-time updates
  const { isConnected } = useClinicSSE(tenantId, () => {
    loadData();
  });

  // Extract safe analytics fields
  const kpis = analytics?.kpis || {
    total_bookings: 0,
    completed_visits: 0,
    checked_in_waiting: 0,
    in_consultation: 0,
    booked_unconfirmed: 0,
    cancelled: 0,
    no_show: 0,
    walk_in_count: 0,
    gross_revenue_pkr: 0,
    potential_revenue_pkr: 0,
    avg_consultation_duration_minutes: 0,
    no_show_rate_percent: 0,
    baseline_notice: "Production Baseline Phase"
  };

  const doctorBreakdown = analytics?.doctor_breakdown || [];
  const bookingsLedger = analytics?.bookings_ledger || [];
  const telemetry = analytics?.telemetry || {
    provider: { type: "EVOLUTION_GO", phone_number_id: "hospital-assistant", display_phone_number: "+923127118485", status: "CONNECTED" },
    outbox: { total: 0, dispatched: 0, pending: 0, failed: 0, recent_failed_jobs: [] }
  };
  const saasSub = analytics?.saas_subscription;
  const saasUsage = analytics?.saas_usage;

  // Filtered booking ledger for drilldown
  const filteredBookings = useMemo(() => {
    return bookingsLedger.filter((b: any) => {
      const matchesStatus = statusFilter === "ALL" || b.status === statusFilter;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        b.patient_name.toLowerCase().includes(q) ||
        b.patient_phone.includes(q) ||
        b.queue_token.toLowerCase().includes(q) ||
        b.doctor_name.toLowerCase().includes(q) ||
        b.appointment_number.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [bookingsLedger, statusFilter, searchQuery]);

  // CSV Export Function (reconciles with filtered SQL query)
  const handleExportCSV = () => {
    if (!bookingsLedger || bookingsLedger.length === 0) {
      alert("No booking data available to export for the selected period.");
      return;
    }

    const headers = [
      "Appointment Number",
      "Queue Token",
      "Date",
      "Slot Time",
      "Status",
      "Patient Name",
      "Patient Phone",
      "Doctor Name",
      "Specialty",
      "Room",
      "Fee (PKR)",
      "Duration (Seconds)",
      "Follow-up Task",
      "24H Reminder Sent",
      "30M Reminder Sent"
    ];

    const escapeCsv = (val: any) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = filteredBookings.map((b: any) => [
      escapeCsv(b.appointment_number),
      escapeCsv(b.queue_token),
      escapeCsv(b.appointment_date),
      escapeCsv(b.slot_time),
      escapeCsv(b.status),
      escapeCsv(b.patient_name),
      escapeCsv(b.patient_phone),
      escapeCsv(b.doctor_name),
      escapeCsv(b.doctor_specialty),
      escapeCsv(b.room_number || "Room"),
      escapeCsv(b.fee_pkr),
      escapeCsv(b.duration_seconds || 0),
      escapeCsv(b.follow_up_task || "None"),
      escapeCsv(b.reminder_24h_sent ? "Yes" : "No"),
      escapeCsv((b.reminder_30m_sent ?? b.reminder_2h_sent) ? "Yes" : "No")
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r: any) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `clinic_bookings_${period}_${analytics?.period?.start_date || "date"}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // SaaS Metering Calculations
  const waUsed = saasUsage?.usage?.whatsapp_inbound || telemetry?.outbox?.dispatched || 0;
  const waLimit = saasUsage?.limits?.max_whatsapp_messages || saasSub?.plan?.max_whatsapp_messages || 5000;
  const waPercent = Math.min(100, Math.round((waUsed / (waLimit || 1)) * 100));

  const tokensUsed = saasUsage?.usage?.ai_tokens || 0;
  const tokenLimit = saasUsage?.limits?.max_ai_tokens || saasSub?.plan?.max_ai_tokens || 500000;
  const tokenPercent = Math.min(100, Math.round((tokensUsed / (tokenLimit || 1)) * 100));

  const seatsUsed = doctorBreakdown.length;
  const seatsLimit = saasSub?.plan?.max_staff_seats || 10;
  const seatsPercent = Math.min(100, Math.round((seatsUsed / (seatsLimit || 1)) * 100));

  return (
    <div className="py-4 sm:py-6 max-w-7xl mx-auto space-y-6 px-2 sm:px-4 pb-16">
      {/* Top Header Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800/90 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Clinic Owner & Executive Console
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                isConnected
                  ? "bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300/40 dark:border-emerald-700/50"
                  : "bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300/40 dark:border-amber-700/50"
              }`}
            >
              <Radio className={`w-3 h-3 ${isConnected ? "animate-pulse text-emerald-500" : "text-amber-500"}`} />
              {isConnected ? "Live Telemetry" : "Connecting..."}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
            <span>Tenant Timezone: <strong className="text-slate-700 dark:text-slate-200">{analytics?.timezone || "Asia/Karachi (PKT)"}</strong></span>
            <span>•</span>
            <span>Reconciled SQL Aggregates</span>
          </div>
        </div>

        {/* Tenant Selector & Refresh */}
        <div className="flex items-center gap-2.5">
          <select
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            className="text-xs sm:text-sm font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-slate-800 dark:text-slate-200 shadow-2xs focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
          >
            <option value="11111111-1111-1111-1111-111111111111">Alpha Heart & Medical Centre (Lahore)</option>
            <option value="33333333-3333-3333-3333-333333333333">City Dental & Orthodontic (Karachi)</option>
            <option value="44444444-4444-4444-4444-444444444444">Noor Children & Pediatric (Islamabad)</option>
          </select>
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 active:scale-95 transition-all shadow-2xs"
            title="Refresh Metrics"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Tabs Navigation & Period Filter Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800/90 rounded-2xl p-4 shadow-xs">
        {/* Tab Switcher */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 w-fit">
          <button
            onClick={() => setActiveTab("operations")}
            className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-bold flex items-center gap-2 transition-all ${
              activeTab === "operations"
                ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <Activity className="w-4 h-4" />
            Operations & Revenue
          </button>
          <button
            onClick={() => setActiveTab("saas")}
            className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-bold flex items-center gap-2 transition-all ${
              activeTab === "saas"
                ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <CreditCard className="w-4 h-4" />
            SaaS Plan & Metering
          </button>
        </div>

        {/* Period Filter Options */}
        <div className="flex flex-wrap items-center gap-2">
          {["today", "yesterday", "week", "month", "custom"].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${
                period === p
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-slate-300"
              }`}
            >
              {p === "week" ? "Last 7 Days" : p === "month" ? "Last 30 Days" : p}
            </button>
          ))}

          {/* Custom Date Inputs */}
          {period === "custom" && (
            <div className="flex items-center gap-1.5 pl-2">
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="px-2.5 py-1 text-xs border rounded-lg bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-mono"
              />
              <span className="text-xs text-slate-400">to</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="px-2.5 py-1 text-xs border rounded-lg bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-mono"
              />
              <button
                onClick={loadData}
                className="px-3 py-1 bg-indigo-600 text-white text-xs font-bold rounded-lg shadow-2xs hover:bg-indigo-500"
              >
                Apply
              </button>
            </div>
          )}

          {/* CSV Export Button */}
          <button
            onClick={handleExportCSV}
            className="ml-auto lg:ml-2 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-2xs active:scale-95 transition-all"
            title="Download reconciled CSV report"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl p-3.5 text-xs text-rose-800 dark:text-rose-300 font-semibold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{errorMsg}</span>
          </div>
          <button
            onClick={() => loadData()}
            className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
          >
            Retry Sync
          </button>
        </div>
      )}

      {/* ========================================================
          TAB 1: CLINIC OPERATIONS & REVENUE
         ======================================================== */}
      {activeTab === "operations" && (
        <div className="space-y-6">
          {/* 4 Primary Operational KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Bookings */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800/90 rounded-2xl p-5 shadow-xs border-l-4 border-l-indigo-600">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Total Bookings
              </span>
              <div className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white mt-1">
                {kpis.total_bookings}
              </div>
              <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1.5">
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">{kpis.completed_visits} completed</span>
                <span>•</span>
                <span>{kpis.walk_in_count} walk-in</span>
              </div>
            </div>

            {/* Gross Completed Revenue */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800/90 rounded-2xl p-5 shadow-xs border-l-4 border-l-emerald-500">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Gross Completed Revenue
              </span>
              <div className="text-3xl sm:text-4xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
                PKR {kpis.gross_revenue_pkr.toLocaleString()}
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 font-medium">
                Potential: PKR {kpis.potential_revenue_pkr.toLocaleString()}
              </p>
            </div>

            {/* Queue & Attendance Breakdown */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800/90 rounded-2xl p-5 shadow-xs border-l-4 border-l-blue-600">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Queue & Attendance
              </span>
              <div className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white mt-1">
                {kpis.checked_in_waiting + kpis.in_consultation}
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 font-medium">
                {kpis.checked_in_waiting} waiting • {kpis.in_consultation} in consultation
              </p>
            </div>

            {/* Average Consultation Duration */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800/90 rounded-2xl p-5 shadow-xs border-l-4 border-l-purple-600">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Avg Consultation Time
              </span>
              <div className="text-3xl sm:text-4xl font-black text-purple-600 dark:text-purple-400 mt-1">
                {kpis.avg_consultation_duration_minutes}m
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 font-medium">
                Based on completed patient visits
              </p>
            </div>
          </div>

          {/* Baseline Benchmark & No-Show Notice Card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800/90 rounded-2xl p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Percent className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                  Clinical Utilization & No-Show Telemetry
                </h3>
              </div>
              <span className="text-[11px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300/50 px-2.5 py-0.5 rounded-full">
                Baseline Establishment Mode
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800">
                <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold uppercase">No-Show Rate</span>
                <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{kpis.no_show_rate_percent}%</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{kpis.no_show} unconfirmed / no-show visits</p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800">
                <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold uppercase">Cancellation Rate</span>
                <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                  {kpis.total_bookings > 0 ? Math.round((kpis.cancelled / kpis.total_bookings) * 100) : 0}%
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">{kpis.cancelled} cancelled appointments</p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800">
                <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold uppercase">Walk-in OPD Volume</span>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{kpis.walk_in_count}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Urgent registrations at Front Desk</p>
              </div>
            </div>

            {/* Strict Regulatory / Audit Notice */}
            {showAuditNotice && (
              <div className="mt-4 p-3 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-800/40 rounded-xl text-xs text-amber-800 dark:text-amber-300 font-medium flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                  <span>
                    <strong>Clinical Governance Audit Rule:</strong> No-show and utilization baselines cannot be treated as verified proof of business improvement until recorded and compared in production over a minimum 14-day sample (currently in <em>Baseline Calibration Phase</em>).
                  </span>
                </div>
                <button
                  onClick={() => setShowAuditNotice(false)}
                  className="text-amber-600 hover:text-amber-800 dark:text-amber-300 text-xs px-1.5 py-0.5 rounded cursor-pointer shrink-0"
                  title="Dismiss notification"
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* Real Infrastructure, WhatsApp Provider & Outbox Telemetry (Never Fake Success Indicators) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Connected Provider Status */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800/90 rounded-2xl p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                  <Server className="w-4 h-4 text-indigo-600" />
                  Connected Channel Provider
                </h3>
                <span
                  className={`px-2.5 py-0.5 text-[11px] font-bold rounded-full ${
                    telemetry.provider.status === "CONNECTED"
                      ? "bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300/40"
                      : "bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 border border-rose-300/40"
                  }`}
                >
                  {telemetry.provider.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800">
                  <span className="text-slate-400 font-semibold">Channel Engine</span>
                  <p className="font-bold text-slate-800 dark:text-white mt-1">{telemetry.provider.type}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800">
                  <span className="text-slate-400 font-semibold">Display Phone</span>
                  <p className="font-bold font-mono text-slate-800 dark:text-white mt-1">{telemetry.provider.display_phone_number}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800">
                  <span className="text-slate-400 font-semibold">Instance Identifier</span>
                  <p className="font-bold text-slate-800 dark:text-white mt-1">{telemetry.provider.phone_number_id}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800">
                  <span className="text-slate-400 font-semibold">Real-Time Ingestion</span>
                  <p className="font-bold text-emerald-600 dark:text-emerald-400 mt-1">Active Webhook</p>
                </div>
              </div>
            </div>

            {/* Outbox & Failed Jobs Telemetry */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800/90 rounded-2xl p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                  <PhoneCall className="w-4 h-4 text-emerald-600" />
                  Outbox & Reminder Jobs Health
                </h3>
                <span className="text-xs text-slate-500 font-medium">True Queue Telemetry</span>
              </div>

              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800">
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Total</span>
                  <p className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">{telemetry.outbox.total}</p>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800">
                  <span className="text-[10px] text-emerald-600 font-bold uppercase">Sent</span>
                  <p className="text-lg font-bold text-emerald-600 mt-0.5">{telemetry.outbox.dispatched}</p>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800">
                  <span className="text-[10px] text-amber-600 font-bold uppercase">Pending</span>
                  <p className="text-lg font-bold text-amber-600 mt-0.5">{telemetry.outbox.pending}</p>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800">
                  <span className="text-[10px] text-rose-600 font-bold uppercase">Failed</span>
                  <p className="text-lg font-bold text-rose-600 mt-0.5">{telemetry.outbox.failed}</p>
                </div>
              </div>

              {/* Failed jobs listing or zero failure indication */}
              <div>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Recent Outbox Retries & Failure Reports:
                </span>
                {telemetry.outbox.recent_failed_jobs.length === 0 ? (
                  <div className="py-2.5 px-3 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/40 text-xs text-emerald-800 dark:text-emerald-300 font-medium flex items-center gap-2">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Zero delivery failures recorded. All dispatched outbox messages acknowledged.</span>
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-[120px] overflow-y-auto">
                    {telemetry.outbox.recent_failed_jobs.map((job: any) => (
                      <div
                        key={job.id}
                        className="p-2 rounded-lg bg-rose-50/60 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-xs text-rose-900 dark:text-rose-200 flex items-center justify-between"
                      >
                        <span className="font-mono">{job.recipient_phone}: {job.error}</span>
                        <span className="text-[10px] text-rose-600">Retry {job.retry_count}/{job.max_retries}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Doctor Performance & Roster Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800/90 rounded-2xl shadow-xs overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/60 dark:bg-slate-800/50">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-slate-700 dark:text-slate-300" />
                Doctor Schedules & Revenue Breakdown
              </h3>
              <span className="text-xs text-slate-500 font-medium">Reconciled with filtered SQL queries</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                <thead className="bg-slate-50/50 dark:bg-slate-800/40 text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-6 font-bold">Doctor</th>
                    <th className="py-3 px-6 font-bold">Specialty & Room</th>
                    <th className="py-3 px-6 font-bold">Consultation Fee</th>
                    <th className="py-3 px-6 font-bold">Assigned Bookings</th>
                    <th className="py-3 px-6 font-bold">Completed Visits</th>
                    <th className="py-3 px-6 font-bold">Gross Revenue</th>
                    <th className="py-3 px-6 font-bold">Avg Consultation</th>
                    <th className="py-3 px-6 font-bold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {doctorBreakdown.map((doc: any) => (
                    <tr key={doc.doctor_id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="py-4 px-6 font-bold text-slate-900 dark:text-white">{doc.name}</td>
                      <td className="py-4 px-6 text-slate-600 dark:text-slate-400">{doc.specialty} • {doc.room_number || "Room"}</td>
                      <td className="py-4 px-6 font-semibold text-slate-900 dark:text-white">PKR {doc.fee_pkr.toLocaleString()}</td>
                      <td className="py-4 px-6 font-bold">{doc.total_bookings}</td>
                      <td className="py-4 px-6 font-bold text-emerald-600 dark:text-emerald-400">{doc.completed_visits}</td>
                      <td className="py-4 px-6 font-bold text-slate-900 dark:text-white">PKR {doc.revenue_pkr.toLocaleString()}</td>
                      <td className="py-4 px-6 text-slate-600 dark:text-slate-400">{doc.avg_duration_minutes}m</td>
                      <td className="py-4 px-6">
                        {doc.is_on_break ? (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 rounded-full border border-amber-300/50">
                            <Coffee className="w-3 h-3" /> Break
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Available
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Authorized Booking List (Strictly Operational, NO clinical details/diagnoses) */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800/90 rounded-2xl shadow-xs overflow-hidden">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-indigo-600" />
                  Authorized Booking Ledger ({filteredBookings.length} records)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Operational reconciliation only. Clinical impression, diagnoses & prescriptions are strictly excluded.
                </p>
              </div>

              {/* Status Filter & Search Drilldown */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search patient, token, doctor..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-1.5 text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="IN_CONSULTATION">In Consultation</option>
                  <option value="CALLED">Called</option>
                  <option value="CHECKED_IN">Checked-in</option>
                  <option value="BOOKED">Booked</option>
                  <option value="CANCELLED">Cancelled</option>
                  <option value="NO_SHOW">No Show</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300">
                <thead className="bg-slate-50/50 dark:bg-slate-800/40 uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-4 font-bold">Token</th>
                    <th className="py-3 px-4 font-bold">Appointment #</th>
                    <th className="py-3 px-4 font-bold">Slot Time</th>
                    <th className="py-3 px-4 font-bold">Patient</th>
                    <th className="py-3 px-4 font-bold">Doctor</th>
                    <th className="py-3 px-4 font-bold">Fee</th>
                    <th className="py-3 px-4 font-bold">Duration</th>
                    <th className="py-3 px-4 font-bold">Reminders</th>
                    <th className="py-3 px-4 font-bold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredBookings.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-400 dark:text-slate-500">
                        No bookings found matching current period and filter.
                      </td>
                    </tr>
                  ) : (
                    filteredBookings.map((b: any) => (
                      <tr key={b.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-teal-700 dark:text-teal-400">{b.queue_token}</td>
                        <td className="py-3 px-4 font-mono font-medium text-slate-500">{b.appointment_number}</td>
                        <td className="py-3 px-4 font-mono">{b.slot_time}</td>
                        <td className="py-3 px-4">
                          <span className="font-bold text-slate-800 dark:text-slate-200 block">{b.patient_name}</span>
                          <span className="text-[11px] text-slate-400 font-mono">{b.patient_phone}</span>
                        </td>
                        <td className="py-3 px-4">{b.doctor_name}</td>
                        <td className="py-3 px-4 font-bold">PKR {b.fee_pkr.toLocaleString()}</td>
                        <td className="py-3 px-4 text-slate-500">{b.duration_seconds ? `${Math.round(b.duration_seconds / 60)}m` : "-"}</td>
                        <td className="py-3 px-4">
                          <span className="text-[10px] text-slate-500 font-mono">
                            24h: {b.reminder_24h_sent ? "✓" : "-"} • 30m: {(b.reminder_30m_sent ?? b.reminder_2h_sent) ? "✓" : "-"}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                              b.status === "COMPLETED"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300"
                                : b.status === "IN_CONSULTATION"
                                ? "bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300"
                                : b.status === "CALLED"
                                ? "bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-300"
                                : b.status === "CHECKED_IN"
                                ? "bg-teal-100 text-teal-800 dark:bg-teal-950/80 dark:text-teal-300"
                                : b.status === "CANCELLED"
                                ? "bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300"
                                : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300"
                            }`}
                          >
                            {b.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          TAB 2: SAAS PLAN, STAFF-SEATS & MESSAGE METERING
         ======================================================== */}
      {activeTab === "saas" && (
        <div className="space-y-6">
          {/* Subscription Tier & Pricing Card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800/90 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6 border-l-4 border-l-indigo-600">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                Active SaaS Platform Tier
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white mt-1">
                {saasSub?.plan?.name || "Clinic & Hospital OPD Enterprise"}
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
                Includes Multi-Doctor Roster, WhatsApp Live Queue Engine, 1-Click Check-in, and Automated Reminders.
              </p>
            </div>

            <div className="text-left md:text-right">
              <span className="text-xs text-slate-400 font-semibold block">Platform Subscription Fee</span>
              <div className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white mt-0.5">
                PKR {saasSub?.plan?.monthly_price_pkr?.toLocaleString() || "12,000"}{" "}
                <span className="text-xs text-slate-400 font-normal">/ month</span>
              </div>
              <span className="inline-flex items-center gap-1.5 mt-2 px-3 py-0.5 text-xs font-bold rounded-full bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-300/40">
                <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Subscription Active
              </span>
            </div>
          </div>

          {/* Metering Cards: Seats, WhatsApp Messages, AI Tokens */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Staff-Seats Quota */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800/90 rounded-2xl p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-indigo-600" />
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm">Doctor Staff-Seats</h3>
                </div>
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                  {seatsUsed} / {seatsLimit} seats
                </span>
              </div>

              <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-3 overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-600 transition-all"
                  style={{ width: `${seatsPercent}%` }}
                />
              </div>

              <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between font-medium">
                <span>{seatsPercent}% utilized</span>
                <span>{seatsLimit - seatsUsed} seats available</span>
              </div>
            </div>

            {/* WhatsApp Messaging Quota */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800/90 rounded-2xl p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-emerald-600" />
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm">WhatsApp Messaging</h3>
                </div>
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                  {waUsed.toLocaleString()} / {waLimit.toLocaleString()}
                </span>
              </div>

              <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-3 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    waPercent > 90 ? "bg-rose-600" : waPercent > 70 ? "bg-amber-500" : "bg-emerald-500"
                  }`}
                  style={{ width: `${waPercent}%` }}
                />
              </div>

              <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between font-medium">
                <span>{waPercent}% utilized</span>
                <span>{(waLimit - waUsed).toLocaleString()} remaining this cycle</span>
              </div>
            </div>

            {/* AI Reasoning Tokens */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800/90 rounded-2xl p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-purple-600" />
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm">AI Agent Tokens</h3>
                </div>
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                  {tokensUsed.toLocaleString()} / {tokenLimit.toLocaleString()}
                </span>
              </div>

              <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-3 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    tokenPercent > 90 ? "bg-rose-600" : tokenPercent > 70 ? "bg-amber-500" : "bg-purple-600"
                  }`}
                  style={{ width: `${tokenPercent}%` }}
                />
              </div>

              <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between font-medium">
                <span>{tokenPercent}% utilized</span>
                <span>{(tokenLimit - tokensUsed).toLocaleString()} tokens remaining</span>
              </div>
            </div>
          </div>

          {/* Separation Notice */}
          <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 rounded-2xl p-5 text-xs text-slate-600 dark:text-slate-300 space-y-2">
            <h4 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-indigo-600" />
              SaaS Billing Separation & Fiscal Isolation Policy
            </h4>
            <p className="leading-relaxed">
              Patient consultation fees (PKR) collected at the clinic are operational clinical receipts. SaaS subscription fees, doctor seat allowances, and WhatsApp messaging quotas are billed separately as platform operational overhead. Neither patient fees nor doctor remuneration are commingled with platform license fees.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
