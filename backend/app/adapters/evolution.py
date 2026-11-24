import re
import logging
import httpx
from typing import Optional, Dict, Any
from app.adapters.base import BaseChannelAdapter, NormalizedInboundMessage
from app.core.config import settings

logger = logging.getLogger(__name__)

class EvolutionGoAdapter(BaseChannelAdapter):
    """
    Adapter for Evolution Go (Whatsmeow client).
    Provides WhatsApp messaging for the GlimsTech AI Healthcare Platform.
    """
    def __init__(self, instance_name: str = "alpha-clinic", api_url: Optional[str] = None, api_key: Optional[str] = None):
        self.instance_name = instance_name
        self.api_url = (api_url or getattr(settings, "EVOLUTION_API_URL", "http://evolution-go:4000")).rstrip("/")
        self.api_key = api_key or getattr(settings, "EVOLUTION_API_KEY", "63558bce778d55e61b438b9bd5a0f72326bbac65d52caf0c6ded8b6a8b081b65")
        self._cached_instance_token: Optional[str] = None

    def normalize_inbound(self, payload: Dict[str, Any]) -> Optional[NormalizedInboundMessage]:
        body = payload.get("body", payload)
        data = body.get("data") or body.get("body", {}).get("data", {})
        info = data.get("Info", {})
        key = data.get("key", {})

        # 1. Filter out self messages
        from_me = data.get("IsFromMe", info.get("IsFromMe", key.get("fromMe", False)))
        if from_me is True:
            return None

        # 2. Extract instance name
        instance = str(body.get("instanceName") or body.get("instance") or body.get("body", {}).get("instanceName") or self.instance_name).strip()

        # 3. Extract chat / sender
        chat = str(info.get("Chat") or data.get("Chat") or key.get("remoteJid", ""))
        
        # Filter out groups, broadcasts, newsletters
        if re.search(r"@(g\.us|broadcast|newsletter)$", chat):
            return None
        if info.get("IsGroup") is True:
            return None

        # 4. Extract message ID
        msg_id = str(data.get("ID") or info.get("ID") or info.get("Id") or key.get("id", "")).strip()
        if not msg_id:
            return None

        # 5. Extract message text
        msg_obj = data.get("Message") or data.get("message") or {}
        if isinstance(msg_obj, str):
            text = msg_obj.strip()
        else:
            text = str(
                msg_obj.get("conversation") or 
                msg_obj.get("extendedTextMessage", {}).get("text") or 
                msg_obj.get("text") or
                data.get("caption") or 
                data.get("text") or
                body.get("text") or
                ""
            ).strip()
        if not text:
            return None

        # 6. Extract and clean sender phone number
        candidates = [info.get("SenderAlt"), info.get("Sender"), data.get("Sender"), key.get("remoteJid"), chat]
        valid_candidates = [str(c) for c in candidates if c]
        sender = next((s for s in valid_candidates if "@s.whatsapp.net" in s), valid_candidates[0] if valid_candidates else "")
        
        clean_phone = sender.split("@")[0]
        clean_phone = re.sub(r":\d+$", "", clean_phone)
        clean_phone = re.sub(r"[^0-9]", "", clean_phone)

        if not (7 <= len(clean_phone) <= 16):
            return None

        push_name = str(info.get("PushName") or data.get("PushName") or data.get("pushName") or "Customer")[:80]

        return NormalizedInboundMessage(
            provider="EVOLUTION_GO",
            instance_name=instance,
            provider_message_id=msg_id,
            customer_phone=clean_phone,
            push_name=push_name,
            message_type="text",
            text=text,
            raw_payload=payload
        )

    def get_instance_token(self) -> str:
        """
        Resolves the instance token for this instance.
        Evolution Go's /send/text requires the instance token in the 'apikey' header.
        We fetch it using the global API key from /instance/all.
        """
        if self._cached_instance_token:
            return self._cached_instance_token

        try:
            url = f"{self.api_url}/instance/all"
            headers = {"apikey": self.api_key}
            with httpx.Client(timeout=4.0) as client:
                res = client.get(url, headers=headers)
                if res.is_success:
                    instances = res.json().get("data", [])
                    for inst in instances:
                        if inst.get("name") == self.instance_name:
                            self._cached_instance_token = inst.get("token")
                            logger.info(f"Resolved token for Evolution instance '{self.instance_name}'")
                            return self._cached_instance_token
                    # If only 1 instance exists in Evolution GO, use its token
                    if len(instances) == 1 and instances[0].get("token"):
                        self._cached_instance_token = instances[0].get("token")
                        logger.info(f"Using single active instance token from '{instances[0].get('name')}'")
                        return self._cached_instance_token
        except Exception as e:
            logger.warning(f"Failed to query instance token from {self.api_url}/instance/all: {e}")

        return self.api_key

    def send_text_message(self, recipient_phone: str, text: str, **kwargs) -> Dict[str, Any]:
        """Sends WhatsApp text message via Evolution Go API."""
        clean_phone = re.sub(r"[^0-9]", "", recipient_phone)
        url = f"{self.api_url}/send/text"
        
        token = self.get_instance_token()
        headers = {
            "apikey": token,
            "Content-Type": "application/json"
        }
        body = {
            "number": clean_phone,
            "text": text
        }
        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.post(url, json=body, headers=headers)
                
                # If 401 Unauthorized, retry once with global API key
                if resp.status_code == 401 and token != self.api_key:
                    logger.warning("Token unauthorized on /send/text, retrying with global API key...")
                    headers["apikey"] = self.api_key
                    resp = client.post(url, json=body, headers=headers)

                logger.info(f"Evolution sendText to {clean_phone} -> HTTP {resp.status_code}")
                return {
                    "success": resp.is_success,
                    "status_code": resp.status_code,
                    "response": resp.json() if resp.is_success else resp.text
                }
        except Exception as e:
            logger.error(f"Failed to send text message via Evolution Go ({url}): {e}")
            return {
                "success": False,
                "status_code": 500,
                "error": str(e)
            }

    def get_connection_status(self) -> Dict[str, Any]:
        url = f"{self.api_url}/instance/status"
        headers = {"apikey": self.get_instance_token()}
        try:
            with httpx.Client(timeout=5.0) as client:
                resp = client.get(url, headers=headers)
                return {
                    "online": resp.is_success,
                    "status_code": resp.status_code,
                    "data": resp.json() if resp.is_success else None
                }
        except Exception as e:
            return {"online": False, "error": str(e)}
