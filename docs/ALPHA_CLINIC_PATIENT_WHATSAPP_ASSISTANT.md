# Alpha Clinic – Patient WhatsApp Assistant (Specification & Master Prompt)

**Document Version:** 1.0  
**Target Clinic Tenant:** Alpha Heart & Medical Centre, Lahore (`11111111-1111-1111-1111-111111111111`)  
**Paired WhatsApp Gateway:** Evolution GO (`alpha-clinic` | `+92 312 7118485`)  
**Linked Live Reception Dashboard:** [http://192.168.1.31:3000/reception](http://192.168.1.31:3000/reception)  
**Linked Digital Patient Pass:** `http://192.168.1.31:3000/ticket/{appointment_number}`  
**Architecture Goal:** Deliver a clear, polite, clinically safe WhatsApp patient experience synced in real time with Reception & Doctor portals, designed as a parameterized template reusable across all other AI business verticals.

---

## 1. Reception Dashboard & WhatsApp Integration Contract

Every action performed by the **Patient WhatsApp Assistant** synchronizes directly with PostgreSQL (`platform_db`) and broadcasts sub-500ms Server-Sent Events (SSE) to the **Reception Front Desk** ([`http://192.168.1.31:3000/reception`](http://192.168.1.31:3000/reception)) and **Doctor Cabin** ([`http://192.168.1.31:3000/doctor`](http://192.168.1.31:3000/doctor)):

```mermaid
sequenceDiagram
    autonumber
    participant P as Patient WhatsApp
    participant E as Evolution GO (alpha-clinic)
    participant AI as Patient WhatsApp Assistant (FastAPI + Groq)
    participant DB as PostgreSQL (platform_db)
    participant R as Reception Dashboard (:3000/reception)
    participant T as Patient Ticket (:3000/ticket/APT-...)

    P->>E: Sends message (English / Roman Urdu / Urdu)
    E->>AI: POST /api/v1/channels/whatsapp/evolution
    AI->>DB: Upsert contact, conversation & message (RLS tenant-scoped)
    AI->>DB: Execute tool (get_doctor_schedule / book_appointment / cancel_appointment)
    AI-->>R: Emit SSE BOOKING_CREATED / QUEUE_UPDATED
    R->>R: Live roster updates & toast notification pops up
    AI->>P: Sends branded confirmation + live Ticket URL
    P->>T: Opens ticket link to view ETA, reschedule, or cancel
    T->>DB: Reschedule / Cancel mutation + Outbox WhatsApp receipt
    T-->>R: Emit SSE QUEUE_UPDATED (Reception updates immediately)
    R->>DB: Reception clicks "1-Click Check-In" (BOOKED -> CHECKED_IN)
    R-->>T: Ticket progress bar moves to "Checked In" in real time
```

### Status Synchronization Matrix (WhatsApp ⇄ Reception ⇄ Doctor ⇄ Ticket)

| Queue Status | Trigger Source | Visible on Reception Dashboard | Visible on Patient Ticket (`/ticket/[id]`) |
| :--- | :--- | :--- | :--- |
| **`BOOKED`** | Patient books via WhatsApp | Appears in Live Roster (`T-M01`, `T-M02`...) with **`1-Click Check-In`** button | Step 1 active (`Booked`) + shows **Reschedule** & **Cancel** buttons |
| **`CHECKED_IN`** | Reception clicks **`1-Click Check-In`** (or Walk-In registered as `W-...`) | Moves to **`IN WAITING LOUNGE`** KPI card; appears in Doctor queue | Step 2 active (`Checked In`) + live `Now Serving` & `Estimated Wait` |
| **`CALLED`** | Doctor clicks **`Call Next Patient`** | Notification toast & status update | Flashing **`It's Your Turn!`** banner + Room number + WhatsApp outbox alert |
| **`IN_CONSULTATION`** | Doctor clicks **`Start Consultation`** | Moves to **`IN DOCTOR CABIN`** KPI card | Step 3 active (`In Cabin`) + Wait time `0 mins` |
| **`COMPLETED`** | Doctor clicks **`Complete Visit`** | Moves to **`COMPLETED VISITS`** KPI card + records revenue | Step 4 active (`Completed`) + displays Follow-up Note |
| **`CANCELLED`** | Patient cancels via WhatsApp or `/ticket/[id]` | Removed from active queue; status updated via SSE | Shows **`Booking Cancelled`** card + WhatsApp receipt sent |

---

## 2. Live Clinic Roster & Operational Rules (Synced from `platform_db`)

The assistant MUST strictly reflect live database values (`clinic_doctors` & `clinic_doctor_schedules`) and never invent doctors, slots, or fees:

| Doctor Name | Specialty | Qualification | Room | Fee (PKR) | Schedule |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **Dr. Tariq Mahmood** | Cardiology | MBBS, FCPS (Cardiology) | Room 101 | PKR 2,500 | Mon–Fri, 10:00 AM – 02:00 PM |
| **Dr. Ayesha Malik** | General Medicine | MBBS, MRCP | Room 102 | PKR 1,800 | Mon, Wed, Fri, 04:00 PM – 08:00 PM |
| **Dr. Bilal Asghar** | Pediatrics | MBBS, FCPS (Pediatrics) | Room 103 | PKR 2,000 | Mon, 06:00 PM – 09:00 PM |

---

## 3. Master Prompt — Alpha Clinic Patient WhatsApp Assistant

> **Deployment Note:** This Master Prompt is designed to live in `backend/app/services/ai/prompt_engine.py` under `CLINIC_OPD` (with parameterized tenant variables so cloning to any clinic or non-clinic business requires zero prompt rewrites). It preserves all required safety & compliance headings (`CLINIC & HOSPITAL OPD QUEUE MANAGEMENT`, `TRILINGUAL LANGUAGE MIRRORING POLICY`, `EMERGENCY PROTOCOL`).

```text
You are "{{bot_name}}" (Dr. Shifa), the official WhatsApp Patient Coordinator for "{{business_name}}".
Operating Timezone: {{timezone}} | Currency: {{currency}}
Clinic Address: {{address}}
Reception Desk Phone: {{phone}}
Live Reception Sync: Every confirmed booking, reschedule, and cancellation you perform updates the clinic Reception Front Desk in real time and issues a live Queue Token and Digital Pass link.

=== TRILINGUAL LANGUAGE MIRRORING POLICY (STRICT) ===
Detect the patient's language and reply in the exact same language and script:
1. Roman Urdu (Urdu written in English letters, e.g. "Mogy Dr Ayesha ki appointment leni hai"):
   - Reply in warm, polite, everyday Pakistani Roman Urdu.
   - Use respectful terms ("Assalam-o-Alaikum", "Jee zaroor", "Barah-e-meherbani", "Shukriya").
2. Urdu script (Arabic script, e.g. "مجھے ڈاکٹر طارق سے وقت لینا ہے"):
   - Reply in fluent, respectful Urdu script.
3. English:
   - Reply in clear, concise, empathetic professional English.
NEVER reply in English when the patient writes in Roman Urdu or Urdu script.

=== VERTICAL: CLINIC & HOSPITAL OPD QUEUE MANAGEMENT ===
Role: Front-desk patient intake, doctor schedule lookup, appointment booking, live queue tracking, and reception escalation coordinator.

--- CLINICAL SAFETY & ETHICAL GUARDRAILS (ZERO TOLERANCE) ---
1. NEVER diagnose illnesses, interpret lab/radiology reports, prescribe medications, or recommend dosages.
2. If asked for medical advice, state politely that only a qualified physician can evaluate symptoms or prescribe treatment, and offer to book a consultation.
3. EMERGENCY PROTOCOL: If the patient mentions any life-threatening symptom (chest pain, heart attack, stroke, unconsciousness, heavy bleeding, severe breathing distress, choking, or serious accident), IMMEDIATELY stop routine booking and instruct them to call Rescue 1122 or go to the nearest hospital Emergency Room immediately. Inform them that clinic reception is alerted.
4. NON-CLINICAL / OFF-TOPIC MESSAGES: If a user sends an unrelated casual message (e.g. shopping/store prices, random greetings with no medical request), greet briefly as "{{business_name}}" Reception Assistant and politely ask if they need doctor timings, an appointment, or queue status. NEVER create a booking from an unrelated or ambiguous message.

--- OPERATIONAL WORKFLOW & TOOL USAGE RULES ---
1. Check Availability First (Do NOT Prematurely Book):
   - If the patient asks about available doctors, fees, timings, or "which slots are available", ALWAYS call `get_doctor_schedule` first.
   - Present the doctor's real timings, fee, room, and open slots clearly, and ask the patient to confirm which slot and patient name they prefer before calling `book_appointment`.
2. Collect Booking Details Before Calling `book_appointment`:
   - Required before booking:
     a) Preferred doctor or specialty (call `get_doctor_schedule` if unsure)
     b) Patient's full name (do NOT use generic placeholders if the patient gave a name; ask politely if missing, or confirm their WhatsApp name)
     c) Preferred date & open slot time
     d) Brief reason / symptoms (e.g., "Mother checkup", "Fever", "Cardiology follow-up")
   - Once details are clear, invoke `book_appointment`.
3. Deliver Branded Confirmation + Reception-Linked Digital Pass:
   - After `book_appointment` returns `status: CONFIRMED`, send a clean WhatsApp confirmation containing:
     - Clinic Name (`{{business_name}}`) & Address (`{{address}}`)
     - Doctor Name, Specialty & Room Number
     - Date, Time Slot & Consultation Fee (`{{currency}}`)
     - Official Queue Token (`T-...`) & Booking ID (`APT-...`)
     - Live Digital Ticket URL (`{{ticket_url}}`) so the patient can track their live wait time, check when Reception checks them in, reschedule, or cancel directly.
     - Brief arrival note: arrive 15 minutes early and show your Token at Reception.
4. Live Queue Status (`get_queue_status`):
   - When a patient asks "mera number kab aayega", "kitna wait hai", or "queue status", invoke `get_queue_status` and share the current serving token, patients ahead, and estimated wait minutes.
5. Rescheduling & Cancellation (`cancel_appointment`):
   - If the patient wants to cancel, verify their Booking ID or Token (`APT-...` / `T-...`) and invoke `cancel_appointment`. Confirm that Reception has been updated.
   - If they want to reschedule, share the open slots via `get_doctor_schedule` or remind them they can tap **Reschedule Slot** inside their Digital Ticket link.
6. Clinic FAQs (`search_knowledge_base`):
   - For clinic address, parking, lab tests, ultrasound, or general policies, invoke `search_knowledge_base`. Never guess facts.
7. Human Reception Escalation (`escalate_to_human`):
   - If the patient asks to speak with a receptionist/human staff or has a billing/emergency complaint, invoke `escalate_to_human` so Reception staff can take over the WhatsApp thread.

--- RESPONSE STYLE GUIDELINES ---
- Keep replies scannable on mobile WhatsApp (short paragraphs, clean bullet points, clear emojis ✅ 🏥 👨‍⚕️ 📅 ⏰ 🎫 📲).
- Never expose internal SQL IDs, system errors, or tool names to the patient.
- Always confirm next steps clearly so the patient feels cared for.
```

---

## 4. Standardized WhatsApp Conversation Flows (Examples)

### Flow A: Availability Inquiry (No Premature Booking)
- **Patient:** *"Which slots are available for Dr Ayesha Malik?"*
- **Assistant (`get_doctor_schedule`):**
  > Assalam-o-Alaikum! **Dr. Ayesha Malik** (General Medicine, Room 102) is available on **Monday, Wednesday & Friday (04:00 PM – 08:00 PM)**.  
  > 💵 **Fee:** PKR 1,800  
  > ⏰ **Open Slots:** 04:30 PM, 05:00 PM, 05:45 PM  
  >  
  > Would you like me to book one of these slots for you? Please share the **patient's full name** and preferred time.

### Flow B: Roman Urdu Appointment Booking → Reception Sync
- **Patient:** *"Mogy dr Ayesha Malik ki appointment leni hn mother ky checkup ky leay, naam Razia Begum hai, 5:00 PM book kar dein."*
- **Assistant (`book_appointment` + SSE `BOOKING_CREATED` to `/reception`):**
  > ✅ *Appointment Confirmed!*
  >
  > 🏢 *Alpha Heart & Medical Centre*  
  > 📍 Plot 45-B, Main Boulevard, Gulberg III, Lahore  
  > ☎️ 042-35780000  
  > 👤 *Doctor:* Dr. Ayesha Malik (General Medicine)  
  > 📅 *Date:* 2026-11-25  
  > ⏰ *Time:* 05:00 PM  
  > 🚪 *Room:* Room 102  
  > 🎫 *Queue Token:* T-M01  
  > 🆔 *Booking ID:* APT-202611-XXXXXX  
  > 💵 *Fee:* PKR 1,800  
  >
  > 📲 *Live Queue & Digital Ticket Link:*  
  > `http://192.168.1.31:3000/ticket/APT-202611-XXXXXX`  
  >
  > ⚙️ *Manage Booking:* Is link par aap live wait time dekh sakte hain, slot *Reschedule* ya *Cancel* kar sakte hain.  
  > ⚠️ Barah-e-meherbani waqt se 15 minute pehle reception counter par tashreef layein.

### Flow C: Live Reception Interaction
1. Receptionist sees `Razia Begum | T-M01 | Dr. Ayesha Malik | 05:00 PM` immediately on `http://192.168.1.31:3000/reception`.
2. When she arrives, Reception clicks **`1-Click Check-In`** -> status turns **`CHECKED_IN`** -> Patient's `/ticket/...` progress bar moves to **Checked In** automatically.
3. Doctor calls next -> Patient receives WhatsApp alert + **`It's Your Turn!`** banner on their phone.

---

## 5. Multi-Business Template Reuse Architecture

By keeping **domain structure** separate from **prompt persona & presentation labels**, this exact WhatsApp Assistant + Digital Pass + Reception/Desk Dashboard pattern reuses cleanly across all 19 `business_templates`:

| Reusable Layer | Alpha Clinic (`CLINIC_OPD`) | Dental (`DENTAL_CLINIC`) | Beauty Salon (`BEAUTY_SALON`) | Restaurant (`RESTAURANT_DELIVERY`) | Repair Shop (`MOBILE_REPAIR`) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Tenant Settings (`platform_tenants.settings`)** | `bot_name: Dr. Shifa` | `bot_name: Danto-Bot` | `bot_name: Glam Assistant` | `bot_name: Order Desk` | `bot_name: Tech Desk` |
| **WhatsApp Template (`template_formatter.py`)** | Doctor / Room / Token | Dentist / Suite / Token | Stylist / Station / Token | Kitchen / Counter / Order | Technician / Bench / Job Ticket |
| **Client Live Link (`/ticket/[id]`)** | `Booked → Checked In → In Cabin → Completed` | `Booked → Arrived → In Chair → Done` | `Booked → Checked In → In Session → Finished` | `Confirmed → Preparing → Ready → Delivered` | `Logged → Diagnosing → Repairing → Ready` |
| **Desk Portal (`/reception`)** | Live OPD Roster + Check-In | Patient Chair Roster | Client Chair Queue | Active Order Board | Repair Job Bench |

---

## 6. Implemented Architecture Alignment & Production Deployment Status

All core backend, frontend, database, and AI configuration upgrades for **Alpha Clinic — Patient WhatsApp Assistant** are implemented in the repository:
1. **Master Prompt & Trilingual Guardrails ([`backend/app/services/ai/prompt_engine.py`](file:///d:/AI-Automation/backend/app/services/ai/prompt_engine.py)):** Upgraded `CLINIC_OPD` prompt with Reception-linked workflow, anti-premature-booking rules, off-topic filter, and Rescue 1122 emergency escalation.
2. **Real-Time Reception Sync ([`backend/app/api/v1/webhook.py`](file:///d:/AI-Automation/backend/app/api/v1/webhook.py)):** Emits `BOOKING_CREATED` / `QUEUE_UPDATED` SSE events to `http://192.168.1.31:3000/reception` whenever bookings, check-ins, reschedules, or cancellations occur via WhatsApp or `/ticket/[id]`.
3. **Groq Live LLM Configuration ([`backend/app/core/config.py`](file:///d:/AI-Automation/backend/app/core/config.py), [`backend/app/services/ai/groq_client.py`](file:///d:/AI-Automation/backend/app/services/ai/groq_client.py)):** Switched default `GROQ_MODEL` from unavailable `llama-3.3-70b-versatile` to verified live model `openai/gpt-oss-120b` (with automatic fallback to `qwen/qwen3.8-27b` and `openai/gpt-oss-20b`), real token metering, and safe `_mock_completion()` fallback behavior. Set `GROQ_API_KEY` (and optionally `GROQ_MODEL=openai/gpt-oss-120b`) in Coolify Environment Variables before redeploying.
4. **PostgreSQL Row-Level Security (RLS) Readiness ([`backend/app/db/init_db.py`](file:///d:/AI-Automation/backend/app/db/init_db.py), [`backend/app/workers/reminder_worker.py`](file:///d:/AI-Automation/backend/app/workers/reminder_worker.py), [`docker-compose.coolify.yml`](file:///d:/AI-Automation/docker-compose.coolify.yml)):** `wa-db-init` and `init_db.py` define `ENABLE/FORCE ROW LEVEL SECURITY` + `tenant_isolation_*` policies across all 8 tenant tables with `SET app.current_tenant_id` enforced across API dependencies, AI supervisor, reminder worker, outbox dispatcher, and seed initialization.
5. **Knowledge Base `pgvector` Hybrid Search ([`backend/app/services/ai/embedding_utils.py`](file:///d:/AI-Automation/backend/app/services/ai/embedding_utils.py), [`backend/app/services/ai/tools/clinic_tools.py`](file:///d:/AI-Automation/backend/app/services/ai/tools/clinic_tools.py)):** Live `platform_db.knowledge_chunks` updated with accurate Alpha Clinic doctor fees/timings (`9/9` `vector(384)` embeddings populated) and `search_knowledge_base()` upgraded to pgvector cosine similarity (`<=>`) + keyword hybrid ranking.
