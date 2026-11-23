import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import { Activity, Stethoscope, UserCheck, MessageSquare, ShieldCheck, Zap, LayoutDashboard } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

export const metadata: Metadata = {
  title: "GlimsTech AI — Clinic OPD & Operations Portal",
  description: "Next.js 14+ Multi-Tenant Real-Time Clinic Operations Dashboards",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const savedTheme = localStorage.getItem('theme');
                const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
                  document.documentElement.classList.add('dark');
                } else {
                  document.documentElement.classList.remove('dark');
                }
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col transition-colors duration-200">
        {/* Top Operational Bar */}
        <header className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border-b border-slate-200/80 dark:border-slate-800/80 sticky top-0 z-50 transition-colors shadow-sm dark:shadow-slate-950/40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 via-teal-500 to-cyan-400 text-white flex items-center justify-center font-black text-xl shadow-lg shadow-emerald-500/25 ring-2 ring-emerald-400/30 transform group-hover:scale-105 transition-all">
                GT
              </div>
              <div>
                <span className="font-extrabold text-lg text-slate-900 dark:text-white flex items-center gap-2 tracking-tight">
                  GlimsTech AI{" "}
                  <span className="text-xs bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300/40 dark:border-emerald-700/50 px-2.5 py-0.5 rounded-full font-semibold shadow-xs">
                    Clinic Pilot
                  </span>
                </span>
                <p className="text-xs text-slate-500 dark:text-slate-400">Alpha Clinic & Diagnostic Centre (PK-Lahore)</p>
              </div>
            </Link>

            <div className="flex items-center gap-1 sm:gap-2">
              <nav className="flex items-center gap-1 sm:gap-1.5">
                <Link
                  href="/"
                  className="px-2.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-emerald-600 dark:hover:text-emerald-400 flex items-center gap-1.5 transition-all"
                >
                  <LayoutDashboard className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                  <span className="hidden md:inline">Hub</span>
                </Link>
                <Link
                  href="/patient"
                  className="px-2.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-emerald-600 dark:hover:text-emerald-400 flex items-center gap-1.5 transition-all"
                >
                  <MessageSquare className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="hidden sm:inline">Patient</span>
                </Link>
                <Link
                  href="/reception"
                  className="px-2.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-emerald-600 dark:hover:text-emerald-400 flex items-center gap-1.5 transition-all"
                >
                  <UserCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="hidden sm:inline">Reception</span>
                </Link>
                <Link
                  href="/doctor"
                  className="px-2.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1.5 transition-all"
                >
                  <Stethoscope className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span className="hidden sm:inline">Doctor</span>
                </Link>
                <Link
                  href="/owner"
                  className="px-2.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1.5 transition-all"
                >
                  <Zap className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span className="hidden sm:inline">Owner</span>
                </Link>
                <Link
                  href="/ticket/APT-202611-7B17E6"
                  className="px-2.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-purple-600 dark:hover:text-purple-400 flex items-center gap-1.5 transition-all"
                >
                  <Activity className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  <span className="hidden lg:inline">Live Link</span>
                </Link>
              </nav>

              {/* Theme Toggle Button in Top-Right */}
              <div className="pl-1 sm:pl-2 border-l border-slate-200 dark:border-slate-800">
                <ThemeToggle />
              </div>
            </div>
          </div>
        </header>

        {/* Main View */}
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>

        {/* Footer */}
        <footer className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-t border-slate-200/80 dark:border-slate-800/80 py-4 text-center text-xs text-slate-500 dark:text-slate-400 transition-colors">
          GlimsTech AI Multi-Tenant Core SaaS • Forced PostgreSQL Row-Level Security • Real-time SSE Synchronization
        </footer>
      </body>
    </html>
  );
}
