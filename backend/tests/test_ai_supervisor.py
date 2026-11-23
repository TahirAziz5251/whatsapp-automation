import pytest
import uuid
from starlette.testclient import TestClient

from app.main import app
from app.core.database import SessionLocal
from app.models.tenant import PlatformTenant, BusinessTemplate, ChannelConnection
from app.models.communication import TenantConversation, TenantMessage, TenantOutboxMessage
from app.services.ai.prompt_engine import detect_language_and_script, build_system_prompt
from app.services.ai.tool_registry import get_allowed_tool_schemas, execute_tool, CANONICAL_TOOLS
from app.services.ai.tools import clinic_tools
from app.services.ai.supervisor import AiSupervisor

@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client

CLINIC_TENANT_ID = "11111111-1111-1111-1111-111111111111" # Alpha Clinic
BAKERY_TENANT_ID = "22222222-2222-2222-2222-222222222222" # Beta Bakery

# ------------------------------------------------------------------------------
# 1. TRILINGUAL LANGUAGE & SCRIPT DETECTION TESTS
# ------------------------------------------------------------------------------
def test_language_detection_urdu_script():
    sample = "میرا اپائنٹمنٹ ڈاکٹر طارق کے ساتھ بک کریں"
    res = detect_language_and_script(sample)
    assert res["language"] == "URDU"
    assert res["script"] == "ARABIC"
    assert res["confidence"] > 0.7

def test_language_detection_roman_urdu():
    sample = "Mera appointment kal doctor tariq k sath book karein mujhe subah ka time chahiye"
    res = detect_language_and_script(sample)
    assert res["language"] == "ROMAN_URDU"
    assert res["script"] == "LATIN"
    assert res["confidence"] >= 0.65

def test_language_detection_english():
    sample = "Please let me know the doctor schedule and consultation fees for tomorrow morning."
    res = detect_language_and_script(sample)
    assert res["language"] == "ENGLISH"
    assert res["script"] == "LATIN"

# ------------------------------------------------------------------------------
# 2. SYSTEM PROMPT & CLINICAL SAFETY GUARDRAILS
# ------------------------------------------------------------------------------
def test_clinic_prompt_assembly_and_guardrails():
    db = SessionLocal()
    try:
        tenant = db.query(PlatformTenant).filter(PlatformTenant.id == CLINIC_TENANT_ID).first()
        template = db.query(BusinessTemplate).filter(BusinessTemplate.id == "CLINIC_OPD").first()
        prompt = build_system_prompt(tenant, template)

        # Check Persona & Context
        assert tenant.name in prompt
        assert "CLINIC & HOSPITAL OPD QUEUE MANAGEMENT" in prompt
        assert "Asia/Karachi" in prompt
        assert "PKR" in prompt

        # Check Strict Language Mirroring Instructions
        assert "TRILINGUAL LANGUAGE MIRRORING POLICY" in prompt
        assert "Roman Urdu" in prompt
        assert "Urdu script" in prompt

        # Check Critical Clinical Safety Guardrails
        assert "NEVER diagnose illnesses" in prompt
        assert "EMERGENCY PROTOCOL" in prompt
        assert "1122" in prompt
        assert "Emergency Room" in prompt
    finally:
        db.close()

# ------------------------------------------------------------------------------
# 3. TENANT-SCOPED TOOL ALLOWLIST & DYNAMIC FILTERING
# ------------------------------------------------------------------------------
def test_tenant_tool_allowlist_filtering():
    clinic_tools_list = ["get_doctor_schedule", "book_appointment", "get_queue_status", "cancel_appointment", "search_knowledge_base"]
    schemas = get_allowed_tool_schemas(clinic_tools_list)
    schema_names = [s["function"]["name"] for s in schemas]

    assert "get_doctor_schedule" in schema_names
    assert "book_appointment" in schema_names
    assert "get_queue_status" in schema_names
    # Cross-vertical tools MUST NOT appear
    assert "create_food_order" not in schema_names
    assert "request_custom_cake_quote" not in schema_names

def test_cross_vertical_tool_security_rejection():
    """
    CRITICAL SECURITY TEST:
    A Clinic tenant MUST be blocked if an LLM hallucinates or attempts to call
    a tool belonging to another vertical (e.g. create_food_order from Restaurant).
    """
    clinic_allowed = ["get_doctor_schedule", "book_appointment", "get_queue_status"]

    result = execute_tool(
        tenant_id=CLINIC_TENANT_ID,
        allowed_tool_names=clinic_allowed,
        tool_name="create_food_order",
        arguments={"items": [{"dish": "Chicken Biryani", "qty": 2}]}
    )

    assert result["status"] == "SECURITY_VIOLATION"
    assert "not authorized" in result["error"]

# ------------------------------------------------------------------------------
# 4. CLINIC PILOT TOOLS VERIFICATION
# ------------------------------------------------------------------------------
def test_clinic_tools_execution():
    # 1. Doctor Schedule
    sched = clinic_tools.get_doctor_schedule(CLINIC_TENANT_ID, "Dr. Tariq", "Tomorrow")
    assert sched["status"] == "SUCCESS"
    assert len(sched["doctors"]) >= 1
    assert sched["doctors"][0]["specialty"] == "Cardiology"

    # 2. Book Appointment
    booking = clinic_tools.book_appointment(
        tenant_id=CLINIC_TENANT_ID,
        patient_phone="923001234567",
        patient_name="Hamza Sheikh",
        doctor_name="Dr. Tariq Mahmood",
        date="2026-11-22",
        slot_time="11:30 AM",
        symptoms="Routine cardiology review"
    )
    assert booking["status"] == "CONFIRMED"
    assert booking["appointment_id"].startswith("APT-")
    assert booking["queue_token"].startswith("T-")

    # 3. Live Queue Status
    queue = clinic_tools.get_queue_status(CLINIC_TENANT_ID, booking["queue_token"], "Dr. Tariq Mahmood")
    assert queue["status"] == "ACTIVE_QUEUE"
    assert queue["tokens_ahead"] > 0
    assert queue["estimated_wait_minutes"] > 0

    # 4. Search Knowledge Base
    kb = clinic_tools.search_knowledge_base(CLINIC_TENANT_ID, "What is the clinic address?")
    assert kb["status"] == "FOUND"
    assert "Gulberg" in kb["information"]

# ------------------------------------------------------------------------------
# 5. AI SUPERVISOR TURN EXECUTION & OUTBOX ENQUEUEING
# ------------------------------------------------------------------------------
@pytest.mark.anyio
async def test_ai_supervisor_turn_execution_roman_urdu():
    """
    CRITICAL ACCEPTANCE TEST:
    1. Incoming Patient query in Roman Urdu: 'Dr Tariq ki timing aur schedule bataein kal k liye'
    2. AI Supervisor detects Roman Urdu.
    3. Triggers 'get_doctor_schedule' tool.
    4. Responds in natural, polite Roman Urdu.
    5. Saves AI response in TenantMessage.
    6. Enqueues message in TenantOutboxMessage for WhatsApp delivery.
    """
    db = SessionLocal()
    try:
        from sqlalchemy import text
        from app.models.contact import PlatformContact
        
        # Enforce PostgreSQL Row-Level Security context for test setup
        db.execute(text(f"SET app.current_tenant_id = '{CLINIC_TENANT_ID}'"))

        # Ensure contact exists
        contact = db.query(PlatformContact).filter(
            PlatformContact.tenant_id == CLINIC_TENANT_ID,
            PlatformContact.customer_phone == "923219988776"
        ).first()

        if not contact:
            contact = PlatformContact(
                tenant_id=uuid.UUID(CLINIC_TENANT_ID),
                customer_phone="923219988776",
                full_name="Babar Azam",
                push_name="Babar"
            )
            db.add(contact)
            db.flush()

        # Get active channel connection
        conn = db.query(ChannelConnection).filter(ChannelConnection.tenant_id == CLINIC_TENANT_ID).first()
        assert conn is not None

        # Create test conversation
        session_key = f"{CLINIC_TENANT_ID}:923219988776"
        conv = db.query(TenantConversation).filter(
            TenantConversation.tenant_id == CLINIC_TENANT_ID,
            TenantConversation.session_key == session_key
        ).first()

        if not conv:
            conv = TenantConversation(
                tenant_id=uuid.UUID(CLINIC_TENANT_ID),
                contact_id=contact.id,
                channel_connection_id=conn.id,
                session_key=session_key,
                status="ACTIVE"
            )
            db.add(conv)
            db.commit()
            db.refresh(conv)

        supervisor = AiSupervisor()
        result = await supervisor.process_message(
            db=db,
            tenant_id=CLINIC_TENANT_ID,
            conversation_id=str(conv.id),
            customer_phone="923219988776",
            user_text="Dr Tariq ki timing aur schedule bataein kal k liye"
        )

        assert result["status"] == "SUCCESS"
        assert result["language_detected"]["language"] == "ROMAN_URDU"
        assert len(result["tools_executed"]) == 1
        assert result["tools_executed"][0]["tool"] == "get_doctor_schedule"
        assert "Tariq" in result["response_text"]
        assert result["outbox_enqueued"] is True

        # Verify Outbox Entry in PostgreSQL
        outbox = db.query(TenantOutboxMessage).filter(
            TenantOutboxMessage.tenant_id == CLINIC_TENANT_ID,
            TenantOutboxMessage.recipient_phone == "923219988776"
        ).order_by(TenantOutboxMessage.created_at.desc()).first()

        assert outbox is not None
        assert outbox.status == "PENDING"
        assert "Tariq" in outbox.payload["text"]

    finally:
        db.close()

# ------------------------------------------------------------------------------
# 6. FASTAPI AI API ENDPOINTS
# ------------------------------------------------------------------------------
def test_ai_tools_api_endpoint(client):
    """Verifies that GET /api/v1/ai/tools returns tenant-isolated tools."""
    response = client.get(
        "/api/v1/ai/tools",
        headers={"X-Tenant-ID": CLINIC_TENANT_ID}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["template_id"] == "CLINIC_OPD"
    tool_names = [t["function"]["name"] for t in data["tool_schemas"]]
    assert "get_doctor_schedule" in tool_names
    assert "create_food_order" not in tool_names

def test_ai_detect_language_endpoint(client):
    """Verifies POST /api/v1/ai/detect-language."""
    res = client.post("/api/v1/ai/detect-language", json={"text": "Doctor saab se milna hai kab aaoon?"})
    assert res.status_code == 200
    assert res.json()["language"] == "ROMAN_URDU"

def test_ai_chat_api_endpoint(client):
    """Verifies POST /api/v1/ai/chat end-to-end execution through HTTP API."""
    db = SessionLocal()
    try:
        from sqlalchemy import text
        db.execute(text(f"SET app.current_tenant_id = '{CLINIC_TENANT_ID}'"))
        conv = db.query(TenantConversation).filter(TenantConversation.tenant_id == CLINIC_TENANT_ID).first()
        assert conv is not None

        payload = {
            "tenant_id": CLINIC_TENANT_ID,
            "conversation_id": str(conv.id),
            "customer_phone": "923219988776",
            "message": "Assalam-o-Alaikum, Dr Tariq ka appointment book karein kal 11:00 AM par"
        }

        res = client.post("/api/v1/ai/chat", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "SUCCESS"
        assert data["tenant_id"] == CLINIC_TENANT_ID
        assert data["language_detected"]["language"] == "ROMAN_URDU"
        assert len(data["tools_executed"]) == 1
        assert data["tools_executed"][0]["tool"] == "book_appointment"
        assert "Token Number" in data["response_text"] or "appointment" in data["response_text"]
    finally:
        db.close()
