import re
import logging
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session
from app.services.clinic_service import get_departments_db

logger = logging.getLogger(__name__)


def _chunk_buttons(buttons: List[Dict[str, str]], title: str, footer: str, overflow_prompt: str = "Additional options:") -> Dict[str, Any]:
    """Packs <=3 buttons as a single `buttons` payload or >3 into `button_groups` (3 per bubble)."""
    if len(buttons) <= 3:
        return {
            "type": "buttons",
            "title": title[:24],
            "footer": footer[:24],
            "buttons": buttons,
        }
    groups = []
    for idx in range(0, len(buttons), 3):
        chunk = buttons[idx:idx + 3]
        groups.append({
            "text": None if idx == 0 else overflow_prompt,
            "buttons": chunk,
        })
    return {
        "type": "button_groups",
        "title": title[:24],
        "footer": footer[:24],
        "groups": groups,
    }


def extract_interactive_labels(interactive_payload: Optional[Dict[str, Any]]) -> List[str]:
    """Extracts ordered button/option display labels from an interactive payload."""
    if not isinstance(interactive_payload, dict):
        return []
    labels: List[str] = []
    itype = interactive_payload.get("type")
    if itype == "buttons":
        for b in interactive_payload.get("buttons") or []:
            lbl = str((b.get("displayText") if isinstance(b, dict) else b) or "").strip()
            if lbl:
                labels.append(lbl)
    elif itype == "button_groups":
        for g in interactive_payload.get("groups") or []:
            if isinstance(g, dict):
                for b in g.get("buttons") or []:
                    lbl = str((b.get("displayText") if isinstance(b, dict) else b) or "").strip()
                    if lbl:
                        labels.append(lbl)
    elif itype == "list":
        for s in interactive_payload.get("sections") or []:
            if isinstance(s, dict):
                for r in s.get("rows") or []:
                    if isinstance(r, dict) and r.get("title"):
                        labels.append(str(r["title"]).strip())
    return labels


def generate_interactive_elements(
    db: Session,
    tenant_id: str,
    tenant_name: str,
    user_text: str,
    reply_text: str,
    tools_executed: List[Dict[str, Any]],
    state_json: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """
    Analyzes conversation state, executed database tools, and AI reply to attach
    native WhatsApp clickable button controls (`buttons` / `button_groups`).
    All specialties, doctors, fees, and open slots are strictly queried from platform_db (zero hallucination).
    """
    try:
        user_lower = (user_text or "").lower().strip()
        reply_lower = (reply_text or "").lower()
        short_title = (tenant_name or "Clinic Assistant")[:24]

        # ---------------------------------------------------------------------
        # State 1: Booking / Reschedule Confirmed & Cancel Completed
        # ---------------------------------------------------------------------
        for exec_item in tools_executed:
            tool_name = exec_item.get("tool")
            res = exec_item.get("result") or {}
            if tool_name in ("book_appointment", "create_booking") and res.get("status") == "CONFIRMED":
                return {
                    "type": "buttons",
                    "title": short_title,
                    "footer": short_title,
                    "buttons": [
                        {"id": "btn_reschedule", "displayText": "Reschedule"},
                        {"id": "btn_cancel", "displayText": "Cancel appointment"},
                        {"id": "btn_queue_status", "displayText": "Queue status"},
                    ],
                }
            if tool_name == "reschedule_appointment" and res.get("status") == "RESCHEDULED":
                return {
                    "type": "buttons",
                    "title": short_title,
                    "footer": short_title,
                    "buttons": [
                        {"id": "btn_reschedule", "displayText": "Reschedule"},
                        {"id": "btn_cancel", "displayText": "Cancel appointment"},
                        {"id": "btn_queue_status", "displayText": "Queue status"},
                    ],
                }
            if tool_name == "cancel_appointment" and res.get("status") == "CANCELLED":
                return {
                    "type": "buttons",
                    "title": short_title,
                    "footer": short_title,
                    "buttons": [
                        {"id": "btn_book", "displayText": "Book appointment"},
                        {"id": "btn_my_appointments", "displayText": "My appointments"},
                        {"id": "btn_reception", "displayText": "Talk to reception"},
                    ],
                }

        has_confirm_gate = any(
            (exec_item.get("result") or {}).get("status") == "CONFIRMATION_REQUIRED"
            for exec_item in tools_executed
        )

        # ---------------------------------------------------------------------
        # State 2: 2-Step Confirmation Summary ("Please confirm / Confirm / Change")
        # ---------------------------------------------------------------------
        if has_confirm_gate or re.search(
            r"\b(please confirm|do you confirm|confirm appointment|confirm cancellation|confirm reschedule|before i confirm|reply\s+[“\"']?confirm|kya aap confirm|confirm karein)\b",
            reply_lower,
        ):
            return {
                "type": "buttons",
                "title": short_title,
                "footer": short_title,
                "buttons": [
                    {"id": "btn_confirm", "displayText": "Confirm"},
                    {"id": "btn_change", "displayText": "Change"},
                ],
            }

        # State 1 Fallback (only when not waiting for confirmation)
        if (
            re.search(r"\b(booked|appointment confirmed|appointment is confirmed|booking confirmed|booking ref|booking id|reschedule confirmed|apt-\d+)\b", reply_lower)
            and not re.search(r"\b(please confirm|do you confirm|reply\s+[“\"']?confirm|before i confirm|cancel|cancellation)\b", reply_lower)
        ):
            return {
                "type": "buttons",
                "title": short_title,
                "footer": short_title,
                "buttons": [
                    {"id": "btn_reschedule", "displayText": "Reschedule"},
                    {"id": "btn_cancel", "displayText": "Cancel appointment"},
                    {"id": "btn_queue_status", "displayText": "Queue status"},
                ],
            }

        # ---------------------------------------------------------------------
        # State 3: Doctor Details & Slot Selection (Strictly Verified DB Slots)
        # ---------------------------------------------------------------------
        is_tomorrow_view = "tomorrow" in user_lower
        for exec_item in tools_executed:
            tool_name = exec_item.get("tool")
            res = exec_item.get("result") or {}
            if tool_name in ("get_doctor_schedule", "search_doctors", "get_availability") and res.get("status") == "SUCCESS":
                slots = list(res.get("available_slots") or [])
                if not slots and isinstance(res.get("doctors"), list) and res["doctors"]:
                    for doc in res["doctors"]:
                        doc_slots = doc.get("open_slots") or []
                        if not doc_slots and doc.get("next_available_slots"):
                            doc_slots = doc.get("next_available_slots") or []
                        for s in doc_slots:
                            if s not in slots:
                                slots.append(s)
                clean_slots = [str(s).strip() for s in slots if str(s).strip()]
                if clean_slots:
                    max_slots = 12 if is_tomorrow_view else 11
                    slot_buttons = [
                        {"id": f"btn_slot_{re.sub(r'[^a-zA-Z0-9]', '', s)}", "displayText": s[:20]}
                        for s in clean_slots[:max_slots]
                    ]
                    if not is_tomorrow_view:
                        slot_buttons.append({"id": "btn_tomorrow", "displayText": "Tomorrow slots"})
                    return _chunk_buttons(slot_buttons, short_title, short_title, "More time slots:")

        # State fallback when LLM asks to choose a time without re-running schedule tool on this turn
        is_asking_slot = bool(
            re.search(r"\b(which time|choose.*slot|prefer.*slot|available time|open slots|select.*slot|time slot)\b", reply_lower)
            and not re.search(r"\b(please confirm|do you confirm|booking confirmed|appointment confirmed)\b", reply_lower)
        )
        if is_asking_slot:
            state_slots = list(((state_json or {}).get("issued_options") or {}).get("slots") or [])
            if not state_slots:
                # Never scrape shift-hours range ("04:00 PM to 08:00 PM") as open slots
                stripped_hours = re.sub(
                    r"\b(?:from\s+)?\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?\s*(?:to|-|–|—)\s*\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?\b",
                    " ",
                    reply_text or "",
                    flags=re.IGNORECASE,
                )
                state_slots = re.findall(r"\b\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)\b", stripped_hours)
            clean_slots = list(dict.fromkeys(str(s).strip() for s in state_slots if str(s).strip()))
            if clean_slots:
                max_slots = 12 if is_tomorrow_view else 11
                slot_buttons = [
                    {"id": f"btn_slot_{re.sub(r'[^a-zA-Z0-9]', '', s)}", "displayText": s[:20]}
                    for s in clean_slots[:max_slots]
                ]
                if not is_tomorrow_view:
                    slot_buttons.append({"id": "btn_tomorrow", "displayText": "Tomorrow slots"})
                return _chunk_buttons(slot_buttons, short_title, short_title, "More time slots:")

        # ---------------------------------------------------------------------
        # State 4: Specialty / Department Selection (Database-driven)
        # ---------------------------------------------------------------------
        is_asking_specialty = bool(
            re.search(r"\b(choose a specialty|which department|which specialty|select specialty|specialty|type of consultation|preferred department)\b", reply_lower)
            or user_lower in ("book appointment", "appointment", "book", "specialty", "specialties")
            or any(exec_item.get("tool") == "get_departments" for exec_item in tools_executed)
        )

        if is_asking_specialty and not re.search(r"\b(full name|patient's name|patient name|mukammal naam)\b", reply_lower):
            dept_res = get_departments_db(db, tenant_id)
            departments = dept_res.get("departments", [])
            if departments:
                buttons = []
                for idx, d in enumerate(departments[:9], start=1):
                    d_name = d.get("name", f"Specialty {idx}")
                    display_name = "General Physician" if d_name == "General Medicine" else d_name
                    buttons.append({
                        "id": f"btn_spec_{re.sub(r'[^a-zA-Z0-9_]', '', d_name.lower().replace(' ', '_'))}",
                        "displayText": display_name[:20],
                    })
                return _chunk_buttons(buttons, short_title, short_title, "More specialties:")

        # ---------------------------------------------------------------------
        # State 5: Queue Status Inquiry
        # ---------------------------------------------------------------------
        for exec_item in tools_executed:
            if exec_item.get("tool") == "get_queue_status":
                return {
                    "type": "buttons",
                    "title": short_title,
                    "footer": short_title,
                    "buttons": [
                        {"id": "btn_refresh_queue", "displayText": "Refresh status"},
                        {"id": "btn_book", "displayText": "Book appointment"},
                        {"id": "btn_reception", "displayText": "Talk to reception"},
                    ],
                }

        if re.search(r"\b(not checked in|queue status|token|waiting|patients ahead)\b", reply_lower):
            return {
                "type": "buttons",
                "title": short_title,
                "footer": short_title,
                "buttons": [
                    {"id": "btn_refresh_queue", "displayText": "Refresh status"},
                    {"id": "btn_book", "displayText": "Book appointment"},
                    {"id": "btn_reception", "displayText": "Talk to reception"},
                ],
            }

        # ---------------------------------------------------------------------
        # State 6: "My Appointments" Inquiry
        # ---------------------------------------------------------------------
        for exec_item in tools_executed:
            if exec_item.get("tool") == "get_appointments":
                return {
                    "type": "buttons",
                    "title": short_title,
                    "footer": short_title,
                    "buttons": [
                        {"id": "btn_book", "displayText": "Book appointment"},
                        {"id": "btn_queue_status", "displayText": "Queue status"},
                        {"id": "btn_reception", "displayText": "Talk to reception"},
                    ],
                }

        # ---------------------------------------------------------------------
        # State 7: Explicit Menu or General Appointment Intent -> 4 Primary Actions
        # ---------------------------------------------------------------------
        # NEVER attach on pure greetings ("Assalam o Alikum", "Hi", "Hello", "Salam")
        is_pure_greeting = bool(
            re.match(
                r"^\s*(?:assalam[- ]?o[- ]?al(?:a|i|ai|ei|ay)?kum|as[- ]?salamu[- ]?al(?:a|i|ai|ei|ay)?kum|salam|aoa|hi|hello|hey)\s*[!.,?]*\s*$",
                user_lower,
            )
        )
        if is_pure_greeting:
            return None

        is_explicit_menu_or_general_intent = bool(
            user_lower in ("menu", "main menu", "options", "help", "services", "start")
            or re.search(r"\b(main menu|options menu|show menu|kya services|what services|all options)\b", user_lower)
            or (
                re.search(
                    r"\b(i want to book|want to book|book my appointment|schedule appointment|book an appointment|need an appointment|appointment chahiye)\b",
                    user_lower,
                )
                and not re.search(
                    r"\b(child|bacha|mother|father|walid|walida|sister|brother|bhai|behan|for my|dr\b|doctor|cardiolog|pediatric|medicine|physician|derma)\b",
                    user_lower,
                )
                and not tools_executed
            )
            or re.search(r"\b(choose an option|select an option|how can i help|main menu options)\b", reply_lower)
        )

        if is_explicit_menu_or_general_intent and not tools_executed:
            main_buttons = [
                {"id": "menu_book_appointment", "displayText": "Book appointment"},
                {"id": "menu_my_appointments", "displayText": "My appointments"},
                {"id": "menu_queue_status", "displayText": "Queue status"},
                {"id": "menu_talk_to_reception", "displayText": "Talk to reception"},
            ]
            return _chunk_buttons(
                main_buttons,
                short_title,
                short_title,
                overflow_prompt="Need reception support?",
            )

    except Exception as e:
        logger.error(f"Error in generate_interactive_elements: {e}", exc_info=True)

    return None
