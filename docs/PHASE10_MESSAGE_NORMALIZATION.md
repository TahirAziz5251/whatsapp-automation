# Phase 10: Message Normalization Architecture

## Overview
Phase 10 upgrades the incoming message pipeline in `evolution_whatsapp_ai_agent_bot.json` from simple property extraction (`Extract Message Data`) to a centralized **Message Normalizer**.

Regardless of the source WhatsApp instance or raw webhook payload variations, the `Message Normalizer` produces a standardized JSON object that decouples the downstream AI Agent engine from provider-specific schema details.

---

## Standardized Message Object Schema

```json
{
  "instance_name": "pos-instance",
  "user_id": "923XXXXXXXXX",
  "message_id": "ABC123",
  "message_type": "text",
  "message": "iPhone 15 price?",
  "timestamp": "2026-09-24T15:00:00+05:00",
  "source": "whatsapp",
  "business_id": null,
  "session_id": null,
  "profile_id": null
}
```

---

## Field Descriptions & Field Mapping Logic

| Field Name | Data Type | Source / Expression Logic | Description |
|---|---|---|---|
| `instance_name` | String | `{{ $json.body?.instance \|\| $json.body?.body?.instance \|\| $json.instance \|\| 'pos-instance' }}` | WhatsApp instance identifier (e.g. `pos-instance`, `bise-instance`, `hospital-instance`) |
| `user_id` | String | `{{ (($json.body?.data \|\| ...).Info?.Sender \|\| ...).replace(/[^0-9]/g, '') }}` | Normalized phone number / user ID (digits only) |
| `message_id` | String | `{{ ($json.body?.data \|\| ...).Info?.Id \|\| 'MSG_' + Math.random()... }}` | Unique WhatsApp message identifier |
| `message_type` | String | `"text"` | Message classification (e.g., text, image, audio) |
| `message` | String | `{{ ($json.body?.data \|\| ...).Message?.conversation \|\| ... }}` | Extracted text query from conversation, extendedTextMessage, or image/video caption |
| `timestamp` | String | `{{ $now.toISOString() }}` | Standard ISO-8601 UTC timestamp of message arrival |
| `source` | String | `"whatsapp"` | Channel origin |
| `business_id` | String / Null | `null` | Reserved for Phase 11 platform registry lookup |
| `session_id` | String / Null | `null` | Reserved for Phase 11 multi-turn session tracking |
| `profile_id` | String / Null | `null` | Reserved for Phase 11 dynamic AI business profile lookup |

---

## Node Configuration in `evolution_whatsapp_ai_agent_bot.json`

- **Node ID**: `2003`
- **Node Name**: `Message Normalizer`
- **Node Type**: `n8n-nodes-base.set` (v3.3)
- **Position**: `[-760, 1900]`
- **Input Node**: `Is Customer Message?` (Node 2002)
- **Output Node**: `AI Agent` (Node 2004)

---

## Downstream Node Compatibility
To preserve backward compatibility during multi-phase deployment, `Message Normalizer` also populates legacy context variables (`customerPhone`, `sessionId`, `messageText`, `pushName`, `instanceToken`). All downstream nodes (`Window Buffer Memory`, `Tool: Sync CRM`, `Send WhatsApp Response`) have been updated to reference `$('Message Normalizer')`.

---

## Verification Audit
- **JSON Syntax Check**: Verified using Python `json.load()` with `utf-8` encoding.
- **Node Count**: 10 active nodes.
- **Connection Graph**:
  `Evolution Webhook` ➔ `Is Customer Message?` ➔ `Message Normalizer` ➔ `AI Agent` ➔ `Send WhatsApp Response`
