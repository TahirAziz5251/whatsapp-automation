import uuid
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any
from sqlalchemy.orm import Session
from sqlalchemy import text, func, desc

logger = logging.getLogger(__name__)

from app.models.billing import SubscriptionPlan, TenantSubscription, TenantUsageRecord
from app.models.tenant import PlatformTenant

def list_subscription_plans_db(db: Session) -> List[Dict[str, Any]]:
    """Returns all active platform subscription plans available for SaaS onboarding."""
    plans = db.query(SubscriptionPlan).filter(SubscriptionPlan.is_active == True).order_by(SubscriptionPlan.monthly_price_pkr.asc()).all()
    return [
        {
            "id": p.id,
            "name": p.name,
            "monthly_price_pkr": float(p.monthly_price_pkr),
            "max_whatsapp_messages": p.max_whatsapp_messages,
            "max_ai_tokens": p.max_ai_tokens,
            "max_staff_seats": p.max_staff_seats,
            "max_doctors": p.max_doctors,
            "features": p.features or {}
        }
        for p in plans
    ]


def get_tenant_subscription_db(db: Session, tenant_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves current active subscription and plan tier for a tenant."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))

    sub = db.query(TenantSubscription).filter(TenantSubscription.tenant_id == tenant_uuid).first()
    if not sub:
        # Default fallback to TRIAL if unassigned
        return {
            "tenant_id": str(tenant_id),
            "plan_id": "TRIAL",
            "plan_name": "14-Day Free Pilot",
            "status": "ACTIVE",
            "monthly_price_pkr": 0.0,
            "max_whatsapp_messages": 250,
            "max_ai_tokens": 30000,
            "max_staff_seats": 2,
            "max_doctors": 1,
            "current_period_start": datetime.now(timezone.utc).isoformat(),
            "current_period_end": None,
            "auto_renew": False
        }

    plan = db.query(SubscriptionPlan).filter(SubscriptionPlan.id == sub.plan_id).first()
    return {
        "tenant_id": str(sub.tenant_id),
        "plan_id": sub.plan_id,
        "plan_name": plan.name if plan else sub.plan_id,
        "status": sub.status,
        "monthly_price_pkr": float(plan.monthly_price_pkr) if plan else 0.0,
        "max_whatsapp_messages": plan.max_whatsapp_messages if plan else 1000,
        "max_ai_tokens": plan.max_ai_tokens if plan else 100000,
        "max_staff_seats": plan.max_staff_seats if plan else 3,
        "max_doctors": plan.max_doctors if plan else 2,
        "features": plan.features if plan else {},
        "current_period_start": sub.current_period_start.isoformat() if sub.current_period_start else None,
        "current_period_end": sub.current_period_end.isoformat() if sub.current_period_end else None,
        "auto_renew": sub.auto_renew
    }


def record_usage_db(
    db: Session,
    tenant_id: str,
    metric_name: str,
    quantity: int = 1,
    metadata: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Records a metered usage event (e.g. WHATSAPP_INBOUND, WHATSAPP_OUTBOUND, AI_TOKENS)."""
    try:
        db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
        tenant_uuid = uuid.UUID(str(tenant_id))
        now = datetime.now(timezone.utc)
        today = now.date()
        month_str = today.strftime("%Y-%m")

        # Map to valid metric_type allowed by DB check constraint
        valid_metric = metric_name
        if valid_metric not in ('AI_TOKENS', 'WHATSAPP_INBOUND', 'WHATSAPP_OUTBOUND', 'STORAGE_MB', 'API_CALLS'):
            valid_metric = "API_CALLS"

        rec = TenantUsageRecord(
            tenant_id=tenant_uuid,
            metric_type=valid_metric,
            quantity=quantity,
            period_date=today,
            details=metadata or {},
            created_at=now
        )
        db.add(rec)
        db.flush()

        return {
            "status": "RECORDED",
            "tenant_id": str(tenant_id),
            "metric_name": valid_metric,
            "quantity": quantity,
            "period_month": month_str
        }
    except Exception as e:
        logger.warning(f"Non-critical usage metering recording failed for tenant {tenant_id}: {e}")
        return {
            "status": "SKIPPED",
            "tenant_id": str(tenant_id),
            "metric_name": metric_name,
            "error": str(e)
        }


def get_tenant_monthly_usage_db(
    db: Session,
    tenant_id: str,
    period_month: Optional[str] = None
) -> Dict[str, Any]:
    """Aggregates usage totals by metric for the given billing month."""
    try:
        db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
        tenant_uuid = uuid.UUID(str(tenant_id))
        month_str = period_month or datetime.now(timezone.utc).strftime("%Y-%m")
        parts = month_str.split("-")
        year, month = int(parts[0]), int(parts[1])

        rows = db.query(
            TenantUsageRecord.metric_type,
            func.sum(TenantUsageRecord.quantity).label("total_quantity")
        ).filter(
            TenantUsageRecord.tenant_id == tenant_uuid,
            func.extract('year', TenantUsageRecord.period_date) == year,
            func.extract('month', TenantUsageRecord.period_date) == month
        ).group_by(TenantUsageRecord.metric_type).all()

        usage_map = {metric: int(tot) for metric, tot in rows if metric and tot is not None}
    except Exception as e:
        logger.warning(f"Error querying monthly usage for tenant {tenant_id}: {e}")
        usage_map = {}
        month_str = period_month or datetime.now(timezone.utc).strftime("%Y-%m")

    whatsapp_total = usage_map.get("WHATSAPP_INBOUND", 0) + usage_map.get("WHATSAPP_OUTBOUND", 0)
    ai_tokens_total = usage_map.get("AI_TOKENS", 0)

    # Fetch limits from subscription
    sub = get_tenant_subscription_db(db, tenant_id)
    max_wa = sub["max_whatsapp_messages"] if sub else 1000
    max_tokens = sub["max_ai_tokens"] if sub else 100000

    return {
        "tenant_id": str(tenant_id),
        "period_month": month_str,
        "plan_id": sub["plan_id"] if sub else "STARTER",
        "usage": {
            "whatsapp_inbound": usage_map.get("WHATSAPP_INBOUND", 0),
            "whatsapp_outbound": usage_map.get("WHATSAPP_OUTBOUND", 0),
            "whatsapp_total": whatsapp_total,
            "ai_tokens": ai_tokens_total,
            "appointments_booked": usage_map.get("BOOKING_CREATED", 0)
        },
        "limits": {
            "max_whatsapp_messages": max_wa,
            "max_ai_tokens": max_tokens,
            "whatsapp_remaining": max(0, max_wa - whatsapp_total),
            "ai_tokens_remaining": max(0, max_tokens - ai_tokens_total)
        }
    }


def check_entitlement_db(
    db: Session,
    tenant_id: str,
    metric_name: str,
    required_quantity: int = 1
) -> Dict[str, Any]:
    """
    Checks whether a tenant has remaining entitlement quota for the requested operation.
    Returns allowed=True or allowed=False with explicit reason and upgrade advice.
    """
    sub = get_tenant_subscription_db(db, tenant_id)
    if not sub or sub.get("status") not in ("ACTIVE", "TRIAL"):
        return {
            "allowed": False,
            "reason": f"Subscription status is {sub.get('status', 'INACTIVE')}. Please renew subscription.",
            "current_usage": 0,
            "max_limit": 0
        }

    usage = get_tenant_monthly_usage_db(db, tenant_id)

    if metric_name in ("WHATSAPP_OUTBOUND", "WHATSAPP_INBOUND"):
        current = usage["usage"]["whatsapp_total"]
        limit = sub["max_whatsapp_messages"]
        if current + required_quantity > limit:
            return {
                "allowed": False,
                "metric": "WHATSAPP",
                "current_usage": current,
                "max_limit": limit,
                "reason": f"Monthly WhatsApp quota exceeded ({current}/{limit}). Please upgrade plan to continue sending messages."
            }
        return {"allowed": True, "metric": "WHATSAPP", "current_usage": current, "max_limit": limit}

    elif metric_name == "AI_TOKENS":
        current = usage["usage"]["ai_tokens"]
        limit = sub["max_ai_tokens"]
        if current + required_quantity > limit:
            return {
                "allowed": False,
                "metric": "AI_TOKENS",
                "current_usage": current,
                "max_limit": limit,
                "reason": f"Monthly AI token quota exceeded ({current}/{limit}). Please upgrade plan to continue automated AI responses."
            }
        return {"allowed": True, "metric": "AI_TOKENS", "current_usage": current, "max_limit": limit}

    return {"allowed": True, "current_usage": 0, "max_limit": 999999}


def subscribe_tenant_plan_db(
    db: Session,
    tenant_id: str,
    plan_id: str
) -> Dict[str, Any]:
    """Upgrades or modifies a tenant's subscription plan tier."""
    db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
    tenant_uuid = uuid.UUID(str(tenant_id))

    plan = db.query(SubscriptionPlan).filter(SubscriptionPlan.id == plan_id).first()
    if not plan:
        return {"status": "ERROR", "message": f"Plan '{plan_id}' does not exist"}

    sub = db.query(TenantSubscription).filter(TenantSubscription.tenant_id == tenant_uuid).first()
    if not sub:
        sub = TenantSubscription(
            tenant_id=tenant_uuid,
            plan_id=plan.id,
            status="ACTIVE",
            current_period_start=datetime.now(timezone.utc)
        )
        db.add(sub)
    else:
        sub.plan_id = plan.id
        sub.status = "ACTIVE"
        sub.updated_at = datetime.now(timezone.utc)

    db.commit()

    return {
        "status": "SUCCESS",
        "tenant_id": str(tenant_id),
        "plan_id": plan.id,
        "plan_name": plan.name,
        "monthly_price_pkr": float(plan.monthly_price_pkr),
        "max_whatsapp_messages": plan.max_whatsapp_messages,
        "max_ai_tokens": plan.max_ai_tokens
    }
