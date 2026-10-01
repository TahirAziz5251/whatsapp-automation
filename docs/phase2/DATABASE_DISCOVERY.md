# Phase 2 — Database discovery and deployed workflow baseline

Reviewed 2026-09-23. Status: read-only discovery and six metadata verification checks completed; user review required before Phase 3 ERD/design. No business tables, roles, workflows, or container configuration changed.

## Outcome

The live setup is materially different from the local workflow export. The requested n8n workflow `Iin5wt0nRAhO7UV9` is active and its published definition was located using `activeVersionId` and `workflow_history`. It has 12 nodes; the local export has 10. The stored draft, published version and local export have different structural hashes. Hashes compare normalized node names/types/versions/parameters and connections; they exclude credentials, positions, and other workflow settings. This is evidence of definition differences, not a complete deployment-equivalence check.

Do not overwrite or import the local JSON into the working n8n instance as a presumed backup of its published workflow. The encrypted Phase 1 SQLite snapshot is the existing full n8n snapshot; discovery exports contain only sanitized metadata.

## Actual database inventory

| Database | Server | Tables | Purpose |
| --- | --- | ---: | --- |
| evogo_auth | evolution-postgres, PostgreSQL 15.19 | 18 | Whatsmeow device/session/authentication storage plus poll_votes |
| evogo_users | evolution-postgres, PostgreSQL 15.19 | 4 | instances, labels, messages, runtime_configs |
| postgres | evolution-postgres, PostgreSQL 15.19 | 3 | Prototype leads, chat_history, appointments |
| agent_dev | business-agent-dev-postgres-1, PostgreSQL 15.19 | 0 | Fresh development database; no business schema |

Current n8n uses SQLite (verified in Phase 1). The separate `n8n-automation-db-1` PostgreSQL instance belongs to another Compose project and remains out of scope; its name does not prove this n8n uses it.

Only `plpgsql` is installed in the four inspected databases. `vector` is absent from both installed and available extension catalogs. Future pgvector work requires compatible extension binaries/image before enabling the extension; running CREATE EXTENSION alone will not suffice on these images. No extension installation was attempted.

## Existing business prototype

| Table | Primary key | Findings |
| --- | --- | --- |
| leads | customer_phone | Phone is globally unique, with no tenant/instance scope. Lead and booking information share one latest-state row. |
| chat_history | id (int4) | Session/phone strings, sender, message text and timestamp. No FK to a customer/conversation and no provider message ID uniqueness. |
| appointments | event_id | Date/time stored as varchar. No doctor/resource/branch, duration/end time, patient FK, overlap protection or idempotency key. |

The three tables have three primary-key constraints, zero foreign keys, no check/exclusion constraints in the captured constraint catalog, and five indexes. `idx_leads_phone` duplicates the indexed key already provided by the primary key; leave it unchanged until a reviewed migration. `idx_chat_history_session` supports session filtering but the eventual recent-history query needs its own measured index design.

Columns and constraints are recorded in `database-metadata.json`. Column values and customer records were not queried. No row counts or data-quality assertions are claimed. No Sales inventory/order/payment schema, BISE examination schema, or Hospital scheduling model exists among these three prototype tables. Actual institutional/business source schemas are still unknown and must be mapped in the later production-integration phase.

## Security findings

- Application prototype tables contain no business_id/tenant_id.
- No inspected table has RLS enabled. This is a discovery finding, not a reason to modify Evolution-managed tables.
- The only non-system login role recorded on Evolution's PostgreSQL is `postgres`; it is superuser and bypasses RLS.
- The bootstrap `agent_dev` role is also superuser/BYPASSRLS, as initialized by the PostgreSQL container. It must not become the runtime agent/tool credential. Phase 4 should introduce separate owner/migration/runtime roles with least privilege.
- BISE source access must remain read-only; sessions/audits/CRM writes belong to separately authorized application storage.
- Do not use one phone identifier as a global authorization or cross-business session key.

No passwords, authentication/session row values, or raw student/patient/customer records were exported.

## Published workflow versus local code

| Feature | Local export from prior/current inspection | Published workflow metadata/features |
| --- | --- | --- |
| Node count | 10 | 12, including Limit and No Operation |
| Custom tool type | toolCustom | toolCode version 1.3 |
| Knowledge tool | Calls faiss-service | No faiss-service reference; lexical ranking markers and no detected HTTP/SQL call |
| CRM | PostgreSQL INSERT code | No detected PostgreSQL require, SQL INSERT/SELECT or HTTP call; returns CRM_UPDATED |
| Calendar | Simulation | Synthetic evt_/Date.now ID and fixed unavailable-time branch detected |
| Memory | Window buffer | Window buffer version 1.3 |

Tool feature inspection is static and does not execute tools. It establishes that the published definition differs and does not show the local SQL/FAISS integration. It does not establish retrieval accuracy, delivered messages, or successful live database writes. The working WhatsApp conversation flow and persistent business integration must be evaluated separately.

## Phase 3 design inputs

1. Preserve Evolution-managed databases and the working n8n deployment.
2. Design a new synthetic application model in dev; do not clone live customer data into it.
3. Establish tenant/business and WhatsApp-instance mappings before customer/session tables.
4. Separate contact identity, conversation, message, verification grant, pending action and lead state.
5. Use tenant-consistent keys/foreign keys and enforce permissions outside LLM prompts.
6. Model message/action idempotency, processing state, outbox and audit events.
7. Model actual appointment instants, resources, duration/capacity and scheduling authority.
8. Model Sales transactions and BISE read-only source adapters independently of the prototype CRM schema.
9. Reserve knowledge document/chunk/version/permission contracts for BM25 + pgvector; dynamic prices/results/slots remain authoritative structured facts.
10. Design session scope and authorized-history retrieval before exposing AI tools.
11. Treat database names in the proposed ERD as proposed development entities, not claims about real Board/hospital source systems.

## Required phase review

| Item | Phase 2 decision/evidence |
| --- | --- |
| Business objective | Establish actual storage boundaries and existing schema before ERD/migrations. |
| Measurable result | Four scoped PostgreSQL databases inspected; active published workflow identified; six metadata checks passed. |
| Reuse | Existing transport/orchestration and internal databases; reusable business concepts, not an automatic copy of the old schema. |
| Dependencies | Read-only Docker access, known container identities, psql and SQLite read-only access. |
| Required data | Catalog metadata and sanitized workflow structure only. |
| Integrations | PostgreSQL metadata inspection and read-only n8n SQLite query. |
| Proposed design | Preserve running systems; design dummy application schema separately in Phase 3. |
| Alternatives | Local SQL/JSON alone rejected as runtime evidence; actual deployed schema and published version used. |
| Failure cases | Wrong container/database, draft/published drift, missing vector binaries, partial metadata output. |
| Authentication/authorization | Existing local Docker access; catalog inspection only. Runtime least-privilege roles deferred to implementation. |
| Sensitive data | No business rows or raw workflow code/credentials exported. |
| Recovery | Metadata script can be rerun; failures stop the script. |
| Backup | Encrypted Phase 1 snapshot retained; no new live-data backup required for catalog SELECTs. |
| Restore verification | No restore performed in discovery; full restore remains a separate explicit gate. |
| Rollback | No database/workflow mutations to roll back; new local report/script files are the only artifacts. |
| Test cases | Scope, read-only mode, requested workflow active, published version resolution, PK capture and dev emptiness. |
| Evidence | database-metadata.json, workflow-metadata.json, published-tool-features.json, verification.json. |
| Pass/fail | All six metadata assertions PASS; discovered architectural gaps are Phase 3 requirements, not silently treated as working features. |
| Essential/deferred | Discovery essential now; production data profiling and source adapter validation deferred. |
| Exit criteria | Metadata evidence complete, deployment differences documented; user reviews findings before Phase 3. |

## Reproduce

From PowerShell 7 with authorized Docker access:

```powershell
& 'D:\AI-Automation\scripts\phase2-discovery.ps1'
```

The script writes sanitized discovery files under `docs/phase2`. PostgreSQL statements run inside explicit READ ONLY transactions with 15-second statement timeouts. SQLite is opened with OPEN_READONLY. Existing `verification.json` records this review's six checks and local/published comparison; rerunning discovery alone does not refresh that separate verification snapshot.
