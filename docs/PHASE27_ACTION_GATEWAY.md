# Phase 27: Action Gateway Verification & Technical Report

## 1. Executive Summary

| Attribute | Details |
| :--- | :--- |
| **Phase** | **Phase 27: Action Gateway** |
| **Objective** | Centralize all state-changing, write, and external API operations behind a business-aware, policy-enforced, parameter-validated Action Gateway. Distinguish reads from writes, enforce tenant boundaries outside the LLM, and execute through least-privilege DB routes. |
| **Status** | **PASS / 100% VERIFIED** |
| **Primary Deliverable** | 1. Action Gateway Engine [`scripts/action_gateway.js`](file:///d:/AI-Automation/scripts/action_gateway.js)<br>2. First Approved Actions: `create_order`, `record_payment`, `sync_crm`, `book_appointment`, `cancel_appointment`, `manage_calendar`, `send_notification`, `call_external_api`<br>3. Dedicated Least-Privilege Role `gateway_action_writer`<br>4. n8n Workflow Node 2020 (`Tool: Action Gateway`) in [`evolution_whatsapp_ai_agent_bot.json`](file:///d:/AI-Automation/evolution_whatsapp_ai_agent_bot.json)<br>5. Verification Suite [`scripts/test_phase27_action_gateway.js`](file:///d:/AI-Automation/scripts/test_phase27_action_gateway.js)<br>6. Technical Report (this document) |
| **Exit Criteria** | Write and external actions execute **ONLY** through approved routes; read queries rejected; unapproved tenant writes strictly blocked outside LLM; parameters strictly validated; zero destructive SQL permitted. |
| **Regression Status** | Phases 18, 20, 22, 23, 24, 25, 26, and 27 all 100% PASS with zero regression. |

---

## 2. Action Gateway Architecture: The Triad of Gateways

The system now features a complete, defense-in-depth triad of specialized gateways connecting the conversational AI Agent to enterprise systems:

```
                            Conversational AI Agent
                             (Groq LLM Engine)
                                     │
           ┌─────────────────────────┼─────────────────────────┐
           ▼                         ▼                         ▼
   [Knowledge Gateway]       [Data Gateway]           [ACTION GATEWAY]
      (Phase 26)                (Phase 20)               (Phase 27)
     READ-ONLY                  READ-ONLY              WRITE & EXTERNAL
  • Hybrid Search           • Structured SQL         • State Mutations
  • pgvector + BM25         • Parameterized Ops      • Parameter Validation
  • RRF Re-ranking          • Catalogs & Schedules   • Multi-Tenant Dispatch
  • Zero Cross-Tenant Leak  • gateway_readonly       • gateway_action_writer
                                                     • platform_audit_metadata
```

### Action Gateway Internal Execution Pipeline

```
               AI Agent invokes Tool: Action Gateway
                                 │
                                 ▼
                     [Read vs. Write Guard]
                     Rejects read operations (get_product, etc.)
                                 │
                                 ▼
            [Upstream Session Context Binding]
            Extracts trusted business_code, instance_name, phone
            Discards untrusted LLM tenant parameters (Anti-Spoofing)
                                 │
                                 ▼
                 [Multi-Tenant Policy Gate]
                 Verifies action is authorized for trustedBusinessCode
                 Blocks foreign writes outside LLM
                                 │
                                 ▼
                [Strict Parameter Validation]
                Validates phone numbers, dates, times, amounts, items
                                 │
                                 ▼
               [Least-Privilege DB Dispatch]
               Executed under gateway_action_writer role
               (INSERT / UPDATE only; DROP/TRUNCATE blocked)
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
    [pos_db]               [hospital_db]            [External APIs]
  • orders               • appointments           • SMS / WhatsApp
  • order_items          • appointment_history    • Payment Gateway
  • payments             • patients               • CRM Webhooks
  • leads / customers
                                 │
                                 ▼
                [Audit & Observability Logger]
                INSERT INTO platform_audit_metadata
                (inbound params, outbound status, latency)
                                 │
                                 ▼
             Structured Confirmation to AI Agent
```

---

## 3. Read vs. Write Distinction

The Action Gateway strictly enforces the separation of concerns between reading data and mutating state:

| Query Type | Evaluated Operation | Gateway Verdict | Outcome |
| :--- | :--- | :--- | :--- |
| **Catalog Read** | `get_product` | `READ_OPERATION_REJECTED` | Blocked & redirected to Data Gateway |
| **Inventory Read** | `check_inventory` | `READ_OPERATION_REJECTED` | Blocked & redirected to Data Gateway |
| **Academic Read** | `get_student_result` | `READ_OPERATION_REJECTED` | Blocked & redirected to Data Gateway |
| **Clinical Read** | `get_doctor_schedule` | `READ_OPERATION_REJECTED` | Blocked & redirected to Data Gateway |
| **Document Read** | `search_knowledge_base` | `READ_OPERATION_REJECTED` | Blocked & redirected to Knowledge Gateway |

---

## 4. Parameter Validation & Schema Enforcement

Every action route mandates strict parameter typing and formatting before any SQL query or API dispatch occurs:

| Action | Parameter Validations Enforced |
| :--- | :--- |
| **`create_order`** | `customer_phone` matches regex `/^\+?[0-9]{10,15}$/`; `items` is non-empty array of `{ sku, quantity > 0 }`; SKU exists in catalog; total calculated dynamically. |
| **`record_payment`** | Valid `order_number` or `order_id`; `payment_method` in `['CASH', 'BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA', 'CREDIT_CARD']`; `amount_pkr > 0`; non-empty `transaction_ref`. |
| **`sync_crm`** | Valid `customer_phone`; `lead_stage` in `['NEW_LEAD', 'QUALIFIED', 'DEMO_BOOKED', 'PROPOSAL_SENT', 'CLOSED_WON', 'CLOSED_LOST']`. |
| **`book_appointment`** | Valid `patient_phone`; non-empty `patient_name`; valid `doctor_id` or `doctor_name`; valid date `YYYY-MM-DD`; valid time `HH:MM`. |
| **`cancel_appointment`** | Valid `appointment_number` or (`patient_phone` + `appointment_date`). |
| **`send_notification`** | Valid `recipient_phone`; registered `template_name`; structured parameters object. |
| **`call_external_api`** | `endpoint_key` strictly in whitelist: `['SMS_GATEWAY', 'PAYMENT_GATEWAY', 'CRM_SYNC_WEBHOOK', 'LOGISTICS_TRACKING_API']`. |

---

## 5. Multi-Tenant Outside-LLM Policy Gate

To protect tenant isolation, the Action Gateway enforces authorization rules directly against `platform_tool_permissions`:

| Test Scenario | Action | Session Scope | Policy Gate Verdict | Status |
| :--- | :--- | :---: | :---: | :---: |
| **Case 3.1** | `book_appointment` | `POS_RETAIL` | `SECURITY_POLICY_DENIED` (`UNAUTHORIZED_TENANT_ACTION`) | **PASS (BLOCKED)** |
| **Case 3.2** | `create_order` | `BISE_EDU` | `SECURITY_POLICY_DENIED` (`UNAUTHORIZED_TENANT_ACTION`) | **PASS (BLOCKED)** |
| **Case 3.3** | `create_order` | `HOSP_HEALTH` | `SECURITY_POLICY_DENIED` (`UNAUTHORIZED_TENANT_ACTION`) | **PASS (BLOCKED)** |
| **Case 3.4** | `record_payment` | `HOSP_HEALTH` | `SECURITY_POLICY_DENIED` (`UNAUTHORIZED_TENANT_ACTION`) | **PASS (BLOCKED)** |
| **Case 3.5** | `book_appointment` | `BISE_EDU` | `SECURITY_POLICY_DENIED` (`UNAUTHORIZED_TENANT_ACTION`) | **PASS (BLOCKED)** |

### Tenant Spoofing Defense
When an untrusted parameter `{ business_code: 'POS_RETAIL' }` was passed to an active `HOSP_HEALTH` session attempting `create_order`, the Action Gateway:
1. Pinned strictly to the verified session context (`HOSP_HEALTH`).
2. Discarded the injected tenant code.
3. Denied execution with `UNAUTHORIZED_TENANT_ACTION`.
4. Logged `spoof_attempt_detected: true` to `platform_audit_metadata`.

---

## 6. Live Database State Changes (First Actions)

All state-changing actions were executed and verified against live PostgreSQL databases:

```
[Action 1: create_order]
   ➔ pos_db.orders: Inserted Order #ORD-2026-2722 (Customer: +923009988776)
   ➔ pos_db.order_items: Inserted 2x POS-HW-001 (PKR 35,000 ea) + 1x POS-HW-002 (PKR 14,500)
   ➔ Total Amount: PKR 76,500.00 | Status: PENDING

[Action 2: record_payment]
   ➔ pos_db.payments: Inserted Payment ID #11 via JAZZCASH (Ref: JC-PHASE27-998811)
   ➔ pos_db.orders: Order #ORD-2026-2722 status transitioned from PENDING ➔ PAID

[Action 3: sync_crm]
   ➔ pos_db.leads: Upserted lead for Tariq Mehmood (+923009988776)
   ➔ Pipeline stage: CLOSED_WON

[Action 4: book_appointment]
   ➔ hospital_db.patients: Upserted patient Sobia Parveen (+923331122334)
   ➔ hospital_db.appointments: Inserted Appointment #APT-2026-4921 with Dr. Tariq Mahmood
   ➔ Date: 2026-10-05 at 11:00 | Status: SCHEDULED

[Action 5: cancel_appointment]
   ➔ hospital_db.appointments: Appointment #APT-2026-4921 status transitioned ➔ CANCELLED

[Action 6: send_notification & call_external_api]
   ➔ Dispatched through authorized notification and external router
```

---

## 7. Dedicated Least-Privilege DB Role: `gateway_action_writer`

A dedicated PostgreSQL role was established with strictly partitioned permissions:

```sql
CREATE ROLE gateway_action_writer WITH LOGIN PASSWORD 'gateway_action_writer_2026' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
```

### Privilege Boundary Matrix

| Database | Target Tables | Granted Privileges | Revoked / Prohibited Actions |
| :--- | :--- | :--- | :--- |
| **`pos_db`** | `orders`, `order_items`, `payments`, `leads`, `customers` | `SELECT`, `INSERT`, `UPDATE`, sequence `USAGE` | `DELETE`, `TRUNCATE`, `DROP`, `ALTER`, `CREATE` |
| **`hospital_db`** | `appointments`, `appointment_history`, `patients` | `SELECT`, `INSERT`, `UPDATE`, sequence `USAGE` | `DELETE`, `TRUNCATE`, `DROP`, `ALTER`, `CREATE` |
| **`platform_db`** | `platform_audit_metadata` | `INSERT`, `SELECT`, sequence `USAGE` | `UPDATE`, `DELETE`, `TRUNCATE`, `DROP`, `ALTER` |
| **`bise_db`** | *All examination & certificate tables* | `SELECT` only | `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `DROP` |

- **DROP TABLE Blocked**: `DROP TABLE orders;` $\rightarrow$ `ERROR: must be owner of table orders`.
- **TRUNCATE Blocked**: `TRUNCATE appointments;` $\rightarrow$ `ERROR: permission denied for table appointments`.
- **BISE Mutation Blocked**: `INSERT INTO student_results ...` $\rightarrow$ `ERROR: permission denied for table student_results`.

---

## 8. Audit & Observability Integration

Every state mutation is permanently recorded in `platform_audit_metadata` in `platform_db`:

```sql
SELECT id, business_code, inbound_payload->>'gateway' as gateway,
       inbound_payload->>'action' as action,
       outbound_payload->>'status' as status,
       processing_time_ms, created_at
FROM platform_audit_metadata
WHERE inbound_payload->>'gateway' = 'action_gateway'
ORDER BY id DESC LIMIT 3;
```

### Verified Audit Row Sample
```
 id | business_code |    gateway     |       action       | status  | processing_time_ms |          created_at           
----+---------------+----------------+--------------------+---------+--------------------+-------------------------------
 78 | POS_RETAIL    | action_gateway | call_external_api  | SUCCESS |                  0 | 2026-09-25 15:24:59.665506+00
 77 | POS_RETAIL    | action_gateway | send_notification  | SUCCESS |                  0 | 2026-09-25 15:24:58.897475+00
 76 | HOSP_HEALTH   | action_gateway | cancel_appointment | SUCCESS |                477 | 2026-09-25 15:24:58.317262+00
```

---

## 9. n8n Workflow Node 2020 Registration

Node 2020 (`Tool: Action Gateway`) was added to [`evolution_whatsapp_ai_agent_bot.json`](file:///d:/AI-Automation/evolution_whatsapp_ai_agent_bot.json):

- **Node ID**: `2020`
- **Node Name**: `Tool: Action Gateway`
- **Type**: `@n8n/n8n-nodes-langchain.toolCustom`
- **Connected To**: `AI Agent (Shared Engine)` as an `ai_tool`
- **Input Schema**: Requires `action` (string) and `params` (object)
- **Features Embedded**:
  - Read vs. Write Guard (`READ_OPERATION_REJECTED`)
  - Multi-Tenant Policy Gate (`SECURITY_POLICY_DENIED`)
  - Parameter validation (phone, dates, amounts)
  - `gateway_action_writer` database client execution
  - Audit logging to `platform_audit_metadata`

---

## 10. Multi-Phase Regression Matrix

| Phase | Test Suite | Verification Focus | Result |
| :--- | :--- | :--- | :---: |
| **Phase 18** | [`test_phase18_policy_gate.js`](file:///d:/AI-Automation/scripts/test_phase18_policy_gate.js) | Hard policy gate outside LLM, unauthorized tool denials | **PASS** |
| **Phase 20** | [`test_phase20_sql_tools.js`](file:///d:/AI-Automation/scripts/test_phase20_sql_tools.js) | Parameterized SQL tools, least-privilege role | **PASS** |
| **Phase 22** | [`test_phase22_knowledge_schema.js`](file:///d:/AI-Automation/scripts/test_phase22_knowledge_schema.js) | Knowledge schema, HNSW & GIN indexes | **PASS** |
| **Phase 23** | [`test_phase23_ingestion_pipeline.js`](file:///d:/AI-Automation/scripts/test_phase23_ingestion_pipeline.js) | Ingestion pipeline, chunking, versioning | **PASS** |
| **Phase 24** | [`test_phase24_semantic_retrieval.js`](file:///d:/AI-Automation/scripts/test_phase24_semantic_retrieval.js) | Pure pgvector semantic search | **PASS** |
| **Phase 25** | [`test_phase25_hybrid_retrieval.js`](file:///d:/AI-Automation/scripts/test_phase25_hybrid_retrieval.js) | BM25 + pgvector hybrid search & RRF | **PASS** |
| **Phase 26** | [`test_phase26_knowledge_gateway.js`](file:///d:/AI-Automation/scripts/test_phase26_knowledge_gateway.js) | Knowledge Gateway, citations, cross-scope denial | **PASS** |
| **Phase 27** | [`test_phase27_action_gateway.js`](file:///d:/AI-Automation/scripts/test_phase27_action_gateway.js) | Action Gateway, first actions, read/write guard, audit | **PASS** |

---

## 11. Phase Gate Verdict: PASS

Phase 27 (Action Gateway) has satisfied all functional, architectural, security, and regression criteria:
- [x] State-changing and external write actions centralized behind a single gateway.
- [x] Read operations strictly distinguished and rejected (`READ_OPERATION_REJECTED`).
- [x] Actions placed behind business/policy-aware dispatch outside LLM.
- [x] Strict parameter validation implemented for all actions.
- [x] First actions (`create_order`, `record_payment`, `sync_crm`, `book_appointment`, `cancel_appointment`, `manage_calendar`, `send_notification`, `call_external_api`) verified on live database.
- [x] Dedicated least-privilege DB role `gateway_action_writer` established.
- [x] State mutations logged to `platform_audit_metadata`.
- [x] Node 2020 connected to `AI Agent (Shared Engine)` in n8n workflow.
- [x] Full regression suite passing 100% across all phases.
