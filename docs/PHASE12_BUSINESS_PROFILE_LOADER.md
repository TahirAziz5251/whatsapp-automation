# Phase 12: Business Profile Loader Architecture

## Overview
Phase 12 introduces Node ID `2012` (**`Load Business Profile (platform_db)`**) into the `evolution_whatsapp_ai_agent_bot.json` n8n workflow.

Following the dynamic resolution from Phase 11 (`business_code`), Node `2012` fetches the exact business profile metadata from `platform_db` control-plane tables:
- `prompt_profile`: `system_prompt`, `timezone`, `currency`
- `language`: `default_language` (`en` / `ur`)
- `allowed_tools`: list of permitted tools (`search_knowledge_base`, `sync_crm`, `manage_calendar`, `check_exam_results`)
- `model_config`: `model_provider`, `model_name`, `temperature`

---

## Business Profile Metadata Audit Matrix

| Business Code | Resolved Domain | System Prompt Focus | Allowed Tools | Model Temp | Target DB | FAISS Namespace |
|---|---|---|---|---|---|---|
| `POS_RETAIL` | POS Retail | Retail products, PKR hardware/software prices, CRM lead sync | `search_knowledge_base`, `sync_crm` | `0.30` | `pos_db` | `pos_collection` |
| `BISE_EDU` | BISE Education | Matric/Inter results by Roll No, Date sheets, Board rules | `search_knowledge_base`, `check_exam_results` | `0.20` | `bise_db` | `bise_collection` |
| `HOSP_HEALTH` | Hospital Healthcare | OPD doctors directory, OPD schedule, Appointment bookings | `search_knowledge_base`, `manage_calendar` | `0.20` | `hospital_db` | `hosp_collection` |

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
[Load Business Profile (platform_db)] (2012) 🎯
       │
       ▼
[AI Agent] (2004)
```

---

## Why Documentation (DOCUMENT Step) Is Essential

1. **Single Source of Truth**: Ensures all table schemas, query structures, node parameters, and payload objects are permanently recorded without relying on memory or guessing.
2. **Auditability & Compliance**: Serves as empirical proof that every phase passed verification testing.
3. **Seamless Onboarding**: Enables developers or future subagents to instantly onboard new business profiles without breaking existing tenant isolation.
