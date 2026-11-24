import json
from typing import Dict, Any, List, Optional
from app.services.ai.tools import clinic_tools

# Master Canonical Tool Definitions (OpenAI / Groq Function Calling Schema)
CANONICAL_TOOLS: Dict[str, Dict[str, Any]] = {
    # --- CLINIC / HOSPITAL OPD QUEUE MANAGEMENT TOOLS ---
    "get_doctor_schedule": {
        "type": "function",
        "function": {
            "name": "get_doctor_schedule",
            "description": "Check available doctors, specialty, consulting days, operating hours, and open appointment slots.",
            "parameters": {
                "type": "object",
                "properties": {
                    "doctor_name_or_specialty": {
                        "type": "string",
                        "description": "Name of the doctor (e.g. 'Dr. Tariq') or medical specialty (e.g. 'Cardiology', 'Pediatrics', 'General Physician')."
                    },
                    "date": {
                        "type": "string",
                        "description": "Preferred date for appointment (e.g. '2026-11-22' or 'Tomorrow')."
                    }
                },
                "required": []
            }
        }
    },
    "book_appointment": {
        "type": "function",
        "function": {
            "name": "book_appointment",
            "description": "Book a verified clinic appointment for a patient and generate a queue token number.",
            "parameters": {
                "type": "object",
                "properties": {
                    "patient_name": {
                        "type": "string",
                        "description": "Full name of the patient."
                    },
                    "patient_phone": {
                        "type": "string",
                        "description": "Patient's phone number."
                    },
                    "doctor_name": {
                        "type": "string",
                        "description": "Name of the doctor to book with."
                    },
                    "date": {
                        "type": "string",
                        "description": "Date of appointment (e.g. '2026-11-22')."
                    },
                    "slot_time": {
                        "type": "string",
                        "description": "Selected time slot (e.g. '11:00 AM')."
                    },
                    "symptoms": {
                        "type": "string",
                        "description": "Brief description of the patient's concern or chief complaint."
                    }
                },
                "required": ["patient_name", "doctor_name", "date", "slot_time"]
            }
        }
    },
    "get_queue_status": {
        "type": "function",
        "function": {
            "name": "get_queue_status",
            "description": "Check the real-time live OPD queue status, token currently being examined, and estimated wait time.",
            "parameters": {
                "type": "object",
                "properties": {
                    "appointment_id_or_token": {
                        "type": "string",
                        "description": "The patient's queue token number (e.g. 'T-A14') or appointment ID."
                    },
                    "doctor_name": {
                        "type": "string",
                        "description": "Doctor's name for which the queue is running."
                    }
                },
                "required": []
            }
        }
    },
    "cancel_appointment": {
        "type": "function",
        "function": {
            "name": "cancel_appointment",
            "description": "Cancel or revoke a scheduled appointment.",
            "parameters": {
                "type": "object",
                "properties": {
                    "appointment_id": {
                        "type": "string",
                        "description": "Unique appointment identifier to cancel."
                    },
                    "reason": {
                        "type": "string",
                        "description": "Reason for cancellation."
                    }
                },
                "required": ["appointment_id"]
            }
        }
    },
    "check_in_patient": {
        "type": "function",
        "function": {
            "name": "check_in_patient",
            "description": "Mark patient as arrived at the clinic reception desk.",
            "parameters": {
                "type": "object",
                "properties": {
                    "appointment_id": {
                        "type": "string",
                        "description": "Appointment ID of the arriving patient."
                    }
                },
                "required": ["appointment_id"]
            }
        }
    },
    "search_knowledge_base": {
        "type": "function",
        "function": {
            "name": "search_knowledge_base",
            "description": "Search clinic FAQs, operating timings, address/location, parking, available lab tests, and fees.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The customer's question or search query."
                    }
                },
                "required": ["query"]
            }
        }
    },
    "escalate_to_human": {
        "type": "function",
        "function": {
            "name": "escalate_to_human",
            "description": "Hand off conversation to human clinic front-desk staff.",
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {
                        "type": "string",
                        "description": "Reason why human intervention is required."
                    }
                },
                "required": ["reason"]
            }
        }
    },

    # --- RESTAURANT & FOOD DELIVERY TOOLS (CROSS-VERTICAL CONTROL SAMPLES) ---
    "view_menu": {
        "type": "function",
        "function": {
            "name": "view_menu",
            "description": "View food menu categories, dishes, modifiers, and prices.",
            "parameters": {"type": "object", "properties": {"category": {"type": "string"}}}
        }
    },
    "create_food_order": {
        "type": "function",
        "function": {
            "name": "create_food_order",
            "description": "Place a food delivery or takeaway order.",
            "parameters": {"type": "object", "properties": {"items": {"type": "array"}}}
        }
    },

    # --- BAKERY TOOLS (CROSS-VERTICAL CONTROL SAMPLES) ---
    "request_custom_cake_quote": {
        "type": "function",
        "function": {
            "name": "request_custom_cake_quote",
            "description": "Submit a custom cake quotation request.",
            "parameters": {"type": "object", "properties": {"flavour": {"type": "string"}, "weight_lbs": {"type": "number"}}}
        }
    }
}


# Dispatch Registry
TOOL_HANDLERS = {
    "get_doctor_schedule": clinic_tools.get_doctor_schedule,
    "book_appointment": clinic_tools.book_appointment,
    "get_queue_status": clinic_tools.get_queue_status,
    "cancel_appointment": clinic_tools.cancel_appointment,
    "check_in_patient": clinic_tools.check_in_patient,
    "search_knowledge_base": clinic_tools.search_knowledge_base,
    "escalate_to_human": clinic_tools.escalate_to_human,
}


def get_allowed_tool_schemas(allowed_tool_names: List[str]) -> List[Dict[str, Any]]:
    """
    Returns only the function calling JSON schemas permitted by the tenant's template.
    """
    schemas = []
    for tool_name in allowed_tool_names:
        if tool_name in CANONICAL_TOOLS:
            schemas.append(CANONICAL_TOOLS[tool_name])
    return schemas


def execute_tool(
    tenant_id: str,
    allowed_tool_names: List[str],
    tool_name: str,
    arguments: Dict[str, Any],
    customer_phone: Optional[str] = None,
    db: Optional[Any] = None
) -> Dict[str, Any]:
    """
    Multi-tenant security gate for tool execution.
    1. Verifies that the tool is strictly in the tenant's allowlist.
    2. Injects the secure tenant_id, verified customer_phone, and active db session.
    3. Executes the underlying handler.
    """
    # Security Gate: Strict Allowlist Check
    if tool_name not in allowed_tool_names:
        return {
            "status": "SECURITY_VIOLATION",
            "error": f"Tool '{tool_name}' is not authorized for this business template.",
            "allowed_tools": allowed_tool_names
        }

    handler = TOOL_HANDLERS.get(tool_name)
    if not handler:
        return {
            "status": "NOT_IMPLEMENTED",
            "error": f"Tool '{tool_name}' is authorized in template but not registered in handler runtime."
        }

    # Inject security parameters
    args = dict(arguments)
    args["tenant_id"] = str(tenant_id)
    if db is not None:
        args["db"] = db
    if customer_phone:
        # Enforce verified incoming WhatsApp caller number as authoritative patient_phone
        # unless an explicit valid 10+ digit alternate phone was explicitly provided
        explicit_phone = "".join(filter(str.isdigit, str(args.get("patient_phone") or "")))
        if len(explicit_phone) >= 10:
            args["patient_phone"] = explicit_phone
        else:
            args["patient_phone"] = customer_phone

    try:
        result = handler(**args)
        return result
    except TypeError as e:
        # Fallback if arguments differ slightly from signature
        filtered_args = {k: v for k, v in args.items() if k in handler.__code__.co_varnames}
        try:
            return handler(**filtered_args)
        except Exception as inner_e:
            return {"status": "EXECUTION_ERROR", "error": str(inner_e)}
    except Exception as e:
        return {"status": "EXECUTION_ERROR", "error": str(e)}
