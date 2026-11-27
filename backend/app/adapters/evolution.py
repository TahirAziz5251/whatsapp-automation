import re
import time
import hashlib
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
    _unsupported_buttons_instances: set = set()

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

        # 5. Extract message text (including interactive button / list / nativeFlow / poll vote replies)
        msg_obj = data.get("Message") or data.get("message") or {}
        message_type = "text"
        if isinstance(msg_obj, str):
            text = msg_obj.strip()
        elif isinstance(msg_obj, dict) and msg_obj.get("pollUpdateMessage"):
            poll_upd = msg_obj.get("pollUpdateMessage") or {}
            poll_key = poll_upd.get("pollCreationMessageKey") or {}
            poll_id = str(poll_key.get("ID") or poll_key.get("id") or "").strip()
            if not poll_id:
                return None
            text = f"__POLL_VOTE__:{poll_id}"
            message_type = "poll_vote"
        else:
            btn_resp = msg_obj.get("buttonsResponseMessage") or {}
            list_resp = msg_obj.get("listResponseMessage") or {}
            tpl_btn = msg_obj.get("templateButtonReplyMessage") or {}
            inter_resp = msg_obj.get("interactiveResponseMessage") or {}
            nf_resp = inter_resp.get("nativeFlowResponseMessage") or {}
            nf_text = ""
            if nf_resp.get("paramsJson"):
                try:
                    import json as _json
                    nf_params = _json.loads(nf_resp["paramsJson"]) if isinstance(nf_resp["paramsJson"], str) else nf_resp["paramsJson"]
                    if isinstance(nf_params, dict):
                        nf_text = str(nf_params.get("display_text") or nf_params.get("id") or "").strip()
                except Exception:
                    nf_text = ""
            text = str(
                msg_obj.get("conversation")
                or (msg_obj.get("extendedTextMessage") or {}).get("text")
                or btn_resp.get("selectedDisplayText")
                or btn_resp.get("selectedButtonId")
                or btn_resp.get("selectedButtonID")
                or nf_text
                or list_resp.get("title")
                or (list_resp.get("singleSelectReply") or {}).get("selectedRowId")
                or (list_resp.get("singleSelectReply") or {}).get("selectedRowID")
                or tpl_btn.get("selectedDisplayText")
                or tpl_btn.get("selectedId")
                or tpl_btn.get("selectedID")
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
            message_type=message_type,
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

    def _get_with_token_retry(self, path: str, timeout: float = 5.0) -> Dict[str, Any]:
        url = f"{self.api_url}{path}"
        token = self.get_instance_token()
        headers = {"apikey": token}
        try:
            with httpx.Client(timeout=timeout) as client:
                resp = client.get(url, headers=headers)
                if resp.status_code == 401 and token != self.api_key:
                    headers["apikey"] = self.api_key
                    resp = client.get(url, headers=headers)
                return {
                    "success": resp.is_success,
                    "status_code": resp.status_code,
                    "response": resp.json() if resp.is_success else resp.text,
                }
        except Exception as e:
            logger.error(f"Failed Evolution GET ({url}): {e}")
            return {"success": False, "status_code": 500, "error": str(e)}

    def send_poll_message(
        self,
        recipient_phone: str,
        question: str,
        options: list,
        max_answer: int = 1,
    ) -> Dict[str, Any]:
        """
        Sends an interactive single-select WhatsApp Poll via Evolution Go POST /send/poll.
        Renders clickable choices across Desktop, Web, Android, and iOS even when WhatsApp blocks /send/button (405).
        """
        clean_phone = re.sub(r"[^0-9]", "", recipient_phone)
        clean_opts = [str(o).strip()[:100] for o in (options or []) if str(o).strip()]
        # Deduplicate preserving order
        clean_opts = list(dict.fromkeys(clean_opts))[:12]

        if len(clean_opts) < 2:
            return self.send_interactive_options(recipient_phone, question, clean_opts)

        q_text = (question or "Please select an option:").strip()
        # Keep every conversational message at identical standard body font size & support *bold* highlights:
        # WhatsApp Poll titles render larger and ignore *bold*, so dispatch rich/conversational text cleanly first.
        is_substantive_msg = (
            len(q_text) > 48
            or "*" in q_text
            or "\n" in q_text
            or "http" in q_text.lower()
        )
        if is_substantive_msg:
            self.send_text_message(recipient_phone, q_text)
            q_text = "Choose an option:"

        poll_payload = {
            "number": clean_phone,
            "question": q_text,
            "options": clean_opts,
            "maxAnswer": int(max_answer),
        }
        res = self._post_with_token_retry("/send/poll", poll_payload)
        if res.get("success"):
            res["poll_options"] = clean_opts
            return res

        logger.warning(f"Evolution /send/poll failed ({res.get('status_code')}): {res.get('response') or res.get('error')} — falling back to text options.")
        fb = self.send_interactive_options(recipient_phone, question, clean_opts)
        fb["interactive_fallback_reason"] = f"Poll HTTP {res.get('status_code')}: {res.get('response') or res.get('error')}"
        return fb

    def resolve_poll_vote_option(
        self,
        poll_message_id: str,
        vote_message_id: str,
        voter_phone: str,
        candidate_options: list,
    ) -> Optional[str]:
        """
        Resolves a decrypted WhatsApp poll vote SHA-256 hash back to its plaintext option label
        by querying Evolution Go's /polls/{pollMessageId}/results endpoint.
        """
        if not poll_message_id:
            return None

        hash_map = {
            hashlib.sha256(str(opt).strip().encode("utf-8")).hexdigest().lower(): str(opt).strip()
            for opt in (candidate_options or [])
            if str(opt).strip()
        }
        if not hash_map:
            return None

        clean_voter = re.sub(r"[^0-9]", "", voter_phone or "")[-10:]
        for delay in (0.15, 0.25, 0.4, 0.6):
            time.sleep(delay)
            res = self._get_with_token_retry(f"/polls/{poll_message_id}/results")
            if not res.get("success") or not isinstance(res.get("response"), dict):
                continue
            votes = res["response"].get("votes") or []
            matched_vote = None
            for v in reversed(votes):
                if vote_message_id and v.get("voteMessageId") == vote_message_id:
                    matched_vote = v
                    break
                v_ph = re.sub(r"[^0-9]", "", str(v.get("voterPhone") or ""))[-10:]
                if clean_voter and v_ph == clean_voter:
                    matched_vote = v
            if matched_vote:
                sel_opts = matched_vote.get("selectedOptions") or []
                for h_val in sel_opts:
                    h_key = str(h_val).strip().lower()
                    if h_key in hash_map:
                        return hash_map[h_key]
        return None

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
        Automatically uses single-select interactive WhatsApp Poll (/send/poll) when WhatsApp rejects
        button stanzas with 405 on QR-linked multi-device sessions.
        """
        clean_phone = re.sub(r"[^0-9]", "", recipient_phone)
        formatted_buttons = []
        for idx, b in enumerate(buttons[:3], start=1):
            if isinstance(b, str):
                disp = b.strip()[:24]
                b_id = f"btn_{idx}_{re.sub(r'[^a-zA-Z0-9_]', '', disp.lower().replace(' ', '_'))}"
            elif isinstance(b, dict):
                disp = str(b.get("displayText") or b.get("title") or b.get("label") or f"Option {idx}").strip()[:24]
                b_id = str(b.get("id") or f"btn_{idx}_{re.sub(r'[^a-zA-Z0-9_]', '', disp.lower().replace(' ', '_'))}")
            else:
                continue
            formatted_buttons.append({"type": "reply", "displayText": disp[:20], "fullText": disp, "id": b_id})

        if not formatted_buttons:
            return self.send_text_message(recipient_phone, text)

        opts_labels = [b["fullText"] for b in formatted_buttons]

        # If this instance already returned WhatsApp error 405 on buttons, dispatch clickable Poll directly
        if self.instance_name in self._unsupported_buttons_instances:
            return self.send_poll_message(recipient_phone, text, opts_labels, max_answer=1)

        footer_val = footer or (title or "Healthcare Assistant")
        body_payload = {
            "number": clean_phone,
            "title": title or "Healthcare Assistant",
            "description": text,
            "footer": footer_val,
            "footerText": footer_val,
            "buttons": [{"type": b["type"], "displayText": b["displayText"], "id": b["id"]} for b in formatted_buttons],
        }

        res = self._post_with_token_retry("/send/button", body_payload)
        if res.get("success"):
            return res

        err_blob = str(res.get("response") or res.get("error") or "")
        if res.get("status_code") == 405 or "405" in err_blob:
            self._unsupported_buttons_instances.add(self.instance_name)

        logger.warning(f"Evolution /send/button failed ({res.get('status_code')}): {err_blob} — routing via clickable WhatsApp Poll.")
        poll_res = self.send_poll_message(recipient_phone, text, opts_labels, max_answer=1)
        if "interactive_fallback_reason" not in poll_res:
            poll_res["interactive_fallback_reason"] = f"Button HTTP {res.get('status_code')} -> switched to Poll"
        return poll_res

    def send_button_groups(
        self,
        recipient_phone: str,
        text: str,
        groups: list,
        title: Optional[str] = None,
        footer: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Sends 4+ clickable options cleanly:
        - If buttons are unsupported (WhatsApp 405), sends all options in ONE unified clickable Poll.
        - Otherwise attempts sequential quick-reply button bubbles (combining into a Poll on failure).
        """
        valid_groups = [g for g in (groups or []) if isinstance(g, dict) and g.get("buttons")]
        if not valid_groups:
            return self.send_text_message(recipient_phone, text)

        all_labels = []
        for g in valid_groups:
            for b in g.get("buttons") or []:
                lbl = b.strip() if isinstance(b, str) else str(b.get("displayText") or b.get("title") or "").strip()
                if lbl and lbl not in all_labels:
                    all_labels.append(lbl)

        if self.instance_name in self._unsupported_buttons_instances and len(all_labels) >= 2:
            return self.send_poll_message(recipient_phone, text, all_labels, max_answer=1)

        # Try first group as /send/button; if it succeeds, send remaining groups; if 405/fallback -> send ONE Poll with all options
        first_g = valid_groups[0]
        first_btns = first_g.get("buttons") or []
        first_payload_btns = []
        for idx, b in enumerate(first_btns[:3], start=1):
            disp = b.strip()[:20] if isinstance(b, str) else str(b.get("displayText") or b.get("title") or f"Option {idx}").strip()[:20]
            b_id = f"btn_{idx}" if isinstance(b, str) else str(b.get("id") or f"btn_{idx}")
            first_payload_btns.append({"type": "reply", "displayText": disp, "id": b_id})

        clean_phone = re.sub(r"[^0-9]", "", recipient_phone)
        footer_val = first_g.get("footer") or footer or title or "Healthcare Assistant"
        probe_res = self._post_with_token_retry(
            "/send/button",
            {
                "number": clean_phone,
                "title": first_g.get("title") or title or "Healthcare Assistant",
                "description": text,
                "footer": footer_val,
                "footerText": footer_val,
                "buttons": first_payload_btns,
            },
        )
        if probe_res.get("success"):
            for g in valid_groups[1:]:
                self.send_button_message(
                    recipient_phone=recipient_phone,
                    text=str(g.get("text") or "More options:"),
                    buttons=g.get("buttons") or [],
                    title=g.get("title") or title,
                    footer=g.get("footer") or footer,
                )
            return probe_res

        err_blob = str(probe_res.get("response") or probe_res.get("error") or "")
        if probe_res.get("status_code") == 405 or "405" in err_blob:
            self._unsupported_buttons_instances.add(self.instance_name)

        logger.warning(f"Evolution /send/button group failed ({probe_res.get('status_code')}): {err_blob} — dispatching single unified Poll.")
        return self.send_poll_message(recipient_phone, text, all_labels, max_answer=1)

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
        Sends an interactive single-select list menu via Evolution Go POST /send/list,
        automatically falling back to clickable single-select Poll (/send/poll) on 405.
        """
        clean_phone = re.sub(r"[^0-9]", "", recipient_phone)
        formatted_sections = []
        flat_titles = []
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
                flat_titles.append(r_title)
            if rows:
                formatted_sections.append({"title": sec_title, "rows": rows})

        if not formatted_sections:
            return self.send_text_message(recipient_phone, text)

        if self.instance_name in self._unsupported_buttons_instances and len(flat_titles) >= 2:
            return self.send_poll_message(recipient_phone, text, flat_titles, max_answer=1)

        footer_val = footer or (title or "Healthcare Assistant")
        body_payload = {
            "number": clean_phone,
            "title": title or "Healthcare Assistant",
            "description": text,
            "buttonText": (button_text or "Select Option")[:20],
            "footer": footer_val,
            "footerText": footer_val,
            "sections": formatted_sections,
        }

        res = self._post_with_token_retry("/send/list", body_payload)
        if res.get("success"):
            return res

        err_blob = str(res.get("response") or res.get("error") or "")
        if res.get("status_code") == 405 or "405" in err_blob:
            self._unsupported_buttons_instances.add(self.instance_name)

        logger.warning(f"Evolution /send/list failed ({res.get('status_code')}): {err_blob} — routing via clickable WhatsApp Poll.")
        return self.send_poll_message(recipient_phone, text, flat_titles, max_answer=1)

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
