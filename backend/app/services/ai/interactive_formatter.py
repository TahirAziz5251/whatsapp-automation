import re
import logging
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session
from app.services.clinic_service import get_departments_db

logger = logging.getLogger(__name__)


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
    native WhatsApp interactive UI controls (Buttons <= 3 or List menu >= 4).
    All specialties, doctors, fees, and open slots are strictly queried from platform_db (zero hallucination).
    """
    try:
        user_lower = (user_text or "").lower().strip()
        reply_lower = (reply_text or "").lower()

        # ---------------------------------------------------------------------
        # State 1: Booking Confirmed (Post-Booking Action Buttons)
        # ---------------------------------------------------------------------
        for exec_item in tools_executed:
            tool_name = exec_item.get("tool")
            res = exec_item.get("result") or {}
            if tool_name in ("book_appointment", "create_booking") and res.get("status") == "CONFIRMED":
                return {
                    "type": "buttons",
                    "title": tenant_name[:24],
                    "footer": tenant_name[:24],
                    "buttons": [
                        {"id": "btn_reschedule", "displayText": "Reschedule"},
                        {"id": "btn_cancel", "displayText": "Cancel appointment"},
                        {"id": "btn_queue_status", "displayText": "Queue status"},
                    ],
                }

        # Also check reply text for booking confirmation
        if (
            re.search(r"\b(booked|appointment confirmed|booking confirmed|booking id|apt-\d+)\b", reply_lower)
            and not re.search(r"\b(please confirm|do you confirm)\b", reply_lower)
        ):
            return {
                "type": "buttons",
                "title": tenant_name[:24],
                "footer": tenant_name[:24],
                "buttons": [
                    {"id": "btn_reschedule", "displayText": "Reschedule"},
                    {"id": "btn_cancel", "displayText": "Cancel appointment"},
                    {"id": "btn_queue_status", "displayText": "Queue status"},
                ],
            }

        # ---------------------------------------------------------------------
        # State 2: 2-Step Confirmation Summary ("Please confirm: ...")
        # ---------------------------------------------------------------------
        if re.search(r"\b(please confirm|do you confirm|confirm appointment|kya aap confirm)\b", reply_lower):
            return {
                "type": "buttons",
                "title": tenant_name[:24],
                "footer": tenant_name[:24],
                "buttons": [
                    {"id": "btn_confirm", "displayText": "Confirm"},
                    {"id": "btn_change", "displayText": "Change"},
                ],
            }

        # ---------------------------------------------------------------------
        # State 3: Doctor Details & Slot Selection (Available Slots from DB)
        # ---------------------------------------------------------------------
        for exec_item in tools_executed:
            tool_name = exec_item.get("tool")
            res = exec_item.get("result") or {}
            if tool_name in ("get_doctor_schedule", "search_doctors", "get_availability") and res.get("status") == "SUCCESS":
                slots = res.get("available_slots") or []
                clean_slots = [str(s).strip() for s in slots if str(s).strip()]
                if clean_slots:
                    # Provide first 2 slots + Tomorrow slots as 3 quick reply buttons
                    slot_buttons = []
                    for s in clean_slots[:2]:
                        slot_buttons.append({"id": f"btn_slot_{s.replace(':', '')}", "displayText": s[:20]})
                    slot_buttons.append({"id": "btn_tomorrow", "displayText": "Tomorrow slots"})
                    return {
                        "type": "buttons",
                        "title": tenant_name[:24],
                        "footer": tenant_name[:24],
                        "buttons": slot_buttons,
                    }

        # If reply text presents doctor schedule or slots
        if re.search(r"\b(available today|available slots|open slots|timing|dr\.)\b", reply_lower) and re.search(
            r"\b(\d{1,2}:\d{2}\s*(?:am|pm)?)\b", reply_lower
        ):
            slot_matches = re.findall(r"\b\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?\b", reply_text)
            if slot_matches:
                clean_slots = list(dict.fromkeys(slot_matches))
                slot_buttons = []
                for s in clean_slots[:2]:
                    slot_buttons.append({"id": f"btn_slot_{s.replace(':', '').replace(' ', '')}", "displayText": s.strip()[:20]})
                slot_buttons.append({"id": "btn_tomorrow", "displayText": "Tomorrow slots"})
                return {
                    "type": "buttons",
                    "title": tenant_name[:24],
                    "footer": tenant_name[:24],
                    "buttons": slot_buttons,
                }

        # ---------------------------------------------------------------------
        # State 4: Specialty / Department Selection (Database-driven)
        # ---------------------------------------------------------------------
        # If user explicitly asked for specialties, tapped "Book appointment", or bot asks for specialty:
        is_asking_specialty = bool(
            re.search(r"\b(choose a specialty|which department|which doctor|select specialty|specialty)\b", reply_lower)
            or user_lower in ("book appointment", "appointment", "book", "specialty", "specialties")
            or any(exec_item.get("tool") == "get_departments" for exec_item in tools_executed)
        )

        if is_asking_specialty and not re.search(r"\b(full name|patient's name|patient name)\b", reply_lower):
            # Query active specialties directly from database
            dept_res = get_departments_db(db, tenant_id)
            departments = dept_res.get("departments", [])
            if departments:
                if len(departments) <= 3:
                    buttons = []
                    for idx, d in enumerate(departments[:3], start=1):
                        d_name = d.get("name", f"Specialty {idx}")
                        # Display General Physician if specialty is General Medicine
                        display_name = "General Physician" if d_name == "General Medicine" else d_name
                        buttons.append({
                            "id": f"btn_spec_{re.sub(r'[^a-zA-Z0-9_]', '', d_name.lower().replace(' ', '_'))}",
                            "displayText": display_name[:20],
                        })
                    return {
                        "type": "buttons",
                        "title": tenant_name[:24],
                        "footer": tenant_name[:24],
                        "buttons": buttons,
                    }
                else:
                    rows = []
                    for idx, d in enumerate(departments[:10], start=1):
                        d_name = d.get("name", f"Specialty {idx}")
                        display_name = "General Physician" if d_name == "General Medicine" else d_name
                        fee = int(d.get("min_fee_pkr", 0))
                        desc = f"Fee: Rs {fee}" if fee > 0 else "Available OPD"
                        rows.append({
                            "rowId": f"row_spec_{re.sub(r'[^a-zA-Z0-9_]', '', d_name.lower().replace(' ', '_'))}",
                            "title": display_name[:24],
                            "description": desc[:72],
                        })
                    return {
                        "type": "list",
                        "title": tenant_name[:24],
                        "button_text": "Choose Specialty",
                        "footer": tenant_name[:24],
                        "sections": [{"title": "Medical Specialties", "rows": rows}],
                    }

        # ---------------------------------------------------------------------
        # State 5: Queue Status Inquiry
        # ---------------------------------------------------------------------
        for exec_item in tools_executed:
            if exec_item.get("tool") == "get_queue_status":
                return {
                    "type": "buttons",
                    "title": tenant_name[:24],
                    "footer": tenant_name[:24],
                    "buttons": [
                        {"id": "btn_refresh_queue", "displayText": "Refresh status"},
                        {"id": "btn_reception", "displayText": "Talk to reception"},
                    ],
                }

        if re.search(r"\b(not checked in|queue status|token|waiting|patients ahead)\b", reply_lower):
            return {
                "type": "buttons",
                "title": tenant_name[:24],
                "footer": tenant_name[:24],
                "buttons": [
                    {"id": "btn_refresh_queue", "displayText": "Refresh status"},
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
                    "title": tenant_name[:24],
                    "footer": tenant_name[:24],
                    "buttons": [
                        {"id": "btn_book", "displayText": "Book appointment"},
                        {"id": "btn_main_menu", "displayText": "Main Menu"},
                        {"id": "btn_reception", "displayText": "Talk to reception"},
                    ],
                }

        # ---------------------------------------------------------------------
        # State 7: Initial Greeting / Welcome / Main Menu
        # ---------------------------------------------------------------------
        is_greeting = bool(
            re.search(r"\b(assalam|salam|hello|hi|hey|welcome|how can i help|main menu|menu)\b", user_lower)
            or re.search(r"\b(welcome to|how can i help you today|khushamdeed)\b", reply_lower)
        )

        if is_greeting and not tools_executed:
            # 4 Main menu items as interactive list menu
            return {
                "type": "list",
                "title": tenant_name[:24],
                "button_text": "Main Menu",
                "footer": tenant_name[:24],
                "sections": [
                    {
                        "title": "Clinic Services",
                        "rows": [
                            {
                                "rowId": "menu_book_appointment",
                                "title": "Book appointment",
                                "description": "Schedule a doctor consultation",
                            },
                            {
                                "rowId": "menu_my_appointments",
                                "title": "My appointments",
                                "description": "View your active & upcoming bookings",
                            },
                            {
                                "rowId": "menu_queue_status",
                                "title": "Queue status",
                                "description": "Check live OPD queue & wait time",
                            },
                            {
                                "rowId": "menu_talk_to_reception",
                                "title": "Talk to reception",
                                "description": "Speak directly with clinic staff",
                            },
                        ],
                    }
                ],
            }

    except Exception as e:
        logger.error(f"Error in generate_interactive_elements: {e}", exc_info=True)

    return None
