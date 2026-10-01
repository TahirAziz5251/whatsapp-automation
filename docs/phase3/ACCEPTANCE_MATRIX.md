# Implementation acceptance matrix — not yet executed

These are required future integration checks against synthetic fixtures. Passing Phase 3 design lint does not pass these scenarios. For each executed case retain test ID, fixture version, runtime role, sanitized request/action IDs, expected/actual result, database assertions and PASS/FAIL.

| ID | Phase gate | Scenario | Required result |
| --- | --- | --- | --- |
| CORE-01 | 4 | Tenant A runtime attempts tenant B SELECT/INSERT/UPDATE | No disclosed/changed B rows; no tenant context also denies |
| CORE-02 | 4 | App role attempts DDL, owner/BYPASSRLS access, audit modification | Denied; actual runtime role used, not bootstrap superuser |
| CORE-03 | 4 | Duplicate external instance mapping | Rejected; routing cannot silently transfer tenant |
| CORE-04 | 4 | Reapply migration; induce migration failure | No partial applied schema; clear migration ledger; reproducible retry |
| CRM-01 | 5 | Same phone/contact identifier used in two tenants | Independent records; no implicit cross-business merge |
| CRM-02 | 5 | Duplicate lead event and later general inquiry | One event; progressed lead not reset silently |
| MEM-01 | 6–7 | Replay provider event; restart workflow/worker | One durable inbound record; safe resume without duplicate effect |
| MEM-02 | 6–7 | Concurrent turns, window limit, expired session | Ordered bounded history; no other conversation/tenant content |
| MEM-03 | 6–7 | Send accepted but response lost | Unknown state recorded; no blind claim of exactly-once delivery |
| AUTH-01 | 8–10 | Forged student/patient reference or another session grant | Denied before sensitive record result returned |
| AUTH-02 | 8–10 | Expired/revoked grant, wrong scope, unauthorized guardian | Denied; raw verifier inputs absent in model/log/memory artifacts |
| BISE-01 | 8–10 | Repeated roll number in different exams; theory/practical marks | Correct selected exam/component; ambiguity requests clarification |
| BISE-02 | 8–10 | Missing marks/grade, unpublished or withheld result | No fabricated zero/grade; publication and authorization enforced |
| BISE-03 | 8–10 | Runtime attempts official-record writes | Denied; synthetic fixture loader is not the runtime credential |
| KB-01 | 12–16 | English/Urdu/Roman Urdu labeled queries | Measure BM25-only, vector-only and fused relevance/latency; owner-approved threshold before acceptance |
| KB-02 | 12–16 | Other tenant, stale version, deleted chunk, partial indexing | No unauthorized/stale/unpublished evidence; both retrieval paths agree on eligible corpus |
| KB-03 | 12–16 | New embedding model/dimension or corrupted index metadata | Reject incompatible generation; controlled rebuild/rollback |
| SALE-01 | 18–19 | Two concurrent orders for last item | At most available stock reserved; no negative/oversold stock |
| SALE-02 | 18–19 | Price changes after quote; replay confirmation | Reconfirm changed price; same action produces one order |
| SALE-03 | 18–19 | Reservation expiry races payment success/cancellation | One valid transition; stock reconciles once; uncertain payment checked authoritatively |
| HOSP-01 | 18–19 | Two simultaneous bookings for one exclusive slot | One active appointment; loser gets safe alternative/clarification |
| HOSP-02 | 18–19 | Overlapping doctor slots | Invalid active overlap rejected by DB constraint |
| HOSP-03 | 18–19 | Reschedule/cancel race or new slot unavailable | No lost original appointment; expected-version conflict handled |
| HOSP-04 | 18–19 | Calendar create succeeded but acknowledgement lost | Stable external reference reconciled; no duplicate external event |
| HOSP-05 | 18–19 | Old sync job executes after cancellation/reschedule | Stale job cannot recreate obsolete booking |
| APPROVAL-01 | 19 | Wrong approver, changed payload, expired/replayed approval | No effect; authentic approval bound to exact action version |
| OUTPUT-01 | 20–21 | Formatter changes price/marks/date or emits unsupported fact | Final validation rejects or deterministic verified response used |
| RESTORE-01 | recovery gate | Isolated backup restore with runtime roles and knowledge versions | Relationships, authorized queries and retrieval verified; no external messages/actions sent |
| ROLLBACK-01 | deployment gate | Roll back application/workflow after committed actions | Compatibility verified; committed external state reconciled, not silently erased |
| PROD-01 | acceptance | Real provider/source compatibility and recovery objectives | Approved source mapping, permissions, RPO/RTO evidence and operational owner |

## Phase 3 checks actually executed

See `verification.json`: structural keys/relationships, tenant ownership, FK target uniqueness/types, stage dependencies, monetary/time types, rejection of malformed catalog mutations, and tuple witnesses for cross-tenant/actor/session/instance mismatches. These are specification checks, not live RLS or concurrency tests.

## Revision 2: separate database acceptance gates — NOT YET EXECUTED

All existing cases must run in the owning database under the actual intended role. Run isolation cases for each of POS, BISE and Hospital, with at least two synthetic businesses per domain. Cross-database tests must attempt real connections, not merely compare role names.

| ID | Gate | Scenario | Required result/evidence |
| --- | --- | --- | --- |
| ISO-01 | 4 | Every runtime role connects to its own and each other application DB | Own allowed scope works; other DB connections denied, including PUBLIC/membership paths |
| ISO-02 | 4 | Bootstrap credentials compared with runtime, owner, migration roles | Runtime owns no tables, cannot bypass RLS or assume owner; credentials differ |
| ISO-03 | 4 | Missing, wrong, forged and pooled stale tenant context | Fixed trusted API rejects forged authorization; RLS prevents cross-business access and writes; no context leakage |
| ISO-04 | 4 | Partial four-DB provisioning and migration failure/retry | Manifest identifies completed work; repeat succeeds without dropping existing data; per-DB ledger accurate |
| ISO-05 | 4 | Tenant/instance config copied into domain; unauthorized local edit | Correct local FKs; runtime edit denied; no gateway credential reference in domain copy |
| CFG-01 | 4 bootstrap; 6 before workers enabled | Config replay, changed hash, stale revision, wrong domain | Same event no-op, conflicts quarantined, no stale/foreign routing applied; receipt/projection/audit atomic |
| CFG-02 | 8–10 before protected tools | Control unavailable, lease expires or business disabled | New protected access denied; no inferred fallback business; documented in-flight admission semantics tested |
| TX-01 | 18 before effects | Inject failure after business write but before local audit/outbox/action result | Entire local transaction rolled back; no partial order/reservation/appointment |
| TX-02 | 18 before effects | Concurrent same action key, same versus different payload | One effect for matching hash; mismatched hash rejected; original result preserved |
| SYNC-01 | 6 before reporting enabled | Central unavailable while local event commits | Source commit preserved; durable backlog visible; subsequent delivery reconciles |
| SYNC-02 | 6 before reporting enabled | Crash before/after central commit, lost ACK, retry after lease expiry | One inbox event/projection effect; no lost event; dedup evidence and eventual ack |
| SYNC-03 | 6 before reporting enabled | Out-of-order versions, version gap, same ID/different hash | No stale overwrite; gap reconciliation; conflicting identity quarantined |
| SYNC-04 | 6 before reporting enabled | Producer spoofs origin database/business or sends PII | Receiver rejects; no central sensitive payload; sanitized rejection evidence |
| SYNC-05 | 6 before reporting enabled | Central session directory missing/stale | No authorization from projection; authoritative domain session/grant controls access |
| REC-01 | before recoverability acceptance | Restore control older than source | Retained acknowledged events can be replayed; projections reconstructed without duplicates |
| REC-02 | before recoverability acceptance | Restore one domain older than control | Affected reporting quarantined; lost source state identified; no order/booking recreated from reporting guesses |
| REC-03 | before recoverability acceptance | Coordinated four-DB backup/isolated restore | Manifest, roles, FK/tenant queries, ledgers, outboxes and sources match; measured recovery evidence |
| REC-04 | before restored traffic | Restored live sessions/grants/approvals and obsolete routing | Fresh verification required; old authorization/routing cannot reactivate |
| REC-05 | 12–16 and restore gate | Restore/rebuild pgvector and selected BM25 engine | Correct source generation, model dimensions, tenant filters and retrieval fixtures; no external sends |
| REC-06 | rollback gate | Rollback after WhatsApp/Calendar effect committed | No blind resend or stale Calendar recreation; compatible app/schema restored, effects reconciled |

Evidence must distinguish design lint, live database tests, mocked integration and actual external-provider tests. A PASS in `verification.json` is only Phase 3 offline evidence, not a PASS for this table.

## POS modules and BISE verification addendum — NOT YET EXECUTED

Contract details and test fixtures: [POS tools and BISE verification](POS_TOOLS_AND_BISE_VERIFICATION.md).

| ID | Gate | Scenario | Required result/evidence |
| --- | --- | --- | --- |
| POS-TOOL-01 | 8–10 | Model supplies another tenant/customer, SQL or forged price | Trusted scope and typed tools reject override; no unauthorized query |
| POS-TOOL-02 | 18 before writes | Independent add_order_item request; partial create_order failure | Helper not publicly callable; failed order transaction leaves no partial order/stock effect |
| POS-PAY-01 | before payment/invoice feature | Chat claims payment success or requests an invoice without source | No fabricated payment or invoice; authorized authoritative retrieval only |
| BISE-ENUM-01 | before verification activation | Known/unknown identifiers and partly matching fields | No record-existence or partial-match disclosure in wording/status/shape; timing distributions assessed |
| BISE-ENUM-02 | before verification activation | Concurrent guesses across sessions/workers/restarts | Durable aggregate attempt limits and cooldowns enforced atomically |
| BISE-ENUM-03 | before verification activation | Many targets/actors, victim-lockout attempt | Distributed abuse controls work; no permanent unauthenticated victim lockout |
| BISE-VERIFY-01 | before protected tools | Identifier match without approved factor; OTP expiry/replay/actor switch | No grant without approved verification; expired/reused/misbound challenge rejected |
| BISE-VERIFY-02 | before protected tools | Subject/exam switch, unapproved guardian, revoked grant | Only authorized published subject fields returned; safe denial otherwise |
| BISE-PRIV-01 | before protected tools | Synthetic CNIC/B-Form/OTP canaries enter verification | Canary absent in model, persisted execution data, memory, normal logs and central reporting |
| BISE-SEND-01 | before protected responses | Grant expires or recipient/session changes before dispatch | Protected response blocked until valid bound authorization |
| BISE-FAIL-01 | before protected tools | Board, authorization or limiter unavailable | Protected access fails closed; permitted public FAQ/support remains possible |
