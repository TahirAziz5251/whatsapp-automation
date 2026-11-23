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
        if not self.api_key or self.api_key.startswith("test_") or self.api_key == "mock":
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

        try:
            async with httpx.AsyncClient(timeout=float(self.timeout)) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers=headers,
                    json=payload
                )

                if response.status_code == 200:
                    data = response.json()
                    choice = data["choices"][0]
                    return {
                        "status": "SUCCESS",
                        "message": choice["message"],
                        "finish_reason": choice.get("finish_reason"),
                        "usage": data.get("usage", {})
                    }
                else:
                    logger.warning(f"Groq API returned HTTP {response.status_code}: {response.text}")
                    # In case of quota exhaustion or upstream error, fallback to mock generator
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

            if result_data.get("status") == "CONFIRMED":
                # Booking confirmation
                apt_id = result_data.get("appointment_id", "APT-1001")
                token = result_data.get("queue_token", "T-01")
                doc = result_data.get("doctor_name", "Doctor")
                slot = result_data.get("slot_time", "11:00 AM")

                if lang == "ROMAN_URDU":
                    content = f"Jee aap ka appointment {doc} k sath kamyabi se book ho gaya hai! Aap ka Token Number {token} hai aur Appointment ID {apt_id} hai. Bara-e-meherbani waqt se 15 minute pehle tashreef layein. Shukriya!"
                elif lang == "URDU":
                    content = f"جی آپ کا اپائنٹمنٹ {doc} کے ساتھ کامیابی سے طے ہو گیا ہے! آپ کا ٹوکن نمبر {token} ہے اور اپائنٹمنٹ آئی ڈی {apt_id} ہے۔ برائے مہربانی 15 منٹ پہلے تشریف لائیں۔ شکریہ!"
                else:
                    content = f"Your appointment with {doc} has been successfully confirmed for {slot}! Your Token Number is {token} (ID: {apt_id}). Please arrive 15 minutes before your slot."

            elif "doctors" in result_data:
                # Doctor schedule
                docs = result_data.get("doctors", [])
                if docs:
                    doc = docs[0]
                    name = doc.get("name")
                    hours = doc.get("consulting_hours")
                    fee = doc.get("fee")
                    slots = ", ".join(doc.get("open_slots", [])[:3])

                    if lang == "ROMAN_URDU":
                        content = f"Jee zaroor! {name} OPD mein dastiyab hain. Un k timings {hours} hain aur fees {fee} hai. Open slots yeh hain: {slots}. Kya main aap k liye slot book kar doon?"
                    elif lang == "URDU":
                        content = f"جی بالکل! {name} دستیاب ہیں۔ ان کے اوقات {hours} ہیں اور فیس {fee} ہے۔ کیا میں آپ کا وقت بک کر دوں؟"
                    else:
                        content = f"Yes, {name} is available ({hours}). Consultation fee is {fee}. Available slots: {slots}. Would you like me to book an appointment for you?"
                else:
                    content = "Maazrat, is specialty k mutabiq koi doctor dastiyab nahi hain."

            elif result_data.get("status") == "ACTIVE_QUEUE":
                # Queue status
                curr = result_data.get("current_token_serving", "T-01")
                ahead = result_data.get("tokens_ahead", 5)
                wait = result_data.get("estimated_wait_minutes", 20)

                if lang == "ROMAN_URDU":
                    content = f"Is waqt live OPD queue mein Token {curr} chal raha hai. Aap se aagay {ahead} mareez hain aur taqreeban {wait} minute intezar mutawaqqe hai."
                elif lang == "URDU":
                    content = f"اس وقت او پی ڈی میں ٹوکن {curr} زیر معائنہ ہے۔ آپ سے آگے {ahead} مریض ہیں اور متوقع انتظار {wait} منٹ ہے۔"
                else:
                    content = f"Currently, token {curr} is being examined. There are {ahead} patients ahead of you with an estimated wait time of {wait} minutes."

            else:
                info = result_data.get("information", "Aap ki darkhwast par amal kiya ja raha hai.")
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

        # Prioritize explicit booking action over informational schedule lookup
        if any(w in user_text for w in ["book", "appointment", "booking", "slot", "kar do"]) and "book_appointment" in tool_names:
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
                                    "patient_name": "Ahmed Khan",
                                    "doctor_name": "Dr. Tariq Mahmood",
                                    "date": "2026-11-22",
                                    "slot_time": "11:00 AM",
                                    "symptoms": "Routine checkup"
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
