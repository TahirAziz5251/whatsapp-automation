# Phase 1 — Backup and development environment

Date: 2026-09-23. Scope: local baseline backup and fresh development environment. No business migrations or production workflow changes.

## Verified baseline

- Production Compose location: `evolution-go/docker/examples/docker-compose.yml`.
- Running containers: `evolution-go`, `n8n`, `evolution-postgres`.
- n8n version 2.19.4, SQLite backend, one active workflow.
- Evolution PostgreSQL databases: `evogo_auth`, `evogo_users`, `postgres`.
- Additional `n8n-automation-db-1` belongs to `J:\n8n-automation`; excluded from this scope.

## Backup evidence

Directory: `D:\AI-Automation\backups\phase1-20260923-173602`.

- 17 encrypted artifacts; every artifact passed decryption/hash roundtrip verification.
- SQLite online snapshot: `PRAGMA integrity_check` returned `ok`.
- PostgreSQL logical cluster dump completed successfully.
- Runtime configuration, n8n supporting files, Evolution dbdata and selected local configuration/source artifacts captured encrypted.
- Backup artifacts and generated development credentials excluded from Git.
- No full application restore performed. Do not interpret cryptographic verification as restore acceptance.
- Windows DPAPI CurrentUser protection is tied to this identity and key material. Off-machine recovery is not yet established.
- Backups across services are not globally atomic; ancillary files were captured live.

## Development evidence

- Dedicated Compose project: `business-agent-dev`.
- PostgreSQL healthy; `agent_dev` exists with zero public business tables.
- n8n has zero workflows; no production credentials/session data imported.
- n8n readiness endpoint returned HTTP 200 with `{"status":"ok"}` at `http://127.0.0.1:15678/healthz/readiness`.
- n8n UI bound only to `127.0.0.1:15678`; PostgreSQL has no host port.
- Separate named volumes and networks; database network internal.
- UI bridge allows outbound access; network isolation is not an outbound-access firewall.
- Production containers remained running without a task-triggered restart.

## Observed failures and resolution

- Initial readiness checks ran before initial database migrations finished; repeated after initialization and passed.
- Internal-only network did not publish the n8n UI port on this Docker setup. Added a separate UI bridge while keeping PostgreSQL internal; loopback binding and HTTP readiness then verified.
- Repository-wide diff check reported an existing trailing blank-line issue in the production compose file. That pre-existing file was not changed by this phase.

## Gate

Phase 1 local backup/dev setup checks passed. User review is pending before Phase 2 database discovery. Full restore, independently recoverable backup storage/key custody, and rollback drills remain explicit later acceptance gates. n8n owner onboarding is left to the user at the localhost UI; no owner password was invented or configured.
