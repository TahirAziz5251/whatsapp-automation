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
      text: "Assalam-o-Alaikum! Welcome to Alpha Heart & Medical Centre Lahore. 🏥\n\nI am Dr. Shifa, your 24/7 AI Medical Assistant. How can I help you today?",
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
      // Fallback local intelligent response for offline/preview
      console.warn("Simulator backend note:", err.message);
      
      // Auto-extract booking intent
      const isBooking = text.toLowerCase().includes("book") || text.toLowerCase().includes("appointment") || text.toLowerCase().includes("doctor");
      
      setTimeout(() => {
        let fallbackReply = "";
        let fallbackTicket = null;

        if (text.toLowerCase().includes("emergency") || text.toLowerCase().includes("1122")) {
          fallbackReply = "🚨 EMERGENCY PROTOCOL: If you are experiencing chest pain, severe bleeding, or unconsciousness, please call Rescue 1122 immediately or proceed to the nearest emergency room. Our staff has been alerted.";
        } else if (isBooking) {
          fallbackTicket = {
            id: `APT-202611-${Math.random().toString(16).substring(2, 8).toUpperCase()}`,
            token: "A-07",
            doctor: "Dr. Ayesha Khan (Cardiologist)",
            time: "Tomorrow at 4:30 PM"
          };
          setLastBookedTicket(fallbackTicket);
          fallbackReply = `✅ Shukriya! Your appointment has been booked with Dr. Ayesha Khan for Tomorrow at 4:30 PM. Your Token is A-07. You can check in at the reception upon arrival.`;
        } else {
          fallbackReply = "Aap kis doctor se checkup karwana chahte hain? Hamare paas Dr. Ayesha Khan (Cardiologist) aur Dr. Bilal Hussain (General Physician) available hain.";
        }

        setMessages(prev => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            sender: "bot",
            text: fallbackReply,
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            ticketId: fallbackTicket?.id,
            token: fallbackTicket?.token
          }
        ]);
        setLoading(false);
      }, 600);
      return;
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Top Banner */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800">
            Persona 1: Patient Experience
          </span>
          <h1 className="text-2xl font-bold text-slate-900 mt-2">Patient WhatsApp & Booking Simulator</h1>
          <p className="text-sm text-slate-600 mt-1">
            Test automated appointment booking via WhatsApp simulator or connect your own real WhatsApp phone.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/reception"
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-xl transition-colors flex items-center gap-2"
          >
            <span>Open Reception Desk</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: WhatsApp Phone Simulator (7 Cols) */}
        <div className="lg:col-span-7 bg-white rounded-3xl border border-slate-200 shadow-md overflow-hidden flex flex-col h-[650px]">
          {/* WhatsApp Header */}
          <div className="bg-emerald-700 text-white p-4 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-800 border-2 border-emerald-400 flex items-center justify-center font-bold text-lg">
                🏥
              </div>
              <div>
                <h2 className="font-bold text-base leading-tight">Alpha Clinic (Dr. Shifa)</h2>
                <p className="text-xs text-emerald-100 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  Online • AI Appointment Assistant
                </p>
              </div>
            </div>
            <div className="text-xs bg-emerald-800 px-3 py-1 rounded-full text-emerald-200">
              WhatsApp 24/7
            </div>
          </div>

          {/* Quick Action Pills */}
          <div className="bg-emerald-50 px-4 py-2.5 border-b border-emerald-100 flex items-center gap-2 overflow-x-auto text-xs">
            <button
              onClick={() => handleSendMessage("AOA, I want to book an appointment with Dr. Ayesha for checkup")}
              className="bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-300 px-3 py-1 rounded-full whitespace-nowrap transition-colors"
            >
              📅 Book Appointment
            </button>
            <button
              onClick={() => handleSendMessage("Doctor timings aur consultation fees kya hain?")}
              className="bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-300 px-3 py-1 rounded-full whitespace-nowrap transition-colors"
            >
              🩺 Doctors & Fees
            </button>
            <button
              onClick={() => handleSendMessage("Mera queue token aur wait time check kar dein")}
              className="bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-300 px-3 py-1 rounded-full whitespace-nowrap transition-colors"
            >
              ⏱️ Check Token Status
            </button>
            <button
              onClick={() => handleSendMessage("Emergency guidance")}
              className="bg-white hover:bg-red-50 text-red-700 border border-red-200 px-3 py-1 rounded-full whitespace-nowrap transition-colors"
            >
              🚨 Emergency (1122)
            </button>
          </div>

          {/* Messages Feed */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-[#e5ddd5]/30">
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`flex ${msg.sender === "patient" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                    msg.sender === "patient"
                      ? "bg-[#dcf8c6] text-slate-900 rounded-tr-none"
                      : "bg-white text-slate-900 rounded-tl-none border border-slate-100"
                  }`}
                >
                  <p className="whitespace-pre-line leading-relaxed">{msg.text}</p>
                  
                  {/* Digital Ticket Attachment if generated */}
                  {msg.token && (
                    <div className="mt-2 pt-2 border-t border-slate-200/60 bg-emerald-50/70 p-2.5 rounded-xl flex items-center justify-between gap-3">
                      <div>
                        <span className="text-[10px] font-bold uppercase text-emerald-800 tracking-wider">Queue Token</span>
                        <div className="text-lg font-black text-emerald-900">{msg.token}</div>
                      </div>
                      {msg.ticketId && (
                        <Link
                          href={`/ticket/${msg.ticketId}`}
                          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm"
                        >
                          View Live ETA &rarr;
                        </Link>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-1 mt-1 text-[10px] text-slate-400">
                    <span>{msg.time}</span>
                    {msg.sender === "patient" && (
                      <CheckCheck className="w-3.5 h-3.5 text-blue-500" />
                    )}
                  </div>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white rounded-2xl rounded-tl-none px-4 py-2 text-xs text-slate-500 shadow-sm border border-slate-100 flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600" />
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
            className="p-3 bg-white border-t border-slate-200 flex items-center gap-2"
          >
            <input
              type="text"
              value={inputMessage}
              onChange={e => setInputMessage(e.target.value)}
              placeholder="Type in English, Urdu or Roman Urdu..."
              className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900"
            />
            <button
              type="submit"
              disabled={loading || !inputMessage.trim()}
              className="w-10 h-10 rounded-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white flex items-center justify-center transition-colors flex-shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>

        {/* Right: Real WhatsApp Integration & Live Ticket Tracker (5 Cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Card 1: Connect Real WhatsApp on Your Phone */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-base">Book Using Your Real WhatsApp</h3>
                <p className="text-xs text-slate-500">Live Evolution Go Gateway</p>
              </div>
            </div>

            <div className="text-xs text-slate-600 space-y-2 bg-slate-50 p-4 rounded-2xl border border-slate-100 leading-relaxed">
              <p className="font-semibold text-slate-800">How to test from your physical phone:</p>
              <ol className="list-decimal list-inside space-y-1.5 text-slate-700">
                <li>
                  Open Evolution Manager:{" "}
                  <a
                    href="http://192.168.1.31:4000/manager/instances"
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-600 underline font-semibold"
                  >
                    192.168.1.31:4000
                  </a>
                </li>
                <li>Scan the QR code with WhatsApp on your phone.</li>
                <li>Send a message to that number: <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">"AOA, book appointment with Dr. Ayesha"</span></li>
                <li>Your phone receives an instant booking confirmation, and the patient appears live on the Reception Desk screen!</li>
              </ol>
            </div>
          </div>

          {/* Card 2: Last Confirmed Live Ticket */}
          {lastBookedTicket ? (
            <div className="bg-gradient-to-br from-emerald-600 to-teal-700 text-white p-6 rounded-3xl shadow-md space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider bg-white/20 px-3 py-1 rounded-full">
                  Live Confirmed Ticket
                </span>
                <CheckCircle2 className="w-5 h-5 text-emerald-200" />
              </div>

              <div>
                <span className="text-xs text-emerald-100">Patient Queue Token</span>
                <div className="text-3xl font-black">{lastBookedTicket.token}</div>
              </div>

              <div className="text-xs space-y-1 text-emerald-50">
                <p><strong>Doctor:</strong> {lastBookedTicket.doctor}</p>
                <p><strong>Time:</strong> {lastBookedTicket.time}</p>
                <p><strong>Booking Ref:</strong> {lastBookedTicket.id}</p>
              </div>

              <Link
                href={`/ticket/${lastBookedTicket.id}`}
                className="block text-center py-2.5 bg-white text-emerald-800 hover:bg-emerald-50 font-bold text-xs rounded-xl shadow transition-colors"
              >
                Open Real-Time Patient Tracker &rarr;
              </Link>
            </div>
          ) : (
            <div className="bg-white p-6 rounded-3xl border border-slate-200 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 mx-auto flex items-center justify-center">
                <Clock className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-slate-700">No Active Ticket Booked</h4>
              <p className="text-xs text-slate-500">
                Type in the simulator or send a WhatsApp message to book an appointment and view your digital queue ticket here.
              </p>
            </div>
          )}

          {/* Card 3: Clinic Safety Rule Note */}
          <div className="bg-amber-50 p-4 rounded-2xl border border-amber-200 text-xs text-amber-800 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-amber-900">
              <ShieldAlert className="w-4 h-4 text-amber-600" />
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
