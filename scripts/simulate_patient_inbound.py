"""
Simulate Dynamic Patient Inbound WhatsApp Message
-------------------------------------------------
In live production, Evolution Go automatically receives incoming WhatsApp packets
from WhatsApp's servers, extracts the patient's real phone number, push name,
and message ID dynamically, and sends this webhook payload to the FastAPI backend.

This script allows developers, clinic operators, and testing agents to dynamically
simulate ANY real patient phone number and message without hardcoding.

Usage:
    python scripts/simulate_patient_inbound.py --phone 03021234567 --name "Zubair Khan" --message "Dr Tariq appointment"
    python scripts/simulate_patient_inbound.py --random
"""

import sys
import uuid
import random
import argparse
import urllib.request
import json

def generate_random_pakistani_phone() -> str:
    """Generates a realistic Pakistani mobile number (e.g., 92300XXXXXXX)."""
    prefix = random.choice(["92300", "92301", "92302", "92321", "92333", "92345", "92312"])
    suffix = "".join([str(random.randint(0, 9)) for _ in range(7)])
    return f"{prefix}{suffix}"

def send_inbound_simulation(
    phone: str,
    name: str,
    message: str,
    instance: str = "alpha-clinic",
    webhook_url: str = "http://192.168.1.31:8001/api/v1/channels/whatsapp/evolution"
):
    # Clean phone: normalize 03XX -> 923XX
    cleaned = phone.replace("+", "").replace("-", "").replace(" ", "")
    if cleaned.startswith("03"):
        cleaned = "92" + cleaned[1:]

    msg_id = f"WA_{uuid.uuid4().hex[:16].upper()}"
    remote_jid = f"{cleaned}@s.whatsapp.net"

    payload = {
        "event": "messages.upsert",
        "instance": instance,
        "data": {
            "key": {
                "remoteJid": remote_jid,
                "fromMe": False,
                "id": msg_id
            },
            "pushName": name,
            "message": {
                "conversation": message
            }
        }
    }

    print(f"[*] Dispatching Dynamic Inbound Message:")
    print(f"    Patient Phone : {cleaned}")
    print(f"    Remote JID    : {remote_jid}")
    print(f"    Push Name     : {name}")
    print(f"    Message ID    : {msg_id}")
    print(f"    Message Text  : '{message}'")
    print(f"    Target URL    : {webhook_url}\n")

    req = urllib.request.Request(
        webhook_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            status = resp.status
            body = resp.read().decode("utf-8")
            print(f"[+] HTTP Status: {status}")
            try:
                parsed = json.loads(body)
                print("[+] Response Payload:")
                print(json.dumps(parsed, indent=2))
            except Exception:
                print(f"[+] Response Body: {body}")
    except urllib.error.HTTPError as e:
        print(f"[-] HTTP Error {e.code}: {e.read().decode('utf-8')}")
    except Exception as e:
        print(f"[-] Connection Error: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Simulate dynamic patient inbound WhatsApp message")
    parser.add_argument("--phone", "-p", default="", help="Patient phone number (e.g. 03001234567 or 923001234567)")
    parser.add_argument("--name", "-n", default="", help="Patient push name")
    parser.add_argument("--message", "-m", default="Assalam O Alaikum , mogy Dr Tariq ki appointment lehni hn check-up KY leay", help="Message text")
    parser.add_argument("--random", "-r", action="store_true", help="Generate random patient details")
    parser.add_argument("--url", "-u", default="http://192.168.1.31:8001/api/v1/channels/whatsapp/evolution", help="Webhook endpoint")

    args = parser.parse_args()

    patient_phone = args.phone
    patient_name = args.name

    if args.random or not patient_phone:
        patient_phone = generate_random_pakistani_phone()
        names = ["Muhammad Usman", "Fatima Zahra", "Ahmed Raza", "Ayesha Bibi", "Hamza Tariq", "Ali Hassan", "Zainab Bibi"]
        patient_name = patient_name or random.choice(names)

    if not patient_name:
        patient_name = "Patient " + patient_phone[-4:]

    send_inbound_simulation(
        phone=patient_phone,
        name=patient_name,
        message=args.message,
        webhook_url=args.url
    )
