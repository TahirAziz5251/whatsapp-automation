import pytest
import uuid
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from app.main import app
from app.core.config import settings
from app.core.database import get_db, Base

# Test database connection using bizflow_runtime role
engine = create_engine(settings.SQLALCHEMY_DATABASE_URI, pool_pre_ping=True)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c

@pytest.fixture(scope="session")
def db_session():
    session = TestingSessionLocal()
    yield session
    session.close()

@pytest.fixture
def test_tenants(db_session):
    """Creates two isolated test tenants for isolation verification."""
    t1_id = uuid.uuid4()
    t2_id = uuid.uuid4()
    
    t1_slug = f"test-clinic-{uuid.uuid4().hex[:6]}"
    t2_slug = f"test-bakery-{uuid.uuid4().hex[:6]}"
    
    # Insert test tenants
    db_session.execute(text("""
        INSERT INTO platform_tenants (id, slug, name, business_template_id)
        VALUES 
            (:t1_id, :t1_slug, 'Isolation Clinic A', 'CLINIC_OPD'),
            (:t2_id, :t2_slug, 'Isolation Bakery B', 'BAKERY_CAKES')
        ON CONFLICT (id) DO NOTHING;
    """), {
        "t1_id": t1_id, "t1_slug": t1_slug,
        "t2_id": t2_id, "t2_slug": t2_slug
    })
    db_session.commit()
    
    return {"tenant_a": str(t1_id), "tenant_b": str(t2_id)}
