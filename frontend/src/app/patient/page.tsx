"use client";

import Link from "next/link";
import { MessageSquare, ArrowRight, UserCheck, Stethoscope, Smartphone, ShieldCheck, CheckCircle2 } from "lucide-react";

export default function PatientPage() {
  return (
    <div className="py-12 max-w-3xl mx-auto px-4 text-center space-y-8">
      {/* 3D Gradient Icon */}
      <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-tr from-emerald-500 via-teal-500 to-cyan-500 text-white flex items-center justify-center shadow-2xl shadow-emerald-500/30 ring-4 ring-emerald-400/20">
        <Smartphone className="w-10 h-10 animate-bounce" />
      </div>

      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 text-xs font-bold border border-emerald-300/40 dark:border-emerald-700/50">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          Direct WhatsApp Inbound Booking Active
        </div>
        <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
          Patient Simulator Deprecated
        </h1>
        <p className="text-slate-600 dark:text-slate-400 text-sm sm:text-base leading-relaxed max-w-xl mx-auto">
          Patients interact directly through their own physical WhatsApp phones with the Clinic's paired WhatsApp account.
          The AI Supervisor automatically books slots, assigns queue tokens, enforces PostgreSQL Row-Level Security, and sends mobile tracking links.
        </p>
      </div>

      {/* Instructions Card */}
      <div className="p-6 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl rounded-2xl border border-slate-200/90 dark:border-slate-800/90 shadow-xl text-left space-y-4">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          How Real Patient Testing Works
        </h2>
        <ul className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 space-y-2.5">
          <li className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">1</span>
            <span>Open your personal WhatsApp on your smartphone.</span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">2</span>
            <span>Send a message (e.g. <em>"Dr Tariq appointment chahiye"</em> or <em>"Schedule batayein"</em>) to the clinic's paired WhatsApp number.</span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">3</span>
            <span>Receive an authoritative booking confirmation with token number, durable booking ID, fee, and live tracking link on your phone.</span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">4</span>
            <span>Watch the patient appear live in real time on the Reception Desk and Doctor Cabin screens!</span>
          </li>
        </ul>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
        <Link
          href="/reception"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold text-sm shadow-lg shadow-emerald-600/30 hover:from-emerald-500 hover:to-teal-500 transition-all transform hover:-translate-y-0.5"
        >
          <UserCheck className="w-4 h-4" />
          Open Reception Front Desk
        </Link>
        <Link
          href="/doctor"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-900 dark:bg-slate-800 text-white font-bold text-sm border border-slate-700/80 hover:bg-slate-800 dark:hover:bg-slate-700 transition-all transform hover:-translate-y-0.5"
        >
          <Stethoscope className="w-4 h-4" />
          Open Doctor Cabin
        </Link>
      </div>
    </div>
  );
}
