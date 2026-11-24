from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.router import api_router
from app.db.init_db import bootstrap_database

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Bootstrap and verify database schema, tables, and seeds on startup
    bootstrap_database()
    yield

app = FastAPI(
    title=settings.PROJECT_NAME,
    version="1.0.0",
    description="Multi-Tenant WhatsApp AI Business Automation, CRM & Operations SaaS",
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=f"{settings.API_V1_STR}/docs",
    redoc_url=f"{settings.API_V1_STR}/redoc",
    lifespan=lifespan
)

# CORS middleware for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API v1 router
app.include_router(api_router, prefix=settings.API_V1_STR)

@app.get("/")
def root():
    return {
        "product": "GlimsTech AI",
        "description": "Multi-Tenant Clinic Operations & WhatsApp AI SaaS",
        "version": "1.0.0",
        "docs": f"{settings.API_V1_STR}/docs"
    }
