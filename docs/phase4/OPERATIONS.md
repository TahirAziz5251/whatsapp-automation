# Phase 4 development operations

Target: `business-agent-dev-postgres-1` only, PostgreSQL 15.19. Production Evolution, its databases, existing n8n on 5678 and unrelated Docker projects are not migration targets.

## Layout

| Database | Foundational tables | Extra bookkeeping | Roles |
| --- | --- | --- | --- |
| control_db | platform.businesses, instances, audit_events, configuration_outbox | app_meta.schema_migrations | control_owner, control_migrator, control_runtime |
| pos_db | platform.businesses, instances, audit_events, configuration_inbox | app_meta.schema_migrations | pos_owner, pos_migrator, pos_runtime |
| bise_db | platform.businesses, instances, audit_events, configuration_inbox | app_meta.schema_migrations | bise_owner, bise_migrator, bise_runtime |
| hospital_db | platform.businesses, instances, audit_events, configuration_inbox | app_meta.schema_migrations | hospital_owner, hospital_migrator, hospital_runtime |

There are 16 foundational tables and four additional migration-ledger tables. Domain schemas such as sales/bise/hospital/knowledge are introduced in their later feature phases. No real student, patient, order or payment data is loaded. Six dummy businesses exist centrally, two copied into each respective domain with corresponding instance/configuration/audit fixtures.

Dummy configuration leases last 24 hours and are not automatically renewed by migration reruns. They do not authorize a live webhook or production access. Asia/Karachi is deliberately the constrained pilot timezone. More timezones require a reviewed migration and timezone validation policy.

## Credentials and boundaries

Passwords are random and encrypted with Windows DPAPI CurrentUser in `development/phase4-secrets.dpapi`, ignored by git. This is local development secret custody, not a production secret manager or portable key recovery. Scripts do not print passwords or pass them as process arguments. SCRAM HBA rules apply to Phase 4 roles on TCP and Unix sockets; preexisting bootstrap admin authentication remains unchanged. Never hand the bootstrap admin or migration login to an LLM/tool runtime.

Owner roles are NOLOGIN. Migrators can explicitly assume their own owner for DDL; runtime roles have no owner membership, superuser, BYPASSRLS, CREATEDB, CREATEROLE or table ownership. Runtime has scoped reads of business/instance metadata and SELECT/INSERT on audit, but cannot mutate routing, configuration inbox/outbox, audit history or schema. All foundational tables use ENABLE and FORCE RLS with both USING and WITH CHECK. PUBLIC connection/temporary access is revoked on new DBs and the dev bootstrap databases agent_dev/postgres; unrelated servers are unaffected.

`SET LOCAL app.business_id` is a trusted-service context mechanism, NOT identity verification. A runtime credential holder can select another valid tenant context within that domain; only trusted application code may hold it. Phase 4 tests database filtering and privilege boundaries, not the future webhook/subject authorization implementation. No arbitrary SQL or database credentials are exposed in a public agent tool. Later typed tools must validate caller-to-business permission before establishing context.

Audit detail keys are allowlisted and size-bounded. Content redaction and actor authenticity still require the trusted service layer; a database JSON check alone cannot identify all PII inside otherwise valid strings. Runtime audit UPDATE/DELETE/TRUNCATE is denied.

## Reproduce

Run from the project root in PowerShell with Docker access:

```powershell
node scripts/verify-phase3-design.cjs
# Capture before only for a new deployment; preserve the original evidence on this deployment.
# ./scripts/phase4-analyze.ps1 -Stage before
# node scripts/phase4-report.cjs
node scripts/build-phase4.cjs
./scripts/phase4-implement.ps1
./scripts/verify-phase4.ps1
./scripts/phase4-analyze.ps1 -Stage after
node scripts/verify-phase4-catalog.cjs
./scripts/phase4-restore-check.ps1
```

The provisioner creates an encrypted pre-run development-server backup, validates the fixed container identity and PostgreSQL major version, provisions only managed-name databases/roles, and applies checked SQL using the database-specific migrator. It refuses unmanaged name collisions. Each migration and synthetic fixture batch commits with a checksum ledger entry in one local transaction. An applied checksum mismatch fails rather than overwriting a deployed migration. Changing an applied migration requires a new versioned migration; do not edit then expect reapply.

The initial bootstrap is an explicit offline synthetic loader, not an implemented configuration-distribution service. Domain projection/inbox/audit rows are inserted locally together; central bootstrap events are acknowledged only after all domain loads complete. No background reporting/configuration, WhatsApp or Calendar workers are enabled. Config replay/revocation and real service authorization remain later activation gates.

## Recovery and partial failure

Database creation cannot be wrapped in one four-database transaction. `provisioning-manifest.json` identifies completed databases and the failure; already valid databases remain intact. Retry skips checksum-verified migrations. A crash between creating an object and marking it managed intentionally requires inspection instead of adopting a possibly unrelated database/role automatically. Never resolve a collision by dropping an existing database.

HBA changes are limited to the Phase 4 named-role block; the original file is preserved inside the dev volume as `pg_hba.conf.before-phase4`. The provisioner replaces only its own marked block and validates/reloads it. If authentication recovery is needed, use the local bootstrap admin through the controlled Docker environment to inspect the HBA rules and restore the protected configuration. Do not weaken runtime password checks as a workaround.

Before restoring, stop action/worker traffic and use an isolated target. The restore-check script decrypts its per-database backup in memory, restores into a fixed disposable `phase4_restore_*` database, compares all table fingerprints plus ledger, checks ownership/FORCE RLS and runtime tenant filtering, and removes only its own marked disposable database. It refuses to overwrite an existing restore target. Backups remain encrypted under backups/.

These restore drills use existing server roles and synthetic data. They do not prove restoration of a lost PostgreSQL server, off-machine DPAPI recovery, coordinated point-in-time recovery, knowledge indexes or external service effects. Full backup/restore, authorization revocation, event reconciliation and deployment rollback remain separate acceptance work. There is no destructive automatic down migration.

If CREATE DATABASE times out, the server may still have committed creation. Inspect before retrying. `phase4-restore-check.ps1 -Only control_db,pos_db -ResumeTimedOutCreations` may resume only targets with a matching recorded creation timeout, expected owner, no preexisting marker, no active sessions and no user relations. Anything else is refused. After verification the target receives the disposable marker and follows the normal restore/cleanup path. This avoids assuming that a timeout means nothing happened.

## Evidence and next gate

- DATABASE_ANALYSIS_REPORT.md: actual pre-migration metadata versus clearly labeled proposed columns; Board schema unavailable.
- IMPLEMENTED_DATABASE_CATALOG.md and catalog-verification.json: actual columns/keys and model comparison.
- verification-initial.json: first test run, including the localhost trust-authentication finding and connection-error assertion issue.
- verification.json: latest live isolation/constraint/rollback test results; inspect PASS/FAIL, not just file existence.
- restore-verification.json: actual restore drill outcomes and limits, when completed.
- provisioning-manifest.json: managed resources and provisioning status; it is not by itself an acceptance certificate.

Phase 5 must wait for Phase 4 verification and user review. pgvector remains Phase 12; BISE actual source mapping, protected verifier storage and examination tables remain later work. No phase advancement is inferred merely from successful table creation.
