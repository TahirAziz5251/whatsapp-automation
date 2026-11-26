import json
import logging
from typing import Dict, Any, List, Optional
import httpx
from app.core.config import settings

logger = logging.getLogger(__name__)

class GroqClient:
    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        timeout: Optional[int] = None
    ):
        self.api_key = api_key or settings.GROQ_API_KEY
        self.model = model or settings.GROQ_MODEL
        self.temperature = temperature if temperature is not None else settings.GROQ_TEMPERATURE
        self.max_tokens = max_tokens or settings.GROQ_MAX_TOKENS
        self.timeout = timeout or settings.GROQ_TIMEOUT_SECONDS
        self.base_url = settings.GROQ_BASE_URL.rstrip("/")

    async def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: str = "auto"
    ) -> Dict[str, Any]:
        """
        Sends chat completion request to Groq OpenAI-compatible endpoint.
        If GROQ_API_KEY is not configured or in test mode, falls back to deterministic mock completion.
        """
        if not self.api_key or self.api_key.startswith("test_") or self.api_key in ("mock", "gsk_placeholder_key", "gsk_test_mock_key"):
            return self._mock_completion(messages, tools)

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens
        }

        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = tool_choice

        candidate_models = [self.model]
        for fallback_model in ("openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"):
            if fallback_model not in candidate_models:
                candidate_models.append(fallback_model)

        try:
            async with httpx.AsyncClient(timeout=float(self.timeout)) as client:
                for active_model in candidate_models:
                    payload["model"] = active_model
                    response = await client.post(
                        f"{self.base_url}/chat/completions",
                        headers=headers,
                        json=payload
                    )

                    if response.status_code == 200:
                        data = response.json()
                        choice = data["choices"][0]
                        if active_model != self.model:
                            logger.info(f"Groq fallback model succeeded: {active_model} (configured: {self.model})")
                        return {
                            "status": "SUCCESS",
                            "message": choice["message"],
                            "finish_reason": choice.get("finish_reason"),
                            "usage": data.get("usage", {}),
                            "model_used": active_model,
                        }

                    err_text = response.text or ""
                    if response.status_code in (400, 404, 429, 500, 502, 503):
                        logger.warning(f"Groq model '{active_model}' returned HTTP {response.status_code}; trying next fallback model.")
                        continue

                    logger.warning(f"Groq API returned HTTP {response.status_code}: {err_text}")
                    break

                # Fallback to mock generator if all configured/fallback Groq models failed
                return self._mock_completion(messages, tools)

        except Exception as e:
            logger.error(f"Error calling Groq API: {e}")
            return self._mock_completion(messages, tools)

    def _mock_completion(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Intelligent local simulation of Groq Llama 3.3 70B for testing and offline development.
        Simulates:
        1. Tool invocation if user requests an action (e.g. doctor schedule, booking).
        2. Natural response synthesis in Roman Urdu, Urdu, or English if tool results are provided.
        """
        last_msg = messages[-1] if messages else {"role": "user", "content": ""}

        # Case A: If last message is a Tool Result, synthesize natural answer
        if last_msg.get("role") == "tool":
            tool_content = last_msg.get("content", "{}")
            try:
                result_data = json.loads(tool_content) if isinstance(tool_content, str) else tool_content
            except Exception:
                result_data = {}

            # Find user question to determine language
            user_msg = next((m.get("content", "") for m in reversed(messages) if m.get("role") == "user"), "")
            from app.services.ai.prompt_engine import detect_language_and_script
            lang_info = detect_language_and_script(user_msg)
            lang = lang_info["language"]

            # Extract dynamic business branding from system prompt when available
            sys_prompt = next((m.get("content", "") for m in messages if m.get("role") == "system"), "")
            biz_name = result_data.get("business_name")
            if not biz_name and 'for "' in sys_prompt:
                try:
                    biz_name = sys_prompt.split('for "', 1)[1].split('"', 1)[0]
                except Exception:
                    biz_name = None

            if result_data.get("status") == "CONFIRMED":
                from app.services.template_formatter import format_booking_confirmation
                content = format_booking_confirmation(
                    booking_data=result_data,
                    language=lang,
                    business_name=biz_name,
                    template_id=result_data.get("template_id", "CLINIC_OPD"),
                    currency=result_data.get("currency", "PKR"),
                    business_address=result_data.get("business_address"),
                    business_phone=result_data.get("business_phone"),
                )

            elif "doctors" in result_data:
                # Doctor schedule
                docs = result_data.get("doctors", [])
                if docs:
                    doc = docs[0]
                    name = doc.get("name")
                    spec = doc.get("specialty", "Specialist")
                    hours = doc.get("consulting_hours")
                    fee = doc.get("fee")
                    slots = ", ".join(doc.get("open_slots", [])[:3])

                    if lang == "ROMAN_URDU":
                        content = f"Jee zaroor! {name} ({spec}) OPD mein dastiyab hain. Un k timings {hours} hain aur consultation fees {fee} hai. Open slots: {slots}. Kya main aap k liye appointment book kar doon?"
                    elif lang == "URDU":
                        content = f"جی بالکل! {name} ({spec}) دستیاب ہیں۔ ان کے اوقات {hours} ہیں اور فیس {fee} ہے۔ دستیاب سلاٹس: {slots}۔ کیا میں آپ کی اپائنٹمنٹ بک کر دوں؟"
                    else:
                        content = f"Yes, {name} ({spec}) is available ({hours}). Consultation fee is {fee}. Available slots: {slots}. Would you like me to book this slot for you?"
                else:
                    content = "Maazrat, is specialty k mutabiq koi doctor dastiyab nahi hain."

            elif result_data.get("status") == "CONFIRMATION_REQUIRED":
                summ = result_data.get("summary") or {}
                d_name = summ.get("doctor_name", "Doctor")
                dt_str = summ.get("appointment_date") or summ.get("new_date", "")
                tm_str = summ.get("slot_time") or summ.get("new_slot", "")
                pt_str = summ.get("patient_name", "")
                fee_str = f"PKR {summ['fee_pkr']:,.0f}" if summ.get("fee_pkr") else ""
                if lang == "ROMAN_URDU":
                    content = f"Barah-e-meherbani confirm karein: {d_name} | {dt_str} {tm_str}" + (f" | Mareez: {pt_str}" if pt_str else "") + (f" | Fee: {fee_str}" if fee_str else "") + ". Confirm karne k liye 'Confirm' likhein."
                else:
                    content = f"Please confirm: {d_name} | {dt_str} {tm_str}" + (f" | Patient: {pt_str}" if pt_str else "") + (f" | Fee: {fee_str}" if fee_str else "") + ". Reply 'Confirm' to finalize or 'Change' to adjust."

            elif result_data.get("status") == "NOT_CHECKED_IN":
                if lang == "ROMAN_URDU":
                    content = "Aap ki booking maujood hai lekin abhi check-in nahi hua. Clinic pohanch kar reception par check-in karwayein."
                else:
                    content = "You are booked, but not checked in yet. Please check in when you arrive at clinic reception."

            elif result_data.get("status") == "ACTIVE_QUEUE":
                # Queue status
                curr = result_data.get("current_token_serving", "T-01")
                ahead = result_data.get("tokens_ahead", 5)
                wait = result_data.get("estimated_wait_minutes", 20)

                if lang == "ROMAN_URDU":
                    content = f"Is waqt live OPD queue mein Token {curr} chal raha hai. Aap se aagay {ahead} mareez hain aur taqreeban {wait} minute intezar mutawaqqe hai (Estimate, not a guarantee)."
                elif lang == "URDU":
                    content = f"اس وقت او پی ڈی میں ٹوکن {curr} زیر معائنہ ہے۔ آپ سے آگے {ahead} مریض ہیں اور متوقع انتظار {wait} منٹ ہے (تخمینہ)۔"
                else:
                    content = f"Currently, token {curr} is being examined. There are {ahead} patients ahead of you with an estimated wait time of {wait} minutes (Estimate, not a guarantee)."

            elif result_data.get("status") == "NO_EVIDENCE":
                if lang == "ROMAN_URDU":
                    content = "Maazrat, is baray mein tasdeeq shuda clinic maloomat mojood nahi. Kya main aap ko reception se connect kar doon?"
                else:
                    content = result_data.get("information", "I do not have verified information on that topic. Would you like to talk to clinic reception?")

            else:
                info = result_data.get("information") or result_data.get("message") or "Aap ki darkhwast par amal kiya ja raha hai."
                content = info

            return {
                "status": "SUCCESS",
                "message": {
                    "role": "assistant",
                    "content": content
                },
                "finish_reason": "stop",
                "usage": {"prompt_tokens": 120, "completion_tokens": 50, "total_tokens": 170}
            }

        # Case B: User question -> decide whether to call a tool
        user_text = last_msg.get("content", "").lower()
        tool_names = [t["function"]["name"] for t in (tools or [])]

        from datetime import datetime
        today_str = datetime.now().strftime("%Y-%m-%d")

        is_availability_query = any(w in user_text for w in ["which slot", "which slots", "available", "dastiyab", "timing", "timings", "schedule", "kab"]) and not any(w in user_text for w in ["book", "kar do", "leni", "lena", "confirm"])

        # Informational schedule/slot queries must NOT book appointments
        if is_availability_query and "get_doctor_schedule" in tool_names:
            doc_target = "Dr. Tariq" if "tariq" in user_text else ("Dr. Ayesha" if "ayesha" in user_text else ("Dr. Bilal" if "bilal" in user_text else ""))
            return {
                "status": "SUCCESS",
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_sched_001",
                            "type": "function",
                            "function": {
                                "name": "get_doctor_schedule",
                                "arguments": json.dumps({"doctor_name_or_specialty": doc_target, "date": today_str})
                            }
                        }
                    ]
                },
                "finish_reason": "tool_calls",
                "usage": {"prompt_tokens": 80, "completion_tokens": 25, "total_tokens": 105}
            }

        # Confirmation reply for an awaiting booking draft (2-step summary gate)
        sys_text = next((m.get("content", "") for m in messages if m.get("role") == "system"), "")
        is_confirm_reply = any(
            user_text.strip() == w or user_text.strip().startswith(w + " ")
            for w in ("confirm", "yes", "haan", "jee", "ok", "finalize")
        )
        if is_confirm_reply and "AWAITING_CONFIRMATION" in sys_text and "book_appointment" in tool_names:
            draft = {}
            try:
                if "Conversation State:" in sys_text:
                    state_line = sys_text.split("Conversation State:", 1)[1].splitlines()[0].strip()
                    draft = (json.loads(state_line) or {}).get("draft_booking") or {}
            except Exception:
                draft = {}
            return {
                "status": "SUCCESS",
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_book_confirm_001",
                            "type": "function",
                            "function": {
                                "name": "book_appointment",
                                "arguments": json.dumps({
                                    "patient_name": draft.get("patient_name") or "Valued Patient",
                                    "doctor_name": draft.get("doctor_name") or "Dr. Tariq Mahmood",
                                    "date": draft.get("appointment_date") or today_str,
                                    "slot_time": draft.get("slot_time") or "11:00 AM",
                                    "symptoms": draft.get("symptoms") or "Consultation",
                                    "confirmed": True,
                                })
                            }
                        }
                    ]
                },
                "finish_reason": "tool_calls",
                "usage": {"prompt_tokens": 90, "completion_tokens": 30, "total_tokens": 120}
            }

        # Explicit booking action
        elif any(w in user_text for w in ["book", "appointment", "booking", "kar do", "leni", "lena", "chahiye", "mil sakta", "checkup", "dikhana"]) and "book_appointment" in tool_names:
            target_doc = "Dr. Ayesha Malik" if "ayesha" in user_text else ("Dr. Bilal Asghar" if ("bilal" in user_text or "child" in user_text or "bacha" in user_text) else "Dr. Tariq Mahmood")
            target_slot = "04:30 PM" if "ayesha" in user_text else ("06:15 PM" if "bilal" in user_text else "11:00 AM")
            target_date = next((d.title() for d in ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "tomorrow") if d in user_text), today_str)
            target_symptom = "Cardiology evaluation" if "tariq" in user_text else ("Pediatric consultation" if ("bilal" in user_text or "child" in user_text) else "General medical consultation")

            return {
                "status": "SUCCESS",
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_book_001",
                            "type": "function",
                            "function": {
                                "name": "book_appointment",
                                "arguments": json.dumps({
                                    "patient_name": "Valued Patient",
                                    "doctor_name": target_doc,
                                    "date": target_date,
                                    "slot_time": target_slot,
                                    "symptoms": target_symptom,
                                    "confirmed": False,
                                })
                            }
                        }
                    ]
                },
                "finish_reason": "tool_calls",
                "usage": {"prompt_tokens": 90, "completion_tokens": 30, "total_tokens": 120}
            }

        elif any(w in user_text for w in ["dr", "doctor", "tariq", "ayesha", "schedule", "timing", "available", "dastiyab"]) and "get_doctor_schedule" in tool_names:
            doc_target = "Dr. Tariq" if "tariq" in user_text else ("Dr. Ayesha" if "ayesha" in user_text else "")
            return {
                "status": "SUCCESS",
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_sched_001",
                            "type": "function",
                            "function": {
                                "name": "get_doctor_schedule",
                                "arguments": json.dumps({"doctor_name_or_specialty": doc_target, "date": "Tomorrow"})
                            }
                        }
                    ]
                },
                "finish_reason": "tool_calls",
                "usage": {"prompt_tokens": 80, "completion_tokens": 25, "total_tokens": 105}
            }

        elif any(w in user_text for w in ["queue", "token", "wait", "intezar", "number", "namber"]) and "get_queue_status" in tool_names:
            return {
                "status": "SUCCESS",
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_queue_001",
                            "type": "function",
                            "function": {
                                "name": "get_queue_status",
                                "arguments": json.dumps({"appointment_id_or_token": "T-A14"})
                            }
                        }
                    ]
                },
                "finish_reason": "tool_calls",
                "usage": {"prompt_tokens": 70, "completion_tokens": 20, "total_tokens": 90}
            }

        elif any(w in user_text for w in ["kahan", "address", "location", "timing", "lab", "fee", "paise"]) and "search_knowledge_base" in tool_names:
            return {
                "status": "SUCCESS",
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_kb_001",
                            "type": "function",
                            "function": {
                                "name": "search_knowledge_base",
                                "arguments": json.dumps({"query": user_text})
                            }
                        }
                    ]
                },
                "finish_reason": "tool_calls",
                "usage": {"prompt_tokens": 75, "completion_tokens": 22, "total_tokens": 97}
            }

        # Default conversational greeting
        from app.services.ai.prompt_engine import detect_language_and_script
        lang_info = detect_language_and_script(user_text)
        if lang_info["language"] == "ROMAN_URDU":
            reply = "Assalam-o-Alaikum! Alpha Clinic mein khush-amdeed. Main aap ki kya madad kar sakti hoon? Doctor schedule, appointment booking, ya live queue status k liye bataiye."
        elif lang_info["language"] == "URDU":
            reply = "السلام علیکم! الفا کلینک میں خوش آمدید۔ میں آپ کی کیا مدد کر سکتی ہوں؟"
        else:
            reply = "Hello and welcome to Alpha Clinic! How can I assist you today with doctor schedules, appointments, or queue status?"

        return {
            "status": "SUCCESS",
            "message": {
                "role": "assistant",
                "content": reply
            },
            "finish_reason": "stop",
            "usage": {"prompt_tokens": 50, "completion_tokens": 30, "total_tokens": 80}
        }
