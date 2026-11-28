import logging
import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo
from sqlalchemy import or_, text
from sqlalchemy.orm import Session

from app.models.clinic import ClinicAppointment, ClinicDoctor
from app.models.communication import TenantAuditEvent, TenantConversation, TenantMessage, TenantOutboxMessage
from app.models.contact import PlatformContact
from app.models.tenant import ChannelConnection, PlatformTenant
from app.services.billing_service import record_usage_db
from app.services.template_formatter import get_ticket_url

logger = logging.getLogger(__name__)

VALID_REMINDER_STATUSES = ("BOOKED", "CONFIRMED")
REMINDER_WINDOW_30M_MINUTES = 30.0
MIN_BOOKING_LEAD_FOR_30M_MINUTES = 35.0
REMINDER_WINDOW_24H_MINUTES = 24.0 * 60.0


def _get_local_tz(tenant_obj: Optional[PlatformTenant]):
    tz_name = tenant_obj.timezone if tenant_obj and tenant_obj.timezone else "Asia/Karachi"
    try:
        return ZoneInfo(tz_name)
    except Exception:
        return timezone(timedelta(hours=5))


def _resolve_tenant_now(
    tenant_obj: Optional[PlatformTenant],
    current_time_val: Optional[time] = None,
    current_dt_override: Optional[datetime] = None,
) -> tuple[Any, datetime]:
    """Resolves the tenant's local timezone and current local datetime (with test override support)."""
    local_tz = _get_local_tz(tenant_obj)
    if current_dt_override is not None:
        now_local = (
            current_dt_override.replace(tzinfo=local_tz)
            if current_dt_override.tzinfo is None
            else current_dt_override.astimezone(local_tz)
        )
    else:
        now_local = datetime.now(local_tz)
    if current_time_val is not None:
        now_local = now_local.replace(
            hour=current_time_val.hour,
            minute=current_time_val.minute,
            second=current_time_val.second,
            microsecond=0,
        )
    return local_tz, now_local


def _to_local_datetime(dt_val: Optional[datetime], local_tz: Any) -> Optional[datetime]:
    if dt_val is None:
        return None
    if dt_val.tzinfo is None:
        return dt_val.replace(tzinfo=timezone.utc).astimezone(local_tz)
    return dt_val.astimezone(local_tz)


def _resolve_patient_language(db: Session, tenant_id: Any, contact: PlatformContact) -> str:
    """Resolves patient's preferred language from contact metadata or recent AI messages."""
    meta = getattr(contact, "metadata_", None) or {}
    if isinstance(meta, dict):
        for key in ("language", "preferred_language"):
            val = meta.get(key)
            if isinstance(val, str) and val.upper() in ("ENGLISH", "ROMAN_URDU", "URDU"):
                return val.upper()
        profile = meta.get("patient_profile")
        if isinstance(profile, dict):
            val = profile.get("language")
            if isinstance(val, str) and val.upper() in ("ENGLISH", "ROMAN_URDU", "URDU"):
                return val.upper()

    try:
        session_key = f"{tenant_id}:{contact.customer_phone}"
        conv = (
            db.query(TenantConversation)
            .filter(
                TenantConversation.tenant_id == tenant_id,
                TenantConversation.session_key == session_key,
            )
            .first()
        )
        if conv is not None:
            last_ai = (
                db.query(TenantMessage)
                .filter(
                    TenantMessage.tenant_id == tenant_id,
                    TenantMessage.conversation_id == conv.id,
                    TenantMessage.sender_type == "AI_AGENT",
                )
                .order_by(TenantMessage.created_at.desc())
                .first()
            )
            ai_meta = getattr(last_ai, "metadata_", None) if last_ai else None
            if isinstance(ai_meta, dict):
                val = ai_meta.get("language")
                if isinstance(val, str) and val.upper() in ("ENGLISH", "ROMAN_URDU", "URDU"):
                    return val.upper()
    except Exception:
        pass

    return "ROMAN_URDU"


def _format_reminder_message(
    reminder_kind: str,
    language: str,
    patient_name: str,
    clinic_title: str,
    doctor: ClinicDoctor,
    apt: ClinicAppointment,
) -> str:
    """Formats uniform SaaS WhatsApp reminder copy in English, Roman Urdu, or Urdu."""
    slot_str = apt.slot_time.strftime("%I:%M %p")
    date_str = apt.appointment_date.strftime("%d-%b-%Y")
    room_str = doctor.room_number or "Clinic Desk"
    ticket_url = get_ticket_url(apt.appointment_number)

    if reminder_kind == "24H":
        if language == "ENGLISH":
            return (
                f"Assalam-o-Alaikum *{patient_name}*!\n\n"
                f"This is a reminder from *{clinic_title}* that your appointment with *{doctor.name}* "
                f"({doctor.specialty}, *{room_str}*) is scheduled for *{date_str}* at *{slot_str}*.\n\n"
                f"🎫 Queue Token: *{apt.queue_token}*\n\n"
                f"📲 View your live queue status, reschedule, or cancel here:\n"
                f"{ticket_url}\n\n"
                f"Thank you!"
            )
        if language == "URDU":
            return (
                f"السلام علیکم *{patient_name}*!\n\n"
                f"*{clinic_title}* کی طرف سے یاددہانی: آپ کی اپائنٹمنٹ *{doctor.name}* "
                f"({doctor.specialty}، *{room_str}*) کے ساتھ *{date_str}* کو *{slot_str}* بجے مقرر ہے۔\n\n"
                f"🎫 ٹوکن نمبر: *{apt.queue_token}*\n\n"
                f"📲 اپنا لائیو کیو اسٹیٹس دیکھنے، ری شیڈول یا کینسل کرنے کے لیے لنک کھولیں:\n"
                f"{ticket_url}\n\n"
                f"شکریہ!"
            )
        return (
            f"Assalam-o-Alaikum *{patient_name}*!\n\n"
            f"Yeh *{clinic_title}* ki taraf se reminder hai ke kal (*{date_str}*) ko *{slot_str}* baje "
            f"aapki appointment *{doctor.name}* ({doctor.specialty}, *{room_str}*) ke saath muqarrar hai.\n\n"
            f"🎫 Token Number: *{apt.queue_token}*\n\n"
            f"📲 Apna live queue status aur reschedule/cancel options is link per check karein:\n"
            f"{ticket_url}\n\n"
            f"Agar aap cancel karna chahein to *Cancel* likh kar reply karein. Shukriya!"
        )

    # 30-Minute Pre-Appointment Reminder
    if language == "ENGLISH":
        return (
            f"Assalam-o-Alaikum *{patient_name}*!\n\n"
            f"Your appointment with *{doctor.name}* ({doctor.specialty}) is in about *30 minutes* today at *{slot_str}*.\n\n"
            f"📍 Location: *{clinic_title}* (*{room_str}*)\n"
            f"🎫 Queue Token: *{apt.queue_token}*\n\n"
            f"📲 Live OPD Queue Tracker:\n"
            f"{ticket_url}"
        )
    if language == "URDU":
        return (
            f"السلام علیکم *{patient_name}*!\n\n"
            f"آپ کی اپائنٹمنٹ *{doctor.name}* ({doctor.specialty}) کے ساتھ آج *{slot_str}* بجے "
            f"(تقریباً *30 منٹ* بعد) ہے۔\n\n"
            f"📍 مقام: *{clinic_title}* (*{room_str}*)\n"
            f"🎫 ٹوکن نمبر: *{apt.queue_token}*\n\n"
            f"📲 لائیو کیو ٹریکر:\n"
            f"{ticket_url}"
        )
    return (
        f"Assalam-o-Alaikum *{patient_name}*!\n\n"
        f"Aapki appointment *{doctor.name}* ke saath aaj *{slot_str}* baje (taqreeban *30 minute* baad) hai.\n\n"
        f"📍 Location: *{clinic_title}* (*{room_str}*)\n"
        f"🎫 Token Number: *{apt.queue_token}*\n\n"
        f"📲 Live OPD Queue Tracker:\n"
        f"{ticket_url}"
    )


def _collect_due_appointments(db: Session, tenant_id: Optional[str], extra_filters: list) -> list:
    """Queries ClinicAppointment safely under FORCE ROW LEVEL SECURITY per tenant."""
    if tenant_id:
        tenant_ids = [uuid.UUID(str(tenant_id))]
    else:
        tenant_ids = [
            t.id
            for t in db.query(PlatformTenant)
            .filter(PlatformTenant.status.in_(["ACTIVE", "TRIAL"]))
            .all()
        ]

    rows = []
    for t_uuid in tenant_ids:
        db.execute(text(f"SET app.current_tenant_id = '{t_uuid}'"))
        t_rows = (
            db.query(ClinicAppointment, ClinicDoctor, PlatformContact)
            .join(
                ClinicDoctor,
                (ClinicAppointment.tenant_id == ClinicDoctor.tenant_id)
                & (ClinicAppointment.doctor_id == ClinicDoctor.id),
            )
            .join(
                PlatformContact,
                (ClinicAppointment.tenant_id == PlatformContact.tenant_id)
                & (ClinicAppointment.contact_id == PlatformContact.id),
            )
            .filter(ClinicAppointment.tenant_id == t_uuid, *extra_filters)
            .all()
        )
        rows.extend(t_rows)
    return rows


def _dispatch_appointment_reminder(
    db: Session,
    apt: ClinicAppointment,
    doctor: ClinicDoctor,
    contact: PlatformContact,
    reminder_kind: str,
) -> bool:
    """Enqueues a single reminder to outbox, marks DB flags, and writes an audit event."""
    t_id = apt.tenant_id
    db.execute(text(f"SET app.current_tenant_id = '{t_id}'"))

    conn = (
        db.query(ChannelConnection)
        .filter(
            ChannelConnection.tenant_id == t_id,
            ChannelConnection.status == "CONNECTED",
        )
        .first()
    )
    tenant_obj = db.query(PlatformTenant).filter(PlatformTenant.id == t_id).first()
    clinic_title = tenant_obj.name if tenant_obj else "Clinic"
    patient_name = contact.full_name or contact.push_name or "Patient"
    language = _resolve_patient_language(db, t_id, contact)

    msg_body = _format_reminder_message(
        reminder_kind=reminder_kind,
        language=language,
        patient_name=patient_name,
        clinic_title=clinic_title,
        doctor=doctor,
        apt=apt,
    )

    enqueued = False
    if conn:
        outbox = TenantOutboxMessage(
            tenant_id=t_id,
            channel_connection_id=conn.id,
            recipient_phone=contact.customer_phone,
            message_type="text",
            payload={
                "text": msg_body,
                "reminder_type": f"{reminder_kind}_APPOINTMENT_REMINDER",
                "appointment_id": str(apt.id),
                "language": language,
            },
            status="PENDING",
        )
        db.add(outbox)
        record_usage_db(db, str(t_id), "WHATSAPP_OUTBOUND", 1, {"type": f"REMINDER_{reminder_kind}"})
        enqueued = True

    db.execute(text(f"SET app.current_tenant_id = '{t_id}'"))
    if reminder_kind == "24H":
        db.execute(
            text(
                """
                UPDATE clinic_appointments
                SET reminder_24h_sent = TRUE, reminder_24h_sent_at = NOW()
                WHERE tenant_id = :tid AND id = :aid
                """
            ),
            {"tid": t_id, "aid": apt.id},
        )
        audit_action = "APPOINTMENT_REMINDER_24H_SENT"
    else:
        db.execute(
            text(
                """
                UPDATE clinic_appointments
                SET reminder_30m_sent = TRUE,
                    reminder_30m_sent_at = NOW(),
                    reminder_2h_sent = TRUE,
                    reminder_2h_sent_at = NOW()
                WHERE tenant_id = :tid AND id = :aid
                """
            ),
            {"tid": t_id, "aid": apt.id},
        )
        audit_action = "APPOINTMENT_REMINDER_30M_SENT"

    db.add(
        TenantAuditEvent(
            tenant_id=t_id,
            actor_type="SYSTEM",
            actor_id="reminder_worker",
            action=audit_action,
            resource_type="APPOINTMENT",
            resource_id=str(apt.id),
            details={
                "recipient": contact.customer_phone,
                "token": apt.queue_token,
                "reminder_kind": reminder_kind,
                "language": language,
            },
        )
    )
    db.commit()
    return enqueued


def process_24h_reminders_db(
    db: Session,
    tenant_id: Optional[str] = None,
    target_date: Optional[date] = None,
    current_dt_override: Optional[datetime] = None,
) -> Dict[str, Any]:
    """
    Dispatches 24-hour advance reminders ONLY for appointments booked/confirmed
    before the appointment date (never same-day bookings), within the tenant's local 24h window.
    """
    ref_today = current_dt_override.date() if current_dt_override else date.today()
    extra_filters = [
        ClinicAppointment.status.in_(list(VALID_REMINDER_STATUSES)),
        or_(ClinicAppointment.reminder_24h_sent == False, ClinicAppointment.reminder_24h_sent.is_(None)),
    ]
    if target_date is not None:
        extra_filters.append(ClinicAppointment.appointment_date == target_date)
    else:
        extra_filters.append(ClinicAppointment.appointment_date >= ref_today - timedelta(days=1))
        extra_filters.append(ClinicAppointment.appointment_date <= ref_today + timedelta(days=2))

    appointments = _collect_due_appointments(db=db, tenant_id=tenant_id, extra_filters=extra_filters)
    dispatched_count = 0
    tenant_cache: Dict[str, Optional[PlatformTenant]] = {}

    for apt, doctor, contact in appointments:
        t_key = str(apt.tenant_id)
        if t_key not in tenant_cache:
            db.execute(text(f"SET app.current_tenant_id = '{t_key}'"))
            tenant_cache[t_key] = db.query(PlatformTenant).filter(PlatformTenant.id == apt.tenant_id).first()

        local_tz, now_local = _resolve_tenant_now(tenant_cache[t_key], current_dt_override=current_dt_override)
        created_local = _to_local_datetime(getattr(apt, "created_at", None), local_tz)

        # Strict rule: booking must have been confirmed BEFORE the appointment date (exclude same-day bookings)
        if created_local is not None and created_local.date() >= apt.appointment_date:
            continue

        apt_dt = datetime.combine(apt.appointment_date, apt.slot_time, tzinfo=local_tz)
        delta_minutes = (apt_dt - now_local).total_seconds() / 60.0

        if target_date is not None:
            if apt.appointment_date != target_date or delta_minutes <= REMINDER_WINDOW_30M_MINUTES:
                continue
        else:
            if not (REMINDER_WINDOW_30M_MINUTES < delta_minutes <= REMINDER_WINDOW_24H_MINUTES):
                continue

        if _dispatch_appointment_reminder(db, apt, doctor, contact, reminder_kind="24H"):
            dispatched_count += 1

    return {
        "status": "SUCCESS",
        "type": "24H_REMINDERS",
        "target_date": (target_date or (ref_today + timedelta(days=1))).isoformat(),
        "reminders_dispatched": dispatched_count,
    }


def process_30m_reminders_db(
    db: Session,
    tenant_id: Optional[str] = None,
    current_time_val: Optional[time] = None,
    current_dt_override: Optional[datetime] = None,
    window_minutes: float = REMINDER_WINDOW_30M_MINUTES,
    min_lead_minutes: float = MIN_BOOKING_LEAD_FOR_30M_MINUTES,
) -> Dict[str, Any]:
    """
    Dispatches urgent 30-minute pre-appointment WhatsApp reminders using each tenant's
    local timezone when 0 < (slot_datetime - now_local) <= 30 minutes, skipping last-minute bookings.
    """
    ref_today = current_dt_override.date() if current_dt_override else date.today()
    extra_filters = [
        ClinicAppointment.appointment_date >= ref_today - timedelta(days=1),
        ClinicAppointment.appointment_date <= ref_today + timedelta(days=2),
        ClinicAppointment.status.in_(list(VALID_REMINDER_STATUSES)),
        or_(ClinicAppointment.reminder_30m_sent == False, ClinicAppointment.reminder_30m_sent.is_(None)),
        or_(ClinicAppointment.reminder_2h_sent == False, ClinicAppointment.reminder_2h_sent.is_(None)),
    ]

    appointments = _collect_due_appointments(db=db, tenant_id=tenant_id, extra_filters=extra_filters)
    dispatched_count = 0
    tenant_cache: Dict[str, Optional[PlatformTenant]] = {}

    for apt, doctor, contact in appointments:
        t_key = str(apt.tenant_id)
        if t_key not in tenant_cache:
            db.execute(text(f"SET app.current_tenant_id = '{t_key}'"))
            tenant_cache[t_key] = db.query(PlatformTenant).filter(PlatformTenant.id == apt.tenant_id).first()

        local_tz, now_local = _resolve_tenant_now(
            tenant_cache[t_key],
            current_time_val=current_time_val,
            current_dt_override=current_dt_override,
        )
        apt_dt = datetime.combine(apt.appointment_date, apt.slot_time, tzinfo=local_tz)
        delta_minutes = (apt_dt - now_local).total_seconds() / 60.0

        # Strictly fire ONLY when slot is between >0 and <=30 minutes away
        if not (0.0 < delta_minutes <= float(window_minutes)):
            continue

        # Skip immediate duplicate alert for last-minute bookings created <35 min before slot
        created_local = _to_local_datetime(getattr(apt, "created_at", None), local_tz)
        if created_local is not None:
            booking_lead_minutes = (apt_dt - created_local).total_seconds() / 60.0
            if booking_lead_minutes < float(min_lead_minutes):
                continue

        if _dispatch_appointment_reminder(db, apt, doctor, contact, reminder_kind="30M"):
            dispatched_count += 1

    return {
        "status": "SUCCESS",
        "type": "30M_REMINDERS",
        "reminders_dispatched": dispatched_count,
    }


def process_2h_reminders_db(
    db: Session,
    tenant_id: Optional[str] = None,
    current_time_val: Optional[time] = None,
    current_dt_override: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Legacy wrapper alias delegating to the 30-minute pre-appointment reminder engine."""
    return process_30m_reminders_db(
        db=db,
        tenant_id=tenant_id,
        current_time_val=current_time_val,
        current_dt_override=current_dt_override,
    )


def run_full_reminder_cycle(db: Session, tenant_id: Optional[str] = None) -> Dict[str, Any]:
    """Runs full automated 24h + 30m reminder batch execution."""
    res_24 = process_24h_reminders_db(db, tenant_id=tenant_id)
    res_30m = process_30m_reminders_db(db, tenant_id=tenant_id)
    return {
        "status": "COMPLETED",
        "reminders_24h": res_24["reminders_dispatched"],
        "reminders_30m": res_30m["reminders_dispatched"],
        "reminders_2h": res_30m["reminders_dispatched"],
        "executed_at": datetime.now(timezone.utc).isoformat(),
    }
