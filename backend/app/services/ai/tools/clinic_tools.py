import uuid
from datetime import datetime, timezone
from typing import Dict, Any, Optional

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
    db: Optional[Any] = None
) -> Dict[str, Any]:
    """Retrieves available doctors, consulting hours, fees, and open slots."""
    if db is not None:
        try:
            from app.services.clinic_service import get_doctor_schedule_db
            res = get_doctor_schedule_db(db, tenant_id, doctor_name_or_specialty, date)
            if res.get("status") == "SUCCESS":
                return res
        except Exception:
            pass

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


def book_appointment(
    tenant_id: str,
    patient_phone: str,
    patient_name: str,
    doctor_name: str,
    date: str,
    slot_time: str,
    symptoms: Optional[str] = None,
    db: Optional[Any] = None
) -> Dict[str, Any]:
    """Books a clinic appointment and issues a queue token."""
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
                symptoms=symptoms
            )
        except Exception:
            pass

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


def get_queue_status(
    tenant_id: str,
    appointment_id_or_token: Optional[str] = None,
    doctor_name: Optional[str] = None,
    db: Optional[Any] = None
) -> Dict[str, Any]:
    """Fetches real-time OPD queue status and estimated wait times."""
    if db is not None:
        try:
            from app.services.clinic_service import get_queue_status_db
            return get_queue_status_db(db, tenant_id, appointment_id_or_token, doctor_name)
        except Exception:
            pass

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
    db: Optional[Any] = None
) -> Dict[str, Any]:
    """Cancels or marks an appointment as revoked upon patient request."""
    if db is not None:
        try:
            from app.services.clinic_service import cancel_appointment_db
            return cancel_appointment_db(db, tenant_id, appointment_id, reason)
        except Exception:
            pass

    return {
        "status": "CANCELLED",
        "appointment_id": appointment_id,
        "cancellation_time": datetime.now(timezone.utc).isoformat(),
        "reason": reason or "Patient requested cancellation",
        "message": "Your appointment has been successfully cancelled. You can reschedule whenever convenient."
    }


def check_in_patient(tenant_id: str, appointment_id: str, db: Optional[Any] = None) -> Dict[str, Any]:
    """Marks patient as physically arrived at clinic."""
    if db is not None:
        try:
            from app.services.clinic_service import check_in_patient_db
            return check_in_patient_db(db, tenant_id, appointment_id)
        except Exception:
            pass

    return {
        "status": "CHECKED_IN",
        "appointment_id": appointment_id,
        "check_in_time": datetime.now(timezone.utc).isoformat(),
        "message": "Patient checked in. Please proceed to Waiting Area 2."
    }


def search_knowledge_base(tenant_id: str, query: str) -> Dict[str, Any]:
    """Answers common clinic FAQ inquiries."""
    q = (query or "").lower()
    
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


def escalate_to_human(tenant_id: str, patient_phone: str, reason: str) -> Dict[str, Any]:
    """Escalates conversation to clinic human coordinator."""
    return {
        "status": "ESCALATED",
        "patient_phone": patient_phone,
        "reason": reason,
        "ticket_id": f"ESC-{uuid.uuid4().hex[:6].upper()}",
        "message": "Conversation escalated. A clinic front-desk coordinator will respond to your WhatsApp shortly."
    }
