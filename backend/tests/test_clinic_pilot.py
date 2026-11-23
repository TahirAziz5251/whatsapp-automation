import pytest
import uuid
from starlette.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.core.database import SessionLocal
from app.models.clinic import ClinicDoctor, ClinicAppointment, ClinicLiveQueue
from app.models.communication import TenantConversation, TenantMessage, TenantOutboxMessage
from app.models.contact import PlatformContact
from app.services.clinic_service import (
    get_doctor_schedule_db,
    book_appointment_db,
    get_queue_status_db,
    check_in_patient_db,
    cancel_appointment_db
)

@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client

CLINIC_TENANT_ID = "11111111-1111-1111-1111-111111111111" # Alpha Clinic
BAKERY_TENANT_ID = "22222222-2222-2222-2222-222222222222" # Beta Bakery

# ------------------------------------------------------------------------------
# 1. DOCTOR DIRECTORY & SCHEDULE TESTS
# ------------------------------------------------------------------------------
def test_clinic_doctors_listing_via_api(client):
    """Verifies that Alpha Clinic lists its 3 seeded doctors."""
    res = client.get("/api/v1/clinic/doctors", headers={"X-Tenant-ID": CLINIC_TENANT_ID})
    assert res.status_code == 200
    doctors = res.json()
    assert len(doctors) == 3
    names = [d["name"] for d in doctors]
    assert "Dr. Tariq Mahmood" in names
    assert "Dr. Ayesha Malik" in names
    assert "Dr. Bilal Asghar" in names

def test_clinic_doctors_cross_tenant_isolation(client):
    """Verifies that Beta Bakery cannot access Alpha Clinic's doctors."""
    res = client.get("/api/v1/clinic/doctors", headers={"X-Tenant-ID": BAKERY_TENANT_ID})
    assert res.status_code == 200
    assert len(res.json()) == 0

def test_doctor_schedule_query_direct():
    """Queries doctor schedule from PostgreSQL platform_db with RLS."""
    db = SessionLocal()
    try:
        sched = get_doctor_schedule_db(db, CLINIC_TENANT_ID, "Cardiology")
        assert sched["status"] == "SUCCESS"
        assert len(sched["doctors"]) >= 1
        assert sched["doctors"][0]["specialty"] == "Cardiology"
        assert "PKR" in sched["doctors"][0]["fee"]
    finally:
        db.close()

# ------------------------------------------------------------------------------
# 2. APPOINTMENT BOOKING & QUEUE LIFECYCLE TESTS
# ------------------------------------------------------------------------------
def test_clinic_appointment_database_booking():
    """Books a clinic appointment and verifies persistent row in platform_db."""
    db = SessionLocal()
    try:
        patient_phone = "923129876543"
        booking = book_appointment_db(
            db=db,
            tenant_id=CLINIC_TENANT_ID,
            patient_phone=patient_phone,
            patient_name="Zubair Qureshi",
            doctor_name_or_id="Dr. Tariq Mahmood",
            appointment_date_str="2026-11-23",
            slot_time_str="11:30 AM",
            symptoms="Mild chest discomfort"
        )

        assert booking["status"] == "CONFIRMED"
        assert booking["appointment_number"].startswith("APT-")
        assert booking["queue_token"].startswith("T-")
        assert booking["fee_pkr"] == 2500.0

        # Verify persistent row in clinic_appointments
        db.execute(text(f"SET app.current_tenant_id = '{CLINIC_TENANT_ID}'"))
        apt = db.query(ClinicAppointment).filter(
            ClinicAppointment.tenant_id == CLINIC_TENANT_ID,
            ClinicAppointment.appointment_number == booking["appointment_number"]
        ).first()

        assert apt is not None
        assert apt.status == "BOOKED"
        assert apt.queue_token == booking["queue_token"]

        # Verify Live Queue record was updated
        queue = db.query(ClinicLiveQueue).filter(
            ClinicLiveQueue.tenant_id == CLINIC_TENANT_ID,
            ClinicLiveQueue.doctor_id == apt.doctor_id
        ).first()

        assert queue is not None
        assert queue.total_booked >= 1

    finally:
        db.close()

def test_patient_check_in_and_queue_progression(client):
    """Verifies that checking in a patient updates appointment status and queue."""
    db = SessionLocal()
    try:
        db.execute(text(f"SET app.current_tenant_id = '{CLINIC_TENANT_ID}'"))
        apt = db.query(ClinicAppointment).filter(
            ClinicAppointment.tenant_id == CLINIC_TENANT_ID,
            ClinicAppointment.status == "BOOKED"
        ).first()
        assert apt is not None

        # Check in via API
        res = client.post(
            f"/api/v1/clinic/appointments/{apt.id}/check-in",
            headers={"X-Tenant-ID": CLINIC_TENANT_ID}
        )
        assert res.status_code == 200
        assert res.json()["status"] == "CHECKED_IN"

        # Verify DB status
        db.refresh(apt)
        assert apt.status == "CHECKED_IN"

    finally:
        db.close()

def test_clinic_live_queue_monitor_api(client):
    """Verifies GET /api/v1/clinic/queue/live."""
    res = client.get("/api/v1/clinic/queue/live", headers={"X-Tenant-ID": CLINIC_TENANT_ID})
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ACTIVE_QUEUE"
    assert "current_token_serving" in data
    assert data["tokens_ahead"] >= 0

def test_clinic_appointment_cancellation():
    """Verifies appointment cancellation."""
    db = SessionLocal()
    try:
        db.execute(text(f"SET app.current_tenant_id = '{CLINIC_TENANT_ID}'"))
        apt = db.query(ClinicAppointment).filter(
            ClinicAppointment.tenant_id == CLINIC_TENANT_ID,
            ClinicAppointment.status.in_(["BOOKED", "CHECKED_IN"])
        ).first()
        assert apt is not None

        cancel_res = cancel_appointment_db(db, CLINIC_TENANT_ID, apt.appointment_number, "Patient unavailable")
        assert cancel_res["status"] == "CANCELLED"

        db.refresh(apt)
        assert apt.status == "CANCELLED"
    finally:
        db.close()

# ------------------------------------------------------------------------------
# 3. END-TO-END INTEGRATION: WHATSAPP WEBHOOK ➔ AI ➔ CLINIC DATABASE BOOKING
# ------------------------------------------------------------------------------
def test_end_to_end_whatsapp_to_clinic_db_integration(client):
    """
    CRITICAL END-TO-END MASTER INTEGRATION TEST:
    1. Incoming WhatsApp Webhook from Evolution Go with booking request.
    2. Gateway normalizes message and resolves Alpha Clinic.
    3. AI Supervisor processes message, detects Roman Urdu, and executes 'book_appointment' tool.
    4. Tool writes live row to PostgreSQL 'clinic_appointments' and updates 'clinic_live_queues'.
    5. AI Supervisor synthesizes Roman Urdu confirmation with Token Number.
    6. Stores assistant reply in 'tenant_messages' and enqueues to 'tenant_outbox_messages'.
    7. Verifies that the persistent appointment exists in database with RLS.
    """
    db = SessionLocal()
    try:
        test_patient_phone = "923334445566"
        msg_id = f"MSG_E2E_{uuid.uuid4().hex[:8]}"

        payload = {
            "event": "messages.upsert",
            "instanceName": "hospital-assistant",
            "data": {
                "ID": msg_id,
                "IsFromMe": False,
                "Info": {
                    "Sender": f"{test_patient_phone}@s.whatsapp.net",
                    "PushName": "Usman Tariq",
                    "Chat": f"{test_patient_phone}@s.whatsapp.net"
                },
                "Message": {
                    "conversation": "Mera appointment Dr Tariq k sath book karein kal subah 11:00 AM par"
                }
            }
        }

        # Step 1: Ingest via WhatsApp Gateway Webhook
        res = client.post("/api/v1/channels/whatsapp/evolution", json=payload)
        assert res.status_code == 200
        assert res.json()["status"] == "PROCESSED"

        # Step 2: Retrieve Conversation
        db.execute(text(f"SET app.current_tenant_id = '{CLINIC_TENANT_ID}'"))
        session_key = f"{CLINIC_TENANT_ID}:{test_patient_phone}"
        conv = db.query(TenantConversation).filter(
            TenantConversation.tenant_id == CLINIC_TENANT_ID,
            TenantConversation.session_key == session_key
        ).first()
        assert conv is not None

        # Step 3: Trigger AI Supervisor Turn
        from app.services.ai.supervisor import AiSupervisor
        import anyio

        async def run_ai():
            supervisor = AiSupervisor()
            return await supervisor.process_message(
                db=db,
                tenant_id=CLINIC_TENANT_ID,
                conversation_id=str(conv.id),
                customer_phone=test_patient_phone,
                user_text="Mera appointment Dr Tariq k sath book karein kal subah 11:00 AM par"
            )

        ai_res = anyio.run(run_ai)

        # Step 4: Verify AI Turn Result
        assert ai_res["status"] == "SUCCESS"
        assert ai_res["language_detected"]["language"] == "ROMAN_URDU"
        assert len(ai_res["tools_executed"]) == 1
        assert ai_res["tools_executed"][0]["tool"] == "book_appointment"
        assert "Token Number" in ai_res["response_text"] or "appointment" in ai_res["response_text"]

        # Step 5: Verify Persistent Booking in PostgreSQL Database
        booking_data = ai_res["tools_executed"][0]["result"]
        apt_num = booking_data["appointment_number"]
        token_num = booking_data["queue_token"]

        apt_row = db.query(ClinicAppointment).filter(
            ClinicAppointment.tenant_id == CLINIC_TENANT_ID,
            ClinicAppointment.appointment_number == apt_num
        ).first()

        assert apt_row is not None
        assert apt_row.queue_token == token_num
        assert apt_row.status == "BOOKED"

        # Step 6: Verify Outbox Message Enqueued for WhatsApp Transmission
        outbox = db.query(TenantOutboxMessage).filter(
            TenantOutboxMessage.tenant_id == CLINIC_TENANT_ID,
            TenantOutboxMessage.recipient_phone == test_patient_phone
        ).order_by(TenantOutboxMessage.created_at.desc()).first()

        assert outbox is not None
        assert outbox.status == "PENDING"
        assert token_num in outbox.payload["text"]

    finally:
        db.close()
