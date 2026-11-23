import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Numeric, Integer
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from app.core.database import Base

class SubscriptionPlan(Base):
    __tablename__ = "platform_subscription_plans"

    id = Column(String(50), primary_key=True)
    name = Column(String(100), nullable=False)
    monthly_price_pkr = Column(Numeric(10, 2), nullable=False, default=0.0)
    max_whatsapp_messages = Column(Integer, nullable=False, default=1000)
    max_ai_tokens = Column(Integer, nullable=False, default=100000)
    max_staff_seats = Column(Integer, nullable=False, default=3)
    max_doctors = Column(Integer, nullable=False, default=2)
    features = Column(JSONB, default=dict)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class TenantSubscription(Base):
    __tablename__ = "tenant_subscriptions"

    tenant_id = Column(UUID(as_uuid=True), ForeignKey("platform_tenants.id", ondelete="CASCADE"), primary_key=True)
    plan_id = Column(String(50), ForeignKey("platform_subscription_plans.id"), nullable=False)
    status = Column(String(30), nullable=False, default="ACTIVE")
    current_period_start = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    current_period_end = Column(DateTime(timezone=True))
    auto_renew = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    plan = relationship("SubscriptionPlan")


class TenantUsageRecord(Base):
    __tablename__ = "tenant_usage_records"

    tenant_id = Column(UUID(as_uuid=True), ForeignKey("platform_tenants.id", ondelete="CASCADE"), primary_key=True)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    metric_name = Column(String(50), nullable=False)
    quantity = Column(Integer, nullable=False, default=1)
    period_month = Column(String(7), nullable=False)
    metadata_ = Column("metadata", JSONB, default=dict)
    recorded_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
