# Phase 15: PostgreSQL Persistent Conversation State Architecture

## Overview
Phase 15 implements the **PostgreSQL Persistent Conversation State Layer** by introducing Node ID `2015` (**`PostgreSQL Persistent Conversation Store`**) into the `evolution_whatsapp_ai_agent_bot.json` n8n workflow, backed by durable PostgreSQL relational tables in `platform_db`.

While Redis (Phase 14) handles transient in-memory sessions, rate-limiting, and 5-minute deduplication, Phase 15 guarantees long-term, durable conversation archival, state persistence, retention rules, and LLM context summary compression that survives container reboots, host crashes, or volume resets.

---

## Database Schema Entities (`platform_db`)

| Entity / Table Name | Primary Key | Key Attributes | Retention & Operational Purpose |
|---|---|---|---|
| **1. `conversations`** | `conversation_id` | `session_key`, `business_code`, `instance_name`, `user_id`, `customer_phone`, `push_name`, `status`, `message_count`, `started_at`, `last_active_at`, `closed_at` | Primary master directory for customer conversation sessions across all multi-tenant verticals. |
| **2. `conversation_messages`** | `id` (BIGSERIAL) | `conversation_id`, `message_id`, `sender_type` (`USER`/`AGENT`/`SYSTEM`), `sender_phone`, `message_text`, `metadata`, `is_anonymized`, `created_at` | Durable message history archive. Captures inbound WhatsApp messages and outbound LLM responses. |
| **3. `session_metadata`** | `session_key` | `business_code`, `user_id`, `current_intent`, `context_state`, `retention_days`, `last_sync_at` | Persistent session metadata store preserving state variables and tenant context. |
| **4. `conversation_summary`** | `id` (SERIAL) | `conversation_id`, `summary_text`, `key_intents`, `action_items`, `sentiment`, `last_message_id`, `updated_at` | Periodic & closed conversation summaries for LLM context compression & fast retrieval. |

---

## Workflow Integration Graph

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
[Load Business Profile (platform_db)] (2012)
       │
       ▼
[Construct Session Identity] (2013)
       │
       ▼
[Redis Transient Session & Dedup Gate] (2014)
       │
       ▼
[PostgreSQL Persistent Conversation Store] (2015) 🎯 (Phase 15)
       │
       ▼
[AI Agent] (2004)
       │
       ▼
[Send WhatsApp Response (Evolution API)] (2008)
```

---

## Data Privacy & Retention Rules

1. **Retention Period**: Default session retention is set to 90 days (`retention_days = 90`).
2. **Anonymization Support**: `is_anonymized` flag allows PII scrubbing for compliance without losing message count metrics.
3. **Restart Recovery Guarantee**: All message exchanges are written directly to PostgreSQL `platform_db` before agent tool execution and response dispatch.

---

## Verification & Test Plan

1. **Schema DDL Validation**: Canonical Control-Plane DDL [`database/init-platform-db.sql`](file:///d:/AI-Automation/database/init-platform-db.sql) defines `conversations`, `conversation_messages`, `session_metadata`, and `conversation_summary`.
2. **Workflow Injection & Graph Verification**: Verify Node `2015` position and connection in [`evolution_whatsapp_ai_agent_bot.json`](file:///d:/AI-Automation/evolution_whatsapp_ai_agent_bot.json).
3. **Unit & Integration Test Suite**: Execute test harness to simulate multi-turn messages, verify upserts in `conversations`, `conversation_messages`, and `session_metadata`.
4. **Restart Recovery Verification**: Verify state and message logs survive container restarts.
