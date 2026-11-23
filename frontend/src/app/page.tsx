import Link from "next/link";
import { UserCheck, Stethoscope, Smartphone, Shield, Clock, Zap } from "lucide-react";

export default function HomePage() {
  return (
    <div className="py-8 sm:py-12 max-w-4xl mx-auto">
      <div className="text-center mb-10">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
          Alpha Clinic & OPD Operations Hub
        </h1>
        <p className="mt-3 text-base sm:text-lg text-slate-600 max-w-2xl mx-auto">
          Multi-Tenant Real-Time Clinic Operations Dashboards powered by PostgreSQL 18 Row-Level Security and WhatsApp Inbound Automation.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        {/* Reception Portal */}
        <Link
          href="/reception"
          className="group block p-6 bg-white rounded-2xl border border-slate-200 hover:border-emerald-500 hover:shadow-lg transition-all"
        >
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
            <UserCheck className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 group-hover:text-emerald-600 transition-colors">
            Reception Desk
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Today's appointment roster, 1-Click Patient Check-In, instant walk-in registration, and delay broadcast.
          </p>
          <div className="mt-4 flex items-center text-sm font-semibold text-emerald-600">
            Open Reception Portal &rarr;
          </div>
        </Link>

        {/* Doctor Portal */}
        <Link
          href="/doctor"
          className="group block p-6 bg-white rounded-2xl border border-slate-200 hover:border-blue-500 hover:shadow-lg transition-all"
        >
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4 group-hover:bg-blue-600 group-hover:text-white transition-colors">
            <Stethoscope className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
            Doctor Cabin
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Real-time queue tracker, Call Next patient, start consultation, and complete visit with clinical notes.
          </p>
          <div className="mt-4 flex items-center text-sm font-semibold text-blue-600">
            Open Doctor Portal &rarr;
          </div>
        </Link>

        {/* Patient Mobile Ticket */}
        <Link
          href="/ticket/APT-202611-7B17E6"
          className="group block p-6 bg-white rounded-2xl border border-slate-200 hover:border-purple-500 hover:shadow-lg transition-all"
        >
          <div className="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center mb-4 group-hover:bg-purple-600 group-hover:text-white transition-colors">
            <Smartphone className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 group-hover:text-purple-600 transition-colors">
            Patient Live ETA
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Mobile-optimized ticket view showing private token number, current serving token, and dynamic wait times.
          </p>
          <div className="mt-4 flex items-center text-sm font-semibold text-purple-600">
            View Live Ticket Demo &rarr;
          </div>
        </Link>

        {/* Owner Management Dashboard */}
        <Link
          href="/owner"
          className="group block p-6 bg-white rounded-2xl border border-slate-200 hover:border-indigo-500 hover:shadow-lg transition-all"
        >
          <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-4 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
            <Zap className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
            Owner Console
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Executive view, WhatsApp message metering, AI token usage, active plan status, and live audit events.
          </p>
          <div className="mt-4 flex items-center text-sm font-semibold text-indigo-600">
            Open Owner Console &rarr;
          </div>
        </Link>
      </div>

      {/* Real-time Architecture Notice */}
      <div className="bg-emerald-50 rounded-xl p-5 border border-emerald-200 flex items-start gap-4">
        <Zap className="w-6 h-6 text-emerald-600 flex-shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-bold text-emerald-900">Real-Time Sub-500ms Synchronization</h3>
          <p className="text-xs text-emerald-800 mt-1 leading-relaxed">
            All screens communicate over Server-Sent Events (SSE). When Reception checks in a patient, the patient appears on the Doctor's screen instantaneously. When the Doctor finishes a consultation, the Patient's mobile link updates ETA in real-time.
          </p>
        </div>
      </div>
    </div>
  );
}
