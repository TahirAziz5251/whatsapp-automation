import uuid
import pytest

def test_19_templates_available(client):
    """Verifies that all 19 canonical industry templates are seeded and listed."""
    response = client.get("/api/v1/tenants/templates")
    assert response.status_code == 200
    templates = response.json()
    assert len(templates) == 19
    template_ids = {t["id"] for t in templates}
    
    # Verify core templates exist
    assert "CLINIC_OPD" in template_ids
    assert "BEAUTY_SALON" in template_ids
    assert "BAKERY_CAKES" in template_ids
    assert "GROCERY_RETAIL" in template_ids
    assert "DENTAL_CLINIC" in template_ids
    assert "VETERINARY_CLINIC" in template_ids

def test_tenant_creation_via_api(client):
    """Verifies that independent tenant workspaces can be created via API."""
    unique_slug = f"test-salon-{uuid.uuid4().hex[:6]}"
    payload = {
        "slug": unique_slug,
        "name": "Luxury Hair Studio",
        "business_template_id": "BEAUTY_SALON",
        "timezone": "Asia/Karachi",
        "currency": "PKR",
        "settings": {"stylist_count": 4}
    }
    response = client.post("/api/v1/tenants/", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["slug"] == unique_slug
    assert data["name"] == "Luxury Hair Studio"
    assert data["status"] == "ACTIVE"

def test_tenant_isolation_and_non_collision(client, test_tenants):
    """
    CRITICAL ACCEPTANCE TEST:
    1. Tenant A creates contact with phone +923009988776.
    2. Tenant B queries contacts -> MUST return 0 contacts (No data leak!).
    3. Tenant B creates contact with the EXACT SAME phone number -> MUST SUCCEED (Non-collision!).
    4. Tenant A queries contacts -> Sees only its own contact.
    5. Tenant B queries contacts -> Sees only its own contact.
    """
    tenant_a = test_tenants["tenant_a"]
    tenant_b = test_tenants["tenant_b"]
    shared_phone = "923009988776"

    # Step 1: Tenant A creates contact
    resp_a = client.post(
        "/api/v1/contacts/",
        headers={"X-Tenant-ID": tenant_a},
        json={
            "customer_phone": shared_phone,
            "full_name": "Tahir (Patient of Clinic A)",
            "push_name": "Tahir"
        }
    )
    assert resp_a.status_code == 201
    contact_a = resp_a.json()
    assert contact_a["customer_phone"] == shared_phone
    assert contact_a["tenant_id"] == tenant_a

    # Step 2: Tenant B queries contacts -> MUST return 0 (Cross-tenant leak prevention)
    list_b = client.get("/api/v1/contacts/", headers={"X-Tenant-ID": tenant_b})
    assert list_b.status_code == 200
    b_contacts = list_b.json()
    # Tenant B must NOT see Tenant A's contact
    assert len([c for c in b_contacts if c["customer_phone"] == shared_phone]) == 0

    # Step 3: Tenant B creates contact with the EXACT SAME phone number
    resp_b = client.post(
        "/api/v1/contacts/",
        headers={"X-Tenant-ID": tenant_b},
        json={
            "customer_phone": shared_phone,
            "full_name": "Tahir (Customer of Bakery B)",
            "push_name": "Tahir"
        }
    )
    assert resp_b.status_code == 201
    contact_b = resp_b.json()
    assert contact_b["customer_phone"] == shared_phone
    assert contact_b["tenant_id"] == tenant_b

    # Step 4: Verify complete isolation in Tenant A
    final_a = client.get("/api/v1/contacts/", headers={"X-Tenant-ID": tenant_a})
    assert final_a.status_code == 200
    contacts_in_a = final_a.json()
    match_a = [c for c in contacts_in_a if c["customer_phone"] == shared_phone]
    assert len(match_a) == 1
    assert match_a[0]["full_name"] == "Tahir (Patient of Clinic A)"

    # Step 5: Verify complete isolation in Tenant B
    final_b = client.get("/api/v1/contacts/", headers={"X-Tenant-ID": tenant_b})
    assert final_b.status_code == 200
    contacts_in_b = final_b.json()
    match_b = [c for c in contacts_in_b if c["customer_phone"] == shared_phone]
    assert len(match_b) == 1
    assert match_b[0]["full_name"] == "Tahir (Customer of Bakery B)"

def test_invalid_tenant_header_rejected(client):
    """Verifies that requests without valid UUID tenant header are rejected."""
    response = client.get("/api/v1/contacts/", headers={"X-Tenant-ID": "invalid-uuid"})
    assert response.status_code == 400
    assert "Invalid X-Tenant-ID" in response.json()["detail"]
