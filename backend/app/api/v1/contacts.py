from fastapi import APIRouter, Depends, HTTPException, Header, status
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List
from uuid import UUID
from app.core.database import get_db
from app.models.contact import PlatformContact
from app.schemas.contact import ContactCreate, ContactOut

router = APIRouter()

def get_tenant_scoped_db(x_tenant_id: str = Header(..., alias="X-Tenant-ID"), db: Session = Depends(get_db)) -> Session:
    """Dependency that extracts X-Tenant-ID and enforces PostgreSQL Row-Level Security."""
    try:
        # Validate UUID format
        UUID(x_tenant_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid X-Tenant-ID header format. Must be a valid UUID.")
    
    # Inject tenant ID into session for PostgreSQL RLS policy
    db.execute(text(f"SET app.current_tenant_id = '{x_tenant_id}'"))
    return db

@router.post("/", response_model=ContactOut, status_code=status.HTTP_201_CREATED, tags=["Contacts"])
def create_or_update_contact(
    contact_in: ContactCreate,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_tenant_scoped_db)
):
    """
    Create or update a customer contact within the tenant's isolated workspace.
    Guarantees non-collision: Phone numbers are scoped by tenant_id!
    """
    tenant_uuid = UUID(x_tenant_id)
    clean_phone = "".join(filter(str.isdigit, contact_in.customer_phone))
    
    # Check if contact exists within this tenant
    contact = db.query(PlatformContact).filter(
        PlatformContact.customer_phone == clean_phone
    ).first()
    
    if contact:
        contact.full_name = contact_in.full_name or contact.full_name
        contact.push_name = contact_in.push_name or contact.push_name
        contact.email = contact_in.email or contact.email
        contact.tags = contact_in.tags or contact.tags
    else:
        contact = PlatformContact(
            tenant_id=tenant_uuid,
            customer_phone=clean_phone,
            full_name=contact_in.full_name,
            push_name=contact_in.push_name,
            email=contact_in.email,
            tags=contact_in.tags,
            metadata_=contact_in.metadata
        )
        db.add(contact)
    
    db.flush()
    db.commit()
    return contact

@router.get("/", response_model=List[ContactOut], tags=["Contacts"])
def list_contacts(
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_tenant_scoped_db)
):
    """
    List all customer contacts belonging to the tenant.
    PostgreSQL Row-Level Security guarantees cross-tenant leakage is impossible.
    """
    return db.query(PlatformContact).all()
