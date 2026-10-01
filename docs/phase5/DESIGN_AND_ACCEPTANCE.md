# Phase 5 — Customer and CRM

Phase 4 is accepted; this phase changes isolated dev PostgreSQL only. Control remains routing/configuration/reporting infrastructure. No customer records are centralized. Existing WhatsApp/n8n workflow activation and private student/patient authorization are not part of this migration.

## Scope and design

Eight tables: contacts and channel_identities in each of pos_db/bise_db/hospital_db, plus leads and lead_events in pos_db. Two active and one blocked synthetic contact per dummy business: 18 contacts/identities overall. Four POS leads include new and progressed examples. Eight lead events retain their transition history. Names explicitly say Synthetic and identities use example.invalid; they cannot be used as real WhatsApp destinations.

Customer profile is the scoped contact/display name/status and channel linkage at this stage. Address, billing/invoice identity, consent preferences and richer editable profile fields require subsequent reviewed requirements. BISE/Hospital contacts are unverified people, not student/patient records. Reusing a channel string in another business/domain does not merge contacts or authorize records.

`platform.ensure_contact(instance,jid,kind,name)` validates active, unexpired domain routing and trusted business/actor context, serializes same-identity creation, and atomically inserts contact, identity and audit. Replay returns the same contact without overwriting its established name. Blocked/inactive contacts and kind conflicts are rejected. A different instance never implies the same person automatically.

`crm.apply_lead_event(contact,key,target_stage,expected_version)` atomically changes lead state, records immutable transition and audit. Initial state is new/version 1; allowed transitions are new → contacted/qualified/lost, contacted → qualified/lost, qualified → won/lost. Closed leads need a future explicit reopening policy. Generic inquiries must not reset progressed leads. Current pilot permits one lead per contact; repeat sales opportunities need a reviewed model extension.

Phase 3 lead_events gains expected_version, result_version and canonical SHA-256 payload_hash. These are required so retries return the original transition outcome even after later transitions and reject changed commands. Tenant-scoped event-key uniqueness, per-key/contact locks and expected-version checking prevent duplicate/concurrent mutation. Deadlocks across multiple independently ordered calls in one outer transaction may still require bounded caller retry; one API operation per transaction is the intended contract.

Runtime receives SELECT and EXECUTE only on these new objects. Mutations go through fixed SECURITY DEFINER functions owned by NOLOGIN, non-BYPASSRLS domain owners. Tables FORCE RLS, function search_path is fixed to pg_catalog, object names are qualified and PUBLIC execute is revoked. Migrators retain controlled owner access for schema/fixture/recovery work. A trusted service must authenticate business/actor before setting transaction-local context; context settings alone are not end-user authentication. Protected subject verification remains Phase 8–10.

No live CRM automation or central synchronization worker is activated. Phase 5 state, lead event and local audit commit together. Reporting outbox arrives in Phase 6; historical reporting requires an explicit idempotent backfill from local state/events, not an implicit event stream that already exists. CRM automation remains Phase 22.

## Required 20-point review

| Item | Phase 5 decision |
| --- | --- |
| Business objective | Reusable tenant-scoped customer identities and correct POS lead lifecycle |
| Measurable result | Eight tables, 18 synthetic contacts/identities, four POS leads/eight events; live assertions pass |
| Reuse | Four-DB boundary, restricted roles, FORCE RLS, audit schema, checksum ledger, encrypted dev credential/backup helpers |
| Dependencies | Accepted Phase 4; active dummy business/instance configuration; PostgreSQL 15 |
| Data | Synthetic only; reserved names/JIDs, active/blocked contacts and progressed leads |
| Integrations | PostgreSQL only; no live WhatsApp, external CRM or Board/HIS calls |
| Proposed design | Domain-local contacts; fixed, audited atomic mutation functions; POS-only CRM |
| Alternatives | Direct runtime DML rejected because it bypasses atomic audit/transitions; shared contact DB rejected for isolation; unrestricted JSON profile deferred |
| Failure cases | Missing/wrong tenant, wrong instance, blocked contact, invalid transition, duplicate/changed event, stale version, concurrent writes, transaction abort |
| Authentication/authorization | Restricted DB credentials plus trusted service business/actor context; future user/subject verification remains necessary |
| Sensitive handling | No real PII; audits omit names/JIDs/notes; role credentials remain encrypted; synthetic identities non-routable |
| Recovery | Same identity/event can be retried; immutable replay outcome; checksum check before uncertain migration retry |
| Backup | Encrypted per-domain pre-migration dumps; decryption roundtrip |
| Restore verification | Restore changed domain databases into disposable targets; compare data/keys/roles, then verify tenant-filtered reads |
| Rollback | Failed atomic migration/data operation leaves no partial change; application can disable new functions; no automatic destructive down migration |
| Tests | Runtime tenant isolation, direct-write denial, function guards, event replay/conflict, stale transitions, rollback and concurrent command probes |
| Evidence | implementation.json, live test report, catalog/fixture assertions and restore evidence |
| Pass/fail | No failed required tests; no orphan relations, duplicates, cross-tenant rows or unaudited API mutation |
| Essential/deferred | Foundation now; live workflow/CRM automation, profiles beyond current fields and verified private-record access later |
| Exit | Verified Phase 5 evidence and user review before Phase 6 memory work |

Synthetic configuration leases are deliberately finite (24 hours from Phase 4 bootstrap). If they expire, fixtures must be renewed through a reviewed configuration revision. Do not silently extend authorization in a migration just to make tests pass.
