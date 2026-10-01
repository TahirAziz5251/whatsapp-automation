# Phase 19: Business Data Gateway Architecture

## Overview
Phase 19 introduces the **Business Data Gateway** by implementing Node ID `2019` (**`Tool: Business Data Gateway`** with tool identifier `query_business_data`) attached to the `AI Agent (Shared Engine)` in `evolution_whatsapp_ai_agent_bot.json`.

All structured database reads are centralized through this gateway. The AI Agent **never manually chooses arbitrary database credentials or targets**. Instead, the gateway:
1. Intercepts the structured read request.
2. Resolves the caller's trusted `business_code` and approved `target_db_name` (`pos_db`, `bise_db`, `hospital_db`) from the Control Plane (`platform_db`).
3. Enforces domain operation white-lists.
4. Executes structured reads strictly against the mapped private domain database.
5. Logs every read access to `platform_audit_metadata`.

---

## Architectural Data Flow

```
                               ┌────────────────────────────────────────────────────────┐
                               │               Shared AI Agent Engine                   │
                               │          (Calls tool: query_business_data)             │
                               └──────────────────────────┬─────────────────────────────┘
                                                          │
                                                          ▼
                               ┌────────────────────────────────────────────────────────┐
                               │           Node 2019: BUSINESS DATA GATEWAY             │
                               │     - Evaluates Policy & Tenant Authorization          │
                               │     - Enforces Operation Scope (No cross-domain reads) │
                               │     - Agent NEVER supplies arbitrary credentials       │
                               └──────────────────────────┬─────────────────────────────┘
                                                          │
                                   ┌──────────────────────┼──────────────────────┐
                                   ▼                      ▼                      ▼
                            ['POS_RETAIL']           ['BISE_EDU']         ['HOSP_HEALTH']
                                   │                      │                      │
                                   ▼                      ▼                      ▼
                            ┌──────────────┐       ┌──────────────┐       ┌──────────────┐
                            │    pos_db    │       │   bise_db    │       │ hospital_db  │
                            │ (Port 5432)  │       │ (Port 5432)  │       │ (Port 5432)  │
                            ├──────────────┤       ├──────────────┤       ├──────────────┤
                            │ - Products   │       │ - Students   │       │ - Doctors    │
                            │ - Prices     │       │ - Results    │       │ - OPD Clinic │
                            │ - Inventory  │       │ - Fees       │       │ - Schedules  │
                            └──────────────┘       └──────────────┘       └──────────────┘
                                   │                      │                      │
                                   └──────────────────────┼──────────────────────┘
                                                          ▼
                                       ┌────────────────────────────────────┐
                                       │   platform_audit_metadata Log      │
                                       │ (business, phone, payload, latency)│
                                       └────────────────────────────────────┘
```

---

## Approved Domain Operations Matrix

| Tenant Code | Target Database | Approved Operations | Denied Cross-Domain Operations |
|---|---|---|---|
| **`POS_RETAIL`** | `pos_db` | `GET_PRODUCTS`, `GET_PRODUCT_BY_SKU`, `CHECK_INVENTORY` | `GET_EXAM_RESULT`, `GET_DOCTORS_BY_SPECIALTY` ➔ **BLOCKED** |
| **`BISE_EDU`** | `bise_db` | `GET_EXAM_RESULT`, `GET_FEES` | `GET_PRODUCTS`, `CHECK_INVENTORY`, `GET_DOCTORS` ➔ **BLOCKED** |
| **`HOSP_HEALTH`** | `hospital_db` | `GET_DOCTORS_BY_SPECIALTY`, `GET_DOCTOR_SCHEDULE`, `GET_DEPARTMENTS` | `GET_PRODUCTS`, `GET_EXAM_RESULT` ➔ **BLOCKED** |

---

## Audit Logging Standard (`platform_audit_metadata`)

Every read execution logs the following record to `platform_db`:
- `business_code`: Tenant identifier (`POS_RETAIL`, `BISE_EDU`, `HOSP_HEALTH`).
- `instance_name`: Originating WhatsApp instance.
- `customer_phone`: Customer sender identity.
- `inbound_payload`: Structured query parameters and operation name.
- `outbound_payload`: Row count and target database name.
- `processing_time_ms`: Execution latency in milliseconds.

---

## Workflow Integration Graph

```mermaid
flowchart TD
  N2001[2001: Evolution Webhook] --> N2002[2002: Is Customer Message?]
  N2002 --> N2003[2003: Message Normalizer]
  N2003 --> N2011[2011: Resolve Business platform_db]
  N2011 --> N2012[2012: Load Business Profile platform_db]
  N2012 --> N2013[2013: Construct Session Identity]
  N2013 --> N2014[2014: Redis Transient Session & Dedup Gate]
  N2014 --> N2015[2015: PostgreSQL Persistent Conversation Store]
  N2015 --> N2004[2004: AI Agent Shared Engine]
  
  N2005[2005: Groq Chat Model] -.-> N2004
  N2006[2006: Window Buffer Memory] -.-> N2004
  N2007[2007: Tool Search KB - Multi-Tenant] -.-> N2004
  N2009[2009: Tool Manage Calendar] -.-> N2004
  N2010[2010: Tool Sync CRM - Multi-Tenant] -.-> N2004
  N2019[2019: Tool Business Data Gateway] -.-> N2004 🎯
  
  N2004 --> N2008[2008: Send WhatsApp Response Evolution API]
```

---

## Test & Verification Evidence

Executed test harness [`scripts/test_phase19_data_gateway.js`](file:///d:/AI-Automation/scripts/test_phase19_data_gateway.js):

```
================ PHASE 19 BUSINESS DATA GATEWAY VERIFICATION ================
1. Workflow Node 2019 Verification: PASS
   Node ID: 2019
   Node Name: Tool: Business Data Gateway
   Tool Name: query_business_data
2. Workflow Tool Attachment Verification: PASS
   Tool: Business Data Gateway attached to AI Agent (Shared Engine) as ai_tool.
3. Canonical Database Tool Permissions Verification: PASS
   All 3 tenants mapped to their dedicated domain database via query_business_data.

4. Testing Cross-Domain Structured Read Denials (Policy Gate):
   [PASS - DENIED] POS Retail model attempts to read student exam results (GET_EXAM_RESULT)
          Verdict: GATEWAY_CROSS_DOMAIN_DENIED (GATEWAY_OPERATION_UNAUTHORIZED_FOR_TENANT)
   [PASS - DENIED] BISE Education model attempts to read retail inventory (CHECK_INVENTORY)
          Verdict: GATEWAY_CROSS_DOMAIN_DENIED (GATEWAY_OPERATION_UNAUTHORIZED_FOR_TENANT)
   [PASS - DENIED] Hospital Healthcare model attempts to read retail products (GET_PRODUCTS)
          Verdict: GATEWAY_CROSS_DOMAIN_DENIED (GATEWAY_OPERATION_UNAUTHORIZED_FOR_TENANT)

5. Testing Authorized Structured Read Routing:
   [PASS - PERMITTED] POS Retail executes GET_PRODUCTS -> Routes strictly to pos_db
   [PASS - PERMITTED] BISE Education executes GET_EXAM_RESULT -> Routes strictly to bise_db
   [PASS - PERMITTED] Hospital executes GET_DOCTORS_BY_SPECIALTY -> Routes strictly to hospital_db

6. Access Audit Logging Verification: PASS
   Node 2019 logs every data access to platform_audit_metadata with processing time & parameters.

SUCCESS: Phase 19 Business Data Gateway 100% VERIFIED & PASS!
```
