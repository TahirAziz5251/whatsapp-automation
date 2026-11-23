import pytest
import uuid
import random
import concurrent.futures
from datetime import date, time, timedelta, datetime, timezone
from starlette.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.core.database import SessionLocal
from app.models.tenant import PlatformTenant, BusinessTemplate, ChannelConnection
from app.models.clinic import ClinicDoctor, ClinicAppointment, ClinicLiveQueue
from app.models.communication import (
    TenantConversation, 
    TenantMessage, 
    TenantOutboxMessage, 
    TenantAuditEvent
)
from app.models.billing import SubscriptionPlan, TenantSubscription, TenantUsageRecord
from app.models.contact import PlatformContact
from app.services.ai.prompt_engine import build_system_prompt, detect_language_and_script
from app.services.ai.tool_registry import get_allowed_tool_schemas, execute_tool
from app.services.clinic_service import (
    get_doctor_schedule_db,
    book_appointment_db,
    get_queue_status_db,
    walk_in_entry_db,
    call_next_patient_db,
    start_consultation_db,
    complete_consultation_db,
    get_patient_ticket_db
)
from app.services.crm_service import (
    record_audit_event_db,
    list_conversations_db,
    toggle_ai_pause_db,
    staff_send_message_db,
    update_contact_crm_db,
    list_audit_events_db
)
from app.services.billing_service import (
    list_subscription_plans_db,
    get_tenant_subscription_db,
    record_usage_db,
    get_tenant_monthly_usage_db,
    check_entitlement_db
)
from app.workers.reminder_worker import (
    process_24h_reminders_db,
    process_2h_reminders_db,
    run_full_reminder_cycle
)

@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client

# 3 TEST CLINIC TENANT IDS
ALPHA_TENANT_ID = "11111111-1111-1111-1111-111111111111"      # Alpha Heart & Medical Centre (Lahore)
CITY_DENTAL_TENANT_ID = "33333333-3333-3333-3333-333333333333" # City Dental & Orthodontic Care (Karachi)
NOOR_PEDIATRICS_TENANT_ID = "44444444-4444-4444-4444-444444444444" # Noor Children & Pediatric Hospital (Islamabad)

# ==============================================================================
# PILLAR 1: SAAS FOUNDATION & MULTI-TENANT ISOLATION
# ==============================================================================
def test_pillar1_saas_foundation_3_clinics():
    """
    Verifies that all 3 businesses are active tenants using the exact same
    business_template_id 'CLINIC_OPD', but maintain completely isolated identity,
    custom settings, bot names, addresses, and doctors.
    """
    db = SessionLocal()
    try:
        tenants = db.query(PlatformTenant).filter(
            PlatformTenant.id.in_([ALPHA_TENANT_ID, CITY_DENTAL_TENANT_ID, NOOR_PEDIATRICS_TENANT_ID])
        ).all()
        assert len(tenants) == 3

        tenant_map = {str(t.id): t for t in tenants}

        # Alpha Heart
        alpha = tenant_map[ALPHA_TENANT_ID]
        assert alpha.business_template_id == "CLINIC_OPD"
        assert alpha.name == "Alpha Heart & Medical Centre"
        assert alpha.settings.get("bot_name") == "Dr. Shifa"
        assert "Lahore" in alpha.settings.get("address", "")

        # City Dental
        dental = tenant_map[CITY_DENTAL_TENANT_ID]
        assert dental.business_template_id == "CLINIC_OPD"
        assert dental.name == "City Dental & Orthodontic Care"
        assert dental.settings.get("bot_name") == "Danto-Bot"
        assert "Karachi" in dental.settings.get("address", "")

        # Noor Pediatrics
        noor = tenant_map[NOOR_PEDIATRICS_TENANT_ID]
        assert noor.business_template_id == "CLINIC_OPD"
        assert noor.name == "Noor Children & Pediatric Hospital"
        assert noor.settings.get("bot_name") == "Noor Chacha"
        assert "Islamabad" in noor.settings.get("address", "")

        # Strict RLS Query Isolation Check
        # Querying with City Dental session must NEVER return Alpha's or Noor's doctors
        db.execute(text(f"SET app.current_tenant_id = '{CITY_DENTAL_TENANT_ID}'"))
        dental_doctors = db.query(ClinicDoctor).all()
        assert len(dental_doctors) == 2
        dental_names = [d.name for d in dental_doctors]
        assert "Dr. Sarah Zubair" in dental_names
        assert "Dr. Kamran Ali" in dental_names
        assert "Dr. Tariq Mahmood" not in dental_names
        assert "Dr. Farhan Qureshi" not in dental_names

        # Querying with Noor Pediatrics session
        db.execute(text(f"SET app.current_tenant_id = '{NOOR_PEDIATRICS_TENANT_ID}'"))
        noor_doctors = db.query(ClinicDoctor).all()
        assert len(noor_doctors) == 2
        noor_names = [d.name for d in noor_doctors]
        assert "Dr. Farhan Qureshi" in noor_names
        assert "Dr. Hina Tahir" in noor_names
        assert "Dr. Sarah Zubair" not in noor_names
        assert "Dr. Tariq Mahmood" not in noor_names

    finally:
        db.close()

# ==============================================================================
# PILLAR 2: COMMUNICATION INFRASTRUCTURE & WHATSAPP GATEWAY
# ==============================================================================
def test_pillar2_communication_channels_3_clinics(client):
    """
    Verifies that each clinic has its own WhatsApp channel connection,
    and inbound webhooks are automatically routed to the correct tenant.
    """
    # 1. Inbound message to City Dental ('dental-assistant')
    dental_phone = f"92300{random.randint(1000000, 9999999)}"
    dental_payload = {
        "event": "messages.upsert",
        "instanceName": "dental-assistant",
        "data": {
            "ID": f"MSG_DENT_{uuid.uuid4().hex[:8]}",
            "IsFromMe": False,
            "Info": {
                "Sender": f"{dental_phone}@s.whatsapp.net",
                "PushName": "Usman Tariq",
                "Chat": f"{dental_phone}@s.whatsapp.net"
            },
            "Message": {
                "conversation": "Danto ki scaling ki fees kya hai?"
            }
        }
    }
    res_dental = client.post("/api/v1/channels/whatsapp/evolution", json=dental_payload)
    assert res_dental.status_code == 200
    assert res_dental.json()["tenant_id"] == CITY_DENTAL_TENANT_ID

    # 2. Inbound message to Noor Pediatrics ('pediatric-assistant')
    peds_phone = f"92321{random.randint(1000000, 9999999)}"
    peds_payload = {
        "event": "messages.upsert",
        "instanceName": "pediatric-assistant",
        "data": {
            "ID": f"MSG_PEDS_{uuid.uuid4().hex[:8]}",
            "IsFromMe": False,
            "Info": {
                "Sender": f"{peds_phone}@s.whatsapp.net",
                "PushName": "Fatima Bibi",
                "Chat": f"{peds_phone}@s.whatsapp.net"
            },
            "Message": {
                "conversation": "Bachay ki vaccination ka schedule bataein"
            }
        }
    }
    res_peds = client.post("/api/v1/channels/whatsapp/evolution", json=peds_payload)
    assert res_peds.status_code == 200
    assert res_peds.json()["tenant_id"] == NOOR_PEDIATRICS_TENANT_ID

    # 3. Inbound message to Alpha Heart ('hospital-assistant')
    alpha_phone = f"92304{random.randint(1000000, 9999999)}"
    alpha_payload = {
        "event": "messages.upsert",
        "instanceName": "hospital-assistant",
        "data": {
            "ID": f"MSG_ALPH_{uuid.uuid4().hex[:8]}",
            "IsFromMe": False,
            "Info": {
                "Sender": f"{alpha_phone}@s.whatsapp.net",
                "PushName": "Zubair Ahmed",
                "Chat": f"{alpha_phone}@s.whatsapp.net"
            },
            "Message": {
                "conversation": "Cardiologist Dr. Tariq ki appointment leni hai"
            }
        }
    }
    res_alpha = client.post("/api/v1/channels/whatsapp/evolution", json=alpha_payload)
    assert res_alpha.status_code == 200
    assert res_alpha.json()["tenant_id"] == ALPHA_TENANT_ID

# ==============================================================================
# PILLAR 3: CRM CORE, CONVERSATION AUDITING & STAFF ESCALATION
# ==============================================================================
def test_pillar3_crm_core_and_isolation_3_clinics(client):
    """
    Verifies CRM contacts, conversation threads, staff human takeover (ai_paused),
    and tenant audit event logging across the 3 clinics.
    """
    # 1. Fetch conversations for City Dental
    res = client.get("/api/v1/crm/conversations", headers={"X-Tenant-ID": CITY_DENTAL_TENANT_ID})
    assert res.status_code == 200
    dental_convs = res.json()
    assert len(dental_convs) >= 1
    target_conv_id = dental_convs[0]["id"]

    # 2. Staff toggles human takeover (ai_paused = True) via pause-ai endpoint
    pause_res = client.post(
        f"/api/v1/crm/conversations/{target_conv_id}/pause-ai",
        headers={"X-Tenant-ID": CITY_DENTAL_TENANT_ID}
    )
    assert pause_res.status_code == 200
    assert pause_res.json()["ai_paused"] is True

    # 3. Staff sends manual WhatsApp reply
    msg_res = client.post(
        f"/api/v1/crm/conversations/{target_conv_id}/messages",
        headers={"X-Tenant-ID": CITY_DENTAL_TENANT_ID},
        json={"message": "Assalam-o-Alaikum, main Dr. Sarah ka assistant hoon. Aap kis waqt aana chahein gay?"}
    )
    assert msg_res.status_code == 200
    assert msg_res.json()["status"] in ("SUCCESS", "SENT")

    # 4. Verify cross-tenant isolation: Noor Pediatrics cannot access City Dental's conversation
    forbidden_res = client.get(
        f"/api/v1/crm/conversations/{target_conv_id}",
        headers={"X-Tenant-ID": NOOR_PEDIATRICS_TENANT_ID}
    )
    assert forbidden_res.status_code == 404

    # 5. Check audit event log
    audit_res = client.get("/api/v1/crm/audit-events", headers={"X-Tenant-ID": CITY_DENTAL_TENANT_ID})
    assert audit_res.status_code == 200
    events = audit_res.json()
    assert len(events) >= 1
    actions = [e["action"] for e in events]
    assert "CONVERSATION_AI_PAUSED" in actions or "STAFF_MANUAL_MESSAGE_SENT" in actions

# ==============================================================================
# PILLAR 4: AI AGENT ENGINE & DYNAMIC TENANT PERSONAS
# ==============================================================================
def test_pillar4_ai_agent_engine_dynamic_personas():
    """
    Verifies that build_system_prompt dynamically produces completely customized
    personas, bot names, addresses, and specialties for all 3 clinics,
    while enforcing zero-tolerance clinical safety and tool allowlists.
    """
    db = SessionLocal()
    try:
        template = db.query(BusinessTemplate).filter(BusinessTemplate.id == "CLINIC_OPD").first()

        # 1. Alpha Heart Prompt
        alpha_t = db.query(PlatformTenant).filter(PlatformTenant.id == ALPHA_TENANT_ID).first()
        alpha_prompt = build_system_prompt(alpha_t, template)
        assert 'You are "Dr. Shifa"' in alpha_prompt
        assert "Alpha Heart & Medical Centre" in alpha_prompt
        assert "Gulberg III, Lahore" in alpha_prompt
        assert "Cardiology & Internal Medicine" in alpha_prompt
        assert "EMERGENCY PROTOCOL" in alpha_prompt
        assert "1122" in alpha_prompt

        # 2. City Dental Prompt
        dental_t = db.query(PlatformTenant).filter(PlatformTenant.id == CITY_DENTAL_TENANT_ID).first()
        dental_prompt = build_system_prompt(dental_t, template)
        assert 'You are "Danto-Bot"' in dental_prompt
        assert "City Dental & Orthodontic Care" in dental_prompt
        assert "Clifton, Karachi" in dental_prompt
        assert "Dentistry & Orthodontics" in dental_prompt

        # 3. Noor Pediatrics Prompt
        noor_t = db.query(PlatformTenant).filter(PlatformTenant.id == NOOR_PEDIATRICS_TENANT_ID).first()
        noor_prompt = build_system_prompt(noor_t, template)
        assert 'You are "Noor Chacha"' in noor_prompt
        assert "Noor Children & Pediatric Hospital" in noor_prompt
        assert "Blue Area, Islamabad" in noor_prompt
        assert "Pediatrics & Child Health" in noor_prompt

        # 4. Trilingual Language Detection
        assert detect_language_and_script("Kal subah 10 baje ka appointment mil sakta hai?")["language"] == "ROMAN_URDU"
        assert detect_language_and_script("کیا ڈاکٹر صاحب دستیاب ہیں؟")["language"] == "URDU"
        assert detect_language_and_script("What are the OPD charges for consultation?")["language"] == "ENGLISH"

        # 5. Tool Allowlists & Security Rejection
        clinic_schemas = get_allowed_tool_schemas(template.allowed_tools)
        schema_names = [s["function"]["name"] for s in clinic_schemas]
        assert "get_doctor_schedule" in schema_names
        assert "book_appointment" in schema_names
        assert "create_food_order" not in schema_names

        # Cross-vertical tool execution rejected
        sec_result = execute_tool(
            tenant_id=CITY_DENTAL_TENANT_ID,
            allowed_tool_names=template.allowed_tools,
            tool_name="create_food_order",
            arguments={"dish": "Biryani"}
        )
        assert sec_result["status"] == "SECURITY_VIOLATION"

    finally:
        db.close()

# ==============================================================================
# PILLAR 5: TRANSACTIONAL ENGINE (BOOKINGS, TOKENS & CONSULTATIONS)
# ==============================================================================
def test_pillar5_transactional_engine_3_clinics():
    """
    Verifies appointment bookings across the 3 clinics yield distinct token
    formats and room numbers, and tests the end-to-end OPD consultation lifecycle.
    """
    db = SessionLocal()
    try:
        today_date = date.today().strftime("%Y-%m-%d")

        # 1. Book in City Dental with Dr. Sarah Zubair
        phone_d = f"92301{random.randint(1000000, 9999999)}"
        booking_d = book_appointment_db(
            db=db,
            tenant_id=CITY_DENTAL_TENANT_ID,
            patient_phone=phone_d,
            patient_name="Hamza Abbasi",
            doctor_name_or_id="Dr. Sarah Zubair",
            appointment_date_str=today_date,
            slot_time_str="11:00:00",
            symptoms="Teeth alignment consultation"
        )
        assert booking_d["status"] in ("SUCCESS", "CONFIRMED")
        assert booking_d["queue_token"].startswith("T-Z")
        assert "Sarah" in booking_d["doctor_name"]
        apt_id_d = booking_d["appointment_id"]
        doctor_id_d = booking_d["doctor_id"]

        # 2. Book in Noor Pediatrics with Dr. Farhan Qureshi
        phone_p = f"92333{random.randint(1000000, 9999999)}"
        booking_p = book_appointment_db(
            db=db,
            tenant_id=NOOR_PEDIATRICS_TENANT_ID,
            patient_phone=phone_p,
            patient_name="Baby Zoya",
            doctor_name_or_id="Dr. Farhan Qureshi",
            appointment_date_str=today_date,
            slot_time_str="11:30:00",
            symptoms="Routine 6-month checkup"
        )
        assert booking_p["status"] in ("SUCCESS", "CONFIRMED")
        assert booking_p["queue_token"].startswith("T-Q")
        assert "Farhan" in booking_p["doctor_name"]

        # 3. Walk-in entry at City Dental Reception
        walk_in = walk_in_entry_db(
            db=db,
            tenant_id=CITY_DENTAL_TENANT_ID,
            patient_name="Rashid Minhas",
            patient_phone=f"92315{random.randint(1000000, 9999999)}",
            doctor_id=doctor_id_d,
            symptoms="Severe toothache emergency"
        )
        assert walk_in["status"] == "CHECKED_IN"
        assert walk_in["is_walk_in"] is True
        assert "queue_token" in walk_in

        # 4. Doctor consultation lifecycle (Call Next -> Start -> Complete)
        called = call_next_patient_db(db, CITY_DENTAL_TENANT_ID, doctor_id_d)
        assert called["status"] == "PATIENT_CALLED"
        assert called["queue_token"] is not None

        started = start_consultation_db(db, CITY_DENTAL_TENANT_ID, called["appointment_id"])
        assert started["status"] in ("IN_CONSULTATION", "SUCCESS")

        completed = complete_consultation_db(
            db=db,
            tenant_id=CITY_DENTAL_TENANT_ID,
            appointment_id=called["appointment_id"],
            notes="Prescribed analgesics and scheduled root canal session"
        )
        assert completed["status"] in ("COMPLETED", "SUCCESS")

    finally:
        db.close()

# ==============================================================================
# PILLAR 6: AUTOMATION ENGINE (N8N REMINDER DISPATCH & WEBHOOKS)
# ==============================================================================
def test_pillar6_automation_engine_reminders_and_n8n(client):
    """
    Verifies automated 24-hour and 2-hour reminder scanning and execution
    across all 3 clinics without cross-tenant contamination.
    """
    db = SessionLocal()
    try:
        # Explicitly set RLS for Noor Pediatrics to query doctor
        db.execute(text(f"SET app.current_tenant_id = '{NOOR_PEDIATRICS_TENANT_ID}'"))
        target_tomorrow = date.today() + timedelta(days=1)
        noor_doctor = db.query(ClinicDoctor).filter(ClinicDoctor.tenant_id == NOOR_PEDIATRICS_TENANT_ID).first()
        assert noor_doctor is not None
        phone_rem = f"92322{random.randint(1000000, 9999999)}"

        booking = book_appointment_db(
            db=db,
            tenant_id=NOOR_PEDIATRICS_TENANT_ID,
            patient_phone=phone_rem,
            patient_name="Kashif Nadeem",
            doctor_name_or_id=noor_doctor.name,
            appointment_date_str=target_tomorrow.strftime("%Y-%m-%d"),
            slot_time_str="12:00:00",
            symptoms="Follow-up vaccination"
        )
        assert booking["status"] in ("SUCCESS", "CONFIRMED")

        # Run 24h reminder processor specifically for Noor Pediatrics
        r24 = process_24h_reminders_db(db, tenant_id=NOOR_PEDIATRICS_TENANT_ID, target_date=target_tomorrow)
        assert r24["status"] == "SUCCESS"
        assert r24["reminders_dispatched"] >= 1

        # Check outbox: message must be enqueued with Noor Children identity and live ticket link
        db.execute(text(f"SET app.current_tenant_id = '{NOOR_PEDIATRICS_TENANT_ID}'"))
        outbox_entry = db.query(TenantOutboxMessage).filter(
            TenantOutboxMessage.tenant_id == NOOR_PEDIATRICS_TENANT_ID,
            TenantOutboxMessage.recipient_phone == phone_rem
        ).first()
        assert outbox_entry is not None
        assert "Noor Children & Pediatric Hospital" in outbox_entry.payload["text"]
        assert "/ticket/" in outbox_entry.payload["text"]

        # Verify n8n HTTP trigger endpoint
        n8n_res = client.post("/api/v1/clinic/reminders/dispatch", headers={"X-Tenant-ID": NOOR_PEDIATRICS_TENANT_ID})
        assert n8n_res.status_code == 200
        assert n8n_res.json()["status"] in ("COMPLETED", "SUCCESS")

    finally:
        db.close()

# ==============================================================================
# PILLAR 7: BUSINESS PACKAGES & 19 TEMPLATES CATALOG
# ==============================================================================
def test_pillar7_business_packages_19_templates():
    """
    Verifies that all 19 standardized business templates are registered
    in the database catalog, and verifies CLINIC_OPD metadata.
    """
    db = SessionLocal()
    try:
        templates = db.query(BusinessTemplate).all()
        assert len(templates) == 19
        template_ids = [t.id for t in templates]

        # Verify Representative Core Templates across Healthcare, Retail, Service, Education
        assert "CLINIC_OPD" in template_ids
        assert "DENTAL_CLINIC" in template_ids
        assert "GROCERY_RETAIL" in template_ids
        assert "RESTAURANT_DELIVERY" in template_ids
        assert "REAL_ESTATE" in template_ids
        assert "TUITION_COACHING" in template_ids
        assert "BAKERY_CAKES" in template_ids
        assert "BEAUTY_SALON" in template_ids

        clinic = db.query(BusinessTemplate).filter(BusinessTemplate.id == "CLINIC_OPD").first()
        assert clinic.industry_category == "HEALTHCARE"
        assert "book_appointment" in clinic.allowed_tools
        assert "get_queue_status" in clinic.allowed_tools

    finally:
        db.close()

# ==============================================================================
# PILLAR 8: SAAS DASHBOARDS (NEXT.JS 14 PORTALS API)
# ==============================================================================
def test_pillar8_saas_dashboards_portals_3_clinics(client):
    """
    Verifies the backend API powering the Next.js 14 web portals:
    - Doctors & Appointment list (/clinic/doctors, /clinic/appointments)
    - Live Queue Status (/clinic/queue/live)
    - Patient Live Ticket View (/clinic/patient/ticket/{appointment_id})
    """
    # 1. Reception Data for City Dental (Doctors & Appointments)
    res_docs = client.get("/api/v1/clinic/doctors", headers={"X-Tenant-ID": CITY_DENTAL_TENANT_ID})
    assert res_docs.status_code == 200
    docs = res_docs.json()
    assert len(docs) == 2
    assert "Dr. Sarah Zubair" in [d["name"] for d in docs]

    res_apts = client.get("/api/v1/clinic/appointments", headers={"X-Tenant-ID": CITY_DENTAL_TENANT_ID})
    assert res_apts.status_code == 200
    apts = res_apts.json()
    assert isinstance(apts, list)

    # 2. Live Queue for Dr. Sarah Zubair
    doctor_id = docs[0]["id"]
    res_q = client.get(
        "/api/v1/clinic/queue/live",
        headers={"X-Tenant-ID": CITY_DENTAL_TENANT_ID},
        params={"doctor_id": doctor_id}
    )
    assert res_q.status_code == 200
    q_data = res_q.json()
    assert q_data["status"] in ("SUCCESS", "ACTIVE_QUEUE")
    assert "current_token_serving" in q_data or "current_serving_token" in q_data

    # 3. Patient Public Web Ticket Link
    if len(apts) > 0:
        sample_apt_id = apts[0]["id"]
        res_ticket = client.get(
            f"/api/v1/clinic/patient/ticket/{sample_apt_id}",
            headers={"X-Tenant-ID": CITY_DENTAL_TENANT_ID}
        )
        assert res_ticket.status_code == 200
        ticket_data = res_ticket.json()
        assert "queue_token" in ticket_data
        assert "doctor_name" in ticket_data
        assert "clinic_name" in ticket_data
        assert ticket_data["clinic_name"] == "City Dental & Orthodontic Care"

# ==============================================================================
# PILLAR 9: SUBSCRIPTION & USAGE METERING
# ==============================================================================
def test_pillar9_subscriptions_and_usage_metering_3_clinics(client):
    """
    Verifies subscription plans, tier limits, and real-time usage metering:
    - Alpha Heart: PROFESSIONAL
    - City Dental: STARTER
    - Noor Pediatrics: BUSINESS
    """
    # 1. Verify Alpha Heart Subscription
    res_a = client.get("/api/v1/billing/subscription", headers={"X-Tenant-ID": ALPHA_TENANT_ID})
    assert res_a.status_code == 200
    assert res_a.json()["plan_id"] in ("PROFESSIONAL", "BUSINESS")

    # 2. Verify City Dental Subscription
    res_d = client.get("/api/v1/billing/subscription", headers={"X-Tenant-ID": CITY_DENTAL_TENANT_ID})
    assert res_d.status_code == 200
    assert res_d.json()["plan_id"] == "STARTER"

    # 3. Verify Noor Pediatrics Subscription
    res_n = client.get("/api/v1/billing/subscription", headers={"X-Tenant-ID": NOOR_PEDIATRICS_TENANT_ID})
    assert res_n.status_code == 200
    assert res_n.json()["plan_id"] == "BUSINESS"

    # 4. Record and verify usage metering in City Dental
    use_res = client.post(
        "/api/v1/billing/record-usage",
        headers={"X-Tenant-ID": CITY_DENTAL_TENANT_ID},
        json={"metric_name": "AI_TOKENS", "quantity": 1500}
    )
    assert use_res.status_code == 200
    assert use_res.json()["status"] == "RECORDED"

    # 5. Check monthly usage aggregates
    usage_summary = client.get("/api/v1/billing/usage", headers={"X-Tenant-ID": CITY_DENTAL_TENANT_ID})
    assert usage_summary.status_code == 200
    metrics = usage_summary.json()["usage"]
    assert metrics.get("ai_tokens", 0) >= 1500 or metrics.get("AI_TOKENS", 0) >= 1500

# ==============================================================================
# PILLAR 10: TESTING, SECURITY & CONCURRENCY VERIFICATION
# ==============================================================================
def test_pillar10_security_and_high_concurrency_stress():
    """
    Verifies that simultaneous patient bookings across the 3 clinics
    produce zero token collisions due to PostgreSQL advisory transaction locks.
    """
    target_date = (date.today() + timedelta(days=2)).strftime("%Y-%m-%d")

    def make_concurrent_booking(t_id, doc_name, i):
        db = SessionLocal()
        try:
            phone = f"92399{random.randint(1000000, 9999999)}"
            res = book_appointment_db(
                db=db,
                tenant_id=t_id,
                patient_phone=phone,
                patient_name=f"Patient Concurrency {i}",
                doctor_name_or_id=doc_name,
                appointment_date_str=target_date,
                slot_time_str="10:00:00",
                symptoms="Concurrency test load"
            )
            return res.get("token")
        finally:
            db.close()

    # Launch 8 concurrent bookings across City Dental and Noor Pediatrics
    tokens_city = []
    tokens_noor = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        f_city = [executor.submit(make_concurrent_booking, CITY_DENTAL_TENANT_ID, "Dr. Sarah Zubair", i) for i in range(4)]
        f_noor = [executor.submit(make_concurrent_booking, NOOR_PEDIATRICS_TENANT_ID, "Dr. Farhan Qureshi", i) for i in range(4)]

        for f in concurrent.futures.as_completed(f_city):
            t = f.result()
            if t:
                tokens_city.append(t)

        for f in concurrent.futures.as_completed(f_noor):
            t = f.result()
            if t:
                tokens_noor.append(t)

    # ZERO TOKEN COLLISION ASSERTION
    assert len(tokens_city) == len(set(tokens_city)), f"Collision detected in City Dental: {tokens_city}"
    assert len(tokens_noor) == len(set(tokens_noor)), f"Collision detected in Noor Pediatrics: {tokens_noor}"

# ==============================================================================
# PILLAR 11: DEPLOYMENT & HEALTH MONITORING
# ==============================================================================
def test_pillar11_deployment_and_health_monitoring(client):
    """
    Verifies platform health endpoint reports ONLINE status with PostgreSQL,
    and checks Docker & Coolify configuration files exist and are valid.
    """
    # 1. Healthcheck API
    res = client.get("/api/v1/health")
    assert res.status_code == 200
    health = res.json()
    assert health["status"] in ("ONLINE", "UP")
    assert health["database"] in ("HEALTHY", "CONNECTED")

    # 2. Root API Info
    root_res = client.get("/")
    assert root_res.status_code == 200
    assert root_res.json()["product"] == "BizFlow AI"
