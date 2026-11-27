import uuid
import re
from datetime import datetime, date, time, timezone, timedelta
from typing import Dict, Any, List, Optional
from zoneinfo import ZoneInfo
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.models.clinic import ClinicDoctor, ClinicDoctorSchedule, ClinicAppointment, ClinicLiveQueue
from app.models.contact import PlatformContact
from app.models.tenant import PlatformTenant


def _normalize_phone_digits(phone: Optional[str]) -> str:
    return "".join(filter(str.isdigit, str(phone or "")))


def _get_tenant_timezone_and_now(db: Session, tenant_id: str) -> tuple[str, datetime]:
    tenant = db.query(PlatformTenant).filter(PlatformTenant.id == uuid.UUID(str(tenant_id))).first()
    tz_name = (tenant.timezone if tenant and tenant.timezone else "Asia/Karachi")
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        # Windows hosts without tzdata fall back cleanly to PKT (UTC+5)
        tz = timezone(timedelta(hours=5))
    return tz_name, datetime.now(tz)


def _parse_local_date(date_str: Optional[str], base_date: date) -> Optional[date]:
    """Parses Today, Tomorrow, weekday names, or ISO/DMY dates without guessing invalid strings."""
    if not date_str or not str(date_str).strip():
        return base_date
    raw = str(date_str).strip().lower()
    if raw in ("today", "aaj", "aj"):
        return base_date
    if raw in ("tomorrow", "kal"):
        return base_date + timedelta(days=1)
    if raw in ("day after tomorrow", "parson"):
        return base_date + timedelta(days=2)

    weekdays = {
        "monday": 0, "mon": 0, "tuesday": 1, "tue": 1, "wednesday": 2, "wed": 2,
        "thursday": 3, "thu": 3, "friday": 4, "fri": 4, "saturday": 5, "sat": 5,
        "sunday": 6, "sun": 6,
    }
    clean_wd = raw.replace("next ", "").strip()
    if clean_wd in weekdays:
        target_wd = weekdays[clean_wd]
        delta = (target_wd - base_date.weekday()) % 7
        if "next " in raw and delta == 0:
            delta = 7
        return base_date + timedelta(days=delta)

    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(raw[:10], fmt).date()
        except ValueError:
            continue
    return None


def _parse_slot_time(slot_str: Optional[str]) -> Optional[time]:
    """Parses '11:00 AM', '4:30 PM', '16:30', or '5 PM' strictly (returns None if invalid)."""
    if not slot_str or not str(slot_str).strip():
        return None
    raw = re.sub(r"\s+", " ", str(slot_str).strip().upper())
    for fmt in ("%I:%M %p", "%I %p", "%H:%M"):
        try:
            return datetime.strptime(raw, fmt).time()
        except ValueError:
            continue
    if len(raw) >= 5:
        try:
            return datetime.strptime(raw[:5], "%H:%M").time()
        except ValueError:
            pass
    return None


def _compute_slots_for_day(
    db: Session,
    tenant_uuid: uuid.UUID,
    doctor_id: uuid.UUID,
    schedules: List[ClinicDoctorSchedule],
    target_date: date,
    now_local: datetime,
    exclude_appointment_id: Optional[uuid.UUID] = None,
) -> tuple[List[str], List[ClinicDoctorSchedule]]:
    """Generates genuinely open, non-past, non-booked time slots for target_date from DB schedules."""
    day_name = target_date.strftime("%A").lower()
    day_schedules = [s for s in schedules if (s.day_of_week or "").strip().lower() == day_name]
    if not day_schedules:
        return [], []

    booked_query = db.query(ClinicAppointment).filter(
        ClinicAppointment.tenant_id == tenant_uuid,
        ClinicAppointment.doctor_id == doctor_id,
        ClinicAppointment.appointment_date == target_date,
        ClinicAppointment.status.notin_(["CANCELLED", "NO_SHOW"]),
    )
    if exclude_appointment_id is not None:
        booked_query = booked_query.filter(ClinicAppointment.id != exclude_appointment_id)

    booked_times = {a.slot_time.strftime("%H:%M") for a in booked_query.all() if a.slot_time}
    min_cutoff_time = (now_local + timedelta(minutes=15)).time() if target_date == now_local.date() else None

    open_slots: List[str] = []
    seen = set()
    for sched in sorted(day_schedules, key=lambda x: x.start_time):
        step_min = max(5, int(sched.slot_duration_minutes or 15))
        cap = max(1, int(sched.max_patients_per_session or 40))
        cur_dt = datetime.combine(target_date, sched.start_time)
        end_dt = datetime.combine(target_date, sched.end_time)
        generated_in_sched = 0
        while cur_dt < end_dt and generated_in_sched < cap:
            t_val = cur_dt.time()
            hhmm = t_val.strftime("%H:%M")
            is_future_enough = (min_cutoff_time is None) or (t_val > min_cutoff_time)
            if hhmm not in booked_times and hhmm not in seen and is_future_enough:
                open_slots.append(t_val.strftime("%I:%M %p"))
                seen.add(hhmm)
            generated_in_sched += 1
            cur_dt += timedelta(minutes=step_min)

    return open_slots, day_schedules


SPECIALTY_SYNONYM_MAP: Dict[str, str] = {
    "child": "Pediatrics",
    "children": "Pediatrics",
    "kid": "Pediatrics",
    "kids": "Pediatrics",
    "baby": "Pediatrics",
    "bacha": "Pediatrics",
    "bachay": "Pediatrics",
    "bachon": "Pediatrics",
    "infant": "Pediatrics",
    "pediatric": "Pediatrics",
    "pediatrician": "Pediatrics",
    "heart": "Cardiology",
    "cardio": "Cardiology",
    "dil": "Cardiology",
    "bp": "Cardiology",
    "hypertension": "Cardiology",
    "cardiologist": "Cardiology",
    "physician": "General Medicine",
    "general physician": "General Medicine",
    "medicine": "General Medicine",
    "general": "General Medicine",
    "fever": "General Medicine",
    "flu": "General Medicine",
    "bukhar": "General Medicine",
}


def _resolve_doctor_strict(
    db: Session,
    tenant_uuid: uuid.UUID,
    doctor_name_or_id: str,
) -> Dict[str, Any]:
    """Resolves a doctor without silent cross-doctor fallbacks."""
    doc_query = db.query(ClinicDoctor).filter(
        ClinicDoctor.tenant_id == tenant_uuid,
        ClinicDoctor.is_active == True,
    )
    raw = (doctor_name_or_id or "").strip()
    if not raw:
        return {"status": "NOT_FOUND", "doctors": []}

    parsed = _safe_parse_uuid(raw)
    if parsed is not None:
        doc = doc_query.filter(ClinicDoctor.id == parsed).first()
        return {"status": "MATCHED", "doctor": doc} if doc else {"status": "NOT_FOUND", "doctors": []}

    q = f"%{raw}%"
    by_name = doc_query.filter(ClinicDoctor.name.ilike(q)).all()
    if len(by_name) == 1:
        return {"status": "MATCHED", "doctor": by_name[0]}
    if len(by_name) > 1:
        return {"status": "AMBIGUOUS", "doctors": by_name}

    by_spec = doc_query.filter(ClinicDoctor.specialty.ilike(q)).all()
    if not by_spec:
        raw_lower = raw.lower()
        for syn_k, syn_v in SPECIALTY_SYNONYM_MAP.items():
            if syn_k in raw_lower:
                by_spec = doc_query.filter(ClinicDoctor.specialty.ilike(f"%{syn_v}%")).all()
                break

    if len(by_spec) == 1:
        return {"status": "MATCHED", "doctor": by_spec[0]}
    if len(by_spec) > 1:
        return {"status": "AMBIGUOUS", "doctors": by_spec}

    return {"status": "NOT_FOUND", "doctors": []}


def get_doctor_schedule_db(
    db: Session,
    tenant_id: str,
    doctor_name_or_specialty: Optional[str] = None,
    date_str: Optional[str] = None,
    preferred_time: Optional[str] = None,
) -> Dict[str, Any]:
    """Retrieves active doctors and genuinely open DB slots for target date (empty means empty)."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))
    _, now_local = _get_tenant_timezone_and_now(db, tenant_id)

    target_date = _parse_local_date(date_str, now_local.date())
    if target_date is None:
        return {
            "status": "INVALID_DATE",
            "message": f"Could not understand date '{date_str}'. Please provide a clear date such as Today, Tomorrow, or YYYY-MM-DD.",
            "doctors": [],
        }

    if target_date < now_local.date():
        return {
            "status": "INVALID_DATE",
            "message": f"Date '{target_date.isoformat()}' is in the past. Please choose today ({now_local.date().isoformat()}) or a future date.",
            "doctors": [],
        }

    query = db.query(ClinicDoctor).filter(
        ClinicDoctor.tenant_id == tenant_uuid,
        ClinicDoctor.is_active == True,
    )

    if doctor_name_or_specialty:
        q = f"%{doctor_name_or_specialty.strip()}%"
        raw_lower = doctor_name_or_specialty.strip().lower()
        mapped_spec = None
        for syn_k, syn_v in SPECIALTY_SYNONYM_MAP.items():
            if syn_k in raw_lower:
                mapped_spec = syn_v
                break
        if mapped_spec:
            query = query.filter(
                (ClinicDoctor.name.ilike(q)) |
                (ClinicDoctor.specialty.ilike(q)) |
                (ClinicDoctor.specialty.ilike(f"%{mapped_spec}%"))
            )
        else:
            query = query.filter((ClinicDoctor.name.ilike(q)) | (ClinicDoctor.specialty.ilike(q)))

    doctors = query.order_by(ClinicDoctor.name.asc()).all()

    if not doctors:
        all_specs = [
            r[0]
            for r in db.query(ClinicDoctor.specialty)
            .filter(ClinicDoctor.tenant_id == tenant_uuid, ClinicDoctor.is_active == True)
            .distinct()
            .all()
        ]
        return {
            "status": "NOT_FOUND",
            "message": f"No active doctor found matching '{doctor_name_or_specialty}'.",
            "available_specialties": all_specs,
            "doctors": [],
        }

    pref_parsed = _parse_slot_time(preferred_time) if preferred_time else None
    pref_formatted = pref_parsed.strftime("%I:%M %p") if pref_parsed else None

    results = []
    total_open_slots = 0
    for doc in doctors:
        schedules = db.query(ClinicDoctorSchedule).filter(
            ClinicDoctorSchedule.tenant_id == tenant_uuid,
            ClinicDoctorSchedule.doctor_id == doc.id,
            ClinicDoctorSchedule.is_active == True,
        ).all()

        seen_days: List[str] = []
        for s in schedules:
            if s.day_of_week not in seen_days:
                seen_days.append(s.day_of_week)

        if bool(getattr(doc, "is_on_break", False)):
            open_slots: List[str] = []
            day_scheds: List[ClinicDoctorSchedule] = []
        else:
            open_slots, day_scheds = _compute_slots_for_day(
                db=db,
                tenant_uuid=tenant_uuid,
                doctor_id=doc.id,
                schedules=schedules,
                target_date=target_date,
                now_local=now_local,
            )

        if day_scheds:
            timings = f"{day_scheds[0].start_time.strftime('%I:%M %p')} - {day_scheds[0].end_time.strftime('%I:%M %p')}"
        elif schedules:
            timings = f"{schedules[0].start_time.strftime('%I:%M %p')} - {schedules[0].end_time.strftime('%I:%M %p')} ({', '.join(seen_days)})"
        else:
            timings = "Schedule not published"

        next_avail_date = None
        next_avail_slots: List[str] = []
        if not open_slots and not bool(getattr(doc, "is_on_break", False)):
            for offset in range(1, 8):
                cand_date = target_date + timedelta(days=offset)
                cand_slots, _ = _compute_slots_for_day(
                    db=db,
                    tenant_uuid=tenant_uuid,
                    doctor_id=doc.id,
                    schedules=schedules,
                    target_date=cand_date,
                    now_local=now_local,
                )
                if cand_slots:
                    next_avail_date = cand_date.isoformat()
                    next_avail_slots = cand_slots[:5]
                    break

        nearest_slots = list(open_slots)
        if pref_parsed and open_slots:
            pref_min = pref_parsed.hour * 60 + pref_parsed.minute
            nearest_slots = sorted(
                open_slots,
                key=lambda s: abs(
                    (datetime.strptime(s, "%I:%M %p").hour * 60 + datetime.strptime(s, "%I:%M %p").minute) - pref_min
                ),
            )

        total_open_slots += len(open_slots)
        results.append({
            "doctor_id": str(doc.id),
            "name": doc.name,
            "specialty": doc.specialty,
            "qualification": doc.qualification,
            "fee_pkr": float(doc.fee_pkr),
            "fee": f"PKR {doc.fee_pkr:0.0f}",
            "room_number": doc.room_number,
            "on_break": bool(getattr(doc, "is_on_break", False)),
            "break_reason": getattr(doc, "break_reason", None),
            "consulting_hours": timings,
            "available_days": seen_days,
            "query_date": target_date.isoformat(),
            "open_slots": nearest_slots[:8],
            "total_open_slots": len(open_slots),
            "preferred_time_available": (pref_formatted in open_slots) if pref_formatted else None,
            "next_available_date": next_avail_date,
            "next_available_slots": next_avail_slots,
        })

    return {
        "status": "SUCCESS",
        "query_date": target_date.isoformat(),
        "day_of_week": target_date.strftime("%A"),
        "matched_count": len(results),
        "total_open_slots": total_open_slots,
        "empty_availability": total_open_slots == 0,
        "doctors": results,
    }


def book_appointment_db(
    db: Session,
    tenant_id: str,
    patient_phone: str,
    patient_name: str,
    doctor_name_or_id: str,
    appointment_date_str: str,
    slot_time_str: str,
    symptoms: Optional[str] = None,
    confirmed: Optional[bool] = None,
    enforce_slot_check: bool = False,
    idempotency_key: Optional[str] = None,
    patient_age: Optional[int] = None,
    appointment_type: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Books a clinic appointment with strict doctor/slot verification, advisory lock
    conflict checking, idempotency replay, and explicit confirmation gating.
    """
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))

    clean_phone = _normalize_phone_digits(patient_phone)
    tenant_uuid = uuid.UUID(str(tenant_id))

    if len(clean_phone) < 10 or not (patient_name or "").strip():
        return {
            "status": "INVALID_INPUT",
            "message": "Patient full name and valid WhatsApp phone number are required before booking.",
        }

    # 1. Idempotency replay guard
    if idempotency_key:
        tag = f"[IDEMP:{idempotency_key.strip()}]"
        existing_idemp = (
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
            .filter(
                ClinicAppointment.tenant_id == tenant_uuid,
                ClinicAppointment.notes.ilike(f"%{tag}%"),
                ClinicAppointment.status != "CANCELLED",
            )
            .first()
        )
        if existing_idemp:
            apt, doctor, contact = existing_idemp
            return {
                "status": "CONFIRMED",
                "idempotent_replay": True,
                "appointment_id": str(apt.id),
                "appointment_number": apt.appointment_number,
                "queue_token": apt.queue_token,
                "patient_name": contact.full_name or patient_name,
                "patient_phone": contact.customer_phone,
                "doctor_id": str(doctor.id),
                "doctor_name": doctor.name,
                "specialty": doctor.specialty,
                "room_number": doctor.room_number,
                "fee_pkr": float(doctor.fee_pkr),
                "appointment_date": apt.appointment_date.strftime("%Y-%m-%d"),
                "slot_time": apt.slot_time.strftime("%I:%M %p"),
                "symptoms": apt.symptoms,
                "instructions": f"Please arrive at {doctor.room_number} 10 minutes prior to your slot. Present Token {apt.queue_token}.",
            }

    # 2. Resolve Doctor strictly
    resolved = _resolve_doctor_strict(db, tenant_uuid, doctor_name_or_id)
    if resolved["status"] == "AMBIGUOUS":
        return {
            "status": "AMBIGUOUS_DOCTOR",
            "message": f"Multiple doctors matched '{doctor_name_or_id}'. Please ask the patient which doctor they prefer.",
            "candidates": [
                {"doctor_id": str(d.id), "name": d.name, "specialty": d.specialty, "fee_pkr": float(d.fee_pkr)}
                for d in resolved["doctors"]
            ],
        }
    if resolved["status"] == "NOT_FOUND":
        if enforce_slot_check:
            all_docs = db.query(ClinicDoctor).filter(ClinicDoctor.tenant_id == tenant_uuid, ClinicDoctor.is_active == True).all()
            return {
                "status": "DOCTOR_NOT_FOUND",
                "message": f"No active doctor matched '{doctor_name_or_id}'.",
                "available_doctors": [
                    {"doctor_id": str(d.id), "name": d.name, "specialty": d.specialty, "fee_pkr": float(d.fee_pkr)}
                    for d in all_docs
                ],
            }
        doctor = db.query(ClinicDoctor).filter(ClinicDoctor.tenant_id == tenant_uuid, ClinicDoctor.is_active == True).first()
        if not doctor:
            return {"status": "ERROR", "message": "No active doctors available in clinic."}
    else:
        doctor = resolved["doctor"]

    # 3. Parse Appointment Date & Time strictly when enforce_slot_check=True
    _, now_local = _get_tenant_timezone_and_now(db, tenant_id)
    apt_date = _parse_local_date(appointment_date_str, now_local.date())
    apt_time = _parse_slot_time(slot_time_str)

    if enforce_slot_check:
        if apt_date is None:
            return {"status": "INVALID_INPUT", "message": f"Invalid appointment date '{appointment_date_str}'."}
        if apt_date < now_local.date():
            return {"status": "INVALID_INPUT", "message": f"Cannot book an appointment in the past ({apt_date.isoformat()})."}
        if apt_time is None:
            return {"status": "INVALID_INPUT", "message": f"Invalid slot time '{slot_time_str}'."}
    else:
        apt_date = apt_date or date.today()
        apt_time = apt_time or time(11, 0)

    visit_type = (appointment_type or "NEW_VISIT").strip().upper()

    # 4. Explicit 2-Step Confirmation Gate (when confirmed is False or enforce_slot_check without confirmed=True)
    if confirmed is False or (enforce_slot_check and confirmed is not True):
        return {
            "status": "CONFIRMATION_REQUIRED",
            "message": "Patient confirmation is required before writing booking to database. Present this summary and ask for 'Confirm'.",
            "summary": {
                "patient_name": patient_name.strip(),
                "patient_phone": clean_phone,
                "patient_age": patient_age,
                "appointment_type": visit_type,
                "doctor_id": str(doctor.id),
                "doctor_name": doctor.name,
                "specialty": doctor.specialty,
                "room_number": doctor.room_number,
                "appointment_date": apt_date.strftime("%Y-%m-%d"),
                "slot_time": apt_time.strftime("%I:%M %p"),
                "fee_pkr": float(doctor.fee_pkr),
                "symptoms": symptoms or "General Consultation",
            },
        }

    # 5. Upsert Platform Contact (persisting full_name & patient_profile cleanly in metadata JSONB)
    contact = db.query(PlatformContact).filter(
        PlatformContact.tenant_id == tenant_uuid,
        PlatformContact.customer_phone == clean_phone,
    ).first()

    profile_patch = {
        "full_name": patient_name.strip(),
        "full_name_confirmed": True,
        "preferred_department": doctor.specialty,
        "preferred_doctor": doctor.name,
        "preferred_time": apt_time.strftime("%I:%M %p"),
        "appointment_type": visit_type,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if patient_age is not None:
        profile_patch["age"] = patient_age

    if not contact:
        contact_meta = {"patient_profile": profile_patch}
        if patient_age is not None:
            contact_meta["age"] = patient_age
        contact = PlatformContact(
            tenant_id=tenant_uuid,
            customer_phone=clean_phone,
            full_name=patient_name.strip(),
            push_name=patient_name.strip(),
            metadata_=contact_meta,
        )
        db.add(contact)
        db.flush()
    else:
        if patient_name.strip() and (not contact.full_name or contact.full_name in ("Test Patient", "Valued Patient", "Customer")):
            contact.full_name = patient_name.strip()
        elif patient_name.strip():
            contact.full_name = patient_name.strip()
        meta = dict(contact.metadata_ or {})
        existing_prof = dict(meta.get("patient_profile") or {})
        existing_prof.update(profile_patch)
        meta["patient_profile"] = existing_prof
        if patient_age is not None:
            meta["age"] = patient_age
        contact.metadata_ = meta

    # 6. Advisory lock per doctor to serialize slot checks & queue token assignment
    lock_key = int(doctor.id.int % (2**31 - 1))
    db.execute(text("SELECT pg_advisory_xact_lock(:lock_key)"), {"lock_key": lock_key})

    if enforce_slot_check:
        if bool(getattr(doctor, "is_on_break", False)):
            return {
                "status": "DOCTOR_ON_BREAK",
                "message": f"{doctor.name} is currently unavailable/on break ({doctor.break_reason or 'Scheduled break'}).",
            }

        schedules = db.query(ClinicDoctorSchedule).filter(
            ClinicDoctorSchedule.tenant_id == tenant_uuid,
            ClinicDoctorSchedule.doctor_id == doctor.id,
            ClinicDoctorSchedule.is_active == True,
        ).all()
        open_slots, _ = _compute_slots_for_day(
            db=db,
            tenant_uuid=tenant_uuid,
            doctor_id=doctor.id,
            schedules=schedules,
            target_date=apt_date,
            now_local=now_local,
        )
        requested_label = apt_time.strftime("%I:%M %p")
        if requested_label not in open_slots:
            return {
                "status": "SLOT_CONFLICT",
                "message": f"Slot {requested_label} on {apt_date.isoformat()} with {doctor.name} is unavailable or already booked.",
                "doctor_id": str(doctor.id),
                "doctor_name": doctor.name,
                "query_date": apt_date.isoformat(),
                "open_slots": open_slots[:6],
            }

    apt_num = f"APT-{datetime.now().strftime('%Y%m')}-{uuid.uuid4().hex[:6].upper()}"

    count_today = db.query(ClinicAppointment).filter(
        ClinicAppointment.tenant_id == tenant_uuid,
        ClinicAppointment.doctor_id == doctor.id,
        ClinicAppointment.appointment_date == apt_date,
    ).count()

    token_prefix = doctor.name.split()[-1][0].upper() if doctor.name else "T"
    queue_token = f"T-{token_prefix}{str(count_today + 1).zfill(2)}"

    notes_parts = [f"[TYPE:{visit_type}]"]
    if patient_age is not None:
        notes_parts.append(f"[AGE:{patient_age}]")
    if idempotency_key:
        notes_parts.append(f"[IDEMP:{idempotency_key.strip()}]")

    # 7. Create Appointment Record
    appointment = ClinicAppointment(
        tenant_id=tenant_uuid,
        appointment_number=apt_num,
        contact_id=contact.id,
        doctor_id=doctor.id,
        appointment_date=apt_date,
        slot_time=apt_time,
        symptoms=symptoms or "General Consultation",
        status="BOOKED",
        queue_token=queue_token,
        notes=" ".join(notes_parts),
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
    doctor_name: Optional[str] = None,
    patient_phone: Optional[str] = None,
) -> Dict[str, Any]:
    """Fetches real-time live OPD queue status from PostgreSQL platform_db (zero fake defaults)."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))
    _, now_local = _get_tenant_timezone_and_now(db, tenant_id)
    today_local = now_local.date()

    target_row = None
    if appointment_number_or_token:
        target_row = _find_appointment_join_row(db, tenant_uuid, appointment_number_or_token.strip())
    elif patient_phone:
        clean_ph = _normalize_phone_digits(patient_phone)
        if clean_ph:
            target_row = (
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
                .filter(
                    ClinicAppointment.tenant_id == tenant_uuid,
                    PlatformContact.customer_phone == clean_ph,
                    ClinicAppointment.appointment_date == today_local,
                    ClinicAppointment.status.notin_(["CANCELLED", "NO_SHOW"]),
                )
                .order_by(ClinicAppointment.created_at.desc())
                .first()
            )

    if target_row:
        apt, doctor, _ = target_row
        queue = db.query(ClinicLiveQueue).filter(
            ClinicLiveQueue.tenant_id == tenant_uuid,
            ClinicLiveQueue.doctor_id == doctor.id,
            ClinicLiveQueue.queue_date == apt.appointment_date,
        ).first()
        current_token = queue.current_serving_token if queue and queue.current_serving_token else "Not started"
        wait_per_pt = queue.estimated_wait_minutes_per_patient if queue else 15

        if apt.status == "BOOKED":
            return {
                "status": "NOT_CHECKED_IN",
                "appointment_number": apt.appointment_number,
                "doctor_name": doctor.name,
                "room_number": doctor.room_number,
                "appointment_date": apt.appointment_date.strftime("%Y-%m-%d"),
                "slot_time": apt.slot_time.strftime("%I:%M %p"),
                "current_token_serving": current_token,
                "message": "You are booked, but not checked in yet. Please check in when you arrive at the clinic.",
            }

        tokens_ahead = db.query(ClinicAppointment).filter(
            ClinicAppointment.tenant_id == tenant_uuid,
            ClinicAppointment.doctor_id == doctor.id,
            ClinicAppointment.appointment_date == apt.appointment_date,
            ClinicAppointment.status.in_(["CHECKED_IN", "CALLED"]),
            ClinicAppointment.created_at < apt.created_at,
        ).count()
        if apt.status in ("IN_CONSULTATION", "COMPLETED"):
            tokens_ahead = 0
            wait_time = 0
        else:
            wait_time = max(5, tokens_ahead * wait_per_pt)

        return {
            "status": "ACTIVE_QUEUE",
            "appointment_number": apt.appointment_number,
            "appointment_status": apt.status,
            "doctor_name": doctor.name,
            "room_number": doctor.room_number,
            "current_token_serving": current_token,
            "your_token": apt.queue_token,
            "tokens_ahead": tokens_ahead,
            "queue_position": tokens_ahead + 1,
            "estimated_wait_minutes": wait_time,
            "eta_disclaimer": "Estimate, not a guarantee",
            "queue_health": "PAUSED" if getattr(doctor, "is_on_break", False) else "ON_SCHEDULE",
        }

    # Doctor-level queue lookup without a specific patient token
    q_query = db.query(ClinicLiveQueue).filter(
        ClinicLiveQueue.tenant_id == tenant_uuid,
        ClinicLiveQueue.queue_date == today_local,
    )
    resolved_doc = None
    if doctor_name:
        res = _resolve_doctor_strict(db, tenant_uuid, doctor_name)
        if res["status"] == "MATCHED":
            resolved_doc = res["doctor"]
            q_query = q_query.filter(ClinicLiveQueue.doctor_id == resolved_doc.id)

    queue = q_query.first()
    if not queue:
        return {
            "status": "NO_ACTIVE_QUEUE",
            "message": "No active OPD queue session is running right now for the requested date/doctor.",
        }

    waiting_count = db.query(ClinicAppointment).filter(
        ClinicAppointment.tenant_id == tenant_uuid,
        ClinicAppointment.doctor_id == queue.doctor_id,
        ClinicAppointment.appointment_date == today_local,
        ClinicAppointment.status.in_(["CHECKED_IN", "CALLED"]),
    ).count()
    wait_time = waiting_count * (queue.estimated_wait_minutes_per_patient or 15)

    return {
        "status": "ACTIVE_QUEUE",
        "doctor_name": resolved_doc.name if resolved_doc else (doctor_name or "OPD Queue"),
        "current_token_serving": queue.current_serving_token or "Not started",
        "total_booked": queue.total_booked,
        "total_checked_in": queue.total_checked_in,
        "tokens_ahead": waiting_count,
        "estimated_wait_minutes": wait_time,
        "eta_disclaimer": "Estimate, not a guarantee",
        "queue_health": queue.status or "ACTIVE",
    }


def check_in_patient_db(
    db: Session,
    tenant_id: str,
    appointment_identifier: str,
    caller_phone: Optional[str] = None,
    enforce_checks: bool = False,
) -> Dict[str, Any]:
    """Marks patient as arrived, verifies ownership/date when enforced, and returns token, position, and ETA."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))

    row = _find_appointment_join_row(db, tenant_uuid, appointment_identifier)
    if not row:
        return {"status": "NOT_FOUND", "message": f"Appointment '{appointment_identifier}' not found."}

    apt, doctor, contact = row
    if caller_phone:
        req_digits = _normalize_phone_digits(caller_phone)
        own_digits = _normalize_phone_digits(contact.customer_phone)
        if req_digits and own_digits and req_digits[-10:] != own_digits[-10:]:
            return {"status": "PRIVACY_VIOLATION", "message": "Appointment belongs to another patient and cannot be checked in from this number."}

    if apt.status in ("CANCELLED", "NO_SHOW", "COMPLETED", "IN_CONSULTATION"):
        return {"status": "ERROR", "message": f"Cannot check in an appointment with status '{apt.status}'."}

    _, now_local = _get_tenant_timezone_and_now(db, tenant_id)
    if enforce_checks and apt.appointment_date != now_local.date():
        return {
            "status": "NOT_TODAY",
            "appointment_number": apt.appointment_number,
            "appointment_date": apt.appointment_date.strftime("%Y-%m-%d"),
            "message": f"Check-in is only open on your appointment date ({apt.appointment_date.strftime('%Y-%m-%d')}).",
        }

    already_checked_in = apt.status in ("CHECKED_IN", "CALLED")
    if not already_checked_in:
        apt.status = "CHECKED_IN"
        apt.updated_at = datetime.now(timezone.utc)

    queue = db.query(ClinicLiveQueue).filter(
        ClinicLiveQueue.tenant_id == tenant_uuid,
        ClinicLiveQueue.doctor_id == apt.doctor_id,
        ClinicLiveQueue.queue_date == apt.appointment_date
    ).first()

    if queue and not already_checked_in:
        queue.total_checked_in = (queue.total_checked_in or 0) + 1

    db.commit()

    wait_per_pt = queue.estimated_wait_minutes_per_patient if queue else 15
    tokens_ahead = db.query(ClinicAppointment).filter(
        ClinicAppointment.tenant_id == tenant_uuid,
        ClinicAppointment.doctor_id == apt.doctor_id,
        ClinicAppointment.appointment_date == apt.appointment_date,
        ClinicAppointment.status.in_(["CHECKED_IN", "CALLED"]),
        ClinicAppointment.created_at < apt.created_at,
    ).count()
    eta_minutes = max(5, tokens_ahead * wait_per_pt) if tokens_ahead > 0 else 5

    return {
        "status": "CHECKED_IN",
        "appointment_number": apt.appointment_number,
        "queue_token": apt.queue_token,
        "doctor_name": doctor.name,
        "room_number": doctor.room_number,
        "queue_position": tokens_ahead + 1,
        "tokens_ahead": tokens_ahead,
        "estimated_wait_minutes": eta_minutes,
        "eta_disclaimer": "Estimate, not a guarantee",
        "check_in_time": now_local.strftime("%I:%M %p"),
        "message": f"Checked in! Token {apt.queue_token} | Queue position #{tokens_ahead + 1} | Est. wait ~{eta_minutes} min (Estimate, not a guarantee)."
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


def _enforce_policy_window(
    db: Session,
    tenant_uuid: uuid.UUID,
    apt: ClinicAppointment,
    now_local: datetime,
    action_label: str,
) -> Optional[Dict[str, Any]]:
    """Checks tenant cancellation_window_hours cutoff when modifying existing appointments."""
    tenant = db.query(PlatformTenant).filter(PlatformTenant.id == tenant_uuid).first()
    t_settings = (tenant.settings or {}) if tenant else {}
    window_hours = float(t_settings.get("cancellation_window_hours") or 2)
    if window_hours <= 0:
        return None
    apt_local_dt = datetime.combine(apt.appointment_date, apt.slot_time, tzinfo=now_local.tzinfo)
    diff_hours = (apt_local_dt - now_local).total_seconds() / 3600.0
    if diff_hours < window_hours:
        rec_phone = t_settings.get("phone") or "Clinic Reception"
        return {
            "status": "POLICY_WINDOW_EXPIRED",
            "appointment_number": apt.appointment_number,
            "window_hours": window_hours,
            "reception_phone": rec_phone,
            "handoff_recommended": True,
            "message": f"Online/WhatsApp {action_label} requires at least {window_hours:g} hours advance notice. Please contact Reception ({rec_phone}) or talk to a human coordinator.",
        }
    return None


def cancel_appointment_db(
    db: Session,
    tenant_id: str,
    appointment_identifier: str,
    reason: Optional[str] = None,
    customer_phone: Optional[str] = None,
    confirmed: Optional[bool] = None,
    enforce_checks: bool = False,
) -> Dict[str, Any]:
    """Cancels a booked appointment, enforces patient ownership & policy window, logs audit event, and enqueues WhatsApp notification."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))

    row = _find_appointment_join_row(db, tenant_uuid, appointment_identifier)
    if not row:
        return {"status": "NOT_FOUND", "message": f"Appointment '{appointment_identifier}' not found."}

    apt, doctor, contact = row
    if customer_phone:
        req_digits = _normalize_phone_digits(customer_phone)
        own_digits = _normalize_phone_digits(contact.customer_phone)
        if req_digits and own_digits and req_digits[-10:] != own_digits[-10:]:
            return {"status": "PRIVACY_VIOLATION", "message": "Appointment belongs to another patient and cannot be cancelled from this number."}

    if apt.status == "COMPLETED":
        return {"status": "ERROR", "message": "Completed consultations cannot be cancelled."}
    if apt.status == "CANCELLED":
        return {"status": "CANCELLED", "appointment_number": apt.appointment_number, "message": "Appointment is already cancelled."}

    if enforce_checks:
        _, now_local = _get_tenant_timezone_and_now(db, tenant_id)
        policy_err = _enforce_policy_window(db, tenant_uuid, apt, now_local, "cancellation")
        if policy_err:
            return policy_err

    if confirmed is False or (enforce_checks and confirmed is not True):
        return {
            "status": "CONFIRMATION_REQUIRED",
            "message": "Please confirm cancellation with the patient before modifying the database.",
            "summary": {
                "appointment_number": apt.appointment_number,
                "doctor_name": doctor.name,
                "appointment_date": apt.appointment_date.strftime("%Y-%m-%d"),
                "slot_time": apt.slot_time.strftime("%I:%M %p"),
            },
        }

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
    new_slot_str: str,
    customer_phone: Optional[str] = None,
    enforce_checks: bool = False,
    confirmed: Optional[bool] = None,
) -> Dict[str, Any]:
    """Reschedules an active appointment with slot conflict locking and notifies customer via WhatsApp outbox."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))

    row = _find_appointment_join_row(db, tenant_uuid, appointment_identifier)
    if not row:
        return {"status": "NOT_FOUND", "message": f"Appointment '{appointment_identifier}' not found."}

    apt, doctor, contact = row
    if customer_phone:
        req_digits = _normalize_phone_digits(customer_phone)
        own_digits = _normalize_phone_digits(contact.customer_phone)
        if req_digits and own_digits and req_digits[-10:] != own_digits[-10:]:
            return {"status": "PRIVACY_VIOLATION", "message": "Appointment belongs to another patient and cannot be rescheduled from this number."}

    if apt.status in ("COMPLETED", "CANCELLED", "IN_CONSULTATION"):
        return {"status": "ERROR", "message": f"Cannot reschedule an appointment with status '{apt.status}'."}

    _, now_local = _get_tenant_timezone_and_now(db, tenant_id)
    if enforce_checks:
        policy_err = _enforce_policy_window(db, tenant_uuid, apt, now_local, "rescheduling")
        if policy_err:
            return policy_err

    new_date = _parse_local_date(new_date_str, now_local.date())
    new_time = _parse_slot_time(new_slot_str)

    if enforce_checks:
        if new_date is None:
            return {"status": "INVALID_INPUT", "message": f"Invalid target date '{new_date_str}'."}
        if new_date < now_local.date():
            return {"status": "INVALID_INPUT", "message": f"Cannot reschedule to a past date ({new_date.isoformat()})."}
        if new_time is None:
            return {"status": "INVALID_INPUT", "message": f"Invalid slot time format: '{new_slot_str}'."}
    else:
        new_date = new_date or apt.appointment_date
        if new_time is None:
            return {"status": "ERROR", "message": f"Invalid slot time format: '{new_slot_str}'."}

    if confirmed is False or (enforce_checks and confirmed is not True):
        return {
            "status": "CONFIRMATION_REQUIRED",
            "message": "Patient confirmation required before rescheduling.",
            "summary": {
                "appointment_number": apt.appointment_number,
                "doctor_name": doctor.name,
                "old_date": apt.appointment_date.strftime("%Y-%m-%d"),
                "old_slot": apt.slot_time.strftime("%I:%M %p"),
                "new_date": new_date.strftime("%Y-%m-%d"),
                "new_slot": new_time.strftime("%I:%M %p"),
            },
        }

    lock_key = int(doctor.id.int % (2**31 - 1))
    db.execute(text("SELECT pg_advisory_xact_lock(:lock_key)"), {"lock_key": lock_key})

    if enforce_checks:
        schedules = db.query(ClinicDoctorSchedule).filter(
            ClinicDoctorSchedule.tenant_id == tenant_uuid,
            ClinicDoctorSchedule.doctor_id == doctor.id,
            ClinicDoctorSchedule.is_active == True,
        ).all()
        open_slots, _ = _compute_slots_for_day(
            db=db,
            tenant_uuid=tenant_uuid,
            doctor_id=doctor.id,
            schedules=schedules,
            target_date=new_date,
            now_local=now_local,
            exclude_appointment_id=apt.id,
        )
        req_label = new_time.strftime("%I:%M %p")
        if req_label not in open_slots:
            return {
                "status": "SLOT_CONFLICT",
                "message": f"Requested slot {req_label} on {new_date.isoformat()} is not available for {doctor.name}.",
                "open_slots": open_slots[:6],
            }

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
                "map_url": t_settings.get("map_url", ""),
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
        "doctor_name": doctor.name,
        "old_date": old_date,
        "old_slot": old_slot,
        "appointment_date": new_date.strftime("%Y-%m-%d"),
        "slot_time": new_time.strftime("%I:%M %p"),
        "message": f"Rescheduled to {new_date.strftime('%Y-%m-%d')}, {new_time.strftime('%I:%M %p')}. Your previous slot ({old_date} {old_slot}) has been released."
    }


def get_departments_db(db: Session, tenant_id: str) -> Dict[str, Any]:
    """Lists active departments/specialties backed by at least one active clinic doctor."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))
    doctors = (
        db.query(ClinicDoctor)
        .filter(ClinicDoctor.tenant_id == tenant_uuid, ClinicDoctor.is_active == True)
        .order_by(ClinicDoctor.specialty.asc(), ClinicDoctor.name.asc())
        .all()
    )
    grouped: Dict[str, Dict[str, Any]] = {}
    for d in doctors:
        spec = (d.specialty or "General").strip()
        if spec not in grouped:
            grouped[spec] = {
                "department_id": spec.lower().replace(" ", "_"),
                "name": spec,
                "doctor_count": 0,
                "min_fee_pkr": float(d.fee_pkr),
                "doctors": [],
            }
        grouped[spec]["doctor_count"] += 1
        grouped[spec]["min_fee_pkr"] = min(grouped[spec]["min_fee_pkr"], float(d.fee_pkr))
        grouped[spec]["doctors"].append(d.name)

    return {
        "status": "SUCCESS" if grouped else "EMPTY",
        "departments": list(grouped.values()),
    }


def get_fees_db(
    db: Session,
    tenant_id: str,
    doctor_name_or_specialty: Optional[str] = None,
) -> Dict[str, Any]:
    """Returns published consultation fees directly from clinic_doctors."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))
    tenant = db.query(PlatformTenant).filter(PlatformTenant.id == tenant_uuid).first()
    currency = (tenant.currency if tenant and tenant.currency else "PKR")

    q_obj = db.query(ClinicDoctor).filter(ClinicDoctor.tenant_id == tenant_uuid, ClinicDoctor.is_active == True)
    if doctor_name_or_specialty:
        pat = f"%{doctor_name_or_specialty.strip()}%"
        raw_lower = doctor_name_or_specialty.strip().lower()
        mapped_spec = None
        for syn_k, syn_v in SPECIALTY_SYNONYM_MAP.items():
            if syn_k in raw_lower:
                mapped_spec = syn_v
                break
        if mapped_spec:
            q_obj = q_obj.filter(
                (ClinicDoctor.name.ilike(pat)) |
                (ClinicDoctor.specialty.ilike(pat)) |
                (ClinicDoctor.specialty.ilike(f"%{mapped_spec}%"))
            )
        else:
            q_obj = q_obj.filter((ClinicDoctor.name.ilike(pat)) | (ClinicDoctor.specialty.ilike(pat)))
    docs = q_obj.order_by(ClinicDoctor.name.asc()).all()
    if not docs:
        return {"status": "NOT_FOUND", "message": f"No published fee found matching '{doctor_name_or_specialty}'.", "fees": []}

    return {
        "status": "SUCCESS",
        "currency": currency,
        "fees": [
            {
                "doctor_id": str(d.id),
                "doctor_name": d.name,
                "specialty": d.specialty,
                "qualification": d.qualification,
                "room_number": d.room_number,
                "fee_amount": float(d.fee_pkr),
                "fee_display": f"{currency} {float(d.fee_pkr):,.0f}",
            }
            for d in docs
        ],
    }


def get_appointments_db(db: Session, tenant_id: str, patient_phone: str) -> Dict[str, Any]:
    """Lists upcoming/active appointments strictly for the authenticated sender phone."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))
    clean_ph = _normalize_phone_digits(patient_phone)
    if len(clean_ph) < 10:
        return {"status": "INVALID_INPUT", "appointments": [], "message": "Valid patient phone number required."}

    suffix = clean_ph[-10:]
    contacts = (
        db.query(PlatformContact)
        .filter(
            PlatformContact.tenant_id == tenant_uuid,
            PlatformContact.customer_phone.like(f"%{suffix}"),
        )
        .all()
    )
    if not contacts:
        return {"status": "EMPTY", "appointments": [], "message": "No appointments found for your WhatsApp number."}

    contact_ids = [c.id for c in contacts]
    _, now_local = _get_tenant_timezone_and_now(db, tenant_id)

    rows = (
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
        .filter(
            ClinicAppointment.tenant_id == tenant_uuid,
            ClinicAppointment.contact_id.in_(contact_ids),
            ClinicAppointment.appointment_date >= now_local.date(),
            ClinicAppointment.status.notin_(["CANCELLED", "NO_SHOW"]),
        )
        .order_by(ClinicAppointment.appointment_date.asc(), ClinicAppointment.slot_time.asc())
        .all()
    )

    return {
        "status": "SUCCESS" if rows else "EMPTY",
        "appointments": [
            {
                "appointment_id": str(apt.id),
                "appointment_number": apt.appointment_number,
                "queue_token": apt.queue_token,
                "patient_name": ct.full_name or ct.push_name or "Patient",
                "doctor_name": doc.name,
                "specialty": doc.specialty,
                "room_number": doc.room_number,
                "appointment_date": apt.appointment_date.strftime("%Y-%m-%d"),
                "slot_time": apt.slot_time.strftime("%I:%M %p"),
                "status": apt.status,
                "fee_pkr": float(doc.fee_pkr),
            }
            for apt, doc, ct in rows
        ],
    }


def get_clinic_info_db(db: Session, tenant_id: str, topic: Optional[str] = None) -> Dict[str, Any]:
    """Returns published clinic address, phones, timings, and Google Maps link from tenant settings."""
    tenant_uuid = uuid.UUID(str(tenant_id))
    tenant = db.query(PlatformTenant).filter(PlatformTenant.id == tenant_uuid).first()
    if not tenant:
        return {"status": "NOT_FOUND", "message": "Clinic profile not found."}

    s = tenant.settings or {}
    return {
        "status": "SUCCESS",
        "topic": topic or "clinic_overview",
        "business_name": tenant.name,
        "timezone": tenant.timezone or "Asia/Karachi",
        "currency": tenant.currency or "PKR",
        "address": s.get("address") or "Address not published — please contact Reception.",
        "phone": s.get("phone") or "Direct WhatsApp",
        "map_url": s.get("map_url") or "",
        "timings": s.get("timings") or "Monday - Saturday, 09:00 AM - 09:00 PM (Emergency 24/7)",
        "emergency_number": s.get("emergency_number") or "1122",
        "arrival_minutes": int(s.get("arrival_minutes") or 15),
        "cancellation_window_hours": int(s.get("cancellation_window_hours") or 2),
    }


def get_patient_profile_db(db: Session, tenant_id: str, patient_phone: str) -> Optional[Dict[str, Any]]:
    """
    Returns persisted patient profile (full_name, preferred_department, preferred_time,
    appointment_type) so the assistant confirms stored fields instead of re-asking.
    """
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))
    clean_ph = _normalize_phone_digits(patient_phone)
    if len(clean_ph) < 7:
        return None

    contact = (
        db.query(PlatformContact)
        .filter(
            PlatformContact.tenant_id == tenant_uuid,
            PlatformContact.customer_phone.like(f"%{clean_ph[-10:]}"),
        )
        .first()
    )
    if not contact:
        return None

    meta = contact.metadata_ or {}
    prof = dict(meta.get("patient_profile") or {})
    full_name = prof.get("full_name") or contact.full_name
    confirmed = bool(prof.get("full_name_confirmed", False))

    # Infer FOLLOW_UP automatically if patient has any past visit in DB
    past_visit_count = (
        db.query(ClinicAppointment)
        .filter(
            ClinicAppointment.tenant_id == tenant_uuid,
            ClinicAppointment.contact_id == contact.id,
            ClinicAppointment.status != "CANCELLED",
        )
        .count()
    )
    inferred_type = prof.get("appointment_type") or ("FOLLOW_UP" if past_visit_count > 0 else None)

    return {
        "patient_phone": contact.customer_phone,
        "full_name": full_name,
        "full_name_confirmed": confirmed,
        "preferred_department": prof.get("preferred_department"),
        "preferred_doctor": prof.get("preferred_doctor"),
        "preferred_time": prof.get("preferred_time"),
        "appointment_type": inferred_type,
        "prior_visits": past_visit_count,
    }


def update_patient_profile_db(
    db: Session,
    tenant_id: str,
    patient_phone: str,
    full_name: Optional[str] = None,
    preferred_department: Optional[str] = None,
    preferred_doctor: Optional[str] = None,
    preferred_time: Optional[str] = None,
    appointment_type: Optional[str] = None,
    confirm_name: bool = True,
) -> Dict[str, Any]:
    """Persists known patient booking preferences inside PlatformContact.metadata JSONB."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))
    clean_ph = _normalize_phone_digits(patient_phone)
    if len(clean_ph) < 7:
        return {"status": "INVALID_INPUT", "message": "Valid patient phone required."}

    contact = (
        db.query(PlatformContact)
        .filter(PlatformContact.tenant_id == tenant_uuid, PlatformContact.customer_phone == clean_ph)
        .first()
    )
    if not contact:
        contact = PlatformContact(
            tenant_id=tenant_uuid,
            customer_phone=clean_ph,
            full_name=(full_name or "").strip() or None,
            push_name=(full_name or "").strip() or None,
            metadata_={},
        )
        db.add(contact)
        db.flush()

    meta = dict(contact.metadata_ or {})
    prof = dict(meta.get("patient_profile") or {})
    if full_name and full_name.strip():
        clean_name = full_name.strip()
        contact.full_name = clean_name
        prof["full_name"] = clean_name
        prof["full_name_confirmed"] = confirm_name
    if preferred_department and preferred_department.strip():
        prof["preferred_department"] = preferred_department.strip()
    if preferred_doctor and preferred_doctor.strip():
        prof["preferred_doctor"] = preferred_doctor.strip()
    if preferred_time and preferred_time.strip():
        prof["preferred_time"] = preferred_time.strip()
    if appointment_type and appointment_type.strip():
        prof["appointment_type"] = appointment_type.strip().upper()
    prof["updated_at"] = datetime.now(timezone.utc).isoformat()
    meta["patient_profile"] = prof
    contact.metadata_ = meta
    db.commit()

    return {"status": "SUCCESS", "patient_profile": prof}


def get_conversation_state_db(db: Session, tenant_id: str, patient_phone: str) -> Dict[str, Any]:
    """Loads persisted conversation_state (draft_booking, issued_options, idempotency_key) cleanly."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))
    clean_ph = _normalize_phone_digits(patient_phone)
    if len(clean_ph) < 7:
        return {"step": "IDLE", "issued_options": {}}

    contact = (
        db.query(PlatformContact)
        .filter(
            PlatformContact.tenant_id == tenant_uuid,
            PlatformContact.customer_phone.like(f"%{clean_ph[-10:]}"),
        )
        .first()
    )
    if not contact:
        return {"step": "IDLE", "issued_options": {}}
    meta = contact.metadata_ or {}
    state = dict(meta.get("conversation_state") or {})
    state.setdefault("step", "IDLE")
    state.setdefault("issued_options", {})
    return state


def save_conversation_state_db(
    db: Session,
    tenant_id: str,
    patient_phone: str,
    state: Dict[str, Any],
) -> None:
    """Persists conversation_state into PlatformContact.metadata JSONB cleanly."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))
    clean_ph = _normalize_phone_digits(patient_phone)
    if len(clean_ph) < 7:
        return

    contact = (
        db.query(PlatformContact)
        .filter(
            PlatformContact.tenant_id == tenant_uuid,
            PlatformContact.customer_phone.like(f"%{clean_ph[-10:]}"),
        )
        .first()
    )
    if not contact:
        return
    meta = dict(contact.metadata_ or {})
    clean_state = dict(state or {})
    clean_state["updated_at"] = datetime.now(timezone.utc).isoformat()
    meta["conversation_state"] = clean_state
    contact.metadata_ = meta
    db.flush()


def handoff_to_human_db(
    db: Session,
    tenant_id: str,
    patient_phone: str,
    reason: str,
    priority: str = "normal",
) -> Dict[str, Any]:
    """Pauses AI on the patient's active conversation and records a Reception escalation event."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))
    clean_ph = _normalize_phone_digits(patient_phone)

    from app.models.communication import TenantConversation, TenantAuditEvent

    paused_conv_id = None
    if clean_ph:
        session_key = f"{tenant_uuid}:{clean_ph}"
        conv = (
            db.query(TenantConversation)
            .filter(
                TenantConversation.tenant_id == tenant_uuid,
                TenantConversation.session_key == session_key,
            )
            .order_by(TenantConversation.last_message_at.desc())
            .first()
        )
        if conv:
            conv.ai_paused = True
            conv.status = "PAUSED_FOR_HUMAN"
            conv.updated_at = datetime.now(timezone.utc)
            paused_conv_id = str(conv.id)

    ticket_id = f"ESC-{uuid.uuid4().hex[:6].upper()}"
    prio = (priority or "normal").lower()
    action_name = "HUMAN_HANDOFF_URGENT" if prio == "urgent" else "HUMAN_HANDOFF_REQUESTED"

    db.add(
        TenantAuditEvent(
            tenant_id=tenant_uuid,
            actor_type="SYSTEM",
            actor_id=clean_ph or "UNKNOWN",
            action=action_name,
            resource_type="conversation",
            resource_id=paused_conv_id or clean_ph or ticket_id,
            details={"ticket_id": ticket_id, "reason": reason, "priority": prio, "ai_paused": bool(paused_conv_id)},
        )
    )
    db.commit()

    tenant = db.query(PlatformTenant).filter(PlatformTenant.id == tenant_uuid).first()
    reception_phone = ((tenant.settings or {}).get("phone") if tenant else None) or "Clinic Reception"

    return {
        "status": "HANDOFF_ACTIVE",
        "ticket_id": ticket_id,
        "priority": prio,
        "patient_phone": clean_ph,
        "conversation_id": paused_conv_id,
        "ai_paused": True,
        "reception_phone": reception_phone,
        "reason": reason,
        "message": "Conversation escalated to clinic reception staff. AI auto-replies are now paused until staff reply.",
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

    # Fetch real open DB slots for self-service rescheduling
    schedules = db.query(ClinicDoctorSchedule).filter(
        ClinicDoctorSchedule.tenant_id == tenant_uuid,
        ClinicDoctorSchedule.doctor_id == doctor.id,
        ClinicDoctorSchedule.is_active == True
    ).all()
    available_days: List[str] = []
    for s in schedules:
        if s.day_of_week not in available_days:
            available_days.append(s.day_of_week)

    _, now_local = _get_tenant_timezone_and_now(db, str(tenant_uuid))
    open_slots, _ = _compute_slots_for_day(
        db=db,
        tenant_uuid=tenant_uuid,
        doctor_id=doctor.id,
        schedules=schedules,
        target_date=apt.appointment_date,
        now_local=now_local,
        exclude_appointment_id=apt.id,
    )
    if not open_slots:
        for offset in range(1, 8):
            cand_date = now_local.date() + timedelta(days=offset)
            cand_slots, _ = _compute_slots_for_day(
                db=db,
                tenant_uuid=tenant_uuid,
                doctor_id=doctor.id,
                schedules=schedules,
                target_date=cand_date,
                now_local=now_local,
            )
            if cand_slots:
                open_slots = cand_slots[:6]
                break

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
        "map_url": t_settings.get("map_url", ""),
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
