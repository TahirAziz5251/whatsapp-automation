import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, ForeignKeyConstraint, Text, Integer
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from app.core.database import Base

class TenantConversation(Base):
    __tablename__ = "tenant_conversations"

    tenant_id = Column(UUID(as_uuid=True), ForeignKey("platform_tenants.id", ondelete="CASCADE"), primary_key=True)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contact_id = Column(UUID(as_uuid=True), nullable=False)
    channel_connection_id = Column(UUID(as_uuid=True), ForeignKey("channel_connections.id"), nullable=False)
    session_key = Column(String(255), nullable=False)
    status = Column(String(30), default="ACTIVE")
    ai_paused = Column(Boolean, default=False)
    assigned_user_id = Column(UUID(as_uuid=True), ForeignKey("platform_users.id"), nullable=True)
    last_message_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    messages = relationship("TenantMessage", back_populates="conversation", cascade="all, delete-orphan")

class TenantMessage(Base):
    __tablename__ = "tenant_messages"

    tenant_id = Column(UUID(as_uuid=True), primary_key=True)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id = Column(UUID(as_uuid=True), nullable=False)
    provider_message_id = Column(String(150), nullable=True)
    sender_type = Column(String(20), nullable=False) # 'CUSTOMER', 'AI_AGENT', 'HUMAN_STAFF', 'SYSTEM'
    message_type = Column(String(20), nullable=False, default="text")
    content = Column(Text, nullable=False)
    media_url = Column(Text, nullable=True)
    delivery_status = Column(String(20), default="SENT")
    metadata_ = Column("metadata", JSONB, default=dict)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "conversation_id"],
            ["tenant_conversations.tenant_id", "tenant_conversations.id"],
            ondelete="CASCADE"
        ),
    )

    conversation = relationship("TenantConversation", back_populates="messages")

class TenantOutboxMessage(Base):
    __tablename__ = "tenant_outbox_messages"

    tenant_id = Column(UUID(as_uuid=True), ForeignKey("platform_tenants.id", ondelete="CASCADE"), primary_key=True)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    channel_connection_id = Column(UUID(as_uuid=True), ForeignKey("channel_connections.id"), nullable=False)
    recipient_phone = Column(String(50), nullable=False)
    message_type = Column(String(30), nullable=False, default="text")
    payload = Column(JSONB, nullable=False)
    status = Column(String(20), nullable=False, default="PENDING")
    retry_count = Column(Integer, nullable=False, default=0)
    max_retries = Column(Integer, nullable=False, default=5)
    next_retry_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class TenantAuditEvent(Base):
    __tablename__ = "tenant_audit_events"

    tenant_id = Column(UUID(as_uuid=True), ForeignKey("platform_tenants.id", ondelete="CASCADE"), primary_key=True)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_type = Column(String(30), nullable=False)
    actor_id = Column(String(100), nullable=True)
    action = Column(String(100), nullable=False)
    resource_type = Column(String(50), nullable=True)
    resource_id = Column(String(100), nullable=True)
    details = Column(JSONB, default=dict)
    ip_address = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
