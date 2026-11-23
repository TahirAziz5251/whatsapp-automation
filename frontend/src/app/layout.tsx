import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import { Activity, Stethoscope, UserCheck, MessageSquare, ShieldCheck } from "lucide-react";

export const metadata: Metadata = {
  title: "BizFlow AI — Clinic OPD & Operations Portal",
  description: "Next.js 14+ Multi-Tenant Real-Time Clinic Operations Dashboards",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
        {/* Top Operational Bar */}
        <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-xl shadow-sm">
                B
              </div>
              <div>
                <span className="font-bold text-lg text-slate-900 flex items-center gap-2">
                  BizFlow AI <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-medium">Clinic Pilot</span>
                </span>
                <p className="text-xs text-slate-500">Alpha Clinic & Diagnostic Centre (PK-Lahore)</p>
              </div>
            </div>

            <nav className="flex items-center gap-1 sm:gap-2">
              <Link
                href="/reception"
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-emerald-700 flex items-center gap-1.5 transition-colors"
              >
                <UserCheck className="w-4 h-4 text-emerald-600" />
                <span className="hidden sm:inline">Reception</span>
              </Link>
              <Link
                href="/doctor"
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-blue-700 flex items-center gap-1.5 transition-colors"
              >
                <Stethoscope className="w-4 h-4 text-blue-600" />
                <span className="hidden sm:inline">Doctor</span>
              </Link>
              <Link
                href="/ticket/APT-202611-7B17E6"
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-purple-700 flex items-center gap-1.5 transition-colors"
              >
                <Activity className="w-4 h-4 text-purple-600" />
                <span className="hidden sm:inline">Patient Live Link</span>
              </Link>
            </nav>
          </div>
        </header>

        {/* Main View */}
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>

        {/* Footer */}
        <footer className="bg-white border-t border-slate-200 py-4 text-center text-xs text-slate-500">
          BizFlow AI Multi-Tenant Core SaaS • Forced PostgreSQL Row-Level Security • Real-time SSE Synchronization
        </footer>
      </body>
    </html>
  );
}
