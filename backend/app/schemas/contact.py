from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime

class ContactCreate(BaseModel):
    customer_phone: str = Field(..., pattern=r"^\+?[0-9]{10,15}$")
    full_name: Optional[str] = None
    push_name: Optional[str] = None
    email: Optional[str] = None
    tags: List[str] = []
    metadata: Dict[str, Any] = {}

class ContactOut(BaseModel):
    id: UUID
    tenant_id: UUID
    customer_phone: str
    full_name: Optional[str] = None
    push_name: Optional[str] = None
    email: Optional[str] = None
    tags: List[str] = []
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
