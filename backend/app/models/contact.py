import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, ForeignKey, UniqueConstraint, ARRAY, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.core.database import Base

class PlatformContact(Base):
    __tablename__ = "platform_contacts"

    tenant_id = Column(UUID(as_uuid=True), ForeignKey("platform_tenants.id", ondelete="CASCADE"), primary_key=True)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_phone = Column(String(50), nullable=False)
    full_name = Column(String(100), nullable=True)
    push_name = Column(String(100), nullable=True)
    email = Column(String(255), nullable=True)
    tags = Column(ARRAY(Text), default=list)
    metadata_ = Column("metadata", JSONB, default=dict)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        UniqueConstraint("tenant_id", "customer_phone", name="uq_tenant_contact_phone"),
    )
