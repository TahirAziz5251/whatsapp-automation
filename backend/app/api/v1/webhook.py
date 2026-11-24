import re
import logging
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session
from typing import Dict, Any
from uuid import UUID
from pydantic import BaseModel
from app.core.database import get_db
from app.services.channel_service import ChannelService
from app.adapters.evolution import EvolutionGoAdapter
from app.models.communication import TenantConversation, TenantAuditEvent, TenantMessage
from app.schemas.contact import ContactOut

logger = logging.getLogger(__name__)

router = APIRouter()

class EnqueueMessageRequest(BaseModel):
    recipient_phone: str
    text: str
    channel_connection_id: UUID

@router.post("/whatsapp/evolution", tags=["WhatsApp Webhook"])
async def evolution_whatsapp_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Webhook Ingress Endpoint for Evolution Go (Whatsmeow client).
    Accepts incoming WhatsApp messages from local or remote Evolution Go instances,
    processes tenant RLS, checks for emergencies, runs AI supervisor scheduling,
    and automatically dispatches authoritative WhatsApp confirmation replies.
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

    if result.get("status") == "PROCESSED" and not result.get("ai_paused"):
        user_text = result.get("text", "")
        customer_phone = result.get("customer_phone", "")
        tenant_id = result.get("tenant_id")
        conversation_id = result.get("conversation_id")
        instance_name = result.get("instance_name") or "alpha-clinic"

        # 1. Medical Emergency Language Interception (Rescue 1122)
        # Never diagnose, prescribe, or treat; immediately redirect to emergency services
        emergency_pattern = r"\b(1122|emergency|heart attack|chest pain|stroke|unconscious|behosh|khoon|bleeding|severe pain|breath|saans|choking|accident)\b"
        if re.search(emergency_pattern, user_text, re.IGNORECASE):
            emergency_reply = (
                "🚨 EMERGENCY ADVISORY:\n\n"
                "If you or the patient are experiencing a life-threatening medical emergency, "
                "please call Rescue 1122 immediately or proceed to the nearest hospital Emergency Department.\n\n"
                "• Our clinic AI assistant does NOT provide emergency medical diagnosis or treatment.\n"
                "• Clinic reception has been notified of your emergency message."
            )
            try:
                adapter = EvolutionGoAdapter(instance_name=instance_name)
                adapter.send_text_message(recipient_phone=customer_phone, text=emergency_reply)
            except Exception as e:
                logger.error(f"Failed to dispatch emergency WhatsApp message: {e}")

            # Record high-priority audit alert for clinic reception
            try:
                audit_ev = TenantAuditEvent(
                    tenant_id=UUID(tenant_id),
                    actor_type="SYSTEM",
                    actor_id="EMERGENCY_TRIAGE",
                    action="EMERGENCY_MEDICAL_ESCALATION",
                    resource_type="PATIENT",
                    resource_id=customer_phone,
                    details={"user_text": user_text, "action_taken": "REDIRECT_RESCUE_1122"}
                )
                db.add(audit_ev)
                db.commit()
            except Exception as e:
                logger.error(f"Failed to record emergency audit event: {e}")

            result["reply_sent"] = emergency_reply
            result["emergency_triggered"] = True
            return result

        # 2. Explicit Human Staff Handoff Request
        handoff_pattern = r"\b(human|agent|receptionist|staff|doctor se baat|reception se baat|insan se baat|representative)\b"
        if re.search(handoff_pattern, user_text, re.IGNORECASE):
            try:
                conv = db.query(TenantConversation).filter(TenantConversation.id == UUID(conversation_id)).first()
                if conv:
                    conv.ai_paused = True
                    db.commit()

                handoff_reply = (
                    "Aap ki darkhwast clinic reception desk ko forward kar di gayi hai. "
                    "Hamara staff jald hi aap se is number par rabta karega. Shukriya!"
                )
                adapter = EvolutionGoAdapter(instance_name=instance_name)
                adapter.send_text_message(recipient_phone=customer_phone, text=handoff_reply)
                result["reply_sent"] = handoff_reply
                result["human_handoff"] = True
                return result
            except Exception as e:
                logger.error(f"Error handling human handoff: {e}")

        # 3. Authoritative AI Supervisor Turn (Schedules, Appointments, Queue Tokens)
        try:
            from app.services.ai.supervisor import AiSupervisor
            supervisor = AiSupervisor()
            ai_turn = await supervisor.process_message(
                db=db,
                tenant_id=tenant_id,
                conversation_id=conversation_id,
                customer_phone=customer_phone,
                user_text=user_text
            )
            reply_text = ai_turn.get("response_text", "")
            if reply_text:
                adapter = EvolutionGoAdapter(instance_name=instance_name)
                send_res = adapter.send_text_message(recipient_phone=customer_phone, text=reply_text)
                result["reply_sent"] = reply_text
                result["send_status"] = send_res.get("success", False)
                result["tools_executed"] = ai_turn.get("tools_executed", [])
        except Exception as e:
            logger.error(f"Error executing AI supervisor turn for WhatsApp inbound: {e}")

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
