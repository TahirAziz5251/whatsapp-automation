from fastapi import APIRouter, Depends, HTTPException, Header, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
import uuid

from app.core.database import get_db
from app.services.billing_service import (
    list_subscription_plans_db,
    get_tenant_subscription_db,
    record_usage_db,
    get_tenant_monthly_usage_db,
    check_entitlement_db,
    subscribe_tenant_plan_db
)

router = APIRouter(prefix="/billing", tags=["Subscription Billing & Usage Metering"])

def get_tenant_db(x_tenant_id: str = Header(..., alias="X-Tenant-ID"), db: Session = Depends(get_db)) -> Session:
    try:
        uuid.UUID(x_tenant_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid X-Tenant-ID UUID format")
    db.execute(text(f"SET app.current_tenant_id = '{x_tenant_id}'"))
    return db

class SubscribePlanRequest(BaseModel):
    plan_id: str = Field(..., description="Plan ID to subscribe e.g. TRIAL, STARTER, PROFESSIONAL, BUSINESS, ENTERPRISE")

class RecordUsageRequest(BaseModel):
    metric_name: str = Field(..., description="Metric e.g. WHATSAPP_INBOUND, WHATSAPP_OUTBOUND, AI_TOKENS, BOOKING_CREATED")
    quantity: int = Field(1, ge=1, description="Quantity consumed")
    metadata: Optional[Dict[str, Any]] = None

@router.get("/plans")
def get_plans(db: Session = Depends(get_db)):
    """Catalog: Lists all available subscription plans and tiers."""
    return list_subscription_plans_db(db)

@router.get("/subscription")
def get_subscription(
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_tenant_db)
):
    """Tenant Subscription: Returns active subscription plan, period dates, and quotas."""
    sub = get_tenant_subscription_db(db, x_tenant_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found for tenant")
    return sub

@router.post("/subscribe")
def subscribe_plan(
    payload: SubscribePlanRequest,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_tenant_db)
):
    """Upgrade / Subscribe: Assigns or upgrades the tenant's subscription tier."""
    res = subscribe_tenant_plan_db(db, x_tenant_id, payload.plan_id)
    if res.get("status") == "ERROR":
        raise HTTPException(status_code=400, detail=res.get("message"))
    return res

@router.get("/usage")
def get_monthly_usage(
    period_month: Optional[str] = Query(None, description="Billing month in YYYY-MM format"),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_tenant_db)
):
    """Usage Metering: Returns current billing cycle consumption and remaining quotas."""
    return get_tenant_monthly_usage_db(db, x_tenant_id, period_month)

@router.post("/record-usage")
def record_usage_metric(
    payload: RecordUsageRequest,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_tenant_db)
):
    """Internal Metering: Records a metered usage event with tenant RLS isolation."""
    return record_usage_db(
        db=db,
        tenant_id=x_tenant_id,
        metric_name=payload.metric_name,
        quantity=payload.quantity,
        metadata=payload.metadata
    )
