# Student-first remediation — 1 October 2026

## Verified work

The read-only audit, component matrix and architecture gaps are in [Existing System Audit](EXISTING_SYSTEM_AUDIT_REPORT_2026-10-01.md). Audit observations describe the system before remediation.

- Student's duplicate instance webhook was removed through Evolution's supported API after backup. The global webhook remains. Connected and LoggedIn were verified afterward. Real incoming-message uniqueness still needs channel verification.
- The workflow source now uses the audited workflow ID and credential references, real Info.ID normalization, atomic Redis deduplication, native platform tenant lookup, preserved session context and read-only live BISE/POS/Hospital queries. Seeded fallbacks have been removed from the data gateway.
- BISE response fields are formatted from current SQL evidence, including subject marks. Unavailable databases are distinguished from absent records. CNIC, date of birth and student phone are excluded.
- Unsupported mock KB, Calendar, CRM and Action tools are disconnected from the agent. Durable conversation memory remains unimplemented and is honestly marked as such.
- Model selection: openai/gpt-oss-120b, supported output setting maxTokensToSample=512, temperature 0.1, memory window 2, maxIterations 3. Provider headers verify 8,000 tokens/minute and 1,000 requests/day for this account/model; these remain finite limits.
- 21/21 direct runtime checks PASS against real PostgreSQL and Redis. Coverage includes all four BISE results, subjects, absent and malformed rolls, year filtering, database outage, tenant isolation, POS active products, Hospital filters and concurrent deduplication.
- User explicitly authorized the Groq payload and live student test, excluding CNIC, birth date and phone from tool output. The real Groq/database round trip PASS: first call HTTP 200 and correct result tool selection (738 total tokens); second call HTTP 200 and normal stop (1,234 total tokens); response guard DATABASE_VERIFIED, matching marks and 8 subject rows. Total for this empty-history test: 1,972 tokens. This does not guarantee burst traffic cannot exhaust the account quota.

## Backup and deployment

Backup directory: backups/student-remediation-20261001-151004. Six PostgreSQL custom dumps passed pg_restore --list. Original local and active workflows, compose files, student webhook settings and Windows DPAPI-encrypted runtime configuration are saved.

The replacement n8n SQLite snapshot passed PRAGMA quick_check in the container and on the host. SHA-256 checks matched before and after transfer/decompression. The invalid first copy was replaced with the validated snapshot. The manifest records 22 files and their hashes. A full disaster-recovery restore has not been exercised.

Preflight confirms the same n8n encryption key, exact image and persistent volume. The intended external-module change is pg → pg,ioredis; the only other compose difference is an equivalent WEBHOOK_URL trailing slash.

The previously active workflow was found inactive with unchanged code/version before deployment. The user explicitly authorized publication after verification. Supported n8n CLI import/publish and service recreation completed. Published version b0c1baa6-9147-4284-8178-0c21f7f68713 is active, matches the tested nodes and connections exactly, and has pg,ioredis enabled. HTTP health and readiness both returned 200 at 11:07 UTC. The JavaScript runner registered and the POST webhook is present. Synthetic self-message execution 3051 passed and stopped at No Operation with zero agent runs and no outbound send. Native live student retrieval and WhatsApp delivery are still pending the user’s incoming message. Startup took approximately nine minutes and logged intermittent database timeouts and runner grant-token expiry before recovering; this remains an operational reliability limitation.

## Remaining acceptance

1. Deployment/readiness gate PASS: exact published code match, one registered webhook, JavaScript runner registered, health 200, ignored-self-message smoke PASS.
2. The user sends from their second WhatsApp account to student-assistant (923127118485): “Mera roll number 102450 hai, result aur subject-wise marks bata dein.” Compare the current database result, tool observation, guarded response and outbound acknowledgement. Confirm one inbound message ID reaches the agent once and one reply arrives. Self-message echo events that stop at the filter are separate from duplicate agent runs.
3. Send an unknown roll query, 999999, after the first reply. Verify a current lookup returns NOT_FOUND, without a fabricated result.
4. POS and Hospital are disconnected. Their live channel tests await reconnection; direct SQL tests are already passing.

AUDIT and DESIGN complete. BACKUP verified. Student-scope IMPLEMENT deployed. Direct database/Redis, Groq and webhook smoke TEST gates PASS. Live retrieval/channel VERIFY is pending. Overall acceptance: NOT PASS yet.

## Rollback

Restore the saved student-webhook-settings.json through the same instance's supported /instance/connect API using its current token, without logging secrets. Restore local workflow and compose from the dated backup as needed. Restore the original active-workflow.json through n8n import:workflow, publish ID Ag4HbAjKlfHH6Xk7, and restart n8n. The SQLite snapshot is a consistent fallback for the n8n data store. No business-table records were changed by the retrieval fixes.
