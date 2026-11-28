from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base, Session
from typing import Generator
from app.core.config import settings

_engine_kwargs = {
    "pool_pre_ping": True,
    "pool_size": 15,
    "max_overflow": 25,
}
if str(settings.SQLALCHEMY_DATABASE_URI).startswith("postgresql"):
    _engine_kwargs["connect_args"] = {
        "connect_timeout": 5,
        "options": "-c lock_timeout=5000 -c statement_timeout=25000 -c idle_in_transaction_session_timeout=30000",
    }

# Create engine using psycopg2
engine = create_engine(settings.SQLALCHEMY_DATABASE_URI, **_engine_kwargs)

# expire_on_commit=False ensures objects remain readable after commit without unauthenticated re-query
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
    bind=engine
)
Base = declarative_base()

def get_db() -> Generator[Session, None, None]:
    """Base database session dependency; resets RLS tenant context before pooling."""
    db = SessionLocal()
    try:
        yield db
    finally:
        try:
            db.rollback()
            db.execute(text("RESET app.current_tenant_id"))
        except Exception:
            pass
        db.close()

def get_tenant_db(tenant_id: str) -> Generator[Session, None, None]:
    """Database session generator that automatically sets and cleans up RLS tenant context."""
    db = SessionLocal()
    try:
        # Enforce PostgreSQL Row-Level Security tenant context across commits within this session
        db.execute(text(f"SET app.current_tenant_id = '{tenant_id}'"))
        yield db
    finally:
        try:
            db.execute(text("RESET app.current_tenant_id"))
        except Exception:
            pass
        db.close()
