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
@router.post("/evolution/webhook", tags=["WhatsApp Webhook"])
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

    logger.info(f"Received Evolution webhook: event={payload.get('event')}, instance={payload.get('instance') or payload.get('instanceName')}")

    try:
        result = ChannelService.process_inbound_webhook(
            provider="EVOLUTION_GO",
            payload=payload,
            db=db
        )
    except Exception as e:
        logger.error(f"Error in ChannelService.process_inbound_webhook: {e}", exc_info=True)
        return {"status": "ERROR", "error": str(e)}

    if result.get("status") != "PROCESSED":
        logger.info(f"Webhook discarded or skipped: status={result.get('status')}, reason={result.get('reason')}")
        return result

    if not result.get("ai_paused"):
        user_text = result.get("text", "")
        customer_phone = result.get("customer_phone", "")
        tenant_id = result.get("tenant_id")
        conversation_id = result.get("conversation_id")
        instance_name = result.get("instance_name") or "alpha-clinic"

        logger.info(f"Processing inbound message from {customer_phone} (Instance: {instance_name}): '{user_text}'")

        # 1. Medical Emergency Language Interception (Rescue 1122)
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
                send_res = adapter.send_text_message(recipient_phone=customer_phone, text=emergency_reply)
                logger.info(f"Emergency advisory dispatched to {customer_phone}: {send_res}")
            except Exception as e:
                logger.error(f"Failed to dispatch emergency WhatsApp message: {e}")

            # Record high-priority audit alert, pause AI, and broadcast HANDOFF_REQUESTED to /reception
            try:
                conv_em = db.query(TenantConversation).filter(TenantConversation.id == UUID(conversation_id)).first()
                if conv_em:
                    conv_em.ai_paused = True
                    conv_em.status = "PAUSED_FOR_HUMAN"
                esc_id = f"EMG-{str(conversation_id)[:6].upper()}"
                audit_ev = TenantAuditEvent(
                    tenant_id=UUID(tenant_id),
                    actor_type="SYSTEM",
                    actor_id="EMERGENCY_TRIAGE",
                    action="EMERGENCY_MEDICAL_ESCALATION",
                    resource_type="PATIENT",
                    resource_id=customer_phone,
                    details={"user_text": user_text, "action_taken": "REDIRECT_RESCUE_1122", "ticket_id": esc_id}
                )
                db.add(audit_ev)
                db.commit()

                from app.services.clinic_event_broadcaster import broadcaster
                await broadcaster.broadcast(
                    tenant_id=str(tenant_id),
                    event_type="HANDOFF_REQUESTED",
                    data={
                        "ticket_id": esc_id,
                        "priority": "urgent",
                        "patient_phone": customer_phone,
                        "conversation_id": str(conversation_id),
                        "reason": user_text,
                        "ai_paused": True,
                    },
                )
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
                    conv.status = "PAUSED_FOR_HUMAN"
                    db.commit()

                handoff_reply = (
                    "Aap ki darkhwast clinic reception desk ko forward kar di gayi hai. "
                    "Hamara staff jald hi aap se is number par rabta karega. Shukriya!"
                )
                adapter = EvolutionGoAdapter(instance_name=instance_name)
                send_res = adapter.send_text_message(recipient_phone=customer_phone, text=handoff_reply)
                logger.info(f"Human handoff message dispatched to {customer_phone}: {send_res}")

                from app.services.clinic_event_broadcaster import broadcaster
                await broadcaster.broadcast(
                    tenant_id=str(tenant_id),
                    event_type="HANDOFF_REQUESTED",
                    data={
                        "ticket_id": f"ESC-{str(conversation_id)[:6].upper()}",
                        "priority": "normal",
                        "patient_phone": customer_phone,
                        "conversation_id": str(conversation_id),
                        "reason": user_text,
                        "ai_paused": True,
                    },
                )

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
            outbox_id = ai_turn.get("outbox_id")
            if reply_text:
                adapter = EvolutionGoAdapter(instance_name=instance_name)
                send_res = adapter.send_text_message(recipient_phone=customer_phone, text=reply_text)
                logger.info(f"AI response dispatched to {customer_phone}: {send_res.get('status_code')} | Success: {send_res.get('success')}")
                # Sync outbox state so background dispatcher never double-sends
                if outbox_id:
                    from app.models.communication import TenantOutboxMessage
                    from datetime import datetime, timezone
                    outbox_row = db.query(TenantOutboxMessage).filter(TenantOutboxMessage.id == UUID(outbox_id)).first()
                    if outbox_row:
                        if send_res.get("success"):
                            outbox_row.status = "DISPATCHED"
                            outbox_row.updated_at = datetime.now(timezone.utc)
                        else:
                            outbox_row.status = "FAILED"
                            outbox_row.last_error = str(send_res.get("error") or send_res.get("response"))
                        db.commit()
                result["reply_sent"] = reply_text
                result["send_status"] = send_res.get("success", False)
                result["tools_executed"] = ai_turn.get("tools_executed", [])

            # Emit real-time SSE updates & native WhatsApp location pin after committed actions
            from app.services.clinic_event_broadcaster import broadcaster
            from app.adapters.evolution import parse_lat_lng_from_map_url
            for exec_item in ai_turn.get("tools_executed", []):
                t_name = exec_item.get("tool")
                t_res = exec_item.get("result") or {}
                t_status = t_res.get("status")
                if t_name in ("book_appointment", "create_booking") and t_status == "CONFIRMED":
                    if not t_res.get("idempotent_replay"):
                        await broadcaster.broadcast(
                            tenant_id=str(tenant_id),
                            event_type="BOOKING_CREATED",
                            data=t_res
                        )
                        # Best-effort native WhatsApp location pin (map link is already in text)
                        coords = parse_lat_lng_from_map_url(t_res.get("map_url"))
                        if coords:
                            try:
                                EvolutionGoAdapter(instance_name=instance_name).send_location(
                                    recipient_phone=customer_phone,
                                    latitude=coords[0],
                                    longitude=coords[1],
                                    name=t_res.get("business_name", "Clinic Location"),
                                    address=t_res.get("business_address", ""),
                                )
                            except Exception as loc_err:
                                logger.debug(f"Optional WhatsApp location pin skipped: {loc_err}")
                elif t_name in ("cancel_appointment", "reschedule_appointment", "check_in_patient", "check_in") and t_status in ("CANCELLED", "RESCHEDULED", "CHECKED_IN"):
                    await broadcaster.broadcast(
                        tenant_id=str(tenant_id),
                        event_type="QUEUE_UPDATED",
                        data=t_res
                    )
                elif t_name in ("handoff_to_human", "escalate_to_human") and t_status == "HANDOFF_ACTIVE":
                    await broadcaster.broadcast(
                        tenant_id=str(tenant_id),
                        event_type="HANDOFF_REQUESTED",
                        data=t_res
                    )
        except Exception as e:
            logger.error(f"Error executing AI supervisor turn for WhatsApp inbound: {e}", exc_info=True)

    return result

@router.get("/whatsapp/meta", tags=["WhatsApp Webhook"])
def meta_webhook_verification(
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_challenge: str = Query(None, alias="hub.challenge"),
    hub_verify_token: str = Query(None, alias="hub.verify_token")
):
    """
    Used by Meta Graph API during initial webhook URL subscription.
    """
    expected_token = getattr(settings, "META_WEBHOOK_VERIFY_TOKEN", "bizflow_meta_verify_2026")
    if hub_mode == "subscribe" and hub_verify_token == expected_token:
        return Response(content=hub_challenge, media_type="text/plain", status_code=status.HTTP_200_OK)
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Verification token mismatch")

@router.post("/whatsapp/meta", tags=["WhatsApp Webhook"])
async def meta_whatsapp_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Webhook Ingress Endpoint for Meta Cloud API (Official WhatsApp Business API).
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    result = ChannelService.process_inbound_webhook(
        provider="META_CLOUD",
        payload=payload,
        db=db
    )
    return result
