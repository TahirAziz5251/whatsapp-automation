# Existing System Audit — Repair Progress

Date: 2026-10-01 (Asia/Karachi). Readiness: **NOT READY**. Step 1: **BLOCKED on Docker/host recovery; functional verification incomplete**. Steps 2–8 have not passed and must follow Step 1 sequentially.

## Step 1 — Webhook dispatch, identity and deduplication

### Audit and root cause

- Reported missing message: approximately 16:53 Pakistan time (11:53 UTC), sender ending 4789, asking for dummy roll 102450. An exact event-to-execution correlation has not been established.
- Evolution GO source gates webhook producer invocation on a nonempty instance webhook. The producer then dispatches to configured global and instance URLs separately. A global-only configuration drops events at the outer gate; configuring both URLs can dispatch twice. The earlier global-only repair was incorrect.
- The current published workflow is `Ag4HbAjKlfHH6Xk7`, version `2dea9d33-591e-46d0-a031-0ead966d160e`. The user has reconnected Data, KB, Action, Calendar and CRM tools. Their connections were preserved; invocation success is not yet verified.
- Completed and failed history were inspected, not only running executions. Previously seen execution rows were no longer retained. Absence in retained history does not prove that a webhook never arrived.
- Existing Redis deduplication accepts an event before processing with a 24-hour TTL. Failure/retry behavior and authenticated instance identity still need repair and tests.

### Design and backup

Use a single per-instance callback with the global callback disabled. Preserve the current published graph and persistent storage. Verify instance/sender/message identity, concurrent duplicates, failures and retries before passing Step 1.

Validated backup: `D:\AI-Automation\backups\repair-step1-20261001-172000`. Includes the current workflow and published graph, Compose files, DPAPI-encrypted runtime configuration, and PostgreSQL custom-format dumps for evogo_users, evogo_auth and platform_db. Dump listings and backup hashes were verified. An earlier complete n8n SQLite snapshot is in `backups\student-remediation-20261001-151004`; do not restore it over subsequent user changes.

### Changes and evidence

- Disabled Evolution GO global WEBHOOK_URL in its existing Compose file after checking the deployed image, environment and mounts against the backup.
- Recreated only the Evolution GO service, retaining its image and persistent data/log volumes. An initial stop failed with a missing exit event; the later scoped retry completed.
- Configured the Student instance callback to `http://host.docker.internal:5678/webhook/evolution-whatsapp-agent`, retaining MESSAGE subscription.
- At 12:37:04 UTC, the API confirmed global callback disabled, per-instance callback configured, connection request HTTP 200, Connected=true and LoggedIn=true. Evidence: `docs/development-repair-20261001/step1-dispatch-applied.json`.
- At approximately 12:38 UTC, n8n liveness returned 200 but readiness returned 503. This is not evidence of a working end-to-end system.
- Local commands subsequently hung. The user confirmed the PC or Docker Desktop was hung and explicitly approved a Docker Desktop restart, including temporary interruption of the unrelated `n8n-automation-db-1` container.
- Recovery was requested using the supported `docker desktop restart --timeout 120` command. Completion and post-restart readiness are not yet verified.

### Remaining verification

Confirm Docker recovery and mounts, n8n readiness, Student session, the active published graph and registered callback. Then repair and exercise authenticated identity and durable deduplication/retry behavior. Trace a new user-originated WhatsApp message through Evolution, n8n, BISE retrieval and actual delivery. Do not report PASS from API connectivity or synthetic no-op tests alone.

## Component status matrix (current evidence)

| Component | Classification | Evidence / limit |
|---|---|---|
| Evolution Student session and callback | PARTIAL | Configuration and session verified before host hang; restart verification pending |
| n8n execution service | PARTIAL | Liveness 200, readiness 503 before recovery |
| Message identity / source authentication | PARTIAL | Basic normalization present; full identity binding not verified |
| Persistent deduplication / retries | PARTIAL | Redis gate exists; accepted-before-processing failure gap remains |
| Docker runtime | PARTIAL | Host hang confirmed; approved recovery pending verification |
| PostgreSQL / business mappings | PARTIAL | Previous live retrieval evidence exists; requested fresh cross-check still pending |
| BISE retrieval | PARTIAL | Previous dummy result tests passed; full new matrix and live delivery pending |
| KB ingestion and retrieval | PARTIAL | Reported mock/missing implementation requires current invocation audit |
| Calendar, CRM and action tools | PARTIAL | Reconnected graph confirmed; real invocation and permitted actions unverified |
| POS and Hospital sessions | PARTIAL | Previously disconnected; restoration follows Student PASS |
| Backups | WORKING | Scoped backup validated; full disaster-recovery restore not exercised |

## Readiness decision

**NOT READY for an end-to-end PASS or production readiness claim.** Step 1 remains blocked by environment recovery and incomplete functional verification. No Step 2–8 completion is claimed. No volumes or databases were deleted or reset during this repair.
