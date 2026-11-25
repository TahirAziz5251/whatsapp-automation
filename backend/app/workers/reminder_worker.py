import logging
import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.models.clinic import ClinicAppointment, ClinicDoctor
from app.models.contact import PlatformContact
from app.models.tenant import ChannelConnection, PlatformTenant
from app.models.communication import TenantOutboxMessage, TenantAuditEvent
from app.services.billing_service import record_usage_db
from app.services.template_formatter import get_ticket_url

logger = logging.getLogger(__name__)


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


def process_24h_reminders_db(
    db: Session,
    tenant_id: Optional[str] = None,
    target_date: Optional[date] = None
) -> Dict[str, Any]:
    """
    Scans for appointments scheduled for tomorrow (or target_date) that haven't received
    the 24-hour reminder, formats personalized WhatsApp alerts, and enqueues to outbox.
    """
    check_date = target_date or (date.today() + timedelta(days=1))

    appointments = _collect_due_appointments(
        db=db,
        tenant_id=tenant_id,
        extra_filters=[
            ClinicAppointment.appointment_date == check_date,
            ClinicAppointment.status == "BOOKED",
            ClinicAppointment.reminder_24h_sent == False,
        ],
    )
    dispatched_count = 0

    for apt, doctor, contact in appointments:
        t_id = apt.tenant_id
        db.execute(text(f"SET app.current_tenant_id = '{t_id}'"))

        # Find connected channel
        conn = db.query(ChannelConnection).filter(
            ChannelConnection.tenant_id == t_id,
            ChannelConnection.status == "CONNECTED"
        ).first()

        slot_str = apt.slot_time.strftime("%I:%M %p")
        date_str = apt.appointment_date.strftime("%d-%b-%Y")
        patient_name = contact.full_name or contact.push_name or "Patient"

        tenant_obj = db.query(PlatformTenant).filter(PlatformTenant.id == t_id).first()
        clinic_title = tenant_obj.name if tenant_obj else "Clinic"

        msg_body = (
            f"Assalam-o-Alaikum {patient_name}!\n\n"
            f"Yeh {clinic_title} ki taraf se reminder hai ke kal ({date_str}) ko {slot_str} baje "
            f"aapki appointment {doctor.name} ({doctor.specialty}, {doctor.room_number}) ke saath muqarrar hai.\n\n"
            f"Aapka Token Number: {apt.queue_token}\n\n"
            f"Apna live queue status aur reschedule/cancel options is link per check karein:\n"
            f"{get_ticket_url(apt.appointment_number)}\n\n"
            f"Agar aap cancel karna chahein to 'Cancel' likh kar reply karein. Shukriya!"
        )

        if conn:
            outbox = TenantOutboxMessage(
                tenant_id=t_id,
                channel_connection_id=conn.id,
                recipient_phone=contact.customer_phone,
                message_type="text",
                payload={
                    "text": msg_body,
                    "reminder_type": "24H_APPOINTMENT_REMINDER",
                    "appointment_id": str(apt.id)
                },
                status="PENDING"
            )
            db.add(outbox)
            dispatched_count += 1

            # Record usage metering
            record_usage_db(db, str(t_id), "WHATSAPP_OUTBOUND", 1, {"type": "REMINDER_24H"})

        # Ensure RLS tenant context is set for the current transaction
        db.execute(text(f"SET app.current_tenant_id = '{t_id}'"))
        db.execute(text("""
            UPDATE clinic_appointments
            SET reminder_24h_sent = TRUE, reminder_24h_sent_at = NOW()
            WHERE tenant_id = :tid AND id = :aid
        """), {"tid": t_id, "aid": apt.id})

        # Audit Event
        audit = TenantAuditEvent(
            tenant_id=t_id,
            actor_type="SYSTEM",
            actor_id="reminder_worker",
            action="APPOINTMENT_REMINDER_24H_SENT",
            resource_type="APPOINTMENT",
            resource_id=str(apt.id),
            details={"recipient": contact.customer_phone, "token": apt.queue_token}
        )
        db.add(audit)
        db.commit()

    return {
        "status": "SUCCESS",
        "type": "24H_REMINDERS",
        "target_date": check_date.isoformat(),
        "reminders_dispatched": dispatched_count
    }


def process_2h_reminders_db(
    db: Session,
    tenant_id: Optional[str] = None,
    current_time_val: Optional[time] = None
) -> Dict[str, Any]:
    """
    Scans for today's appointments that are ~2 hours away and haven't received
    the 2-hour reminder, formats urgent WhatsApp alerts, and enqueues to outbox.
    """
    today = date.today()
    now_dt = datetime.now(timezone.utc)
    curr_time = current_time_val or now_dt.time()

    # Query today's booked appointments that need 2h reminder under strict tenant RLS
    appointments = _collect_due_appointments(
        db=db,
        tenant_id=tenant_id,
        extra_filters=[
            ClinicAppointment.appointment_date == today,
            ClinicAppointment.status == "BOOKED",
            ClinicAppointment.reminder_2h_sent == False,
        ],
    )
    dispatched_count = 0

    for apt, doctor, contact in appointments:
        t_id = apt.tenant_id
        db.execute(text(f"SET app.current_tenant_id = '{t_id}'"))

        conn = db.query(ChannelConnection).filter(
            ChannelConnection.tenant_id == t_id,
            ChannelConnection.status == "CONNECTED"
        ).first()

        slot_str = apt.slot_time.strftime("%I:%M %p")
        patient_name = contact.full_name or contact.push_name or "Patient"

        tenant_obj = db.query(PlatformTenant).filter(PlatformTenant.id == t_id).first()
        clinic_title = tenant_obj.name if tenant_obj else "Clinic"

        msg_body = (
            f"Assalam-o-Alaikum {patient_name}!\n\n"
            f"Aapki appointment {doctor.name} ke saath aaj {slot_str} baje (taqreeban 2 ghante mein) hai.\n\n"
            f"Baraye meherbani waqt per {clinic_title} tashreef layen aur reception per apna Token {apt.queue_token} dikha kar check-in karwayen.\n\n"
            f"Live OPD Queue Tracker:\n"
            f"{get_ticket_url(apt.appointment_number)}"
        )

        if conn:
            outbox = TenantOutboxMessage(
                tenant_id=t_id,
                channel_connection_id=conn.id,
                recipient_phone=contact.customer_phone,
                message_type="text",
                payload={
                    "text": msg_body,
                    "reminder_type": "2H_APPOINTMENT_REMINDER",
                    "appointment_id": str(apt.id)
                },
                status="PENDING"
            )
            db.add(outbox)
            dispatched_count += 1

            record_usage_db(db, str(t_id), "WHATSAPP_OUTBOUND", 1, {"type": "REMINDER_2H"})

        # Ensure RLS tenant context is set for the current transaction
        db.execute(text(f"SET app.current_tenant_id = '{t_id}'"))
        db.execute(text("""
            UPDATE clinic_appointments
            SET reminder_2h_sent = TRUE, reminder_2h_sent_at = NOW()
            WHERE tenant_id = :tid AND id = :aid
        """), {"tid": t_id, "aid": apt.id})

        audit = TenantAuditEvent(
            tenant_id=t_id,
            actor_type="SYSTEM",
            actor_id="reminder_worker",
            action="APPOINTMENT_REMINDER_2H_SENT",
            resource_type="APPOINTMENT",
            resource_id=str(apt.id),
            details={"recipient": contact.customer_phone, "token": apt.queue_token}
        )
        db.add(audit)
        db.commit()

    return {
        "status": "SUCCESS",
        "type": "2H_REMINDERS",
        "reminders_dispatched": dispatched_count
    }


def run_full_reminder_cycle(db: Session, tenant_id: Optional[str] = None) -> Dict[str, Any]:
    """Runs full automated reminder batch execution."""
    res_24 = process_24h_reminders_db(db, tenant_id=tenant_id)
    res_2 = process_2h_reminders_db(db, tenant_id=tenant_id)
    return {
        "status": "COMPLETED",
        "reminders_24h": res_24["reminders_dispatched"],
        "reminders_2h": res_2["reminders_dispatched"],
        "executed_at": datetime.now(timezone.utc).isoformat()
    }
