import asyncio
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
        fake_adapter.send_text_message.return_value = {"success": True, "status_code": 200, "response": {"key": {"id": "EVO_SENT_1"}}}
        mock_get_adapter.return_value = fake_adapter
        disp = ChannelService.dispatch_outbox_message(outbox.id, disp_db)
        assert disp["success"] is True

    assert len([o for o in disp_added if isinstance(o, TenantMessage)]) == 0
    assert ai_msg.provider_message_id == "EVO_SENT_1"
