from typing import Dict, Any, Optional
from app.core.config import settings

# Reusable vertical terminology map across business templates
VERTICAL_LABELS: Dict[str, Dict[str, str]] = {
    "CLINIC_OPD": {
        "confirmed_en": "Appointment Confirmed!",
        "confirmed_ru": "Appointment Confirmed!",
        "confirmed_ur": "اپائنٹمنٹ بک ہو گئی ہے!",
        "provider_label": "Doctor",
        "location_label": "Room",
        "token_label": "Queue Token",
        "ref_label": "Booking ID",
        "note_en": "Please arrive 15 minutes before your scheduled slot and show your token at reception.",
        "note_ru": "Barah-e-meherbani waqt se 15 minute pehle reception counter par tashreef layein.",
        "note_ur": "برائے مہربانی اپنے وقت سے 15 منٹ پہلے تشریف لائیں۔",
    },
    "DENTAL_CLINIC": {
        "confirmed_en": "Dental Appointment Confirmed!",
        "confirmed_ru": "Dental Appointment Confirmed!",
        "confirmed_ur": "ڈینٹل اپائنٹمنٹ بک ہو گئی ہے!",
        "provider_label": "Dentist",
        "location_label": "Suite / Chair",
        "token_label": "Queue Token",
        "ref_label": "Booking ID",
        "note_en": "Please arrive 10 minutes early for dental registration.",
        "note_ru": "Barah-e-meherbani waqt se 10 minute pehle tashreef layein.",
        "note_ur": "برائے مہربانی 10 منٹ پہلے تشریف لائیں۔",
    },
    "BEAUTY_SALON": {
        "confirmed_en": "Salon Booking Confirmed!",
        "confirmed_ru": "Salon Booking Confirmed!",
        "confirmed_ur": "سیلون بکنگ کنفرم ہو گئی ہے!",
        "provider_label": "Stylist",
        "location_label": "Station",
        "token_label": "Service Token",
        "ref_label": "Booking ID",
        "note_en": "Please arrive 10 minutes prior to your scheduled session.",
        "note_ru": "Barah-e-meherbani apne waqt se 10 minute pehle tashreef layein.",
        "note_ur": "برائے مہربانی 10 منٹ پہلے تشریف لائیں۔",
    },
    "RESTAURANT_DELIVERY": {
        "confirmed_en": "Order / Table Confirmed!",
        "confirmed_ru": "Order Confirm Ho Gaya!",
        "confirmed_ur": "آرڈر کنفرم ہو گیا ہے!",
        "provider_label": "Handled By",
        "location_label": "Counter / Table",
        "token_label": "Order Token",
        "ref_label": "Order ID",
        "note_en": "Track your live preparation and dispatch status using the link below.",
        "note_ru": "Apne order ka live status neeche diye gaye link par check karein.",
        "note_ur": "نیچے دیے گئے لنک پر اپنے آرڈر کا لائیو اسٹیٹس دیکھیں۔",
    },
    "MOBILE_REPAIR": {
        "confirmed_en": "Repair Ticket Created!",
        "confirmed_ru": "Repair Ticket Ban Gaya!",
        "confirmed_ur": "ریپیئر ٹکٹ بن گیا ہے!",
        "provider_label": "Technician",
        "location_label": "Bench / Desk",
        "token_label": "Job Token",
        "ref_label": "Ticket ID",
        "note_en": "Monitor live repair diagnostics and completion alerts via your ticket link.",
        "note_ru": "Apne device ki repair progress neeche link par live check karein.",
        "note_ur": "نیچے دیے گئے لنک پر مرمت کی صورتحال دیکھیں۔",
    },
}


def get_ticket_url(reference_id: str) -> str:
    base = (getattr(settings, "FRONTEND_PUBLIC_URL", None) or "http://192.168.1.31:3000").rstrip("/")
    return f"{base}/ticket/{reference_id}"


def format_booking_confirmation(
    booking_data: Dict[str, Any],
    language: str = "ENGLISH",
    business_name: Optional[str] = None,
    template_id: str = "CLINIC_OPD",
    currency: str = "PKR",
    business_address: Optional[str] = None,
    business_phone: Optional[str] = None,
) -> str:
    """
    Renders a branded, trilingual WhatsApp confirmation card with live digital ticket URL
    and self-service instructions, reusable across Clinic OPD and other AI business templates.
    """
    labels = VERTICAL_LABELS.get(template_id, VERTICAL_LABELS["CLINIC_OPD"])
    biz_title = business_name or booking_data.get("business_name") or "GlimsTech AI Business"
    ref_id = booking_data.get("appointment_number") or booking_data.get("appointment_id") or "APT-1001"
    token = booking_data.get("queue_token", "T-01")
    patient_name = (booking_data.get("patient_name") or "").strip()
    provider = booking_data.get("doctor_name", "Consultant")
    specialty = booking_data.get("specialty", "")
    provider_display = f"*{provider}*" + (f" ({specialty})" if specialty else "")
    location = booking_data.get("room_number", "Front Desk")
    apt_date = booking_data.get("appointment_date", "Today")
    slot = booking_data.get("slot_time", "11:00 AM")
    fee = float(booking_data.get("fee_pkr", 0) or 0)
    ticket_url = booking_data.get("ticket_url") or get_ticket_url(ref_id)
    map_url = booking_data.get("map_url") or ""

    addr_line = f"📍 Location: *{business_address}*\n" if business_address else ""
    map_line = f"🗺️ Map: {map_url}\n" if map_url else ""
    phone_line = f"☎️ Helpline: *{business_phone}*\n" if business_phone else ""
    fee_line = f"💵 Fee: *{currency} {fee:,.0f}*\n" if fee > 0 else ""

    if language == "ROMAN_URDU":
        patient_line = f"🧑 Patient Name: *{patient_name}*\n" if patient_name else ""
        return (
            f"✅ *{labels['confirmed_ru']}*\n\n"
            f"🏢 *{biz_title}*\n"
            f"{addr_line}{map_line}{phone_line}"
            f"{patient_line}"
            f"👤 {labels['provider_label']}: {provider_display}\n"
            f"📅 Date: *{apt_date}*\n"
            f"⏰ Slot Time: *{slot}*\n"
            f"🚪 {labels['location_label']}: *{location}*\n"
            f"🎫 {labels['token_label']}: *{token}*\n"
            f"🆔 {labels['ref_label']}: *{ref_id}*\n"
            f"{fee_line}\n"
            f"📲 *Live Queue & Digital Ticket Link:*\n"
            f"{ticket_url}\n\n"
            f"⚙️ Manage Booking: Is link par aap live wait time dekh sakte hain, slot *Reschedule* ya *Cancel* kar sakte hain.\n"
            f"⚠️ {labels['note_ru']}"
        )
    elif language == "URDU":
        patient_line = f"🧑 مریض کا نام: *{patient_name}*\n" if patient_name else ""
        return (
            f"✅ *{labels['confirmed_ur']}*\n\n"
            f"🏢 *{biz_title}*\n"
            f"{addr_line}{map_line}{phone_line}"
            f"{patient_line}"
            f"👤 {labels['provider_label']}: {provider_display}\n"
            f"📅 تاریخ: *{apt_date}*\n"
            f"⏰ وقت: *{slot}*\n"
            f"🚪 {labels['location_label']}: *{location}*\n"
            f"🎫 ٹوکن نمبر: *{token}*\n"
            f"🆔 بکنگ آئی ڈی: *{ref_id}*\n"
            f"{fee_line}\n"
            f"📲 *لائیو ٹوکن اور ٹریکنگ لنک:*\n"
            f"{ticket_url}\n\n"
            f"⚠️ {labels['note_ur']}"
        )
    else:
        patient_line = f"🧑 Patient Name: *{patient_name}*\n" if patient_name else ""
        return (
            f"✅ *{labels['confirmed_en']}*\n\n"
            f"🏢 *{biz_title}*\n"
            f"{addr_line}{map_line}{phone_line}"
            f"{patient_line}"
            f"👤 {labels['provider_label']}: {provider_display}\n"
            f"📅 Date: *{apt_date}*\n"
            f"⏰ Slot Time: *{slot}*\n"
            f"🚪 {labels['location_label']}: *{location}*\n"
            f"🎫 {labels['token_label']}: *{token}*\n"
            f"🆔 {labels['ref_label']}: *{ref_id}*\n"
            f"{fee_line}\n"
            f"📲 *Live Digital Ticket & Queue Tracker:*\n"
            f"{ticket_url}\n\n"
            f"⚙️ Self-Service: Open the link above to track your live turn, reschedule, or cancel anytime.\n"
            f"⚠️ Note: {labels['note_en']}"
        )
