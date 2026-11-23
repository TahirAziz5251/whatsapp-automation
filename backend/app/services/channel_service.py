import uuid
from typing import Dict, Any, Optional
from uuid import UUID
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.models.tenant import ChannelConnection, PlatformTenant
from app.models.contact import PlatformContact
from app.models.communication import TenantConversation, TenantMessage, TenantOutboxMessage, TenantAuditEvent
from app.adapters.evolution import EvolutionGoAdapter
from app.adapters.meta import MetaCloudApiAdapter
from app.adapters.base import BaseChannelAdapter, NormalizedInboundMessage

def get_adapter_for_connection(connection: ChannelConnection) -> BaseChannelAdapter:
    """Returns the appropriate channel adapter instance for a given connection."""
    if connection.channel_type == "EVOLUTION_GO":
        return EvolutionGoAdapter(instance_name=connection.phone_number_id)
    elif connection.channel_type == "META_CLOUD_API":
        creds = connection.credentials_encrypted or {}
        return MetaCloudApiAdapter(
            phone_number_id=connection.phone_number_id,
            access_token=creds.get("access_token", "")
        )
    else:
        # Default fallback to Evolution Go
        return EvolutionGoAdapter(instance_name=connection.phone_number_id)

class ChannelService:
    @staticmethod
    def process_inbound_webhook(provider: str, payload: Dict[str, Any], db: Session) -> Dict[str, Any]:
        """
        Inbound Webhook Normalization & Processing Pipeline:
        1. Normalizes vendor payload into standard NormalizedInboundMessage.
        2. Resolves tenant_id via ChannelConnection.
        3. Enforces PostgreSQL Row-Level Security (RLS) for tenant_id.
        4. Deduplicates event (drops duplicate provider_message_id).
        5. Upserts PlatformContact & TenantConversation.
        6. Persists message in TenantMessage.
        7. Records TenantAuditEvent.
        """
        # Step 1: Normalize via Adapter
        if provider.upper() == "EVOLUTION_GO":
            adapter = EvolutionGoAdapter()
        elif provider.upper() == "META_CLOUD_API":
            adapter = MetaCloudApiAdapter()
        else:
            return {"status": "REJECTED", "reason": f"Unsupported provider: {provider}"}
        
        normalized = adapter.normalize_inbound(payload)
        if not normalized:
            return {"status": "IGNORED", "reason": "Non-customer, self-sent, or filtered event"}

        # Step 2: Identify Connection & Resolve Tenant
        connection = db.query(ChannelConnection).filter(
            ChannelConnection.phone_number_id == normalized.instance_name
        ).first()

        if not connection:
            return {
                "status": "UNMAPPED_CONNECTION",
                "instance_name": normalized.instance_name,
                "reason": f"No active tenant mapped to instance '{normalized.instance_name}'"
            }

        tenant_id = connection.tenant_id

        # Step 3: Enforce PostgreSQL Row-Level Security for this Tenant
        db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))

        # Step 4: Deduplicate Inbound Event
        existing_msg = db.query(TenantMessage).filter(
            TenantMessage.tenant_id == tenant_id,
            TenantMessage.provider_message_id == normalized.provider_message_id
        ).first()

        if existing_msg:
            return {
                "status": "DUPLICATE_DROPPED",
                "message_id": normalized.provider_message_id,
                "tenant_id": str(tenant_id)
            }

        # Step 5: Upsert Platform Contact (Customer)
        contact = db.query(PlatformContact).filter(
            PlatformContact.tenant_id == tenant_id,
            PlatformContact.customer_phone == normalized.customer_phone
        ).first()

        if not contact:
            contact = PlatformContact(
                tenant_id=tenant_id,
                customer_phone=normalized.customer_phone,
                full_name=normalized.push_name,
                push_name=normalized.push_name
            )
            db.add(contact)
            db.flush()
        else:
            if normalized.push_name and contact.push_name != normalized.push_name:
                contact.push_name = normalized.push_name
                db.flush()

        # Step 6: Upsert Tenant Conversation
        session_key = f"{tenant_id}:{normalized.customer_phone}"
        conversation = db.query(TenantConversation).filter(
            TenantConversation.tenant_id == tenant_id,
            TenantConversation.session_key == session_key
        ).first()

        if not conversation:
            conversation = TenantConversation(
                tenant_id=tenant_id,
                contact_id=contact.id,
                channel_connection_id=connection.id,
                session_key=session_key,
                status="ACTIVE",
                last_message_at=datetime.now(timezone.utc)
            )
            db.add(conversation)
            db.flush()
        else:
            conversation.last_message_at = datetime.now(timezone.utc)

        # Step 7: Persist Inbound Message
        inbound_msg = TenantMessage(
            tenant_id=tenant_id,
            conversation_id=conversation.id,
            provider_message_id=normalized.provider_message_id,
            sender_type="CUSTOMER",
            message_type=normalized.message_type,
            content=normalized.text,
            delivery_status="DELIVERED"
        )
        db.add(inbound_msg)

        # Step 8: Record Audit Event
        audit_event = TenantAuditEvent(
            tenant_id=tenant_id,
            actor_type="CUSTOMER",
            actor_id=normalized.customer_phone,
            action="WHATSAPP_INBOUND_RECEIVED",
            resource_type="MESSAGE",
            resource_id=normalized.provider_message_id,
            details={
                "provider": normalized.provider,
                "instance_name": normalized.instance_name,
                "text_length": len(normalized.text)
            }
        )
        db.add(audit_event)

        # Record Metered Usage for Inbound WhatsApp Message
        from app.services.billing_service import record_usage_db
        record_usage_db(
            db=db,
            tenant_id=str(tenant_id),
            metric_name="WHATSAPP_INBOUND",
            quantity=1
        )

        db.commit()

        return {
            "status": "PROCESSED",
            "tenant_id": str(tenant_id),
            "conversation_id": str(conversation.id),
            "contact_id": str(contact.id),
            "customer_phone": normalized.customer_phone,
            "push_name": normalized.push_name,
            "text": normalized.text,
            "ai_paused": conversation.ai_paused
        }

    @staticmethod
    def enqueue_outbound_message(
        tenant_id: UUID,
        channel_connection_id: UUID,
        recipient_phone: str,
        text_content: str,
        db: Session
    ) -> TenantOutboxMessage:
        """Enqueues an outbound WhatsApp message in the transactional outbox."""
        db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
        
        outbox = TenantOutboxMessage(
            tenant_id=tenant_id,
            channel_connection_id=channel_connection_id,
            recipient_phone=recipient_phone,
            message_type="text",
            payload={"text": text_content},
            status="PENDING",
            retry_count=0
        )
        db.add(outbox)
        db.commit()
        db.refresh(outbox)
        return outbox

    @staticmethod
    def dispatch_outbox_message(outbox_id: UUID, db: Session) -> Dict[str, Any]:
        """Dispatches an enqueued outbox message via its assigned channel adapter."""
        outbox = db.query(TenantOutboxMessage).filter(TenantOutboxMessage.id == outbox_id).first()
        if not outbox:
            return {"success": False, "error": "Outbox record not found"}

        db.execute(text(f"SET app.current_tenant_id = '{outbox.tenant_id}'"))

        connection = db.query(ChannelConnection).filter(
            ChannelConnection.id == outbox.channel_connection_id
        ).first()

        if not connection:
            outbox.status = "FAILED"
            outbox.last_error = "Associated ChannelConnection not found"
            db.commit()
            return {"success": False, "error": outbox.last_error}

        adapter = get_adapter_for_connection(connection)
        text_body = outbox.payload.get("text", "")

        dispatch_result = adapter.send_text_message(outbox.recipient_phone, text_body)

        if dispatch_result.get("success"):
            outbox.status = "DISPATCHED"
            outbox.updated_at = datetime.now(timezone.utc)

            # Record message in conversation history if active conversation exists
            session_key = f"{outbox.tenant_id}:{outbox.recipient_phone}"
            conversation = db.query(TenantConversation).filter(
                TenantConversation.tenant_id == outbox.tenant_id,
                TenantConversation.session_key == session_key
            ).first()

            if conversation:
                outbound_msg = TenantMessage(
                    tenant_id=outbox.tenant_id,
                    conversation_id=conversation.id,
                    provider_message_id=str(dispatch_result.get("response", {}).get("key", {}).get("id", uuid.uuid4().hex)),
                    sender_type="AI_AGENT",
                    message_type="text",
                    content=text_body,
                    delivery_status="SENT"
                )
                db.add(outbound_msg)

            # Record Metered Usage for Outbound WhatsApp Message
            from app.services.billing_service import record_usage_db
            record_usage_db(
                db=db,
                tenant_id=str(outbox.tenant_id),
                metric_name="WHATSAPP_OUTBOUND",
                quantity=1
            )

            db.commit()
            return {"success": True, "outbox_id": str(outbox.id), "status": "DISPATCHED"}
        else:
            outbox.retry_count += 1
            outbox.last_error = str(dispatch_result.get("error") or dispatch_result.get("response"))
            if outbox.retry_count >= outbox.max_retries:
                outbox.status = "DEAD_LETTER"
            else:
                outbox.status = "FAILED"
            db.commit()
            return {"success": False, "outbox_id": str(outbox.id), "status": outbox.status, "error": outbox.last_error}
