import json
from typing import Dict, Any, List, Optional
from app.services.ai.tools import clinic_tools

# Master Canonical Tool Definitions (OpenAI / Groq Function Calling Schema)
CANONICAL_TOOLS: Dict[str, Dict[str, Any]] = {
    # --- CLINIC / HOSPITAL OPD QUEUE MANAGEMENT TOOLS ---
    "get_departments": {
        "type": "function",
        "function": {
            "name": "get_departments",
            "description": "List all active clinic medical departments/specialties available for booking.",
            "parameters": {"type": "object", "properties": {}, "required": []}
        }
    },
    "get_doctor_schedule": {
        "type": "function",
        "function": {
            "name": "get_doctor_schedule",
            "description": "Check active doctors, specialty, consulting days, hours, fee, and genuinely open appointment slots for a date.",
            "parameters": {
                "type": "object",
                "properties": {
                    "doctor_name_or_specialty": {
                        "type": "string",
                        "description": "Name of the doctor (e.g. 'Dr. Tariq') or medical specialty (e.g. 'Cardiology', 'Pediatrics', 'General Medicine')."
                    },
                    "date": {
                        "type": "string",
                        "description": "Target date (e.g. 'Today', 'Tomorrow', 'Monday', or 'YYYY-MM-DD')."
                    },
                    "preferred_time": {
                        "type": "string",
                        "description": "Optional preferred time (e.g. '11:00 AM', '05:00 PM') to check availability and sort nearest slots."
                    }
                },
                "required": []
            }
        }
    },
    "get_availability": {
        "type": "function",
        "function": {
            "name": "get_availability",
            "description": "Check open database slots for a department or doctor on a specific date before offering times or booking.",
            "parameters": {
                "type": "object",
                "properties": {
                    "department_or_doctor": {
                        "type": "string",
                        "description": "Medical department/specialty or doctor name."
                    },
                    "date": {
                        "type": "string",
                        "description": "Preferred date ('Today', 'Tomorrow', weekday, or 'YYYY-MM-DD')."
                    },
                    "preferred_time": {
                        "type": "string",
                        "description": "Preferred time string if mentioned by the patient."
                    }
                },
                "required": []
            }
        }
    },
    "get_fees": {
        "type": "function",
        "function": {
            "name": "get_fees",
            "description": "Fetch exact published consultation fees from clinic database.",
            "parameters": {
                "type": "object",
                "properties": {
                    "doctor_name_or_specialty": {
                        "type": "string",
                        "description": "Optional doctor name or specialty filter."
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
            "description": "Book a verified clinic appointment after checking open slots and obtaining explicit patient confirmation.",
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
                        "description": "Exact name of the doctor to book with."
                    },
                    "date": {
                        "type": "string",
                        "description": "Date of appointment (e.g. 'YYYY-MM-DD', 'Today', or 'Tomorrow')."
                    },
                    "slot_time": {
                        "type": "string",
                        "description": "Exact verified open slot time (e.g. '11:00 AM')."
                    },
                    "symptoms": {
                        "type": "string",
                        "description": "Brief description of the patient's concern or visit reason."
                    },
                    "patient_age": {
                        "type": "integer",
                        "description": "Patient's age in years if provided."
                    },
                    "appointment_type": {
                        "type": "string",
                        "description": "Visit type: NEW_VISIT or FOLLOW_UP."
                    },
                    "confirmed": {
                        "type": "boolean",
                        "description": "Set true ONLY after the patient has explicitly confirmed the summary of doctor, date, time, patient, and fee."
                    },
                    "idempotency_key": {
                        "type": "string",
                        "description": "Unique booking turn key to prevent duplicate bookings on retries."
                    }
                },
                "required": ["patient_name", "doctor_name", "date", "slot_time", "confirmed"]
            }
        }
    },
    "get_appointments": {
        "type": "function",
        "function": {
            "name": "get_appointments",
            "description": "Retrieve upcoming appointments strictly for the sender's authenticated WhatsApp number.",
            "parameters": {"type": "object", "properties": {}, "required": []}
        }
    },
    "reschedule_appointment": {
        "type": "function",
        "function": {
            "name": "reschedule_appointment",
            "description": "Reschedule an existing booked appointment to a verified open date and slot time.",
            "parameters": {
                "type": "object",
                "properties": {
                    "appointment_id": {
                        "type": "string",
                        "description": "Existing Booking ID (e.g. 'APT-202611-XXXXXX') or Token."
                    },
                    "new_date": {
                        "type": "string",
                        "description": "New appointment date ('YYYY-MM-DD' or 'Tomorrow')."
                    },
                    "new_slot_time": {
                        "type": "string",
                        "description": "Verified open slot time (e.g. '11:30 AM')."
                    },
                    "confirmed": {
                        "type": "boolean",
                        "description": "Set true ONLY after patient explicitly confirmed the reschedule summary."
                    }
                },
                "required": ["appointment_id", "new_date", "new_slot_time", "confirmed"]
            }
        }
    },
    "get_queue_status": {
        "type": "function",
        "function": {
            "name": "get_queue_status",
            "description": "Check real-time live OPD queue status, serving token, patients ahead, and estimated wait time.",
            "parameters": {
                "type": "object",
                "properties": {
                    "appointment_id_or_token": {
                        "type": "string",
                        "description": "The patient's queue token (e.g. 'T-M01') or Booking ID."
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
            "description": "Cancel a scheduled appointment after explicit patient confirmation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "appointment_id": {
                        "type": "string",
                        "description": "Booking ID or Queue Token to cancel."
                    },
                    "reason": {
                        "type": "string",
                        "description": "Reason for cancellation."
                    },
                    "confirmed": {
                        "type": "boolean",
                        "description": "Set true after patient confirms cancellation."
                    }
                },
                "required": ["appointment_id", "confirmed"]
            }
        }
    },
    "check_in_patient": {
        "type": "function",
        "function": {
            "name": "check_in_patient",
            "description": "Check in an arriving patient ('I have arrived') and return live queue token and position.",
            "parameters": {
                "type": "object",
                "properties": {
                    "appointment_id": {
                        "type": "string",
                        "description": "Booking ID or Queue Token of the arriving patient."
                    }
                },
                "required": ["appointment_id"]
            }
        }
    },
    "get_clinic_info": {
        "type": "function",
        "function": {
            "name": "get_clinic_info",
            "description": "Get published clinic address, Google Maps link, reception phone, timings, and policies.",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {
                        "type": "string",
                        "description": "Topic such as address, timings, map, or policy."
                    }
                },
                "required": []
            }
        }
    },
    "search_knowledge_base": {
        "type": "function",
        "function": {
            "name": "search_knowledge_base",
            "description": "Search approved clinic FAQs, lab tests, instructions, and policies via hybrid RAG.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The customer's informational question or search query."
                    }
                },
                "required": ["query"]
            }
        }
    },
    "handoff_to_human": {
        "type": "function",
        "function": {
            "name": "handoff_to_human",
            "description": "Escalate conversation to clinic human reception staff and pause automated AI replies.",
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {
                        "type": "string",
                        "description": "Reason why human reception intervention is needed."
                    },
                    "priority": {
                        "type": "string",
                        "description": "'urgent' for medical emergencies/critical complaints, else 'normal'."
                    }
                },
                "required": ["reason"]
            }
        }
    },
    "escalate_to_human": {
        "type": "function",
        "function": {
            "name": "escalate_to_human",
            "description": "Hand off conversation to human clinic front-desk staff and pause AI replies.",
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


# Dispatch Registry (13 canonical tools + spec-compatible aliases)
TOOL_HANDLERS = {
    "get_departments": clinic_tools.get_departments,
    "get_doctor_schedule": clinic_tools.get_doctor_schedule,
    "search_doctors": clinic_tools.get_doctor_schedule,
    "get_availability": clinic_tools.get_availability,
    "get_fees": clinic_tools.get_fees,
    "book_appointment": clinic_tools.book_appointment,
    "create_booking": clinic_tools.book_appointment,
    "get_appointments": clinic_tools.get_appointments,
    "reschedule_appointment": clinic_tools.reschedule_appointment,
    "cancel_appointment": clinic_tools.cancel_appointment,
    "check_in_patient": clinic_tools.check_in_patient,
    "check_in": clinic_tools.check_in_patient,
    "get_queue_status": clinic_tools.get_queue_status,
    "get_clinic_info": clinic_tools.get_clinic_info,
    "search_knowledge_base": clinic_tools.search_knowledge_base,
    "retrieve_knowledge": clinic_tools.search_knowledge_base,
    "handoff_to_human": clinic_tools.handoff_to_human,
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
        # Enforce verified incoming WhatsApp caller number as authoritative caller_phone
        args["caller_phone"] = customer_phone
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
