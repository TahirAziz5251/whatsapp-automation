import json
import uuid
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.models.tenant import PlatformTenant, BusinessTemplate, ChannelConnection
from app.models.communication import TenantConversation, TenantMessage, TenantOutboxMessage
from app.services.ai.prompt_engine import build_system_prompt, detect_language_and_script
from app.services.ai.tool_registry import get_allowed_tool_schemas, execute_tool
from app.services.ai.groq_client import GroqClient
from app.services.ai.output_validator import validate_ai_response

logger = logging.getLogger(__name__)


def _update_state_from_tool(state_json: Dict[str, Any], fn_name: str, tool_output: Dict[str, Any], turn_idemp: str) -> Dict[str, Any]:
    """Updates conversation state machine (step, draft_booking, issued_options) from tool results."""
    state = dict(state_json or {})
    issued = dict(state.get("issued_options") or {})
    status = str(tool_output.get("status") or "").upper()

    if fn_name == "get_departments" and status == "SUCCESS":
        issued["departments"] = [d.get("name") for d in tool_output.get("departments") or [] if d.get("name")]
        state["step"] = "DISCOVERED_DEPARTMENTS"
    elif fn_name in ("get_doctor_schedule", "search_doctors", "get_availability") and status == "SUCCESS":
        docs = tool_output.get("doctors") or []
        issued["doctors"] = [d.get("name") for d in docs if d.get("name")]
        all_slots: List[str] = []
        for d in docs:
            for s in d.get("open_slots") or []:
                if s not in all_slots:
                    all_slots.append(s)
        issued["slots"] = all_slots[:12]
        state["step"] = "SLOTS_SHOWN" if all_slots else "NO_SLOTS_ON_DATE"
    elif fn_name == "get_appointments" and status == "SUCCESS":
        issued["appointments"] = [a.get("appointment_number") for a in tool_output.get("appointments") or [] if a.get("appointment_number")]
    elif fn_name in ("book_appointment", "create_booking"):
        if status == "CONFIRMATION_REQUIRED":
            state["step"] = "AWAITING_CONFIRMATION"
            state["draft_booking"] = tool_output.get("summary") or {}
            state["pending_idempotency_key"] = state.get("pending_idempotency_key") or turn_idemp
        elif status == "CONFIRMED":
            state["step"] = "BOOKED"
            state.pop("draft_booking", None)
            state.pop("pending_idempotency_key", None)
            if tool_output.get("appointment_number"):
                apts = list(issued.get("appointments") or [])
                if tool_output["appointment_number"] not in apts:
                    apts.append(tool_output["appointment_number"])
                issued["appointments"] = apts[-5:]
    elif fn_name == "reschedule_appointment" and status == "CONFIRMATION_REQUIRED":
        state["step"] = "AWAITING_RESCHEDULE_CONFIRM"
        state["draft_reschedule"] = tool_output.get("summary") or {}
    elif fn_name in ("reschedule_appointment", "cancel_appointment") and status in ("RESCHEDULED", "CANCELLED"):
        state["step"] = status
        state.pop("draft_reschedule", None)
    elif fn_name in ("handoff_to_human", "escalate_to_human") and status == "HANDOFF_ACTIVE":
        state["step"] = "HANDOFF_ACTIVE"

    state["issued_options"] = issued
    return state


class AiSupervisor:
    def __init__(self, groq_client: Optional[GroqClient] = None):
        self.groq_client = groq_client or GroqClient()

    async def process_message(
        self,
        db: Session,
        tenant_id: str,
        conversation_id: str,
        customer_phone: str,
        user_text: str,
        defer_outbox_seconds: int = 0,
    ) -> Dict[str, Any]:
        """
        Processes an incoming customer message through the tenant-scoped AI Supervisor:
        1. Sets PostgreSQL Row-Level Security for tenant and honors human handoff pause.
        2. Loads tenant profile, patient profile, and conversation state.
        3. Builds dynamic runtime Master Prompt & allowed 13-tool schemas.
        4. Runs bounded multi-step tool loop + executes Layer 1/2 DB & RAG tools.
        5. Runs deterministic Output Validator before persistence and outbox dispatch.
        """
        # Step 1: Enforce PostgreSQL Row-Level Security
        db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))

        # Check active conversation handoff/pause flag
        try:
            conv_obj = (
                db.query(TenantConversation)
                .filter(
                    TenantConversation.tenant_id == uuid.UUID(str(tenant_id)),
                    TenantConversation.id == uuid.UUID(str(conversation_id)),
                )
                .first()
            )
            if conv_obj and bool(getattr(conv_obj, "ai_paused", False)):
                return {
                    "status": "AI_PAUSED",
                    "tenant_id": str(tenant_id),
                    "conversation_id": str(conversation_id),
                    "response_text": "",
                    "tools_executed": [],
                }
        except Exception:
            pass

        # Step 2: Retrieve Tenant & Template
        tenant = db.query(PlatformTenant).filter(PlatformTenant.id == tenant_id).first()
        if not tenant:
            return {"status": "ERROR", "message": f"Tenant '{tenant_id}' not found."}

        template = db.query(BusinessTemplate).filter(BusinessTemplate.id == tenant.business_template_id).first()
        allowed_tool_names = template.allowed_tools if template and template.allowed_tools else []

        # Step 3: Detect Language & Load Runtime Context (Patient Profile + State Machine)
        lang_info = detect_language_and_script(user_text)
        from app.services.clinic_service import (
            _get_tenant_timezone_and_now,
            get_conversation_state_db,
            get_patient_profile_db,
            save_conversation_state_db,
        )

        try:
            _, now_local = _get_tenant_timezone_and_now(db, str(tenant.id))
            patient_profile = get_patient_profile_db(db, str(tenant.id), customer_phone)
            state_json = get_conversation_state_db(db, str(tenant.id), customer_phone)
        except Exception:
            now_local = datetime.now(timezone.utc)
            patient_profile = None
            state_json = {"step": "IDLE", "issued_options": {}}

        runtime_context = {
            "current_datetime": now_local.strftime("%Y-%m-%d %I:%M %p (%A)"),
            "patient_phone": customer_phone,
            "patient_profile": patient_profile,
            "state_json": state_json,
            "handoff_flag": False,
            "language": lang_info["language"],
        }

        # Step 4: Build Runtime Master System Prompt & Filter Allowed Tools
        system_prompt = build_system_prompt(tenant, template, runtime_context=runtime_context)
        tool_schemas = get_allowed_tool_schemas(allowed_tool_names)

        # Step 4.5: Check AI Entitlement Quota
        from app.services.billing_service import check_entitlement_db, record_usage_db
        entitlement = check_entitlement_db(db, str(tenant.id), "AI_TOKENS")
        if not entitlement.get("allowed"):
            quota_reply = (
                "Hamara AI assistant is waqt monthly quota limit per pohanch chuka hai. Hamara staff jald hi aap se rabta karega."
                if lang_info["language"] == "ROMAN_URDU"
                else "Our AI assistant has reached its monthly quota limit. A staff member will assist you shortly."
            )
            return {
                "status": "QUOTA_EXCEEDED",
                "tenant_id": str(tenant.id),
                "conversation_id": str(conversation_id),
                "response_text": quota_reply,
                "reason": entitlement.get("reason"),
                "tools_executed": []
            }

        # Step 5: Assemble Conversation Messages
        messages: List[Dict[str, Any]] = [
            {"role": "system", "content": system_prompt}
        ]

        # Retrieve recent history (up to last 6 messages)
        history_msgs = db.query(TenantMessage).filter(
            TenantMessage.tenant_id == tenant_id,
            TenantMessage.conversation_id == conversation_id
        ).order_by(TenantMessage.created_at.desc()).limit(6).all()

        for m in reversed(history_msgs):
            role = "user" if m.sender_type == "CUSTOMER" else "assistant"
            messages.append({"role": role, "content": m.content})

        # Append current user message if not already in history
        if not history_msgs or history_msgs[0].content != user_text:
            messages.append({"role": "user", "content": user_text})

        # Step 6 & 7: Bounded Multi-Step Tool Calling Loop (max 4 rounds)
        tools_executed: List[Dict[str, Any]] = []
        final_reply = ""
        total_usage_tokens = 0
        turn_idemp_key = f"{conversation_id}:{uuid.uuid5(uuid.NAMESPACE_OID, user_text).hex[:8]}"
        t_settings = tenant.settings or {}

        for _round in range(4):
            llm_response = await self.groq_client.chat_completion(
                messages=messages,
                tools=tool_schemas if tool_schemas else None,
            )
            round_usage = llm_response.get("usage") or {}
            total_usage_tokens += int(round_usage.get("total_tokens") or 0)

            msg_obj = llm_response.get("message", {})
            tool_calls = msg_obj.get("tool_calls")

            if not tool_calls:
                final_reply = msg_obj.get("content", "") or ""
                break

            messages.append(msg_obj)
            for tc in tool_calls:
                call_id = tc.get("id")
                fn_name = tc.get("function", {}).get("name")
                raw_args = tc.get("function", {}).get("arguments", "{}")

                try:
                    args = json.loads(raw_args) if isinstance(raw_args, str) else dict(raw_args or {})
                except Exception:
                    args = {}

                if fn_name in ("book_appointment", "create_booking") and not args.get("idempotency_key"):
                    args["idempotency_key"] = state_json.get("pending_idempotency_key") or turn_idemp_key

                # Secure Tool Execution Gate
                tool_output = execute_tool(
                    tenant_id=str(tenant_id),
                    allowed_tool_names=allowed_tool_names,
                    tool_name=fn_name,
                    arguments=args,
                    customer_phone=customer_phone,
                    db=db,
                )

                # Enrich booking confirmations with tenant branding, ticket URL, and map URL
                if fn_name in ("book_appointment", "create_booking") and isinstance(tool_output, dict) and tool_output.get("status") == "CONFIRMED":
                    from app.services.template_formatter import get_ticket_url
                    ref_id = tool_output.get("appointment_number") or tool_output.get("appointment_id", "")
                    tool_output["business_name"] = tenant.name
                    tool_output["template_id"] = tenant.business_template_id
                    tool_output["currency"] = tenant.currency or "PKR"
                    tool_output["business_address"] = t_settings.get("address", "")
                    tool_output["business_phone"] = t_settings.get("phone", "")
                    tool_output["map_url"] = t_settings.get("map_url", "")
                    if ref_id:
                        tool_output["ticket_url"] = get_ticket_url(ref_id)

                if isinstance(tool_output, dict):
                    state_json = _update_state_from_tool(state_json, fn_name, tool_output, turn_idemp_key)

                tools_executed.append({
                    "call_id": call_id,
                    "tool": fn_name,
                    "arguments": args,
                    "result": tool_output,
                })

                messages.append({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": json.dumps(tool_output, default=str),
                })

        if not final_reply and tools_executed:
            synthesis_resp = await self.groq_client.chat_completion(messages=messages, tools=None)
            total_usage_tokens += int((synthesis_resp.get("usage") or {}).get("total_tokens") or 0)
            final_reply = (synthesis_resp.get("message") or {}).get("content", "") or ""

        # Step 7.5: Deterministic Zero-Hallucination Output Validator
        validation = validate_ai_response(
            reply_text=final_reply,
            tools_executed=tools_executed,
            state_json=state_json,
            language=lang_info["language"],
            reception_phone=str(t_settings.get("phone") or ""),
        )
        if not validation["valid"]:
            logger.warning(f"Output validator blocked ungrounded reply ({validation['violations']}) for tenant={tenant.id}")
        final_reply = validation["sanitized_text"]

        # Persist conversation state machine cleanly
        try:
            save_conversation_state_db(db, str(tenant.id), customer_phone, state_json)
        except Exception:
            pass

        # Ensure live Groq replies for confirmed bookings always include Ticket URL & Google Maps Pin when configured
        for exec_item in tools_executed:
            res = exec_item.get("result") or {}
            if exec_item.get("tool") in ("book_appointment", "create_booking") and res.get("status") == "CONFIRMED":
                t_url = res.get("ticket_url")
                m_url = res.get("map_url") or t_settings.get("map_url")
                if t_url and t_url not in (final_reply or ""):
                    final_reply = f"{final_reply}\n\n📲 Live Digital Ticket & Self-Service Link:\n{t_url}".strip()
                if m_url and m_url not in (final_reply or ""):
                    final_reply = f"{final_reply}\n🗺️ Clinic Google Maps Location:\n{m_url}".strip()

        usage_meta = {"total_tokens": total_usage_tokens}

        # Fallback if empty
        if not final_reply:
            if lang_info["language"] == "ROMAN_URDU":
                final_reply = "Aap ki darkhwast par amal ho raha hai. Mazeed maloomat k liye hamare numainday se rabta karein."
            else:
                final_reply = "Thank you for reaching out. Our front desk is processing your request."

        # Step 8: Persist AI Message to TenantMessage
        ai_message = TenantMessage(
            tenant_id=tenant.id,
            conversation_id=uuid.UUID(str(conversation_id)),
            sender_type="AI_AGENT",
            message_type="text",
            content=final_reply,
            delivery_status="SENT",
            metadata_={
                "language": lang_info["language"],
                "tools_executed_count": len(tools_executed),
                "model": self.groq_client.model
            }
        )
        db.add(ai_message)
        db.flush()

        # Record AI Token Consumption (prefer actual provider usage if returned)
        actual_tokens = int(usage_meta.get("total_tokens") or 0)
        recorded_tokens = actual_tokens if actual_tokens > 0 else (len(user_text.split()) * 4 + len(final_reply.split()) * 4 + 100)
        record_usage_db(
            db=db,
            tenant_id=str(tenant.id),
            metric_name="AI_TOKENS",
            quantity=recorded_tokens,
            metadata={"conversation_id": str(conversation_id), "model": self.groq_client.model}
        )

        # Step 9: Enqueue to Transactional Outbox for Delivery
        connection = db.query(ChannelConnection).filter(
            ChannelConnection.tenant_id == tenant.id,
            ChannelConnection.phone_number_id == "alpha-clinic",
            ChannelConnection.status == "CONNECTED"
        ).first() or db.query(ChannelConnection).filter(
            ChannelConnection.tenant_id == tenant.id,
            ChannelConnection.status == "CONNECTED"
        ).first()

        outbox_entry = None
        if connection:
            retry_at = datetime.now(timezone.utc)
            if defer_outbox_seconds and defer_outbox_seconds > 0:
                retry_at = retry_at + timedelta(seconds=int(defer_outbox_seconds))
            outbox_entry = TenantOutboxMessage(
                tenant_id=tenant.id,
                channel_connection_id=connection.id,
                recipient_phone=customer_phone,
                message_type="text",
                payload={"text": final_reply, "ai_message_id": str(ai_message.id)},
                status="PENDING",
                next_retry_at=retry_at,
            )
            db.add(outbox_entry)
            db.flush()

        db.commit()

        return {
            "status": "SUCCESS",
            "tenant_id": str(tenant.id),
            "conversation_id": str(conversation_id),
            "language_detected": lang_info,
            "response_text": final_reply,
            "tools_executed": tools_executed,
            "ai_message_id": str(ai_message.id),
            "outbox_id": str(outbox_entry.id) if outbox_entry else None,
            "outbox_enqueued": bool(outbox_entry)
        }
