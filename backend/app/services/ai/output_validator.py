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


def _extract_entity_hints(
    tools_executed: List[Dict[str, Any]],
    state_json: Optional[Dict[str, Any]] = None,
    extra_entities: Optional[Dict[str, Any]] = None,
) -> Dict[str, List[str]]:
    """Collects verified entity names/IDs/locations from tools and state for safe highlighting."""
    patient_names: List[str] = []
    doctor_names: List[str] = []
    tokens: List[str] = []
    booking_refs: List[str] = []
    locations: List[str] = []

    def _add(target: List[str], val: Any) -> None:
        s = str(val or "").strip()
        if s and len(s) >= 2 and s not in target:
            target.append(s)

    if isinstance(extra_entities, dict):
        _add(patient_names, extra_entities.get("patient_name"))
        _add(doctor_names, extra_entities.get("doctor_name"))
        _add(locations, extra_entities.get("business_name"))
        _add(locations, extra_entities.get("business_address"))
        _add(locations, extra_entities.get("room_number"))

    if isinstance(state_json, dict):
        draft = state_json.get("draft_booking") or {}
        if isinstance(draft, dict):
            _add(patient_names, draft.get("patient_name"))
            _add(doctor_names, draft.get("doctor_name"))
            _add(locations, draft.get("room_number"))
        issued = state_json.get("issued_options") or {}
        if isinstance(issued, dict):
            for d in issued.get("doctors") or []:
                _add(doctor_names, d)
            for ref in issued.get("appointments") or []:
                _add(booking_refs, ref)

    for item in tools_executed or []:
        res = item.get("result") or {}
        if not isinstance(res, dict):
            continue
        _add(patient_names, res.get("patient_name"))
        _add(doctor_names, res.get("doctor_name"))
        _add(locations, res.get("room_number"))
        _add(locations, res.get("business_name"))
        _add(locations, res.get("business_address"))
        for k in ("queue_token", "current_token_serving", "your_token"):
            _add(tokens, res.get(k))
        for k in ("appointment_number", "ticket_id"):
            _add(booking_refs, res.get(k))
        if isinstance(res.get("summary"), dict):
            s = res["summary"]
            _add(patient_names, s.get("patient_name"))
            _add(doctor_names, s.get("doctor_name"))
            _add(locations, s.get("room_number"))
            _add(booking_refs, s.get("appointment_number"))
        for doc in res.get("doctors") or []:
            if isinstance(doc, dict):
                _add(doctor_names, doc.get("name"))
                _add(locations, doc.get("room_number"))
        for apt in res.get("appointments") or []:
            if isinstance(apt, dict):
                _add(patient_names, apt.get("patient_name"))
                _add(doctor_names, apt.get("doctor_name"))
                _add(tokens, apt.get("queue_token"))
                _add(booking_refs, apt.get("appointment_number"))
                _add(locations, apt.get("room_number"))

    return {
        "patient_names": sorted(patient_names, key=len, reverse=True),
        "doctor_names": sorted(doctor_names, key=len, reverse=True),
        "tokens": sorted(tokens, key=len, reverse=True),
        "booking_refs": sorted(booking_refs, key=len, reverse=True),
        "locations": sorted(locations, key=len, reverse=True),
    }


def _unicode_fancy_to_ascii(text: str) -> str:
    """Normalizes mathematical styled Unicode letters/digits (U+1D400-U+1D7FF) to standard ASCII for uniform font size."""
    out = []
    # Ranges: Bold(0), Italic(26), BoldItalic(52), Script, Fraktur, Sans, SansBold, SansItalic, SansBoldItalic, Monospace...
    upper_starts = (0x1D400, 0x1D434, 0x1D468, 0x1D49C, 0x1D4D0, 0x1D504, 0x1D538, 0x1D56C, 0x1D5A0, 0x1D5D4, 0x1D608, 0x1D63C, 0x1D670)
    lower_starts = (0x1D41A, 0x1D44E, 0x1D482, 0x1D4B6, 0x1D4EA, 0x1D51E, 0x1D552, 0x1D586, 0x1D5BA, 0x1D5EE, 0x1D622, 0x1D656, 0x1D68A)
    digit_starts = (0x1D7CE, 0x1D7D8, 0x1D7E2, 0x1D7EC, 0x1D7F6)
    for ch in text:
        cp = ord(ch)
        if 0x1D400 <= cp <= 0x1D7FF:
            replaced = None
            for base in upper_starts:
                if base <= cp < base + 26:
                    replaced = chr(ord("A") + (cp - base))
                    break
            if replaced is None:
                for base in lower_starts:
                    if base <= cp < base + 26:
                        replaced = chr(ord("a") + (cp - base))
                        break
            if replaced is None:
                for base in digit_starts:
                    if base <= cp < base + 10:
                        replaced = chr(ord("0") + (cp - base))
                        break
            out.append(replaced if replaced is not None else ch)
        else:
            out.append(ch)
    return "".join(out)


def _apply_outside_bold_and_urls(text: str, pattern: str, repl, flags: int = 0) -> str:
    """Applies regex substitution ONLY to plain text spans (never inside *bold* spans or __URL_N__ placeholders)."""
    parts = re.split(r"(\*[^*\n]+\*|__URL_\d+__)", text)
    for i in range(0, len(parts), 2):
        if parts[i]:
            parts[i] = re.sub(pattern, repl, parts[i], flags=flags)
    return "".join(parts)


def format_whatsapp_uniform_text(text: str, entity_hints: Optional[Dict[str, List[str]]] = None) -> str:
    """
    Enforces SaaS production WhatsApp typography:
    - Guarantees uniform body font size across every message (strips #, ##, ### headings, backticks/code blocks, blockquotes, HTML, and Unicode math fonts)
    - Normalizes **bold** and <b>bold</b> to native WhatsApp *bold*
    - Highlights key clinical/SaaS points (patient name, Token Number, doctor name, slot time, date, location/room, Booking ID, fee) without touching URLs
    """
    if not text:
        return ""

    # 0. Normalize non-breaking hyphens inside Booking IDs/Tokens and convert [Label](url) -> plain clickable URL
    out = re.sub(r"[\u2010\u2011]", "-", text)
    out = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r"\2", out)

    # 1. Mask URLs verbatim so regex rules never alter ticket or map links
    urls: List[str] = []

    def _mask_url(m: re.Match) -> str:
        idx = len(urls)
        urls.append(m.group(0))
        return f"__URL_{idx}__"

    out = re.sub(r"https?://[^\s<>()]+", _mask_url, out)

    # 2. Uniform font normalization
    out = _unicode_fancy_to_ascii(out)
    out = re.sub(r"<br\s*/?>", "\n", out, flags=re.IGNORECASE)
    out = re.sub(r"</?(?:b|strong)\s*>", "*", out, flags=re.IGNORECASE)
    out = re.sub(r"</?[a-zA-Z][^>]*>", "", out)
    # Remove fenced code blocks & inline backticks (WhatsApp monospace shrinks/changes font size)
    out = re.sub(r"```[a-zA-Z0-9_-]*\n?", "", out)
    out = out.replace("```", "")
    out = re.sub(r"`([^`\n]+)`", r"\1", out)
    # Convert **CommonMark bold** -> *WhatsApp bold*
    out = re.sub(r"\*\*([^*\n]+)\*\*", r"*\1*", out)
    # Strip Markdown heading prefixes (#, ##, ###) and render as normal-size *bold*
    out = re.sub(r"(?m)^\s{0,3}#{1,6}\s+(.+?)\s*$", lambda m: f"*{m.group(1).strip('* ')}*", out)
    # Strip blockquote '>' prefix
    out = re.sub(r"(?m)^\s*>\s+", "", out)

    # 3. Bold verified dynamic entities (if present in hints)
    hints = entity_hints or {}
    for literal in (
        list(hints.get("booking_refs") or [])
        + list(hints.get("doctor_names") or [])
        + list(hints.get("patient_names") or [])
        + list(hints.get("tokens") or [])
        + list(hints.get("locations") or [])
    ):
        escaped = re.escape(literal)
        out = _apply_outside_bold_and_urls(out, rf"(?<!\w){escaped}(?!\w)", lambda m: f"*{m.group(0)}*")

    # 4. Bold canonical SaaS entities safely outside existing *bold* spans and URLs
    # Booking / Ticket References
    out = _apply_outside_bold_and_urls(out, r"\b(?:APT|ALP|TKT|ORD|SRV)-[A-Z0-9-]{4,}\b", lambda m: f"*{m.group(0)}*")
    # Token Numbers (e.g. Token T-M01, Token Number: T-A08, T-M01, token 14)
    out = _apply_outside_bold_and_urls(
        out,
        r"\b(?:Token(?:\s+(?:Number|No\.?))?(?:\s*[:#]\s*|\s+)(?:[A-Z]-[A-Z]?\d+|[A-Z]{1,2}\d+|\d{1,4})|T-[A-Z]{1,2}\d{1,4})\b",
        lambda m: f"*{m.group(0)}*",
        flags=re.IGNORECASE,
    )
    # Doctor / Provider Names (e.g. Dr. Tariq Mahmood)
    out = _apply_outside_bold_and_urls(
        out,
        r"\bDr\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}",
        lambda m: f"*{m.group(0)}*",
    )
    # Patient Names with title or greeting context (e.g. Ms. Naseem Mai, Thank you, Aizal.)
    out = _apply_outside_bold_and_urls(
        out,
        r"\b(?:Mr|Mrs|Ms|Miss|Master)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}",
        lambda m: f"*{m.group(0)}*",
    )
    out = _apply_outside_bold_and_urls(
        out,
        r"(\bThank you,\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})(?=[.,!\s]|$)",
        lambda m: f"{m.group(1)}*{m.group(2)}*",
    )
    out = _apply_outside_bold_and_urls(
        out,
        r"(\bPatient\s*:\s*)([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2})",
        lambda m: f"{m.group(1)}*{m.group(2)}*",
    )
    # Slot Times & Date Ranges (e.g. 10:30 AM, 04:00 PM - 08:00 PM, 2026-11-28)
    out = _apply_outside_bold_and_urls(
        out,
        r"\b\d{1,2}:\d{2}\s*(?:AM|PM)(?:\s*[-–—to]+\s*\d{1,2}:\d{2}\s*(?:AM|PM))?\b",
        lambda m: f"*{m.group(0)}*",
        flags=re.IGNORECASE,
    )
    out = _apply_outside_bold_and_urls(
        out,
        r"\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}-[A-Za-z]{3}-\d{4})\b",
        lambda m: f"*{m.group(0)}*",
    )
    # Clinic Room / Location designations
    out = _apply_outside_bold_and_urls(
        out,
        r"\b(?:Room|Cabin|Counter|Suite|Bench|Floor|Desk)\s+[A-Z0-9-]+\b",
        lambda m: f"*{m.group(0)}*",
    )
    # Currency Fees
    out = _apply_outside_bold_and_urls(
        out,
        r"\b(?:PKR|Rs\.?)\s*[\d,]+(?:\.\d+)?\b",
        lambda m: f"*{m.group(0)}*",
        flags=re.IGNORECASE,
    )

    # Collapse accidental double-asterisks created by adjacent wraps
    out = re.sub(r"\*{2,}", "*", out)

    # 5. Restore exact URLs verbatim
    for idx, url in enumerate(urls):
        out = out.replace(f"__URL_{idx}__", url)

    return out.strip()


def validate_ai_response(
    reply_text: str,
    tools_executed: List[Dict[str, Any]],
    state_json: Optional[Dict[str, Any]] = None,
    language: str = "ENGLISH",
    reception_phone: str = "",
    extra_entities: Optional[Dict[str, Any]] = None,
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

    # 1.3 When schedule/slot tools executed with open_slots, strip any hallucinated/duplicate numbered slot menu
    has_sched_slots = any(
        isinstance((item.get("result") or {}).get("doctors"), list)
        and any(d.get("open_slots") for d in (item.get("result") or {}).get("doctors") or [])
        for item in (tools_executed or [])
        if item.get("tool") in ("get_doctor_schedule", "search_doctors", "get_availability")
    )
    if has_sched_slots:
        cleaned = re.sub(
            r"(?im)^\s*\d+\.\s*(?:\*{0,2}\d{1,2}:\d{2}\s*(?:AM|PM)\*{0,2}|\*{0,2}Tomorrow slots\*{0,2}).*$\n?",
            "",
            cleaned,
        ).strip()

    # 1.4 Strip duplicate numbered post-booking menu (1. Reschedule / 2. Cancel appointment / 3. Queue status)
    if "BOOKED" in _collect_grounded_values(tools_executed, state_json)["succeeded_ops"] or "RESCHEDULED" in _collect_grounded_values(tools_executed, state_json)["succeeded_ops"]:
        cleaned = re.sub(
            r"(?im)^\s*[1-3]\.\s*(?:\*{0,2}(?:Reschedule|Cancel appointment|Queue status)\*{0,2}).*$\n?",
            "",
            cleaned,
        ).strip()

    # 1.5 Strip duplicate manual numbered menu / specialty / confirmation lists when interactive formatter supplies them
    cleaned = re.sub(
        r"(?im)^\s*\d{1,2}[.)]\s*\*{0,2}(?:Book\s+(?:an\s+)?appointment|My\s+appointments?|Doctor\s+Info(?:\s*&\s*Fees)?|Queue\s+status|Check-In\s*/\s*Queue\s+Status|Talk\s+to\s+reception|Clinic\s+Timings(?:\s*&\s*Location)?|Cancel\s+Booking)\*{0,2}(?:\s*[-–—:].*)?$\n?",
        "",
        cleaned,
    ).strip()
    if any(item.get("tool") == "get_departments" for item in (tools_executed or [])):
        cleaned = re.sub(
            r"(?im)^\s*\d{1,2}[.)]\s*\*{0,2}(?:General\s+(?:Physician|Medicine)|Cardiology|Dermatology|Pediatrics|Orthopedics|Gynecology|ENT)\*{0,2}(?:\s*[-–—:(].*)?$\n?",
            "",
            cleaned,
        ).strip()
    if any((item.get("result") or {}).get("status") == "CONFIRMATION_REQUIRED" for item in (tools_executed or [])):
        cleaned = re.sub(
            r"(?im)^\s*[12][.)]\s*\*{0,2}(?:Confirm|Change)\*{0,2}.*$\n?",
            "",
            cleaned,
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

    # 3.1 Ungrounded Doctor Name Check (block fabricated "Dr. <Name>" not returned by DB tools or state)
    entity_hints = _extract_entity_hints(tools_executed, state_json, extra_entities)
    bot_name_str = str((extra_entities or {}).get("bot_name") or "").strip().lower()
    allowed_doc_blob = " ".join(entity_hints["doctor_names"]).lower() + " " + grounded["blob_lower"] + " " + bot_name_str
    for m_doc in re.finditer(r"\bDr\.?\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)", cleaned):
        cited_doc = f"Dr. {m_doc.group(1).strip()}"
        if cited_doc.lower() not in allowed_doc_blob and m_doc.group(1).strip().lower() not in allowed_doc_blob:
            violations.append(f"UNGROUNDED_DOCTOR:{cited_doc}")

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

    cleaned = format_whatsapp_uniform_text(cleaned, entity_hints=entity_hints)

    return {
        "valid": True,
        "sanitized_text": cleaned,
        "violations": [],
    }
