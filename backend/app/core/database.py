from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base, Session
from typing import Generator
from app.core.config import settings

# Create engine using psycopg2
engine = create_engine(
    settings.SQLALCHEMY_DATABASE_URI,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20
)

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
