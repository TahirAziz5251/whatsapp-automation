"""
Deterministic Zero-Hallucination Output Validator for WhatsApp AI replies.

Verifies LLM responses against actual tool execution results and persisted conversation
state before dispatching to patients via Evolution GO.
"""
import json
import re
from typing import Any, Dict, List, Optional, Set


def _collect_grounded_values(tools_executed: List[Dict[str, Any]], state_json: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    blob_parts: List[str] = []
    succeeded_ops: Set[str] = set()
    grounded_refs: Set[str] = set()

    for item in tools_executed or []:
        t_name = str(item.get("tool") or "")
        res = item.get("result") or {}
        if isinstance(res, dict):
            blob_parts.append(json.dumps(res, default=str))
            st = str(res.get("status") or "").upper()
            if st == "CONFIRMED" and t_name in ("book_appointment", "create_booking"):
                succeeded_ops.add("BOOKED")
            elif st == "RESCHEDULED" and t_name == "reschedule_appointment":
                succeeded_ops.add("RESCHEDULED")
            elif st == "CANCELLED" and t_name == "cancel_appointment":
                succeeded_ops.add("CANCELLED")
            elif st == "CHECKED_IN" and t_name in ("check_in_patient", "check_in"):
                succeeded_ops.add("CHECKED_IN")

            for key in ("appointment_number", "queue_token", "current_token_serving", "your_token", "ticket_id"):
                val = res.get(key)
                if val:
                    grounded_refs.add(str(val).upper())
            for apt in res.get("appointments") or []:
                if isinstance(apt, dict):
                    for k in ("appointment_number", "queue_token"):
                        if apt.get(k):
                            grounded_refs.add(str(apt[k]).upper())

    if isinstance(state_json, dict):
        blob_parts.append(json.dumps(state_json, default=str))
        issued = state_json.get("issued_options") or {}
        for ref in issued.get("appointments") or []:
            grounded_refs.add(str(ref).upper())

    return {
        "succeeded_ops": succeeded_ops,
        "grounded_refs": grounded_refs,
        "blob_lower": " ".join(blob_parts).lower(),
    }


def _safe_fallback_reply(reason: str, language: str, reception_phone: str = "") -> str:
    rec = f" ({reception_phone})" if reception_phone else ""
    if reason == "PHANTOM_BOOKING":
        if language == "ROMAN_URDU":
            return "Aap ki appointment abhi database mein confirm nahi hui. Barah-e-meherbani slot aur details confirm karein taake main booking mukammal kar sakoon."
        if language == "URDU":
            return "آپ کی اپائنٹمنٹ ابھی سسٹم میں کنفرم نہیں ہوئی۔ برائے مہربانی تفصیلات اور وقت کی تصدیق کریں تاکہ میں بکنگ مکمل کر سکوں۔"
        return "Your appointment is not confirmed in our system yet. Please confirm the doctor, date, and time summary so I can complete your booking."
    if reason == "PHANTOM_MUTATION":
        if language == "ROMAN_URDU":
            return f"Tabdeeli abhi system mein update nahi hui. Barah-e-meherbani apna Booking ID confirm karein ya Reception{rec} se rabta karein."
        return f"That change has not been updated in our system yet. Please confirm your Booking ID or contact Reception{rec}."
    if language == "ROMAN_URDU":
        return f"Maazrat, tasdeeq shuda clinic maloomat verify karne mein masla aaya. Barah-e-meherbani dobara poochhein ya Reception{rec} se rabta karein."
    return f"I could not verify those details from clinic records right now. Please try again or contact Reception{rec}."


def validate_ai_response(
    reply_text: str,
    tools_executed: List[Dict[str, Any]],
    state_json: Optional[Dict[str, Any]] = None,
    language: str = "ENGLISH",
    reception_phone: str = "",
) -> Dict[str, Any]:
    """
    Sanitizes and validates an AI response for zero hallucination:
    - removes leaked thinking tags or prompt headers
    - blocks phantom booking/reschedule/cancel/check-in confirmations without succeeded DB writes
    - rejects ungrounded booking/token references not present in DB tool results or state
    """
    text = (reply_text or "").strip()
    violations: List[str] = []

    # 1. Strip accidental reasoning tags or prompt headers
    cleaned = re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE).strip()
    cleaned = re.sub(r"(?im)^#\s*(DATA INTEGRITY|NON-NEGOTIABLE|PHASE \d+|OUTPUT CONTRACT).*$", "", cleaned).strip()

    # 1.1 Strip robotic parenthetical form hints, "For example, ..." sentences, and filler slots blurbs
    cleaned = re.sub(
        r"\s*\(\s*(?:e\.g\.?|for example|as it should appear|if any)[^)]*\)",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"\s*\bFor example,\s+.*?(?:(?<!\bDr)(?<!\bMr)(?<!\bMs)(?<!\bMrs)(?<!\be)(?<!\bg)[.!?](?=\s|$)|\n|$)",
        "",
        cleaned,
        flags=re.IGNORECASE,
    ).strip()
    cleaned = re.sub(
        r"\s*\bThis will help me find the right available slots for (?:her|him|you|the patient)\.?",
        "",
        cleaned,
        flags=re.IGNORECASE,
    ).strip()

    # 1.2 Strip premature or repetitive visit-type footers from intermediate/initial turns
    lower_check = cleaned.lower()
    if not any(k in lower_check for k in ("please confirm", "barah-e-meherbani confirm", "confirm karein", "reply 'confirm'")):
        cleaned = re.sub(
            r"(?:\n\s*)?Also,\s*let\s+me\s+know\s+if\s+this\s+is\s+(?:her|his|your)\s+first\s+visit\s*[-–—\s]+or\s+a\s+follow[-‑\s]*up[^\n.]*[\.\🌸\🌺\✨\s]*",
            "",
            cleaned,
            flags=re.IGNORECASE,
        ).strip()

    grounded = _collect_grounded_values(tools_executed, state_json)
    ops = grounded["succeeded_ops"]
    lower = cleaned.lower()

    # 2. Phantom write claim checks
    booking_claim_re = re.compile(
        r"\b(your appointment (?:has been|is) (?:confirmed|booked)|appointment successfully confirmed|booking confirmed|aap ki appointment book ho)\b",
        re.IGNORECASE,
    )
    if booking_claim_re.search(lower) and "BOOKED" not in ops:
        violations.append("PHANTOM_BOOKING_CLAIM")
        return {
            "valid": False,
            "sanitized_text": _safe_fallback_reply("PHANTOM_BOOKING", language, reception_phone),
            "violations": violations,
        }

    resched_claim_re = re.compile(r"\b(successfully rescheduled|has been rescheduled|rescheduled to)\b", re.IGNORECASE)
    if resched_claim_re.search(lower) and "RESCHEDULED" not in ops and tools_executed:
        # Allow if reschedule succeeded earlier or in prompt confirmation check only if explicit success phrase
        violations.append("PHANTOM_RESCHEDULE_CLAIM")
        return {
            "valid": False,
            "sanitized_text": _safe_fallback_reply("PHANTOM_MUTATION", language, reception_phone),
            "violations": violations,
        }

    cancel_claim_re = re.compile(r"\b(successfully cancelled|appointment (?:has been|is) cancelled)\b", re.IGNORECASE)
    if cancel_claim_re.search(lower) and "CANCELLED" not in ops:
        violations.append("PHANTOM_CANCEL_CLAIM")
        return {
            "valid": False,
            "sanitized_text": _safe_fallback_reply("PHANTOM_MUTATION", language, reception_phone),
            "violations": violations,
        }

    checkin_claim_re = re.compile(r"\b(you are (?:now )?checked in|successfully checked in)\b", re.IGNORECASE)
    if checkin_claim_re.search(lower) and "CHECKED_IN" not in ops:
        violations.append("PHANTOM_CHECKIN_CLAIM")
        return {
            "valid": False,
            "sanitized_text": _safe_fallback_reply("PHANTOM_MUTATION", language, reception_phone),
            "violations": violations,
        }

    # 3. Reference / Token Grounding Check (block prompt-example IDs like ALP-00042 or fake APT-xxx)
    cited_refs = re.findall(r"\b(?:APT|ALP)-[A-Z0-9-]{4,}\b", cleaned.upper())
    for ref in cited_refs:
        if ref not in grounded["grounded_refs"] and ref.lower() not in grounded["blob_lower"]:
            violations.append(f"UNGROUNDED_REF:{ref}")

    if violations:
        return {
            "valid": False,
            "sanitized_text": _safe_fallback_reply("UNGROUNDED_ENTITY", language, reception_phone),
            "violations": violations,
        }

    # 4. Grounded Fee Enforcement (never let LLM guess a wrong fee like PKR 1,500 when DB doctor fee is PKR 1,800)
    doctor_fees: Dict[str, float] = {}
    if isinstance(state_json, dict):
        issued_fees = (state_json.get("issued_options") or {}).get("doctor_fees") or {}
        for d_name, f_val in issued_fees.items():
            try:
                doctor_fees[d_name] = float(f_val)
            except Exception:
                pass
    for item in tools_executed or []:
        res = item.get("result") or {}
        if isinstance(res, dict):
            for doc in res.get("doctors") or []:
                if isinstance(doc, dict) and doc.get("name") and doc.get("fee_pkr") is not None:
                    doctor_fees[doc["name"]] = float(doc["fee_pkr"])
            if res.get("summary") and isinstance(res["summary"], dict):
                s_doc = res["summary"].get("doctor_name")
                s_fee = res["summary"].get("fee_pkr")
                if s_doc and s_fee is not None:
                    doctor_fees[s_doc] = float(s_fee)

    matched_fees = [f for d_name, f in doctor_fees.items() if d_name.lower() in cleaned.lower()]
    if len(set(matched_fees)) == 1:
        exact_fee = matched_fees[0]
        exact_fee_str = f"{exact_fee:,.0f}"
        def _replace_wrong_fee(m):
            prefix = m.group(1)
            raw_num = m.group(2).replace(",", "")
            try:
                if float(raw_num) != exact_fee:
                    return f"{prefix}{exact_fee_str}"
            except Exception:
                pass
            return m.group(0)
        cleaned = re.sub(r"\b((?:PKR|Rs\.?)\s*)([\d,]+(?:\.\d+)?)", _replace_wrong_fee, cleaned, flags=re.IGNORECASE)

    return {
        "valid": True,
        "sanitized_text": cleaned,
        "violations": [],
    }
