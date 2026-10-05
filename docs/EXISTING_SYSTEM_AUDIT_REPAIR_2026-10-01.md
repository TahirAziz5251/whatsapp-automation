# Existing System Audit — Repair Progress

Date: 2026-10-01 (Asia/Karachi). Readiness: **NOT READY**. Step 1 functional verification remains incomplete. After a manual PC restart, the user explicitly instructed work to resume at Step 2; this supersedes the earlier ordering restriction. Step 2 implementation is under verification. Steps 3–8 have not passed.

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

**NOT READY for an end-to-end PASS or production readiness claim.** Step 1 has outstanding functional verification. Step 2 is being verified after the changes below. No Step 3–8 completion is claimed. No volumes or databases were deleted or reset during this repair.

## Step 2 — Docker networking, ports, volumes and recovery

### Audit / finding and root cause

- Host routing worked, but direct service-name routing failed in both directions between n8n and Evolution because the services were on different Compose networks. n8n could already reach Redis.
- Read-only queries from n8n reached platform_db, bise_db, pos_db and hospital_db at the native PostgreSQL 18.6 server, port 5432. This confirms the network destination; full pgAdmin identity/business mapping review remains Step 3.
- Two Compose files defined conflicting Evolution, n8n and legacy PostgreSQL services. Default startup could create a second gateway or collide with native PostgreSQL on port 5432.
- A never-started replacement Evolution container remained from an interrupted recreation. Its writable layer was empty. Compose also differed from the working runtime by re-enabling the global callback, risking duplicate dispatch after recreation.
- The three running services had no Docker health checks or bounded Docker JSON logs. Redis was published on all interfaces despite being used internally.
- Service stop/recreate operations completed slowly, taking substantially longer than normal shutdown grace periods. Host measurement showed 8,251,232 KiB total RAM and 462,344 KiB free (about 451 MiB). Memory pressure is observed; it has not been proven to be the sole cause of slow startup.

### Design / backup / implementation

Backup: `D:\AI-Automation\backups\repair-step2-20261001-201340`. Current Compose files, DPAPI-encrypted container configurations (including the unused replacement), published/draft workflow, and validated native Evolution session/platform PostgreSQL dumps are retained. Redis snapshot `redis-before.rdb` passed redis-check-rdb and has SHA-256 `8A4875BDBF196A2F6889665560FEC1EF8910269887B4A9C5532B11BC23DB88E7`.

- Pinned n8n, Redis and Evolution to their already-deployed image digests. No upgrade or image pull was performed.
- Added Evolution to the existing n8n/Redis network via a persistent external Compose network declaration, retaining its original network too.
- Preserved all existing volume mappings and credential settings. A preflight comparison verified these before recreation.
- Added explicit profiles for unused/conflicting alternative, legacy PostgreSQL and optional KB services. Default root startup now selects n8n/Redis; default Evolution startup selects Evolution only.
- Restored global WEBHOOK_URL empty in Evolution Compose to match the working per-instance dispatch design. Existing per-instance callbacks were retained.
- Added n8n readiness, Evolution `/server/ok`, and Redis PING health checks. The Evolution endpoint was verified from installed source and a live HTTP test before deployment.
- Added Docker log rotation (10 MB, three files) and restricted Redis's published port to 127.0.0.1:6379.
- Removed only the never-started, empty replacement container after backup. No `-v`, volume deletion, database reset or cleanup of other projects was used.
- Recreated the three scoped services. The legacy PostgreSQL and unrelated stopped stacks remain stopped.

### Test / verify / current result

Initial staging validation failed on comparing an absent environment section with an empty object; both Compose files were automatically restored. The validator was fixed and rerun: PASS, with expected defaults, preserved volumes and preserved credentials.

After recreation, Evolution and Redis became healthy. n8n was still starting at the first verification snapshot. Image identity, mounts, restart policies, log bounds, shared network membership, global callback state, Redis loopback binding, stale replacement cleanup and Redis AOF checks passed. A namespaced dummy Redis key survived recreation. Direct n8n-to-Evolution service routing now succeeded. Full n8n readiness, its workflow/SQLite check, Evolution-to-n8n readiness, and the post-change native database matrix remain subject to successful rerun; timeout/starting results are recorded as FAIL, not silently promoted to PASS.

Evidence files: `docs/development-repair-20261001/step2-docker-before.json`, `step2-network-before.json`, `step2-design.json`, `step2-network-after.json`, and `step2-verification.json`.

Current gate: **FAIL / verification in progress**. Do not advance to Step 3 until the required checks pass, or document an exact remaining blocker.

### Production readiness gaps

Application ports 4000/5678 retain their existing bindings to preserve current callback routes. Production requires a reviewed TLS/reverse-proxy and firewall/port exposure design. Native PostgreSQL access controls and least privilege need Step 3 review. Health checks report unhealthiness; `unless-stopped` does not itself restart a merely unhealthy container. Startup latency and host capacity need evidence-based resolution. These are not a production PASS.

References: [Docker Compose networking](https://docs.docker.com/compose/how-tos/networking/), [Compose service settings](https://docs.docker.com/reference/compose-file/services/).
