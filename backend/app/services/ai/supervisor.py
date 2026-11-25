import json
import uuid
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.models.tenant import PlatformTenant, BusinessTemplate, ChannelConnection
from app.models.communication import TenantConversation, TenantMessage, TenantOutboxMessage
from app.services.ai.prompt_engine import build_system_prompt, detect_language_and_script
from app.services.ai.tool_registry import get_allowed_tool_schemas, execute_tool
from app.services.ai.groq_client import GroqClient

logger = logging.getLogger(__name__)

class AiSupervisor:
    def __init__(self, groq_client: Optional[GroqClient] = None):
        self.groq_client = groq_client or GroqClient()

    async def process_message(
        self,
        db: Session,
        tenant_id: str,
        conversation_id: str,
        customer_phone: str,
        user_text: str
    ) -> Dict[str, Any]:
        """
        Processes an incoming customer message through the tenant-scoped AI Supervisor:
        1. Sets PostgreSQL Row-Level Security for tenant.
        2. Retrieves tenant profile & template.
        3. Detects language/script.
        4. Dynamically builds trilingual prompt & allowed tools schema.
        5. Calls Groq Llama 3.3 70B engine.
        6. Intercepts and executes tool calls under strict tenant isolation.
        7. Synthesizes final response in customer's mirrored language.
        8. Persists AI message and enqueues to outbox.
        """
        # Step 1: Enforce PostgreSQL Row-Level Security
        db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))

        # Step 2: Retrieve Tenant & Template
        tenant = db.query(PlatformTenant).filter(PlatformTenant.id == tenant_id).first()
        if not tenant:
            return {"status": "ERROR", "message": f"Tenant '{tenant_id}' not found."}

        template = db.query(BusinessTemplate).filter(BusinessTemplate.id == tenant.business_template_id).first()
        allowed_tool_names = template.allowed_tools if template and template.allowed_tools else []

        # Step 3: Detect Language & Script
        lang_info = detect_language_and_script(user_text)

        # Step 4: Build System Prompt & Filter Allowed Tools
        system_prompt = build_system_prompt(tenant, template)
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

        # Step 6: Invoke Groq LLM
        first_response = await self.groq_client.chat_completion(
            messages=messages,
            tools=tool_schemas if tool_schemas else None
        )

        msg_obj = first_response.get("message", {})
        tool_calls = msg_obj.get("tool_calls")
        tools_executed: List[Dict[str, Any]] = []

        # Step 7: Handle Tool Calling Loop
        if tool_calls:
            # Append assistant message with tool calls
            messages.append(msg_obj)

            for tc in tool_calls:
                call_id = tc.get("id")
                fn_name = tc.get("function", {}).get("name")
                raw_args = tc.get("function", {}).get("arguments", "{}")

                try:
                    args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                except Exception:
                    args = {}

                # Secure Tool Execution Gate
                tool_output = execute_tool(
                    tenant_id=str(tenant_id),
                    allowed_tool_names=allowed_tool_names,
                    tool_name=fn_name,
                    arguments=args,
                    customer_phone=customer_phone,
                    db=db
                )

                # Enrich booking confirmations with tenant branding and dynamic ticket URL
                if fn_name == "book_appointment" and isinstance(tool_output, dict) and tool_output.get("status") == "CONFIRMED":
                    from app.services.template_formatter import get_ticket_url
                    ref_id = tool_output.get("appointment_number") or tool_output.get("appointment_id", "")
                    t_settings = tenant.settings or {}
                    tool_output["business_name"] = tenant.name
                    tool_output["template_id"] = tenant.business_template_id
                    tool_output["currency"] = tenant.currency or "PKR"
                    tool_output["business_address"] = t_settings.get("address", "")
                    tool_output["business_phone"] = t_settings.get("phone", "")
                    if ref_id:
                        tool_output["ticket_url"] = get_ticket_url(ref_id)

                tools_executed.append({
                    "call_id": call_id,
                    "tool": fn_name,
                    "arguments": args,
                    "result": tool_output
                })

                # Append tool response
                messages.append({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": json.dumps(tool_output)
                })

            # Call Groq again to synthesize final user-facing response
            second_response = await self.groq_client.chat_completion(
                messages=messages,
                tools=tool_schemas if tool_schemas else None
            )
            final_reply = second_response.get("message", {}).get("content", "")
            usage_meta = second_response.get("usage") or first_response.get("usage") or {}
        else:
            final_reply = msg_obj.get("content", "")
            usage_meta = first_response.get("usage") or {}

        # Ensure live Groq replies for confirmed bookings always include the dynamic digital ticket URL
        for exec_item in tools_executed:
            res = exec_item.get("result") or {}
            if exec_item.get("tool") == "book_appointment" and res.get("status") == "CONFIRMED":
                t_url = res.get("ticket_url")
                if t_url and t_url not in (final_reply or ""):
                    final_reply = f"{final_reply}\n\n📲 Live Digital Ticket & Self-Service Link:\n{t_url}".strip()

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
            outbox_entry = TenantOutboxMessage(
                tenant_id=tenant.id,
                channel_connection_id=connection.id,
                recipient_phone=customer_phone,
                message_type="text",
                payload={"text": final_reply},
                status="PENDING"
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
