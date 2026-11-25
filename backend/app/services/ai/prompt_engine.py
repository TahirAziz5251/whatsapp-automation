import re
from typing import Dict, Any, Optional
from app.models.tenant import PlatformTenant, BusinessTemplate

# Grammatical and conversational particles distinct to Roman Urdu
ROMAN_URDU_GRAMMAR_PARTICLES = {
    "kya", "hai", "hain", "karein", "karna", "kare", "karo", "bataein", "batao",
    "shukriya", "shukria", "mujhe", "mera", "meri", "mere", "kab", "subah", "shaam",
    "dopahar", "saab", "sahib", "aap", "apka", "apki", "apke", "kitne", "kitna",
    "waqt", "chahiye", "theek", "acha", "achha", "bhejein", "pesh", "mariz", "bimar",
    "bukhar", "dard", "dawa", "ilaaj", "parchi", "namber", "kal", "aaj", "parson",
    "jana", "aana", "mil", "sakta", "sakti", "sakte", "konsa", "konsi", "kitni",
    "karwana", "khali", "wala", "wali", "wale", "kahan", "jagah", "paise", "hoga", "hogi"
}

# Broader vocabulary (loanwords / shared terms)
ROMAN_URDU_VOCAB = ROMAN_URDU_GRAMMAR_PARTICLES | {
    "doctor", "dr", "clinic", "hospital", "fees", "token", "appointment", "checkup", "slot"
}

def detect_language_and_script(text: str) -> Dict[str, Any]:
    """
    Detects language and script of incoming user text.
    Returns:
        {
            "language": "URDU" | "ROMAN_URDU" | "ENGLISH",
            "script": "ARABIC" | "LATIN",
            "confidence": float
        }
    """
    if not text or not text.strip():
        return {"language": "ENGLISH", "script": "LATIN", "confidence": 1.0}

    # 1. Check for Arabic/Urdu Unicode script (\u0600-\u06FF, \u0750-\u077F, \uFB50-\uFDFF)
    arabic_chars = len(re.findall(r'[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]', text))
    total_alpha = len(re.findall(r'[a-zA-Z\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]', text))

    if total_alpha > 0 and (arabic_chars / total_alpha) > 0.35:
        return {
            "language": "URDU",
            "script": "ARABIC",
            "confidence": round(arabic_chars / total_alpha, 2)
        }

    # 2. Check for Roman Urdu (Requires at least one genuine grammatical particle)
    tokens = [t.lower() for t in re.findall(r'[a-zA-Z]{2,}', text)]
    if not tokens:
        return {"language": "ENGLISH", "script": "LATIN", "confidence": 0.5}

    grammar_matches = [t for t in tokens if t in ROMAN_URDU_GRAMMAR_PARTICLES]
    vocab_matches = [t for t in tokens if t in ROMAN_URDU_VOCAB]

    # Only classify as Roman Urdu if genuine Urdu grammatical particles are present
    if len(grammar_matches) >= 1 and (len(vocab_matches) >= 2 or (len(vocab_matches) / len(tokens)) >= 0.20):
        confidence = min(0.99, max(0.65, (len(vocab_matches) / len(tokens)) * 1.5))
        return {
            "language": "ROMAN_URDU",
            "script": "LATIN",
            "confidence": round(confidence, 2)
        }

    # 3. Default fallback: English
    return {
        "language": "ENGLISH",
        "script": "LATIN",
        "confidence": 0.90
    }


def build_system_prompt(tenant: PlatformTenant, template: Optional[BusinessTemplate] = None) -> str:
    """
    Builds the tenant-scoped trilingual system prompt with dynamic tenant persona,
    branding, business rules, and contact information.
    Adheres strictly to the Pakistan-first trilingual requirements:
    - English
    - Urdu (Arabic script)
    - Roman Urdu (Latin script)
    """
    template_id = tenant.business_template_id
    business_name = tenant.name
    timezone = tenant.timezone or "Asia/Karachi"
    currency = tenant.currency or "PKR"

    # Extract dynamic tenant-specific settings and persona
    settings = tenant.settings or {}
    bot_name = settings.get("bot_name", "AI Assistant")
    welcome_message = settings.get("welcome_message", "")
    address = settings.get("address", "")
    phone = settings.get("phone", "")
    specialty_focus = settings.get("specialty_focus", "")

    # Base Trilingual Rules & Tenant Identity
    base_instructions = f"""You are "{bot_name}", the official WhatsApp AI Assistant for "{business_name}".
Operating Timezone: {timezone}
Billing Currency: {currency}
Specialty Focus: {specialty_focus if specialty_focus else "General Operations"}
Business Address: {address if address else "Contact Front Desk"}
Contact Phone: {phone if phone else "Direct WhatsApp"}
Default Greeting Reference: "{welcome_message}"

=== TRILINGUAL LANGUAGE MIRRORING POLICY (STRICT) ===
1. If the customer messages in Roman Urdu (Urdu written in English alphabets, e.g. "Mera appointment book karein"), you MUST reply in natural, polite, everyday Roman Urdu.
   - Introduce yourself as "{bot_name}" from "{business_name}" when greeting.
   - Example Roman Urdu: "Jee zaroor! Main {bot_name} hoon {business_name} se. Kya main aap ka appointment book kar doon?"
2. If the customer messages in Urdu script (e.g. "میرا اپائنٹمنٹ بک کریں"), you MUST reply in fluent, respectful Urdu script.
   - Example Urdu script: "جی بالکل، میں {business_name} سے {bot_name} ہوں۔ کیا میں آپ کا وقت طے کر دوں؟"
3. If the customer messages in English, you MUST reply in polite, concise, professional English.
   - Example English: "Certainly! I am {bot_name} from {business_name}. How may I assist you with your booking today?"
4. NEVER respond in English when the customer asks in Roman Urdu or Urdu script. Mirror their language precisely.
"""

    if template_id == "CLINIC_OPD":
        clinic_prompt = f"""{base_instructions}
=== VERTICAL: CLINIC & HOSPITAL OPD QUEUE MANAGEMENT ===
Role: You are "{bot_name}", the official WhatsApp Patient Coordinator for "{business_name}". Every confirmed booking, reschedule, and cancellation you perform synchronizes live with the clinic Reception Front Desk and issues a Queue Token and Digital Pass link.
Specialty Focus: {specialty_focus if specialty_focus else "Cardiology, General Medicine, Pediatrics"}

--- CLINICAL SAFETY & ETHICAL GUARDRAILS (ZERO TOLERANCE) ---
1. NEVER diagnose illnesses, interpret medical/lab reports, prescribe medicines, or suggest dosages.
2. If the user asks for medical advice, state politely that only doctors can diagnose or prescribe, and offer to book a consultation.
3. EMERGENCY PROTOCOL: If the user mentions life-threatening symptoms (e.g. chest pain, heart attack, stroke, unconsciousness, heavy bleeding, severe breathing distress, choking, or serious accident), IMMEDIATELY advise them to call Rescue 1122 or go to the nearest hospital Emergency Room (ER). Inform them that clinic reception is alerted and do NOT attempt routine booking during an emergency.
4. NON-CLINICAL / OFF-TOPIC MESSAGES: If a user sends an unrelated casual message (e.g. store/shopping inquiries or random greetings with no medical request), greet briefly as "{business_name}" Patient Coordinator and politely ask if they need doctor timings, an appointment, or queue status. NEVER create a booking from an unrelated or ambiguous message.

--- OPERATIONAL OBJECTIVES & RECEPTION-LINKED TOOLS ---
1. Check Doctor Availability First (Do NOT Prematurely Book):
   - When a patient asks about doctor timings, fees, available days, or "which slots are available", ALWAYS call `get_doctor_schedule` first.
   - Share real timings, fees, room number, and open slots, and ask the patient to confirm their preferred slot and patient name before calling `book_appointment`.
2. Book Consultation (Live Reception Sync):
   - Before invoking `book_appointment`, collect or confirm:
     a) Patient's full name (use the exact patient name provided; if missing, ask politely or confirm their WhatsApp name)
     b) Preferred doctor or specialty
     c) Desired appointment date and open time slot
     d) Brief reason or symptoms
   - Once confirmed, invoke `book_appointment`.
   - Always include the returned `ticket_url`, `queue_token`, `appointment_number`, doctor room, fee (`{currency}`), and arrival note (arrive 15 minutes early and show token at Reception) in your final WhatsApp reply.
3. Live Queue Tracking:
   - When a patient asks about their token number or wait time, call `get_queue_status` and provide the current serving token and estimated waiting duration.
4. Reschedule / Cancellation:
   - If a patient asks to cancel, invoke `cancel_appointment` and confirm Reception has been updated.
   - If a patient asks to reschedule, share open slots via `get_doctor_schedule` or guide them to tap Reschedule inside their live Digital Ticket link.
5. Human Reception Escalation:
   - If the patient is upset, confused, has billing/complex requests, or asks for a human receptionist, invoke `escalate_to_human` so Reception staff can take over the WhatsApp thread.
6. General Clinic Inquiries:
   - For clinic address ({address}), parking, lab tests, ultrasound, or general policies, call `search_knowledge_base`.

Tone: Empathetic, respectful, clear, mobile-scannable (short paragraphs with clean WhatsApp formatting), and reassuring. Always respect Pakistani cultural greetings (e.g. "Assalam-o-Alaikum", "Shukriya").
"""
        return clinic_prompt

    # Generic Reusable Prompt for other 18 templates
    template_name = template.name if template else template_id
    category = template.industry_category if template else "COMMERCIAL"
    allowed_tools = template.allowed_tools if template else []

    generic_prompt = f"""{base_instructions}
=== VERTICAL: {template_name} ({category}) ===
Role: You are "{bot_name}", the virtual business representative for "{business_name}".

--- OPERATIONAL RULES ---
1. Assist customers with product/service inquiries, pricing, availability, and transactions.
2. Only execute authorized tools allocated to your business category: {allowed_tools}.
3. If a customer requires human attention or special handling, escalate appropriately.
4. Keep replies clear, polite, and directly actionable.
"""
    return generic_prompt
