import Link from "next/link";
import { UserCheck, Stethoscope, Smartphone, Shield, Clock, Zap, MessageSquare, ArrowRight, Activity } from "lucide-react";

export default function HomePage() {
  return (
    <div className="py-6 sm:py-10 max-w-5xl mx-auto space-y-10">
      {/* Hero Banner with 3D Gradient Backdrop */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-teal-700 to-slate-900 p-8 sm:p-12 text-white shadow-2xl shadow-emerald-950/30 border border-emerald-400/20">
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-80 h-80 bg-cyan-400/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 -mb-10 -ml-10 w-80 h-80 bg-emerald-400/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-xs font-semibold mb-4 text-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Live Healthcare Operations Suite
          </div>
          <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-tight">
            GlimsTech AI <span className="bg-gradient-to-r from-emerald-300 to-cyan-200 bg-clip-text text-transparent">Clinic & OPD Suite</span>
          </h1>
          <p className="mt-4 text-sm sm:text-base text-emerald-100/90 leading-relaxed font-normal">
            Multi-Tenant Real-Time Clinic Operations Dashboards powered by PostgreSQL 18 Row-Level Security, sub-500ms Server-Sent Events, and WhatsApp Inbound AI Automation.
          </p>
        </div>
      </div>

      {/* 4 Primary Operational Dashboards (3D Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Reception Portal */}
        <Link
          href="/reception"
          className="group relative p-6 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl rounded-2xl border border-slate-200/90 dark:border-slate-800/90 shadow-xl dark:shadow-slate-950/50 hover:shadow-2xl hover:border-emerald-500/50 dark:hover:border-emerald-500/50 transition-all duration-300 transform hover:-translate-y-1 flex flex-col justify-between"
        >
          <div>
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center mb-4 shadow-lg shadow-emerald-500/25 group-hover:scale-110 transition-transform">
              <UserCheck className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
              Reception Desk
            </h2>
            <p className="mt-2 text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Today's appointment roster, 1-Click Patient Check-In, instant walk-in registration, and delay broadcast.
            </p>
          </div>
          <div className="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center text-xs font-bold text-emerald-600 dark:text-emerald-400 group-hover:translate-x-1 transition-transform">
            Open Reception Portal <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </div>
        </Link>

        {/* Doctor Portal */}
        <Link
          href="/doctor"
          className="group relative p-6 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl rounded-2xl border border-slate-200/90 dark:border-slate-800/90 shadow-xl dark:shadow-slate-950/50 hover:shadow-2xl hover:border-blue-500/50 dark:hover:border-blue-500/50 transition-all duration-300 transform hover:-translate-y-1 flex flex-col justify-between"
        >
          <div>
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center mb-4 shadow-lg shadow-blue-500/25 group-hover:scale-110 transition-transform">
              <Stethoscope className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
              Doctor Cabin
            </h2>
            <p className="mt-2 text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Real-time queue tracker, Call Next patient, start consultation, and complete visit with clinical notes.
            </p>
          </div>
          <div className="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center text-xs font-bold text-blue-600 dark:text-blue-400 group-hover:translate-x-1 transition-transform">
            Open Doctor Portal <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </div>
        </Link>

        {/* Patient WhatsApp Simulator */}
        <Link
          href="/patient"
          className="group relative p-6 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl rounded-2xl border border-slate-200/90 dark:border-slate-800/90 shadow-xl dark:shadow-slate-950/50 hover:shadow-2xl hover:border-teal-500/50 dark:hover:border-teal-500/50 transition-all duration-300 transform hover:-translate-y-1 flex flex-col justify-between"
        >
          <div>
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white flex items-center justify-center mb-4 shadow-lg shadow-teal-500/25 group-hover:scale-110 transition-transform">
              <MessageSquare className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors">
              Patient WhatsApp
            </h2>
            <p className="mt-2 text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Interactive WhatsApp simulation: book appointments, generate tokens, and scan QR for live phone testing.
            </p>
          </div>
          <div className="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center text-xs font-bold text-teal-600 dark:text-teal-400 group-hover:translate-x-1 transition-transform">
            Open Patient Simulator <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </div>
        </Link>

        {/* Owner Management Dashboard */}
        <Link
          href="/owner"
          className="group relative p-6 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl rounded-2xl border border-slate-200/90 dark:border-slate-800/90 shadow-xl dark:shadow-slate-950/50 hover:shadow-2xl hover:border-indigo-500/50 dark:hover:border-indigo-500/50 transition-all duration-300 transform hover:-translate-y-1 flex flex-col justify-between"
        >
          <div>
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center mb-4 shadow-lg shadow-indigo-500/25 group-hover:scale-110 transition-transform">
              <Zap className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
              Owner Console
            </h2>
            <p className="mt-2 text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Executive analytics, WhatsApp message metering, AI token usage, active plan status, and live audit events.
            </p>
          </div>
          <div className="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center text-xs font-bold text-indigo-600 dark:text-indigo-400 group-hover:translate-x-1 transition-transform">
            Open Owner Console <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </div>
        </Link>
      </div>

      {/* Real-time Architecture Notice */}
      <div className="bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-indigo-500/10 dark:from-emerald-950/40 dark:via-slate-900/40 dark:to-indigo-950/40 rounded-2xl p-5 border border-emerald-500/20 dark:border-emerald-500/30 flex items-start gap-4 shadow-md backdrop-blur-md">
        <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-emerald-600/30">
          <Activity className="w-5 h-5 animate-pulse" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            Real-Time Sub-500ms Synchronization
            <span className="text-[10px] bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 font-bold px-2 py-0.5 rounded-full">
              ACTIVE
            </span>
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
            All dashboards communicate through Server-Sent Events (SSE). When Reception checks in a patient, the patient appears on the Doctor's cabin screen instantaneously. When the Doctor finishes a consultation, the Patient's mobile ticket updates wait time in real-time.
          </p>
        </div>
      </div>
    </div>
  );
}
