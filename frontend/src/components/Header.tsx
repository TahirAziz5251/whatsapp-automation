"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Stethoscope,
  UserCheck,
  LayoutDashboard,
  Zap,
  Clock,
  Sparkles,
  ShieldCheck
} from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

export default function Header() {
  const pathname = usePathname();
  const isReception = pathname === "/reception";
  const [timeStr, setTimeStr] = useState<string>("");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        }) + " • " + now.toLocaleDateString("en-US", {
          weekday: "short",
          day: "numeric",
          month: "short"
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-b border-slate-200/80 dark:border-slate-800/80 sticky top-0 z-50 transition-colors shadow-xs dark:shadow-slate-950/40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Left: Branding & Terminal Badge */}
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 via-teal-500 to-cyan-400 text-white flex items-center justify-center font-black text-xl shadow-lg shadow-emerald-500/25 ring-2 ring-emerald-400/30 transform group-hover:scale-105 transition-all">
              GT
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-lg text-slate-900 dark:text-white tracking-tight">
                  GlimsTech AI
                </span>
                {isReception ? (
                  <span className="text-xs bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300/40 dark:border-emerald-700/50 px-2.5 py-0.5 rounded-full font-bold shadow-2xs flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    Reception Desk
                  </span>
                ) : (
                  <span className="text-xs bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300/40 dark:border-emerald-700/50 px-2.5 py-0.5 rounded-full font-semibold shadow-2xs">
                    Clinic Pilot
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Alpha Heart & Medical Centre • Lahore
              </p>
            </div>
          </Link>
        </div>

        {/* Right Section: Reception Mode vs Management Navigation */}
        <div className="flex items-center gap-2 sm:gap-3">
          {isReception ? (
            /* Dedicated Reception View: Hub, Reception, Doctor, Owner are REMOVED */
            <div className="flex items-center gap-2.5">
              {timeStr && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/70 text-xs font-semibold text-slate-700 dark:text-slate-200 shadow-2xs">
                  <Clock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span className="tracking-tight">{timeStr}</span>
                </div>
              )}
              <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800/50 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Front Desk Terminal Active</span>
              </div>
            </div>
          ) : (
            /* Other Pages (Hub, Doctor, Owner): Navigation Links */
            <nav className="flex items-center gap-1 sm:gap-1.5">
              <Link
                href="/"
                className={`px-2.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition-all ${
                  pathname === "/"
                    ? "bg-slate-100 dark:bg-slate-800 text-emerald-600 dark:text-emerald-400"
                    : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80"
                }`}
              >
                <LayoutDashboard className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                <span className="hidden md:inline">Hub</span>
              </Link>
              <Link
                href="/reception"
                className={`px-2.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition-all ${
                  pathname === "/reception"
                    ? "bg-slate-100 dark:bg-slate-800 text-emerald-600 dark:text-emerald-400"
                    : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80"
                }`}
              >
                <UserCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span className="hidden sm:inline">Reception</span>
              </Link>
              <Link
                href="/doctor"
                className={`px-2.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition-all ${
                  pathname === "/doctor"
                    ? "bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400"
                    : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80"
                }`}
              >
                <Stethoscope className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span className="hidden sm:inline">Doctor</span>
              </Link>
              <Link
                href="/owner"
                className={`px-2.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition-all ${
                  pathname === "/owner"
                    ? "bg-slate-100 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400"
                    : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80"
                }`}
              >
                <Zap className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span className="hidden sm:inline">Owner</span>
              </Link>
            </nav>
          )}

          {/* Theme Toggle Button */}
          <div className="pl-1 sm:pl-2 border-l border-slate-200 dark:border-slate-800">
            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}
