"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { 
  Send, 
  Smartphone, 
  CheckCheck, 
  Bot, 
  User, 
  Clock, 
  Calendar, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  QrCode, 
  ArrowRight, 
  ShieldAlert, 
  Stethoscope 
} from "lucide-react";
import { clinicApi, DEFAULT_TENANT_ID } from "@/lib/api";

interface ChatMessage {
  id: string;
  sender: "patient" | "bot";
  text: string;
  time: string;
  ticketId?: string;
  token?: string;
}

export default function PatientSimulatorPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "1",
      sender: "bot",
      text: "Assalam-o-Alaikum! Welcome to Alpha Heart & Medical Centre Lahore. 🏥\n\nI am Dr. Shifa, your 24/7 GlimsTech AI Medical Assistant. How can I help you today?",
      time: "Just now"
    }
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastBookedTicket, setLastBookedTicket] = useState<{ id: string; token: string; doctor: string; time: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async (textToSend?: string) => {
    const text = textToSend || inputMessage;
    if (!text.trim() || loading) return;

    const userMsgId = Date.now().toString();
    const currentTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    // 1. Append user message
    setMessages(prev => [
      ...prev,
      { id: userMsgId, sender: "patient", text, time: currentTime }
    ]);
    if (!textToSend) setInputMessage("");
    setLoading(true);

    try {
      // 2. Call backend evolution simulator
      const res = await clinicApi.sendSimulatedWhatsApp({
        tenant_id: DEFAULT_TENANT_ID,
        instance: "alpha-clinic-bot",
        phone: "923001234567",
        message: text,
        push_name: "Patient Demo"
      });

      const replyText = res?.reply || res?.message || "Your request has been received by our clinic scheduling system.";
      
      // Check if ticket was created in response
      let newTicket = null;
      if (res?.appointment_id || res?.ticket_number) {
        newTicket = {
          id: res.appointment_id || "APT-DEMO",
          token: res.token || res.ticket_number || "A-01",
          doctor: res.doctor_name || "Dr. Ayesha Khan",
          time: res.slot_time || "4:30 PM"
        };
        setLastBookedTicket(newTicket);
      }

      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: "bot",
          text: replyText,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          ticketId: newTicket?.id,
          token: newTicket?.token
        }
      ]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: "bot",
          text: "I am having trouble reaching the clinic scheduling database right now. Please try again shortly or contact reception directly.",
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="py-4 sm:py-6 max-w-6xl mx-auto space-y-8">
      {/* Top Banner (3D Card) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl p-6 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 shadow-xl dark:shadow-slate-950/50">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Patient WhatsApp Booking & Live Queue Simulator
            </h1>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300/40 dark:border-emerald-700/50">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Live Bot Active
            </span>
          </div>
          <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            Simulate patient conversations in English, Urdu, or Roman Urdu, or connect your physical WhatsApp phone via Evolution Go.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href="/reception"
            className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all"
          >
            Check Reception Queue &rarr;
          </Link>
        </div>
      </div>

      {/* Main Grid: WhatsApp Phone Frame (Left) + Testing Instructions & Live Token (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Interactive WhatsApp Device (7 Cols) */}
        <div className="lg:col-span-7 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl rounded-3xl border border-slate-200/90 dark:border-slate-800/90 shadow-2xl dark:shadow-slate-950/60 overflow-hidden flex flex-col h-[650px]">
          {/* Phone WhatsApp Header */}
          <div className="bg-gradient-to-r from-emerald-700 via-teal-700 to-emerald-800 text-white p-4 flex items-center justify-between shadow-md">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center font-bold text-base border border-white/30">
                  <Bot className="w-5 h-5 text-emerald-100" />
                </div>
                <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-400 border-2 border-emerald-800" />
              </div>
              <div>
                <h3 className="text-sm font-bold leading-tight flex items-center gap-1.5">
                  Dr. Shifa (Alpha Clinic AI)
                  <span className="text-[10px] bg-emerald-600/80 px-1.5 py-0.2 rounded text-emerald-100 font-normal">Official</span>
                </h3>
                <p className="text-[11px] text-emerald-200">GlimsTech AI OPD Scheduling Assistant</p>
              </div>
            </div>

            <div className="text-right">
              <span className="text-[10px] text-emerald-200 font-mono">0300-1234567</span>
            </div>
          </div>

          {/* Quick Action Suggested Prompts */}
          <div className="p-2.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 overflow-x-auto text-xs font-semibold">
            <span className="text-slate-400 dark:text-slate-500 text-[11px] uppercase tracking-wider pl-1">Prompts:</span>
            <button
              onClick={() => handleSendMessage("Assalam-o-Alaikum, mujhe kal shaam ke liye Dr. Ayesha se appointment chahiye")}
              className="bg-white dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-slate-700 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-3 py-1 rounded-full whitespace-nowrap transition-colors shadow-xs"
            >
              📅 Book Appointment
            </button>
            <button
              onClick={() => handleSendMessage("Doctor timings aur consultation fees kya hain?")}
              className="bg-white dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-slate-700 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-3 py-1 rounded-full whitespace-nowrap transition-colors shadow-xs"
            >
              🩺 Doctors & Fees
            </button>
            <button
              onClick={() => handleSendMessage("Mera queue token aur wait time check kar dein")}
              className="bg-white dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-slate-700 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-3 py-1 rounded-full whitespace-nowrap transition-colors shadow-xs"
            >
              ⏱️ Check Token Status
            </button>
            <button
              onClick={() => handleSendMessage("Emergency guidance")}
              className="bg-white dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-950/40 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900/60 px-3 py-1 rounded-full whitespace-nowrap transition-colors shadow-xs"
            >
              🚨 Emergency (1122)
            </button>
          </div>

          {/* Messages Feed */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-100/70 dark:bg-slate-950/80">
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`flex ${msg.sender === "patient" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-md ${
                    msg.sender === "patient"
                      ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-tr-none shadow-emerald-950/20"
                      : "bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-tl-none border border-slate-200/80 dark:border-slate-700/80 shadow-slate-950/10"
                  }`}
                >
                  <p className="whitespace-pre-line leading-relaxed">{msg.text}</p>
                  
                  {/* Digital Ticket Attachment if generated */}
                  {msg.token && (
                    <div className="mt-2.5 pt-2 border-t border-slate-200/60 dark:border-slate-700/60 bg-emerald-50/80 dark:bg-emerald-950/60 p-3 rounded-xl flex items-center justify-between gap-3 text-slate-900 dark:text-white border border-emerald-200 dark:border-emerald-800/60">
                      <div>
                        <span className="text-[10px] font-bold uppercase text-emerald-800 dark:text-emerald-300 tracking-wider">Queue Token</span>
                        <div className="text-xl font-black text-emerald-900 dark:text-emerald-200 font-mono">{msg.token}</div>
                      </div>
                      {msg.ticketId && (
                        <Link
                          href={`/ticket/${msg.ticketId}`}
                          className="px-3.5 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-lg shadow-md transition-all"
                        >
                          View Live ETA &rarr;
                        </Link>
                      )}
                    </div>
                  )}

                  <div className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${msg.sender === "patient" ? "text-emerald-200" : "text-slate-400 dark:text-slate-500"}`}>
                    <span>{msg.time}</span>
                    {msg.sender === "patient" && (
                      <CheckCheck className="w-3.5 h-3.5 text-emerald-200" />
                    )}
                  </div>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white dark:bg-slate-800 rounded-2xl rounded-tl-none px-4 py-2 text-xs text-slate-500 dark:text-slate-400 shadow-sm border border-slate-200 dark:border-slate-700 flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600 dark:text-emerald-400" />
                  Dr. Shifa is typing...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Message Input Bar */}
          <form
            onSubmit={e => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2"
          >
            <input
              type="text"
              value={inputMessage}
              onChange={e => setInputMessage(e.target.value)}
              placeholder="Type in English, Urdu or Roman Urdu..."
              className="flex-1 px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-white"
            />
            <button
              type="submit"
              disabled={loading || !inputMessage.trim()}
              className="w-10 h-10 rounded-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white flex items-center justify-center transition-all shadow-md shadow-emerald-600/30 shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>

        {/* Right: Real WhatsApp Integration & Live Ticket Tracker (5 Cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Card 1: Connect Real WhatsApp on Your Phone (3D Card) */}
          <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl p-6 rounded-3xl border border-slate-200/90 dark:border-slate-800/90 shadow-xl dark:shadow-slate-950/50 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shadow-md shadow-emerald-500/25">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-base">Book Using Your Real WhatsApp</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Live Evolution Go Gateway</p>
              </div>
            </div>

            <div className="text-xs text-slate-600 dark:text-slate-300 space-y-2 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 leading-relaxed">
              <p className="font-bold text-slate-800 dark:text-slate-200">How to test from your physical phone:</p>
              <ol className="list-decimal list-inside space-y-2 text-slate-700 dark:text-slate-300">
                <li>
                  Open Evolution Manager:{" "}
                  <a
                    href="http://192.168.1.31:4000/manager/instances"
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-600 dark:text-emerald-400 underline font-semibold"
                  >
                    192.168.1.31:4000
                  </a>
                </li>
                <li>Enter API Key: <code className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 font-mono text-[11px]">63558bce77...</code> (or compose default)</li>
                <li>Scan the QR code with WhatsApp on your phone.</li>
                <li>Send a message from your phone: <span className="font-mono bg-white dark:bg-slate-900 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white">"AOA, book appointment with Dr. Ayesha"</span></li>
                <li>Your phone receives an instant booking confirmation, and the patient appears live on the Reception Desk screen!</li>
              </ol>
            </div>
          </div>

          {/* Card 2: Last Confirmed Live Ticket (3D Card) */}
          {lastBookedTicket ? (
            <div className="bg-gradient-to-br from-emerald-600 via-teal-700 to-slate-900 text-white p-6 rounded-3xl shadow-2xl shadow-emerald-950/40 border border-emerald-400/20 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider bg-white/20 px-3 py-1 rounded-full">
                  Live Confirmed Ticket
                </span>
                <CheckCircle2 className="w-5 h-5 text-emerald-300" />
              </div>

              <div>
                <span className="text-xs text-emerald-200 font-semibold">Patient Queue Token</span>
                <div className="text-4xl font-black font-mono tracking-tight">{lastBookedTicket.token}</div>
              </div>

              <div className="text-xs space-y-1.5 text-emerald-100 font-medium">
                <p><strong>Doctor:</strong> {lastBookedTicket.doctor}</p>
                <p><strong>Time:</strong> {lastBookedTicket.time}</p>
                <p><strong>Booking Ref:</strong> {lastBookedTicket.id}</p>
              </div>

              <Link
                href={`/ticket/${lastBookedTicket.id}`}
                className="block text-center py-2.5 bg-white text-emerald-900 hover:bg-emerald-50 font-bold text-xs rounded-xl shadow-lg transition-all"
              >
                Open Real-Time Patient Tracker &rarr;
              </Link>
            </div>
          ) : (
            <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl p-6 rounded-3xl border border-slate-200/90 dark:border-slate-800/90 shadow-xl dark:shadow-slate-950/50 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 mx-auto flex items-center justify-center">
                <Clock className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200">No Active Ticket Booked</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Type in the simulator or send a WhatsApp message to book an appointment and view your digital queue ticket here.
              </p>
            </div>
          )}

          {/* Card 3: Clinic Safety Rule Note */}
          <div className="bg-amber-50/80 dark:bg-amber-950/40 p-4 rounded-2xl border border-amber-200/80 dark:border-amber-800/60 text-xs text-amber-800 dark:text-amber-300 space-y-1 shadow-sm">
            <div className="flex items-center gap-1.5 font-bold text-amber-900 dark:text-amber-200">
              <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span>Safety & Triage Safeguard</span>
            </div>
            <p className="text-[11px] leading-relaxed">
              Dr. Shifa is an AI scheduling assistant, not an EMR or diagnostic tool. She never prescribes medicine or diagnoses conditions. Medical emergencies immediately redirect to Rescue 1122.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
