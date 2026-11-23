from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.database import get_db

router = APIRouter()

@router.get("/health", tags=["System"])
def health_check(db: Session = Depends(get_db)):
    """Health check validating backend and PostgreSQL connectivity."""
    db_status = "UNKNOWN"
    try:
        res = db.execute(text("SELECT 1")).scalar()
        if res == 1:
            db_status = "HEALTHY"
    except Exception as e:
        db_status = f"UNHEALTHY: {str(e)}"

    return {
        "status": "ONLINE",
        "service": "GlimsTech AI Core SaaS",
        "version": "1.0.0",
        "database": db_status
    }
