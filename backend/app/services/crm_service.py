import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text, desc

from app.models.communication import TenantConversation, TenantMessage, TenantOutboxMessage, TenantAuditEvent
from app.models.contact import PlatformContact
from app.models.tenant import ChannelConnection

def record_audit_event_db(
    db: Session,
    tenant_id: str,
    actor_type: str,
    action: str,
    actor_id: Optional[str] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
    ip_address: Optional[str] = None
) -> TenantAuditEvent:
    """Records an immutable audit event under tenant RLS."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))

    audit = TenantAuditEvent(
        tenant_id=tenant_uuid,
        actor_type=actor_type,
        actor_id=actor_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details=details or {},
        ip_address=ip_address
    )
    db.add(audit)
    db.flush()
    return audit


def list_conversations_db(
    db: Session,
    tenant_id: str,
    status: Optional[str] = None,
    ai_paused: Optional[bool] = None,
    search: Optional[str] = None,
    limit: int = 50,
    offset: int = 0
) -> List[Dict[str, Any]]:
    """Lists conversations in the staff CRM inbox with contact metadata and latest message preview."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))

    query = db.query(TenantConversation, PlatformContact).join(
        PlatformContact,
        (TenantConversation.tenant_id == PlatformContact.tenant_id) &
        (TenantConversation.contact_id == PlatformContact.id)
    ).filter(TenantConversation.tenant_id == tenant_uuid)

    if status:
        query = query.filter(TenantConversation.status == status)
    if ai_paused is not None:
        query = query.filter(TenantConversation.ai_paused == ai_paused)
    if search:
        s = f"%{search.strip()}%"
        query = query.filter(
            (PlatformContact.customer_phone.ilike(s)) |
            (PlatformContact.full_name.ilike(s)) |
            (PlatformContact.push_name.ilike(s))
        )

    results = query.order_by(desc(TenantConversation.last_message_at)).offset(offset).limit(limit).all()

    inbox = []
    for conv, contact in results:
        # Get latest message
        last_msg = db.query(TenantMessage).filter(
            TenantMessage.tenant_id == tenant_uuid,
            TenantMessage.conversation_id == conv.id
        ).order_by(desc(TenantMessage.created_at)).first()

        inbox.append({
            "id": str(conv.id),
            "session_key": conv.session_key,
            "status": conv.status,
            "ai_paused": conv.ai_paused,
            "assigned_user_id": str(conv.assigned_user_id) if conv.assigned_user_id else None,
            "last_message_at": conv.last_message_at.isoformat() if conv.last_message_at else None,
            "contact": {
                "id": str(contact.id),
                "customer_phone": contact.customer_phone,
                "full_name": contact.full_name or contact.push_name or "WhatsApp User",
                "push_name": contact.push_name,
                "tags": contact.tags or []
            },
            "last_message": {
                "content": last_msg.content if last_msg else None,
                "sender_type": last_msg.sender_type if last_msg else None,
                "created_at": last_msg.created_at.isoformat() if last_msg else None
            } if last_msg else None
        })

    return inbox


def get_conversation_thread_db(
    db: Session,
    tenant_id: str,
    conversation_id: str
) -> Optional[Dict[str, Any]]:
    """Retrieves full conversation details and chronological message thread."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))
    conv_uuid = uuid.UUID(str(conversation_id))

    row = db.query(TenantConversation, PlatformContact).join(
        PlatformContact,
        (TenantConversation.tenant_id == PlatformContact.tenant_id) &
        (TenantConversation.contact_id == PlatformContact.id)
    ).filter(
        TenantConversation.tenant_id == tenant_uuid,
        TenantConversation.id == conv_uuid
    ).first()

    if not row:
        return None

    conv, contact = row

    messages = db.query(TenantMessage).filter(
        TenantMessage.tenant_id == tenant_uuid,
        TenantMessage.conversation_id == conv.id
    ).order_by(TenantMessage.created_at.asc()).all()

    return {
        "id": str(conv.id),
        "session_key": conv.session_key,
        "status": conv.status,
        "ai_paused": conv.ai_paused,
        "assigned_user_id": str(conv.assigned_user_id) if conv.assigned_user_id else None,
        "last_message_at": conv.last_message_at.isoformat() if conv.last_message_at else None,
        "contact": {
            "id": str(contact.id),
            "customer_phone": contact.customer_phone,
            "full_name": contact.full_name or contact.push_name or "WhatsApp User",
            "push_name": contact.push_name,
            "email": contact.email,
            "tags": contact.tags or [],
            "metadata": contact.metadata_ or {}
        },
        "messages": [
            {
                "id": str(m.id),
                "sender_type": m.sender_type,
                "message_type": m.message_type,
                "content": m.content,
                "media_url": m.media_url,
                "delivery_status": m.delivery_status,
                "metadata": m.metadata_ or {},
                "created_at": m.created_at.isoformat()
            }
            for m in messages
        ]
    }


def toggle_ai_pause_db(
    db: Session,
    tenant_id: str,
    conversation_id: str,
    pause_ai: bool,
    staff_user_id: Optional[str] = None
) -> Dict[str, Any]:
    """Toggles human takeover mode (ai_paused) and records audit trail."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))
    conv_uuid = uuid.UUID(str(conversation_id))

    conv = db.query(TenantConversation).filter(
        TenantConversation.tenant_id == tenant_uuid,
        TenantConversation.id == conv_uuid
    ).first()

    if not conv:
        return {"status": "ERROR", "message": "Conversation not found"}

    conv.ai_paused = pause_ai
    conv.status = "PAUSED_FOR_HUMAN" if pause_ai else "ACTIVE"
    if pause_ai and staff_user_id:
        try:
            conv.assigned_user_id = uuid.UUID(str(staff_user_id))
        except ValueError:
            pass
    conv.updated_at = datetime.now(timezone.utc)

    # Record Audit Event
    action = "CONVERSATION_AI_PAUSED" if pause_ai else "CONVERSATION_AI_RESUMED"
    record_audit_event_db(
        db=db,
        tenant_id=tenant_id,
        actor_type="USER",
        actor_id=staff_user_id or "staff",
        action=action,
        resource_type="CONVERSATION",
        resource_id=str(conv.id),
        details={"ai_paused": pause_ai, "status": conv.status}
    )

    db.commit()

    return {
        "status": "SUCCESS",
        "conversation_id": str(conv.id),
        "ai_paused": conv.ai_paused,
        "conversation_status": conv.status
    }


def staff_send_message_db(
    db: Session,
    tenant_id: str,
    conversation_id: str,
    staff_user_id: str,
    text_content: str
) -> Dict[str, Any]:
    """Staff sends a manual WhatsApp message to patient/customer."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))
    conv_uuid = uuid.UUID(str(conversation_id))

    conv = db.query(TenantConversation).filter(
        TenantConversation.tenant_id == tenant_uuid,
        TenantConversation.id == conv_uuid
    ).first()

    if not conv:
        return {"status": "ERROR", "message": "Conversation not found"}

    contact = db.query(PlatformContact).filter(
        PlatformContact.tenant_id == tenant_uuid,
        PlatformContact.id == conv.contact_id
    ).first()

    if not contact:
        return {"status": "ERROR", "message": "Contact not found"}

    # 1. Persist in tenant_messages as HUMAN_STAFF
    staff_msg = TenantMessage(
        tenant_id=tenant_uuid,
        conversation_id=conv.id,
        sender_type="HUMAN_STAFF",
        message_type="text",
        content=text_content,
        delivery_status="SENT",
        metadata_={"staff_user_id": str(staff_user_id)}
    )
    db.add(staff_msg)

    # 2. Enqueue in tenant_outbox_messages for WhatsApp dispatch
    conn = db.query(ChannelConnection).filter(
        ChannelConnection.tenant_id == tenant_uuid,
        ChannelConnection.status == "CONNECTED"
    ).first()

    outbox_entry = None
    if conn:
        outbox_entry = TenantOutboxMessage(
            tenant_id=tenant_uuid,
            channel_connection_id=conn.id,
            recipient_phone=contact.customer_phone,
            message_type="text",
            payload={"text": text_content},
            status="PENDING"
        )
        db.add(outbox_entry)

    conv.last_message_at = datetime.now(timezone.utc)

    # 3. Record Audit Event
    record_audit_event_db(
        db=db,
        tenant_id=tenant_id,
        actor_type="USER",
        actor_id=str(staff_user_id),
        action="STAFF_MANUAL_MESSAGE_SENT",
        resource_type="MESSAGE",
        resource_id=str(staff_msg.id),
        details={"recipient_phone": contact.customer_phone, "text_length": len(text_content)}
    )

    db.commit()

    return {
        "status": "SUCCESS",
        "message_id": str(staff_msg.id),
        "conversation_id": str(conv.id),
        "recipient_phone": contact.customer_phone,
        "content": text_content,
        "outbox_enqueued": bool(outbox_entry)
    }


def update_contact_crm_db(
    db: Session,
    tenant_id: str,
    contact_id: str,
    full_name: Optional[str] = None,
    email: Optional[str] = None,
    tags: Optional[List[str]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    staff_user_id: Optional[str] = None
) -> Dict[str, Any]:
    """Updates customer/patient profile tags, notes, and metadata."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))
    contact_uuid = uuid.UUID(str(contact_id))

    contact = db.query(PlatformContact).filter(
        PlatformContact.tenant_id == tenant_uuid,
        PlatformContact.id == contact_uuid
    ).first()

    if not contact:
        return {"status": "ERROR", "message": "Contact not found"}

    if full_name is not None:
        contact.full_name = full_name
    if email is not None:
        contact.email = email
    if tags is not None:
        contact.tags = tags
    if metadata is not None:
        curr_meta = contact.metadata_ or {}
        curr_meta.update(metadata)
        contact.metadata_ = curr_meta

    contact.updated_at = datetime.now(timezone.utc)

    # Record Audit Event
    record_audit_event_db(
        db=db,
        tenant_id=tenant_id,
        actor_type="USER",
        actor_id=staff_user_id or "staff",
        action="CONTACT_UPDATED",
        resource_type="CONTACT",
        resource_id=str(contact.id),
        details={"tags": contact.tags, "updated_fields": ["tags" if tags else "profile"]}
    )

    db.commit()

    return {
        "status": "SUCCESS",
        "contact_id": str(contact.id),
        "customer_phone": contact.customer_phone,
        "full_name": contact.full_name,
        "tags": contact.tags,
        "metadata": contact.metadata_
    }


def list_audit_events_db(
    db: Session,
    tenant_id: str,
    action: Optional[str] = None,
    actor_type: Optional[str] = None,
    limit: int = 50,
    offset: int = 0
) -> List[Dict[str, Any]]:
    """Lists tenant audit events chronologically."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))

    query = db.query(TenantAuditEvent).filter(TenantAuditEvent.tenant_id == tenant_uuid)

    if action:
        query = query.filter(TenantAuditEvent.action == action)
    if actor_type:
        query = query.filter(TenantAuditEvent.actor_type == actor_type)

    events = query.order_by(desc(TenantAuditEvent.created_at)).offset(offset).limit(limit).all()

    return [
        {
            "id": str(e.id),
            "actor_type": e.actor_type,
            "actor_id": e.actor_id,
            "action": e.action,
            "resource_type": e.resource_type,
            "resource_id": e.resource_id,
            "details": e.details or {},
            "ip_address": e.ip_address,
            "created_at": e.created_at.isoformat()
        }
        for e in events
    ]
