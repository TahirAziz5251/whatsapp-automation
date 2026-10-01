# Phase 4 results

Status: PASS for the foundational development-database scope; awaiting user review before Phase 5.

Implemented only in business-agent-dev-postgres-1, PostgreSQL 15.19. Four separate development databases, 16 foundational platform tables, four migration-ledger tables, 12 scoped roles (four NOLOGIN owners, four migrators, four runtime identities). Runtime passwords are DPAPI-protected and SCRAM authentication is enforced for these roles on TCP and Unix sockets.

| Evidence | Passed | Failed | Scope |
| --- | --- | --- | --- |
| Live restricted-role tests | 135 | 0 | Real password connections, database/tenant boundaries, privileges, constraints, transaction rollback |
| Catalog comparison | 59 | 0 | Actual tables/columns/types/nullability/keys/FKs match foundational design; existing Evolution catalog unchanged |
| Isolated restore drills | 4 | 0 | Each synthetic database restored, contents/ledger/ownership/RLS checked, temporary target removed |

## Findings and corrections

The first live run exposed localhost trust authentication: incorrect passwords were accepted. The named Phase 4 roles now have SCRAM HBA rules ahead of default rules. Twenty connection-denial checks initially failed due to the test expecting a SQLSTATE that psql does not expose on connection establishment; they now require the actual connection-denied error and a nonzero exit. Original evidence is retained in verification-initial.json. Docker temporarily responded slowly; pending runs were stopped and restarted after bounded connectivity checks.

Four additional Unix-socket regressions verify that the runtime identity cannot be impersonated without a password. During initial restore drills, control/POS temporary database creation timed out after the server created the databases. Recovery verified the recorded targets were empty, inactive and owned by the expected role before resuming; it did not overwrite operational databases. Initial restore evidence is retained in restore-verification-initial.json.

## What was and was not verified

Two synthetic businesses per domain establish cross-tenant fixtures. Table creation is not full application authorization: trusted tools must still authenticate callers before supplying app.business_id. No Board records, protected verification workflows, customer/CRM features, student results, order or appointment tools, knowledge tables, pgvector or BM25 were deployed. Existing working n8n/Evolution workflows were not edited. Runtime cannot mutate configuration; the seeded config events were applied by the offline fixture loader, not a live synchronization worker.

Encrypted pre-migration server backups passed decryption roundtrip. Restore drills cover individual synthetic databases on this server with existing roles. They do not prove off-machine secret recovery, full server rebuild, cross-database point-in-time consistency or external effect recovery. Failed transactional DDL rollback was tested; full deployment rollback remains a later gate.

The pre-implementation Database Analysis Report lists actual existing metadata and separately labels proposed BISE mappings. The actual Board schema remains unavailable. The implemented catalog lists every current foundational column and constraint. Phase 5 requires review of this evidence.
