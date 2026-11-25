"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MessageCircle,
  Search,
  UserCheck,
  Stethoscope,
  Smartphone,
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
  Ticket,
} from "lucide-react";

export default function PatientPage() {
  const router = useRouter();
  const [ticketQuery, setTicketQuery] = useState("");

  const handleTrackSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = ticketQuery.trim();
    if (!cleaned) return;
    router.push(`/ticket/${encodeURIComponent(cleaned)}`);
  };

  return (
    <div className="py-10 max-w-3xl mx-auto px-4 text-center space-y-8">
      <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-tr from-emerald-500 via-teal-500 to-cyan-500 text-white flex items-center justify-center shadow-2xl shadow-emerald-500/30 ring-4 ring-emerald-400/20">
        <Smartphone className="w-10 h-10" />
      </div>

      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 text-xs font-bold border border-emerald-300/40 dark:border-emerald-700/50">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          Live Patient WhatsApp Self-Service Portal
        </div>
        <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
          Book & Track via WhatsApp
        </h1>
        <p className="text-slate-600 dark:text-slate-400 text-sm sm:text-base leading-relaxed max-w-xl mx-auto">
          Message our official clinic WhatsApp assistant to book appointments, check doctor timings,
          or manage your live queue pass with instant reschedule and cancellation controls.
        </p>
      </div>

      {/* Quick Live Pass Lookup + Direct WhatsApp Launcher */}
      <div className="p-6 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl rounded-2xl border border-slate-200/90 dark:border-slate-800/90 shadow-xl text-left space-y-5">
        <form onSubmit={handleTrackSubmit} className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <Ticket className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            Track Your Live Digital Ticket
          </label>
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={ticketQuery}
                onChange={(e) => setTicketQuery(e.target.value)}
                placeholder="Enter Booking ID (e.g. APT-202611-EF03B6) or Token (e.g. T-M01)"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white"
              />
            </div>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              Open Pass <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>

        <div className="pt-4 border-t border-slate-200/80 dark:border-slate-800 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            How WhatsApp Self-Service Works
          </h2>
          <ul className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 space-y-2">
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">1</span>
              <span>Tap <strong>Start WhatsApp Booking</strong> below or message <strong>+92 312 7118485</strong> from your own WhatsApp.</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">2</span>
              <span>Type your request in English, Urdu, or Roman Urdu (e.g. <em>&ldquo;Dr Ayesha ki appointment chahiye&rdquo;</em>).</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">3</span>
              <span>Receive your branded token, fee, room, and private live tracking link to monitor wait time, reschedule, or cancel.</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
        <a
          href="https://wa.me/923127118485?text=Assalam-o-Alaikum%2C%20I%20would%20like%20to%20book%20an%20appointment."
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold text-sm shadow-lg shadow-emerald-600/30 hover:from-emerald-500 hover:to-teal-500 transition-all"
        >
          <MessageCircle className="w-4 h-4" />
          Start WhatsApp Booking
        </a>
        <Link
          href="/reception"
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-900 dark:bg-slate-800 text-white font-bold text-sm border border-slate-700/80 hover:bg-slate-800 transition-all"
        >
          <UserCheck className="w-4 h-4" />
          Reception Desk
        </Link>
        <Link
          href="/doctor"
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-900 dark:bg-slate-800 text-white font-bold text-sm border border-slate-700/80 hover:bg-slate-800 transition-all"
        >
          <Stethoscope className="w-4 h-4" />
          Doctor Cabin
        </Link>
      </div>
    </div>
  );
}
