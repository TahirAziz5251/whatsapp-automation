import uuid
from datetime import datetime, timezone, date
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Numeric, Integer, Date
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.ext.hybrid import hybrid_property
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

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("platform_tenants.id", ondelete="CASCADE"), nullable=False)
    metric_type = Column(String(50), nullable=False)
    quantity = Column(Integer, nullable=False, default=1)
    period_date = Column(Date, default=date.today, nullable=False)
    details = Column(JSONB, default=dict)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    def __init__(self, **kwargs):
        if "metric_name" in kwargs and "metric_type" not in kwargs:
            kwargs["metric_type"] = kwargs.pop("metric_name")
        if "metadata_" in kwargs and "details" not in kwargs:
            kwargs["details"] = kwargs.pop("metadata_")
        if "metadata" in kwargs and "details" not in kwargs:
            kwargs["details"] = kwargs.pop("metadata")
        if "recorded_at" in kwargs and "created_at" not in kwargs:
            kwargs["created_at"] = kwargs.pop("recorded_at")
        if "period_month" in kwargs and "period_date" not in kwargs:
            p_month = kwargs.pop("period_month")
            try:
                kwargs["period_date"] = datetime.strptime(f"{p_month}-01", "%Y-%m-%d").date()
            except Exception:
                kwargs["period_date"] = date.today()
        super().__init__(**kwargs)

    @hybrid_property
    def metric_name(self):
        return self.metric_type

    @metric_name.setter
    def metric_name(self, value):
        self.metric_type = value

    @hybrid_property
    def metadata_(self):
        return self.details

    @metadata_.setter
    def metadata_(self, value):
        self.details = value

    @hybrid_property
    def recorded_at(self):
        return self.created_at

    @recorded_at.setter
    def recorded_at(self, value):
        self.created_at = value

