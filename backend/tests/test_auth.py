import uuid
import pytest

def test_user_registration_and_login(client):
    unique_email = f"user_{uuid.uuid4().hex[:8]}@bizflow.ai"
    password = "SuperSecurePassword123!"

    # 1. Register User
    reg_resp = client.post(
        "/api/v1/auth/register",
        json={
            "email": unique_email,
            "password": password,
            "full_name": "Tahir Aziz",
            "phone": "+923001234567"
        }
    )
    assert reg_resp.status_code == 201
    user_data = reg_resp.json()
    assert user_data["email"] == unique_email
    assert user_data["full_name"] == "Tahir Aziz"

    # 2. Login with correct password
    login_resp = client.post(
        "/api/v1/auth/login",
        data={
            "username": unique_email,
            "password": password
        }
    )
    assert login_resp.status_code == 200
    token_data = login_resp.json()
    assert "access_token" in token_data
    assert token_data["token_type"] == "bearer"

    # 3. Login with incorrect password -> MUST return 401
    bad_login = client.post(
        "/api/v1/auth/login",
        data={
            "username": unique_email,
            "password": "WrongPassword!"
        }
    )
    assert bad_login.status_code == 401
    assert "Incorrect email or password" in bad_login.json()["detail"]
