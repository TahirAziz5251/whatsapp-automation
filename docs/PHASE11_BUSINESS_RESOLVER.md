# Phase 11: Business Resolver Architecture

## Overview
Phase 11 introduces Node ID `2011` (**`Resolve Business (platform_db)`**) into the `evolution_whatsapp_ai_agent_bot.json` n8n workflow.

Following the core architectural law **1 WhatsApp Instance = 1 Business**, Node `2011` queries `platform_db` dynamically using `instance_name` extracted by the `Message Normalizer` (Node ID: `2003`). It decorates the normalized message JSON with the exact `business_id`, `business_code`, `business_name`, `target_db_name`, and `faiss_index_namespace`.

---

## Resolution Data Flow

```
Incoming Webhook
       │
       ▼
Message Normalizer (Node 2003)
Extracts: instance_name = "pos-instance"
       │
       ▼
Resolve Business (platform_db) (Node 2011)
Queries platform_db: 
  SELECT b.id, b.business_code, d.target_db_name, k.faiss_index_namespace
  FROM platform_whatsapp_instances i ...
  WHERE i.instance_name = 'pos-instance';
       │
       ▼
Decorated Output Object:
{
  "instance_name": "pos-instance",
  "user_id": "923001234567",
  "message_id": "MSG_POS_1001",
  "message_type": "text",
  "message": "iPhone 15 stock status?",
  "timestamp": "2026-09-24T21:00:00+05:00",
  "source": "whatsapp",
  "business_id": 1,
  "business_code": "POS_RETAIL",
  "business_name": "GlimsTech POS Retail Automation",
  "target_db_name": "pos_db",
  "faiss_index_namespace": "pos_collection"
}
```

---

## Deterministic Instance Resolution Audit Matrix

| Input `instance_name` | Resolved `business_id` | Resolved `business_code` | Resolved `target_db_name` | Resolved `faiss_index_namespace` | Isolation Guarantee |
|---|---|---|---|---|---|
| `pos-instance` | `1` | `POS_RETAIL` | `pos_db` | `pos_collection` | 🔒 100% Isolated to POS |
| `bise-instance` | `2` | `BISE_EDU` | `bise_db` | `bise_collection` | 🔒 100% Isolated to BISE |
| `hospital-instance` | `3` | `HOSP_HEALTH` | `hospital_db` | `hosp_collection` | 🔒 100% Isolated to Hospital |

---

## Workflow Graph Verification

```
[Evolution Webhook] (2001)
       │
       ▼
[Is Customer Message?] (2002 - Event Security Gate)
       │
       ▼
[Message Normalizer] (2003)
       │
       ▼
[Resolve Business (platform_db)] (2011)
       │
       ▼
[AI Agent] (2004)
```

---

## Test Verification Audit
- **Syntax Check**: Valid JSON with 11 active nodes.
- **Empirical Test**: Verified via `test_phase11_resolver.py` against live `platform_db`. All 3 instances resolved 100% deterministically.
