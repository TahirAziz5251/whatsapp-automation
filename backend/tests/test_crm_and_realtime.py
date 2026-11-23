import pytest
import uuid
import asyncio
from datetime import date, time
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
from app.models.tenant import ChannelConnection
from app.models.contact import PlatformContact
from app.services.clinic_event_broadcaster import broadcaster
from app.services.crm_service import (
    record_audit_event_db,
    list_conversations_db,
    get_conversation_thread_db,
    toggle_ai_pause_db,
    staff_send_message_db,
    update_contact_crm_db,
    list_audit_events_db
)
from app.services.clinic_service import (
    walk_in_entry_db,
    call_next_patient_db,
    start_consultation_db,
    complete_consultation_db,
    delay_broadcast_db,
    get_patient_ticket_db
)

@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client

CLINIC_TENANT_ID = "11111111-1111-1111-1111-111111111111" # Alpha Clinic
BAKERY_TENANT_ID = "22222222-2222-2222-2222-222222222222" # Beta Bakery


# ------------------------------------------------------------------------------
# 1. CRM CONVERSATION INBOX & UNREAD TRACKING
# ------------------------------------------------------------------------------
def test_crm_conversations_listing(client):
    """Verifies that Alpha Clinic can list its conversations with contact info."""
    res = client.get("/api/v1/crm/conversations", headers={"X-Tenant-ID": CLINIC_TENANT_ID})
    assert res.status_code == 200
    convs = res.json()
    assert isinstance(convs, list)
    if len(convs) > 0:
        c = convs[0]
        assert "id" in c
        assert "contact" in c
        assert "ai_paused" in c
        assert "status" in c


def test_crm_cross_tenant_conversations_isolation(client):
    """Verifies that Beta Bakery cannot access Alpha Clinic's conversations."""
    res_clinic = client.get("/api/v1/crm/conversations", headers={"X-Tenant-ID": CLINIC_TENANT_ID})
    assert res_clinic.status_code == 200
    clinic_convs = res_clinic.json()

    res_bakery = client.get("/api/v1/crm/conversations", headers={"X-Tenant-ID": BAKERY_TENANT_ID})
    assert res_bakery.status_code == 200
    bakery_convs = res_bakery.json()

    clinic_ids = {c["id"] for c in clinic_convs}
    bakery_ids = {c["id"] for c in bakery_convs}
    # No overlap
    assert len(clinic_ids.intersection(bakery_ids)) == 0


# ------------------------------------------------------------------------------
# 2. HUMAN TAKEOVER & AI PAUSE/RESUME TOGGLE
# ------------------------------------------------------------------------------
def test_crm_ai_pause_and_resume_lifecycle(client):
    """Tests staff pausing and resuming AI on an active conversation with audit logging."""
    db = SessionLocal()
    try:
        db.execute(text(f"SET app.current_tenant_id = '{CLINIC_TENANT_ID}'"))
        conn = db.query(ChannelConnection).filter(
            ChannelConnection.tenant_id == uuid.UUID(CLINIC_TENANT_ID)
        ).first()

        contact_id = uuid.uuid4()
        conv_id = uuid.uuid4()
        phone = f"92399{uuid.uuid4().hex[:7]}"

        contact = PlatformContact(
            id=contact_id,
            tenant_id=uuid.UUID(CLINIC_TENANT_ID),
            customer_phone=phone,
            full_name="CRM Test Patient",
            tags=["VIP"],
            metadata_={"category": "OPD"}
        )
        db.add(contact)
        db.flush()

        conv = TenantConversation(
            id=conv_id,
            tenant_id=uuid.UUID(CLINIC_TENANT_ID),
            contact_id=contact_id,
            channel_connection_id=conn.id,
            session_key=f"{CLINIC_TENANT_ID}:{phone}",
            status="ACTIVE",
            ai_paused=False
        )
        db.add(conv)
        db.commit()

        # Step 1: Pause AI via API
        pause_res = client.post(
            f"/api/v1/crm/conversations/{conv_id}/pause-ai?staff_user_id=reception_staff_1",
            headers={"X-Tenant-ID": CLINIC_TENANT_ID}
        )
        assert pause_res.status_code == 200
        p_data = pause_res.json()
        assert p_data["ai_paused"] is True
        assert p_data["conversation_id"] == str(conv_id)

        # Verify DB reflection
        db.expire_all()
        check_conv = db.query(TenantConversation).filter(
            TenantConversation.tenant_id == uuid.UUID(CLINIC_TENANT_ID),
            TenantConversation.id == conv_id
        ).first()
        assert check_conv.ai_paused is True

        # Step 2: Resume AI via API
        resume_res = client.post(
            f"/api/v1/crm/conversations/{conv_id}/resume-ai?staff_user_id=reception_staff_1",
            headers={"X-Tenant-ID": CLINIC_TENANT_ID}
        )
        assert resume_res.status_code == 200
        r_data = resume_res.json()
        assert r_data["ai_paused"] is False

        db.expire_all()
        check_conv = db.query(TenantConversation).filter(
            TenantConversation.tenant_id == uuid.UUID(CLINIC_TENANT_ID),
            TenantConversation.id == conv_id
        ).first()
        assert check_conv.ai_paused is False

        # Step 3: Verify Audit Logs were recorded
        audit_res = client.get("/api/v1/crm/audit-events", headers={"X-Tenant-ID": CLINIC_TENANT_ID})
        assert audit_res.status_code == 200
        audit_events = audit_res.json()
        actions = [e["action"] for e in audit_events]
        assert "CONVERSATION_AI_PAUSED" in actions
        assert "CONVERSATION_AI_RESUMED" in actions
    finally:
        db.close()


# ------------------------------------------------------------------------------
# 3. STAFF MANUAL MESSAGE DISPATCH & OUTBOX ENQUEUEING
# ------------------------------------------------------------------------------
def test_crm_staff_send_message_dispatches_to_outbox(client):
    """Tests staff manually dispatching a message to a customer, enqueued in outbox."""
    db = SessionLocal()
    try:
        db.execute(text(f"SET app.current_tenant_id = '{CLINIC_TENANT_ID}'"))
        conn = db.query(ChannelConnection).filter(
            ChannelConnection.tenant_id == uuid.UUID(CLINIC_TENANT_ID)
        ).first()

        contact_id = uuid.uuid4()
        conv_id = uuid.uuid4()
        phone = f"92388{uuid.uuid4().hex[:7]}"

        contact = PlatformContact(
            id=contact_id,
            tenant_id=uuid.UUID(CLINIC_TENANT_ID),
            customer_phone=phone,
            full_name="Manual Message Patient"
        )
        db.add(contact)
        db.flush()

        conv = TenantConversation(
            id=conv_id,
            tenant_id=uuid.UUID(CLINIC_TENANT_ID),
            contact_id=contact_id,
            channel_connection_id=conn.id,
            session_key=f"{CLINIC_TENANT_ID}:{phone}",
            status="PAUSED_FOR_HUMAN",
            ai_paused=True
        )
        db.add(conv)
        db.commit()

        # Send staff message via API
        msg_payload = {
            "message": "Assalam-o-Alaikum! Dr. Tariq is ready to see you now in Room 101.",
            "staff_user_id": "dr_tariq_assistant"
        }
        res = client.post(
            f"/api/v1/crm/conversations/{conv_id}/messages",
            headers={"X-Tenant-ID": CLINIC_TENANT_ID},
            json=msg_payload
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "SUCCESS"
        assert "message_id" in data
        assert data["outbox_enqueued"] is True

        # Verify message exists in tenant_messages as HUMAN_STAFF
        db.expire_all()
        msg = db.query(TenantMessage).filter(
            TenantMessage.tenant_id == uuid.UUID(CLINIC_TENANT_ID),
            TenantMessage.id == uuid.UUID(data["message_id"])
        ).first()
        assert msg is not None
        assert msg.sender_type == "HUMAN_STAFF"
        assert msg.content == msg_payload["message"]

        # Verify outbox message is queued for WhatsApp dispatch
        outbox = db.query(TenantOutboxMessage).filter(
            TenantOutboxMessage.tenant_id == uuid.UUID(CLINIC_TENANT_ID),
            TenantOutboxMessage.recipient_phone == phone
        ).first()
        assert outbox is not None
        assert outbox.status == "PENDING"
        assert outbox.payload["text"] == msg_payload["message"]
    finally:
        db.close()


# ------------------------------------------------------------------------------
# 4. CUSTOMER CONTACT TAGGING & CRM NOTES
# ------------------------------------------------------------------------------
def test_crm_contact_update_notes_and_tags(client):
    """Tests updating contact tags and CRM notes via API."""
    db = SessionLocal()
    try:
        db.execute(text(f"SET app.current_tenant_id = '{CLINIC_TENANT_ID}'"))
        contact_id = uuid.uuid4()
        phone = f"92377{uuid.uuid4().hex[:7]}"

        contact = PlatformContact(
            id=contact_id,
            tenant_id=uuid.UUID(CLINIC_TENANT_ID),
            customer_phone=phone,
            full_name="Tag Test Patient"
        )
        db.add(contact)
        db.commit()

        update_payload = {
            "full_name": "Tag Test Patient Updated",
            "tags": ["ALLERGY", "PRIORITY"],
            "metadata": {"notes": "Patient has severe dust allergy. High priority."}
        }
        res = client.patch(
            f"/api/v1/crm/contacts/{contact_id}",
            headers={"X-Tenant-ID": CLINIC_TENANT_ID},
            json=update_payload
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "SUCCESS"
        assert "ALLERGY" in data["tags"]
        assert "PRIORITY" in data["tags"]
        assert data["metadata"]["notes"] == update_payload["metadata"]["notes"]

        # Verify cross-tenant isolation: Bakery cannot update Clinic's contact
        res_cross = client.patch(
            f"/api/v1/crm/contacts/{contact_id}",
            headers={"X-Tenant-ID": BAKERY_TENANT_ID},
            json={"full_name": "Hacked Name"}
        )
        assert res_cross.status_code == 404
    finally:
        db.close()


# ------------------------------------------------------------------------------
# 5. RECEPTION WALK-IN ENTRY & CHECK-IN
# ------------------------------------------------------------------------------
def test_clinic_walk_in_entry_creates_appointment_and_queue(client):
    """Tests Reception walk-in entry generating an appointment, live token, and queue entry."""
    res_docs = client.get("/api/v1/clinic/doctors", headers={"X-Tenant-ID": CLINIC_TENANT_ID})
    doctor_id = res_docs.json()[0]["id"]

    walk_in_payload = {
        "patient_name": "Walkin Asad Khan",
        "patient_phone": f"92366{uuid.uuid4().hex[:7]}",
        "doctor_id": doctor_id,
        "symptoms": "Severe headache and fever"
    }

    res = client.post(
        "/api/v1/clinic/walk-in",
        headers={"X-Tenant-ID": CLINIC_TENANT_ID},
        json=walk_in_payload
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "CHECKED_IN"
    assert "queue_token" in data
    assert "appointment_id" in data
    assert "is_walk_in" in data
    assert data["patient_name"] == walk_in_payload["patient_name"]

    # Verify patient ticket can be queried immediately using the appointment_id
    t_res = client.get(
        f"/api/v1/clinic/patient/ticket/{data['appointment_id']}",
        headers={"X-Tenant-ID": CLINIC_TENANT_ID}
    )
    assert t_res.status_code == 200
    ticket = t_res.json()
    assert ticket["queue_token"] == data["queue_token"]
    assert ticket["status"] == "CHECKED_IN"
    assert "estimated_wait_minutes" in ticket


# ------------------------------------------------------------------------------
# 6. DOCTOR QUEUE WORKFLOW: CALL NEXT, START, COMPLETE
# ------------------------------------------------------------------------------
def test_clinic_doctor_queue_lifecycle(client):
    """Tests Doctor's workflow: Call Next -> Start Consultation -> Complete Consultation."""
    res_docs = client.get("/api/v1/clinic/doctors", headers={"X-Tenant-ID": CLINIC_TENANT_ID})
    doctor_id = res_docs.json()[0]["id"]

    # Add a walk-in patient to ensure queue has someone waiting
    walk_in = client.post(
        "/api/v1/clinic/walk-in",
        headers={"X-Tenant-ID": CLINIC_TENANT_ID},
        json={
            "patient_name": "Doctor Queue Test",
            "patient_phone": f"92355{uuid.uuid4().hex[:7]}",
            "doctor_id": doctor_id
        }
    ).json()
    app_id = walk_in["appointment_id"]

    # 1. Doctor calls next patient
    call_res = client.post(
        "/api/v1/clinic/doctor/call-next",
        headers={"X-Tenant-ID": CLINIC_TENANT_ID},
        json={"doctor_id": doctor_id}
    )
    assert call_res.status_code == 200
    called = call_res.json()
    assert called["status"] == "PATIENT_CALLED"
    called_app_id = called["appointment_id"]

    # 2. Doctor starts consultation
    start_res = client.post(
        "/api/v1/clinic/doctor/start-consultation",
        headers={"X-Tenant-ID": CLINIC_TENANT_ID},
        json={"appointment_id": called_app_id}
    )
    assert start_res.status_code == 200
    started = start_res.json()
    assert started["status"] == "IN_CONSULTATION"

    # 3. Doctor completes consultation
    comp_res = client.post(
        "/api/v1/clinic/doctor/complete-consultation",
        headers={"X-Tenant-ID": CLINIC_TENANT_ID},
        json={
            "appointment_id": called_app_id,
            "notes": "Prescribed Panadol 500mg TDS for 3 days. Advised complete rest."
        }
    )
    assert comp_res.status_code == 200
    completed = comp_res.json()
    assert completed["status"] == "COMPLETED"


# ------------------------------------------------------------------------------
# 7. DELAY BROADCAST NOTIFICATIONS
# ------------------------------------------------------------------------------
def test_clinic_delay_broadcast(client):
    """Tests broadcasting a delay to patients waiting for a doctor."""
    res_docs = client.get("/api/v1/clinic/doctors", headers={"X-Tenant-ID": CLINIC_TENANT_ID})
    doctor_id = res_docs.json()[0]["id"]

    delay_payload = {
        "doctor_id": doctor_id,
        "delay_minutes": 25,
        "reason": "Emergency surgery in progress"
    }

    res = client.post(
        "/api/v1/clinic/queue/delay-broadcast",
        headers={"X-Tenant-ID": CLINIC_TENANT_ID},
        json=delay_payload
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "DELAY_BROADCASTED"
    assert data["delay_minutes"] == 25
    assert "patients_notified_count" in data


# ------------------------------------------------------------------------------
# 8. REAL-TIME EVENT BROADCASTER
# ------------------------------------------------------------------------------
def test_realtime_clinic_broadcaster():
    """Verifies that broadcaster registers queues and streams events."""
    async def _run():
        queue = broadcaster.subscribe(CLINIC_TENANT_ID)
        try:
            # Broadcast test event
            test_payload = {"action": "TEST_BROADCAST", "timestamp": "2026-11-23T12:00:00Z"}
            await broadcaster.broadcast(CLINIC_TENANT_ID, "TEST_EVENT", test_payload)

            # Retrieve message from queue
            event = await queue.get()
            assert event["event"] == "TEST_EVENT"
            assert event["data"]["action"] == "TEST_BROADCAST"
        finally:
            broadcaster.unsubscribe(CLINIC_TENANT_ID, queue)

    asyncio.run(_run())
