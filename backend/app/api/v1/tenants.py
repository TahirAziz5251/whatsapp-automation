from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.models.tenant import BusinessTemplate, PlatformTenant
from app.schemas.tenant import BusinessTemplateOut, TenantCreate, TenantOut

router = APIRouter()

@router.get("/templates", response_model=List[BusinessTemplateOut], tags=["Templates"])
def list_business_templates(db: Session = Depends(get_db)):
    """List all 19 active business industry templates."""
    return db.query(BusinessTemplate).filter(BusinessTemplate.is_active == True).all()

@router.post("/", response_model=TenantOut, status_code=status.HTTP_201_CREATED, tags=["Tenants"])
def create_tenant(tenant_in: TenantCreate, db: Session = Depends(get_db)):
    """Register a new independent tenant workspace."""
    # Check if slug exists
    if db.query(PlatformTenant).filter(PlatformTenant.slug == tenant_in.slug).first():
        raise HTTPException(status_code=400, detail="Tenant with this slug already exists.")
    
    # Check if template is valid
    template = db.query(BusinessTemplate).filter(BusinessTemplate.id == tenant_in.business_template_id).first()
    if not template:
        raise HTTPException(status_code=400, detail=f"Invalid business template ID: {tenant_in.business_template_id}")
    
    tenant = PlatformTenant(
        slug=tenant_in.slug,
        name=tenant_in.name,
        business_template_id=tenant_in.business_template_id,
        timezone=tenant_in.timezone,
        currency=tenant_in.currency,
        settings=tenant_in.settings
    )
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    return tenant

@router.get("/{tenant_id}", response_model=TenantOut, tags=["Tenants"])
def get_tenant(tenant_id: str, db: Session = Depends(get_db)):
    tenant = db.query(PlatformTenant).filter(PlatformTenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return tenant
