import asyncio
import json
import sys
import uuid
from datetime import date, datetime, time, timedelta, timezone
from unittest.mock import MagicMock

from app.adapters.evolution import EvolutionGoAdapter, parse_lat_lng_from_map_url
from app.models.tenant import PlatformTenant, BusinessTemplate
from app.services.ai.prompt_engine import build_system_prompt, detect_language_and_script
from app.services.ai.groq_client import GroqClient
from app.services.template_formatter import format_booking_confirmation
from app.services.ai.embedding_utils import compute_text_embedding, format_pgvector_literal, normalize_rag_query
from app.services.ai.output_validator import validate_ai_response
from app.services.ai.rag_engine import hybrid_search
from app.services.ai.supervisor import _update_state_from_tool
from app.services.ai.tools import clinic_tools
from app.services.ai.tools.clinic_tools import search_knowledge_base
from app.services.ai.tool_registry import CANONICAL_TOOLS, TOOL_HANDLERS, get_allowed_tool_schemas, execute_tool
from app.services.clinic_service import (
    _safe_parse_uuid,
    _compute_slots_for_day,
    _parse_local_date,
    _parse_slot_time,
    book_appointment_db,
    cancel_appointment_db,
    check_in_patient_db,
    get_patient_profile_db,
    update_patient_profile_db,
)
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
        (10, "OPD Policy", "Lab Hours", "Lab tests available 8 AM - 8 PM daily including CBC and Lipid Profile.", {"valid_from": "2026-01-01T00:00:00Z", "published": True}, 0.8721, 0.35)
    ]

    out = search_knowledge_base("11111111-1111-1111-1111-111111111111", "blood test timings", db=mock_db)
    assert out["status"] == "FOUND"
    assert "OPD Policy" in out["topic"]
    assert out["source"] == "agentic_rag_hybrid"
    assert "Lab tests" in out["information"]


def test_layer2_agentic_rag_bm25_rrf_validity_and_threshold():
    norm = normalize_rag_query("khoon test ke liye nahar pet zaroori hai aur parking kahan hai?")
    assert "blood" in norm["expanded_tokens"]
    assert "fasting" in norm["expanded_tokens"]
    assert "parking" in norm["expanded_tokens"]

    mock_db = MagicMock()
    # Row 1: Expired doc (must be filtered out by Validity Guard)
    # Row 2: Other tenant-scoped doc (must be filtered out by tenant isolation)
    # Row 3: Unrelated valid chunk (low vec_sim & low BM25 -> rejected by Strict Relevance Threshold)
    mock_db.execute.return_value.fetchall.return_value = [
        (1, "Old Policy", "Expired Lab", "Blood test old hours 2020.", {"valid_to": "2021-01-01T00:00:00Z", "published": True}, 0.91, 0.4),
        (2, "Other Clinic", "Secret Info", "Different clinic tenant data.", {"tenant_id": "99999999-9999-9999-9999-999999999999"}, 0.88, 0.4),
        (3, "General FAQ", "Parking", "Free patient parking at Plot 45-B Gulberg.", {"valid_from": "2026-01-01T00:00:00Z"}, 0.05, 0.0),
    ]
    out_cutoff = hybrid_search(
        db=mock_db,
        tenant_id="11111111-1111-1111-1111-111111111111",
        business_code="HOSP_HEALTH",
        template_id="CLINIC_OPD",
        query="do you sell MRI laptops on installment?",
    )
    assert out_cutoff["status"] == "NO_EVIDENCE"
    assert out_cutoff["handoff_recommended"] is True

    # Test Patient Profile persistence (full_name, preferred_department, preferred_time, appointment_type)
    prof_db = MagicMock()
    ct = MagicMock()
    ct.id = uuid.uuid4()
    ct.customer_phone = "923001234567"
    ct.full_name = "Razia Begum"
    ct.metadata_ = {}
    prof_db.query.return_value.filter.return_value.first.return_value = ct

    saved = update_patient_profile_db(
        prof_db,
        "11111111-1111-1111-1111-111111111111",
        "923001234567",
        full_name="Razia Begum",
        preferred_department="General Medicine",
        preferred_time="05:00 PM",
        appointment_type="follow_up",
    )
    assert saved["patient_profile"]["full_name"] == "Razia Begum"
    assert saved["patient_profile"]["preferred_department"] == "General Medicine"
    assert saved["patient_profile"]["preferred_time"] == "05:00 PM"
    assert saved["patient_profile"]["appointment_type"] == "FOLLOW_UP"

    prof_db.query.return_value.filter.return_value.count.return_value = 2
    loaded = get_patient_profile_db(prof_db, "11111111-1111-1111-1111-111111111111", "923001234567")
    assert loaded["full_name"] == "Razia Begum"
    assert loaded["preferred_department"] == "General Medicine"
    assert loaded["appointment_type"] == "FOLLOW_UP"
    assert loaded["prior_visits"] == 2


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


def test_layer1_real_slot_generation_and_empty_means_empty():
    sched_mon = MagicMock()
    sched_mon.day_of_week = "Monday"
    sched_mon.start_time = time(10, 0)
    sched_mon.end_time = time(11, 0)
    sched_mon.slot_duration_minutes = 30
    sched_mon.max_patients_per_session = 10

    booked_apt = MagicMock()
    booked_apt.slot_time = time(10, 0)

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.all.return_value = [booked_apt]

    now_local = datetime(2026, 11, 25, 9, 0, tzinfo=timezone(timedelta(hours=5)))
    # Monday 2026-11-30 has 10:00 and 10:30, with 10:00 booked -> only 10:30 AM remains
    open_mon, _ = _compute_slots_for_day(
        mock_db, uuid.uuid4(), uuid.uuid4(), [sched_mon], date(2026, 11, 30), now_local
    )
    assert open_mon == ["10:30 AM"]

    # Sunday 2026-11-29 has no matching schedule -> Empty means empty
    open_sun, _ = _compute_slots_for_day(
        mock_db, uuid.uuid4(), uuid.uuid4(), [sched_mon], date(2026, 11, 29), now_local
    )
    assert open_sun == []

    assert _parse_local_date("not-a-real-date", date(2026, 11, 25)) is None
    assert _parse_slot_time("25:99 PM") is None


def test_layer1_booking_confirmation_gate_and_zero_mock_fallback():
    mock_db = MagicMock()
    doc = MagicMock()
    doc.id = uuid.uuid4()
    doc.name = "Dr. Tariq Mahmood"
    doc.specialty = "Cardiology"
    doc.room_number = "Room 101"
    doc.fee_pkr = 2500
    doc.is_on_break = False

    # _resolve_doctor_strict chains two .filter() calls -> .filter().filter().all() returns [doc]
    q_filter = mock_db.query.return_value.filter.return_value
    q_filter.filter.return_value.all.return_value = [doc]
    mock_tenant = MagicMock()
    mock_tenant.timezone = "Asia/Karachi"
    q_filter.first.return_value = mock_tenant

    # Calling book_appointment_db with enforce_slot_check=True and confirmed=False must NOT write DB
    res = book_appointment_db(
        db=mock_db,
        tenant_id="11111111-1111-1111-1111-111111111111",
        patient_phone="923001234567",
        patient_name="Ali Raza",
        doctor_name_or_id="Dr. Tariq Mahmood",
        appointment_date_str="2099-12-01",
        slot_time_str="10:30 AM",
        confirmed=False,
        enforce_slot_check=True,
    )
    assert res["status"] == "CONFIRMATION_REQUIRED"
    assert res["summary"]["doctor_name"] == "Dr. Tariq Mahmood"
    mock_db.add.assert_not_called()

    # When db throws an error, clinic_tools must return TOOL_ERROR (never PILOT_DOCTORS fake data)
    broken_db = MagicMock()
    broken_db.execute.side_effect = RuntimeError("DB connection lost")
    err_out = clinic_tools.get_doctor_schedule("11111111-1111-1111-1111-111111111111", "Tariq", db=broken_db)
    assert err_out["status"] == "TOOL_ERROR"
    assert "doctors" not in err_out


def test_13_typed_tools_registered_and_allowlisted():
    expected_13 = [
        "get_departments",
        "get_doctor_schedule",
        "get_availability",
        "get_fees",
        "book_appointment",
        "get_appointments",
        "reschedule_appointment",
        "cancel_appointment",
        "check_in_patient",
        "get_queue_status",
        "get_clinic_info",
        "search_knowledge_base",
        "handoff_to_human",
    ]
    for name in expected_13:
        assert name in CANONICAL_TOOLS, f"Missing schema: {name}"
        assert name in TOOL_HANDLERS, f"Missing handler: {name}"

    schemas = get_allowed_tool_schemas(expected_13)
    assert len(schemas) == 13

    blocked = execute_tool(
        tenant_id="11111111-1111-1111-1111-111111111111",
        allowed_tool_names=expected_13,
        tool_name="create_food_order",
        arguments={},
    )
    assert blocked["status"] == "SECURITY_VIOLATION"


def test_layer3_output_validator_blocks_phantom_bookings_and_fake_ids():
    # 1. Phantom confirmation without CONFIRMED tool output -> blocked
    res_phantom = validate_ai_response(
        reply_text="<think>internal</think> Your appointment has been booked for tomorrow!",
        tools_executed=[],
        language="ENGLISH",
        reception_phone="042-35780000",
    )
    assert res_phantom["valid"] is False
    assert "PHANTOM_BOOKING_CLAIM" in res_phantom["violations"]
    assert "<think>" not in res_phantom["sanitized_text"]

    # 2. Ungrounded fake ref (e.g. ALP-00042 from prompt example) -> blocked
    res_fake_id = validate_ai_response(
        reply_text="Your booking reference is ALP-00042.",
        tools_executed=[],
        language="ENGLISH",
    )
    assert res_fake_id["valid"] is False
    assert "UNGROUNDED_REF:ALP-00042" in res_fake_id["violations"]

    # 3. Real CONFIRMED tool result matching APT ref -> passes cleanly
    res_ok = validate_ai_response(
        reply_text="Appointment successfully confirmed! Booking ID: APT-202611-AB12CD.",
        tools_executed=[
            {"tool": "create_booking", "result": {"status": "CONFIRMED", "appointment_number": "APT-202611-AB12CD"}}
        ],
        language="ENGLISH",
    )
    assert res_ok["valid"] is True
    assert "APT-202611-AB12CD" in res_ok["sanitized_text"]


def test_layer3_policy_window_checkin_and_runtime_prompt():
    # Verify runtime context & map URL injection in build_system_prompt
    tenant = PlatformTenant(
        id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
        slug="alpha-clinic",
        name="Alpha Heart & Medical Centre",
        business_template_id="CLINIC_OPD",
        timezone="Asia/Karachi",
        currency="PKR",
        settings={
            "bot_name": "Dr. Shifa",
            "address": "Gulberg III, Lahore",
            "phone": "042-35780000",
            "map_url": "https://www.google.com/maps?q=29.410876883940837,71.70442811315009",
        },
    )
    tpl = BusinessTemplate(id="CLINIC_OPD", name="Clinic & Hospital OPD Queue", industry_category="HEALTHCARE", allowed_tools=[])
    prompt = build_system_prompt(
        tenant,
        tpl,
        runtime_context={
            "current_datetime": "2026-11-26 08:30 PM (Thursday)",
            "patient_phone": "923001234567",
            "patient_profile": {"full_name": "Razia Begum", "preferred_department": "Cardiology"},
            "state_json": {"step": "SLOTS_SHOWN"},
            "language": "ROMAN_URDU",
        },
    )
    assert "2026-11-26 08:30 PM (Thursday)" in prompt
    assert "Razia Begum" in prompt
    assert "SLOTS_SHOWN" in prompt
    assert "https://www.google.com/maps?q=29.410876883940837,71.70442811315009" in prompt
    assert "Walaikum Assalam!" in prompt

    # Verify state machine transitions
    st = _update_state_from_tool({"step": "IDLE"}, "get_doctor_schedule", {"status": "SUCCESS", "doctors": [{"name": "Dr. Tariq Mahmood", "open_slots": ["10:30 AM"]}]}, "k1")
    assert st["step"] == "SLOTS_SHOWN"
    assert st["issued_options"]["slots"] == ["10:30 AM"]
    st2 = _update_state_from_tool(st, "book_appointment", {"status": "CONFIRMATION_REQUIRED", "summary": {"doctor_name": "Dr. Tariq Mahmood"}}, "k1")
    assert st2["step"] == "AWAITING_CONFIRMATION"
    st3 = _update_state_from_tool(st2, "create_booking", {"status": "CONFIRMED", "appointment_number": "APT-202611-ZZ99"}, "k1")
    assert st3["step"] == "BOOKED"
    assert "draft_booking" not in st3

    # Verify same-day check-in guard & policy window guard
    mock_db = MagicMock()
    apt = MagicMock()
    apt.id = uuid.uuid4()
    apt.appointment_number = "APT-202611-TEST"
    apt.queue_token = "T-M01"
    apt.doctor_id = uuid.uuid4()
    apt.status = "BOOKED"
    apt.appointment_date = date(2099, 12, 1)  # Future date -> check-in must return NOT_TODAY
    apt.slot_time = time(10, 0)
    doc = MagicMock()
    doc.name = "Dr. Tariq Mahmood"
    ct = MagicMock()
    ct.customer_phone = "923001234567"

    mock_tenant = MagicMock()
    mock_tenant.timezone = "Asia/Karachi"
    mock_tenant.settings = {"cancellation_window_hours": 2, "phone": "042-35780000"}

    q_filter = mock_db.query.return_value.filter.return_value
    q_filter.first.return_value = mock_tenant
    mock_db.query.return_value.join.return_value.join.return_value.filter.return_value.first.return_value = (apt, doc, ct)

    chk = check_in_patient_db(mock_db, "11111111-1111-1111-1111-111111111111", "APT-202611-TEST", caller_phone="923001234567", enforce_checks=True)
    assert chk["status"] == "NOT_TODAY"

    # Cancel within < 2h window -> POLICY_WINDOW_EXPIRED
    now_pkt = datetime.now(timezone(timedelta(hours=5)))
    soon = now_pkt + timedelta(minutes=30)
    apt.appointment_date = soon.date()
    apt.slot_time = soon.time().replace(second=0, microsecond=0)
    can_res = cancel_appointment_db(mock_db, "11111111-1111-1111-1111-111111111111", "APT-202611-TEST", customer_phone="923001234567", confirmed=True, enforce_checks=True)
    assert can_res["status"] == "POLICY_WINDOW_EXPIRED"


def test_layer4_evolution_interactive_location_and_multibusiness_prompt():
    map_url = "https://www.google.com/maps?q=29.410876883940837,71.70442811315009"
    coords = parse_lat_lng_from_map_url(map_url)
    assert coords is not None
    assert abs(coords[0] - 29.410876883940837) < 1e-6
    assert abs(coords[1] - 71.70442811315009) < 1e-6

    adapter = EvolutionGoAdapter(instance_name="alpha-clinic")
    # Button response normalization
    btn_msg = adapter.normalize_inbound({
        "instance": "alpha-clinic",
        "data": {
            "key": {"remoteJid": "923001234567@s.whatsapp.net", "fromMe": False, "id": "BTN_01"},
            "pushName": "Ali",
            "message": {"buttonsResponseMessage": {"selectedDisplayText": "Confirm", "selectedButtonId": "confirm_btn"}},
        },
    })
    assert btn_msg is not None
    assert btn_msg.text == "Confirm"

    # List response normalization
    list_msg = adapter.normalize_inbound({
        "instance": "alpha-clinic",
        "data": {
            "key": {"remoteJid": "923001234567@s.whatsapp.net", "fromMe": False, "id": "LST_01"},
            "pushName": "Ali",
            "message": {"listResponseMessage": {"title": "10:30 AM", "singleSelectReply": {"selectedRowId": "slot_1030"}}},
        },
    })
    assert list_msg is not None
    assert list_msg.text == "10:30 AM"

    # Multi-business prompt reuse (BEAUTY_SALON inherits DATA INTEGRITY & AGENTIC RAG without Alpha Clinic hardcoding)
    salon_tenant = PlatformTenant(
        id=uuid.uuid4(),
        slug="glam-salon",
        name="Glam Studio Lahore",
        business_template_id="BEAUTY_SALON",
        timezone="Asia/Karachi",
        currency="PKR",
        settings={"bot_name": "Glam Assistant", "address": "DHA Phase 5", "phone": "042-111222", "emergency_number": "1122"},
    )
    salon_tpl = BusinessTemplate(
        id="BEAUTY_SALON",
        name="Beauty Salon & Barbershop",
        industry_category="SERVICE",
        allowed_tools=["search_services", "book_appointment", "search_knowledge_base"],
    )
    salon_prompt = build_system_prompt(salon_tenant, salon_tpl)
    assert "Glam Studio Lahore" in salon_prompt
    assert "DATA INTEGRITY" in salon_prompt
    assert "AGENTIC RAG" in salon_prompt
    assert "Alpha" not in salon_prompt

    # Confirmation card embeds Google Maps link cleanly when provided
    conf_card = format_booking_confirmation(
        booking_data={
            "appointment_number": "APT-202611-MAP01",
            "queue_token": "T-M01",
            "doctor_name": "Dr. Tariq Mahmood",
            "appointment_date": "2026-11-30",
            "slot_time": "10:30 AM",
            "fee_pkr": 2500,
            "map_url": map_url,
        },
        language="ENGLISH",
        business_name="Alpha Heart & Medical Centre",
    )
    assert map_url in conf_card


def test_single_reply_outbox_deferral_and_no_duplicate_ai_message():
    from unittest.mock import patch
    from app.models.communication import TenantConversation, TenantMessage, TenantOutboxMessage
    from app.models.tenant import ChannelConnection
    from app.services.ai.supervisor import AiSupervisor
    from app.services.channel_service import ChannelService

    tid = uuid.UUID("11111111-1111-1111-1111-111111111111")
    conv_id = uuid.uuid4()
    conn_id = uuid.uuid4()
    tpl = BusinessTemplate(
        id="CLINIC_OPD",
        name="Clinic OPD",
        industry_category="HEALTHCARE",
        allowed_tools=["get_doctor_schedule", "search_knowledge_base"],
    )
    tenant = PlatformTenant(
        id=tid,
        slug="alpha-clinic",
        name="Alpha Heart & Medical Centre",
        business_template_id="CLINIC_OPD",
        status="ACTIVE",
        timezone="Asia/Karachi",
        currency="PKR",
        settings={"bot_name": "Dr. Shifa", "phone": "042-35780000"},
    )
    conn = ChannelConnection(
        id=conn_id,
        tenant_id=tid,
        channel_type="EVOLUTION_GO",
        phone_number_id="alpha-clinic",
        display_phone_number="+923127118485",
        status="CONNECTED",
    )
    conv = TenantConversation(id=conv_id, tenant_id=tid, channel_connection_id=conn_id, session_key=f"{tid}:923001112233", status="ACTIVE", ai_paused=False)

    mock_db = MagicMock()
    added_objs = []
    def _fake_add(obj):
        if getattr(obj, "id", None) is None:
            obj.id = uuid.uuid4()
        added_objs.append(obj)
    mock_db.add.side_effect = _fake_add

    def _query_side_effect(model):
        q = MagicMock()
        q.filter.return_value = q
        q.order_by.return_value = q
        q.limit.return_value = q
        if model is TenantConversation:
            q.first.return_value = conv
        elif model is PlatformTenant:
            q.first.return_value = tenant
        elif model is BusinessTemplate:
            q.first.return_value = tpl
        elif model is ChannelConnection:
            q.first.return_value = conn
        elif model is TenantMessage:
            q.all.return_value = []
        else:
            q.first.return_value = None
        return q
    mock_db.query.side_effect = _query_side_effect

    sup = AiSupervisor(groq_client=GroqClient(api_key="gsk_placeholder_key"))
    before = datetime.now(timezone.utc)
    with patch("app.services.billing_service.check_entitlement_db", return_value={"allowed": True}), \
         patch("app.services.billing_service.record_usage_db", return_value=None), \
         patch("app.services.clinic_service.get_patient_profile_db", return_value=None), \
         patch("app.services.clinic_service.get_conversation_state_db", return_value={"step": "IDLE", "issued_options": {}}), \
         patch("app.services.clinic_service.save_conversation_state_db", return_value=None):
        coro = sup.process_message(
            db=mock_db,
            tenant_id=str(tid),
            conversation_id=str(conv_id),
            customer_phone="923001112233",
            user_text="Assalam o Alikum",
            defer_outbox_seconds=60,
        )
        try:
            coro.send(None)
            raise AssertionError("Expected synchronous coroutine completion")
        except StopIteration as stop_exc:
            res = stop_exc.value

    assert res["status"] == "SUCCESS"
    outbox_objs = [o for o in added_objs if isinstance(o, TenantOutboxMessage)]
    ai_msg_objs = [o for o in added_objs if isinstance(o, TenantMessage)]
    assert len(outbox_objs) == 1
    assert len(ai_msg_objs) == 1
    outbox = outbox_objs[0]
    ai_msg = ai_msg_objs[0]
    assert outbox.payload.get("ai_message_id") == str(ai_msg.id)
    assert outbox.next_retry_at >= before + timedelta(seconds=45)

    # 2. If background dispatcher recovers that row, it updates existing AI_AGENT TenantMessage rather than adding a duplicate
    disp_db = MagicMock()
    disp_added = []
    disp_db.add.side_effect = lambda o: disp_added.append(o)
    def _disp_query(model):
        q = MagicMock()
        q.filter.return_value = q
        if model is TenantOutboxMessage:
            q.first.return_value = outbox
        elif model is ChannelConnection:
            q.first.return_value = conn
        elif model is TenantConversation:
            q.first.return_value = conv
        elif model is TenantMessage:
            q.first.return_value = ai_msg
        else:
            q.first.return_value = None
        return q
    disp_db.query.side_effect = _disp_query

    with patch("app.services.channel_service.get_adapter_for_connection") as mock_get_adapter, \
         patch("app.services.billing_service.record_usage_db", return_value=None):
        fake_adapter = MagicMock()
        mock_ret = {"success": True, "status_code": 200, "response": {"key": {"id": "EVO_SENT_1"}}}
        fake_adapter.send_text_message.return_value = mock_ret
        fake_adapter.send_list_message.return_value = mock_ret
        fake_adapter.send_button_message.return_value = mock_ret
        fake_adapter.send_button_groups.return_value = mock_ret
        mock_get_adapter.return_value = fake_adapter
        disp = ChannelService.dispatch_outbox_message(outbox.id, disp_db)
        assert disp["success"] is True

    assert len([o for o in disp_added if isinstance(o, TenantMessage)]) == 0
    assert ai_msg.provider_message_id == "EVO_SENT_1"


def test_progressive_booking_flow_and_anti_boilerplate():
    """
    Verifies that:
    1. System prompt strictly mandates progressive disclosure (asking for name first, no questionnaire dumps).
    2. Zero robotic parentheticals: strips / forbids (as it should appear on the booking), (if any), etc.
    3. Visit-type is not appended as a repetitive footer on each turn.
    4. Mock completions for general third-party booking requests return a single warm question asking for the name.
    5. Output validator cleans any inadvertent boilerplate parentheticals or premature visit-type footers.
    """
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
        allowed_tools=["get_doctor_schedule", "book_appointment"],
    )
    prompt = build_system_prompt(tenant, tpl)

    # 1. Prompt Assertions
    assert "PROGRESSIVE BOOKING PROTOCOL (ONE STEP AT A TIME, ZERO QUESTION DUMPS)" in prompt
    assert "First ask ONLY for the patient's full name warmly in one short sentence" in prompt
    assert "NEVER dump a multi-item questionnaire in a single message" in prompt
    assert "ZERO ROBOTIC PARENTHETICALS" in prompt
    assert "(as it should appear on the booking)" in prompt  # Mentioned in forbidden list
    assert "TIMING OF VISIT TYPE" in prompt

    # 2. Mock Completion for Third-Party Booking (English)
    gc = GroqClient(api_key="gsk_placeholder_key")
    tools = [
        {"type": "function", "function": {"name": "book_appointment"}},
        {"type": "function", "function": {"name": "get_doctor_schedule"}},
    ]

    res_en = gc._mock_completion(
        messages=[{"role": "user", "content": "I want to book my appointment for my mother checkup"}],
        tools=tools,
    )
    msg_en = res_en["message"]["content"]
    assert "tool_calls" not in res_en["message"] or res_en["message"]["tool_calls"] is None
    assert "mother" in msg_en.lower()
    assert "full name" in msg_en.lower()
    assert "1." not in msg_en
    assert "2." not in msg_en
    assert "(as it should appear" not in msg_en
    assert "(if any)" not in msg_en
    assert "first visit" not in msg_en.lower()

    # 3. Mock Completion for Third-Party Booking (Roman Urdu)
    res_ur = gc._mock_completion(
        messages=[{"role": "user", "content": "meri ammi k checkup k liye appointment book karni hai"}],
        tools=tools,
    )
    msg_ur = res_ur["message"]["content"]
    assert "walida" in msg_ur.lower() or "ammi" in msg_ur.lower()
    assert "naam" in msg_ur.lower()
    assert "1." not in msg_ur

    # 4. Output Validator Sanitization of Boilerplate & Repetitive Footers
    raw_noisy_reply = (
        "Sure! I can help you schedule a check-up for your mother. Could you please share her full name (as it should appear on the booking)?\n\n"
        "Also, let me know if this is her first visit — or a follow-up — so I can set the correct visit type. 🌸"
    )
    val_res = validate_ai_response(
        reply_text=raw_noisy_reply,
        tools_executed=[],
        state_json={"step": "IDLE"},
        language="ENGLISH",
    )
    cleaned_out = val_res["sanitized_text"]
    assert "(as it should appear on the booking)" not in cleaned_out
    assert "first visit — or a follow-up" not in cleaned_out
    assert "🌸" not in cleaned_out
    assert "Could you please share her full name" in cleaned_out

    # 5. Output Validator Sanitization of (e.g., ...) parentheticals
    raw_eg_reply = "Which department or doctor would you like Aizal to see (e.g., Cardiology, General Medicine, Pediatrics, or a specific doctor’s name)?"
    val_eg = validate_ai_response(
        reply_text=raw_eg_reply,
        tools_executed=[],
        state_json={"step": "IDLE"},
        language="ENGLISH",
    )
    cleaned_eg = val_eg["sanitized_text"]
    assert "(e.g." not in cleaned_eg
    assert "Cardiology, General Medicine" not in cleaned_eg
    assert "Which department or doctor would you like Aizal to see" in cleaned_eg

    # 6. Continuous Context: Providing name after "for my child" invokes get_doctor_schedule("Pediatrics")
    history_child = [
        {"role": "user", "content": "I want to book my appointment for my child"},
        {"role": "assistant", "content": "Sure! I'd be happy to schedule a check-up for your child. Could you please share your child's full name?"},
        {"role": "user", "content": "Aizal"},
    ]
    res_child_name = gc._mock_completion(messages=history_child, tools=tools)
    assert res_child_name["message"]["tool_calls"] is not None
    fn_call = res_child_name["message"]["tool_calls"][0]["function"]
    assert fn_call["name"] == "get_doctor_schedule"
    call_args = json.loads(fn_call["arguments"])
    assert call_args["doctor_name_or_specialty"] == "Pediatrics"

    # 7. Synthesizing Doctor Recommendation from Live Tool Result
    tool_sched_result = {
        "status": "SUCCESS",
        "doctors": [
            {
                "doctor_id": "dddddddd-1111-0000-0000-000000000003",
                "name": "Dr. Bilal Asghar",
                "specialty": "Pediatrics",
                "fee": "PKR 2,000",
                "consulting_hours": "06:00 PM - 09:00 PM",
                "open_slots": ["06:15 PM", "06:45 PM", "07:30 PM"],
            }
        ]
    }
    history_with_tool = history_child + [
        res_child_name["message"],
        {"role": "tool", "name": "get_doctor_schedule", "content": json.dumps(tool_sched_result)},
    ]
    res_sched_synth = gc._mock_completion(messages=history_with_tool, tools=tools)
    synth_text = res_sched_synth["message"]["content"]
    assert "Dr. Bilal Asghar" in synth_text
    assert "Pediatrics" in synth_text
    assert "PKR 2,000" in synth_text
    assert "06:15 PM" in synth_text
    assert "(e.g." not in synth_text


def test_whatsapp_interactive_buttons_and_lists_zero_hallucination():
    """
    Verifies end-to-end interactive WhatsApp button and list generation:
    1. Greeting generates 4-item Main Menu list (Book appointment, My appointments, Queue status, Talk to reception).
    2. Specialty prompt generates database-backed specialty buttons (General Physician, Cardiology, Pediatrics).
    3. Doctor schedule response attaches live open slot buttons (e.g. 10:00 AM, 10:15 AM, Tomorrow slots).
    4. Confirmation gate attaches [ Confirm ] and [ Change ] buttons.
    5. Confirmed booking attaches [ Reschedule ], [ Cancel appointment ], [ Queue status ].
    6. Queue status inquiry attaches [ Refresh status ], [ Talk to reception ].
    7. EvolutionGoAdapter formats and dispatches buttons / lists with seamless text fallback.
    """
    from unittest.mock import patch, MagicMock
    from app.services.ai.interactive_formatter import generate_interactive_elements
    from app.adapters.evolution import EvolutionGoAdapter

    mock_db = MagicMock()
    tenant_id = "11111111-1111-1111-1111-111111111111"
    tenant_name = "Alpha Heart & Medical Centre"

    # 1. Pure Greeting -> ZERO interactive elements (res_welcome is None)
    res_welcome = generate_interactive_elements(
        db=mock_db,
        tenant_id=tenant_id,
        tenant_name=tenant_name,
        user_text="Assalam o Alikum",
        reply_text="Walaikum Assalam! Welcome to Alpha Heart & Medical Centre. How can I help you today?",
        tools_executed=[],
        state_json={"step": "IDLE"},
    )
    assert res_welcome is None

    # 1.1 Explicit Menu / Booking Intent -> 4 clickable buttons via button_groups
    res_menu = generate_interactive_elements(
        db=mock_db,
        tenant_id=tenant_id,
        tenant_name=tenant_name,
        user_text="menu",
        reply_text="Welcome to Alpha Heart & Medical Centre. Please select an option:",
        tools_executed=[],
        state_json={"step": "IDLE"},
    )
    assert res_menu is not None
    assert res_menu["type"] == "button_groups"
    all_welcome_btns = [b["displayText"] for g in res_menu["groups"] for b in g["buttons"]]
    assert all_welcome_btns == ["Book appointment", "My appointments", "Queue status", "Talk to reception"]

    # 2. Specialty Selection -> DB-driven buttons
    with patch("app.services.ai.interactive_formatter.get_departments_db") as mock_get_depts:
        mock_get_depts.return_value = {
            "status": "SUCCESS",
            "departments": [
                {"department_id": "general_medicine", "name": "General Medicine", "min_fee_pkr": 1800.0, "doctor_count": 1},
                {"department_id": "cardiology", "name": "Cardiology", "min_fee_pkr": 2500.0, "doctor_count": 1},
                {"department_id": "pediatrics", "name": "Pediatrics", "min_fee_pkr": 2000.0, "doctor_count": 1},
            ],
        }
        res_spec = generate_interactive_elements(
            db=mock_db,
            tenant_id=tenant_id,
            tenant_name=tenant_name,
            user_text="Book appointment",
            reply_text="Please choose a specialty for your consultation:",
            tools_executed=[],
            state_json={"step": "SELECT_SPECIALTY"},
        )
        assert res_spec is not None
        assert res_spec["type"] == "buttons"
        spec_buttons = [b["displayText"] for b in res_spec["buttons"]]
        assert "General Physician" in spec_buttons
        assert "Cardiology" in spec_buttons
        assert "Pediatrics" in spec_buttons

    # 3. Doctor Details & Open Slots -> All real DB open_slots (never truncated to 2!) + Tomorrow slots
    res_slots = generate_interactive_elements(
        db=mock_db,
        tenant_id=tenant_id,
        tenant_name=tenant_name,
        user_text="General Physician",
        reply_text="Dr. Ayesha Malik (General Medicine, Room 102) is available today (04:00 PM - 08:00 PM). Fee: PKR 1,800.",
        tools_executed=[
            {
                "tool": "get_doctor_schedule",
                "result": {
                    "status": "SUCCESS",
                    "doctors": [
                        {
                            "name": "Dr. Ayesha Malik",
                            "open_slots": ["04:30 PM", "05:00 PM", "05:30 PM", "06:00 PM"],
                        }
                    ],
                },
            }
        ],
        state_json={"step": "SELECT_SLOT"},
    )
    assert res_slots is not None
    assert res_slots["type"] == "button_groups"
    slot_btns = [b["displayText"] for g in res_slots["groups"] for b in g["buttons"]]
    assert slot_btns == ["04:30 PM", "05:00 PM", "05:30 PM", "06:00 PM", "Tomorrow slots"]

    # 4. Confirmation Summary Gate -> [ Confirm ] and [ Change ]
    res_confirm = generate_interactive_elements(
        db=mock_db,
        tenant_id=tenant_id,
        tenant_name=tenant_name,
        user_text="05:00 PM",
        reply_text="Please confirm: Dr. Ayesha Malik | Today, 05:00 PM | Patient: Ali Raza | Fee: Rs 1,800",
        tools_executed=[],
        state_json={"step": "AWAITING_CONFIRMATION"},
    )
    assert res_confirm is not None
    assert res_confirm["type"] == "buttons"
    confirm_btns = [b["displayText"] for b in res_confirm["buttons"]]
    assert confirm_btns == ["Confirm", "Change"]

    # 5. Confirmed Booking -> [ Reschedule ], [ Cancel appointment ], [ Queue status ]
    res_booked = generate_interactive_elements(
        db=mock_db,
        tenant_id=tenant_id,
        tenant_name=tenant_name,
        user_text="Confirm",
        reply_text="Booked. Appointment confirmed. Booking ID: APT-0042\nDr. Ayesha Malik\nToday, 05:00 PM",
        tools_executed=[
            {
                "tool": "book_appointment",
                "result": {
                    "status": "CONFIRMED",
                    "appointment_number": "APT-0042",
                    "doctor_name": "Dr. Ayesha Malik",
                },
            }
        ],
        state_json={"step": "BOOKED"},
    )
    assert res_booked is not None
    assert res_booked["type"] == "buttons"
    booked_btns = [b["displayText"] for b in res_booked["buttons"]]
    assert booked_btns == ["Reschedule", "Cancel appointment", "Queue status"]

    # 6. Queue Status Inquiry -> [ Refresh status ], [ Book appointment ], [ Talk to reception ]
    res_queue = generate_interactive_elements(
        db=mock_db,
        tenant_id=tenant_id,
        tenant_name=tenant_name,
        user_text="Queue status",
        reply_text="You are not checked in yet. Please check in when you arrive.",
        tools_executed=[
            {
                "tool": "get_queue_status",
                "result": {"status": "NOT_CHECKED_IN", "message": "You are not checked in yet."},
            }
        ],
        state_json={"step": "IDLE"},
    )
    assert res_queue is not None
    assert res_queue["type"] == "buttons"
    queue_btns = [b["displayText"] for b in res_queue["buttons"]]
    assert queue_btns == ["Refresh status", "Book appointment", "Talk to reception"]

    # 7. EvolutionGoAdapter Button & Button-Groups Dispatch + Fallback
    adapter = EvolutionGoAdapter(instance_name="alpha-clinic", api_url="http://mock-evo:4000", api_key="test-key")
    with patch.object(adapter, "_post_with_token_retry") as mock_post:
        # Success case for buttons
        mock_post.return_value = {"success": True, "status_code": 200, "response": {"key": {"id": "BTN_MSG_1"}}}
        btn_resp = adapter.send_button_message(
            recipient_phone="923001234567",
            text="Please confirm appointment",
            buttons=[{"displayText": "Confirm"}, {"displayText": "Change"}],
            title="Alpha Clinic",
        )
        assert btn_resp["success"] is True
        mock_post.assert_called_with(
            "/send/button",
            {
                "number": "923001234567",
                "title": "Alpha Clinic",
                "description": "Please confirm appointment",
                "footer": "Alpha Clinic",
                "footerText": "Alpha Clinic",
                "buttons": [
                    {"type": "reply", "displayText": "Confirm", "id": "btn_1_confirm"},
                    {"type": "reply", "displayText": "Change", "id": "btn_2_change"},
                ],
            },
        )

        # Fallback case for buttons when /send/button and /send/list fail -> clean numbered text (zero Poll)
        EvolutionGoAdapter._unsupported_buttons_instances.discard("alpha-clinic")
        EvolutionGoAdapter._unsupported_list_instances.discard("alpha-clinic")
        mock_post.side_effect = [
            {"success": False, "status_code": 500, "error": "Internal Server Error"},
            {"success": False, "status_code": 405, "response": '{"error":"405"}'},
            {"success": True, "status_code": 200, "response": {"key": {"id": "FALLBACK_TXT"}}},
        ]
        fallback_resp = adapter.send_button_message(
            recipient_phone="923001234567",
            text="Choose an option",
            buttons=["Option A", "Option B"],
        )
        assert fallback_resp["success"] is True
        assert mock_post.call_args_list[-1][0][0] == "/send/text"
        assert "1. Option A" in mock_post.call_args_list[-1][0][1]["text"]
        assert "2. Option B" in mock_post.call_args_list[-1][0][1]["text"]
        EvolutionGoAdapter._unsupported_buttons_instances.discard("alpha-clinic")
        EvolutionGoAdapter._unsupported_list_instances.discard("alpha-clinic")

        # NativeFlow inbound response parsing
        nf_inbound = adapter.normalize_inbound({
            "instanceName": "alpha-clinic",
            "data": {
                "ID": "NF_001",
                "Info": {"Chat": "923001234567@s.whatsapp.net", "Sender": "923001234567@s.whatsapp.net", "PushName": "Ali"},
                "Message": {
                    "interactiveResponseMessage": {
                        "nativeFlowResponseMessage": {
                            "name": "quick_reply",
                            "paramsJson": json.dumps({"id": "menu_book_appointment", "display_text": "Book appointment"}),
                        }
                    }
                },
            },
        })
        assert nf_inbound is not None
        assert nf_inbound.text == "Book appointment"


def test_fresh_greeting_never_leaks_mother_and_validator_enforces_db_fee():
    """
    Verifies:
    1. Sending 'Assalam o Alikum' resets stale state (never assumes 'mother' from prior history)
       and attaches all 4 clickable main menu buttons.
    2. Output validator automatically corrects any hallucinated doctor fee (e.g. PKR 1,500 -> PKR 1,800).
    """
    from unittest.mock import patch, MagicMock
    from app.models.communication import TenantConversation, TenantMessage, TenantOutboxMessage
    from app.models.tenant import ChannelConnection
    from app.services.ai.supervisor import AiSupervisor
    from app.services.ai.output_validator import validate_ai_response

    tid = uuid.UUID("11111111-1111-1111-1111-111111111111")
    conv_id = uuid.uuid4()
    conn_id = uuid.uuid4()
    tpl = BusinessTemplate(id="CLINIC_OPD", name="Clinic OPD", industry_category="HEALTHCARE", allowed_tools=["get_departments", "get_doctor_schedule"])
    tenant = PlatformTenant(id=tid, slug="alpha-clinic", name="Alpha Heart & Medical Centre", business_template_id="CLINIC_OPD", status="ACTIVE", timezone="Asia/Karachi", currency="PKR", settings={"bot_name": "Dr. Shifa"})
    conn = ChannelConnection(id=conn_id, tenant_id=tid, channel_type="EVOLUTION_GO", phone_number_id="alpha-clinic", display_phone_number="+923127118485", status="CONNECTED")
    conv = TenantConversation(id=conv_id, tenant_id=tid, channel_connection_id=conn_id, session_key=f"{tid}:923001112233", status="ACTIVE", ai_paused=False)

    mock_db = MagicMock()
    mock_db.add.side_effect = lambda o: setattr(o, "id", uuid.uuid4()) if getattr(o, "id", None) is None else None
    def _q(model):
        q = MagicMock()
        q.filter.return_value = q
        q.order_by.return_value = q
        q.limit.return_value = q
        if model is TenantConversation:
            q.first.return_value = conv
        elif model is PlatformTenant:
            q.first.return_value = tenant
        elif model is BusinessTemplate:
            q.first.return_value = tpl
        elif model is ChannelConnection:
            q.first.return_value = conn
        else:
            q.all.return_value = []
            q.first.return_value = None
        return q
    mock_db.query.side_effect = _q

    saved_states = []
    sup = AiSupervisor(groq_client=GroqClient(api_key="gsk_placeholder_key"))
    with patch("app.services.billing_service.check_entitlement_db", return_value={"allowed": True}), \
         patch("app.services.billing_service.record_usage_db", return_value=None), \
         patch("app.services.clinic_service.get_patient_profile_db", return_value={"full_name": "Tahir Aziz"}), \
         patch("app.services.clinic_service.get_conversation_state_db", return_value={"step": "BOOKED", "draft_booking": {"notes": "mother"}, "issued_options": {}}), \
         patch("app.services.clinic_service.save_conversation_state_db", side_effect=lambda db, t, p, s: saved_states.append(s)):
        coro = sup.process_message(
            db=mock_db,
            tenant_id=str(tid),
            conversation_id=str(conv_id),
            customer_phone="923001112233",
            user_text="Assalam o Alikum",
            defer_outbox_seconds=60,
        )
        try:
            coro.send(None)
            raise AssertionError("Expected sync completion")
        except StopIteration as exc:
            res = exc.value

    assert "mother" not in res["response_text"].lower()
    assert "Alpha Heart & Medical Centre" in res["response_text"]
    assert res["interactive"] is None  # Pure greeting must NEVER attach unrequested poll/buttons
    assert saved_states and saved_states[0]["step"] == "IDLE"

    # Output validator auto-corrects hallucinated PKR 1,500 back to grounded PKR 1,800
    val = validate_ai_response(
        reply_text="Please confirm: Dr. Ayesha Malik | Today, 06:15 PM | Fee: PKR 1,500 (payable at counter)",
        tools_executed=[{"tool": "get_doctor_schedule", "result": {"status": "SUCCESS", "doctors": [{"name": "Dr. Ayesha Malik", "fee_pkr": 1800.0}]}}],
        state_json={"issued_options": {}},
    )
    assert "PKR 1,800" in val["sanitized_text"]
    assert "1,500" not in val["sanitized_text"]

    # Output validator removes standalone "For example, ..." and slot filler sentences
    val_clean = validate_ai_response(
        reply_text=(
            "Thank you, Ms. Naseem Mai. Could you let me know what type of consultation she needs or if she has a preferred doctor? "
            "For example, Cardiology (Dr. Tariq Mahmood), General Medicine (Dr. Ayesha Malik), or any other specialty. "
            "This will help me find the right available slots for her."
        ),
        tools_executed=[],
    )
    assert "for example" not in val_clean["sanitized_text"].lower()
    assert "tariq mahmood" not in val_clean["sanitized_text"].lower()
    assert "this will help me find" not in val_clean["sanitized_text"].lower()
    assert "*Ms. Naseem Mai*" in val_clean["sanitized_text"]


def test_evolution_405_tries_button_then_list_then_numbered_options_zero_poll():
    """
    Verifies Option B interactive delivery cascade:
    1. Tries POST /send/button first.
    2. When /send/button returns 405, independently tries POST /send/list (succeeds when list works).
    3. When BOTH /send/button and /send/list return 405, falls back cleanly to numbered options
       (1. Book appointment, 2. My appointments, ...) via /send/text with ZERO /send/poll calls.
    4. Legacy PollUpdateMessage SHA-256 resolution still works if a poll vote arrives.
    """
    import hashlib
    from unittest.mock import patch
    from app.adapters.evolution import EvolutionGoAdapter

    inst = "option-b-test-inst"
    EvolutionGoAdapter._unsupported_buttons_instances.discard(inst)
    EvolutionGoAdapter._unsupported_list_instances.discard(inst)
    adapter = EvolutionGoAdapter(instance_name=inst, api_url="http://mock-evo:4000", api_key="test-key")

    groups = [
        {"buttons": [{"displayText": "Book appointment"}, {"displayText": "My appointments"}, {"displayText": "Queue status"}]},
        {"buttons": [{"displayText": "Talk to reception"}]},
    ]

    # Case 1: /send/button 405 -> /send/list succeeds
    with patch.object(adapter, "_post_with_token_retry") as mock_post:
        mock_post.side_effect = [
            {"success": False, "status_code": 500, "response": '{"error":"server returned error 405"}'},
            {"success": True, "status_code": 200, "response": {"data": {"Info": {"ID": "LIST_MSG_101"}}}},
        ]
        res_list = adapter.send_button_groups(
            recipient_phone="923348076760",
            text="I'd be happy to help you with that! Feel free to pick an option below:",
            groups=groups,
        )
        assert res_list["success"] is True
        assert inst in EvolutionGoAdapter._unsupported_buttons_instances
        assert inst not in EvolutionGoAdapter._unsupported_list_instances
        assert mock_post.call_args_list[0][0][0] == "/send/button"
        assert mock_post.call_args_list[1][0][0] == "/send/list"
        assert "/send/poll" not in [c[0][0] for c in mock_post.call_args_list]

    # Case 2: Both cached/returning 405 -> sends numbered text options with ZERO Poll
    with patch.object(adapter, "_post_with_token_retry") as mock_post:
        mock_post.side_effect = [
            {"success": False, "status_code": 405, "response": '{"error":"405"}'},
            {"success": True, "status_code": 200, "response": {"data": {"Info": {"ID": "NUM_TXT_102"}}}},
        ]
        res_num = adapter.send_button_groups(
            recipient_phone="923348076760",
            text="I'd be happy to help you with that! Feel free to pick an option below:",
            groups=groups,
        )
        assert res_num["success"] is True
        assert inst in EvolutionGoAdapter._unsupported_list_instances
        assert res_num["fallback_options"] == ["Book appointment", "My appointments", "Queue status", "Talk to reception"]
        paths_called = [c[0][0] for c in mock_post.call_args_list]
        assert paths_called == ["/send/list", "/send/text"]
        assert "/send/poll" not in paths_called
        sent_body = mock_post.call_args_list[1][0][1]["text"]
        assert "1. Book appointment" in sent_body
        assert "2. My appointments" in sent_body
        assert "3. Queue status" in sent_body
        assert "4. Talk to reception" in sent_body

    # Verify inbound PollUpdateMessage normalization + SHA-256 resolution still supported
    inbound = adapter.normalize_inbound({
        "instanceName": inst,
        "data": {
            "ID": "VOTE_999",
            "Info": {"Chat": "923348076760@s.whatsapp.net", "Sender": "923348076760@s.whatsapp.net", "PushName": "Tahir"},
            "Message": {
                "pollUpdateMessage": {
                    "pollCreationMessageKey": {"ID": "POLL_MSG_101"}
                }
            },
        },
    })
    assert inbound is not None
    assert inbound.message_type == "poll_vote"
    assert inbound.text == "__POLL_VOTE__:POLL_MSG_101"

    expected_hash = hashlib.sha256(b"General Physician").hexdigest()
    with patch.object(adapter, "_get_with_token_retry") as mock_get, \
         patch("app.adapters.evolution.time.sleep", return_value=None):
        mock_get.return_value = {
            "success": True,
            "status_code": 200,
            "response": {
                "votes": [
                    {"voteMessageId": "VOTE_999", "voterPhone": "923348076760", "selectedOptions": [expected_hash]}
                ]
            },
        }
        resolved = adapter.resolve_poll_vote_option(
            poll_message_id="POLL_MSG_101",
            vote_message_id="VOTE_999",
            voter_phone="923348076760",
            candidate_options=["Cardiology", "General Physician", "Pediatrics"],
        )
        assert resolved == "General Physician"

    EvolutionGoAdapter._unsupported_buttons_instances.discard(inst)
    EvolutionGoAdapter._unsupported_list_instances.discard(inst)


def test_uniform_conversation_font_size_and_saas_bold_highlights():
    """
    Verifies SaaS production typography requirements:
    1. Uniform font size: strips ### headings, backticks (` / ```), HTML tags, and Unicode math fonts.
    2. Highlights critical booking entities (*Patient Name*, *Token Number*, *Doctor Name*, *Slot Time*, *Location*, *Booking ID*, *Fee*).
    3. Keeps clickable Digital Ticket and Google Maps URLs completely intact without stray asterisks.
    """
    from app.services.ai.output_validator import validate_ai_response

    sample_url = "http://192.168.1.31:3000/ticket/APT-202611-AB12CD"
    raw_llm = (
        "### Booking Confirmation\n"
        "Patient: **Ms. Naseem Mai**\n"
        "Doctor: `Dr. Tariq Mahmood`\n"
        "Token Number: 𝐓-𝐌𝟎𝟏\n"
        "Appointment Date: 2026-11-28 | Slot Time: 10:30 AM\n"
        "Location: Room 101, Alpha Heart & Medical Centre\n"
        "Fee: PKR 2,500\n"
        "Booking ID: APT-202611-AB12CD\n"
        f"Ticket Link: {sample_url}"
    )

    val = validate_ai_response(
        reply_text=raw_llm,
        tools_executed=[
            {
                "tool": "book_appointment",
                "result": {
                    "status": "CONFIRMED",
                    "appointment_number": "APT-202611-AB12CD",
                    "queue_token": "T-M01",
                    "patient_name": "Ms. Naseem Mai",
                    "doctor_name": "Dr. Tariq Mahmood",
                    "room_number": "Room 101",
                    "fee_pkr": 2500,
                },
            }
        ],
        extra_entities={"business_name": "Alpha Heart & Medical Centre"},
    )
    out = val["sanitized_text"]
    assert val["valid"] is True
    assert "###" not in out
    assert "`" not in out
    assert "**" not in out
    assert "𝐓" not in out
    assert "*Booking Confirmation*" in out
    assert "*Ms. Naseem Mai*" in out
    assert "*Dr. Tariq Mahmood*" in out
    assert "*T-M01*" in out
    assert "*2026-11-28*" in out
    assert "*10:30 AM*" in out
    assert "*Room 101*" in out
    assert "*Alpha Heart & Medical Centre*" in out
    assert "*PKR 2,500*" in out
    assert "*APT-202611-AB12CD*" in out
    assert sample_url in out

    # Verify template_formatter includes & bolds all SaaS confirmation values
    card = format_booking_confirmation(
        booking_data={
            "patient_name": "Ms. Naseem Mai",
            "appointment_number": "APT-202611-AB12CD",
            "queue_token": "T-M01",
            "doctor_name": "Dr. Tariq Mahmood",
            "specialty": "Cardiology",
            "room_number": "Room 101",
            "appointment_date": "2026-11-28",
            "slot_time": "10:30 AM",
            "fee_pkr": 2500,
        },
        language="ENGLISH",
        business_name="Alpha Heart & Medical Centre",
        business_address="Gulberg III, Lahore",
    )
    for expected in (
        "*Alpha Heart & Medical Centre*",
        "*Gulberg III, Lahore*",
        "*Ms. Naseem Mai*",
        "*Dr. Tariq Mahmood*",
        "*2026-11-28*",
        "*10:30 AM*",
        "*Room 101*",
        "*T-M01*",
        "*APT-202611-AB12CD*",
        "*PKR 2,500*",
    ):
        assert expected in card, f"Missing bold highlight in confirmation card: {expected}"


def test_real_db_slots_never_show_shift_end_boundaries_0400_0800():
    """
    Reproduces exact screenshot bug where consulting hours 'from 04:00 PM to 08:00 PM' caused
    1. 04:00 PM and 2. 08:00 PM to be offered instead of real DB open_slots (05:15 PM .. 07:00 PM).
    Verifies:
    1. interactive_formatter returns ALL genuine DB open_slots (up to 11 + Tomorrow slots).
    2. Text fallback strips consulting-hours ranges so 04:00 PM / 08:00 PM are NEVER mistaken as slots.
    3. validate_ai_response strips fake duplicate numbered slot lists (1. 04:00 PM, 2. 08:00 PM).
    """
    from unittest.mock import MagicMock
    from app.services.ai.interactive_formatter import generate_interactive_elements
    from app.services.ai.output_validator import validate_ai_response

    real_open_slots = [
        "05:15 PM", "05:30 PM", "05:45 PM", "06:00 PM",
        "06:15 PM", "06:30 PM", "06:45 PM", "07:00 PM",
    ]
    tool_result = {
        "status": "SUCCESS",
        "query_date": "2026-11-27",
        "doctors": [
            {
                "name": "Dr. Ayesha Malik",
                "specialty": "General Medicine",
                "room_number": "Room 102",
                "consulting_hours": "04:00 PM - 08:00 PM",
                "fee_pkr": 1800.0,
                "open_slots": real_open_slots,
            }
        ],
    }

    mock_db = MagicMock()
    tid = "11111111-1111-1111-1111-111111111111"

    # 1. With tool result -> ALL 8 real open_slots + Tomorrow slots attached in button_groups (clickable Poll)
    res_real = generate_interactive_elements(
        db=mock_db,
        tenant_id=tid,
        tenant_name="Alpha Clinic",
        user_text="General Physician",
        reply_text="Dr. Ayesha Malik (General Medicine, Room 102) is available today from 04:00 PM to 08:00 PM. Which time would you prefer for Ms. Naseem Mai?",
        tools_executed=[{"tool": "get_doctor_schedule", "result": tool_result}],
        state_json={"step": "SLOTS_SHOWN", "issued_options": {"slots": real_open_slots}},
    )
    assert res_real is not None
    assert res_real["type"] == "button_groups"
    flat_slots = [b["displayText"] for g in res_real["groups"] for b in g["buttons"]]
    assert flat_slots == real_open_slots + ["Tomorrow slots"]
    assert "04:00 PM" not in flat_slots
    assert "08:00 PM" not in flat_slots

    # 2. Even if tools_executed is empty & reply mentions "from 04:00 PM to 08:00 PM", NEVER offer 04:00 PM / 08:00 PM
    res_fallback = generate_interactive_elements(
        db=mock_db,
        tenant_id=tid,
        tenant_name="Alpha Clinic",
        user_text="show slots",
        reply_text="Dr. Ayesha Malik is available today from 04:00 PM to 08:00 PM. Which time would you prefer? Available: 05:15 PM, 05:30 PM",
        tools_executed=[],
        state_json={"step": "IDLE", "issued_options": {}},
    )
    assert res_fallback is not None
    fb_slots = [b["displayText"] for b in (res_fallback.get("buttons") or [b for g in res_fallback.get("groups", []) for b in g["buttons"]])]
    assert "04:00 PM" not in fb_slots
    assert "08:00 PM" not in fb_slots
    assert fb_slots == ["05:15 PM", "05:30 PM", "Tomorrow slots"]

    # 3. Output validator strips redundant numbered slot menus from LLM prose when DB schedule returned open_slots
    val = validate_ai_response(
        reply_text=(
            "Dr. Ayesha Malik (General Medicine, Room 102) is available today from 04:00 PM to 08:00 PM.\n"
            "Which time would you prefer for Ms. Naseem Mai?\n\n"
            "1. 04:00 PM\n"
            "2. 08:00 PM\n"
            "3. Tomorrow slots\n"
        ),
        tools_executed=[{"tool": "get_doctor_schedule", "result": tool_result}],
        state_json={"issued_options": {"slots": real_open_slots}},
    )
    assert "1. *04:00 PM*" not in val["sanitized_text"]
    assert "2. *08:00 PM*" not in val["sanitized_text"]
    assert "Tomorrow slots" not in val["sanitized_text"]
    assert "*Dr. Ayesha Malik*" in val["sanitized_text"]
    assert "*Ms. Naseem Mai*" in val["sanitized_text"]


def test_post_booking_buttons_and_numeric_123_executable_resolution():
    """
    Verifies:
    1. Booking confirmation flattens Markdown [View Ticket](url) -> plain clickable URL and strips
       duplicate '1. Reschedule / 2. Cancel appointment / 3. Queue status' text when interactive buttons attach.
    2. Manual numeric shortcuts ('1', '2', '3', '4') deterministically resolve to the exact executable
       command from last_interactive_options (Reschedule, Cancel appointment, Queue status, etc.).
    3. Typing '1' -> Reschedule, '2' -> Cancel appointment, '3' -> Queue status execute immediately without
       forcing the patient to type full button labels or Booking IDs manually.
    """
    import json
    from unittest.mock import MagicMock
    from app.services.ai.supervisor import (
        resolve_numeric_option_shortcut,
        extract_interactive_labels,
        _update_state_from_tool,
    )
    from app.services.ai.interactive_formatter import generate_interactive_elements
    from app.services.ai.output_validator import validate_ai_response

    conf_tool = {
        "tool": "book_appointment",
        "result": {
            "status": "CONFIRMED",
            "appointment_number": "APT-202611-7A283A",
            "queue_token": "T-M02",
            "patient_name": "Tahir Aziz",
            "doctor_name": "Dr. Ayesha Malik",
            "room_number": "Room 102",
            "appointment_date": "2026-11-27",
            "slot_time": "05:30 PM",
            "fee_pkr": 1800,
        },
    }

    state = _update_state_from_tool({"step": "AWAITING_CONFIRMATION"}, "book_appointment", conf_tool["result"], "k1")
    assert state["step"] == "BOOKED"
    assert state["last_booking"]["appointment_number"] == "APT-202611-7A283A"

    # Interactive post-booking buttons
    mock_db = MagicMock()
    inter = generate_interactive_elements(
        db=mock_db,
        tenant_id="11111111-1111-1111-1111-111111111111",
        tenant_name="Alpha Heart & Medical Centre",
        user_text="Confirm",
        reply_text="Appointment Confirmed!",
        tools_executed=[conf_tool],
        state_json=state,
    )
    assert inter is not None
    labels = extract_interactive_labels(inter)
    assert labels == ["Reschedule", "Cancel appointment", "Queue status"]
    state["issued_options"]["last_interactive_options"] = labels

    # Output validator strips [View Ticket](url) brackets + duplicate 1/2/3 menu
    sample_conf_msg = (
        "✅ *Appointment Confirmed!*\n"
        "- Patient: Tahir Aziz\n"
        "- Doctor: Dr. Ayesha Malik (General Medicine, Room 102)\n"
        "- Slot: 05:30 PM\n"
        "- Queue Token: T\u2011M02\n"
        "- Booking Ref: APT\u2011202611\u20117A283A\n"
        "- Digital Ticket: [View Ticket](http://192.168.1.31:3000/ticket/APT-202611-7A283A)\n\n"
        "1. Reschedule\n"
        "2. Cancel appointment\n"
        "3. Queue status\n"
    )
    cleaned_conf = validate_ai_response(sample_conf_msg, tools_executed=[conf_tool], state_json=state)["sanitized_text"]
    assert "[View Ticket]" not in cleaned_conf
    assert "http://192.168.1.31:3000/ticket/APT-202611-7A283A" in cleaned_conf
    assert "1. Reschedule" not in cleaned_conf
    assert "*APT-202611-7A283A*" in cleaned_conf
    assert "*T-M02*" in cleaned_conf

    # Manual numeric inputs '1', '2', '3' resolve directly to executable commands
    assert resolve_numeric_option_shortcut("1", state) == "Reschedule"
    assert resolve_numeric_option_shortcut("2", state) == "Cancel appointment"
    assert resolve_numeric_option_shortcut("3", state) == "Queue status"

    # Executable tool calls via GroqClient fallback after '1' / '2' / '3' resolution
    gc = GroqClient(api_key="gsk_placeholder_key")
    tools = [
        {"type": "function", "function": {"name": "get_doctor_schedule"}},
        {"type": "function", "function": {"name": "reschedule_appointment"}},
        {"type": "function", "function": {"name": "cancel_appointment"}},
        {"type": "function", "function": {"name": "get_queue_status"}},
    ]
    sys_msg = {"role": "system", "content": f"Conversation State: {json.dumps(state)}"}

    # Option 1 -> Reschedule fetches booked doctor's schedule for slot selection
    res_1 = gc._mock_completion([sys_msg, {"role": "user", "content": resolve_numeric_option_shortcut("1", state)}], tools=tools)
    assert res_1["message"]["tool_calls"][0]["function"]["name"] == "get_doctor_schedule"
    assert json.loads(res_1["message"]["tool_calls"][0]["function"]["arguments"])["doctor_name_or_specialty"] == "Dr. Ayesha Malik"

    # Option 2 -> Cancel appointment initiates 2-step confirmation with APT-202611-7A283A
    res_2 = gc._mock_completion([sys_msg, {"role": "user", "content": resolve_numeric_option_shortcut("2", state)}], tools=tools)
    assert res_2["message"]["tool_calls"][0]["function"]["name"] == "cancel_appointment"
    c_args = json.loads(res_2["message"]["tool_calls"][0]["function"]["arguments"])
    assert c_args["appointment_id"] == "APT-202611-7A283A"
    assert c_args["confirmed"] is False

    # Option 3 -> Queue status runs get_queue_status directly
    res_3 = gc._mock_completion([sys_msg, {"role": "user", "content": resolve_numeric_option_shortcut("3", state)}], tools=tools)
    assert res_3["message"]["tool_calls"][0]["function"]["name"] == "get_queue_status"

    # Cancellation CONFIRMATION_REQUIRED deterministically yields Confirm / Change buttons
    inter_cancel = generate_interactive_elements(
        db=mock_db,
        tenant_id="11111111-1111-1111-1111-111111111111",
        tenant_name="Alpha Clinic",
        user_text="Cancel appointment",
        reply_text="Summary for APT-202611-7A283A",
        tools_executed=[{"tool": "cancel_appointment", "result": {"status": "CONFIRMATION_REQUIRED"}}],
        state_json=state,
    )
    assert extract_interactive_labels(inter_cancel) == ["Confirm", "Change"]


def test_menu_and_booking_intent_attaches_primary_buttons_and_progresses_to_db_specialties():
    """
    Verifies:
    1. Pure greeting ('Assalam o Alikum') produces ZERO interactive elements (res['interactive'] is None).
    2. Explicit booking intent ('I want to book my appointment') or 'menu' produces the 4 primary actions:
       ['Book appointment', 'My appointments', 'Queue status', 'Talk to reception'].
    3. Selecting 'Book appointment' queries platform_db and returns dynamic specialty buttons:
       ['General Physician', 'Cardiology', 'Dermatology', 'Pediatrics'].
    """
    from unittest.mock import MagicMock, patch
    from app.services.ai.interactive_formatter import generate_interactive_elements, extract_interactive_labels

    mock_db = MagicMock()
    mock_depts = [
        {"id": "dep-1", "name": "General Medicine"},
        {"id": "dep-2", "name": "Cardiology"},
        {"id": "dep-3", "name": "Dermatology"},
        {"id": "dep-4", "name": "Pediatrics"},
    ]

    with patch("app.services.ai.interactive_formatter.get_departments_db", return_value={"departments": mock_depts}):
        # 1. Pure greeting -> No interactive payload
        greeting_inter = generate_interactive_elements(
            db=mock_db,
            tenant_id="11111111-1111-1111-1111-111111111111",
            tenant_name="Alpha Heart & Medical Centre",
            user_text="Assalam o Alikum",
            reply_text="Walaikum Assalam! Welcome to Alpha Heart & Medical Centre. How can I help you today?",
            tools_executed=[],
            state_json={},
        )
        assert greeting_inter is None

        # 2. 'I want to book my appointment' -> 4 Primary Actions
        booking_intent_inter = generate_interactive_elements(
            db=mock_db,
            tenant_id="11111111-1111-1111-1111-111111111111",
            tenant_name="Alpha Heart & Medical Centre",
            user_text="I want to book my appointment",
            reply_text="Sure! I can help you with that. Please choose an option below:",
            tools_executed=[],
            state_json={},
        )
        assert extract_interactive_labels(booking_intent_inter) == [
            "Book appointment",
            "My appointments",
            "Queue status",
            "Talk to reception",
        ]

        # 3. 'menu' -> 4 Primary Actions
        menu_inter = generate_interactive_elements(
            db=mock_db,
            tenant_id="11111111-1111-1111-1111-111111111111",
            tenant_name="Alpha Heart & Medical Centre",
            user_text="menu",
            reply_text="Welcome to Alpha Heart & Medical Centre. Please select an option:",
            tools_executed=[],
            state_json={},
        )
        assert extract_interactive_labels(menu_inter) == [
            "Book appointment",
            "My appointments",
            "Queue status",
            "Talk to reception",
        ]

        # 4. 'Book appointment' -> Dynamic Database Specialties
        book_spec_inter = generate_interactive_elements(
            db=mock_db,
            tenant_id="11111111-1111-1111-1111-111111111111",
            tenant_name="Alpha Heart & Medical Centre",
            user_text="Book appointment",
            reply_text="Please choose a specialty:",
            tools_executed=[],
            state_json={},
        )
        assert extract_interactive_labels(book_spec_inter) == [
            "General Physician",
            "Cardiology",
            "Dermatology",
            "Pediatrics",
        ]


def test_reminders_24h_pre_date_and_30m_exact_window_and_channel_re():
    """
    Verifies:
    1. 24H reminder fires ONLY when booked before appointment_date AND 30m < delta <= 24h (never same-day or >24h early).
    2. 30M reminder fires ONLY when 0 < delta <= 30m and booking lead >= 35m (skips >30m future, past slots, last-minute bookings).
    3. Legacy 2H alias delegates to 30M, dispatch API supports ALL/24H/30M/2H, and reminder copy mentions 30 min (not 2h).
    4. ChannelService imports `re` cleanly without NameError on numeric shortcuts.
    """
    from types import SimpleNamespace
    from unittest.mock import MagicMock, patch
    from zoneinfo import ZoneInfo
    from app.api.v1.clinic import dispatch_automated_reminders
    from app.workers import reminder_worker
    from app.services import channel_service

    # Verify channel_service has `re` imported cleanly
    assert hasattr(channel_service, "re")

    pkt = timezone(timedelta(hours=5))
    now_local = datetime(2026, 11, 28, 16, 30, tzinfo=pkt)
    t_id = uuid.UUID("11111111-1111-1111-1111-111111111111")
    tenant_obj = SimpleNamespace(id=t_id, name="Alpha Heart & Medical Centre", timezone="Asia/Karachi")
    doc = SimpleNamespace(name="Dr. Ayesha Malik", specialty="General Medicine", room_number="Room 102")

    # 24H cases:
    # A) Booked yesterday (Nov 27) for tomorrow Nov 29 10:00 AM (17.5h away <= 24h) -> DUE
    apt_24_due = SimpleNamespace(
        id=uuid.uuid4(), tenant_id=t_id, appointment_number="APT-24-OK",
        appointment_date=date(2026, 11, 29), slot_time=time(10, 0),
        queue_token="T-M01", status="BOOKED", created_at=datetime(2026, 11, 27, 14, 0, tzinfo=pkt),
    )
    # B) Same-day booking (booked Nov 28 morning for Nov 28 evening) -> EXCLUDED from 24H
    apt_24_sameday = SimpleNamespace(
        id=uuid.uuid4(), tenant_id=t_id, appointment_number="APT-24-SAMEDAY",
        appointment_date=date(2026, 11, 28), slot_time=time(20, 0),
        queue_token="T-M02", status="BOOKED", created_at=datetime(2026, 11, 28, 9, 0, tzinfo=pkt),
    )
    # C) Booked yesterday for Nov 29 20:00 (27.5h away > 24h) -> NOT YET DUE
    apt_24_too_early = SimpleNamespace(
        id=uuid.uuid4(), tenant_id=t_id, appointment_number="APT-24-EARLY",
        appointment_date=date(2026, 11, 29), slot_time=time(20, 0),
        queue_token="T-M03", status="BOOKED", created_at=datetime(2026, 11, 27, 14, 0, tzinfo=pkt),
    )

    c_en = SimpleNamespace(customer_phone="923001111111", full_name="Tahir Aziz", push_name=None, metadata_={"language": "ENGLISH"})
    c_ru = SimpleNamespace(customer_phone="923002222222", full_name="Naseem Mai", push_name=None, metadata_={"language": "ROMAN_URDU"})
    c_ur = SimpleNamespace(customer_phone="923003333333", full_name="علی", push_name=None, metadata_={"language": "URDU"})

    dispatched_24 = []
    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = tenant_obj

    with patch.object(
        reminder_worker,
        "_collect_due_appointments",
        return_value=[(apt_24_due, doc, c_en), (apt_24_sameday, doc, c_ru), (apt_24_too_early, doc, c_ru)],
    ), patch.object(
        reminder_worker,
        "_dispatch_appointment_reminder",
        side_effect=lambda db, apt, d, c, reminder_kind: dispatched_24.append((apt.appointment_number, reminder_kind)) or True,
    ):
        res_24 = reminder_worker.process_24h_reminders_db(mock_db, tenant_id=str(t_id), current_dt_override=now_local)
        assert res_24["reminders_dispatched"] == 1
        assert dispatched_24 == [("APT-24-OK", "24H")]

    # 30M cases relative to 2026-11-28 16:30 PKT:
    # 1) 16:55 slot (25m away), booked at 13:00 (lead 235m) -> DUE
    apt_30_due = SimpleNamespace(
        id=uuid.uuid4(), tenant_id=t_id, appointment_number="APT-30-OK",
        appointment_date=date(2026, 11, 28), slot_time=time(16, 55),
        queue_token="T-M04", status="BOOKED", created_at=datetime(2026, 11, 28, 13, 0, tzinfo=pkt),
    )
    # 2) 18:30 slot (2h away) -> EXCLUDED (not 30m yet)
    apt_30_2h_far = SimpleNamespace(
        id=uuid.uuid4(), tenant_id=t_id, appointment_number="APT-30-2HFAR",
        appointment_date=date(2026, 11, 28), slot_time=time(18, 30),
        queue_token="T-M05", status="BOOKED", created_at=datetime(2026, 11, 28, 10, 0, tzinfo=pkt),
    )
    # 3) 16:15 slot (15m ago) -> EXCLUDED (past)
    apt_30_past = SimpleNamespace(
        id=uuid.uuid4(), tenant_id=t_id, appointment_number="APT-30-PAST",
        appointment_date=date(2026, 11, 28), slot_time=time(16, 15),
        queue_token="T-M06", status="BOOKED", created_at=datetime(2026, 11, 28, 10, 0, tzinfo=pkt),
    )
    # 4) 16:45 slot (15m away), booked at 16:25 (lead 20m < 35m) -> EXCLUDED (last-minute booking)
    apt_30_last_min = SimpleNamespace(
        id=uuid.uuid4(), tenant_id=t_id, appointment_number="APT-30-LASTMIN",
        appointment_date=date(2026, 11, 28), slot_time=time(16, 45),
        queue_token="T-M07", status="BOOKED", created_at=datetime(2026, 11, 28, 16, 25, tzinfo=pkt),
    )

    dispatched_30 = []
    with patch.object(
        reminder_worker,
        "_collect_due_appointments",
        return_value=[
            (apt_30_due, doc, c_ru),
            (apt_30_2h_far, doc, c_en),
            (apt_30_past, doc, c_en),
            (apt_30_last_min, doc, c_en),
        ],
    ), patch.object(
        reminder_worker,
        "_dispatch_appointment_reminder",
        side_effect=lambda db, apt, d, c, reminder_kind: dispatched_30.append((apt.appointment_number, reminder_kind)) or True,
    ):
        res_30 = reminder_worker.process_30m_reminders_db(mock_db, tenant_id=str(t_id), current_dt_override=now_local)
        assert res_30["type"] == "30M_REMINDERS"
        assert res_30["reminders_dispatched"] == 1
        assert dispatched_30 == [("APT-30-OK", "30M")]

        # Legacy 2H alias invokes exact same 30M engine
        dispatched_30.clear()
        res_legacy = reminder_worker.process_2h_reminders_db(mock_db, tenant_id=str(t_id), current_dt_override=now_local)
        assert res_legacy["type"] == "30M_REMINDERS"
        assert dispatched_30 == [("APT-30-OK", "30M")]

    # Trilingual 30M formatting checks (zero "2 ghante" anywhere)
    msg_en = reminder_worker._format_reminder_message("30M", "ENGLISH", "Tahir Aziz", "Alpha Clinic", doc, apt_30_due)
    msg_ru = reminder_worker._format_reminder_message("30M", "ROMAN_URDU", "Naseem Mai", "Alpha Clinic", doc, apt_30_due)
    msg_ur = reminder_worker._format_reminder_message("30M", "URDU", "علی", "Alpha Clinic", doc, apt_30_due)
    assert "*30 minutes*" in msg_en and "*Tahir Aziz*" in msg_en
    assert "*30 minute*" in msg_ru and "2 ghante" not in msg_ru
    assert "*30 منٹ*" in msg_ur

    # Router dispatch routing for 30M and legacy 2H
    with patch("app.workers.reminder_worker.process_30m_reminders_db", return_value={"status": "SUCCESS", "type": "30M_REMINDERS", "reminders_dispatched": 1}) as p30:
        out_30m = dispatch_automated_reminders(reminder_type="30M", x_tenant_id=str(t_id), db=mock_db)
        out_2h = dispatch_automated_reminders(reminder_type="2H", x_tenant_id=str(t_id), db=mock_db)
        assert out_30m["type"] == "30M_REMINDERS"
        assert out_2h["type"] == "30M_REMINDERS"
        assert p30.call_count == 2

    # Verify reschedule_appointment_db resets all reminder flags for the new slot
    from app.services.clinic_service import reschedule_appointment_db
    apt_resched = SimpleNamespace(
        id=uuid.uuid4(),
        tenant_id=t_id,
        appointment_number="APT-RSCH-01",
        doctor_id=uuid.uuid4(),
        appointment_date=date(2026, 11, 29),
        slot_time=time(10, 0),
        queue_token="T-M09",
        status="BOOKED",
        reminder_24h_sent=True,
        reminder_24h_sent_at=now_local,
        reminder_30m_sent=True,
        reminder_30m_sent_at=now_local,
        reminder_2h_sent=True,
        reminder_2h_sent_at=now_local,
        updated_at=now_local,
    )
    doc_resched = SimpleNamespace(id=apt_resched.doctor_id, name="Dr. Ayesha Malik", specialty="General Medicine", room_number="Room 102", fee_pkr=1500)
    contact_resched = SimpleNamespace(customer_phone="923001111111", full_name="Tahir Aziz", push_name=None)
    db_rsch = MagicMock()
    with patch("app.services.clinic_service._find_appointment_join_row", return_value=(apt_resched, doc_resched, contact_resched)), patch(
        "app.services.clinic_service._get_tenant_timezone_and_now", return_value=("Asia/Karachi", now_local)
    ), patch("app.services.clinic_service._get_connected_channel", return_value=None):
        rsch_out = reschedule_appointment_db(
            db=db_rsch,
            tenant_id=str(t_id),
            appointment_identifier="APT-RSCH-01",
            new_date_str="2026-11-30",
            new_slot_str="05:00 PM",
            enforce_checks=False,
            confirmed=True,
        )
        assert rsch_out["status"] == "RESCHEDULED"
        assert apt_resched.reminder_24h_sent is False
        assert apt_resched.reminder_24h_sent_at is None
        assert apt_resched.reminder_30m_sent is False
        assert apt_resched.reminder_30m_sent_at is None
        assert apt_resched.reminder_2h_sent is False
        assert apt_resched.reminder_2h_sent_at is None


def test_humanized_turn2_menu_no_name_clash_and_meta_interactive_buttons():
    """
    Verifies:
    1. 'ma ny appointment karwani hn' is accurately detected as ROMAN_URDU.
    2. 'I want to book my appointment' receives a warm humanized prompt aligned with
       the 4 options (NEVER asking 'full name' simultaneously alongside menu buttons).
    3. Tapping/selecting 'Book appointment' triggers get_departments() -> warm specialty question.
    4. MetaCloudApiAdapter dispatches native Meta interactive reply buttons & lists.
    """
    from unittest.mock import patch
    from app.adapters.meta import MetaCloudApiAdapter
    from app.services.ai.groq_client import GroqClient
    from app.services.ai.prompt_engine import detect_language_and_script

    assert detect_language_and_script("ma ny appointment karwani hn")["language"] == "ROMAN_URDU"
    assert detect_language_and_script("I want to book my appointment")["language"] == "ENGLISH"

    gc = GroqClient(api_key="gsk_placeholder_key")
    tools = [
        {"type": "function", "function": {"name": "get_departments"}},
        {"type": "function", "function": {"name": "book_appointment"}},
    ]

    # Turn 2 English -> humanized option invite (NOT full name prompt)
    res_en = gc._mock_completion(messages=[{"role": "user", "content": "I want to book my appointment"}], tools=tools)
    txt_en = res_en["message"]["content"]
    assert "full name" not in txt_en.lower()
    assert "happy to help" in txt_en.lower()

    # Turn 2 Roman Urdu -> humanized Roman Urdu option invite
    res_ru = gc._mock_completion(messages=[{"role": "user", "content": "ma ny appointment karwani hn"}], tools=tools)
    txt_ru = res_ru["message"]["content"]
    assert "madad" in txt_ru.lower()
    assert "naam" not in txt_ru.lower()

    # Turn 3 Clicking 'Book appointment' -> invokes get_departments()
    res_btn = gc._mock_completion(messages=[{"role": "user", "content": "Book appointment"}], tools=tools)
    assert res_btn["message"]["tool_calls"][0]["function"]["name"] == "get_departments"

    # Turn 3 Synthesis preserves session language (Roman Urdu) across button click
    res_synth_ru = gc._mock_completion(
        messages=[
            {"role": "system", "content": 'Role for "Alpha Clinic"\nDetected Language: ROMAN_URDU'},
            {"role": "user", "content": "Book appointment"},
            {"role": "tool", "content": json.dumps({"status": "SUCCESS", "departments": [{"name": "General Medicine"}]})},
        ],
        tools=tools,
    )
    assert "specialty ya department" in res_synth_ru["message"]["content"].lower()

    # MetaCloudApiAdapter native pill buttons (<=3) and interactive list (4+)
    meta = MetaCloudApiAdapter(phone_number_id="123456789", access_token="test-token")
    with patch.object(meta, "_post_graph", return_value={"success": True, "status_code": 200}) as mock_graph:
        meta.send_button_message("923001234567", "Please confirm:", [{"id": "c", "displayText": "Confirm"}, {"id": "x", "displayText": "Change"}])
        p_btn = mock_graph.call_args_list[-1][0][0]
        assert p_btn["type"] == "interactive"
        assert p_btn["interactive"]["type"] == "button"
        assert len(p_btn["interactive"]["action"]["buttons"]) == 2

        meta.send_button_groups(
            "923001234567",
            "Choose an option:",
            [{"buttons": [{"displayText": "Book appointment"}, {"displayText": "My appointments"}, {"displayText": "Queue status"}]}, {"buttons": [{"displayText": "Talk to reception"}]}],
        )
        p_list = mock_graph.call_args_list[-1][0][0]
        assert p_list["type"] == "interactive"
        assert p_list["interactive"]["type"] == "list"
        assert len(p_list["interactive"]["action"]["sections"][0]["rows"]) == 4

    meta_in = meta.normalize_inbound({
        "entry": [{"changes": [{"value": {"metadata": {"phone_number_id": "123"}, "contacts": [{"profile": {"name": "Tahir"}}], "messages": [{"id": "m1", "from": "923001234567", "type": "interactive", "interactive": {"button_reply": {"id": "btn_1", "title": "Book appointment"}}}]}}]}]
    })
    assert meta_in is not None and meta_in.text == "Book appointment"


def test_master_prompt_zero_duplication_and_doctor_grounding():
    """
    Verifies:
    1. Master prompt has no conflicting 8-item Home Menu and no stale 'Poll buttons' wording.
    2. Output validator strips duplicate numbered menu/specialty/confirmation lists.
    3. Output validator blocks fabricated 'Dr. ...' names not grounded in DB tools, state, or bot_name.
    """
    from app.services.ai.output_validator import validate_ai_response

    tenant = PlatformTenant(
        id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
        slug="alpha-clinic",
        name="Alpha Heart & Medical Centre",
        business_template_id="CLINIC_OPD",
        timezone="Asia/Karachi",
        currency="PKR",
        settings={"bot_name": "Dr. Shifa", "phone": "042-35780000"},
    )
    tpl = BusinessTemplate(
        id="CLINIC_OPD",
        name="Clinic & Hospital OPD Queue",
        industry_category="HEALTHCARE",
        allowed_tools=["get_departments", "get_doctor_schedule", "book_appointment"],
    )
    prompt = build_system_prompt(tenant, tpl)
    assert "3. Doctor Info & Fees" not in prompt
    assert "Poll buttons" not in prompt
    assert "NO DUPLICATE LISTS" in prompt

    # Duplicate numbered menu lines are stripped cleanly
    dup_menu_reply = (
        "I'd be happy to help! Please choose an option below:\n\n"
        "1. Book Appointment\n"
        "2. My Appointments\n"
        "3. Doctor Info & Fees\n"
        "4. Talk to Reception"
    )
    val_menu = validate_ai_response(dup_menu_reply, tools_executed=[], state_json={"step": "IDLE"})
    assert val_menu["valid"] is True
    assert "1. Book Appointment" not in val_menu["sanitized_text"]
    assert "3. Doctor Info" not in val_menu["sanitized_text"]

    # Duplicate specialty numbered lines stripped when get_departments executed
    dup_spec_reply = (
        "Of course! Which specialty would you like to visit?\n\n"
        "1. General Physician\n"
        "2. Cardiology\n"
        "3. Pediatrics"
    )
    val_spec = validate_ai_response(
        dup_spec_reply,
        tools_executed=[{"tool": "get_departments", "result": {"status": "SUCCESS", "departments": [{"name": "Cardiology"}]}}],
    )
    assert val_spec["valid"] is True
    assert "1. General Physician" not in val_spec["sanitized_text"]
    assert "2. Cardiology" not in val_spec["sanitized_text"]

    # Ungrounded fabricated doctor is blocked; grounded DB doctor and bot_name pass
    val_fake_doc = validate_ai_response(
        "Dr. Imran Qureshi is available today at 5:00 PM.",
        tools_executed=[],
        extra_entities={"bot_name": "Dr. Shifa"},
    )
    assert val_fake_doc["valid"] is False
    assert any(v.startswith("UNGROUNDED_DOCTOR:") for v in val_fake_doc["violations"])

    val_bot_ok = validate_ai_response(
        "Walaikum Assalam! Main Dr. Shifa hoon. Bataiye aaj main aap ki kya madad kar sakti hoon?",
        tools_executed=[],
        extra_entities={"bot_name": "Dr. Shifa"},
    )
    assert val_bot_ok["valid"] is True


def test_duplicate_webhook_releases_advisory_lock_and_empty_groq_fallback():
    """
    Verifies:
    1. ChannelService.process_inbound_webhook explicitly calls db.rollback() on DUPLICATE_DROPPED
       so pg_advisory_xact_lock is never leaked across async teardown.
    2. GroqClient.chat_completion retries next fallback model when HTTP 200 returns empty content.
    3. 'Aslaam alaikum!' is detected cleanly as ROMAN_URDU.
    """
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, MagicMock, patch
    from app.models.communication import TenantMessage
    from app.models.tenant import ChannelConnection
    from app.services.channel_service import ChannelService
    from app.services.ai.groq_client import GroqClient
    from app.services.ai.prompt_engine import detect_language_and_script

    assert detect_language_and_script("Aslaam alaikum!")["language"] == "ROMAN_URDU"

    # 1. Duplicate webhook triggers db.rollback() immediately
    mock_db = MagicMock()
    conn_row = SimpleNamespace(tenant_id=uuid.UUID("11111111-1111-1111-1111-111111111111"), phone_number_id="alpha-clinic")
    existing_msg_row = SimpleNamespace(id=uuid.uuid4())

    def _q(model):
        q = MagicMock()
        q.filter.return_value = q
        if model is ChannelConnection:
            q.first.return_value = conn_row
        elif model is TenantMessage:
            q.first.return_value = existing_msg_row
        return q

    mock_db.query.side_effect = _q
    dup_payload = {
        "instanceName": "alpha-clinic",
        "data": {
            "ID": "MSG_DUP_1",
            "Info": {"Chat": "923097313899@s.whatsapp.net", "Sender": "923097313899@s.whatsapp.net", "PushName": "Tahir"},
            "Message": {"conversation": "Aslaam alaikum!"},
        },
    }
    res = ChannelService.process_inbound_webhook("EVOLUTION_GO", dup_payload, mock_db)
    assert res["status"] == "DUPLICATE_DROPPED"
    assert mock_db.rollback.called is True

    # 2. GroqClient skips empty HTTP 200 reasoning responses and uses fallback model
    resp_empty = MagicMock()
    resp_empty.status_code = 200
    resp_empty.json.return_value = {"choices": [{"message": {"role": "assistant", "content": ""}, "finish_reason": "length"}], "usage": {}}
    resp_ok = MagicMock()
    resp_ok.status_code = 200
    resp_ok.json.return_value = {"choices": [{"message": {"role": "assistant", "content": "Please confirm your booking."}, "finish_reason": "stop"}], "usage": {"total_tokens": 50}}

    responses_iter = iter([resp_empty, resp_ok])

    class _FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, *args, **kwargs):
            return next(responses_iter)

    gc = GroqClient(api_key="real_key_test", model="openai/gpt-oss-120b")
    with patch("app.services.ai.groq_client.httpx.AsyncClient", _FakeAsyncClient):
        coro = gc.chat_completion(messages=[{"role": "user", "content": "Tahir aziz"}])
        try:
            coro.send(None)
            raise AssertionError("Expected sync completion with mock _FakeAsyncClient")
        except StopIteration as exc:
            out = exc.value
    assert out["status"] == "SUCCESS"
    assert out["message"]["content"] == "Please confirm your booking."
    assert out["model_used"] == "llama-3.3-70b-versatile"





