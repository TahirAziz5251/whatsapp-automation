import re
import logging
import httpx
from typing import Optional, Dict, Any
from app.adapters.base import BaseChannelAdapter, NormalizedInboundMessage
from app.core.config import settings

logger = logging.getLogger(__name__)

def parse_lat_lng_from_map_url(map_url: Optional[str]) -> Optional[tuple[float, float]]:
    """Extracts (latitude, longitude) coordinates from Google Maps query URLs."""
    if not map_url:
        return None
    m = re.search(r"(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)", str(map_url))
    if not m:
        return None
    try:
        lat, lng = float(m.group(1)), float(m.group(2))
        if -90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0:
            return lat, lng
    except ValueError:
        pass
    return None


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

        # 5. Extract message text (including interactive button / list replies)
        msg_obj = data.get("Message") or data.get("message") or {}
        if isinstance(msg_obj, str):
            text = msg_obj.strip()
        else:
            btn_resp = msg_obj.get("buttonsResponseMessage") or {}
            list_resp = msg_obj.get("listResponseMessage") or {}
            tpl_btn = msg_obj.get("templateButtonReplyMessage") or {}
            text = str(
                msg_obj.get("conversation")
                or (msg_obj.get("extendedTextMessage") or {}).get("text")
                or btn_resp.get("selectedDisplayText")
                or btn_resp.get("selectedButtonId")
                or list_resp.get("title")
                or (list_resp.get("singleSelectReply") or {}).get("selectedRowId")
                or tpl_btn.get("selectedDisplayText")
                or tpl_btn.get("selectedId")
                or msg_obj.get("text")
                or data.get("caption")
                or data.get("text")
                or body.get("text")
                or ""
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

    def _post_with_token_retry(self, path: str, body: Dict[str, Any], timeout: float = 10.0) -> Dict[str, Any]:
        url = f"{self.api_url}{path}"
        token = self.get_instance_token()
        headers = {"apikey": token, "Content-Type": "application/json"}
        try:
            with httpx.Client(timeout=timeout) as client:
                resp = client.post(url, json=body, headers=headers)
                if resp.status_code == 401 and token != self.api_key:
                    logger.warning(f"Token unauthorized on {path}, retrying with global API key...")
                    headers["apikey"] = self.api_key
                    resp = client.post(url, json=body, headers=headers)

                logger.info(f"Evolution {path} -> HTTP {resp.status_code}")
                return {
                    "success": resp.is_success,
                    "status_code": resp.status_code,
                    "response": resp.json() if resp.is_success else resp.text,
                }
        except Exception as e:
            logger.error(f"Failed Evolution request ({url}): {e}")
            return {"success": False, "status_code": 500, "error": str(e)}

    def send_text_message(self, recipient_phone: str, text: str, **kwargs) -> Dict[str, Any]:
        """Sends WhatsApp text message via Evolution Go API."""
        clean_phone = re.sub(r"[^0-9]", "", recipient_phone)
        return self._post_with_token_retry("/send/text", {"number": clean_phone, "text": text})

    def send_location(
        self,
        recipient_phone: str,
        latitude: float,
        longitude: float,
        name: str = "",
        address: str = "",
    ) -> Dict[str, Any]:
        """Sends a native WhatsApp location pin via Evolution Go (best-effort; map URL is also in text)."""
        clean_phone = re.sub(r"[^0-9]", "", recipient_phone)
        return self._post_with_token_retry(
            "/send/location",
            {
                "number": clean_phone,
                "latitude": float(latitude),
                "longitude": float(longitude),
                "name": name or "Location Pin",
                "address": address or "",
            },
        )

    def send_button_message(
        self,
        recipient_phone: str,
        text: str,
        buttons: list,
        title: Optional[str] = None,
        footer: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Sends native WhatsApp quick reply buttons (up to 3) via Evolution Go POST /send/button.
        Falls back to formatted plain text if button dispatch fails.
        """
        clean_phone = re.sub(r"[^0-9]", "", recipient_phone)
        formatted_buttons = []
        for idx, b in enumerate(buttons[:3], start=1):
            if isinstance(b, str):
                disp = b.strip()[:20]
                b_id = f"btn_{idx}_{re.sub(r'[^a-zA-Z0-9_]', '', disp.lower().replace(' ', '_'))}"
            elif isinstance(b, dict):
                disp = str(b.get("displayText") or b.get("title") or b.get("label") or f"Option {idx}").strip()[:20]
                b_id = str(b.get("id") or f"btn_{idx}_{re.sub(r'[^a-zA-Z0-9_]', '', disp.lower().replace(' ', '_'))}")
            else:
                continue
            formatted_buttons.append({"type": "reply", "displayText": disp, "id": b_id})

        if not formatted_buttons:
            return self.send_text_message(recipient_phone, text)

        body_payload = {
            "number": clean_phone,
            "title": title or "Healthcare Assistant",
            "description": text,
            "footer": footer or (title or "Healthcare Assistant"),
            "buttons": formatted_buttons,
        }

        res = self._post_with_token_retry("/send/button", body_payload)
        if res.get("success"):
            return res

        logger.warning(f"Evolution /send/button failed ({res.get('status_code')}), falling back to text options.")
        opts = [b["displayText"] for b in formatted_buttons]
        return self.send_interactive_options(recipient_phone, text, opts)

    def send_list_message(
        self,
        recipient_phone: str,
        text: str,
        sections: list,
        button_text: str = "Select Option",
        title: Optional[str] = None,
        footer: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Sends an interactive single-select list menu via Evolution Go POST /send/list.
        Falls back to formatted plain text if list dispatch fails.
        """
        clean_phone = re.sub(r"[^0-9]", "", recipient_phone)
        formatted_sections = []
        flat_options = []
        for sec_idx, sec in enumerate(sections):
            sec_title = str(sec.get("title") or f"Section {sec_idx + 1}")[:24]
            raw_rows = sec.get("rows") or []
            rows = []
            for row_idx, r in enumerate(raw_rows):
                if isinstance(r, str):
                    r_title = r.strip()[:24]
                    r_desc = ""
                    r_id = f"row_{sec_idx}_{row_idx}_{re.sub(r'[^a-zA-Z0-9_]', '', r_title.lower().replace(' ', '_'))}"
                elif isinstance(r, dict):
                    r_title = str(r.get("title") or f"Option {row_idx + 1}").strip()[:24]
                    r_desc = str(r.get("description") or "").strip()[:72]
                    r_id = str(r.get("rowId") or r.get("id") or f"row_{sec_idx}_{row_idx}")
                else:
                    continue
                rows.append({"title": r_title, "description": r_desc, "rowId": r_id})
                flat_options.append(f"{r_title} - {r_desc}" if r_desc else r_title)
            if rows:
                formatted_sections.append({"title": sec_title, "rows": rows})

        if not formatted_sections:
            return self.send_text_message(recipient_phone, text)

        body_payload = {
            "number": clean_phone,
            "title": title or "Healthcare Assistant",
            "description": text,
            "buttonText": (button_text or "Select Option")[:20],
            "footerText": footer or (title or "Healthcare Assistant"),
            "sections": formatted_sections,
        }

        res = self._post_with_token_retry("/send/list", body_payload)
        if res.get("success"):
            return res

        logger.warning(f"Evolution /send/list failed ({res.get('status_code')}), falling back to text options.")
        return self.send_interactive_options(recipient_phone, text, flat_options)

    def send_interactive_options(self, recipient_phone: str, body_text: str, options: Optional[list] = None) -> Dict[str, Any]:
        """Sends structured WhatsApp choice list cleanly over reliable plain text."""
        opts = [str(o).strip() for o in (options or []) if str(o).strip()]
        if not opts:
            return self.send_text_message(recipient_phone, body_text)
        numbered = "\n".join(f"{i}. {opt}" for i, opt in enumerate(opts[:10], start=1))
        full_text = f"{body_text.rstrip()}\n\n{numbered}"
        return self.send_text_message(recipient_phone, full_text)

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
