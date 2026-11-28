from fastapi import APIRouter, Depends, HTTPException, Header, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Optional, Dict, Any
import uuid
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.models.clinic import ClinicDoctor, ClinicDoctorSchedule, ClinicAppointment, ClinicLiveQueue
from app.services.clinic_service import (
    check_in_patient_db,
    get_queue_status_db,
    walk_in_entry_db,
    call_next_patient_db,
    start_consultation_db,
    complete_consultation_db,
    assign_follow_up_task_db,
    toggle_doctor_break_db,
    delay_broadcast_db,
    get_patient_ticket_db,
    cancel_appointment_db,
    reschedule_appointment_db,
    get_owner_analytics_db
)
from app.services.clinic_event_broadcaster import broadcaster

router = APIRouter(prefix="/clinic", tags=["Clinic & Hospital OPD"])

def get_tenant_db(x_tenant_id: str = Header(..., alias="X-Tenant-ID"), db: Session = Depends(get_db)) -> Session:
    try:
        uuid.UUID(x_tenant_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid X-Tenant-ID UUID format")
    db.execute(text(f"SET app.current_tenant_id = '{x_tenant_id}'"))
    return db

# Request Models
class WalkInRequest(BaseModel):
    patient_name: str = Field(..., min_length=2)
    patient_phone: str = Field(..., min_length=10)
    doctor_id: str = Field(...)
    symptoms: Optional[str] = "Walk-in Urgent Consultation"

class CallNextRequest(BaseModel):
    doctor_id: str = Field(...)

class ConsultationActionRequest(BaseModel):
    appointment_id: str = Field(...)
    notes: Optional[str] = None
    follow_up_task: Optional[str] = None

class FollowUpTaskRequest(BaseModel):
    appointment_id: str = Field(...)
    task: str = Field(..., min_length=2, max_length=255)

class DoctorBreakRequest(BaseModel):
    doctor_id: str = Field(...)
    on_break: bool = Field(...)
    reason: Optional[str] = "Rest / Administrative break"

class DelayBroadcastRequest(BaseModel):
    doctor_id: str = Field(...)
    delay_minutes: int = Field(..., ge=5, le=180)
    reason: Optional[str] = "Emergency clinical procedure"

class TicketCancelRequest(BaseModel):
    reason: Optional[str] = "Customer requested cancellation via live link"

class TicketRescheduleRequest(BaseModel):
    appointment_date: str = Field(..., description="YYYY-MM-DD")
    slot_time: str = Field(..., description="e.g. 11:30 AM")

# Endpoints
@router.get("/doctors")
def list_doctors(
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_tenant_db)
):
    """Lists doctors for the authenticated clinic tenant."""
    tenant_uuid = uuid.UUID(x_tenant_id)
    doctors = db.query(ClinicDoctor).filter(
        ClinicDoctor.tenant_id == tenant_uuid,
        ClinicDoctor.is_active == True
    ).all()

    return [
        {
            "id": str(d.id),
            "name": d.name,
            "specialty": d.specialty,
            "qualification": d.qualification,
            "fee_pkr": float(d.fee_pkr),
            "room_number": d.room_number,
            "is_on_break": bool(getattr(d, "is_on_break", False)),
            "break_reason": getattr(d, "break_reason", None)
        }
        for d in doctors
    ]

@router.get("/appointments")
def list_appointments(
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_tenant_db)
):
    """Reception Dashboard: Lists appointments for today with patient details."""
    tenant_uuid = uuid.UUID(x_tenant_id)
    apts = db.query(ClinicAppointment).filter(
        ClinicAppointment.tenant_id == tenant_uuid
    ).order_by(ClinicAppointment.created_at.desc()).all()

    from app.models.contact import PlatformContact
    contacts_map = {
        str(c.id): c.full_name or c.push_name or c.customer_phone
        for c in db.query(PlatformContact).filter(PlatformContact.tenant_id == tenant_uuid).all()
    }

    return [
        {
            "id": str(a.id),
            "appointment_number": a.appointment_number,
            "queue_token": a.queue_token,
            "patient_name": contacts_map.get(str(a.contact_id), "Patient"),
            "doctor_id": str(a.doctor_id),
            "appointment_date": a.appointment_date.strftime("%Y-%m-%d"),
            "slot_time": a.slot_time.strftime("%I:%M %p"),
            "status": a.status,
            "symptoms": a.symptoms,
            "consultation_started_at": a.consultation_started_at.isoformat() if a.consultation_started_at else None,
            "consultation_ended_at": a.consultation_ended_at.isoformat() if a.consultation_ended_at else None,
            "consultation_duration_seconds": a.consultation_duration_seconds,
            "follow_up_task": a.follow_up_task
        }
        for a in apts
    ]

@router.post("/appointments/{appointment_id}/check-in")
async def check_in_appointment(
    appointment_id: str,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_tenant_db)
):
    """Reception Dashboard: 1-Click Check-In updating queue and broadcasting SSE event."""
    result = check_in_patient_db(db, x_tenant_id, appointment_id)
    if result.get("status") == "NOT_FOUND":
        raise HTTPException(status_code=404, detail=result.get("message"))

    # Broadcast real-time SSE event to Doctor screen
    await broadcaster.broadcast(
        tenant_id=x_tenant_id,
        event_type="PATIENT_CHECKED_IN",
        data=result
    )
    return result

@router.post("/walk-in")
async def create_walk_in_entry(
    payload: WalkInRequest,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_tenant_db)
):
    """Reception Dashboard: Instant walk-in registration with immediate queue token."""
    result = walk_in_entry_db(
        db=db,
        tenant_id=x_tenant_id,
        patient_name=payload.patient_name,
        patient_phone=payload.patient_phone,
        doctor_id=payload.doctor_id,
        symptoms=payload.symptoms
    )
    if result.get("status") == "ERROR":
        raise HTTPException(status_code=400, detail=result.get("message"))

    # Broadcast real-time event to Doctor & Waiting monitors
    await broadcaster.broadcast(
        tenant_id=x_tenant_id,
        event_type="WALK_IN_ADDED",
        data=result
    )
    return result

@router.post("/doctor/call-next")
async def call_next_patient(
    payload: CallNextRequest,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_tenant_db)
):
    """Doctor Dashboard: Call Next waiting patient into consultation room."""
    result = call_next_patient_db(db, x_tenant_id, payload.doctor_id)

    if result.get("status") == "PATIENT_CALLED":
        # Broadcast real-time event to Reception & Patient screens
        await broadcaster.broadcast(
            tenant_id=x_tenant_id,
            event_type="PATIENT_CALLED",
            data=result
        )
    return result

@router.post("/doctor/start-consultation")
async def start_consultation(
    payload: ConsultationActionRequest,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_tenant_db)
):
    """Doctor Dashboard: Marks visit in consultation."""
    result = start_consultation_db(db, x_tenant_id, payload.appointment_id)
    if result.get("status") == "ERROR":
        raise HTTPException(status_code=404, detail=result.get("message"))

    await broadcaster.broadcast(
        tenant_id=x_tenant_id,
        event_type="CONSULTATION_STARTED",
        data=result
    )
    return result

@router.post("/doctor/complete-consultation")
async def complete_consultation(
    payload: ConsultationActionRequest,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_tenant_db)
):
    """Doctor Dashboard: Completes visit, persists duration, and records audit log."""
    task = payload.follow_up_task or payload.notes
    result = complete_consultation_db(db, x_tenant_id, payload.appointment_id, task)
    if result.get("status") == "ERROR":
        raise HTTPException(status_code=404, detail=result.get("message"))

    await broadcaster.broadcast(
        tenant_id=x_tenant_id,
        event_type="CONSULTATION_COMPLETED",
        data=result
    )
    return result

@router.post("/doctor/follow-up-task")
async def assign_follow_up_task(
    payload: FollowUpTaskRequest,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_tenant_db)
):
    """Doctor Dashboard: Assigns non-clinical follow-up task."""
    result = assign_follow_up_task_db(db, x_tenant_id, payload.appointment_id, payload.task)
    if result.get("status") == "ERROR":
        raise HTTPException(status_code=404, detail=result.get("message"))

    await broadcaster.broadcast(
        tenant_id=x_tenant_id,
        event_type="FOLLOW_UP_TASK_ASSIGNED",
        data=result
    )
    return result

@router.post("/doctor/toggle-break")
async def toggle_doctor_break(
    payload: DoctorBreakRequest,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_tenant_db)
):
    """Doctor Dashboard: Toggles break / defers queue order with documented reason."""
    result = toggle_doctor_break_db(db, x_tenant_id, payload.doctor_id, payload.on_break, payload.reason)
    if result.get("status") == "ERROR":
        raise HTTPException(status_code=404, detail=result.get("message"))

    await broadcaster.broadcast(
        tenant_id=x_tenant_id,
        event_type="DOCTOR_BREAK_TOGGLED",
        data=result
    )
    return result

@router.post("/queue/delay-broadcast")
async def broadcast_delay(
    payload: DelayBroadcastRequest,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_tenant_db)
):
    """Reception/Doctor: Broadcasts emergency delay alert to waiting patients via WhatsApp."""
    result = delay_broadcast_db(
        db=db,
        tenant_id=x_tenant_id,
        doctor_id=payload.doctor_id,
        delay_minutes=payload.delay_minutes,
        reason=payload.reason
    )
    if result.get("status") == "ERROR":
        raise HTTPException(status_code=400, detail=result.get("message"))

    await broadcaster.broadcast(
        tenant_id=x_tenant_id,
        event_type="DELAY_BROADCASTED",
        data=result
    )
    return result

@router.get("/queue/live")
def get_live_queue(
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_tenant_db)
):
    """Live Queue Status for public/OPD waiting area screens."""
    return get_queue_status_db(db, x_tenant_id)

@router.get("/patient/ticket/{identifier}")
def get_patient_secure_ticket(
    identifier: str,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-ID"),
    db: Session = Depends(get_db)
):
    """Patient / Client Secure Link: Mobile web view showing branded live ticket, queue ETA, and self-service options."""
    ticket = get_patient_ticket_db(db, x_tenant_id or "auto", identifier)
    if not ticket:
        raise HTTPException(status_code=404, detail="Appointment ticket not found")
    return ticket


@router.post("/patient/ticket/{identifier}/cancel")
async def cancel_patient_ticket(
    identifier: str,
    payload: TicketCancelRequest,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-ID"),
    db: Session = Depends(get_db)
):
    """Customer Self-Service: Cancels an appointment from the digital ticket link and syncs dashboards via SSE."""
    ticket = get_patient_ticket_db(db, x_tenant_id or "auto", identifier)
    if not ticket:
        raise HTTPException(status_code=404, detail="Appointment ticket not found")

    result = cancel_appointment_db(db, ticket["tenant_id"], ticket["appointment_number"], reason=payload.reason)
    if result.get("status") in ("NOT_FOUND", "ERROR"):
        raise HTTPException(status_code=400, detail=result.get("message", "Unable to cancel"))

    await broadcaster.broadcast(
        tenant_id=ticket["tenant_id"],
        event_type="QUEUE_UPDATED",
        data=result
    )
    return result


@router.post("/patient/ticket/{identifier}/reschedule")
async def reschedule_patient_ticket(
    identifier: str,
    payload: TicketRescheduleRequest,
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-ID"),
    db: Session = Depends(get_db)
):
    """Customer Self-Service: Reschedules an appointment slot from the digital ticket link and notifies via WhatsApp."""
    ticket = get_patient_ticket_db(db, x_tenant_id or "auto", identifier)
    if not ticket:
        raise HTTPException(status_code=404, detail="Appointment ticket not found")

    result = reschedule_appointment_db(
        db,
        ticket["tenant_id"],
        ticket["appointment_number"],
        new_date_str=payload.appointment_date,
        new_slot_str=payload.slot_time
    )
    if result.get("status") in ("NOT_FOUND", "ERROR"):
        raise HTTPException(status_code=400, detail=result.get("message", "Unable to reschedule"))

    await broadcaster.broadcast(
        tenant_id=ticket["tenant_id"],
        event_type="QUEUE_UPDATED",
        data=result
    )
    return result

@router.get("/events/stream")
async def stream_clinic_events(
    x_tenant_id: str = Query(..., description="Tenant UUID to subscribe to"),

):
    """Server-Sent Events (SSE) stream for real-time synchronization (<500ms latency)."""
    return StreamingResponse(
        broadcaster.event_generator(x_tenant_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@router.post("/reminders/dispatch")
def dispatch_automated_reminders(
    reminder_type: str = Query("ALL", description="Reminder type: ALL, 24H, 30M (legacy alias: 2H)"),
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-ID"),
    db: Session = Depends(get_db)
):
    """Automated Appointment Reminders: Dispatches 24-hour and 30-minute WhatsApp alerts with ticket tracking link."""
    from app.workers.reminder_worker import (
        run_full_reminder_cycle,
        process_24h_reminders_db,
        process_30m_reminders_db,
    )

    rtype = (reminder_type or "ALL").strip().upper()
    if rtype == "24H":
        return process_24h_reminders_db(db, tenant_id=x_tenant_id)
    elif rtype in ("30M", "2H"):
        return process_30m_reminders_db(db, tenant_id=x_tenant_id)
    else:
        return run_full_reminder_cycle(db, tenant_id=x_tenant_id)

@router.get("/owner/analytics")
def get_owner_executive_analytics(
    period: str = Query("today", description="Period: today, yesterday, week, month, custom"),
    start_date: Optional[str] = Query(None, description="Start date YYYY-MM-DD for custom period"),
    end_date: Optional[str] = Query(None, description="End date YYYY-MM-DD for custom period"),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_tenant_db)
):
    """Clinic Owner Executive Analytics: Reconciled SQL metrics, provider telemetry, outbox health, and non-clinical bookings."""
    return get_owner_analytics_db(
        db=db,
        tenant_id=x_tenant_id,
        period=period,
        start_date_str=start_date,
        end_date_str=end_date
    )

