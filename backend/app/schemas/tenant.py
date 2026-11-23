from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime

class BusinessTemplateOut(BaseModel):
    id: str
    name: str
    industry_category: str
    description: Optional[str] = None
    allowed_tools: List[str] = []

    model_config = ConfigDict(from_attributes=True)

class TenantCreate(BaseModel):
    slug: str = Field(..., min_length=3, max_length=50, pattern="^[a-z0-9-]+$")
    name: str = Field(..., min_length=2, max_length=255)
    business_template_id: str
    timezone: str = "Asia/Karachi"
    currency: str = "PKR"
    settings: Dict[str, Any] = {}

class TenantOut(BaseModel):
    id: UUID
    slug: str
    name: str
    business_template_id: str
    status: str
    timezone: str
    currency: str
    settings: Dict[str, Any]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
