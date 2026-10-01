# Phase 3 — ERD and schema design review (revision 2)

Status: revision 2 supersedes the single-database design. Proposed design, ready for user review after offline verification. Phase 2 was explicitly accepted. No database migrations, business inserts, workflow imports, production changes, or Phase 4 execution are part of this phase.

## 1. Business objective and design boundary

Design a reusable, tenant-scoped operational platform for Sales, BISE student services and Hospital appointments, using synthetic data first. PostgreSQL owns structured facts and transactions; pgvector plus a genuine BM25 implementation retrieves approved knowledge. A supervisor selects allowed tools but cannot select another tenant, grant access, generate executable SQL or commit unapproved actions.

The running 12-node published n8n workflow is the behavioral baseline, not the different 10-node local JSON. Evolution's internal databases and n8n's SQLite database remain separate from application storage. Production source models for actual Board/hospital/business systems are unknown; the proposed model does not claim to reproduce them.

Deliverables:

- `schema-catalog.json`: machine-readable proposed entities, field types/nullability, keys, relationships, invariants and implementation phases.
- `DATA_DICTIONARY.md`: full generated data dictionary with justification for every entity.
- `ERD.md`: database/schema-specific diagrams generated from the same catalog.
- `verification.json`: offline design checks, negative mutations and relational tuple witnesses.
- `ACCEPTANCE_MATRIX.md`: database/application checks required during implementation; these are not claimed as already executed.

## 2. Architecture decisions

| Decision | Proposed initial choice | Alternative / rationale |
| --- | --- | --- |
| Physical application storage | Separate `control_db`, `pos_db`, `bise_db`, `hospital_db`, initially on one server | Explicit domain ownership and restricted credentials. `agent_dev` is existing infrastructure, not the target business database. |
| Central Control DB | Separate `control_db`; authoritative routing/configuration, central audit and minimized reporting/session directory | Authoritative sessions, grants, domain audit, idempotency/actions and outboxes stay local to each domain. Common code does not require shared tables. |
| Tenant identity | `business_id` UUID everywhere; tenant comes from authenticated instance mapping | Neither phone alone nor supervisor classification can authorize a business. |
| Primary/foreign keys | Composite `(business_id,id)` and composite FKs | An ID-only FK would not prove parent ownership in the same business. |
| Person/contact | Tenant-local contact record, optional channel identities; actor and protected subject can differ | A patient/student can exist without personally messaging. Shared phone does not merge patients/students. |
| Verification | Expiring server-created grant bound to actor, subject, session and operation scope | Memory text such as “verified=true” never authorizes data retrieval. |
| Scheduling authority | Dummy pilot: PostgreSQL authoritative; Calendar simulator is a projection | Production Calendar/HIS authority remains an integration decision, not assumed. |
| Sales pilot | One stock pool per SKU; one currency per order; exact numeric amounts | Multi-warehouse fulfillment, taxes, negotiated discounts and real payment collection deferred until rules are known. |
| Hospital pilot | One branch, exclusive non-overlapping consultation slots, one primary department per doctor | Capacity > 1, multi-branch resources and complex specialties require reviewed extensions. |
| Domain agents | POS supervisor with Product, Inventory, Order, Customer and Payment specialist modules and deterministic tools | Modules share pos_db; separate LLM calls per module depend on evaluated benefit, not database ownership. |
| Knowledge | Versioned approved documents, immutable chunks, pgvector + BM25 | No FAISS in target design. Native PostgreSQL text ranking will not be mislabeled BM25. |

These pilot defaults permit synthetic testing. They are not statements of actual institutional policy and are not production approval.

## 3. Tenant, identity and access model

Every business-owned table has non-null `business_id`, a tenant-scoped key, a FK to `platform.businesses` and required RLS. Globally unique `(provider,external_instance_id)` establishes exactly one routing destination. Credential references point to the secret manager/n8n credential configuration; raw tokens are not catalog fields.

RLS supplements service authorization. A trusted service supplies tenant context inside a transaction; missing context denies access. Runtime roles cannot own tables, be superuser, use BYPASSRLS, or perform DDL. Owner/migration roles are separate. FORCE RLS and SELECT/INSERT/UPDATE policy behavior must be explicitly tested under runtime credentials. A caller-controlled session setting is not authentication: only trusted code can set the tenant context, and no arbitrary SQL tool is exposed. Connection reuse must not retain another request's context.

Proposed role boundaries:

| Role/responsibility | Allowed access |
| --- | --- |
| Migration owner | Versioned DDL in dev; never supplied to the agent |
| Tenant resolver | Minimal trusted mapping lookup before session load |
| Runtime service | Scoped approved operations through fixed queries/functions; no broad raw SQL endpoint |
| Verification service | Creates/revokes verified grants from approved evidence; LLM cannot mint grants |
| BISE result reader | SELECT-only approved student/result projection; no official-record writes |
| Fixture loader | Synthetic records only, isolated development credentials |
| Knowledge ingester/publisher | Scoped document staging; publication permission distinct from retrieval |
| Audit writer | Append-only sanitized events; no UPDATE/DELETE privileges |
| Operator/admin | Authenticated, tenant-scoped explicit permissions; confirmations are not arbitrary text |

Protected result/history tools derive the authorized subject from the grant and resource ownership, not a model-supplied reference alone. Sessions bind the actor to the conversation using an ownership tuple FK. Grants bind the actor to the session; an action's grant belongs to that same session. Subject and operation scope are checked again immediately before execution. Revoked/expired grants fail closed even if a conversation window retains prior text.

Production authentication factors, guardian eligibility, verification TTL, rate limits and operator identity provider remain policy decisions. Dummy tests use a deterministic mock verifier that cannot be enabled against real sources.

## 4. Data model and phased scope

The catalog contains 88 proposed physical table definitions across four databases and all planned phases. Shared entity templates are instantiated per domain. This is not an instruction to create all 88 in Phase 4. See `ISOLATION_AND_RECOVERY.md` for ownership, transactions, credentials and recovery contracts.

| Phase | Planned schema work |
| --- | --- |
| 4 | Four database boundaries; 16 catalog tables: businesses, instances, audit_events in each DB; central configuration_outbox and three domain configuration_inbox tables. Restricted roles, tenant policies and migration ledger mechanism. Config workers remain disabled until tested; synthetic bootstrap uses the reviewed event contract. |
| 5 | Contacts, channel identities, CRM leads and lead events |
| 6–7 | Domain-local conversations, sessions, requests/messages/response outbox and reporting outbox; central reporting inbox/session directory. Test retry/deduplication before enabling sync. No separate duplicate window-memory table. |
| 8–10 | Verification grants, tool-run traces and minimal read-only domain models needed by the first tools; resolver gate before exposure |
| 11 | Inventory/deprecation of static KB; actual removal only after replacement passes |
| 12–16 | Compatible pgvector runtime; knowledge documents/versions/chunks/jobs; real BM25 selection; ingestion/search evaluation |
| 17–19 | Tool/action policy, pending actions, Sales orders/payments, appointments/calendar jobs, approval and handoff entities; effects disabled until safety gates pass |
| 20–29 | Evidence/output contracts, CRM automation, administration, recovery, optimization, security and E2E tests |
| 30–35 | Production deployment hardening/acceptance, monitored recovery and ongoing maintenance |

Entity `phase` is its earliest planned introduction, not permission to enable every tool that uses it. In particular, Phase 18 business writes stay mock/disabled until required confirmation/approval controls are tested. Core error/idempotency/security handling is not postponed to the late consolidation phases.

No JSONB field is a substitute for stock, marks, price, identity or appointment relations. JSONB is reserved for bounded, schema-validated configuration/state, SKU descriptive attributes, audit metadata and immutable action payloads. No table contains raw CNIC, OTP or card credentials.

## 5. Correctness rules

### Shared ingress and memory

Authenticate ingress, require supported event type and stable instance identity, then persist request and redacted inbound message atomically before durable processing acknowledgement. `(business_id,instance_id,event_type,provider_event_id)` deduplicates replay. A reused ID is not a reason to repeat side effects. Reject malformed identity rather than using one shared default session. Direct text/caption chats are the initial pilot; groups/media processing require separate scope.

Message relationships enforce both tenant and instance consistency across request/conversation. The first pilot emits one logical response per inbound request. Multipart replies later require a sequence dimension; do not overload the current unique key silently.

Window context reads recent authorized conversation rows with deterministic ordering and configurable message/token budget. Expired authorization is never renewed from chat history. Operator handoff pauses autonomous actions; only a controlled resume releases ownership.

Request state: `received -> processing -> completed`; transient failure -> `retry_wait`; exhausted/permanent failure -> `failed`. Workers claim with leases so crashed workers can be recovered. Response outbox: `pending -> sending -> accepted -> delivered`; uncertain send -> `unknown`, followed by reconciliation/manual review. Provider acceptance is not proof of user delivery; exactly-once transport is not promised.

### Sales

Prepare a bounded quote/action containing SKU, quantity, currency, price version and total. Bind confirmation to that hash/version and expiry. At commit, lock affected SKU/inventory rows in deterministic order, revalidate active state/current price/stock, create immutable order items, reserve inventory and record audit/outbox in one transaction. A material price change requests reconfirmation; do not charge a changed price silently. `on_hand >= reserved >= 0` is a row invariant; reservation reconciliation across orders is a controlled transaction/job responsibility.

Order states: `reserved -> confirmed -> fulfilled`, or allowed `reserved -> expired/cancelled` and `confirmed -> cancelled` according to policy. Payment status remains separate: `pending/succeeded/failed/unknown`; provider-authenticated callbacks are deduplicated and cannot move a final status backward blindly. Initial payment data is synthetic/read-only status; real collection/refunds are deferred. Reservation release must be idempotent and lock the order/inventory; a timeout does not prove payment failed.

### BISE

Roll numbers are unique within an exam/year/session/attempt context, not across all time. Subject components distinguish theory/practical. Missing/withheld/absent values are not zero. The agent returns source-issued grades rather than recomputing them. Verification, resource ownership AND publication permission must pass; a verified user is not entitled to an unpublished result. Duplicate/ambiguous official records trigger clarification or staff review.

The synthetic model supports tool contracts, not claimed official tables. Later adapters map actual Board records to the contracts using minimal read-only views/services. Calendar and CRM features are not required for the initial result/marks slice unless a concrete business requirement is approved.

### Hospital

Store `timestamptz` instants; resolve “tomorrow/Friday/4 o'clock” using business timezone and explicit clarification where ambiguous. Dummy timezone: Asia/Karachi. Require end > start. Prevent overlapping active doctor slots using an exclusion design, and prevent multiple active appointments for one exclusive slot using partial uniqueness. `btree_gist` support is a later migration prerequisite; no extension is installed in Phase 3.

Appointment states: `held -> confirmed -> completed/no_show`, or `held -> expired/cancelled`, `confirmed -> cancelled`. Hold expiry requires an implemented job before holds are enabled. Rescheduling updates the same appointment/slot under row locks and an expected version, with a durable transition event. A failed move leaves the previous booking intact. A competing cancellation/reschedule checks current status/version and cannot overwrite a later action.

Calendar state is separate: `pending/synced/retry_wait/unknown/failed`. Commit appointment plus sync job locally. Workers project only the current appointment version, using stable provider identity and reconciliation after uncertain calls. Outdated create/update jobs must not recreate canceled appointments. Under the proposed dummy Model A, confirmation means the authoritative PostgreSQL appointment exists; a Calendar failure remains visible as a sync issue. Actual hospitals may choose another model before production integration.

Doctor matching uses approved directory metadata. No diagnosis, treatment decisions or model-invented preparation advice. Human/emergency escalation text must be hospital-approved before rollout.

## 6. Knowledge and hybrid retrieval

Documents are tenant-owned with source, audience/category and immutable versioned text. Versions carry publication/effectivity and embedding model/revision/dimension. Chunks share stable IDs across both retrieval paths. `vector(d)` is a design placeholder; choose and test the multilingual embedding model before generating concrete vector DDL. Never mix dimensions/revisions in the same search population.

Ingest staged version -> validate source/content -> clean/chunk -> embed -> build BM25/vector entries -> evaluate readiness -> publish atomically. Do not expose a partially indexed version. Enforce tenant, audience, status and effective version on both search paths. Fuse ranks (RRF is the initial candidate), then validate evidence and return source/chunk/version IDs. Search score alone is not authorization or certainty.

BM25 implementation remains open pending PostgreSQL 15/image compatibility, language quality, update/delete behavior, licensing/operations and restore tests. If lexical search uses native PostgreSQL ranking as an interim experiment, label it accordingly and do not claim BM25 acceptance. Temporal policy rules distinguish current policy questions from purchase-time eligibility.

Knowledge is limited to approved public/business documents. Transactional prices, inventory, results, appointment availability and patient/student records are not authoritative vector content. SQL-plus-knowledge answers retain separate traceable sources.

## 7. Privacy, retention and recovery

Proposed synthetic-dev defaults only: sessions expire after 30 minutes idle with an absolute cap; mock grants after 10 minutes; pending confirmations after 5 minutes. Exact idle/cap implementation, production TTLs and retention need policy approval before the corresponding feature is enabled. Do not implement expiry as a CHECK involving current time; enforce it on access and cleanup.

Persistent history contains only redacted conversational content necessary for testing. Private business facts should use minimal deterministic formatting where possible. Raw verification input is excluded before LLM/memory/log storage, including n8n execution persistence. Consent/notification preferences and full administrative configuration will be designed when those workflows are scoped; no proactive messaging is enabled by this ERD.

All relational deletes default to RESTRICT. Data erasure is an authorized retention workflow: redact content, preserve minimal justified audit references, then purge dependencies in a reviewed order. `created_at` alone is not a retention policy. Production retention/legal requirements are unresolved owner decisions, not assumed durations.

Backup scope: application databases/roles, knowledge sources/index metadata, workflow/prompt/tool versions and protected credential recovery material. Restore into a restricted recovery environment, never the ordinary dummy-dev database. Validate counts/relationships, runtime-role access, representative tool queries, vector retrieval and external-state reconciliation. Phase 1's DPAPI backup is local-user recovery only; independent key custody/off-machine recovery remains pending.

Use versioned expand/contract migrations. Before rollback, stop new action dispatch, identify committed external effects, restore compatible application/workflow versions and reconcile. Database restore cannot unsend WhatsApp messages or automatically reverse payments/calendar events. Avoid destructive down-migrations against records written after deployment; forward repair may be required.

## 8. Priorities and unresolved decisions

**Must Have:** tenant-bound identity, restricted roles, relational integrity, verified sensitive access, durable requests/memory/actions, numeric transactions, exclusive-slot enforcement, evidence traceability, dummy-only isolation, recovery/restore acceptance.

**Should Have:** multilingual retrieval benchmark, versioned policy publishing, operator handoff, conflict dashboards, latency measurements, controlled retention and reconciliation jobs.

**Could Have:** reranking, summaries, Redis optimization after measurements, richer catalog taxonomy and specialist LLMs.

**Deferred:** real payment collection/refunds, real institution records, clinical decisions, multi-warehouse allocation, multi-branch capacity scheduling, full zero-code admin UX and separate PostgreSQL servers per domain.

| Open item | Blocks |
| --- | --- |
| Real student/patient authentication and guardian policy | Production verification; mock-only testing can proceed |
| Production calendar/HIS authority and calendar provider | Real scheduling integration; PostgreSQL-authoritative simulator can proceed |
| BM25 implementation and embedding model/dimension | Phase 12–15 concrete indexing/search migrations; not Phase 4 core tables |
| Tax/shipping/discount, reservation/payment policies | Expanded Sales checkout; dummy zero-fee rules must be explicitly labeled |
| Verification/confirmation TTL, retention, RPO/RTO, staff ownership | Production acceptance; defaults are proposals, not policy |
| Shared number versus separate business instances | Pilot uses one trusted instance per business; shared entry point needs explicit permitted-business selection |

## 9. Required 20-point phase review

| Item | Result |
| --- | --- |
| 1 Business objective | Reusable schema with correct isolation and domain transaction boundaries. |
| 2 Measurable result | 88 proposed table definitions in four databases with dictionary/ERD, scoped keys/FKs and machine-checked dependencies. |
| 3 Existing reuse | Transport/orchestration, isolated dev server and common entity templates; do not copy incompatible prototype schemas or overwrite published workflow. |
| 4 Dependencies | Accepted Phase 2 metadata, three master prompts and latest 0–35 phase order. |
| 5 Required data | Synthetic scenarios only; no production row access. |
| 6 Integrations | None executed in this phase; future contracts described for Evolution/n8n/SQL/RAG/Calendar. |
| 7 Proposed design | Four databases with local ACID boundaries, versioned cross-database synchronization and staged introduction. |
| 8 Alternatives | Single database, per-agent databases, distributed transactions, unrestricted SQL and phone-only identity rejected for this design. |
| 9 Failures | Duplicate/out-of-order requests, expiry, cross-tenant IDs, race conditions, partial external effects, stale knowledge. |
| 10 Authentication/authorization | Trusted ingress/tenant mapping, restricted roles, session-bound grants and approvals. |
| 11 Sensitive data | Minimized context, redaction and no identity/payment secrets in catalog. |
| 12 Recovery | Leases, idempotency, outbox, version-aware reconciliation and staff review of uncertain results. |
| 13 Backup | Later versioned application backup plus independent secret-recovery plan. |
| 14 Restore verification | Explicit isolated restore tests in acceptance matrix; not executed in Phase 3. |
| 15 Rollback | Design artifacts are reversible files; future schema rollback uses reviewed compatible migrations/reconciliation. |
| 16 Test cases | Offline catalog checks and adversarial mutations now; live database/application scenarios listed separately. |
| 17 Evidence | verification.json, generated catalog/dictionary/ERD and reproducible scripts. |
| 18 Pass/fail | All offline checks must pass; no claim that RLS, concurrency or E2E behavior has passed. |
| 19 Essential/deferred | Core ERD essential; explicit later-phase entities are not immediate implementation scope. |
| 20 Exit gate | Offline checks pass and user accepts design/defaults for next core-database phase. Open production decisions remain tracked. |

## 10. Reproduce and next gate

```powershell
node scripts/build-phase3-design.cjs
node scripts/verify-phase3-design.cjs
```

These commands write local design/evidence files only. Phase 4 may begin after this review is accepted and will implement/test only the core slice and least-privilege migration framework, not all 88 proposed tables. No production connection or migration is authorized by a design artifact.

Technical references: [PostgreSQL 15 constraints](https://www.postgresql.org/docs/15/ddl-constraints.html) documents composite keys, uniqueness and exclusion constraints; [PostgreSQL 15 RLS](https://www.postgresql.org/docs/15/ddl-rowsecurity.html) explains policies and owner/superuser bypass; [pgvector hybrid retrieval](https://github.com/pgvector/pgvector#hybrid-search) describes combining lexical and vector results. These references inform the proposed design, not evidence that it has been deployed.

Revision 2 governing detail: [Isolation, ownership, transactions and recovery](ISOLATION_AND_RECOVERY.md). The 16 Phase 4 catalog tables exclude per-database migration-tool bookkeeping. No database, extension or credential has been created by this review.

Additional required capability design: [POS deterministic tools and BISE verification/anti-enumeration](POS_TOOLS_AND_BISE_VERIFICATION.md). Five POS modules are accepted design scope. BISE challenge/attempt/delegation storage must be reviewed and added before Phase 8 verification is enabled; it is not represented as implemented in the current catalog. Invoice issuance and real payment collection are not implied by adding a Payment module. Phase 4 foundational scope is unchanged.
