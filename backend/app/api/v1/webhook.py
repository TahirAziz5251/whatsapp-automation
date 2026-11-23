from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session
from typing import Dict, Any
from uuid import UUID
from pydantic import BaseModel
from app.core.database import get_db
from app.services.channel_service import ChannelService
from app.schemas.contact import ContactOut

router = APIRouter()

class EnqueueMessageRequest(BaseModel):
    recipient_phone: str
    text: str
    channel_connection_id: UUID

@router.post("/whatsapp/evolution", tags=["WhatsApp Webhook"])
async def evolution_whatsapp_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Webhook Ingress Endpoint for Evolution Go (Whatsmeow client).
    Accepts incoming WhatsApp messages from local or remote Evolution Go instances.
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    result = ChannelService.process_inbound_webhook(
        provider="EVOLUTION_GO",
        payload=payload,
        db=db
    )
    return result

@router.get("/whatsapp/meta", tags=["WhatsApp Webhook"])
def meta_webhook_verification(
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_challenge: str = Query(None, alias="hub.challenge"),
    hub_verify_token: str = Query(None, alias="hub.verify_token")
):
    """
    Meta Webhook Challenge Verification Endpoint.
    Used by Meta Graph API during initial webhook URL subscription.
    """
    # Accept any verify token in development or test mode
    if hub_mode == "subscribe" and hub_challenge:
        return Response(content=hub_challenge, media_type="text/plain")
    raise HTTPException(status_code=403, detail="Verification token mismatch")

@router.post("/whatsapp/meta", tags=["WhatsApp Webhook"])
async def meta_whatsapp_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Webhook Ingress Endpoint for official Meta WhatsApp Cloud API.
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    result = ChannelService.process_inbound_webhook(
        provider="META_CLOUD_API",
        payload=payload,
        db=db
    )
    return result

@router.post("/outbox/enqueue", tags=["Outbox Queue"])
def enqueue_outbound_message(
    payload: EnqueueMessageRequest,
    x_tenant_id: str = Query(..., alias="tenant_id"),
    db: Session = Depends(get_db)
):
    """Enqueues an outbound message in the transactional outbox."""
    try:
        tenant_uuid = UUID(x_tenant_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid tenant_id format")

    outbox = ChannelService.enqueue_outbound_message(
        tenant_id=tenant_uuid,
        channel_connection_id=payload.channel_connection_id,
        recipient_phone=payload.recipient_phone,
        text_content=payload.text,
        db=db
    )
    return {
        "status": "ENQUEUED",
        "outbox_id": str(outbox.id),
        "status_state": outbox.status,
        "recipient_phone": outbox.recipient_phone
    }

@router.post("/outbox/dispatch/{outbox_id}", tags=["Outbox Queue"])
def dispatch_outbound_message(outbox_id: UUID, db: Session = Depends(get_db)):
    """Triggers delivery dispatch for a specific outbox record."""
    result = ChannelService.dispatch_outbox_message(outbox_id=outbox_id, db=db)
    if not result.get("success") and result.get("error") == "Outbox record not found":
        raise HTTPException(status_code=404, detail="Outbox message not found")
    return result
