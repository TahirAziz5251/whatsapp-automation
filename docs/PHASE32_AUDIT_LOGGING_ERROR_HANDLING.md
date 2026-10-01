# Phase 32: Audit Logging + Error Handling Specification

## Overview & Objective
Phase 32 establishes complete end-to-end request traceability and standardized error handling across the entire AI WhatsApp Automation system. Every inbound user query and workflow operation generates a structured request trace, capturing execution telemetry, intent, latency, and error classification while guaranteeing zero leakage of secrets, auth tokens, database credentials, or PII.

---

## Request Trace Schema (12 Required Fields)

Every request trace is standardized as a JSON object containing 12 core fields:

```json
{
  "request_id": "req_1727339200000_3a8b",
  "business_id": "POS_RETAIL",
  "instance": "pos-instance",
  "user_session": "+923009988776",
  "intent": "create_order",
  "tool_requested": "action_write",
  "tool_executed": "create_order",
  "execution_result": "SUCCESS",
  "response": "Your order ORD-2026-999 has been created successfully.",
  "latency_ms": 142,
  "error": "NONE",
  "error_category": "NONE",
  "error_details": null,
  "timestamp": "2026-09-26T13:42:43.123Z"
}
```

### Trace Field Specification

| Field Name | Type | Description |
| :--- | :--- | :--- |
| `request_id` | `VARCHAR(100)` | Unique prefix-timestamped trace ID generated per incoming request (e.g. `req_172733...`). |
| `business_id` | `VARCHAR(50)` | Verified tenant domain code (`POS_RETAIL`, `HOSP_HEALTH`, `BISE_EDU`, `UNKNOWN`). |
| `instance` | `VARCHAR(100)` | Evolution WhatsApp API instance name associated with the session. |
| `user_session` | `VARCHAR(50)` | Verified requester identifier or phone number. |
| `intent` | `VARCHAR(100)` | Classified user intent or action executed. |
| `tool_requested` | `VARCHAR(100)` | Upstream gateway tool requested (`action_write`, `sql_read`, `knowledge_rag`, `NONE`). |
| `tool_executed` | `VARCHAR(100)` | Specific action executed by downstream handler or `NONE`. |
| `execution_result` | `VARCHAR(50)` | Execution status (`SUCCESS`, `REJECTED`, `ERROR`, `BLOCKED`, `FATAL_ERROR`). |
| `response` | `TEXT` | Sanitized output response text returned to user. |
| `latency_ms` | `INTEGER` | End-to-end request processing duration in milliseconds. |
| `error_category` | `VARCHAR(100)` | Standardized classification of operational or business rule failure. |
| `timestamp` | `TIMESTAMP` | ISO-8601 UTC creation timestamp. |

---

## PostgreSQL Database DDL (`platform_db.platform_audit_metadata`)

```sql
ALTER TABLE platform_audit_metadata 
ADD COLUMN IF NOT EXISTS request_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS intent VARCHAR(100),
ADD COLUMN IF NOT EXISTS tool_requested VARCHAR(100),
ADD COLUMN IF NOT EXISTS tool_executed VARCHAR(100),
ADD COLUMN IF NOT EXISTS execution_result VARCHAR(50),
ADD COLUMN IF NOT EXISTS error_category VARCHAR(100),
ADD COLUMN IF NOT EXISTS error_details JSONB;

CREATE INDEX IF NOT EXISTS idx_pam_req_id ON platform_audit_metadata(request_id);
CREATE INDEX IF NOT EXISTS idx_pam_exec_result ON platform_audit_metadata(execution_result);
```

---

## Secret & Sensitive Data Sanitization (`sanitizeSecrets`)

The sanitization module sweeps all logged strings and JSON structures:

- **Redacted Secret Keys:** `password`, `pass`, `secret`, `token`, `bearer`, `authorization`, `api_key`, `credentials`, `db_url`, `private_key` -> `[REDACTED_SECRET]`
- **Redacted Database URLs:** `postgres://...`, `postgresql://...`, `redis://...` -> `[REDACTED_DB_CONNECTION]`
- **Masked CNIC Numbers:** `35202-1234567-1` -> `35202-*******-1`
- **Masked Credit Cards:** `4532 1122 3344 9988` -> `**** **** **** 9988`
- **Masked IBANs:** `PK36HABB0000112233445566` -> `PK** **** **** **** **** 5566`

---

## Standardized Error Handling Paths

### 1. Recoverable Error Path
- **Trigger:** Read operation sent to write gateway, policy denial, PII violation alert, unapproved action route, false-success block.
- **Behavior:** Returns clear user-facing message explaining the rejection, sets `execution_result: 'REJECTED'` or `'BLOCKED'`, categorizes error (`READ_OPERATION_REJECTED`, `SECURITY_POLICY_DENIED`, etc.), logs audit trace, and continues workflow execution cleanly.

### 2. Fatal Error Path
- **Trigger:** PostgreSQL database crash, connection drop, unhandled JavaScript exception.
- **Behavior:** Catches error safely, redacts internal stack traces from user response, logs full sanitized diagnostic details to audit log, and returns polite user message:  
  `"An operational error occurred while processing your request (Ref: req_1727339200000_3a8b). Please try again later or contact support."`

---

## Verification Results

- **Unit & Integration Suite:** [`scripts/test_phase32_audit_logging.js`](file:///d:/AI-Automation/scripts/test_phase32_audit_logging.js) — **42 / 42 Assertions Passed**
- **Master Regression Suite:** [`scripts/run_all_phase_tests.js`](file:///d:/AI-Automation/scripts/run_all_phase_tests.js) — **18 / 18 Test Suites Passed (100%)**
