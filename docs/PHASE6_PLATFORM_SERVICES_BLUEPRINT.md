# 🛠️ Phase 6: Platform Services Architecture Blueprint

**Document Version**: 2.0.0  
**Target Scope**: Platform Infrastructure Services, Redis Caching, Observability, & Disaster Recovery  

---

## 1. Platform Infrastructure Overview

Phase 6 implements the **Platform Infrastructure Services Layer**, providing high availability, secure credentials management, real-time observability, and automated disaster recovery across all tenant business verticals.

```
                  ┌──────────────────────────────────────────┐
                  │       Platform Infrastructure Layer       │
                  └────────────────────┬─────────────────────┘
                                       │
      ┌──────────────────┬─────────────┼──────────────┬──────────────────┐
      │                  │             │              │                  │
      ▼                  ▼             ▼              ▼                  ▼
┌───────────┐      ┌───────────┐ ┌───────────┐  ┌───────────┐      ┌───────────┐
│platform_db│      │   Redis   │ │  Secrets  │  │   Audit   │      │Monitoring │
│(PostgreSQL│      │ (Caching &│ │Management │  │& Error Log│      │& Disaster │
│ Control)  │      │ Sessions) │ │(Vault/Env)│  │ (ELK/Log) │      │  Recovery │
└───────────┘      └───────────┘ └───────────┘  └───────────┘      └───────────┘
```

---

## 2. Core Service Modules Specification

### 1. `platform_db` (Control Plane Database)
- **Role**: Central metadata registry for multi-tenant mapping, tenant profiles, instance keys, and policy permissions.
- **Engine**: PostgreSQL 15+ with dedicated `platform` schema.

### 2. Redis Service (Short-Term Memory & Rate Limiting)
- **Role**: High-speed, in-memory cache for window buffer memory, session states, deduplication locks, and message rate-limiting.
- **Key Schema**:
  - `session:<business_code>:<customer_phone>` ➔ Active session memory (TTL: 1 hour).
  - `dedup:<instance_id>:<message_id>` ➔ Webhook deduplication lock (TTL: 5 minutes).
  - `rate:<customer_phone>` ➔ Message rate limiter counter.

### 3. Secrets Management Service
- **Role**: Secure handling of API Keys (Groq, Gemini, Evolution Global Key, PostgreSQL Passwords).
- **Implementation**: Vault / Encrypted `.env` store with DPAPI/AES-256 encryption.

### 4. Audit & Error Logging Service
- **Role**: Centralized logging for all inbound/outbound payloads, execution duration, LLM token usage, and system exception tracebacks.
- **Storage**: Structured JSON logs written to persistent volume (`/app/logs`) and queryable via PostgreSQL `platform.audit_metadata`.

### 5. Monitoring & Health Check Service
- **Role**: Automated health polling across Docker containers (`evolution-go`, `n8n`, `evolution-postgres`, `faiss-service`).
- **Endpoints**:
  - `GET /healthz` on n8n (:5678).
  - `GET /instance/fetchInstances` on Evolution (:4000).
  - `GET /health` on FAISS microservice (:8000).

### 6. Backup & Disaster Recovery Service
- **Role**: Automated, zero-downtime backups of PostgreSQL database clusters and n8n volume data.
- **Script Target**: Automated via PowerShell `scripts/create_baseline_backup.ps1` with timestamped DPAPI encrypted archives.

### 7. Workflow & Config Management
- **Role**: Version control and deployment pipeline for n8n workflow exports (`evolution_whatsapp_ai_agent_bot.json`) and domain configuration schemas (`knowledge_base.json`).

---

## 3. Phase 5 & 6 Roadmap Transition

```
  Phase 4: Requirements & Boundary Freeze (POS, BISE, Hospital Architecture) ──► COMPLETED ✅
  Phase 5: Platform Data Architecture & Database Schema           ──► BLUEPRINTED ✅ (NEXT IMPLEMENTATION)
  Phase 6: Platform Infrastructure Services                       ──► BLUEPRINTED ✅ (PROD ROLLOUT)
```
