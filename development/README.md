# Phase 1 development environment

This is a fresh, isolated environment for synthetic data. It does not import production workflows, credentials, WhatsApp sessions, or database records.

Start from PowerShell 7:

```powershell
& 'D:\AI-Automation\scripts\phase1-dev.ps1'
```

- n8n: http://localhost:15678 (local machine only).
- PostgreSQL: service `postgres`, database/user `agent_dev`, accessible only inside the development network.
- Separate Compose project `business-agent-dev`, private database network, separate UI network, and fresh named volumes.
- Images are pinned to locally verified repository digests; startup does not pull images.
- Dev n8n currently uses SQLite, matching the current deployment's backend. The separate dev PostgreSQL is reserved for subsequent dummy application schemas. Backend migration is a separate reviewed decision.
- No Evolution container, production session, activated workflow, or LLM connection is installed here.
- PostgreSQL has no published port and uses the internal network only. n8n also uses a separate UI bridge to support the loopback UI port; this permits outbound network access and is not an egress security boundary. No production credentials, WhatsApp sessions, or workflows are imported. Only designated test integrations may be configured.
- Dev secrets are generated randomly and saved encrypted using Windows DPAPI CurrentUser. The startup script injects them only for the Compose process and clears those environment variables afterward.
- `N8N_SECURE_COOKIE=false` is exclusively for this loopback HTTP development endpoint.

## Backup

```powershell
& 'D:\AI-Automation\scripts\phase1-backup.ps1'
```

Backup artifacts are under `backups/phase1-<timestamp>`. Each artifact is encrypted; the manifest records hashes and decryption verification. Secrets, runtime configuration, credentials and WhatsApp-related data may exist inside the encrypted artifacts; do not distribute decrypted copies.

DPAPI is tied to this Windows identity and its keys. These backups alone are not a portable/off-machine disaster-recovery solution. An independently recoverable encrypted backup and key-custody procedure must be chosen and tested before production acceptance.

The script verifies a consistent SQLite online snapshot with `PRAGMA integrity_check`. PostgreSQL uses logical `pg_dumpall` snapshots; this is not one atomic snapshot across all databases/services. Ancillary files are archived live. Avoid configuration/extension changes during capture. Full isolated application restore and rollback remain separate gates; encryption roundtrip is not restore acceptance.

The unrelated `n8n-automation-db-1` container from `J:\n8n-automation` is outside the current deployment backup scope.

## Phase boundaries

Phase 1 does not create business schemas or seed data. Database discovery comes next, followed by ERD review and later versioned migrations. Do not copy live backups into this synthetic development environment. A future restore drill must use its own restricted recovery environment with outbound actions disabled.
