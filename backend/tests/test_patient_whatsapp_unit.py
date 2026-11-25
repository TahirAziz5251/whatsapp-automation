import asyncio
import sys
import uuid
from datetime import date, time
from unittest.mock import MagicMock

from app.models.tenant import PlatformTenant, BusinessTemplate
from app.services.ai.prompt_engine import build_system_prompt, detect_language_and_script
from app.services.ai.groq_client import GroqClient
from app.services.template_formatter import format_booking_confirmation
from app.services.ai.embedding_utils import compute_text_embedding, format_pgvector_literal
from app.services.ai.tools.clinic_tools import search_knowledge_base
from app.services.clinic_service import _safe_parse_uuid
from app.workers.reminder_worker import _collect_due_appointments


def test_master_prompt_reception_linked_and_guardrails():
    tenant = PlatformTenant(
        id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
        slug="alpha-clinic",
        name="Alpha Heart & Medical Centre",
        business_template_id="CLINIC_OPD",
        timezone="Asia/Karachi",
        currency="PKR",
        settings={
            "bot_name": "Dr. Shifa",
            "welcome_message": "Assalam-o-Alaikum!",
            "address": "Plot 45-B, Gulberg III, Lahore",
            "phone": "042-35780000",
        },
    )
    tpl = BusinessTemplate(
        id="CLINIC_OPD",
        name="Clinic & Hospital OPD Queue",
        industry_category="HEALTHCARE",
        allowed_tools=["get_doctor_schedule", "book_appointment", "cancel_appointment"],
    )
    prompt = build_system_prompt(tenant, tpl)

    for marker in [
        "Alpha Heart & Medical Centre",
        "CLINIC & HOSPITAL OPD QUEUE MANAGEMENT",
        "TRILINGUAL LANGUAGE MIRRORING POLICY",
        "NEVER diagnose illnesses",
        "EMERGENCY PROTOCOL",
        "1122",
        "Emergency Room",
        "NON-CLINICAL / OFF-TOPIC MESSAGES",
        "Reception Front Desk",
        "ticket_url",
    ]:
        assert marker in prompt, f"Missing expected prompt section: {marker}"


def test_reusable_multi_business_whatsapp_confirmation_formatter():
    sample_booking = {
        "appointment_number": "APT-202611-TEST01",
        "queue_token": "T-M01",
        "doctor_name": "Dr. Ayesha Malik",
        "specialty": "General Medicine",
        "room_number": "Room 102",
        "appointment_date": "2026-11-25",
        "slot_time": "05:00 PM",
        "fee_pkr": 1800,
    }
    for vertical in ["CLINIC_OPD", "DENTAL_CLINIC", "BEAUTY_SALON", "RESTAURANT_DELIVERY", "MOBILE_REPAIR"]:
        for lang in ["ENGLISH", "ROMAN_URDU", "URDU"]:
            msg = format_booking_confirmation(
                booking_data=sample_booking,
                language=lang,
                business_name="Demo Tenant",
                template_id=vertical,
                currency="PKR",
                business_address="Main Boulevard",
                business_phone="042-111-000",
            )
            assert "Demo Tenant" in msg
            assert "APT-202611-TEST01" in msg
            assert "/ticket/APT-202611-TEST01" in msg


def test_groq_fallback_never_books_on_availability_or_offtopic_queries():
    gc = GroqClient(api_key="gsk_placeholder_key")
    tools = [
        {"type": "function", "function": {"name": "get_doctor_schedule"}},
        {"type": "function", "function": {"name": "book_appointment"}},
    ]

    # 1. Availability question must call get_doctor_schedule, NOT book_appointment
    res_slots = gc._mock_completion(
        messages=[{"role": "user", "content": "Which slots is available for Dr Ayesha?"}],
        tools=tools,
    )
    assert res_slots["message"]["tool_calls"][0]["function"]["name"] == "get_doctor_schedule"

    # 2. Unrelated casual message must return greeting, NOT a tool booking call
    res_casual = gc._mock_completion(
        messages=[{"role": "user", "content": "300 wala"}],
        tools=tools,
    )
    assert res_casual["message"].get("tool_calls") is None
    assert "Alpha Clinic" in res_casual["message"]["content"]


def test_search_knowledge_base_reads_postgres_chunks():
    mock_db = MagicMock()
    mock_tenant = MagicMock()
    mock_tenant.name = "Alpha Heart & Medical Centre"
    mock_tenant.business_template_id = "CLINIC_OPD"
    mock_tenant.settings = {"address": "Gulberg III", "phone": "042-35780000"}
    mock_db.query.return_value.filter.return_value.first.return_value = mock_tenant
    mock_db.execute.return_value.fetchall.return_value = [
        ("OPD Policy", "Lab Hours", "Lab tests available 8 AM - 8 PM.", 0.8721, 0.25)
    ]

    out = search_knowledge_base("11111111-1111-1111-1111-111111111111", "blood test timings", db=mock_db)
    assert out["status"] == "FOUND"
    assert "OPD Policy" in out["topic"]
    assert out["source"] == "pgvector_hybrid_kb"
    assert "Lab tests" in out["information"]


def test_deterministic_pgvector_embedding_and_rls_worker():
    v1 = compute_text_embedding("Dr Tariq ki fees aur timing kya hai")
    v2 = compute_text_embedding("Dr Tariq consultation charges and clinic hours")
    v3 = compute_text_embedding("unrelated printer hardware warranty")
    assert len(v1) == 384
    lit = format_pgvector_literal(v1)
    assert lit.startswith("[") and lit.endswith("]")

    sim_related = sum(a * b for a, b in zip(v1, v2))
    sim_unrelated = sum(a * b for a, b in zip(v1, v3))
    assert sim_related > sim_unrelated

    # Verify _collect_due_appointments sets app.current_tenant_id per tenant when tenant_id=None
    mock_db = MagicMock()
    t1 = MagicMock()
    t1.id = uuid.UUID("11111111-1111-1111-1111-111111111111")
    mock_db.query.return_value.filter.return_value.all.return_value = [t1]
    mock_db.query.return_value.join.return_value.join.return_value.filter.return_value.all.return_value = ["row1"]

    rows = _collect_due_appointments(mock_db, tenant_id=None, extra_filters=[])
    assert rows == ["row1"]
    executed_sql = [str(call.args[0]) for call in mock_db.execute.call_args_list]
    assert any("SET app.current_tenant_id = '11111111-1111-1111-1111-111111111111'" in s for s in executed_sql)


def test_safe_parse_uuid_handles_invalid_strings():
    assert _safe_parse_uuid("11111111-1111-1111-1111-111111111111") is not None
    assert _safe_parse_uuid("APT-202611-12345678901234567890123456") is None
    assert _safe_parse_uuid("not-a-uuid") is None
