# Phase 28: Business-Specific Domain Actions & Transaction Integrity

## 1. Executive Summary & Objective

**Phase 28** expands the Centralized Action Gateway established in Phase 27 into a full suite of **production-grade V1 Domain Actions** across all three canonical business verticals:
- **Retail & Point of Sale (`pos_db` / `POS_RETAIL`)**: Order creation with automatic stock deduction, order status updates, and order cancellation with atomic inventory restocking.
- **Educational Board (`bise_db` / `BISE_EDU`)**: Certificate verification requests validated against immutable exam results, service applications (migration certificates, duplicate marksheets, paper rechecking) with dynamic fee lookups, and application tracking.
- **Healthcare & Hospital OPD (`hospital_db` / `HOSP_HEALTH`)**: Clinical appointment creation/booking, appointment rescheduling with double-booking prevention, cancellation with reason tracking, and automated appointment history audit logging.

Every state-changing action is strictly **atomic**, **schema-validated**, **isolated by trusted tenant session**, and executed under the dedicated least-privilege PostgreSQL role **`gateway_action_writer`**.

---

## 2. Architecture & Request Pipeline

```
              WhatsApp Message / AI Agent (LLM)
                             │
                             ▼
               Action Gateway (Node 2020 / action_gateway.js)
                             │
     ┌───────────────────────┴────────────────────────┐
     ▼                                                ▼
[Policy Gate Outside LLM]                [Read vs. Write Guard]
Check trusted business_code              Reject get_*, check_*, search_*
vs. ACTION_PERMISSIONS matrix            Direct reads to Read Gateways
     │
     ▼
[Parameter Validation]
Phone regex, dates, items array, SKUs, slot formatting
     │
     ▼
[Least-Privilege Execution (gateway_action_writer)]
     ├── POS: BEGIN -> Insert Order -> Deduct Stock -> COMMIT
     ├── BISE: Check Roll Record -> Lookup Fee -> Insert Application
     └── HOSP: Check Conflict -> Insert Appointment -> Log History
     │
     ▼
[Audit Logging (platform_audit_metadata)]
Log action, parameters, execution time, result, tenant spoof flag
     │
     ▼
Structured Output Context returned to AI Agent
```

---

## 3. V1 Domain Action Authorization Matrix

| Domain / Tenant | Action | Target Table(s) | Transactional Atomicity & Business Logic |
| :--- | :--- | :--- | :--- |
| **POS_RETAIL** | `create_order` | `orders`, `order_items`, `customers`, `inventory` | Validates stock in `inventory`; inserts customer & order; deducts inventory stock atomically. |
| **POS_RETAIL** | `update_order` | `orders` | Validates order exists; blocks updates on `CANCELLED` orders; updates status (`CONFIRMED`, `SHIPPED`, etc.). |
| **POS_RETAIL** | `cancel_order` | `orders`, `inventory`, `order_items` | Blocks cancellation if `SHIPPED` or `DELIVERED`; restores deducted stock to `inventory`; sets status to `CANCELLED`. |
| **POS_RETAIL** | `record_payment` | `payments`, `orders` | Validates payment method (`CASH`, `JAZZCASH`, etc.); logs transaction reference; sets order status to `PAID`. |
| **POS_RETAIL** | `sync_crm` | `leads` | Upserts lead stage (`NEW_LEAD`, `QUALIFIED`, `CLOSED_WON`) and customer contact info. |
| **BISE_EDU** | `submit_verification_request` | `verification_requests`, `results` (read) | Validates roll number against official `results` records; creates verification request in `PENDING` status. |
| **BISE_EDU** | `submit_service_application` | `applications`, `fees` (read), `students` (read) | Resolves student details; looks up official fee from `fees`; creates application in `PROCESSING` status with payment challan. |
| **BISE_EDU** | `track_service_application` | `applications`, `verification_requests` | Queries application or verification status by application number or reference. |
| **HOSP_HEALTH** | `create_appointment` / `book_appointment` | `appointments`, `appointment_history`, `patients` | Checks for doctor schedule conflicts (double booking); creates appointment; logs initial history record. |
| **HOSP_HEALTH** | `reschedule_appointment` | `appointments`, `appointment_history` | Prevents rescheduling `CANCELLED` appointments; validates doctor slot availability; updates schedule; logs audit history. |
| **HOSP_HEALTH** | `cancel_appointment` | `appointments`, `appointment_history` | Sets status to `CANCELLED`; logs cancellation reason in `appointment_history`. |
| **HOSP_HEALTH** | `manage_calendar` | External / Service | Processes calendar slot scheduling and availability inquiries. |
| **Multi-Tenant** | `send_notification` | External Gateway | Queues outbound WhatsApp / SMS templates across all approved tenants. |
| **Multi-Tenant** | `call_external_api` | Whitelisted Endpoints | Dispatches to approved endpoints (`SMS_GATEWAY`, `PAYMENT_GATEWAY`, `LOGISTICS_TRACKING_API`). |

---

## 4. Parameter Validation & Schema Enforcement

Each action requires strict parameter validation before any SQL is executed:

1. **Phone Numbers**: Validated via international and Pakistani regular expressions (`/^\+?[0-9]{10,15}$/`).
2. **Dates & Times**: ISO format `YYYY-MM-DD` and 24-hour `HH:MM` validated.
3. **POS Items**: Must be a non-empty array of objects containing string `sku` and integer `quantity > 0`.
4. **BISE Services**: Must match approved enum `['NOC_MIGRATION', 'DUPLICATE_MARKSHEET', 'RECHECKING_PER_PAPER', 'DUPLICATE_DEGREE', 'CORRECTION_NAME']`.
5. **Payment Methods**: Validated against `['CASH', 'BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA', 'CREDIT_CARD']`.
6. **External Endpoints**: Must match strict whitelist `['SMS_GATEWAY', 'PAYMENT_GATEWAY', 'CRM_SYNC_WEBHOOK', 'LOGISTICS_TRACKING_API']`.

---

## 5. Transactional Integrity & Database Atomicity

### 5.1 POS Inventory Stock Deduction & Restocking
- **Deduction on Order Creation**:
  ```sql
  BEGIN;
  INSERT INTO orders (order_number, customer_id, total_amount_pkr, status) VALUES (...);
  INSERT INTO order_items (order_id, product_id, quantity, unit_price_pkr, subtotal_pkr) VALUES (...);
  UPDATE inventory SET stock_quantity = stock_quantity - 2, updated_at = CURRENT_TIMESTAMP WHERE product_id = 2;
  COMMIT;
  ```
- **Restocking on Order Cancellation**:
  ```sql
  BEGIN;
  UPDATE inventory SET stock_quantity = stock_quantity + 2, updated_at = CURRENT_TIMESTAMP WHERE product_id = 2;
  UPDATE orders SET status = 'CANCELLED' WHERE id = 15;
  COMMIT;
  ```
  If requested quantity exceeds available stock, the transaction fails immediately before any order record is generated.

### 5.2 Hospital Double-Booking Prevention & History Logging
- **Conflict Query**:
  ```sql
  SELECT COUNT(*) FROM appointments 
  WHERE doctor_id = $1 AND appointment_date = $2 AND appointment_time = $3 AND status = 'SCHEDULED';
  ```
- **Audit Logging in `appointment_history`**:
  Whenever an appointment is booked, rescheduled, or cancelled, a corresponding record is atomically committed to `appointment_history` detailing the doctor notes, old schedule, new schedule, and reason.

---

## 6. Least-Privilege Role Architecture

PostgreSQL least-privilege enforcement isolates read-only and write operations:

| Role Name | Database | Allowed Privileges | Prohibited Privileges |
| :--- | :--- | :--- | :--- |
| **`gateway_readonly`** | All DBs | `SELECT` on all tables | `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `ALTER`, `DROP` |
| **`gateway_action_writer`** | `pos_db` | `SELECT` on catalog; `INSERT`, `UPDATE` on `orders`, `order_items`, `inventory`, `payments`, `leads`, `customers` | `DELETE`, `TRUNCATE`, `ALTER`, `DROP` |
| **`gateway_action_writer`** | `bise_db` | `SELECT` on `results`, `students`, `exams`, `fees`; `INSERT`, `UPDATE` on `applications`, `verification_requests`, `leads` | `INSERT/UPDATE/DELETE` on `results`, `students`, `exams`, `fees`; `DELETE`, `TRUNCATE` |
| **`gateway_action_writer`** | `hospital_db`| `SELECT` on `doctors`, `departments`, `schedules`; `INSERT`, `UPDATE` on `appointments`, `appointment_history`, `patients`, `leads` | `INSERT/UPDATE/DELETE` on `doctors`, `departments`, `schedules`; `DELETE`, `TRUNCATE` |
| **`gateway_action_writer`** | `platform_db`| `SELECT` on business mappings & permissions; `INSERT` on `platform_audit_metadata` | `DELETE`, `TRUNCATE`, `ALTER`, `DROP` |

> [!IMPORTANT]
> Official examination results (`bise_db.results`) remain **strictly immutable**. Even under `gateway_action_writer`, any attempt to alter student scores returns: `ERROR: permission denied for table results`.

---

## 7. Verification Evidence & Test Results

The comprehensive test suite [`scripts/test_phase28_domain_actions.js`](file:///d:/AI-Automation/scripts/test_phase28_domain_actions.js) verified all 41 test scenarios:

```
========================================================================
   PHASE 28 TEST SUITE: BUSINESS-SPECIFIC DOMAIN ACTIONS & TRANSACTIONS
========================================================================

--- 1. POS Domain Actions (pos_db) ---
  [INFO] Initial stock for POS-HW-002: 148 units
  [PASS] POS create_order executed successfully
  [PASS] Order created with number ORD-TEST-1790352610067
  [PASS] Inventory deducted atomically (148 -> 146)
  [PASS] create_order rejected when requested quantity exceeds available stock
  [PASS] Error message accurately indicates insufficient inventory
  [PASS] POS update_order executed successfully
  [PASS] Order status updated to CONFIRMED
  [PASS] POS cancel_order executed successfully
  [PASS] cancel_order reported 2 units restocked
  [PASS] Inventory restored atomically (146 -> 148)
  [PASS] Cancelling an already CANCELLED order is rejected

--- 2. BISE Educational Domain Actions (bise_db) ---
  [PASS] BISE submit_verification_request executed successfully
  [PASS] Roll number verified against examination records
  [PASS] Verification request registered in PENDING status
  [PASS] submit_verification_request rejects unverified roll number
  [PASS] BISE submit_service_application executed successfully
  [PASS] Fee lookup dynamically resolved PKR 1,800.00 for NOC_MIGRATION
  [PASS] Application registered in PROCESSING status
  [PASS] BISE track_service_application resolved application
  [PASS] Tracked status is PROCESSING
  [PASS] BISE track_service_application resolved verification request
  [PASS] Tracked verification status is PENDING

--- 3. Hospital Clinical Domain Actions (hospital_db) ---
  [PASS] Hospital create_appointment executed successfully
  [PASS] Doctor resolved correctly
  [PASS] Double-booking prevention blocked overlapping slot
  [PASS] Error clarifies slot conflict
  [PASS] Hospital reschedule_appointment executed successfully
  [PASS] New schedule confirmed
  [PASS] Appointment history tracked atomically (2 entries logged)
  [PASS] Hospital cancel_appointment executed successfully
  [PASS] Rescheduling a CANCELLED appointment is blocked

--- 4. Multi-Tenant Cross-Domain Policy Gate ---
  [PASS] POS cannot execute BISE submit_verification_request
  [PASS] Blocked with UNAUTHORIZED_TENANT_ACTION
  [PASS] POS cannot execute Hospital reschedule_appointment
  [PASS] BISE cannot execute POS create_order
  [PASS] Hospital cannot execute POS cancel_order

--- 5. Read vs. Write Guard ---
  [PASS] Read operation get_student_result rejected by Action Gateway
  [PASS] Correct read rejection error code
  [PASS] Read operation check_inventory rejected by Action Gateway

--- 6. Database Least-Privilege Immutability (gateway_action_writer) ---
  [PASS] gateway_action_writer is strictly DENIED write access on bise_db.results

--- 7. Audit Logging in platform_audit_metadata ---
  [PASS] Action Gateway logged events to platform_audit_metadata (90 total entries recorded)

========================================================================
PHASE 28 TEST SUMMARY: 41 PASSED, 0 FAILED
========================================================================
```

---

## 8. Regression Suite Verification

Full regression testing of all previously completed phases was executed and validated:

| Phase | Test Script | Status | Result Summary |
| :--- | :--- | :--- | :--- |
| **Phase 18** | [`scripts/test_phase18_policy_gate.js`](file:///d:/AI-Automation/scripts/test_phase18_policy_gate.js) | **PASS** | Tool permission matrix & hard boundary outside LLM verified. |
| **Phase 20** | [`scripts/test_phase20_sql_tools.js`](file:///d:/AI-Automation/scripts/test_phase20_sql_tools.js) | **PASS** | Read-only SQL gateway, injection interceptor, least-privilege verified. |
| **Phase 21** | [`scripts/test_phase21_pgvector.js`](file:///d:/AI-Automation/scripts/test_phase21_pgvector.js) | **PASS** | Vector extension, HNSW indexing, container restart persistence verified. |
| **Phase 22** | [`scripts/test_phase22_knowledge_schema.js`](file:///d:/AI-Automation/scripts/test_phase22_knowledge_schema.js) | **PASS** | Multi-tenant chunk isolation & unique constraints verified. |
| **Phase 23** | [`scripts/test_phase23_ingestion_pipeline.js`](file:///d:/AI-Automation/scripts/test_phase23_ingestion_pipeline.js) | **PASS** | Document validation, chunking, and 384-d embedding verified. |
| **Phase 24** | [`scripts/test_phase24_semantic_retrieval.js`](file:///d:/AI-Automation/scripts/test_phase24_semantic_retrieval.js) | **PASS** | Top-k semantic search & multi-tenant isolation verified. |
| **Phase 25** | [`scripts/test_phase25_hybrid_retrieval.js`](file:///d:/AI-Automation/scripts/test_phase25_hybrid_retrieval.js) | **PASS** | BM25 + pgvector hybrid retrieval with RRF fusion verified. |
| **Phase 26** | [`scripts/test_phase26_knowledge_gateway.js`](file:///d:/AI-Automation/scripts/test_phase26_knowledge_gateway.js) | **PASS** | Knowledge Gateway with dynamic citations and audit logging verified. |
| **Phase 27** | [`scripts/test_phase27_action_gateway.js`](file:///d:/AI-Automation/scripts/test_phase27_action_gateway.js) | **PASS** | Centralized Action Gateway write layer & parameter checks verified. |
| **Phase 28** | [`scripts/test_phase28_domain_actions.js`](file:///d:/AI-Automation/scripts/test_phase28_domain_actions.js) | **PASS** | V1 Domain Actions, atomic transactions, restocking, double-booking checks verified. |

---

## 9. Phase 28 Exit Criteria & Gate Sign-Off

- [x] **V1 Domain Actions behind Action Gateway**: POS, BISE, and Hospital actions fully operational.
- [x] **POS**: `create_order` (atomic stock deduction), `update_order`, `cancel_order` (atomic restocking).
- [x] **BISE**: `submit_verification_request`, `submit_service_application` (fee lookup), `track_service_application`.
- [x] **Hospital**: `create_appointment`, `reschedule_appointment`, `cancel_appointment` with double-booking prevention and audit history.
- [x] **Atomic Transactions**: All multi-table mutations execute within strict `BEGIN ... COMMIT` blocks.
- [x] **Validated Parameters**: Every action enforces regex and schema validation.
- [x] **Business-Scoped Isolation**: Cross-tenant actions strictly blocked with `SECURITY_POLICY_DENIED`.
- [x] **Least-Privilege Security**: Executed under `gateway_action_writer`; examination results remain immutable.
- [x] **Audit Trail**: Every execution and denial recorded in `platform_audit_metadata`.
- [x] **Phase Gate**: Functional verification (41/41) and full regression suite (Phases 18–27) 100% PASS.

**PHASE 28 STATUS: PASS (READY FOR PRODUCTION / NEXT PHASE)**
