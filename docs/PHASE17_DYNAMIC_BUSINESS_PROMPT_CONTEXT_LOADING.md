# Phase 17: Dynamic Business Prompt / Context Loading Architecture

## Overview
Phase 17 transforms the Shared AI Agent Engine into a completely **profile-driven runtime**. Rather than utilizing static or monolithic prompts, agent persona, allowed scope, language, behavioral rules, communication style, and tool availability are loaded dynamically from **versioned business profiles** stored in `platform_db`.

---

## Architectural Principle: Profile-Driven Context Injection

```
                               ┌────────────────────────────────────────────────────────┐
                               │           Control-Plane Database (platform_db)         │
                               │        Table: platform_business_profiles (v1.0)        │
                               └──────────────────────────┬─────────────────────────────┘
                                                          │
                                     Node 2012: Profile Loader
                                                          │
                         ┌────────────────────────────────┼────────────────────────────────┐
                         ▼                                ▼                                ▼
               ┌───────────────────┐            ┌───────────────────┐            ┌───────────────────┐
               │    POS Profile    │            │   BISE Profile    │            │ Hospital Profile  │
               │   (POS_RETAIL)    │            │    (BISE_EDU)     │            │   (HOSP_HEALTH)   │
               ├───────────────────┤            ├───────────────────┤            ├───────────────────┤
               │ DB: pos_db        │            │ DB: bise_db       │            │ DB: hospital_db   │
               │ KB: pos_collection│            │ KB:bise_collection│            │ KB:hosp_collection│
               │ Role: POS Advisor │            │ Role: Exam Officer│            │ Role: OPD Manager │
               │ Style: Commercial │            │ Style: Official   │            │ Style: Empathetic │
               │ Tools: CRM, KB    │            │ Tools: Exam, KB   │            │ Tools: Cal, KB    │
               └───────────────────┘            └───────────────────┘            └───────────────────┘
                                                          │
                                                          ▼
                                       ┌────────────────────────────────────┐
                                       │   Node 2004: Shared Agent Engine   │
                                       │   Dynamically Ingests Persona &    │
                                       │     Strict Multi-Tenant Rules      │
                                       └────────────────────────────────────┘
```

---

## Database Schema: Versioned Business Profiles (`platform_db`)

```sql
CREATE TABLE IF NOT EXISTS platform_business_profiles (
    id SERIAL PRIMARY KEY,
    business_code VARCHAR(50) REFERENCES platform_businesses(business_code) ON DELETE CASCADE,
    prompt_version VARCHAR(20) DEFAULT 'v1.0',
    role_description TEXT NOT NULL,
    allowed_scope TEXT NOT NULL,
    response_style VARCHAR(100) DEFAULT 'Professional and Courteous',
    behavior_rules JSONB DEFAULT '[]'::jsonb,
    system_prompt TEXT NOT NULL,
    default_language VARCHAR(10) DEFAULT 'en',
    timezone VARCHAR(50) DEFAULT 'Asia/Karachi',
    currency VARCHAR(10) DEFAULT 'PKR',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_business_prompt_version UNIQUE (business_code, prompt_version)
);
```

---

## Active Business Profile Matrix

| Attribute | POS Retail (`POS_RETAIL`) | BISE Board (`BISE_EDU`) | City Hospital (`HOSP_HEALTH`) |
|---|---|---|---|
| **Prompt Version** | `v1.0` | `v1.0` | `v1.0` |
| **Role Persona** | Senior Retail POS & Hardware Automation Advisor | Official Academic Examination Controller & Student Helpdesk Assistant | Hospital Patient Care & Clinical OPD Appointment Coordinator |
| **Allowed Scope** | POS billing software, barcode scanners, thermal printers, cash drawers, stock management, PKR price quotes, demo bookings. | Matric & Inter exam results, roll number verification, date sheets, migration certificates, board policies. | Doctor directories by specialty, OPD clinic timings, consultation fees in PKR, appointment reservations. |
| **Communication Style** | Consultative, energetic, commercial with retail emojis. | Formal, authoritative, clear, and reassuring with academic emojis. | Empathetic, polite, cautious, patient-centric with healthcare emojis. |
| **Behavioral Rules** | Quote PKR prices; Recommend bundles; Offer demo bookings. | Require 6-digit roll number; Never guess marks; Direct physical certificates to board office. | STRICT: Never provide medical diagnosis or prescribe medicine; Escalate emergency to 24/7 ER. |
| **Target Database** | `pos_db` | `bise_db` | `hospital_db` |
| **Knowledge Namespace** | `pos_collection` | `bise_collection` | `hosp_collection` |
| **Allowed Tools** | `search_knowledge_base`, `sync_crm` | `search_knowledge_base`, `check_exam_results` | `search_knowledge_base`, `manage_calendar` |

---

## Workflow Integration Graph

```mermaid
flowchart TD
  N2001[2001: Evolution Webhook] --> N2002[2002: Is Customer Message?]
  N2002 --> N2003[2003: Message Normalizer]
  N2003 --> N2011[2011: Resolve Business platform_db]
  N2011 --> N2012[2012: Load Business Profile platform_db - Versioned] 🎯
  N2012 --> N2013[2013: Construct Session Identity]
  N2013 --> N2014[2014: Redis Transient Session & Dedup Gate]
  N2014 --> N2015[2015: PostgreSQL Persistent Conversation Store]
  N2015 --> N2004[2004: AI Agent Shared Engine - Profile-Driven] 🎯
  
  N2005[2005: Groq Chat Model] -.-> N2004
  N2006[2006: Window Buffer Memory] -.-> N2004
  N2007[2007: Tool Search KB - Multi-Tenant] -.-> N2004
  N2009[2009: Tool Manage Calendar] -.-> N2004
  N2010[2010: Tool Sync CRM - Multi-Tenant] -.-> N2004
  
  N2004 --> N2008[2008: Send WhatsApp Response Evolution API]
```

---

## Test & Verification Evidence

Executed test harness [`scripts/test_phase17_dynamic_prompts.js`](file:///d:/AI-Automation/scripts/test_phase17_dynamic_prompts.js):

```
================ PHASE 17 DYNAMIC BUSINESS PROMPT & CONTEXT VERIFICATION ================
1. Database Schema DDL Verification: PASS
   - platform_business_profiles table upgraded with prompt_version, role, scope, style, and rules.
   - Unique constraint (business_code, prompt_version) verified.
2. Node 2012 Dynamic Profile Loader Verification: PASS
   - Dynamically selects versioned profile attributes and behavioral rules.
3. Node 2004 Shared Agent Dynamic Context Verification: PASS
   - Zero single-business hardcoding remains in agent system prompt template.
   - Role, Scope, Style, and Version are 100% dynamically injected.
4. Profile-Driven Runtime Context Simulation:
   [PASS] Retail POS:
          - Role: Senior Retail POS & Hardware Automation Advisor
          - Database: pos_db | Knowledge: pos_collection
          - Allowed Tools: [search_knowledge_base, sync_crm]
   [PASS] BISE Education Board:
          - Role: Official Academic Examination Controller & Student Helpdesk Assistant
          - Database: bise_db | Knowledge: bise_collection
          - Allowed Tools: [search_knowledge_base, check_exam_results]
   [PASS] City Healthcare & Hospital:
          - Role: Hospital Patient Care & Clinical OPD Appointment Coordinator
          - Database: hospital_db | Knowledge: hosp_collection
          - Allowed Tools: [search_knowledge_base, manage_calendar]
5. End-to-End Workflow Pipeline Integrity: PASS (All 10 stages sequential)

SUCCESS: Phase 17 Dynamic Business Prompt / Context Loading 100% VERIFIED & PASS!
```
