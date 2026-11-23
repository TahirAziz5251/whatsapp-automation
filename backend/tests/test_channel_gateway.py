import uuid
import pytest
from app.models.tenant import ChannelConnection

def test_meta_webhook_challenge(client):
    """Verifies Meta Webhook challenge verification for developer onboarding."""
    response = client.get(
        "/api/v1/channels/whatsapp/meta",
        params={
            "hub.mode": "subscribe",
            "hub.challenge": "challenge_code_998877",
            "hub.verify_token": "dev_verify_token"
        }
    )
    assert response.status_code == 200
    assert response.text == "challenge_code_998877"

def test_evolution_webhook_normalizes_and_persists(client):
    """
    CRITICAL ACCEPTANCE TEST:
    1. Evolution Go webhook delivers incoming message from patient.
    2. Gateway resolves instance 'hospital-assistant' -> Alpha Clinic Tenant (11111111-1111-1111-1111-111111111111).
    3. Normalizes phone to pure digits: 923001234567.
    4. Automatically creates PlatformContact and TenantConversation.
    5. Persists message in TenantMessage.
    """
    test_msg_id = f"MSG_EVO_{uuid.uuid4().hex[:8]}"
    customer_phone = "923451122334"
    
    payload = {
        "event": "messages.upsert",
        "instanceName": "hospital-assistant",
        "data": {
            "ID": test_msg_id,
            "IsFromMe": False,
            "Info": {
                "Sender": f"{customer_phone}@s.whatsapp.net",
                "PushName": "Ahmed Khan",
                "Chat": f"{customer_phone}@s.whatsapp.net"
            },
            "Message": {
                "conversation": "Hello, I want to book an appointment with Dr. Tariq"
            }
        }
    }

    # Step 1: Send Inbound Webhook
    response = client.post("/api/v1/channels/whatsapp/evolution", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "PROCESSED"
    assert data["tenant_id"] == "11111111-1111-1111-1111-111111111111"
    assert data["customer_phone"] == customer_phone
    assert data["push_name"] == "Ahmed Khan"
    assert "Dr. Tariq" in data["text"]

    # Step 2: Verify Contact was Created under Alpha Clinic Tenant via Contacts API
    contacts_resp = client.get(
        "/api/v1/contacts/",
        headers={"X-Tenant-ID": "11111111-1111-1111-1111-111111111111"}
    )
    assert contacts_resp.status_code == 200
    contacts = contacts_resp.json()
    match = [c for c in contacts if c["customer_phone"] == customer_phone]
    assert len(match) == 1
    assert match[0]["full_name"] == "Ahmed Khan"

def test_evolution_webhook_deduplication(client):
    """
    Verifies that duplicate webhook deliveries are safely dropped idempotently.
    """
    duplicate_msg_id = f"DUP_{uuid.uuid4().hex[:8]}"
    payload = {
        "event": "messages.upsert",
        "instanceName": "hospital-assistant",
        "data": {
            "ID": duplicate_msg_id,
            "IsFromMe": False,
            "Info": {
                "Sender": "923115544332@s.whatsapp.net",
                "PushName": "Duplicate Test",
                "Chat": "923115544332@s.whatsapp.net"
            },
            "Message": {
                "conversation": "Testing duplicate delivery"
            }
        }
    }

    # First send -> PROCESSED
    resp1 = client.post("/api/v1/channels/whatsapp/evolution", json=payload)
    assert resp1.status_code == 200
    assert resp1.json()["status"] == "PROCESSED"

    # Second send (Replay) -> DUPLICATE_DROPPED
    resp2 = client.post("/api/v1/channels/whatsapp/evolution", json=payload)
    assert resp2.status_code == 200
    assert resp2.json()["status"] == "DUPLICATE_DROPPED"
    assert resp2.json()["message_id"] == duplicate_msg_id

def test_unmapped_instance_cleanly_rejected(client):
    """Verifies that webhooks from unknown or unmapped WhatsApp instances are rejected."""
    payload = {
        "event": "messages.upsert",
        "instanceName": "unknown-nonexistent-instance",
        "data": {
            "ID": "MSG_999",
            "IsFromMe": False,
            "Info": {"Sender": "923000000000@s.whatsapp.net"},
            "Message": {"conversation": "Hi"}
        }
    }
    response = client.post("/api/v1/channels/whatsapp/evolution", json=payload)
    assert response.status_code == 200
    assert response.json()["status"] == "UNMAPPED_CONNECTION"

def test_self_sent_and_group_messages_ignored(client):
    """Verifies that self-sent (IsFromMe: true) and group (@g.us) messages are safely ignored."""
    # 1. Self message
    self_payload = {
        "event": "messages.upsert",
        "instanceName": "hospital-assistant",
        "data": {
            "ID": "SELF_123",
            "IsFromMe": True,
            "Message": {"conversation": "Outgoing reply from business"}
        }
    }
    resp_self = client.post("/api/v1/channels/whatsapp/evolution", json=self_payload)
    assert resp_self.status_code == 200
    assert resp_self.json()["status"] == "IGNORED"

    # 2. Group chat message
    group_payload = {
        "event": "messages.upsert",
        "instanceName": "hospital-assistant",
        "data": {
            "ID": "GRP_123",
            "IsFromMe": False,
            "Info": {
                "Chat": "1234567890-987654@g.us",
                "IsGroup": True
            },
            "Message": {"conversation": "Group notification"}
        }
    }
    resp_grp = client.post("/api/v1/channels/whatsapp/evolution", json=group_payload)
    assert resp_grp.status_code == 200
    assert resp_grp.json()["status"] == "IGNORED"

def test_outbox_message_lifecycle(client, db_session):
    """
    Verifies Outbox pattern:
    1. Enqueue outbound message into tenant_outbox_messages.
    2. Outbox is created with status PENDING.
    """
    tenant_id = "11111111-1111-1111-1111-111111111111" # Alpha Clinic
    connection = db_session.query(ChannelConnection).filter(
        ChannelConnection.tenant_id == tenant_id
    ).first()
    assert connection is not None

    enqueue_resp = client.post(
        f"/api/v1/channels/outbox/enqueue?tenant_id={tenant_id}",
        json={
            "recipient_phone": "923001234567",
            "text": "Your appointment is confirmed for Monday at 10:30 AM",
            "channel_connection_id": str(connection.id)
        }
    )
    assert enqueue_resp.status_code == 200
    data = enqueue_resp.json()
    assert data["status"] == "ENQUEUED"
    assert data["status_state"] == "PENDING"
    assert "outbox_id" in data
