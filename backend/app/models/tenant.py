import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from app.core.database import Base

class BusinessTemplate(Base):
    __tablename__ = "business_templates"

    id = Column(String(50), primary_key=True)
    name = Column(String(100), nullable=False)
    industry_category = Column(String(50), nullable=False)
    description = Column(Text, nullable=True)
    default_config = Column(JSONB, nullable=False, default=dict)
    allowed_tools = Column(JSONB, nullable=False, default=list)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class PlatformTenant(Base):
    __tablename__ = "platform_tenants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug = Column(String(50), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    business_template_id = Column(String(50), ForeignKey("business_templates.id"), nullable=False)
    status = Column(String(20), nullable=False, default="ACTIVE")
    timezone = Column(String(50), nullable=False, default="Asia/Karachi")
    currency = Column(String(10), nullable=False, default="PKR")
    settings = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    template = relationship("BusinessTemplate")
    memberships = relationship("TenantMembership", back_populates="tenant", cascade="all, delete-orphan")
    channels = relationship("ChannelConnection", back_populates="tenant", cascade="all, delete-orphan")

class ChannelConnection(Base):
    __tablename__ = "channel_connections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("platform_tenants.id", ondelete="CASCADE"), nullable=False)
    channel_type = Column(String(30), nullable=False) # 'META_CLOUD_API', 'EVOLUTION_GO'
    phone_number_id = Column(String(100), nullable=False)
    display_phone_number = Column(String(50), nullable=False)
    status = Column(String(20), nullable=False, default="CONNECTED")
    webhook_secret_hash = Column(String(255), nullable=True)
    credentials_encrypted = Column(JSONB, default=dict)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    tenant = relationship("PlatformTenant", back_populates="channels")
    __table_args__ = (
        UniqueConstraint("channel_type", "phone_number_id", name="uq_channel_phone"),
    )
