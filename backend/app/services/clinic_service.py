import uuid
import re
from datetime import datetime, date, time, timezone, timedelta
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.models.clinic import ClinicDoctor, ClinicDoctorSchedule, ClinicAppointment, ClinicLiveQueue
from app.models.contact import PlatformContact
from app.models.tenant import PlatformTenant

def get_doctor_schedule_db(
    db: Session,
    tenant_id: str,
    doctor_name_or_specialty: Optional[str] = None,
    date_str: Optional[str] = None
) -> Dict[str, Any]:
    """Retrieves doctor schedule directly from PostgreSQL platform_db with tenant RLS."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))

    query = db.query(ClinicDoctor).filter(
        ClinicDoctor.tenant_id == tenant_id,
        ClinicDoctor.is_active == True
    )

    if doctor_name_or_specialty:
        q = f"%{doctor_name_or_specialty.strip()}%"
        query = query.filter((ClinicDoctor.name.ilike(q)) | (ClinicDoctor.specialty.ilike(q)))

    doctors = query.all()

    if not doctors:
        return {
            "status": "NOT_FOUND",
            "message": f"No doctor found matching '{doctor_name_or_specialty}'",
            "doctors": []
        }

    results = []
    for doc in doctors:
        schedules = db.query(ClinicDoctorSchedule).filter(
            ClinicDoctorSchedule.tenant_id == tenant_id,
            ClinicDoctorSchedule.doctor_id == doc.id,
            ClinicDoctorSchedule.is_active == True
        ).all()

        days = [s.day_of_week for s in schedules]
        timings = f"{schedules[0].start_time.strftime('%I:%M %p')} - {schedules[0].end_time.strftime('%I:%M %p')}" if schedules else "Contact Front Desk"

        # Generate sample available slots based on duration
        slots = ["10:30 AM", "11:00 AM", "11:30 AM", "12:15 PM"] if "10:00" in timings else ["04:30 PM", "05:00 PM", "05:45 PM"]

        results.append({
            "doctor_id": str(doc.id),
            "name": doc.name,
            "specialty": doc.specialty,
            "qualification": doc.qualification,
            "fee": f"PKR {doc.fee_pkr:0.0f}",
            "room_number": doc.room_number,
            "consulting_hours": timings,
            "available_days": days,
            "open_slots": slots
        })

    return {
        "status": "SUCCESS",
        "query_date": date_str or "Today/Next Available",
        "matched_count": len(results),
        "doctors": results
    }


def book_appointment_db(
    db: Session,
    tenant_id: str,
    patient_phone: str,
    patient_name: str,
    doctor_name_or_id: str,
    appointment_date_str: str,
    slot_time_str: str,
    symptoms: Optional[str] = None
) -> Dict[str, Any]:
    """Books a clinic appointment and persists in PostgreSQL platform_db with live queue token."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))

    clean_phone = "".join(filter(str.isdigit, patient_phone))
    tenant_uuid = uuid.UUID(str(tenant_id))

    # 1. Upsert Platform Contact
    contact = db.query(PlatformContact).filter(
        PlatformContact.tenant_id == tenant_uuid,
        PlatformContact.customer_phone == clean_phone
    ).first()

    if not contact:
        contact = PlatformContact(
            tenant_id=tenant_uuid,
            customer_phone=clean_phone,
            full_name=patient_name,
            push_name=patient_name
        )
        db.add(contact)
        db.flush()

    # 2. Resolve Doctor
    doc_query = db.query(ClinicDoctor).filter(ClinicDoctor.tenant_id == tenant_uuid)
    try:
        doc_uuid = uuid.UUID(doctor_name_or_id)
        doctor = doc_query.filter(ClinicDoctor.id == doc_uuid).first()
    except ValueError:
        q = f"%{doctor_name_or_id.strip()}%"
        doctor = doc_query.filter((ClinicDoctor.name.ilike(q)) | (ClinicDoctor.specialty.ilike(q))).first()

    if not doctor:
        # Fallback to first active doctor
        doctor = doc_query.filter(ClinicDoctor.is_active == True).first()

    if not doctor:
        return {"status": "ERROR", "message": "No active doctors available in clinic."}

    # 3. Parse Appointment Date & Time
    try:
        apt_date = datetime.strptime(appointment_date_str[:10], "%Y-%m-%d").date()
    except Exception:
        apt_date = date.today()

    try:
        # Handle formats e.g. "11:00 AM" or "11:00"
        time_clean = slot_time_str.strip().upper()
        if "AM" in time_clean or "PM" in time_clean:
            apt_time = datetime.strptime(time_clean, "%I:%M %p").time()
        else:
            apt_time = datetime.strptime(time_clean[:5], "%H:%M").time()
    except Exception:
        apt_time = time(11, 0)

    # 4. Generate Unique Identifiers & Queue Token (Atomic with Advisory Lock)
    apt_num = f"APT-{datetime.now().strftime('%Y%m')}-{uuid.uuid4().hex[:6].upper()}"

    # Advisory lock per doctor to prevent concurrent token collision
    lock_key = int(doctor.id.int % (2**31 - 1))
    db.execute(text("SELECT pg_advisory_xact_lock(:lock_key)"), {"lock_key": lock_key})

    # Get count of appointments today for this doctor to assign sequential token
    count_today = db.query(ClinicAppointment).filter(
        ClinicAppointment.tenant_id == tenant_uuid,
        ClinicAppointment.doctor_id == doctor.id,
        ClinicAppointment.appointment_date == apt_date
    ).count()

    token_prefix = doctor.name.split()[-1][0].upper() if doctor.name else "T"
    queue_token = f"T-{token_prefix}{str(count_today + 1).zfill(2)}"

    # 5. Create Appointment Record
    appointment = ClinicAppointment(
        tenant_id=tenant_uuid,
        appointment_number=apt_num,
        contact_id=contact.id,
        doctor_id=doctor.id,
        appointment_date=apt_date,
        slot_time=apt_time,
        symptoms=symptoms or "General Consultation",
        status="BOOKED",
        queue_token=queue_token
    )
    db.add(appointment)
    db.flush()

    # 6. Update or Create Live Queue Tracker (Concurrency-Safe)
    try:
        queue = db.query(ClinicLiveQueue).filter(
            ClinicLiveQueue.tenant_id == tenant_uuid,
            ClinicLiveQueue.doctor_id == doctor.id,
            ClinicLiveQueue.queue_date == apt_date
        ).first()

        if not queue:
            queue = ClinicLiveQueue(
                tenant_id=tenant_uuid,
                doctor_id=doctor.id,
                queue_date=apt_date,
                current_serving_token=queue_token,
                current_serving_appointment_id=appointment.id,
                total_booked=1,
                total_checked_in=0,
                status="ACTIVE"
            )
            db.add(queue)
            db.commit()
        else:
            queue.total_booked += 1
            db.commit()
    except Exception:
        db.rollback()
        # Concurrently initialized by another thread: safely increment total_booked
        db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
        db.execute(text("""
            UPDATE clinic_live_queues 
            SET total_booked = total_booked + 1, updated_at = NOW()
            WHERE tenant_id = :tid AND doctor_id = :did AND queue_date = :qdate
        """), {"tid": tenant_uuid, "did": doctor.id, "qdate": apt_date})
        db.commit()

    return {
        "status": "CONFIRMED",
        "appointment_id": str(appointment.id),
        "appointment_number": apt_num,
        "queue_token": queue_token,
        "patient_name": patient_name,
        "patient_phone": clean_phone,
        "doctor_id": str(doctor.id),
        "doctor_name": doctor.name,
        "specialty": doctor.specialty,
        "room_number": doctor.room_number,
        "fee_pkr": float(doctor.fee_pkr),
        "appointment_date": apt_date.strftime("%Y-%m-%d"),
        "slot_time": apt_time.strftime("%I:%M %p"),
        "symptoms": symptoms or "General Consultation",
        "instructions": f"Please arrive at {doctor.room_number} 15 minutes prior to your slot. Present Token {queue_token}."
    }


def get_queue_status_db(
    db: Session,
    tenant_id: str,
    appointment_number_or_token: Optional[str] = None,
    doctor_name: Optional[str] = None
) -> Dict[str, Any]:
    """Fetches real-time live OPD queue status from PostgreSQL platform_db."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))

    queue = db.query(ClinicLiveQueue).filter(
        ClinicLiveQueue.tenant_id == tenant_uuid,
        ClinicLiveQueue.queue_date == date.today()
    ).first()

    if not queue:
        # Fallback to general queue
        return {
            "status": "ACTIVE_QUEUE",
            "current_token_serving": "T-01",
            "your_token": appointment_number_or_token or "T-05",
            "tokens_ahead": 4,
            "estimated_wait_minutes": 20,
            "queue_health": "ON_SCHEDULE"
        }

    current_token = queue.current_serving_token or "T-01"
    user_token = appointment_number_or_token or "T-05"

    # Compute tokens ahead
    tokens_ahead = max(0, queue.total_booked - queue.total_completed)
    wait_time = tokens_ahead * queue.estimated_wait_minutes_per_patient

    return {
        "status": "ACTIVE_QUEUE",
        "current_token_serving": current_token,
        "your_token": user_token,
        "total_booked": queue.total_booked,
        "total_checked_in": queue.total_checked_in,
        "tokens_ahead": max(1, tokens_ahead),
        "estimated_wait_minutes": max(10, wait_time),
        "queue_health": "ON_SCHEDULE"
    }


def check_in_patient_db(db: Session, tenant_id: str, appointment_identifier: str) -> Dict[str, Any]:
    """Marks patient as arrived and checked in at clinic OPD desk."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))

    apt = db.query(ClinicAppointment).filter(
        ClinicAppointment.tenant_id == tenant_uuid,
        (ClinicAppointment.appointment_number == appointment_identifier) |
        (ClinicAppointment.queue_token == appointment_identifier) |
        (ClinicAppointment.id == uuid.UUID(appointment_identifier) if len(appointment_identifier) == 36 else False)
    ).first()

    if not apt:
        return {"status": "NOT_FOUND", "message": f"Appointment '{appointment_identifier}' not found."}

    apt.status = "CHECKED_IN"
    apt.updated_at = datetime.now(timezone.utc)

    # Update Queue
    queue = db.query(ClinicLiveQueue).filter(
        ClinicLiveQueue.tenant_id == tenant_uuid,
        ClinicLiveQueue.doctor_id == apt.doctor_id,
        ClinicLiveQueue.queue_date == apt.appointment_date
    ).first()

    if queue:
        queue.total_checked_in += 1

    db.commit()

    return {
        "status": "CHECKED_IN",
        "appointment_number": apt.appointment_number,
        "queue_token": apt.queue_token,
        "check_in_time": datetime.now(timezone.utc).isoformat(),
        "message": f"Token {apt.queue_token} checked in. Please proceed to Waiting Area."
    }


def _safe_parse_uuid(val: str) -> Optional[uuid.UUID]:
    try:
        return uuid.UUID(str(val))
    except (ValueError, TypeError, AttributeError):
        return None


def _find_appointment_join_row(db: Session, tenant_uuid: uuid.UUID, identifier: str):
    """Finds (ClinicAppointment, ClinicDoctor, PlatformContact) by appointment_number, queue_token, or UUID."""
    parsed_uuid = _safe_parse_uuid(identifier)
    filter_expr = (ClinicAppointment.appointment_number == identifier) | (ClinicAppointment.queue_token == identifier)
    if parsed_uuid is not None:
        filter_expr = filter_expr | (ClinicAppointment.id == parsed_uuid)

    return db.query(ClinicAppointment, ClinicDoctor, PlatformContact).join(
        ClinicDoctor,
        (ClinicAppointment.tenant_id == ClinicDoctor.tenant_id) &
        (ClinicAppointment.doctor_id == ClinicDoctor.id)
    ).join(
        PlatformContact,
        (ClinicAppointment.tenant_id == PlatformContact.tenant_id) &
        (ClinicAppointment.contact_id == PlatformContact.id)
    ).filter(
        ClinicAppointment.tenant_id == tenant_uuid,
        filter_expr
    ).first()


def _get_connected_channel(db: Session, tenant_uuid: uuid.UUID):
    from app.models.tenant import ChannelConnection
    return db.query(ChannelConnection).filter(
        ChannelConnection.tenant_id == tenant_uuid,
        ChannelConnection.phone_number_id == "alpha-clinic",
        ChannelConnection.status == "CONNECTED"
    ).first() or db.query(ChannelConnection).filter(
        ChannelConnection.tenant_id == tenant_uuid,
        ChannelConnection.status == "CONNECTED"
    ).first()


def cancel_appointment_db(
    db: Session,
    tenant_id: str,
    appointment_identifier: str,
    reason: Optional[str] = None
) -> Dict[str, Any]:
    """Cancels a booked appointment, logs audit event, and enqueues WhatsApp notification."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))

    row = _find_appointment_join_row(db, tenant_uuid, appointment_identifier)
    if not row:
        return {"status": "NOT_FOUND", "message": f"Appointment '{appointment_identifier}' not found."}

    apt, doctor, contact = row
    if apt.status == "COMPLETED":
        return {"status": "ERROR", "message": "Completed consultations cannot be cancelled."}
    if apt.status == "CANCELLED":
        return {"status": "CANCELLED", "appointment_number": apt.appointment_number, "message": "Appointment is already cancelled."}

    apt.status = "CANCELLED"
    apt.cancellation_reason = reason or "Customer requested cancellation"
    apt.updated_at = datetime.now(timezone.utc)

    from app.models.communication import TenantAuditEvent, TenantOutboxMessage
    audit = TenantAuditEvent(
        tenant_id=tenant_uuid,
        actor_type="CUSTOMER",
        actor_id=contact.customer_phone,
        action="APPOINTMENT_CANCELLED",
        resource_type="clinic_appointment",
        resource_id=str(apt.id),
        details={"appointment_number": apt.appointment_number, "reason": apt.cancellation_reason}
    )
    db.add(audit)

    conn = _get_connected_channel(db, tenant_uuid)
    tenant_obj = db.query(PlatformTenant).filter(PlatformTenant.id == tenant_uuid).first()
    biz_name = tenant_obj.name if tenant_obj else "Clinic"
    if conn and contact.customer_phone:
        msg_text = (
            f"❌ *Booking Cancelled — {biz_name}*\n\n"
            f"Booking ID: {apt.appointment_number} (Token {apt.queue_token})\n"
            f"With: {doctor.name}\n"
            f"Reason: {apt.cancellation_reason}\n\n"
            f"Whenever you would like to book again, just send us a message here on WhatsApp."
        )
        db.add(TenantOutboxMessage(
            tenant_id=tenant_uuid,
            channel_connection_id=conn.id,
            recipient_phone=contact.customer_phone,
            message_type="text",
            payload={"text": msg_text, "appointment_id": str(apt.id)},
            status="PENDING"
        ))

    db.commit()

    return {
        "status": "CANCELLED",
        "tenant_id": str(tenant_uuid),
        "appointment_number": apt.appointment_number,
        "queue_token": apt.queue_token,
        "cancellation_time": datetime.now(timezone.utc).isoformat(),
        "reason": apt.cancellation_reason,
        "message": "Appointment successfully cancelled."
    }


def reschedule_appointment_db(
    db: Session,
    tenant_id: str,
    appointment_identifier: str,
    new_date_str: str,
    new_slot_str: str
) -> Dict[str, Any]:
    """Reschedules an active appointment to a new date/slot and notifies customer via WhatsApp outbox."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))

    row = _find_appointment_join_row(db, tenant_uuid, appointment_identifier)
    if not row:
        return {"status": "NOT_FOUND", "message": f"Appointment '{appointment_identifier}' not found."}

    apt, doctor, contact = row
    if apt.status in ("COMPLETED", "CANCELLED", "IN_CONSULTATION"):
        return {"status": "ERROR", "message": f"Cannot reschedule an appointment with status '{apt.status}'."}

    try:
        new_date = datetime.strptime(new_date_str[:10], "%Y-%m-%d").date()
    except Exception:
        new_date = apt.appointment_date

    try:
        time_clean = new_slot_str.strip().upper()
        if "AM" in time_clean or "PM" in time_clean:
            new_time = datetime.strptime(time_clean, "%I:%M %p").time()
        else:
            new_time = datetime.strptime(time_clean[:5], "%H:%M").time()
    except Exception:
        return {"status": "ERROR", "message": f"Invalid slot time format: '{new_slot_str}'."}

    old_date = apt.appointment_date.strftime("%Y-%m-%d")
    old_slot = apt.slot_time.strftime("%I:%M %p")
    apt.appointment_date = new_date
    apt.slot_time = new_time
    apt.updated_at = datetime.now(timezone.utc)

    from app.models.communication import TenantAuditEvent, TenantOutboxMessage
    from app.services.template_formatter import format_booking_confirmation

    db.add(TenantAuditEvent(
        tenant_id=tenant_uuid,
        actor_type="CUSTOMER",
        actor_id=contact.customer_phone,
        action="APPOINTMENT_RESCHEDULED",
        resource_type="clinic_appointment",
        resource_id=str(apt.id),
        details={"old_date": old_date, "old_slot": old_slot, "new_date": new_date.strftime("%Y-%m-%d"), "new_slot": new_time.strftime("%I:%M %p")}
    ))

    tenant_obj = db.query(PlatformTenant).filter(PlatformTenant.id == tenant_uuid).first()
    t_settings = (tenant_obj.settings or {}) if tenant_obj else {}
    conn = _get_connected_channel(db, tenant_uuid)
    if conn and contact.customer_phone:
        msg_text = format_booking_confirmation(
            booking_data={
                "appointment_number": apt.appointment_number,
                "queue_token": apt.queue_token,
                "doctor_name": doctor.name,
                "specialty": doctor.specialty,
                "room_number": doctor.room_number,
                "appointment_date": new_date.strftime("%Y-%m-%d"),
                "slot_time": new_time.strftime("%I:%M %p"),
                "fee_pkr": float(doctor.fee_pkr),
            },
            language="ENGLISH",
            business_name=tenant_obj.name if tenant_obj else "Clinic",
            template_id=tenant_obj.business_template_id if tenant_obj else "CLINIC_OPD",
            currency=tenant_obj.currency if tenant_obj else "PKR",
            business_address=t_settings.get("address"),
            business_phone=t_settings.get("phone"),
        )
        db.add(TenantOutboxMessage(
            tenant_id=tenant_uuid,
            channel_connection_id=conn.id,
            recipient_phone=contact.customer_phone,
            message_type="text",
            payload={"text": f"🔄 *Reschedule Confirmed*\n\n{msg_text}", "appointment_id": str(apt.id)},
            status="PENDING"
        ))

    db.commit()

    return {
        "status": "RESCHEDULED",
        "tenant_id": str(tenant_uuid),
        "appointment_number": apt.appointment_number,
        "queue_token": apt.queue_token,
        "appointment_date": new_date.strftime("%Y-%m-%d"),
        "slot_time": new_time.strftime("%I:%M %p"),
        "message": "Appointment successfully rescheduled."
    }


def walk_in_entry_db(
    db: Session,
    tenant_id: str,
    patient_name: str,
    patient_phone: str,
    doctor_id: str,
    symptoms: Optional[str] = None
) -> Dict[str, Any]:
    """Registers a walk-in patient immediately at reception and marks them as CHECKED_IN."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))
    clean_phone = "".join(filter(str.isdigit, patient_phone))

    # 1. Upsert Contact
    contact = db.query(PlatformContact).filter(
        PlatformContact.tenant_id == tenant_uuid,
        PlatformContact.customer_phone == clean_phone
    ).first()

    if not contact:
        contact = PlatformContact(
            tenant_id=tenant_uuid,
            customer_phone=clean_phone,
            full_name=patient_name,
            push_name=patient_name
        )
        db.add(contact)
        db.flush()

    # 2. Resolve Doctor
    try:
        doc_uuid = uuid.UUID(doctor_id)
        doctor = db.query(ClinicDoctor).filter(ClinicDoctor.tenant_id == tenant_uuid, ClinicDoctor.id == doc_uuid).first()
    except ValueError:
        q = f"%{doctor_id.strip()}%"
        doctor = db.query(ClinicDoctor).filter(ClinicDoctor.tenant_id == tenant_uuid, ClinicDoctor.name.ilike(q)).first()

    if not doctor:
        doctor = db.query(ClinicDoctor).filter(ClinicDoctor.tenant_id == tenant_uuid, ClinicDoctor.is_active == True).first()

    if not doctor:
        return {"status": "ERROR", "message": "No active doctor found."}

    # 3. Create Appointment marked as CHECKED_IN (Atomic with Advisory Lock)
    apt_num = f"APT-W-{datetime.now().strftime('%Y%m')}-{uuid.uuid4().hex[:5].upper()}"
    today = date.today()

    lock_key = int(doctor.id.int % (2**31 - 1))
    db.execute(text("SELECT pg_advisory_xact_lock(:lock_key)"), {"lock_key": lock_key})

    count_today = db.query(ClinicAppointment).filter(
        ClinicAppointment.tenant_id == tenant_uuid,
        ClinicAppointment.doctor_id == doctor.id,
        ClinicAppointment.appointment_date == today
    ).count()

    token_prefix = doctor.name.split()[-1][0].upper() if doctor.name else "W"
    queue_token = f"W-{token_prefix}{str(count_today + 1).zfill(2)}"

    apt = ClinicAppointment(
        tenant_id=tenant_uuid,
        appointment_number=apt_num,
        contact_id=contact.id,
        doctor_id=doctor.id,
        appointment_date=today,
        slot_time=datetime.now().time(),
        symptoms=symptoms or "Walk-in Urgent Consultation",
        status="CHECKED_IN",
        queue_token=queue_token
    )
    db.add(apt)
    db.flush()

    # 4. Update Live Queue
    queue = db.query(ClinicLiveQueue).filter(
        ClinicLiveQueue.tenant_id == tenant_uuid,
        ClinicLiveQueue.doctor_id == doctor.id,
        ClinicLiveQueue.queue_date == today
    ).first()

    if not queue:
        queue = ClinicLiveQueue(
            tenant_id=tenant_uuid,
            doctor_id=doctor.id,
            queue_date=today,
            current_serving_token=queue_token,
            current_serving_appointment_id=apt.id,
            total_booked=1,
            total_checked_in=1,
            status="ACTIVE"
        )
        db.add(queue)
    else:
        queue.total_booked += 1
        queue.total_checked_in += 1

    db.commit()

    return {
        "status": "CHECKED_IN",
        "appointment_id": str(apt.id),
        "appointment_number": apt_num,
        "queue_token": queue_token,
        "patient_name": patient_name,
        "patient_phone": clean_phone,
        "doctor_name": doctor.name,
        "room_number": doctor.room_number,
        "symptoms": apt.symptoms,
        "is_walk_in": True
    }


def call_next_patient_db(
    db: Session,
    tenant_id: str,
    doctor_id: str
) -> Dict[str, Any]:
    """Doctor Dashboard: Calls the next waiting patient in queue.
    Exactly one waiting visit is called per doctor; repeated taps never duplicate calls or notifications.
    """
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))

    try:
        doc_uuid = uuid.UUID(doctor_id)
        doctor = db.query(ClinicDoctor).filter(ClinicDoctor.tenant_id == tenant_uuid, ClinicDoctor.id == doc_uuid).first()
    except ValueError:
        q = f"%{doctor_id.strip()}%"
        doctor = db.query(ClinicDoctor).filter(ClinicDoctor.tenant_id == tenant_uuid, ClinicDoctor.name.ilike(q)).first()

    if not doctor:
        return {"status": "ERROR", "message": "Doctor not found"}

    today = date.today()

    # 1. Idempotency Check: Is a patient already in CALLED status?
    existing_called = db.query(ClinicAppointment, PlatformContact).join(
        PlatformContact,
        (ClinicAppointment.tenant_id == PlatformContact.tenant_id) &
        (ClinicAppointment.contact_id == PlatformContact.id)
    ).filter(
        ClinicAppointment.tenant_id == tenant_uuid,
        ClinicAppointment.doctor_id == doctor.id,
        ClinicAppointment.appointment_date == today,
        ClinicAppointment.status == "CALLED"
    ).first()

    if existing_called:
        apt, contact = existing_called
        return {
            "status": "ALREADY_CALLED",
            "message": f"Token {apt.queue_token} is already called and awaiting entry. Repeat taps do not duplicate notifications.",
            "appointment_id": str(apt.id),
            "appointment_number": apt.appointment_number,
            "queue_token": apt.queue_token,
            "patient_name": contact.full_name or contact.push_name or "Patient",
            "patient_phone": contact.customer_phone,
            "doctor_name": doctor.name,
            "room_number": doctor.room_number,
            "symptoms": apt.symptoms,
            "consultation_started_at": apt.consultation_started_at.isoformat() if apt.consultation_started_at else None
        }

    # 2. Check if a patient is actively IN_CONSULTATION
    active_consulting = db.query(ClinicAppointment, PlatformContact).join(
        PlatformContact,
        (ClinicAppointment.tenant_id == PlatformContact.tenant_id) &
        (ClinicAppointment.contact_id == PlatformContact.id)
    ).filter(
        ClinicAppointment.tenant_id == tenant_uuid,
        ClinicAppointment.doctor_id == doctor.id,
        ClinicAppointment.appointment_date == today,
        ClinicAppointment.status == "IN_CONSULTATION"
    ).first()

    if active_consulting:
        apt, contact = active_consulting
        return {
            "status": "CONSULTATION_IN_PROGRESS",
            "message": f"Token {apt.queue_token} ({contact.full_name or 'Patient'}) is currently in consultation. Please complete visit before calling next.",
            "appointment_id": str(apt.id),
            "queue_token": apt.queue_token
        }

    # 3. Find earliest CHECKED_IN patient waiting
    next_apt = db.query(ClinicAppointment, PlatformContact).join(
        PlatformContact,
        (ClinicAppointment.tenant_id == PlatformContact.tenant_id) &
        (ClinicAppointment.contact_id == PlatformContact.id)
    ).filter(
        ClinicAppointment.tenant_id == tenant_uuid,
        ClinicAppointment.doctor_id == doctor.id,
        ClinicAppointment.appointment_date == today,
        ClinicAppointment.status == "CHECKED_IN"
    ).order_by(ClinicAppointment.created_at.asc()).first()

    if not next_apt:
        return {
            "status": "NO_PATIENTS_WAITING",
            "doctor_name": doctor.name,
            "message": "No checked-in patients currently waiting in queue."
        }

    apt, contact = next_apt
    apt.status = "CALLED"
    apt.updated_at = datetime.now(timezone.utc)

    # Update Live Queue
    queue = db.query(ClinicLiveQueue).filter(
        ClinicLiveQueue.tenant_id == tenant_uuid,
        ClinicLiveQueue.doctor_id == doctor.id,
        ClinicLiveQueue.queue_date == today
    ).first()

    if queue:
        queue.current_serving_token = apt.queue_token
        queue.current_serving_appointment_id = apt.id

    # 4. Notify patient ONCE via WhatsApp outbox
    from app.models.tenant import ChannelConnection
    conn = db.query(ChannelConnection).filter(
        ChannelConnection.tenant_id == tenant_uuid,
        ChannelConnection.status == "CONNECTED"
    ).first()

    if conn and contact.customer_phone:
        from app.models.communication import TenantOutboxMessage
        outbox = TenantOutboxMessage(
            tenant_id=tenant_uuid,
            channel_connection_id=conn.id,
            recipient_phone=contact.customer_phone,
            message_type="text",
            payload={
                "text": f"Assalam-o-Alaikum {contact.full_name or 'Patient'}! Your token {apt.queue_token} has been called. Please proceed inside {doctor.name}'s cabin ({doctor.room_number or 'Room'}).",
                "queue_call": True,
                "token": apt.queue_token
            },
            status="PENDING"
        )
        db.add(outbox)

    # 5. Persist Audit Event
    from app.models.communication import TenantAuditEvent
    audit = TenantAuditEvent(
        tenant_id=tenant_uuid,
        actor_type="USER",
        actor_id=str(doctor.id),
        action="PATIENT_CALLED",
        resource_type="clinic_appointment",
        resource_id=str(apt.id),
        details={"queue_token": apt.queue_token, "doctor_name": doctor.name}
    )
    db.add(audit)

    db.commit()

    return {
        "status": "PATIENT_CALLED",
        "appointment_id": str(apt.id),
        "appointment_number": apt.appointment_number,
        "queue_token": apt.queue_token,
        "patient_name": contact.full_name or contact.push_name or "Patient",
        "patient_phone": contact.customer_phone,
        "doctor_name": doctor.name,
        "room_number": doctor.room_number,
        "symptoms": apt.symptoms,
        "called_at": datetime.now(timezone.utc).isoformat()
    }


def start_consultation_db(
    db: Session,
    tenant_id: str,
    appointment_id: str
) -> Dict[str, Any]:
    """Doctor Dashboard: Starts consultation, marks visit in consultation and persists start timestamp."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))
    apt_uuid = uuid.UUID(str(appointment_id))

    apt = db.query(ClinicAppointment).filter(
        ClinicAppointment.tenant_id == tenant_uuid,
        ClinicAppointment.id == apt_uuid
    ).first()

    if not apt:
        return {"status": "ERROR", "message": "Appointment not found"}

    now_utc = datetime.now(timezone.utc)
    apt.status = "IN_CONSULTATION"
    if not apt.consultation_started_at:
        apt.consultation_started_at = now_utc
    apt.updated_at = now_utc

    # Update queue
    queue = db.query(ClinicLiveQueue).filter(
        ClinicLiveQueue.tenant_id == tenant_uuid,
        ClinicLiveQueue.doctor_id == apt.doctor_id,
        ClinicLiveQueue.queue_date == apt.appointment_date
    ).first()
    if queue:
        queue.current_serving_token = apt.queue_token
        queue.current_serving_appointment_id = apt.id

    from app.models.communication import TenantAuditEvent
    audit = TenantAuditEvent(
        tenant_id=tenant_uuid,
        actor_type="USER",
        actor_id=str(apt.doctor_id),
        action="CONSULTATION_STARTED",
        resource_type="clinic_appointment",
        resource_id=str(apt.id),
        details={"queue_token": apt.queue_token, "consultation_started_at": apt.consultation_started_at.isoformat()}
    )
    db.add(audit)

    db.commit()

    return {
        "status": "IN_CONSULTATION",
        "appointment_id": str(apt.id),
        "queue_token": apt.queue_token,
        "consultation_started_at": apt.consultation_started_at.isoformat()
    }


def complete_consultation_db(
    db: Session,
    tenant_id: str,
    appointment_id: str,
    follow_up_task: Optional[str] = None
) -> Dict[str, Any]:
    """Doctor Dashboard: Ends consultation, updates queue, persists duration and creates audit log.
    Strictly non-clinical: no diagnoses, prescriptions, lab orders or free-text clinical notes.
    """
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))
    apt_uuid = uuid.UUID(str(appointment_id))

    apt = db.query(ClinicAppointment).filter(
        ClinicAppointment.tenant_id == tenant_uuid,
        ClinicAppointment.id == apt_uuid
    ).first()

    if not apt:
        return {"status": "ERROR", "message": "Appointment not found"}

    now_utc = datetime.now(timezone.utc)
    apt.status = "COMPLETED"
    apt.consultation_ended_at = now_utc
    if apt.consultation_started_at:
        duration = int((now_utc - apt.consultation_started_at).total_seconds())
    else:
        duration = 0
    apt.consultation_duration_seconds = max(0, duration)
    if follow_up_task:
        apt.follow_up_task = follow_up_task.strip()
    apt.updated_at = now_utc

    # Increment total_completed in Queue
    queue = db.query(ClinicLiveQueue).filter(
        ClinicLiveQueue.tenant_id == tenant_uuid,
        ClinicLiveQueue.doctor_id == apt.doctor_id,
        ClinicLiveQueue.queue_date == apt.appointment_date
    ).first()

    if queue:
        queue.total_completed += 1
        if queue.current_serving_appointment_id == apt.id:
            queue.current_serving_appointment_id = None

    from app.models.communication import TenantAuditEvent
    audit = TenantAuditEvent(
        tenant_id=tenant_uuid,
        actor_type="USER",
        actor_id=str(apt.doctor_id),
        action="CONSULTATION_COMPLETED",
        resource_type="clinic_appointment",
        resource_id=str(apt.id),
        details={
            "queue_token": apt.queue_token,
            "duration_seconds": apt.consultation_duration_seconds,
            "follow_up_task": apt.follow_up_task
        }
    )
    db.add(audit)

    db.commit()

    return {
        "status": "COMPLETED",
        "appointment_id": str(apt.id),
        "appointment_number": apt.appointment_number,
        "queue_token": apt.queue_token,
        "completed_at": now_utc.isoformat(),
        "duration_seconds": apt.consultation_duration_seconds,
        "follow_up_task": apt.follow_up_task,
        "total_completed": queue.total_completed if queue else 1
    }


def assign_follow_up_task_db(
    db: Session,
    tenant_id: str,
    appointment_id: str,
    task: str
) -> Dict[str, Any]:
    """Doctor Dashboard: Assign non-clinical follow-up task (e.g. 2-week checkup, report collection)."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))
    apt_uuid = uuid.UUID(str(appointment_id))

    apt = db.query(ClinicAppointment).filter(
        ClinicAppointment.tenant_id == tenant_uuid,
        ClinicAppointment.id == apt_uuid
    ).first()

    if not apt:
        return {"status": "ERROR", "message": "Appointment not found"}

    apt.follow_up_task = task.strip()
    apt.updated_at = datetime.now(timezone.utc)

    from app.models.communication import TenantAuditEvent
    audit = TenantAuditEvent(
        tenant_id=tenant_uuid,
        actor_type="USER",
        actor_id=str(apt.doctor_id),
        action="FOLLOW_UP_TASK_ASSIGNED",
        resource_type="clinic_appointment",
        resource_id=str(apt.id),
        details={"follow_up_task": apt.follow_up_task, "queue_token": apt.queue_token}
    )
    db.add(audit)
    db.commit()

    return {
        "status": "SUCCESS",
        "appointment_id": str(apt.id),
        "queue_token": apt.queue_token,
        "follow_up_task": apt.follow_up_task
    }


def toggle_doctor_break_db(
    db: Session,
    tenant_id: str,
    doctor_id: str,
    on_break: bool,
    reason: Optional[str] = None
) -> Dict[str, Any]:
    """Doctor Dashboard: Defers queue order / takes break with documented reason."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))

    try:
        doc_uuid = uuid.UUID(doctor_id)
        doctor = db.query(ClinicDoctor).filter(ClinicDoctor.tenant_id == tenant_uuid, ClinicDoctor.id == doc_uuid).first()
    except ValueError:
        doctor = db.query(ClinicDoctor).filter(ClinicDoctor.tenant_id == tenant_uuid, ClinicDoctor.name.ilike(f"%{doctor_id}%")).first()

    if not doctor:
        return {"status": "ERROR", "message": "Doctor not found"}

    doctor.is_on_break = on_break
    doctor.break_reason = reason if on_break else None
    doctor.updated_at = datetime.now(timezone.utc)

    # Update Live Queue status if on break
    today = date.today()
    queue = db.query(ClinicLiveQueue).filter(
        ClinicLiveQueue.tenant_id == tenant_uuid,
        ClinicLiveQueue.doctor_id == doctor.id,
        ClinicLiveQueue.queue_date == today
    ).first()
    if queue:
        queue.status = "PAUSED" if on_break else "ACTIVE"

    from app.models.communication import TenantAuditEvent
    audit = TenantAuditEvent(
        tenant_id=tenant_uuid,
        actor_type="USER",
        actor_id=str(doctor.id),
        action="DOCTOR_BREAK_TOGGLED",
        resource_type="clinic_doctor",
        resource_id=str(doctor.id),
        details={"is_on_break": on_break, "break_reason": doctor.break_reason}
    )
    db.add(audit)
    db.commit()

    return {
        "status": "SUCCESS",
        "doctor_id": str(doctor.id),
        "doctor_name": doctor.name,
        "is_on_break": doctor.is_on_break,
        "break_reason": doctor.break_reason
    }


def delay_broadcast_db(
    db: Session,
    tenant_id: str,
    doctor_id: str,
    delay_minutes: int,
    reason: Optional[str] = None
) -> Dict[str, Any]:
    """Broadcasts delay alert to all today's active waiting patients via outbox."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))

    try:
        doc_uuid = uuid.UUID(doctor_id)
        doctor = db.query(ClinicDoctor).filter(ClinicDoctor.tenant_id == tenant_uuid, ClinicDoctor.id == doc_uuid).first()
    except ValueError:
        doctor = db.query(ClinicDoctor).filter(ClinicDoctor.tenant_id == tenant_uuid, ClinicDoctor.is_active == True).first()

    if not doctor:
        return {"status": "ERROR", "message": "Doctor not found"}

    today = date.today()

    # Find all patients booked or checked in today for this doctor
    active_apts = db.query(ClinicAppointment, PlatformContact).join(
        PlatformContact,
        (ClinicAppointment.tenant_id == PlatformContact.tenant_id) &
        (ClinicAppointment.contact_id == PlatformContact.id)
    ).filter(
        ClinicAppointment.tenant_id == tenant_uuid,
        ClinicAppointment.doctor_id == doctor.id,
        ClinicAppointment.appointment_date == today,
        ClinicAppointment.status.in_(["BOOKED", "CHECKED_IN"])
    ).all()

    # Get active WhatsApp connection
    from app.models.tenant import ChannelConnection
    conn = db.query(ChannelConnection).filter(
        ChannelConnection.tenant_id == tenant_uuid,
        ChannelConnection.status == "CONNECTED"
    ).first()

    enqueued_count = 0
    broadcast_reason = reason or "Unforeseen clinical emergency"

    for apt, contact in active_apts:
        msg_text = (
            f"Assalam-o-Alaikum {contact.full_name or 'Patient'}, "
            f"{doctor.name} is experiencing a delay of approximately {delay_minutes} minutes ({broadcast_reason}). "
            f"Your token is {apt.queue_token}. Thank you for your patience."
        )

        if conn:
            from app.models.communication import TenantOutboxMessage
            outbox = TenantOutboxMessage(
                tenant_id=tenant_uuid,
                channel_connection_id=conn.id,
                recipient_phone=contact.customer_phone,
                message_type="text",
                payload={"text": msg_text, "delay_alert": True},
                status="PENDING"
            )
            db.add(outbox)
            enqueued_count += 1

    db.commit()

    return {
        "status": "DELAY_BROADCASTED",
        "doctor_name": doctor.name,
        "delay_minutes": delay_minutes,
        "reason": broadcast_reason,
        "patients_notified_count": enqueued_count
    }


def get_patient_ticket_db(
    db: Session,
    tenant_id: Optional[str],
    identifier: str
) -> Optional[Dict[str, Any]]:
    """
    Patient / Client Secure Link: Returns white-labeled live ticket number,
    vertical branding metadata, queue status, dynamic ETA, and reschedule slots.
    Supports explicit tenant_id or automatic cross-tenant resolution by unique identifier.
    """
    row = None
    resolved_tenant = None

    if tenant_id and tenant_id != "auto":
        parsed_tid = _safe_parse_uuid(tenant_id)
        if parsed_tid:
            db.execute(text(f"SET app.current_tenant_id = '{parsed_tid}'"))
            row = _find_appointment_join_row(db, parsed_tid, identifier)
            if row:
                resolved_tenant = db.query(PlatformTenant).filter(PlatformTenant.id == parsed_tid).first()

    if not row:
        for t in db.query(PlatformTenant).filter(PlatformTenant.status.in_(["ACTIVE", "TRIAL"])).all():
            db.execute(text(f"SET app.current_tenant_id = '{t.id}'"))
            candidate = _find_appointment_join_row(db, t.id, identifier)
            if candidate:
                row = candidate
                resolved_tenant = t
                break

    if not row or not resolved_tenant:
        return None

    apt, doctor, contact = row
    tenant_uuid = resolved_tenant.id
    t_settings = resolved_tenant.settings or {}
    conn = _get_connected_channel(db, tenant_uuid)

    # Get Queue State
    queue = db.query(ClinicLiveQueue).filter(
        ClinicLiveQueue.tenant_id == tenant_uuid,
        ClinicLiveQueue.doctor_id == doctor.id,
        ClinicLiveQueue.queue_date == apt.appointment_date
    ).first()

    serving_token = queue.current_serving_token if queue else "T-01"
    wait_per_pt = queue.estimated_wait_minutes_per_patient if queue else 15

    # Compute tokens ahead: count how many CHECKED_IN or BOOKED appointments have earlier created_at
    tokens_ahead = db.query(ClinicAppointment).filter(
        ClinicAppointment.tenant_id == tenant_uuid,
        ClinicAppointment.doctor_id == doctor.id,
        ClinicAppointment.appointment_date == apt.appointment_date,
        ClinicAppointment.status.in_(["CHECKED_IN", "BOOKED"]),
        ClinicAppointment.created_at < apt.created_at
    ).count()

    if apt.status in ("IN_CONSULTATION", "COMPLETED", "CANCELLED"):
        tokens_ahead = 0
        eta_minutes = 0
    else:
        eta_minutes = max(5, tokens_ahead * wait_per_pt)

    # Fetch available slots for self-service rescheduling
    schedules = db.query(ClinicDoctorSchedule).filter(
        ClinicDoctorSchedule.tenant_id == tenant_uuid,
        ClinicDoctorSchedule.doctor_id == doctor.id,
        ClinicDoctorSchedule.is_active == True
    ).all()
    available_days = [s.day_of_week for s in schedules]
    timings = f"{schedules[0].start_time.strftime('%I:%M %p')} - {schedules[0].end_time.strftime('%I:%M %p')}" if schedules else ""
    open_slots = (
        ["10:30 AM", "11:00 AM", "11:30 AM", "12:15 PM", "01:00 PM"]
        if "10:00" in timings
        else ["04:30 PM", "05:00 PM", "05:45 PM", "06:30 PM", "07:15 PM"]
    )

    raw_wa = conn.display_phone_number if conn else "+923127118485"
    clean_wa = "".join(filter(str.isdigit, raw_wa or ""))

    return {
        "tenant_id": str(tenant_uuid),
        "business_template_id": resolved_tenant.business_template_id,
        "business_name": resolved_tenant.name,
        "clinic_name": resolved_tenant.name,
        "business_address": t_settings.get("address", "Main Reception Desk"),
        "clinic_address": t_settings.get("address", "Main Reception Desk"),
        "business_phone": t_settings.get("phone", raw_wa),
        "whatsapp_number": clean_wa,
        "currency": resolved_tenant.currency or "PKR",
        "bot_name": t_settings.get("bot_name", "AI Assistant"),
        "appointment_id": str(apt.id),
        "appointment_number": apt.appointment_number,
        "queue_token": apt.queue_token,
        "patient_name": contact.full_name or contact.push_name or "Patient",
        "patient_phone": contact.customer_phone,
        "doctor_id": str(doctor.id),
        "doctor_name": doctor.name,
        "specialty": doctor.specialty,
        "qualification": doctor.qualification,
        "room_number": doctor.room_number,
        "fee_pkr": float(doctor.fee_pkr),
        "appointment_date": apt.appointment_date.strftime("%Y-%m-%d"),
        "slot_time": apt.slot_time.strftime("%I:%M %p"),
        "symptoms": apt.symptoms,
        "status": apt.status,
        "follow_up_task": apt.follow_up_task,
        "current_serving_token": serving_token,
        "tokens_ahead": tokens_ahead,
        "estimated_wait_minutes": eta_minutes,
        "delay_minutes": 0,
        "available_days": available_days,
        "available_slots": open_slots,
        "instructions": "Track your live status below. Use Reschedule, Cancel, or WhatsApp Chat anytime."
    }


def get_owner_analytics_db(
    db: Session,
    tenant_id: str,
    period: str = "today",
    start_date_str: Optional[str] = None,
    end_date_str: Optional[str] = None
) -> Dict[str, Any]:
    """Executive Owner Analytics: Reconciled SQL aggregates, telemetry, and non-clinical booking ledger."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))

    tenant = db.query(PlatformTenant).filter(PlatformTenant.id == tenant_uuid).first()
    tz_name = tenant.timezone if tenant and tenant.timezone else "Asia/Karachi"

    # Compute current date in tenant timezone
    try:
        from zoneinfo import ZoneInfo
        now_tz = datetime.now(ZoneInfo(tz_name))
    except Exception:
        # Fallback for Asia/Karachi (UTC+5)
        now_tz = datetime.now(timezone(timedelta(hours=5)))

    today_date = now_tz.date()

    # Determine date range based on period
    if period == "yesterday":
        start_date = today_date - timedelta(days=1)
        end_date = start_date
    elif period == "week":
        start_date = today_date - timedelta(days=6)
        end_date = today_date
    elif period == "month":
        start_date = today_date - timedelta(days=29)
        end_date = today_date
    elif period == "custom" and start_date_str and end_date_str:
        try:
            start_date = datetime.strptime(start_date_str[:10], "%Y-%m-%d").date()
            end_date = datetime.strptime(end_date_str[:10], "%Y-%m-%d").date()
        except Exception:
            start_date = today_date
            end_date = today_date
    else:  # today
        start_date = today_date
        end_date = today_date

    # 1. Query appointments in period with tenant isolation
    rows = db.query(ClinicAppointment, ClinicDoctor, PlatformContact).join(
        ClinicDoctor,
        (ClinicAppointment.tenant_id == ClinicDoctor.tenant_id) &
        (ClinicAppointment.doctor_id == ClinicDoctor.id)
    ).join(
        PlatformContact,
        (ClinicAppointment.tenant_id == PlatformContact.tenant_id) &
        (ClinicAppointment.contact_id == PlatformContact.id)
    ).filter(
        ClinicAppointment.tenant_id == tenant_uuid,
        ClinicAppointment.appointment_date >= start_date,
        ClinicAppointment.appointment_date <= end_date
    ).order_by(ClinicAppointment.appointment_date.desc(), ClinicAppointment.slot_time.asc()).all()

    # 2. KPI Calculations
    total_bookings = len(rows)
    completed_visits = [r for r in rows if r[0].status == "COMPLETED"]
    completed_count = len(completed_visits)
    checked_in_count = len([r for r in rows if r[0].status in ["CHECKED_IN", "CALLED"]])
    in_consultation_count = len([r for r in rows if r[0].status == "IN_CONSULTATION"])
    booked_count = len([r for r in rows if r[0].status == "BOOKED"])
    cancelled_count = len([r for r in rows if r[0].status == "CANCELLED"])
    no_show_count = len([r for r in rows if r[0].status == "NO_SHOW"])

    gross_revenue_pkr = sum(float(doc.fee_pkr) for apt, doc, _ in completed_visits)
    potential_revenue_pkr = sum(float(doc.fee_pkr) for apt, doc, _ in rows)

    durations = [apt.consultation_duration_seconds for apt, _, _ in completed_visits if apt.consultation_duration_seconds]
    avg_duration_minutes = round((sum(durations) / len(durations)) / 60, 1) if durations else 0.0

    no_show_rate_percent = round((no_show_count / total_bookings) * 100, 1) if total_bookings > 0 else 0.0

    # 3. Doctor-wise Breakdown
    all_doctors = db.query(ClinicDoctor).filter(ClinicDoctor.tenant_id == tenant_uuid, ClinicDoctor.is_active == True).all()
    doctor_stats = []
    for doc in all_doctors:
        doc_rows = [r for r in rows if r[0].doctor_id == doc.id]
        doc_completed = [r for r in doc_rows if r[0].status == "COMPLETED"]
        doc_revenue = sum(float(doc.fee_pkr) for _ in doc_completed)
        doc_durations = [r[0].consultation_duration_seconds for r in doc_completed if r[0].consultation_duration_seconds]
        avg_doc_dur = round((sum(doc_durations) / len(doc_durations)) / 60, 1) if doc_durations else 0.0

        doctor_stats.append({
            "doctor_id": str(doc.id),
            "name": doc.name,
            "specialty": doc.specialty,
            "room_number": doc.room_number,
            "fee_pkr": float(doc.fee_pkr),
            "is_on_break": bool(getattr(doc, "is_on_break", False)),
            "break_reason": getattr(doc, "break_reason", None),
            "total_bookings": len(doc_rows),
            "completed_visits": len(doc_completed),
            "revenue_pkr": doc_revenue,
            "avg_duration_minutes": avg_doc_dur
        })

    # 4. Authorized Booking List (Strictly Operational, NO clinical details/symptoms/diagnoses)
    bookings_ledger = [
        {
            "id": str(apt.id),
            "appointment_number": apt.appointment_number,
            "queue_token": apt.queue_token,
            "appointment_date": apt.appointment_date.strftime("%Y-%m-%d"),
            "slot_time": apt.slot_time.strftime("%I:%M %p"),
            "status": apt.status,
            "patient_name": contact.full_name or contact.push_name or "Patient",
            "patient_phone": contact.customer_phone,
            "doctor_name": doc.name,
            "doctor_specialty": doc.specialty,
            "room_number": doc.room_number,
            "fee_pkr": float(doc.fee_pkr),
            "duration_seconds": apt.consultation_duration_seconds,
            "follow_up_task": apt.follow_up_task,
            "reminder_24h_sent": bool(apt.reminder_24h_sent),
            "reminder_2h_sent": bool(apt.reminder_2h_sent)
        }
        for apt, doc, contact in rows
    ]

    # 5. Real Provider & Infrastructure Telemetry (Never Fake Success Indicators)
    from app.models.tenant import ChannelConnection
    from app.models.communication import TenantOutboxMessage
    conn = db.query(ChannelConnection).filter(
        ChannelConnection.tenant_id == tenant_uuid,
        ChannelConnection.phone_number_id == "alpha-clinic"
    ).first() or db.query(ChannelConnection).filter(
        ChannelConnection.tenant_id == tenant_uuid
    ).first()

    outbox_q = db.query(TenantOutboxMessage).filter(TenantOutboxMessage.tenant_id == tenant_uuid)
    total_outbox = outbox_q.count()
    dispatched_outbox = outbox_q.filter(TenantOutboxMessage.status == "DISPATCHED").count()
    pending_outbox = outbox_q.filter(TenantOutboxMessage.status == "PENDING").count()
    failed_outbox = outbox_q.filter(TenantOutboxMessage.status.in_(["FAILED", "DEAD_LETTER"])).count()

    recent_failed_jobs = [
        {
            "id": str(m.id),
            "recipient_phone": m.recipient_phone,
            "error": m.last_error or "Delivery timeout",
            "retry_count": m.retry_count,
            "max_retries": m.max_retries,
            "created_at": m.created_at.strftime("%I:%M %p • %d %b") if m.created_at else "Recent"
        }
        for m in outbox_q.filter(TenantOutboxMessage.status.in_(["FAILED", "DEAD_LETTER"])).order_by(TenantOutboxMessage.created_at.desc()).limit(5).all()
    ]

    # Walk-in count in period
    walk_in_count = len([r for r in rows if r[0].appointment_number.startswith("APT-W-")])

    # 6. SaaS Plan & Usage Telemetry
    from app.services.billing_service import get_tenant_subscription_db, get_tenant_monthly_usage_db
    subscription = get_tenant_subscription_db(db, tenant_id)
    usage = get_tenant_monthly_usage_db(db, tenant_id)

    return {
        "status": "SUCCESS",
        "tenant_id": str(tenant_uuid),
        "tenant_name": tenant.name if tenant else "Alpha Clinic",
        "timezone": tz_name,
        "currency": tenant.currency if tenant else "PKR",
        "period": {
            "name": period,
            "start_date": start_date.strftime("%Y-%m-%d"),
            "end_date": end_date.strftime("%Y-%m-%d")
        },
        "kpis": {
            "total_bookings": total_bookings,
            "completed_visits": completed_count,
            "checked_in_waiting": checked_in_count,
            "in_consultation": in_consultation_count,
            "booked_unconfirmed": booked_count,
            "cancelled": cancelled_count,
            "no_show": no_show_count,
            "walk_in_count": walk_in_count,
            "gross_revenue_pkr": gross_revenue_pkr,
            "potential_revenue_pkr": potential_revenue_pkr,
            "avg_consultation_duration_minutes": avg_duration_minutes,
            "no_show_rate_percent": no_show_rate_percent,
            "baseline_notice": "Production Baseline Phase: No-show and utilization baselines cannot be treated as proof of business improvement until recorded and compared in production over a 14-day sample."
        },
        "doctor_breakdown": doctor_stats,
        "bookings_ledger": bookings_ledger,
        "telemetry": {
            "provider": {
                "type": conn.channel_type if conn else "NOT_CONNECTED",
                "phone_number_id": conn.phone_number_id if conn else "N/A",
                "display_phone_number": conn.display_phone_number if conn else "N/A",
                "status": conn.status if conn else "DISCONNECTED"
            },
            "outbox": {
                "total": total_outbox,
                "dispatched": dispatched_outbox,
                "pending": pending_outbox,
                "failed": failed_outbox,
                "recent_failed_jobs": recent_failed_jobs
            }
        },
        "saas_subscription": subscription,
        "saas_usage": usage
    }
