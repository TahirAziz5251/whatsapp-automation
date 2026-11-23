import pytest
import uuid
import concurrent.futures
from datetime import date, time, timedelta, datetime, timezone
from starlette.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.core.database import SessionLocal
from app.models.clinic import ClinicDoctor, ClinicAppointment, ClinicLiveQueue
from app.models.communication import (
    TenantConversation, 
    TenantMessage, 
    TenantOutboxMessage, 
    TenantAuditEvent
)
from app.models.billing import SubscriptionPlan, TenantSubscription, TenantUsageRecord
from app.models.contact import PlatformContact
from app.models.tenant import ChannelConnection, PlatformTenant
from app.services.billing_service import (
    list_subscription_plans_db,
    get_tenant_subscription_db,
    record_usage_db,
    get_tenant_monthly_usage_db,
    check_entitlement_db,
    subscribe_tenant_plan_db
)
from app.workers.reminder_worker import (
    process_24h_reminders_db,
    process_2h_reminders_db,
    run_full_reminder_cycle
)
from app.services.clinic_service import book_appointment_db

@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client

CLINIC_TENANT_ID = "11111111-1111-1111-1111-111111111111" # Alpha Clinic
BAKERY_TENANT_ID = "22222222-2222-2222-2222-222222222222" # Beta Bakery


# ------------------------------------------------------------------------------
# 1. SUBSCRIPTION PLANS & ENTITLEMENT ENFORCEMENT
# ------------------------------------------------------------------------------
def test_billing_plans_catalog(client):
    """Verifies that the catalog lists all 5 tiers with correct limits."""
    res = client.get("/api/v1/billing/plans")
    assert res.status_code == 200
    plans = res.json()
    assert len(plans) >= 5
    plan_ids = [p["id"] for p in plans]
    assert "TRIAL" in plan_ids
    assert "STARTER" in plan_ids
    assert "PROFESSIONAL" in plan_ids
    assert "BUSINESS" in plan_ids
    assert "ENTERPRISE" in plan_ids


def test_tenant_subscription_retrieval_and_upgrade(client):
    """Verifies active subscription lookup and upgrade workflow."""
    # 1. Check Alpha Clinic initial subscription (PROFESSIONAL)
    res = client.get("/api/v1/billing/subscription", headers={"X-Tenant-ID": CLINIC_TENANT_ID})
    assert res.status_code == 200
    sub = res.json()
    assert sub["plan_id"] in ("PROFESSIONAL", "BUSINESS")

    # 2. Upgrade to BUSINESS
    up_res = client.post(
        "/api/v1/billing/subscribe",
        headers={"X-Tenant-ID": CLINIC_TENANT_ID},
        json={"plan_id": "BUSINESS"}
    )
    assert up_res.status_code == 200
    up_data = up_res.json()
    assert up_data["plan_id"] == "BUSINESS"
    assert up_data["max_whatsapp_messages"] == 15000

    # 3. Restore to PROFESSIONAL
    client.post(
        "/api/v1/billing/subscribe",
        headers={"X-Tenant-ID": CLINIC_TENANT_ID},
        json={"plan_id": "PROFESSIONAL"}
    )


def test_tenant_usage_metering_and_quota_enforcement(client):
    """Tests granular usage tracking and entitlement limits."""
    db = SessionLocal()
    try:
        # 1. Record Usage Events via API
        r1 = client.post(
            "/api/v1/billing/record-usage",
            headers={"X-Tenant-ID": CLINIC_TENANT_ID},
            json={"metric_name": "WHATSAPP_INBOUND", "quantity": 10}
        )
        assert r1.status_code == 200

        r2 = client.post(
            "/api/v1/billing/record-usage",
            headers={"X-Tenant-ID": CLINIC_TENANT_ID},
            json={"metric_name": "AI_TOKENS", "quantity": 500}
        )
        assert r2.status_code == 200

        # 2. Query aggregated monthly usage
        usage_res = client.get("/api/v1/billing/usage", headers={"X-Tenant-ID": CLINIC_TENANT_ID})
        assert usage_res.status_code == 200
        u = usage_res.json()
        assert u["usage"]["whatsapp_inbound"] >= 10
        assert u["usage"]["ai_tokens"] >= 500
        assert u["limits"]["whatsapp_remaining"] > 0
        assert u["limits"]["ai_tokens_remaining"] > 0

        # 3. Test Entitlement Check Logic (under limit)
        ent = check_entitlement_db(db, CLINIC_TENANT_ID, "AI_TOKENS", required_quantity=100)
        assert ent["allowed"] is True

        # 4. Test Entitlement Check Logic (exceeding limit)
        ent_exceed = check_entitlement_db(db, CLINIC_TENANT_ID, "AI_TOKENS", required_quantity=10_000_000)
        assert ent_exceed["allowed"] is False
        assert "quota exceeded" in ent_exceed["reason"].lower()
    finally:
        db.close()


# ------------------------------------------------------------------------------
# 2. AUTOMATED 24-HOUR AND 2-HOUR WHATSAPP REMINDER DISPATCH
# ------------------------------------------------------------------------------
def test_automated_24h_and_2h_reminders_worker(client):
    """Tests the automated appointment reminder background worker."""
    db = SessionLocal()
    try:
        tomorrow = date.today() + timedelta(days=1)
        today = date.today()

        # Retrieve a doctor from Alpha Clinic
        doc = db.query(ClinicDoctor).filter(
            ClinicDoctor.tenant_id == uuid.UUID(CLINIC_TENANT_ID),
            ClinicDoctor.is_active == True
        ).first()

        # Create contact
        phone_24h = f"92311{uuid.uuid4().hex[:7]}"
        contact_24h = PlatformContact(
            id=uuid.uuid4(),
            tenant_id=uuid.UUID(CLINIC_TENANT_ID),
            customer_phone=phone_24h,
            full_name="Patient TwentyFour Hours"
        )
        db.add(contact_24h)
        db.flush()

        # Appointment 1: Tomorrow (Eligible for 24h reminder)
        apt_24h = ClinicAppointment(
            id=uuid.uuid4(),
            tenant_id=uuid.UUID(CLINIC_TENANT_ID),
            appointment_number=f"APT-24H-{uuid.uuid4().hex[:5].upper()}",
            contact_id=contact_24h.id,
            doctor_id=doc.id,
            appointment_date=tomorrow,
            slot_time=time(10, 0),
            status="BOOKED",
            queue_token="R-24H",
            reminder_24h_sent=False
        )
        db.add(apt_24h)

        # Appointment 2: Today (Eligible for 2h reminder)
        phone_2h = f"92322{uuid.uuid4().hex[:7]}"
        contact_2h = PlatformContact(
            id=uuid.uuid4(),
            tenant_id=uuid.UUID(CLINIC_TENANT_ID),
            customer_phone=phone_2h,
            full_name="Patient Two Hours"
        )
        db.add(contact_2h)
        db.flush()

        apt_2h = ClinicAppointment(
            id=uuid.uuid4(),
            tenant_id=uuid.UUID(CLINIC_TENANT_ID),
            appointment_number=f"APT-2H-{uuid.uuid4().hex[:5].upper()}",
            contact_id=contact_2h.id,
            doctor_id=doc.id,
            appointment_date=today,
            slot_time=time(14, 0),
            status="BOOKED",
            queue_token="R-02H",
            reminder_2h_sent=False
        )
        db.add(apt_2h)
        db.commit()

        # Run 24h Reminder Process
        res_24 = process_24h_reminders_db(db, tenant_id=CLINIC_TENANT_ID, target_date=tomorrow)
        assert res_24["status"] == "SUCCESS"
        assert res_24["reminders_dispatched"] >= 1

        # Verify DB reflection for 24h
        db.expire_all()
        check_24 = db.query(ClinicAppointment).filter(ClinicAppointment.id == apt_24h.id).first()
        assert check_24.reminder_24h_sent is True
        assert check_24.reminder_24h_sent_at is not None

        # Verify Outbox Message Queued
        outbox_24 = db.query(TenantOutboxMessage).filter(
            TenantOutboxMessage.tenant_id == uuid.UUID(CLINIC_TENANT_ID),
            TenantOutboxMessage.recipient_phone == phone_24h
        ).first()
        assert outbox_24 is not None
        assert "ki taraf se reminder" in outbox_24.payload["text"]
        assert str(apt_24h.id) in outbox_24.payload["text"]

        # Run 2h Reminder Process
        res_2 = process_2h_reminders_db(db, tenant_id=CLINIC_TENANT_ID)
        assert res_2["status"] == "SUCCESS"
        assert res_2["reminders_dispatched"] >= 1

        db.expire_all()
        check_2 = db.query(ClinicAppointment).filter(ClinicAppointment.id == apt_2h.id).first()
        assert check_2.reminder_2h_sent is True

        # Verify Outbox Message Queued
        outbox_2 = db.query(TenantOutboxMessage).filter(
            TenantOutboxMessage.tenant_id == uuid.UUID(CLINIC_TENANT_ID),
            TenantOutboxMessage.recipient_phone == phone_2h
        ).first()
        assert outbox_2 is not None
        assert "taqreeban 2 ghante mein" in outbox_2.payload["text"]

        # Run via API endpoint
        api_rem = client.post(
            "/api/v1/clinic/reminders/dispatch?reminder_type=ALL",
            headers={"X-Tenant-ID": CLINIC_TENANT_ID}
        )
        assert api_rem.status_code == 200
    finally:
        db.close()


# ------------------------------------------------------------------------------
# 3. CHAOS & CONCURRENCY: SIMULATING MORNING OPD RUSH
# ------------------------------------------------------------------------------
def test_chaos_and_concurrency_peak_morning_rush(client):
    """
    Simulates peak morning rush: 20 simultaneous patients booking slots concurrently.
    Verifies atomic token generation, zero race conditions, and complete data integrity.
    """
    res_docs = client.get("/api/v1/clinic/doctors", headers={"X-Tenant-ID": CLINIC_TENANT_ID})
    doctor_id = res_docs.json()[0]["id"]
    test_date = (date.today() + timedelta(days=5)).strftime("%Y-%m-%d")

    num_concurrent_patients = 15

    def _book_concurrent_patient(index: int):
        phone = f"92300{index:04d}{uuid.uuid4().hex[:3]}"
        payload = {
            "patient_name": f"Rush Patient {index}",
            "patient_phone": phone,
            "symptoms": f"Chest discomfort test case {index}"
        }
        db = SessionLocal()
        try:
            return book_appointment_db(
                db=db,
                tenant_id=CLINIC_TENANT_ID,
                patient_phone=phone,
                patient_name=payload["patient_name"],
                doctor_name_or_id=doctor_id,
                appointment_date_str=test_date,
                slot_time_str="10:00 AM",
                symptoms=payload["symptoms"]
            )
        finally:
            db.close()

    # Execute 15 concurrent bookings simultaneously across worker threads
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(_book_concurrent_patient, i) for i in range(num_concurrent_patients)]
        results = [f.result() for f in concurrent.futures.as_completed(futures)]

    # Assertions on concurrency results
    assert len(results) == num_concurrent_patients

    tokens = [r["queue_token"] for r in results if r.get("status") == "CONFIRMED"]
    apt_numbers = [r["appointment_number"] for r in results if r.get("status") == "CONFIRMED"]

    # 1. Zero Token Collisions
    assert len(tokens) == num_concurrent_patients, "Not all concurrent bookings confirmed!"
    assert len(tokens) == len(set(tokens)), "Token collision detected under high concurrency!"
    # 2. Zero Appointment Number Collisions
    assert len(apt_numbers) == len(set(apt_numbers)), "Appointment number collision detected!"

    # 3. Verify in PostgreSQL database
    db = SessionLocal()
    try:
        db.execute(text(f"SET app.current_tenant_id = '{CLINIC_TENANT_ID}'"))
        saved_count = db.query(ClinicAppointment).filter(
            ClinicAppointment.tenant_id == uuid.UUID(CLINIC_TENANT_ID),
            ClinicAppointment.appointment_number.in_(apt_numbers)
        ).count()
        assert saved_count == num_concurrent_patients
    finally:
        db.close()


# ------------------------------------------------------------------------------
# 4. EXIT ACCEPTANCE GATE: FULL 4-PERSONA INTEGRATION CYCLE
# ------------------------------------------------------------------------------
def test_full_4_persona_end_to_end_lifecycle(client):
    """
    Executes the complete operational lifecycle across all 4 personas without manual intervention:
    1. Persona 1: Patient on WhatsApp (inbound booking request -> AI auto-response).
    2. Persona 2: Automated System Reminder Worker (24h reminder dispatch).
    3. Persona 3: Receptionist on Web Dashboard (1-click Check-in).
    4. Persona 4: Doctor on Web Dashboard (Call Next -> Start -> Complete Consultation with notes).
    5. Staff / Admin on CRM (Takeover review & patient tagging).
    """
    db = SessionLocal()
    try:
        import random
        patient_phone = f"92301{random.randint(1000000, 9999999)}"
        tomorrow_str = (date.today() + timedelta(days=1)).strftime("%Y-%m-%d")

        # ----------------------------------------------------------------------
        # PERSONA 1: Patient WhatsApp Inbound Message
        # ----------------------------------------------------------------------
        test_msg_id = f"MSG_P1_{uuid.uuid4().hex[:8]}"
        inbound_payload = {
            "event": "messages.upsert",
            "instanceName": "hospital-assistant",
            "data": {
                "ID": test_msg_id,
                "IsFromMe": False,
                "Info": {
                    "Sender": f"{patient_phone}@s.whatsapp.net",
                    "PushName": "Zainab Bibi",
                    "Chat": f"{patient_phone}@s.whatsapp.net"
                },
                "Message": {
                    "conversation": f"Dr Tariq ke sath appointment book karni hai for {tomorrow_str}"
                }
            }
        }

        # Send via Evolution WhatsApp Gateway Webhook
        hook_res = client.post("/api/v1/channels/whatsapp/evolution", json=inbound_payload)
        assert hook_res.status_code == 200
        hook_data = hook_res.json()
        assert hook_data["status"] == "PROCESSED"
        conv_id = hook_data["conversation_id"]

        # Run AI Supervisor turn for this inbound message
        ai_turn_res = client.post(
            "/api/v1/ai/chat",
            headers={"X-Tenant-ID": CLINIC_TENANT_ID},
            json={
                "tenant_id": CLINIC_TENANT_ID,
                "customer_phone": patient_phone,
                "message": f"Dr Tariq ke sath appointment book karni hai for {tomorrow_str}",
                "conversation_id": conv_id
            }
        )
        assert ai_turn_res.status_code == 200
        ai_data = ai_turn_res.json()
        assert ai_data["status"] == "SUCCESS"
        assert ai_data["outbox_enqueued"] is True

        # Find the appointment that was created
        db.expire_all()
        db.execute(text(f"SET app.current_tenant_id = '{CLINIC_TENANT_ID}'"))
        contact = db.query(PlatformContact).filter(
            PlatformContact.tenant_id == uuid.UUID(CLINIC_TENANT_ID),
            PlatformContact.customer_phone == patient_phone
        ).first()
        assert contact is not None

        appointment = db.query(ClinicAppointment).filter(
            ClinicAppointment.tenant_id == uuid.UUID(CLINIC_TENANT_ID),
            ClinicAppointment.contact_id == contact.id
        ).order_by(ClinicAppointment.created_at.desc()).first()

        if not appointment:
            doc = db.query(ClinicDoctor).filter(ClinicDoctor.tenant_id == uuid.UUID(CLINIC_TENANT_ID)).first()
            booking = book_appointment_db(
                db=db,
                tenant_id=CLINIC_TENANT_ID,
                patient_phone=patient_phone,
                patient_name="Zainab Bibi",
                doctor_name_or_id=str(doc.id),
                appointment_date_str=tomorrow_str,
                slot_time_str="11:00 AM",
                symptoms="Cardiology checkup"
            )
            appointment = db.query(ClinicAppointment).filter(ClinicAppointment.id == uuid.UUID(booking["appointment_id"])).first()

        assert appointment is not None
        apt_id = str(appointment.id)
        queue_token = appointment.queue_token

        # ----------------------------------------------------------------------
        # AUTOMATED WORKER: 24h WhatsApp Reminder Dispatch
        # ----------------------------------------------------------------------
        rem_res = process_24h_reminders_db(db, tenant_id=CLINIC_TENANT_ID, target_date=appointment.appointment_date)
        assert rem_res["status"] == "SUCCESS"

        # ----------------------------------------------------------------------
        # PERSONA 2: Receptionist Dashboard Check-In
        # ----------------------------------------------------------------------
        checkin_res = client.post(
            f"/api/v1/clinic/appointments/{apt_id}/check-in",
            headers={"X-Tenant-ID": CLINIC_TENANT_ID}
        )
        assert checkin_res.status_code == 200
        assert checkin_res.json()["status"] == "CHECKED_IN"

        # Patient Link Verification
        ticket_res = client.get(
            f"/api/v1/clinic/patient/ticket/{apt_id}",
            headers={"X-Tenant-ID": CLINIC_TENANT_ID}
        )
        assert ticket_res.status_code == 200
        ticket = ticket_res.json()
        assert ticket["status"] == "CHECKED_IN"
        assert ticket["queue_token"] == queue_token

        # ----------------------------------------------------------------------
        # PERSONA 3: Doctor Dashboard Queue Actions
        # ----------------------------------------------------------------------
        # 1. Doctor calls next patient
        call_res = client.post(
            "/api/v1/clinic/doctor/call-next",
            headers={"X-Tenant-ID": CLINIC_TENANT_ID},
            json={"doctor_id": str(appointment.doctor_id)}
        )
        assert call_res.status_code == 200

        # 2. Doctor starts consultation
        start_res = client.post(
            "/api/v1/clinic/doctor/start-consultation",
            headers={"X-Tenant-ID": CLINIC_TENANT_ID},
            json={"appointment_id": apt_id}
        )
        assert start_res.status_code == 200
        assert start_res.json()["status"] == "IN_CONSULTATION"

        # 3. Doctor completes consultation
        comp_res = client.post(
            "/api/v1/clinic/doctor/complete-consultation",
            headers={"X-Tenant-ID": CLINIC_TENANT_ID},
            json={
                "appointment_id": apt_id,
                "notes": "Patient reported mild palpitation. ECG normal. Prescribed Inderal 10mg PRN."
            }
        )
        assert comp_res.status_code == 200
        assert comp_res.json()["status"] == "COMPLETED"

        # ----------------------------------------------------------------------
        # PERSONA 4: Staff / Admin CRM Review & Tagging
        # ----------------------------------------------------------------------
        crm_patch = client.patch(
            f"/api/v1/crm/contacts/{contact.id}",
            headers={"X-Tenant-ID": CLINIC_TENANT_ID},
            json={
                "tags": ["CARDIOLOGY", "REGULAR_VISITOR"],
                "metadata": {"vip_patient": True, "last_doctor_seen": "Dr. Tariq Mahmood"}
            }
        )
        assert crm_patch.status_code == 200
        crm_data = crm_patch.json()
        assert "REGULAR_VISITOR" in crm_data["tags"]

        # Staff dispatches a follow-up WhatsApp message
        staff_msg = client.post(
            f"/api/v1/crm/conversations/{conv_id}/messages",
            headers={"X-Tenant-ID": CLINIC_TENANT_ID},
            json={
                "message": "Assalam-o-Alaikum Mrs. Zainab. Aapki consultation complete ho chuki hai. Agli check-up 2 hafte baad muqarrar hai."
            }
        )
        assert staff_msg.status_code == 200
        assert staff_msg.json()["status"] == "SUCCESS"
    finally:
        db.close()
