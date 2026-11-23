import httpx
from typing import Optional, Dict, Any
from app.adapters.base import BaseChannelAdapter, NormalizedInboundMessage

class MetaCloudApiAdapter(BaseChannelAdapter):
    """
    Adapter for official Meta WhatsApp Cloud API (Graph API v21.0).
    Ready for zero-code-change activation whenever official verification is provisioned.
    """
    def __init__(self, phone_number_id: str = "", access_token: str = ""):
        self.phone_number_id = phone_number_id
        self.access_token = access_token
        self.graph_url = "https://graph.facebook.com/v21.0"

    def normalize_inbound(self, payload: Dict[str, Any]) -> Optional[NormalizedInboundMessage]:
        try:
            entry = payload.get("entry", [{}])[0]
            change = entry.get("changes", [{}])[0]
            val = change.get("value", {})
            
            messages = val.get("messages", [])
            if not messages:
                return None
            
            msg = messages[0]
            # Ignore non-text or system messages for now
            if msg.get("type") != "text":
                return None
            
            msg_id = msg.get("id", "")
            from_phone = msg.get("from", "")
            text_body = msg.get("text", {}).get("body", "").strip()
            
            # Extract push name if available
            contacts = val.get("contacts", [])
            push_name = contacts[0].get("profile", {}).get("name", "Customer") if contacts else "Customer"
            
            phone_num_id = val.get("metadata", {}).get("phone_number_id", self.phone_number_id)

            return NormalizedInboundMessage(
                provider="META_CLOUD_API",
                instance_name=phone_num_id,
                provider_message_id=msg_id,
                customer_phone=from_phone,
                push_name=push_name,
                message_type="text",
                text=text_body,
                raw_payload=payload
            )
        except Exception:
            return None

    def send_text_message(self, recipient_phone: str, text: str, **kwargs) -> Dict[str, Any]:
        url = f"{self.graph_url}/{self.phone_number_id}/messages"
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }
        body = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": recipient_phone,
            "type": "text",
            "text": {"preview_url": False, "body": text}
        }
        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.post(url, json=body, headers=headers)
                return {
                    "success": resp.is_success,
                    "status_code": resp.status_code,
                    "response": resp.json() if resp.is_success else resp.text
                }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_connection_status(self) -> Dict[str, Any]:
        return {"online": bool(self.access_token and self.phone_number_id)}
