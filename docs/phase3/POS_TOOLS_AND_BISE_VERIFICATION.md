# Phase 3 addendum — POS modules and BISE protected services

Status: design requirement, not implemented behavior. Supplements revision 2. Four database boundaries and the Phase 4 foundational scope remain unchanged. All development uses synthetic records and a mock verifier until an authorized Board integration and identity policy are approved.

## POS module ownership

The POS supervisor delegates to five specialist modules. These are peer capabilities, not a mandatory chain through Product, Inventory, Order, Customer and Payment on every message. Each uses the shared authorization/tool layer and `pos_db`. Separate LLM calls per module are optional; deterministic operations do not need an LLM.

| Module | Responsibilities | Authoritative data / restrictions |
| --- | --- | --- |
| Product Agent | Product search/details, variants, current price | sales.products and sales.skus; descriptions/policy evidence may use knowledge |
| Inventory Agent | Stock, availability, quantity, reorder suggestions | sales.inventory; availability = on_hand - reserved; no automatic supplier purchase |
| Order Agent | Create, status, cancel, history | sales.orders/order_items; confirmed writes through one local transaction |
| Customer Agent | Customer search/profile, previous orders | Local contacts/channel identities and CRM; end users see their own authorized profile/orders |
| Payment Agent | Payment status, authorized payment record, invoice retrieval | Provider-authoritative payment records; agent cannot declare a payment successful from a message/screenshot |

Reorder purchasing, editable customer profiles and invoice issuance introduce additional workflow/data requirements. Initial reorder output is a recommendation only. Invoice retrieval requires a trusted source or a separately reviewed immutable invoice/line/tax model; the current order schema must not be misrepresented as an implemented invoice system. Real payment collection/refunds remain deferred. Internal staff customer search requires explicit permissions and bounded results; the public chat agent has no unrestricted customer directory search.

## Deterministic tool contract

The LLM chooses an allowed tool and supplies bounded business arguments. Trusted code injects business, domain, actor, session, scope and trace context. Tools never accept a model-selected connection string, executable SQL, authoritative price, payment status or verification flag. Validate typed input, authorize, run parameterized operations, enforce invariants and return a structured result. Deterministic means controlled execution, not that live stock or price can never change.

| Tool | Model-visible business input | Required behavior |
| --- | --- | --- |
| search_product | query, allowed filters, bounded page size | Search only authorized POS catalog; stable product/SKU references and bounded output |
| get_product_details | product/SKU reference | Approved relational details/variants; document claims carry knowledge citations |
| check_stock | SKU reference, optional requested positive quantity | Current authoritative available quantity, timestamp; a read does not reserve stock |
| get_product_price | SKU reference | Database price, currency and price version; never an LLM estimate |
| create_order | items with SKU/quantity, confirmation reference, idempotency key | Server-owned customer identity; revalidate confirmation, stock and price; atomic full order |
| add_order_item | Internal validated order/line arguments | Private helper inside create_order transaction; not an independently exposed LLM write tool |
| check_order_status | order reference | Check tenant plus customer/staff ownership before returning minimized status |
| cancel_order | order reference, expected version, confirmation reference, idempotency key | Validate cancellation policy; lock/release reservation once; audit and outboxes atomically |
| get_order_history | bounded page/filter | Derive authorized customer from server context; no arbitrary customer-ID browsing |
| find_customer | authenticated self context; staff-only bounded search filters | Public use resolves self only; staff search separately authorized; no existence oracle |
| get_customer_profile | authorized self/staff scope | Field allowlist; no unrestricted PII dump |
| get_payment_status | authorized order/payment reference | Verified stored/provider status; unknown remains unknown |
| get_payment_record | authorized order/payment reference | Minimized record read; not permission to create or mark a payment paid |
| get_invoice | authorized order/invoice reference | Trusted issued invoice only; return unsupported until invoice source/model exists |
| search_knowledge_base | query, allowed category | Business/audience-scoped BM25 + pgvector, approved effective versions, evidence references |

Common result envelope: `status` (ok, not_found, needs_verification, needs_confirmation, conflict, unavailable, forbidden), minimized `data`, `source_refs`, `as_of`, `request_ref` and a non-sensitive `error_code`. Map internal errors to safe user-facing responses. A trace reference is not a credential.

For create/cancel, a server-issued confirmation is bound to the exact payload hash/version, actor/session and expiry. Client idempotency keys do not bypass authorization. A changed price or changed order requires reconfirmation. The transaction includes domain mutation, local action result, audit, reporting event and intended response. Partial committed orders are forbidden. Adding a draft cart later requires its own reviewed lifecycle, rather than exposing add_order_item against confirmed orders.

Initial phase placement: read tools in 8–10; knowledge tool in 15–16; mutations in 18 with confirmation/approval gates before enablement. Security/authorization/error handling are prerequisites of each tool, not postponed to Phase 27.

## BISE secure examination information flow

1. Authenticate the Evolution webhook and resolve the authorized business/instance. Reject forged/replayed ingress, unsupported event types and group-chat protected requests.
2. Classify intent on minimized text. Public FAQs, policy/admission questions and human support do not require access to student records. Protected examination information enters a deterministic verification state machine.
3. Collect only required verification information through a protected verification channel. Prefer a short-lived secure verification link so raw CNIC/B-Form/OTP does not enter chat history. If a user sends sensitive values in WhatsApp, intercept/redact them before LLM context, n8n persisted execution data, ordinary logs or memory. Existing published workflow is not claimed to enforce this yet.
4. A dedicated verifier uses an authorized Board adapter, least-privilege credentials and an approved identity factor. Roll number, name and CNIC/B-Form matching are identifiers/evidence, not sufficient authentication by themselves. Prefer Board-approved existing identity login or a one-time challenge sent only to a previously registered trusted contact. Never bind verification to a new destination supplied in the same unverified conversation.
5. After successful verification, establish/rotate a temporary protected session grant bound to business, WhatsApp instance, actor, authorized student subject, session and permitted scopes. General conversation state may pre-exist; it is not an authenticated student session. Guardian access needs an explicit verified delegation, never an inference from the phone number.
6. The protected tool derives the student from the server-side grant and validates expiry/revocation, exam/session selection, resource ownership and publication policy on every call. It retrieves only allowlisted fields from the authorized source. No free name search or arbitrary roll-number override after authentication.
7. Format the result from verified structured fields, without exposing unnecessary identifiers. Recheck authorization and the bound recipient/session before sensitive dispatch. If scope is uncertain or expires, require verification again. Another chat or a group cannot inherit the result.
8. Record a minimized local access/security audit: opaque actor/subject reference where authorized, request, scope, outcome, time and policy/source version. Avoid raw names, CNIC/B-Form, OTP, marks and full response bodies in audit. Failed unknown identities use pseudonymous abuse keys, not fabricated student FKs.
9. Logout, inactivity/absolute expiry, business disablement or grant revocation prevents further protected retrieval. A changed subject requires new verification and a new scoped grant. Prevent another student's disclosure through server-side controls and adversarial tests; do not claim that a prompt alone guarantees it.

The real Board authentication factors, registered-contact availability and API/schema are unresolved production dependencies. Dummy development must simulate valid/invalid identities, shared contacts, guardian delegation and unavailable source behavior. Mock verifier credentials/configuration must be impossible to enable against production sources.

## Anti-enumeration and repeated-guessing controls

| Threat | Required control |
| --- | --- |
| Cycling roll numbers, names, CNIC/B-Form values | No unauthenticated student search/list/existence endpoint; verification gate before record disclosure; reject broad/prefix queries |
| One sender tries many identities | Durable atomic per-actor attempt budget, distinct-target budget and progressive cooldown |
| Many senders try one identity | Keyed-HMAC target attempt counters plus business/global anomaly limits; plain hashes of enumerable identifiers are insufficient |
| Many senders try many identities | Domain/global budgets, anomaly alerts and operator review; per-number throttling alone is insufficient |
| Learning which field was correct | Same external verification-failure wording and consistent response shape/status; comparable processing paths, no partial-match hints or registered-contact disclosure |
| OTP/challenge brute force or replay | Short TTL, bounded attempts/resends, purpose/session/actor binding, single-use consume atomically; store a protected verifier, not raw OTP |
| Restart, new chat or concurrency bypass | Counters survive workflow restarts; all workers share an atomic limiter; unknown limiter state fails closed for verification |
| Attacker locks out a victim | Avoid permanent student-account lock triggered by unauthenticated requests; actor cooldowns, target delivery suppression and safe staff recovery |
| Indirect leaks | No raw verification payload in LLM, execution logs, cache keys, URLs, analytics or error detail; restrict operator access |

WhatsApp webhook source IP identifies the provider infrastructure, not the student's device. IP limiting may protect the gateway but cannot be the principal student anti-abuse control. HTTP webhook acknowledgement should not reveal verification success; protected verification responses arrive through the controlled channel.

Proposed dummy-test limits, not claimed Board policy: 5 failed attempts per actor per 15 minutes; 3 distinct target identities per actor per 15 minutes; 5 attempts per actor-target pair per 15 minutes; challenge TTL 5 minutes, at most 5 guesses and 3 sends per actor-target per 15 minutes. Configure target-wide/business-wide limits and alert thresholds in the test fixture and demonstrate distributed-attack handling before feature activation. Do not expose which budget was hit. Counters for nonexistent and existing targets follow the same path. Limit key retention and restrict HMAC key access/rotation.

Before Phase 8 verification is enabled, add and review domain-local storage for challenge lifecycle, durable attempt buckets and verified delegation/identity mapping, or an equivalent tested verifier service. These are prerequisite schema/API additions, not fields hidden in conversation JSON. They are not yet implemented or included in the current 88-table catalog. PostgreSQL can supply the initial atomic limiter; Redis optimization need not block security or be installed now.

## BISE capability boundaries

| Capability | Source and authorization |
| --- | --- |
| Result, subject marks, total/obtained marks, grade, student's examination/session information | Structured authorized Board/BISE source plus subject-bound verification and publication policy; missing/withheld values are not zero |
| General examination schedule, Board FAQs, admission/application and examination policy | Approved effective knowledge versions through BM25 + pgvector; authoritative structured schedule/fee source wins where configured |
| Human support | Minimized case handoff; protected details only to authorized staff; no bypass of verification |
| Calendar-related services | Future scoped integration and explicit user-confirmed action; not required for examination retrieval |
| CRM synchronization | Future consent/policy-reviewed minimized case metadata; no automatic export of student results or identity evidence |

## Required implementation evidence (not executed here)

- POS: unauthorized customer/order/payment access denied; tools cannot switch business or SQL; last-item race has one valid reservation; create_order midway failure rolls back everything; add_order_item unavailable as standalone tool; changed price/duplicate confirmation cannot create an unintended order; invoice unsupported rather than fabricated.
- BISE: existing/nonexistent/wrong-field verification responses do not expose existence; controlled timing-distribution comparison has no usable existence signal; attempts across concurrent workers, new sessions and restarts still hit limits; distributed target guessing is detected; victim is not permanently locked out.
- Verification: expired/replayed OTP, changed challenge actor/session, subject substitution, guardian without delegation, forged roll number, revoked grant and wrong exam/publication state are denied. A legitimate verified student receives only their own allowed fields. Misbound/outdated response dispatch is blocked.
- Privacy: synthetic CNIC/B-Form/OTP canary values are absent from captured model inputs, n8n persisted execution data, normal logs, memory and central reports. Secure-link tokens are short-lived and excluded from logs/referrers.
- Failure: Board verifier, authorization service or limiter outage fails closed for protected access; public FAQ/human-support paths remain available as permitted; uncertain sends are reconciled without blind duplicate disclosure.

Record fixture/version, role, expected/actual outcome, sanitized DB assertions and PASS/FAIL. These are future security/integration tests; existing Phase 3 checks validate schema structure only. Live Board integration, raw student data and new production workflows remain outside this phase.

Design references: OWASP recommends generic authentication responses and throttling in its [Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), and per-request, deny-by-default access checks in its [Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html). Specific tool contracts and dummy thresholds above are project proposals, not Board policy.
