import re
import httpx
from typing import Optional, Dict, Any
from app.adapters.base import BaseChannelAdapter, NormalizedInboundMessage


class MetaCloudApiAdapter(BaseChannelAdapter):
    """
    Adapter for official Meta WhatsApp Cloud API (Graph API v21.0).
    Supports native clickable quick-reply buttons (<=3) and interactive single-select lists (>3).
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
            msg_type = msg.get("type")
            msg_id = msg.get("id", "")
            from_phone = msg.get("from", "")

            if msg_type == "text":
                text_body = msg.get("text", {}).get("body", "").strip()
            elif msg_type == "interactive":
                inter = msg.get("interactive", {})
                btn_reply = inter.get("button_reply") or {}
                list_reply = inter.get("list_reply") or {}
                text_body = (
                    btn_reply.get("title")
                    or btn_reply.get("id")
                    or list_reply.get("title")
                    or list_reply.get("id")
                    or ""
                ).strip()
            else:
                return None

            if not text_body:
                return None

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
                raw_payload=payload,
            )
        except Exception:
            return None

    def _post_graph(self, body: Dict[str, Any]) -> Dict[str, Any]:
        url = f"{self.graph_url}/{self.phone_number_id}/messages"
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }
        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.post(url, json=body, headers=headers)
                return {
                    "success": resp.is_success,
                    "status_code": resp.status_code,
                    "response": resp.json() if resp.is_success else resp.text,
                }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def send_text_message(self, recipient_phone: str, text: str, **kwargs) -> Dict[str, Any]:
        return self._post_graph({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": recipient_phone,
            "type": "text",
            "text": {"preview_url": False, "body": text},
        })

    def send_button_message(
        self,
        recipient_phone: str,
        text: str,
        buttons: list,
        title: Optional[str] = None,
        footer: Optional[str] = None,
    ) -> Dict[str, Any]:
        reply_buttons = []
        for idx, b in enumerate((buttons or [])[:3], start=1):
            lbl = b.strip()[:20] if isinstance(b, str) else str(b.get("displayText") or b.get("title") or f"Option {idx}").strip()[:20]
            b_id = f"btn_{idx}" if isinstance(b, str) else str(b.get("id") or f"btn_{idx}_{re.sub(r'[^a-zA-Z0-9_]', '', lbl.lower())}")
            reply_buttons.append({"type": "reply", "reply": {"id": b_id[:256], "title": lbl}})

        if not reply_buttons:
            return self.send_text_message(recipient_phone, text)

        interactive: Dict[str, Any] = {
            "type": "button",
            "body": {"text": text},
            "action": {"buttons": reply_buttons},
        }
        if footer:
            interactive["footer"] = {"text": str(footer)[:60]}
        if title:
            interactive["header"] = {"type": "text", "text": str(title)[:60]}

        return self._post_graph({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": recipient_phone,
            "type": "interactive",
            "interactive": interactive,
        })

    def send_list_message(
        self,
        recipient_phone: str,
        text: str,
        sections: list,
        button_text: str = "Select Option",
        title: Optional[str] = None,
        footer: Optional[str] = None,
    ) -> Dict[str, Any]:
        formatted_sections = []
        for s_idx, sec in enumerate(sections or []):
            rows = []
            for r_idx, r in enumerate(sec.get("rows") or []):
                r_title = r.strip()[:24] if isinstance(r, str) else str(r.get("title") or f"Option {r_idx + 1}").strip()[:24]
                r_id = f"row_{s_idx}_{r_idx}" if isinstance(r, str) else str(r.get("rowId") or r.get("id") or f"row_{s_idx}_{r_idx}")
                r_desc = "" if isinstance(r, str) else str(r.get("description") or "").strip()[:72]
                row_obj = {"id": r_id[:200], "title": r_title}
                if r_desc:
                    row_obj["description"] = r_desc
                rows.append(row_obj)
            if rows:
                formatted_sections.append({"title": str(sec.get("title") or "Options")[:24], "rows": rows[:10]})

        if not formatted_sections:
            return self.send_text_message(recipient_phone, text)

        interactive: Dict[str, Any] = {
            "type": "list",
            "body": {"text": text},
            "action": {"button": (button_text or "Select Option")[:20], "sections": formatted_sections[:10]},
        }
        if footer:
            interactive["footer"] = {"text": str(footer)[:60]}
        if title:
            interactive["header"] = {"type": "text", "text": str(title)[:60]}

        return self._post_graph({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": recipient_phone,
            "type": "interactive",
            "interactive": interactive,
        })

    def send_button_groups(
        self,
        recipient_phone: str,
        text: str,
        groups: list,
        title: Optional[str] = None,
        footer: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Dispatches 4+ options as a native Meta interactive list (or single button card if <=3)."""
        all_buttons = [b for g in (groups or []) if isinstance(g, dict) for b in (g.get("buttons") or [])]
        if len(all_buttons) <= 3:
            return self.send_button_message(recipient_phone, text, all_buttons, title=title, footer=footer)

        rows = []
        for idx, b in enumerate(all_buttons[:10], start=1):
            lbl = b.strip()[:24] if isinstance(b, str) else str(b.get("displayText") or b.get("title") or f"Option {idx}").strip()[:24]
            b_id = f"opt_{idx}" if isinstance(b, str) else str(b.get("id") or f"opt_{idx}")
            rows.append({"id": b_id, "title": lbl})
        return self.send_list_message(
            recipient_phone=recipient_phone,
            text=text,
            sections=[{"title": (title or "Options")[:24], "rows": rows}],
            button_text="Choose Option",
            title=title,
            footer=footer,
        )

    def get_connection_status(self) -> Dict[str, Any]:
        return {"online": bool(self.access_token and self.phone_number_id)}
