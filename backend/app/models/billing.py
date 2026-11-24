import uuid
from datetime import datetime, timezone, date
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Numeric, Integer, Date
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.ext.hybrid import hybrid_property
from app.core.database import Base

class SubscriptionPlan(Base):
    __tablename__ = "subscription_plans"

    id = Column(String(50), primary_key=True)
    name = Column(String(100), nullable=False)
    price_monthly_pkr = Column(Numeric(10, 2), nullable=False, default=0.0)
    included_ai_tokens = Column(Integer, nullable=False, default=100000)
    included_whatsapp_conversations = Column(Integer, nullable=False, default=1000)
    overage_per_token_pkr = Column(Numeric(10, 4), default=0.002)
    overage_per_conversation_pkr = Column(Numeric(10, 2), default=3.0)
    features = Column(JSONB, default=dict)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    @hybrid_property
    def monthly_price_pkr(self):
        return self.price_monthly_pkr

    @monthly_price_pkr.setter
    def monthly_price_pkr(self, val):
        self.price_monthly_pkr = val

    @hybrid_property
    def max_whatsapp_messages(self):
        return self.included_whatsapp_conversations

    @max_whatsapp_messages.setter
    def max_whatsapp_messages(self, val):
        self.included_whatsapp_conversations = val

    @hybrid_property
    def max_ai_tokens(self):
        return self.included_ai_tokens

    @max_ai_tokens.setter
    def max_ai_tokens(self, val):
        self.included_ai_tokens = val

    @hybrid_property
    def max_staff_seats(self):
        return 5

    @hybrid_property
    def max_doctors(self):
        return 3


class TenantSubscription(Base):
    __tablename__ = "tenant_subscriptions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("platform_tenants.id", ondelete="CASCADE"), nullable=False)
    plan_id = Column(String(50), ForeignKey("subscription_plans.id"), nullable=False)
    status = Column(String(30), nullable=False, default="ACTIVE")
    current_period_start = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    current_period_end = Column(DateTime(timezone=True))
    cancel_at_period_end = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    plan = relationship("SubscriptionPlan")

    @hybrid_property
    def auto_renew(self):
        return not self.cancel_at_period_end

    @auto_renew.setter
    def auto_renew(self, val):
        self.cancel_at_period_end = not val


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


