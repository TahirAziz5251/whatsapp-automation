import logging
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


def _tool_error_response(action: str, err: Exception) -> Dict[str, Any]:
    logger.error(f"Database tool failure in {action}: {err}", exc_info=True)
    return {
        "status": "TOOL_ERROR",
        "retryable": True,
        "handoff_recommended": True,
        "message": "Unable to verify live clinic records right now due to a temporary system error. Please try again or connect with clinic reception.",
    }

# Pilot Clinic Mock Schedule & Doctor Roster (Configurable per tenant)
PILOT_DOCTORS = [
    {
        "id": "DOC_01",
        "name": "Dr. Tariq Mahmood",
        "specialty": "Cardiology",
        "qualification": "MBBS, FCPS (Cardiology)",
        "fee_pkr": 2500,
        "days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        "timings": "10:00 AM - 02:00 PM",
        "slots_available": ["10:30 AM", "11:00 AM", "11:30 AM", "12:15 PM", "01:00 PM"]
    },
    {
        "id": "DOC_02",
        "name": "Dr. Ayesha Malik",
        "specialty": "General Medicine / Physician",
        "qualification": "MBBS, MRCP",
        "fee_pkr": 1800,
        "days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
        "timings": "04:00 PM - 08:00 PM",
        "slots_available": ["04:30 PM", "05:00 PM", "05:45 PM", "06:30 PM", "07:15 PM"]
    },
    {
        "id": "DOC_03",
        "name": "Dr. Bilal Asghar",
        "specialty": "Pediatrics (Child Specialist)",
        "qualification": "MBBS, FCPS (Pediatrics)",
        "fee_pkr": 2000,
        "days": ["Monday", "Wednesday", "Friday"],
        "timings": "06:00 PM - 09:00 PM",
        "slots_available": ["06:15 PM", "06:45 PM", "07:30 PM", "08:15 PM"]
    }
]

def get_doctor_schedule(
    tenant_id: str,
    doctor_name_or_specialty: Optional[str] = None,
    date: Optional[str] = None,
    preferred_time: Optional[str] = None,
    db: Optional[Any] = None
) -> Dict[str, Any]:
    """Retrieves available doctors, consulting hours, fees, and real open DB slots."""
    if db is not None:
        try:
            from app.services.clinic_service import get_doctor_schedule_db
            return get_doctor_schedule_db(db, tenant_id, doctor_name_or_specialty, date, preferred_time=preferred_time)
        except Exception as e:
            return _tool_error_response("get_doctor_schedule", e)

    query = (doctor_name_or_specialty or "").lower().strip()
    
    matches = []
    for doc in PILOT_DOCTORS:
        if not query or query in doc["name"].lower() or query in doc["specialty"].lower():
            matches.append({
                "doctor_id": doc["id"],
                "name": doc["name"],
                "specialty": doc["specialty"],
                "fee": f"PKR {doc['fee_pkr']}",
                "consulting_hours": doc["timings"],
                "available_days": doc["days"],
                "open_slots": doc["slots_available"]
            })
            
    if not matches:
        return {
            "status": "NOT_FOUND",
            "message": f"No doctor found matching '{doctor_name_or_specialty}'. Available specialties: Cardiology, General Medicine, Pediatrics.",
            "doctors": []
        }
        
    return {
        "status": "SUCCESS",
        "query_date": date or "Today/Next Available",
        "matched_count": len(matches),
        "doctors": matches
    }


def get_availability(
    tenant_id: str,
    department_or_doctor: Optional[str] = None,
    date: Optional[str] = None,
    preferred_time: Optional[str] = None,
    db: Optional[Any] = None,
) -> Dict[str, Any]:
    """Checks live open appointment slots for a department/doctor and target date."""
    return get_doctor_schedule(
        tenant_id=tenant_id,
        doctor_name_or_specialty=department_or_doctor,
        date=date,
        preferred_time=preferred_time,
        db=db,
    )


def get_departments(tenant_id: str, db: Optional[Any] = None) -> Dict[str, Any]:
    """Returns active clinic departments/specialties backed by active DB doctors."""
    if db is not None:
        try:
            from app.services.clinic_service import get_departments_db
            return get_departments_db(db, tenant_id)
        except Exception as e:
            return _tool_error_response("get_departments", e)

    specs = {}
    for d in PILOT_DOCTORS:
        specs.setdefault(d["specialty"], {"department_id": d["specialty"].lower(), "name": d["specialty"], "doctor_count": 0, "doctors": []})
        specs[d["specialty"]]["doctor_count"] += 1
        specs[d["specialty"]]["doctors"].append(d["name"])
    return {"status": "SUCCESS", "departments": list(specs.values())}


def get_fees(
    tenant_id: str,
    doctor_name_or_specialty: Optional[str] = None,
    db: Optional[Any] = None,
) -> Dict[str, Any]:
    """Returns published consultation fees directly from DB."""
    if db is not None:
        try:
            from app.services.clinic_service import get_fees_db
            return get_fees_db(db, tenant_id, doctor_name_or_specialty)
        except Exception as e:
            return _tool_error_response("get_fees", e)

    q = (doctor_name_or_specialty or "").lower().strip()
    fees = [
        {"doctor_name": d["name"], "specialty": d["specialty"], "fee_amount": d["fee_pkr"], "fee_display": f"PKR {d['fee_pkr']}"}
        for d in PILOT_DOCTORS
        if not q or q in d["name"].lower() or q in d["specialty"].lower()
    ]
    return {"status": "SUCCESS" if fees else "NOT_FOUND", "currency": "PKR", "fees": fees}


def book_appointment(
    tenant_id: str,
    patient_phone: str,
    patient_name: str,
    doctor_name: str,
    date: str,
    slot_time: str,
    symptoms: Optional[str] = None,
    confirmed: Optional[bool] = None,
    idempotency_key: Optional[str] = None,
    patient_age: Optional[int] = None,
    appointment_type: Optional[str] = None,
    db: Optional[Any] = None
) -> Dict[str, Any]:
    """Books a clinic appointment with live DB slot validation, confirmation gate, and idempotency."""
    if db is not None:
        try:
            from app.services.clinic_service import book_appointment_db
            return book_appointment_db(
                db=db,
                tenant_id=tenant_id,
                patient_phone=patient_phone,
                patient_name=patient_name,
                doctor_name_or_id=doctor_name,
                appointment_date_str=date,
                slot_time_str=slot_time,
                symptoms=symptoms,
                confirmed=confirmed,
                enforce_slot_check=True,
                idempotency_key=idempotency_key,
                patient_age=patient_age,
                appointment_type=appointment_type,
            )
        except Exception as e:
            return _tool_error_response("book_appointment", e)

    if not patient_name or not patient_phone or not doctor_name:
        return {
            "status": "ERROR",
            "message": "Missing required details: patient name, phone number, and doctor name are mandatory."
        }
        
    appointment_id = f"APT-{datetime.now().strftime('%Y%m')}-{uuid.uuid4().hex[:6].upper()}"
    queue_token = f"T-{uuid.uuid4().hex[:2].upper()}{str(abs(hash(patient_phone)) % 50 + 1).zfill(2)}"

    return {
        "status": "CONFIRMED",
        "appointment_id": appointment_id,
        "queue_token": queue_token,
        "patient_name": patient_name,
        "patient_phone": patient_phone,
        "doctor_name": doctor_name,
        "appointment_date": date,
        "slot_time": slot_time,
        "symptoms_noted": symptoms or "General Consultation",
        "instructions": "Please arrive 15 minutes before your scheduled slot. Present your token number at the OPD counter."
    }


def get_appointments(
    tenant_id: str,
    patient_phone: str,
    caller_phone: Optional[str] = None,
    db: Optional[Any] = None,
) -> Dict[str, Any]:
    """Lists upcoming appointments scoped strictly to the authenticated sender phone."""
    verified_phone = caller_phone or patient_phone
    if db is not None:
        try:
            from app.services.clinic_service import get_appointments_db
            return get_appointments_db(db, tenant_id, verified_phone)
        except Exception as e:
            return _tool_error_response("get_appointments", e)

    return {"status": "EMPTY", "appointments": []}


def reschedule_appointment(
    tenant_id: str,
    appointment_id: str,
    new_date: str,
    new_slot_time: str,
    confirmed: Optional[bool] = None,
    caller_phone: Optional[str] = None,
    db: Optional[Any] = None,
) -> Dict[str, Any]:
    """Reschedules an existing appointment to a verified open slot under patient ownership checks."""
    if db is not None:
        try:
            from app.services.clinic_service import reschedule_appointment_db
            return reschedule_appointment_db(
                db=db,
                tenant_id=tenant_id,
                appointment_identifier=appointment_id,
                new_date_str=new_date,
                new_slot_str=new_slot_time,
                customer_phone=caller_phone,
                enforce_checks=True,
                confirmed=confirmed,
            )
        except Exception as e:
            return _tool_error_response("reschedule_appointment", e)

    return {
        "status": "RESCHEDULED",
        "appointment_number": appointment_id,
        "appointment_date": new_date,
        "slot_time": new_slot_time,
    }


def get_queue_status(
    tenant_id: str,
    appointment_id_or_token: Optional[str] = None,
    doctor_name: Optional[str] = None,
    patient_phone: Optional[str] = None,
    caller_phone: Optional[str] = None,
    db: Optional[Any] = None
) -> Dict[str, Any]:
    """Fetches real-time OPD queue status and estimated wait times from DB."""
    if db is not None:
        try:
            from app.services.clinic_service import get_queue_status_db
            return get_queue_status_db(
                db,
                tenant_id,
                appointment_id_or_token,
                doctor_name,
                patient_phone=caller_phone or patient_phone,
            )
        except Exception as e:
            return _tool_error_response("get_queue_status", e)

    current_serving_token = "T-A08"
    
    return {
        "status": "ACTIVE_QUEUE",
        "doctor_name": doctor_name or "Dr. Tariq Mahmood",
        "current_token_serving": current_serving_token,
        "your_token": appointment_id_or_token or "T-A14",
        "tokens_ahead": 6,
        "estimated_wait_minutes": 25,
        "queue_health": "ON_SCHEDULE"
    }


def cancel_appointment(
    tenant_id: str,
    appointment_id: str,
    reason: Optional[str] = None,
    confirmed: Optional[bool] = None,
    caller_phone: Optional[str] = None,
    db: Optional[Any] = None
) -> Dict[str, Any]:
    """Cancels an appointment upon verified patient request, ownership, and policy window check."""
    if db is not None:
        try:
            from app.services.clinic_service import cancel_appointment_db
            return cancel_appointment_db(
                db,
                tenant_id,
                appointment_id,
                reason,
                customer_phone=caller_phone,
                confirmed=confirmed,
                enforce_checks=True,
            )
        except Exception as e:
            return _tool_error_response("cancel_appointment", e)

    return {
        "status": "CANCELLED",
        "appointment_id": appointment_id,
        "cancellation_time": datetime.now(timezone.utc).isoformat(),
        "reason": reason or "Patient requested cancellation",
        "message": "Your appointment has been successfully cancelled. You can reschedule whenever convenient."
    }


def check_in_patient(
    tenant_id: str,
    appointment_id: str,
    caller_phone: Optional[str] = None,
    db: Optional[Any] = None,
) -> Dict[str, Any]:
    """Marks patient as physically arrived at clinic with queue position and ETA."""
    if db is not None:
        try:
            from app.services.clinic_service import check_in_patient_db
            return check_in_patient_db(
                db,
                tenant_id,
                appointment_id,
                caller_phone=caller_phone,
                enforce_checks=True,
            )
        except Exception as e:
            return _tool_error_response("check_in_patient", e)

    return {
        "status": "CHECKED_IN",
        "appointment_id": appointment_id,
        "queue_position": 1,
        "estimated_wait_minutes": 10,
        "eta_disclaimer": "Estimate, not a guarantee",
        "check_in_time": datetime.now(timezone.utc).isoformat(),
        "message": "Patient checked in. Please proceed to Waiting Area."
    }


def get_clinic_info(tenant_id: str, topic: Optional[str] = None, db: Optional[Any] = None) -> Dict[str, Any]:
    """Returns published clinic timings, address, map URL, and reception phone from tenant DB."""
    if db is not None:
        try:
            from app.services.clinic_service import get_clinic_info_db
            return get_clinic_info_db(db, tenant_id, topic)
        except Exception as e:
            return _tool_error_response("get_clinic_info", e)

    return {
        "status": "SUCCESS",
        "topic": topic or "clinic_overview",
        "address": "Plot 45-B, Main Boulevard, Gulberg III, Lahore",
        "phone": "042-35889900",
        "timings": "Monday - Saturday, 09:00 AM - 09:00 PM (Emergency 24/7)",
    }


_TEMPLATE_TO_BUSINESS_CODE = {
    "CLINIC_OPD": "HOSP_HEALTH",
    "DENTAL_CLINIC": "HOSP_HEALTH",
    "VETERINARY_CLINIC": "HOSP_HEALTH",
}


def search_knowledge_base(tenant_id: str, query: str, db: Optional[Any] = None) -> Dict[str, Any]:
    """
    Searches verified clinic Knowledge Base via Agentic RAG
    (Query Normalization + pgvector + BM25 + RRF + Validity Guards + Strict Relevance Threshold).
    """
    q = (query or "").lower().strip()

    if db is not None:
        try:
            import uuid as _uuid
            from app.models.tenant import PlatformTenant
            from app.services.ai.rag_engine import hybrid_search

            tenant = db.query(PlatformTenant).filter(PlatformTenant.id == _uuid.UUID(str(tenant_id))).first()
            t_settings = (tenant.settings or {}) if tenant else {}
            biz_name = tenant.name if tenant else "Alpha Clinic"
            addr = t_settings.get("address", "")
            phone = t_settings.get("phone", "")
            map_url = t_settings.get("map_url", "")
            template_id = (tenant.business_template_id or "CLINIC_OPD") if tenant else "CLINIC_OPD"
            business_code = _TEMPLATE_TO_BUSINESS_CODE.get(template_id, template_id)

            if addr and any(k in q for k in ["address", "location", "map", "directions", "kahan", "jagah", "pata", "kidhar"]):
                map_note = f" Google Maps: {map_url}" if map_url else ""
                return {
                    "status": "FOUND",
                    "topic": "Location & Address",
                    "source": "tenant_settings",
                    "information": f"{biz_name} is located at {addr}. Contact: {phone or 'Direct WhatsApp'}.{map_note}",
                }

            return hybrid_search(
                db=db,
                tenant_id=str(tenant_id),
                business_code=business_code,
                template_id=template_id,
                query=query,
            )
        except Exception as e:
            return _tool_error_response("search_knowledge_base", e)

    if "address" in q or "location" in q or "kahan" in q or "jagah" in q:
        return {
            "status": "FOUND",
            "topic": "Location & Address",
            "information": "Alpha Clinic & Diagnostic Centre is located at Plot 45-B, Main Boulevard, Gulberg III, Lahore. Landmark: Near Kalma Chowk."
        }
    elif "timing" in q or "hours" in q or "waqt" in q or "khula" in q:
        return {
            "status": "FOUND",
            "topic": "Operating Timings",
            "information": "OPD operates Monday through Saturday from 09:00 AM to 09:00 PM. Emergency services and Pharmacy are open 24/7."
        }
    elif "fee" in q or "charges" in q or "paise" in q:
        return {
            "status": "FOUND",
            "topic": "Consultation Fees",
            "information": "General Physician consultation fee is PKR 1,800. Specialists and Cardiologists are PKR 2,000 - 2,500."
        }
    elif "lab" in q or "test" in q or "blood" in q or "ultrasound" in q:
        return {
            "status": "FOUND",
            "topic": "Diagnostics & Lab Services",
            "information": "In-house lab tests (CBC, Blood Sugar, Lipid Profile, Liver Function) and Ultrasound are available daily from 08:00 AM to 08:00 PM."
        }
    else:
        return {
            "status": "FOUND",
            "topic": "Clinic Information",
            "information": "Alpha Clinic provides state-of-the-art OPD, Diagnostic Lab, Ultrasound, and Pharmacy services. For specialized inquiries, our desk number is 042-35889900."
        }


def handoff_to_human(
    tenant_id: str,
    patient_phone: str,
    reason: str,
    priority: str = "normal",
    db: Optional[Any] = None,
) -> Dict[str, Any]:
    """Escalates conversation to clinic human reception and pauses AI replies in DB."""
    if db is not None:
        try:
            from app.services.clinic_service import handoff_to_human_db
            return handoff_to_human_db(db, tenant_id, patient_phone, reason, priority=priority)
        except Exception as e:
            return _tool_error_response("handoff_to_human", e)

    return {
        "status": "HANDOFF_ACTIVE",
        "patient_phone": patient_phone,
        "reason": reason,
        "priority": priority,
        "ai_paused": True,
        "ticket_id": f"ESC-{uuid.uuid4().hex[:6].upper()}",
        "message": "Conversation escalated. A clinic front-desk coordinator will respond to your WhatsApp shortly.",
    }


def escalate_to_human(tenant_id: str, patient_phone: str, reason: str, db: Optional[Any] = None) -> Dict[str, Any]:
    """Alias for stateful human handoff."""
    return handoff_to_human(tenant_id=tenant_id, patient_phone=patient_phone, reason=reason, priority="normal", db=db)
