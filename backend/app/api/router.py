from fastapi import APIRouter
from app.api.v1 import health, auth, tenants, contacts, webhook, ai, clinic, crm, billing

api_router = APIRouter()

api_router.include_router(health.router, prefix="", tags=["Health"])
api_router.include_router(auth.router, prefix="/auth", tags=["Auth"])
api_router.include_router(tenants.router, prefix="/tenants", tags=["Tenants"])
api_router.include_router(contacts.router, prefix="/contacts", tags=["Contacts"])
api_router.include_router(webhook.router, prefix="/channels", tags=["Channels & Webhooks"])
api_router.include_router(ai.router, prefix="", tags=["AI Supervisor & Tools Engine"])
api_router.include_router(clinic.router, prefix="", tags=["Clinic & Hospital OPD"])
api_router.include_router(crm.router, prefix="", tags=["Staff CRM & Conversation Auditing"])
api_router.include_router(billing.router, prefix="", tags=["Subscription Billing & Usage Metering"])
