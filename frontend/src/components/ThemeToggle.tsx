"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

export default function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Check initial document state or localStorage
    const savedTheme = localStorage.getItem("theme");
    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    
    if (savedTheme === "dark" || (!savedTheme && systemPrefersDark)) {
      document.documentElement.classList.add("dark");
      setIsDark(true);
    } else {
      document.documentElement.classList.remove("dark");
      setIsDark(false);
    }
  }, []);

  const toggleTheme = () => {
    const nextDark = !isDark;
    setIsDark(nextDark);
    if (nextDark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  };

  // Render placeholder before mount to avoid SSR hydration mismatch
  if (!mounted) {
    return (
      <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 animate-pulse" />
    );
  }

  return (
    <button
      onClick={toggleTheme}
      type="button"
      aria-label="Toggle Light and Dark Mode"
      title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
      className="relative group p-2 rounded-xl bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 shadow-md hover:shadow-lg dark:shadow-slate-950/40 transition-all duration-300 transform hover:scale-105 active:scale-95 flex items-center justify-center backdrop-blur-md"
    >
      <div className="relative w-5 h-5 flex items-center justify-center">
        {isDark ? (
          <Sun className="w-5 h-5 text-amber-400 group-hover:rotate-45 transition-transform duration-300 drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
        ) : (
          <Moon className="w-5 h-5 text-indigo-600 group-hover:-rotate-12 transition-transform duration-300 drop-shadow-[0_0_8px_rgba(99,102,241,0.4)]" />
        )}
      </div>
      <span className="sr-only">Toggle theme</span>
    </button>
  );
}
