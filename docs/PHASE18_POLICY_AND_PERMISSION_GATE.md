# Phase 18: Policy & Permission Gate Architecture

## Overview
Phase 18 implements the **Policy & Permission Gate**, establishing a deterministic security and authorization boundary **outside the LLM**. 

Even if an LLM model is prompt-injected, hallucinates, or explicitly issues an unauthorized tool call, the execution engine intercepts the call before touching any database, API, or system resource, enforcing strict tenant allow-lists, action classifications (READ vs WRITE), user identity levels, and approval requirements.

---

## Architectural Principle: Deterministic Defense Outside the LLM

```
                     ┌────────────────────────────────────────────────────────┐
                     │               Shared AI Agent Engine                   │
                     │          (Model requests a tool execution)             │
                     └──────────────────────────┬─────────────────────────────┘
                                                │
                                                ▼
                     ┌────────────────────────────────────────────────────────┐
                     │            POLICY & PERMISSION GATE (Phase 18)         │
                     │          (Enforces security outside the LLM)           │
                     └──────────────────────────┬─────────────────────────────┘
                                                │
          ┌─────────────────────────────────────┴─────────────────────────────────────┐
          │                                                                           │
          ▼ [Checks Passed]                                                           ▼ [Violation Detected]
┌──────────────────────────────────┐                                        ┌──────────────────────────────────┐
│   PROCEED WITH TOOL EXECUTION    │                                        │  IMMEDIATE SECURITY GATE DENIAL  │
│                                  │                                        │                                  │
│ - Verified tenant allow-list     │                                        │ - Unauthorized Tool Execution    │
│ - Read/Write classification      │                                        │ - Cross-Tenant Access Attempt    │
│ - Identity level satisfied       │                                        │ - Privilege Escalation           │
│ - Target resource matched        │                                        │                                  │
│                                  │                                        │ VERDICT: SECURITY_POLICY_DENIED  │
│ ➔ Runs Database / Vector query   │                                        │ ➔ 0 Database queries executed    │
└──────────────────────────────────┘                                        └──────────────────────────────────┘
```

---

## Policy Evaluation Checklist

Every tool invocation executes this deterministic policy check prior to execution:
1. **Is Business Allowed?**: Does `business_code` exist and active in `platform_businesses`?
2. **Is Tool Permitted for this Business?**: Is the requested `tool_name` present in `platform_tool_permissions` with `is_allowed = TRUE`?
3. **Action Classification**: Is the action `READ` or `WRITE`?
   - `READ`: Requires appropriate tenant namespace mapping.
   - `WRITE`: Requires verified session identity and valid tenant scope.
4. **Identity Level**: Does the user's role satisfy `min_identity_level` (`ANONYMOUS`, `VERIFIED_USER`, `STAFF`, `ADMIN`)?
5. **Approval Gate**: Does `requires_approval = TRUE`? If so, the action is routed to human-in-the-loop approval.

---

## Database Policy Matrix (`database/init-platform-db.sql`)

```sql
CREATE TABLE IF NOT EXISTS platform_tool_permissions (
    id SERIAL PRIMARY KEY,
    business_code VARCHAR(50) REFERENCES platform_businesses(business_code) ON DELETE CASCADE,
    tool_name VARCHAR(100) NOT NULL,
    action_type VARCHAR(20) DEFAULT 'READ', -- 'READ', 'WRITE', 'ADMIN'
    min_identity_level VARCHAR(20) DEFAULT 'ANONYMOUS', -- 'ANONYMOUS', 'VERIFIED_USER', 'STAFF', 'ADMIN'
    requires_approval BOOLEAN DEFAULT FALSE,
    is_allowed BOOLEAN DEFAULT TRUE,
    access_level VARCHAR(30) DEFAULT 'FULL',
    resource_target VARCHAR(100) DEFAULT 'general',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_business_tool UNIQUE (business_code, tool_name)
);
```

### Active Permissions Matrix

| Tenant Code | Tool Name | Action | Min Identity | Approval Req | Policy Verdict | Resource Target |
|---|---|---|---|---|---|---|
| `POS_RETAIL` | `search_knowledge_base` | READ | ANONYMOUS | No | **PERMITTED** | `faiss:pos_collection` |
| `POS_RETAIL` | `sync_crm` | WRITE | ANONYMOUS | No | **PERMITTED** | `postgres:leads` |
| `POS_RETAIL` | `manage_calendar` | WRITE | STAFF | Yes | **DENIED** | `calendar:events` |
| `BISE_EDU` | `search_knowledge_base` | READ | ANONYMOUS | No | **PERMITTED** | `faiss:bise_collection` |
| `BISE_EDU` | `check_exam_results` | READ | ANONYMOUS | No | **PERMITTED** | `postgres:bise_results` |
| `BISE_EDU` | `sync_crm` | WRITE | STAFF | Yes | **DENIED** | `postgres:leads` |
| `BISE_EDU` | `manage_calendar` | WRITE | STAFF | Yes | **DENIED** | `calendar:events` |
| `HOSP_HEALTH` | `search_knowledge_base` | READ | ANONYMOUS | No | **PERMITTED** | `faiss:hosp_collection` |
| `HOSP_HEALTH` | `manage_calendar` | WRITE | ANONYMOUS | No | **PERMITTED** | `postgres:hospital_appointments` |
| `HOSP_HEALTH` | `sync_crm` | WRITE | STAFF | Yes | **DENIED** | `postgres:leads` |

---

## Test & Verification Evidence

Executed test harness [`scripts/test_phase18_policy_gate.js`](file:///d:/AI-Automation/scripts/test_phase18_policy_gate.js):

```
================ PHASE 18 POLICY & PERMISSION GATE VERIFICATION ================
1. Policy Matrix DDL Verification: PASS
   - platform_tool_permissions includes action_type (READ/WRITE), min_identity_level, approval flag, and resource mapping.
2. Workflow Tool Nodes Located: PASS (Nodes 2007, 2009, 2010)

3. Testing Explicit Model Requests for Unauthorized Tools:
   [PASS - DENIED AS EXPECTED] Model representing BISE attempts to execute CRM write (sync_crm)
          Verdict: SECURITY_POLICY_DENIED (POLICY_UNAUTHORIZED_TOOL)
   [PASS - DENIED AS EXPECTED] Model representing BISE attempts to schedule appointment (manage_calendar)
          Verdict: SECURITY_POLICY_DENIED (POLICY_UNAUTHORIZED_TOOL)
   [PASS - DENIED AS EXPECTED] Model representing POS attempts to schedule hospital appointment (manage_calendar)
          Verdict: SECURITY_POLICY_DENIED (POLICY_UNAUTHORIZED_TOOL)
   [PASS - DENIED AS EXPECTED] Model representing Hospital attempts to write to commercial CRM (sync_crm)
          Verdict: SECURITY_POLICY_DENIED (POLICY_UNAUTHORIZED_TOOL)

4. Testing Authorized Tool Executions:
   [PASS - PERMITTED] POS Retail model calls authorized sync_crm
   [PASS - PERMITTED] Hospital model calls authorized manage_calendar
   [PASS - PERMITTED] BISE Education model calls authorized search_knowledge_base

5. Verifying Tool Code Implementation Contains Hard Boundary Outside LLM:
   [PASS] Tool: Search Knowledge Base: Hard Policy Gate present in tool handler.
   [PASS] Tool: Manage Calendar: Hard Policy Gate present in tool handler.
   [PASS] Tool: Sync CRM: Hard Policy Gate present in tool handler.

SUCCESS: Phase 18 Policy & Permission Gate 100% VERIFIED & PASS!
```
