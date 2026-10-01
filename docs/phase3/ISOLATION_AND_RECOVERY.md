# Phase 3 revision 2 — domain database boundaries

Status: proposed and offline-verified design only. This document supersedes the earlier single `agent_dev` application-database proposal. It does not claim databases, roles, pgvector or runtime synchronization exist. Phase 4 starts only after this revised design is accepted.

## 1. ERD and table ownership

| Database | Authoritative ownership | Knowledge | Restricted runtime identity |
| --- | --- | --- | --- |
| `control_db` | Business registry, instance routing, central security/configuration audit, configuration publication outbox; received reporting events and session directory are projections | No domain KB | `control_runtime` |
| `pos_db` | Local contacts/CRM, products/SKUs/inventory, orders/items/payments, local sessions/grants/actions/audit/outboxes | `knowledge.documents`, versions, chunks, ingestion_jobs | `pos_runtime` |
| `bise_db` | Local contacts, students/exams/registrations/results/subject marks, local sessions/grants/actions/audit/outboxes | Same knowledge template, BISE-owned data | `bise_runtime` |
| `hospital_db` | Local contacts, departments/doctors/slots/appointments/events/calendar jobs, local sessions/grants/actions/audit/outboxes | Same knowledge template, hospital-owned data | `hospital_runtime` |

Product, inventory, customer and order agents use approved tools against the same POS database. Individual agents do not own new databases. Contacts are domain-local; a shared phone or identical UUID does not establish cross-domain identity or permission. CRM lead automation initially belongs to POS; adding it elsewhere needs a concrete domain requirement.

Each domain's `platform.businesses` and `platform.instances` are provisioned, versioned projections of control configuration. Domain runtime cannot edit them. Local copies provide real local tenant/instance FKs. Only control stores the gateway credential reference; none of these tables stores raw secrets. Tenant domain is immutable in the pilot. Moving a business between domains is a future reviewed migration, not a routing update.

`platform.sessions`, messages, verification grants and action payloads are authoritative in their domain. Central `session_directory` contains only opaque reference, version and status. Central reporting must not copy chat content, student marks, patient details, verification evidence, or action payloads. Routing metadata needed by the authenticated gateway is still protected.

The generated catalog contains 88 table definitions because shared templates are repeated in three databases. They are staged across phases, not all Phase 4 scope. `db.schema.table` in artifacts is an ownership label: implementation connects to the selected DB and uses `schema.table`. No cross-database SQL join/FK is implied.

pgvector is an extension enabled separately in each domain database after compatible server binaries/image and extension version are tested. Each domain can contain its own `knowledge` schema and vector columns. It does not require a second standalone vector database. Phase 12 enables the extension; Phase 13 introduces knowledge tables. BM25 engine selection remains open; PostgreSQL native full-text ranking is not automatically BM25. Both search paths must enforce the same business/audience/version filters. FAISS is excluded from this target.

## 2. Relationships and isolation invariants

1. All business-owned records have non-null `business_id` and tenant-scoped keys. The tenant registry itself uses `id` as the tenant identity. Composite child FKs include `business_id`; never accept an ID-only resource link.
2. Every FK stays within one database. Relationships to control configuration and central projections are logical references with authenticated delivery, revision checks and reconciliation, explicitly recorded as `externalReferences` in the catalog.
3. Authoritative central `(provider, external_instance_id)` has one business destination. A domain copy can temporarily lag; it never authorizes rerouting on its own. Local uniqueness is not a substitute for this central invariant.
4. Supervisor classification selects an allowed operation within the already authorized business/domain. It cannot choose another database based on user text. No implicit fallback to another business or default shared session.
5. Conversation actor, grant actor/session and action grant/session are bound by composite relationships. A subject grant additionally requires service checks for resource ownership, operation scope, expiry and revocation.
6. Financial values use numeric amounts; time instants use timestamptz. Relational deletion defaults to RESTRICT. No cascade erases domain audit or idempotency evidence.
7. Shared PostgreSQL server is acceptable initially, but is one failure and administrative trust boundary. A server administrator can access all databases; distinct application credentials do not isolate from that administrator or shared disk failure.

## 3. Transactions and reliable central reporting

| Operation | One local transaction must contain | Outside that transaction |
| --- | --- | --- |
| Control configuration change | Registry/routing revision, sanitized central audit, configuration outbox event | Delivery/application in target domain |
| Domain configuration apply | Validated revision, local business/instance projection, configuration inbox receipt, local audit | Central acknowledgement |
| Inbound message | Deduplicated request, scoped conversation/session update, minimized inbound message | LLM/tool processing after durable acceptance |
| Sales confirmation | Recheck authorization/confirmation; lock stock/prices; order/items/reservation; action idempotency result; audit; reporting event; intended response/outbox | WhatsApp send and central delivery |
| Hospital booking/change | Recheck authorization/confirmation; lock current appointment and relevant slots; appointment/event; action idempotency result; audit; reporting event; calendar job and intended response | Calendar calls, WhatsApp send, central delivery |
| BISE protected read | Validate grant/publication/ownership and read a coherent source snapshot; minimized access audit/tool trace | Final response sending; no official-result mutation |

No n8n node sequence using independent connections is assumed to be a transaction. Implement each atomic operation in one trusted service transaction or reviewed database function. Never hold locks while waiting for LLM, user confirmation, Calendar or WhatsApp. Sensitive responses are rechecked before dispatch if authorization expires or is revoked after retrieval.

Action deduplication key is `(business_id, operation, idempotency_key)` in local `platform.actions`; request deduplication uses instance/event identity. A retried key with the same canonical payload hash returns the recorded result; the same key with a changed payload is a conflict. Serialize concurrent execution and recheck state under lock. Audit, action result and reporting event either commit with the business change or all roll back. Security denial logging uses a separate sanitized event after a rolled-back attempt; do not pretend a rolled-back audit row survived.

Three distinct outbox responsibilities must not be confused:

- Domain `platform.outbox`: response dispatch intent; tracks accepted/delivered/unknown.
- Domain `platform.reporting_outbox`: sanitized central synchronization event with immutable identity, aggregate version and payload hash; delivery status may change.
- Control `platform.configuration_outbox`: authoritative versioned configuration distribution. Hospital also has its domain-specific Calendar jobs.

Reporting delivery contract:

1. Domain transaction inserts a minimized event with UUID, business, aggregate reference/version, schema-versioned payload, event type and hash. A namespaced aggregate reference includes entity type. Event payload cannot be edited after commit.
2. A scoped producer claims events with a lease and bounded retry/backoff. Its credential identifies the source database; submitted `origin_database` and business membership cannot override that identity.
3. Central receiver validates the producer, schema, business-domain mapping and allowed fields, then inserts `reporting_events` and updates the relevant projection in one control transaction. Unrecognized business/configuration is quarantined for reconciliation, never auto-provisioned from reporting input.
4. Unique `(business_id, origin_database, origin_event_ref)` makes replay harmless. Same key/different hash is an integrity incident, not a successful duplicate. Acknowledgement occurs only after central commit.
5. Lost acknowledgements cause retry. Consumer compares aggregate versions: ignore obsolete projection updates; a missing version requires reconciliation. Initial projection events contain complete minimized state, so a newer state can supersede an older state; they are not blindly applied as arithmetic increments. Historical event storage remains immutable.
6. A domain marks acknowledged only after valid acknowledgement. Dead-letter/exhausted attempts remain visible and replayable using the same identity. Alert on age/count/oldest pending event; never silently discard failed events.
7. Central outage does not roll back committed domain actions. Queued events remain local. Reporting is explicitly eventually consistent; user-facing order/results/booking tools always consult the authoritative domain source.

Configuration uses an analogous authenticated inbox/outbox protocol with monotonic per-business revisions and complete configuration snapshots. Bootstrap provision creates the local tenant, routing, receipt and audit in one transaction, so no FK requires a nonexistent tenant beforehand. A receiver rejects mismatched domain, hash conflict and revision rollback. Routing reassignment requires old routing revocation and acknowledged new configuration, not competing active copies.

Pilot security decision: new ingress and protected operations require live trusted control authorization at admission/execution. A signed, audience-bound, short-lived request context includes business, instance, operation and configuration revision. Domain verifies it, local configuration lease and current local grant. If control authorization is unavailable, new protected operations fail closed; committed reporting/Calendar recovery jobs may continue under scoped worker policy. Revocation stops new admissions; already admitted in-flight transactions are not claimed to be instantaneously cancelled. Define/test that boundary explicitly. This favors security over offline availability; a future cached-authorization policy would require a separate review.

Unknown-instance ingress errors are minimized in gateway security diagnostics, not forced into a tenant table with a fabricated business ID. No raw webhook or verification secret is logged there.

## 4. Credentials, authorization and sensitive data

| Principal | Allowed scope | Explicitly prohibited |
| --- | --- | --- |
| Per-DB owner (`*_owner`) | NOLOGIN owner, used through controlled migrations | Runtime/LLM ownership |
| Per-DB migrator | Explicit DDL in its own database; temporary controlled owner membership | Agent credential use or another domain's ownership |
| Per-domain runtime | Fixed parameterized domain operations under authenticated business context | Cross-domain CONNECT, arbitrary SQL, DDL, tenant registry writes, grant minting, unrestricted record access |
| `control_runtime` / gateway service | Minimal routing/config reads and required gateway metadata | Domain operational database access or reporting write shortcuts |
| Per-domain verifier | Validated actor/subject/scope grants only | Model-controlled verification evidence or unrestricted official-record writes |
| Per-domain configuration consumer | Validated local projection/inbox updates only | Local self-assignment of tenants or gateway secrets |
| Per-domain reporting sender | Local outbox claim/ack plus authenticated control receiver API | Direct central SQL credentials or other domain data |
| Control reporting receiver | Reporting inbox/projection transaction only | Connections to domain databases |
| Per-domain knowledge reader/ingester/publisher | Tenant-scoped approved retrieval or separate staging/publication permissions | Sensitive operational tables or unreviewed publication |
| BISE source reader | Approved read-only student/result interface after authorization | Official data mutation |
| Backup/recovery operator | Dedicated controlled recovery privileges and protected credentials | Normal agent runtime access |

Role names are cluster-wide. Separate passwords/secrets, no shared runtime login and no cross-domain role inheritance. Revoke PUBLIC CONNECT/TEMP on new business DBs and PUBLIC schema CREATE; explicitly grant required connections/schema/table/function privileges. Review default privileges for future objects and membership/SET ROLE paths. Owner/migrator roles are separate from the provisioner that creates databases. Do not repurpose existing `postgres` or `agent_dev` superuser credentials for runtime.

Runtime must be NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, non-owner. Apply and test RLS including WITH CHECK and FORCE ROW LEVEL SECURITY where appropriate. Registry/resolver exceptions get narrowly scoped interfaces, not blanket runtime bypass. Session-local tenant settings are not proof of authentication: trusted code establishes transaction-local context, validates permissions, uses parameterized queries and clears pooled state. A compromised domain service is a residual risk to that domain's tenants; RLS based on a caller-set business ID alone does not eliminate that risk.

Use no FDW/dblink bridge or LLM-accessible generic connection string. Database credentials never enter prompts. Keep search paths fixed and schemas non-writable to untrusted principals. Restrict reporting payload fields and audit details; redaction must also cover n8n execution logs, tool traces, model context and error responses.

Separate database credentials are necessary but not sufficient for tenant separation. Every database access and both BM25/vector retrieval paths still require business and subject/audience authorization. Roll number, booking ID, phone number or remembered conversation text is not authentication.

## 5. Backup, recovery, restore and rollback

Backup manifest must cover four databases, cluster role/grant definitions, migration ledger versions, PostgreSQL/extension versions, source documents/embedding model revision, event retention watermarks, workflow/tool versions and protected secret recovery material. If an external BM25 index is selected, include either a consistent backup or a tested deterministic rebuild from retained versioned chunks. Restore compatibility must be verified before selecting the final BM25 engine.

Separate logical dumps do not provide an atomic cross-database snapshot. For an initial controlled logical backup, quiesce writers and workers across all four databases, record pending outboxes/inboxes and manifest checksums, and keep the write barrier until dumps finish. Alternatively later use a tested server-wide physical backup/WAL recovery plan. Neither option makes external Calendar/WhatsApp state part of the database snapshot. Outbox/inbox/idempotency retention must cover the backup/replay horizon; purge is blocked until recovery/replay requirements are satisfied.

Actual restore drill, required before acceptance:

1. Restore compatible roles/schema/extensions and all database backups into a network-isolated recovery instance with outgoing WhatsApp, Calendar, reporting and configuration workers disabled. No application traffic.
2. Check backup integrity, migration versions, row counts, business ownership, FK integrity, pending jobs, audit/idempotency continuity and restrictive grants using actual runtime credentials.
3. Treat restored session/grant/action confirmation state as untrusted: expire/revoke sessions, grants and unused approvals and require fresh verification. Reconcile business action idempotency records; do not erase them as session cleanup.
4. Compare central configuration with authoritative routing and reissue current signed configuration. Do not allow a restored old mapping to reactivate a disabled tenant or obsolete instance.
5. Reconcile central reporting against each domain. If control was restored older, replay retained events even if producer previously marked them acknowledged. If a domain was restored older than control, quarantine newer projections and identify lost source transactions; central reporting is not sufficient evidence to recreate lost orders or appointments. Use backup/WAL/source reconciliation and operator review. Do not reset aggregate versions and blindly replay into newer central state.
6. Verify representative tenant-scoped business queries, original policy sources, embedding dimensions/version compatibility and BM25/vector results. Rebuild derived indexes only from approved source generations.
7. Compare external effects with provider records before resuming workers. Unknown sends remain uncertain; do not resend automatically. Check Calendar appointments using stable provider references and current booking versions. A database rollback cannot unsend a message or cancel a real-world effect.
8. Record measured recovery duration and lost-data interval, sanitized assertions, failures and fixes. Only enable workers/traffic after reconciliation and acceptance. Production RPO/RTO and acceptable outage remain owner decisions; no numeric service promise is invented here.

Recovery is not the same as migration rollback. Use per-database versioned expand/contract migrations and an application compatibility matrix; deploy schema changes before dependent tools. PostgreSQL database creation itself is outside a transaction, so Phase 4 provisioning needs an idempotent manifest and explicit partial-failure recovery. If one database migration fails, stop dependent activation, retain already valid databases, and rerun/repair deliberately. Do not automatically drop populated databases.

For code rollback, stop new action dispatch, return to a compatible tool/workflow version, preserve committed records/events and reconcile effects. Destructive down-migrations or restoring all domains for one bad application release are not default rollback procedures. Each domain has its own migration ledger, backup identity and recovery evidence, even on a shared server.

Phase 1 DPAPI backups demonstrate local-user decryption only; they do not yet prove portable off-machine restoration or recovery of this proposed four-database design. Full restore and rollback drills remain required gates.

## 6. Priorities and phase exit

- Must Have now in design: four ownership boundaries, scoped credentials, local FKs and business authorization, local transaction/audit/idempotency/outbox, central synchronization contract, recoverable backup and rollback plan.
- Must Have before enabling each feature: real runtime-role RLS tests, config revocation behavior, retry/crash/replay tests, transactional invariants, verified sensitive access and feature-specific recovery evidence. Later security/error phases consolidate these controls; they do not postpone them.
- Should Have: outbox lag/dead-letter dashboards, reconciliation tooling, versioned configuration admin and automated restore rehearsals.
- Could Have: Redis, reranking and independent specialist LLM agents after measured need.
- Future / Deferred: separate PostgreSQL servers per domain, distributed analytics infrastructure, multi-region failover, real production data and payment collection.

Phase 3 exit: generated catalog/ERDs match this document, all offline checks pass, unresolved production policies are recorded, and the user accepts the revision. Phase 4 is limited to four dev databases, restricted roles, 16 foundational catalog tables plus migration bookkeeping, synthetic bootstrap and corresponding database tests. No source production database or existing working n8n workflow is altered by this design review.

## References

PostgreSQL documents [database/schema boundaries and cluster-wide roles](https://www.postgresql.org/docs/15/ddl-schemas.html), and [RLS behavior and privileged bypass](https://www.postgresql.org/docs/15/ddl-rowsecurity.html). The [pgvector installation and hybrid-search documentation](https://github.com/pgvector/pgvector) describes per-database extension enablement and combining retrieval results. Synchronization and recovery contracts above are this project's proposed design, not features automatically supplied by pgvector or PostgreSQL.
