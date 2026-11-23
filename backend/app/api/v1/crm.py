from fastapi import APIRouter, Depends, HTTPException, Header, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
import uuid

from app.core.database import get_db
from app.services.crm_service import (
    list_conversations_db,
    get_conversation_thread_db,
    toggle_ai_pause_db,
    staff_send_message_db,
    update_contact_crm_db,
    list_audit_events_db
)

router = APIRouter(prefix="/crm", tags=["Staff CRM & Conversation Auditing"])

def get_tenant_db(x_tenant_id: str = Header(..., alias="X-Tenant-ID"), db: Session = Depends(get_db)) -> Session:
    try:
        uuid.UUID(x_tenant_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid X-Tenant-ID UUID format")
    db.execute(text(f"SET app.current_tenant_id = '{x_tenant_id}'"))
    return db

# Schemas
class StaffMessageRequest(BaseModel):
    message: str = Field(..., min_length=1, description="Staff message content to deliver via WhatsApp")
    staff_user_id: Optional[str] = Field(None, description="Staff user UUID sending the message")

class ContactUpdateRequest(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    tags: Optional[List[str]] = None
    metadata: Optional[Dict[str, Any]] = None
    staff_user_id: Optional[str] = None

@router.get("/conversations")
def get_inbox_conversations(
    status: Optional[str] = Query(None, description="Filter by status e.g. ACTIVE, PAUSED_FOR_HUMAN, CLOSED"),
    ai_paused: Optional[bool] = Query(None, description="Filter by ai_paused status"),
    search: Optional[str] = Query(None, description="Search phone number or patient name"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_tenant_db)
):
    """Staff Inbox: Lists WhatsApp conversations with contact details, status, and latest preview."""
    return list_conversations_db(
        db=db,
        tenant_id=x_tenant_id,
        status=status,
        ai_paused=ai_paused,
        search=search,
        limit=limit,
        offset=offset
    )

@router.get("/conversations/{conversation_id}")
def get_conversation_thread(
    conversation_id: str,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_tenant_db)
):
    """Conversation Detail: Returns full chronological message thread for a conversation."""
    thread = get_conversation_thread_db(db, x_tenant_id, conversation_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return thread

@router.post("/conversations/{conversation_id}/pause-ai")
def pause_ai_supervisor(
    conversation_id: str,
    staff_user_id: Optional[str] = Query(None),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_tenant_db)
):
    """Human Takeover: Pauses AI auto-responder for this conversation so staff can take over."""
    result = toggle_ai_pause_db(db, x_tenant_id, conversation_id, pause_ai=True, staff_user_id=staff_user_id)
    if result.get("status") == "ERROR":
        raise HTTPException(status_code=404, detail=result.get("message"))
    return result

@router.post("/conversations/{conversation_id}/resume-ai")
def resume_ai_supervisor(
    conversation_id: str,
    staff_user_id: Optional[str] = Query(None),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_tenant_db)
):
    """Resumes AI auto-responder for this conversation."""
    result = toggle_ai_pause_db(db, x_tenant_id, conversation_id, pause_ai=False, staff_user_id=staff_user_id)
    if result.get("status") == "ERROR":
        raise HTTPException(status_code=404, detail=result.get("message"))
    return result

@router.post("/conversations/{conversation_id}/messages")
def staff_dispatch_message(
    conversation_id: str,
    payload: StaffMessageRequest,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_tenant_db)
):
    """Staff Manual Reply: Dispatches a message to customer WhatsApp via outbox."""
    staff_id = payload.staff_user_id or "staff"
    result = staff_send_message_db(
        db=db,
        tenant_id=x_tenant_id,
        conversation_id=conversation_id,
        staff_user_id=staff_id,
        text_content=payload.message
    )
    if result.get("status") == "ERROR":
        raise HTTPException(status_code=400, detail=result.get("message"))
    return result

@router.patch("/contacts/{contact_id}")
def update_contact_profile(
    contact_id: str,
    payload: ContactUpdateRequest,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_tenant_db)
):
    """Updates customer tags, notes, and profile metadata."""
    result = update_contact_crm_db(
        db=db,
        tenant_id=x_tenant_id,
        contact_id=contact_id,
        full_name=payload.full_name,
        email=payload.email,
        tags=payload.tags,
        metadata=payload.metadata,
        staff_user_id=payload.staff_user_id
    )
    if result.get("status") == "ERROR":
        raise HTTPException(status_code=404, detail=result.get("message"))
    return result

@router.get("/audit-events")
def get_tenant_audit_logs(
    action: Optional[str] = Query(None, description="Filter by audit action"),
    actor_type: Optional[str] = Query(None, description="Filter by actor type (USER, SYSTEM, AI_AGENT)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_tenant_db)
):
    """Auditing: Returns chronological audit logs for this tenant."""
    return list_audit_events_db(
        db=db,
        tenant_id=x_tenant_id,
        action=action,
        actor_type=actor_type,
        limit=limit,
        offset=offset
    )
