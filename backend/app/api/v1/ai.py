from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Dict, Any, List, Optional
import uuid

from app.core.database import get_db
from app.models.tenant import PlatformTenant, BusinessTemplate
from app.services.ai.supervisor import AiSupervisor
from app.services.ai.prompt_engine import detect_language_and_script
from app.services.ai.tool_registry import get_allowed_tool_schemas

router = APIRouter(prefix="/ai", tags=["AI Supervisor & Tools Engine"])

class AiChatRequest(BaseModel):
    tenant_id: uuid.UUID
    conversation_id: uuid.UUID
    customer_phone: str = Field(..., description="Phone in pure digits e.g. 923001234567")
    message: str = Field(..., description="Message from patient or customer")

class DetectLanguageRequest(BaseModel):
    text: str

@router.post("/chat")
async def ai_chat_interaction(
    payload: AiChatRequest,
    db: Session = Depends(get_db)
):
    """
    Direct endpoint for testing AI Supervisor turn execution with tenant isolation,
    trilingual language mirroring, tool allowlist filtering, and response synthesis.
    """
    supervisor = AiSupervisor()
    result = await supervisor.process_message(
        db=db,
        tenant_id=str(payload.tenant_id),
        conversation_id=str(payload.conversation_id),
        customer_phone=payload.customer_phone,
        user_text=payload.message
    )
    if result.get("status") == "ERROR":
        raise HTTPException(status_code=400, detail=result.get("message"))
    return result

@router.get("/tools")
def get_tenant_tools(
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: Session = Depends(get_db)
):
    """
    Returns the strict allowlist of tool schemas authorized for the tenant's industry template.
    """
    try:
        tenant_uuid = uuid.UUID(x_tenant_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid X-Tenant-ID header UUID format")

    tenant = db.query(PlatformTenant).filter(PlatformTenant.id == tenant_uuid).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    template = db.query(BusinessTemplate).filter(BusinessTemplate.id == tenant.business_template_id).first()
    allowed_names = template.allowed_tools if template and template.allowed_tools else []
    schemas = get_allowed_tool_schemas(allowed_names)

    return {
        "tenant_id": str(tenant.id),
        "business_name": tenant.name,
        "template_id": tenant.business_template_id,
        "allowed_tool_names": allowed_names,
        "tool_schemas": schemas
    }

@router.post("/detect-language")
def detect_language_endpoint(payload: DetectLanguageRequest):
    """
    Classifies text into URDU (Arabic script), ROMAN_URDU (Latin script), or ENGLISH.
    """
    return detect_language_and_script(payload.text)
