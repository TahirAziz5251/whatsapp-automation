# Dummy data and production integration sequence

Development uses synthetic data only. Production runs in a separately configured environment; do not convert a populated dummy database into production by adding real rows alongside fixtures. Database names may be the same in separate environments, but endpoints, credentials, volumes, keys and backups must differ.

| Phase | control_db | pos_db | bise_db | hospital_db |
| --- | --- | --- | --- | --- |
| 4 | Six dummy businesses, synthetic instance mappings, configuration events, audit fixtures | Two projected dummy businesses and local configuration/audit fixtures | Two projected dummy businesses and local configuration/audit fixtures | Two projected dummy businesses and local configuration/audit fixtures |
| 5 | Routing/configuration retained | Dummy contacts/customer identities, leads, lead history | Dummy local contacts/channel identities | Dummy local contacts/channel identities |
| 6–7 | Synthetic reporting/session-directory projections | Conversations, sessions, requests/messages and response/reporting events | Same shared memory template, separate rows | Same shared memory template, separate rows |
| 8–10 | Trusted resolver tests | Products, variants/SKUs, prices, stock and tool traces | Synthetic students, exams, registrations, subject/result marks and mock verification fixtures | Departments, doctors, slots and mock verification fixtures |
| 13–16 | Configuration metadata only | Controlled product/return/warranty documents and derived knowledge chunks/embeddings | Controlled Board FAQ/policy/admission documents and derived knowledge | Controlled hospital/department/preparation documents and derived knowledge |
| 18–19 | Minimized synthetic action reports | Dummy orders/items/payment statuses, actions/approvals | Scoped actions/handoffs where required; no official-result mutation | Dummy bookings/reschedules/cancellations, actions/approvals, Calendar simulator jobs |
| 23, 28–29 | Multi-business routing/reporting and failure scenarios | Adversarial, concurrent and end-to-end fixtures | Enumeration, unauthorized-subject, expiry and disclosure tests | Slot races, patient authorization, calendar uncertainty and recovery tests |

Seed each feature only when its schema and permissions exist. Seed scripts must be repeatable and versioned, use reserved synthetic identifiers and have expected counts/assertions. Include both normal and edge cases: duplicate identifiers across tenants, ambiguous exam years, missing/withheld marks, out-of-stock products, price changes, expired grants, duplicate events and unavailable slots. Test data must not send real WhatsApp messages or contact real verification destinations.

Invoices, purchasing/reorders, guardian mappings and verifier challenge/attempt storage require reviewed feature schema/adapters before fixture generation. A column listed as proposed is not an inspected production source field.

## Production data gates

Production discovery requires an authorized, least-privilege source adapter and a verified field mapping. In particular, the actual Board schema and identity-verification policy are not currently available; dummy column names do not establish that mapping. Never fabricate production marks, prices, stock, appointments or identity records.

1. Before deployment: complete dummy functional/security/concurrency/failure tests, migration rehearsal with reconciled counts and constraints, actual backup/restore and rollback evidence, source-owner mapping approval, permission review and signed-off data quality/acceptance thresholds.
2. Phases 30–31: prepare and harden separate production infrastructure and credential/backup custody. Source compatibility and dry runs must precede activation. Real sensitive data must not be copied into ordinary dev to make a test pass.
3. Phase 32: execute the approved controlled production import or source integration, verify provenance/counts/reconciliation, and activate a limited monitored rollout. An authorized read-only Board/HIS adapter may be preferable to copying all records. Real source integration is a separately reviewed operational action.
4. Phase 33: confirm production behavior and acceptance against approved source records, access controls, monitoring and recovery objectives; expand rollout only after acceptance.

Real data is not just an INSERT step: it requires mapping, validation, authorization, source-of-truth decisions and a recoverable cutover. The Phase 4 dev database layout is reusable, but synthetic rows and mock verification are never promoted as real institutional data.
