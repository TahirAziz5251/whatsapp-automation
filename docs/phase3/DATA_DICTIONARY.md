# Proposed data dictionary

Generated from `scripts/build-phase3-design.cjs`. This is a review catalog, not executable SQL. `?` marks a nullable field. Constraints written as prose require concrete SQL/service implementation and real database tests in the assigned phase. `vector(d)` remains a deliberate unresolved design parameter. All IDs are application-generated UUIDs; all timestamps represent instants.

## control_db.platform.businesses — Phase 4

Trusted business boundary; not selected by user/LLM text.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| id | uuid | no |
| code | text | no |
| display_name | text | no |
| domain | text | no |
| timezone | text | no |
| status | text | no |
| config_version | integer | no |
| created_at | timestamptz | no |

Primary key: id.

Database: control_db. Authority: local. Reusable template: platform.businesses.

- Unique: (code).
- Required invariant: domain in sales,bise,hospital; status in active,disabled; config_version > 0.

RLS and service authorization required; retention is defined by data class in the design review.

## control_db.platform.instances — Phase 4

Trusted Evolution instance-to-business mapping; references credentials, never stores tokens.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| provider | text | no |
| external_instance_id | text | no |
| credential_ref | text | no |
| status | text | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: control_db. Authority: local. Reusable template: platform.instances.

- Unique: (provider, external_instance_id).
- FK: (business_id) → control_db.platform.businesses (id); delete RESTRICT.
- Required invariant: Unique trusted routing mapping across businesses; status active/disabled.

RLS and service authorization required; retention is defined by data class in the design review.

## control_db.platform.audit_events — Phase 4

Append-only security/business metadata; no raw messages or credentials.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| request_ref | text | yes |
| actor_ref | text | no |
| event_type | text | no |
| resource_ref | text | yes |
| outcome | text | no |
| details | jsonb | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: control_db. Authority: local. Reusable template: platform.audit_events.

- FK: (business_id) → control_db.platform.businesses (id); delete RESTRICT.
- Required invariant: Details key/size allowlist; runtime cannot UPDATE/DELETE audit rows.
- Candidate nonunique index: (business_id, created_at, id); measure against actual queries.

RLS and service authorization required; retention is defined by data class in the design review.

## control_db.platform.configuration_outbox — Phase 4

Configuration publication intent committed with authoritative configuration and audit.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| config_revision | bigint | no |
| event_type | text | no |
| payload | jsonb | no |
| payload_hash | text | no |
| status | text | no |
| attempts | integer | no |
| next_attempt_at | timestamptz | yes |
| lease_until | timestamptz | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: control_db. Authority: local. Reusable template: platform.configuration_outbox.

- Unique: (business_id, config_revision).
- FK: (business_id) → control_db.platform.businesses (id); delete RESTRICT.

RLS and service authorization required; retention is defined by data class in the design review.

## control_db.platform.reporting_events — Phase 6

Immutable minimized reporting inbox; same-key different hash quarantined.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| origin_database | text | no |
| origin_event_ref | uuid | no |
| aggregate_ref | text | no |
| aggregate_version | bigint | no |
| event_type | text | no |
| payload | jsonb | no |
| payload_hash | text | no |
| occurred_at | timestamptz | no |
| received_at | timestamptz | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: control_db. Authority: local. Reusable template: platform.reporting_events.

- Logical external reference (NOT a SQL FK): {authorized_domain_db}.platform.reporting_outbox; Authenticated producer fixes origin_database; immutable event hash, deduplication and source reconciliation; no cross-database FK.
- Unique: (business_id, origin_database, origin_event_ref).
- FK: (business_id) → control_db.platform.businesses (id); delete RESTRICT.

RLS and service authorization required; retention is defined by data class in the design review.

## control_db.platform.session_directory — Phase 6

Routing/status projection only; domain session remains authoritative.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| origin_database | text | no |
| domain_session_ref | uuid | no |
| state_version | bigint | no |
| status | text | no |
| updated_at | timestamptz | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: control_db. Authority: local. Reusable template: platform.session_directory.

- Logical external reference (NOT a SQL FK): {authorized_domain_db}.platform.sessions; Versioned projection, never an authorization grant; dangling references marked unavailable after recovery.
- Unique: (business_id, origin_database, domain_session_ref).
- FK: (business_id) → control_db.platform.businesses (id); delete RESTRICT.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.platform.businesses — Phase 4

Read-only domain projection of central routing/configuration; only scoped configuration consumer may update.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| id | uuid | no |
| code | text | no |
| display_name | text | no |
| domain | text | no |
| timezone | text | no |
| status | text | no |
| config_version | integer | no |
| created_at | timestamptz | no |
| config_revision | bigint | no |
| valid_until | timestamptz | no |

Primary key: id.

Database: pos_db. Authority: provisioned_projection. Reusable template: platform.businesses.

- Logical external reference (NOT a SQL FK): control_db.platform.businesses; Versioned authenticated configuration events; never a cross-database FK; expired configuration denies dispatch.
- Unique: (code).
- Required invariant: domain in sales,bise,hospital; status in active,disabled; config_version > 0.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.platform.instances — Phase 4

Read-only domain projection of central routing/configuration; only scoped configuration consumer may update.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| provider | text | no |
| external_instance_id | text | no |
| status | text | no |
| created_at | timestamptz | no |
| config_revision | bigint | no |
| valid_until | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: provisioned_projection. Reusable template: platform.instances.

- Logical external reference (NOT a SQL FK): control_db.platform.instances; Versioned authenticated configuration events; never a cross-database FK; expired configuration denies dispatch.
- Unique: (provider, external_instance_id).
- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.
- Required invariant: Unique trusted routing mapping across businesses; status active/disabled.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.platform.contacts — Phase 5

Tenant-local person/customer reference; does not imply verified identity.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| display_name | text | yes |
| status | text | no |
| updated_at | timestamptz | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: platform.contacts.

- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.platform.channel_identities — Phase 5

Channel participant linked to contact within an instance; shared numbers require separate subject grants.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| instance_id | uuid | no |
| contact_id | uuid | no |
| jid | text | no |
| address_kind | text | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: platform.channel_identities.

- Unique: (business_id, instance_id, jid).
- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, instance_id) → pos_db.platform.instances (business_id, id); delete RESTRICT.
- FK: (business_id, contact_id) → pos_db.platform.contacts (business_id, id); delete RESTRICT.
- Required invariant: JID retained as identifier; LID is not assumed to be a phone number.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.platform.conversations — Phase 6

Conversation identity, scope and operator handoff state.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| instance_id | uuid | no |
| contact_id | uuid | no |
| chat_jid | text | no |
| status | text | no |
| version | integer | no |
| updated_at | timestamptz | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: platform.conversations.

- Unique: (business_id, instance_id, chat_jid).
- Unique: (business_id, id, contact_id).
- Unique: (business_id, id, instance_id).
- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, instance_id) → pos_db.platform.instances (business_id, id); delete RESTRICT.
- FK: (business_id, contact_id) → pos_db.platform.contacts (business_id, id); delete RESTRICT.
- Required invariant: Initial pilot direct chats only; version > 0.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.platform.sessions — Phase 6

Bounded context and pending-intent state; never authoritative authorization from LLM memory.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| conversation_id | uuid | no |
| actor_contact_id | uuid | no |
| state | jsonb | no |
| version | integer | no |
| last_seen_at | timestamptz | no |
| expires_at | timestamptz | no |
| absolute_expires_at | timestamptz | no |
| revoked_at | timestamptz | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: platform.sessions.

- Unique: (business_id, id, actor_contact_id).
- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, actor_contact_id) → pos_db.platform.contacts (business_id, id); delete RESTRICT.
- FK: (business_id, conversation_id, actor_contact_id) → pos_db.platform.conversations (business_id, id, contact_id); delete RESTRICT.
- Required invariant: created_at <= last_seen_at < expires_at <= absolute_expires_at; absolute expiry immutable; version > 0; state schema/size allowlist enforced by service.
- Candidate nonunique index: (business_id, conversation_id, created_at); measure against actual queries.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.platform.verification_grants — Phase 8

Server-created actor-to-subject authorization, including explicit guardian/delegate permission.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| session_id | uuid | no |
| actor_contact_id | uuid | no |
| subject_contact_id | uuid | no |
| scope | text | no |
| method | text | no |
| evidence_ref | text | no |
| expires_at | timestamptz | no |
| revoked_at | timestamptz | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: platform.verification_grants.

- Unique: (business_id, id, session_id).
- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, subject_contact_id) → pos_db.platform.contacts (business_id, id); delete RESTRICT.
- FK: (business_id, session_id, actor_contact_id) → pos_db.platform.sessions (business_id, id, actor_contact_id); delete RESTRICT.
- Required invariant: expires_at > created_at; no raw CNIC, OTP, or evidence documents stored; scope is registered.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.platform.requests — Phase 6

Durable normalized ingress and duplicate-event boundary.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| instance_id | uuid | no |
| provider_event_id | text | no |
| event_type | text | no |
| status | text | no |
| attempts | integer | no |
| lease_until | timestamptz | yes |
| next_attempt_at | timestamptz | yes |
| error_code | text | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: platform.requests.

- Unique: (business_id, instance_id, event_type, provider_event_id).
- Unique: (business_id, id, instance_id).
- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, instance_id) → pos_db.platform.instances (business_id, id); delete RESTRICT.
- Required invariant: attempts >= 0; identifier nonempty; no raw event payload.
- Candidate nonunique index: (status, next_attempt_at); measure against actual queries.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.platform.messages — Phase 6

Redacted persistent conversational history; provider IDs and request link support deduplication.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| instance_id | uuid | no |
| conversation_id | uuid | no |
| request_id | uuid | yes |
| direction | text | no |
| role | text | no |
| content | text | no |
| provider_message_id | text | yes |
| delivery_state | text | no |
| occurred_at | timestamptz | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: platform.messages.

- Unique: (business_id, request_id, direction).
- Unique: (business_id, instance_id, provider_message_id, direction).
- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, instance_id) → pos_db.platform.instances (business_id, id); delete RESTRICT.
- FK: (business_id, conversation_id, instance_id) → pos_db.platform.conversations (business_id, id, instance_id); delete RESTRICT.
- FK: (business_id, request_id, instance_id) → pos_db.platform.requests (business_id, id, instance_id); delete RESTRICT.
- Required invariant: direction inbound/outbound; role user/assistant/operator/system; initial one response per request; null request allowed for separately keyed proactive actions.
- Candidate nonunique index: (business_id, conversation_id, occurred_at, id); measure against actual queries.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.platform.actions — Phase 18

Confirmed immutable business intent and execution/idempotency state.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| session_id | uuid | no |
| verification_grant_id | uuid | yes |
| operation | text | no |
| idempotency_key | text | no |
| payload_hash | text | no |
| payload | jsonb | no |
| status | text | no |
| expires_at | timestamptz | no |
| version | integer | no |
| result_ref | text | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: platform.actions.

- Unique: (business_id, operation, idempotency_key).
- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, session_id) → pos_db.platform.sessions (business_id, id); delete RESTRICT.
- FK: (business_id, verification_grant_id, session_id) → pos_db.platform.verification_grants (business_id, id, session_id); delete RESTRICT.
- Required invariant: Same key/different payload rejects; expires_at > created_at; minimized typed payload; version > 0.
- Required invariant: Grant, if required, must belong to this session and match action subject/scope; validate on execution, not only action creation.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.platform.approvals — Phase 19

Expiring approval bound to action hash/version; operator identity is an external trusted principal.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| action_id | uuid | no |
| action_hash | text | no |
| action_version | integer | no |
| principal_ref | text | no |
| decision | text | no |
| expires_at | timestamptz | no |
| used_at | timestamptz | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: platform.approvals.

- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, action_id) → pos_db.platform.actions (business_id, id); delete RESTRICT.
- Required invariant: decision approve/reject; authenticated approver has permission; one-time use checked transactionally.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.platform.outbox — Phase 6

Durable response dispatch; records accepted/unknown separately from delivered.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| message_id | uuid | no |
| dispatch_key | text | no |
| status | text | no |
| attempts | integer | no |
| next_attempt_at | timestamptz | yes |
| lease_until | timestamptz | yes |
| provider_ref | text | yes |
| last_error_code | text | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: platform.outbox.

- Unique: (business_id, message_id).
- Unique: (business_id, dispatch_key).
- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, message_id) → pos_db.platform.messages (business_id, id); delete RESTRICT.
- Required invariant: attempts >= 0; ambiguous send enters unknown, not blindly pending.
- Candidate nonunique index: (status, next_attempt_at); measure against actual queries.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.platform.audit_events — Phase 4

Append-only security/business metadata; no raw messages or credentials.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| request_ref | text | yes |
| actor_ref | text | no |
| event_type | text | no |
| resource_ref | text | yes |
| outcome | text | no |
| details | jsonb | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: platform.audit_events.

- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.
- Required invariant: Details key/size allowlist; runtime cannot UPDATE/DELETE audit rows.
- Candidate nonunique index: (business_id, created_at, id); measure against actual queries.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.platform.tool_runs — Phase 8

Trace tool outcome/evidence, latency and versions without duplicating sensitive result bodies.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| request_id | uuid | no |
| tool_name | text | no |
| tool_version | text | no |
| outcome | text | no |
| source_refs | jsonb | no |
| duration_ms | integer | no |
| error_code | text | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: platform.tool_runs.

- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, request_id) → pos_db.platform.requests (business_id, id); delete RESTRICT.
- Required invariant: duration_ms >= 0; redact source references as required.
- Candidate nonunique index: (business_id, request_id); measure against actual queries.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.platform.handoffs — Phase 19

Operator ownership and bot pause/resume record.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| conversation_id | uuid | no |
| reason_code | text | no |
| status | text | no |
| assigned_principal_ref | text | yes |
| updated_at | timestamptz | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: platform.handoffs.

- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, conversation_id) → pos_db.platform.conversations (business_id, id); delete RESTRICT.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.crm.leads — Phase 5

Lead state separate from appointments/orders; initial single active lead per contact.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| contact_id | uuid | no |
| stage | text | no |
| notes | text | yes |
| version | integer | no |
| updated_at | timestamptz | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: crm.leads.

- Unique: (business_id, contact_id).
- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, contact_id) → pos_db.platform.contacts (business_id, id); delete RESTRICT.
- Required invariant: Stage allowlist per business; version > 0; general inquiry cannot silently reset progressed lead.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.crm.lead_events — Phase 5

Append-only lead transition history with event deduplication and stable replay outcome.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| lead_id | uuid | no |
| source_event_key | text | no |
| from_stage | text | yes |
| to_stage | text | no |
| actor_ref | text | no |
| expected_version | integer | no |
| result_version | integer | no |
| payload_hash | text | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: crm.lead_events.

- Unique: (business_id, source_event_key).
- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, lead_id) → pos_db.crm.leads (business_id, id); delete RESTRICT.
- Required invariant: expected_version >= 0; result_version = expected_version + 1; payload_hash is canonical SHA-256; repeated key with changed command rejects.
- Candidate nonunique index: (business_id, lead_id, created_at); measure against actual queries.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.sales.products — Phase 8

Public catalog identity and active status.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| product_code | text | no |
| name | text | no |
| description | text | yes |
| active | boolean | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: sales.products.

- Unique: (business_id, product_code).
- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.sales.skus — Phase 8

Sellable variant and current authoritative price; immutable order snapshots preserve past prices.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| product_id | uuid | no |
| sku | text | no |
| attributes | jsonb | no |
| price | numeric(14,2) | no |
| currency | char(3) | no |
| price_version | integer | no |
| active | boolean | no |
| updated_at | timestamptz | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: sales.skus.

- Unique: (business_id, sku).
- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, product_id) → pos_db.sales.products (business_id, id); delete RESTRICT.
- Required invariant: price >= 0; currency uppercase ISO code; price_version > 0; numeric money, not float.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.sales.inventory — Phase 8

One stock pool per SKU for initial dummy pilot; warehouses deferred.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| sku_id | uuid | no |
| on_hand | integer | no |
| reserved | integer | no |
| version | integer | no |
| updated_at | timestamptz | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: sales.inventory.

- Unique: (business_id, sku_id).
- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, sku_id) → pos_db.sales.skus (business_id, id); delete RESTRICT.
- Required invariant: 0 <= reserved <= on_hand; version > 0; available = on_hand - reserved, not independently stored.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.sales.orders — Phase 18

Confirmed order and explicit reservation expiry; no payment secrets.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| customer_id | uuid | no |
| action_id | uuid | no |
| order_number | text | no |
| status | text | no |
| currency | char(3) | no |
| total | numeric(14,2) | no |
| reservation_expires_at | timestamptz | yes |
| version | integer | no |
| updated_at | timestamptz | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: sales.orders.

- Unique: (business_id, action_id).
- Unique: (business_id, order_number).
- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, customer_id) → pos_db.platform.contacts (business_id, id); delete RESTRICT.
- FK: (business_id, action_id) → pos_db.platform.actions (business_id, id); delete RESTRICT.
- Required invariant: total >= 0; version > 0; total equals immutable line totals via controlled transaction.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.sales.order_items — Phase 18

Immutable SKU, quantity and accepted unit-price snapshot.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| order_id | uuid | no |
| sku_id | uuid | no |
| quantity | integer | no |
| unit_price | numeric(14,2) | no |
| price_version | integer | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: sales.order_items.

- Unique: (business_id, order_id, sku_id).
- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, order_id) → pos_db.sales.orders (business_id, id); delete RESTRICT.
- FK: (business_id, sku_id) → pos_db.sales.skus (business_id, id); delete RESTRICT.
- Required invariant: quantity > 0; unit_price >= 0; price_version > 0.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.sales.payments — Phase 18

Provider-authoritative payment status/reference; collection/refunds disabled in initial pilot.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| order_id | uuid | no |
| provider | text | no |
| provider_reference | text | no |
| status | text | no |
| amount | numeric(14,2) | no |
| currency | char(3) | no |
| provider_updated_at | timestamptz | yes |
| updated_at | timestamptz | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: sales.payments.

- Unique: (business_id, provider, provider_reference).
- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, order_id) → pos_db.sales.orders (business_id, id); delete RESTRICT.
- Required invariant: amount >= 0; transition/event authenticity checked; timeout -> unknown; no PAN/CVV/secrets.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.knowledge.documents — Phase 13

Stable approved-source identity, tenant and permitted audience.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| source_key | text | no |
| title | text | no |
| category | text | no |
| audience | text | no |
| source_ref | text | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: knowledge.documents.

- Unique: (business_id, source_key).
- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.
- Required invariant: No student/patient/private transaction records admitted to shared knowledge.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.knowledge.versions — Phase 13

Immutable document version and approval/effectivity; unpublished indexes never exposed.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| document_id | uuid | no |
| version | integer | no |
| content_hash | text | no |
| status | text | no |
| effective_from | timestamptz | no |
| effective_to | timestamptz | yes |
| approver_ref | text | yes |
| source_text | text | no |
| embedding_model | text | no |
| embedding_revision | text | no |
| embedding_dimension | integer | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: knowledge.versions.

- Unique: (business_id, document_id, version).
- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, document_id) → pos_db.knowledge.documents (business_id, id); delete RESTRICT.
- Required invariant: version > 0; dimension > 0; effective_to null or > effective_from; no conflicting active published windows per document unless explicitly segmented.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.knowledge.chunks — Phase 13

Shared chunk identity for genuine BM25 and pgvector; dimension finalized before vector DDL.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| version_id | uuid | no |
| ordinal | integer | no |
| content | text | no |
| content_hash | text | no |
| embedding | vector(d) | no |
| index_state | text | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: knowledge.chunks.

- Unique: (business_id, version_id, ordinal).
- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, version_id) → pos_db.knowledge.versions (business_id, id); delete RESTRICT.
- Required invariant: ordinal >= 0; d must match approved embedding dimension; tenant/audience/version filter on both retrieval paths.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.knowledge.ingestion_jobs — Phase 14

Idempotent extraction/embedding/indexing work with retries and atomic publish gate.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| version_id | uuid | no |
| pipeline_version | text | no |
| status | text | no |
| attempts | integer | no |
| next_attempt_at | timestamptz | yes |
| lease_until | timestamptz | yes |
| error_code | text | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: knowledge.ingestion_jobs.

- Unique: (business_id, version_id, pipeline_version).
- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, version_id) → pos_db.knowledge.versions (business_id, id); delete RESTRICT.
- Required invariant: attempts >= 0; published only when both retrieval paths are ready.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.platform.configuration_inbox — Phase 4

Idempotent config receipt and local projection changes committed together.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| origin_event_ref | uuid | no |
| config_revision | bigint | no |
| payload_hash | text | no |
| applied_at | timestamptz | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: platform.configuration_inbox.

- Logical external reference (NOT a SQL FK): control_db.platform.configuration_outbox; Authenticated provisioning; local registry upsert and inbox record in same domain transaction; config revision replay protection.
- Unique: (business_id, origin_event_ref).
- Unique: (business_id, config_revision).
- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.

RLS and service authorization required; retention is defined by data class in the design review.

## pos_db.platform.reporting_outbox — Phase 6

Immutable reporting event inserted with local mutation/audit; delivery fields separately mutable.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| aggregate_ref | text | no |
| aggregate_version | bigint | no |
| event_type | text | no |
| payload | jsonb | no |
| payload_hash | text | no |
| status | text | no |
| attempts | integer | no |
| next_attempt_at | timestamptz | yes |
| lease_until | timestamptz | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: pos_db. Authority: local. Reusable template: platform.reporting_outbox.

- Unique: (business_id, aggregate_ref, aggregate_version, event_type).
- FK: (business_id) → pos_db.platform.businesses (id); delete RESTRICT.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.platform.businesses — Phase 4

Read-only domain projection of central routing/configuration; only scoped configuration consumer may update.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| id | uuid | no |
| code | text | no |
| display_name | text | no |
| domain | text | no |
| timezone | text | no |
| status | text | no |
| config_version | integer | no |
| created_at | timestamptz | no |
| config_revision | bigint | no |
| valid_until | timestamptz | no |

Primary key: id.

Database: bise_db. Authority: provisioned_projection. Reusable template: platform.businesses.

- Logical external reference (NOT a SQL FK): control_db.platform.businesses; Versioned authenticated configuration events; never a cross-database FK; expired configuration denies dispatch.
- Unique: (code).
- Required invariant: domain in sales,bise,hospital; status in active,disabled; config_version > 0.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.platform.instances — Phase 4

Read-only domain projection of central routing/configuration; only scoped configuration consumer may update.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| provider | text | no |
| external_instance_id | text | no |
| status | text | no |
| created_at | timestamptz | no |
| config_revision | bigint | no |
| valid_until | timestamptz | no |

Primary key: business_id, id.

Database: bise_db. Authority: provisioned_projection. Reusable template: platform.instances.

- Logical external reference (NOT a SQL FK): control_db.platform.instances; Versioned authenticated configuration events; never a cross-database FK; expired configuration denies dispatch.
- Unique: (provider, external_instance_id).
- FK: (business_id) → bise_db.platform.businesses (id); delete RESTRICT.
- Required invariant: Unique trusted routing mapping across businesses; status active/disabled.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.platform.contacts — Phase 5

Tenant-local person/customer reference; does not imply verified identity.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| display_name | text | yes |
| status | text | no |
| updated_at | timestamptz | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: bise_db. Authority: local. Reusable template: platform.contacts.

- FK: (business_id) → bise_db.platform.businesses (id); delete RESTRICT.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.platform.channel_identities — Phase 5

Channel participant linked to contact within an instance; shared numbers require separate subject grants.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| instance_id | uuid | no |
| contact_id | uuid | no |
| jid | text | no |
| address_kind | text | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: bise_db. Authority: local. Reusable template: platform.channel_identities.

- Unique: (business_id, instance_id, jid).
- FK: (business_id) → bise_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, instance_id) → bise_db.platform.instances (business_id, id); delete RESTRICT.
- FK: (business_id, contact_id) → bise_db.platform.contacts (business_id, id); delete RESTRICT.
- Required invariant: JID retained as identifier; LID is not assumed to be a phone number.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.platform.conversations — Phase 6

Conversation identity, scope and operator handoff state.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| instance_id | uuid | no |
| contact_id | uuid | no |
| chat_jid | text | no |
| status | text | no |
| version | integer | no |
| updated_at | timestamptz | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: bise_db. Authority: local. Reusable template: platform.conversations.

- Unique: (business_id, instance_id, chat_jid).
- Unique: (business_id, id, contact_id).
- Unique: (business_id, id, instance_id).
- FK: (business_id) → bise_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, instance_id) → bise_db.platform.instances (business_id, id); delete RESTRICT.
- FK: (business_id, contact_id) → bise_db.platform.contacts (business_id, id); delete RESTRICT.
- Required invariant: Initial pilot direct chats only; version > 0.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.platform.sessions — Phase 6

Bounded context and pending-intent state; never authoritative authorization from LLM memory.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| conversation_id | uuid | no |
| actor_contact_id | uuid | no |
| state | jsonb | no |
| version | integer | no |
| last_seen_at | timestamptz | no |
| expires_at | timestamptz | no |
| absolute_expires_at | timestamptz | no |
| revoked_at | timestamptz | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: bise_db. Authority: local. Reusable template: platform.sessions.

- Unique: (business_id, id, actor_contact_id).
- FK: (business_id) → bise_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, actor_contact_id) → bise_db.platform.contacts (business_id, id); delete RESTRICT.
- FK: (business_id, conversation_id, actor_contact_id) → bise_db.platform.conversations (business_id, id, contact_id); delete RESTRICT.
- Required invariant: created_at <= last_seen_at < expires_at <= absolute_expires_at; absolute expiry immutable; version > 0; state schema/size allowlist enforced by service.
- Candidate nonunique index: (business_id, conversation_id, created_at); measure against actual queries.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.platform.verification_grants — Phase 8

Server-created actor-to-subject authorization, including explicit guardian/delegate permission.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| session_id | uuid | no |
| actor_contact_id | uuid | no |
| subject_contact_id | uuid | no |
| scope | text | no |
| method | text | no |
| evidence_ref | text | no |
| expires_at | timestamptz | no |
| revoked_at | timestamptz | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: bise_db. Authority: local. Reusable template: platform.verification_grants.

- Unique: (business_id, id, session_id).
- FK: (business_id) → bise_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, subject_contact_id) → bise_db.platform.contacts (business_id, id); delete RESTRICT.
- FK: (business_id, session_id, actor_contact_id) → bise_db.platform.sessions (business_id, id, actor_contact_id); delete RESTRICT.
- Required invariant: expires_at > created_at; no raw CNIC, OTP, or evidence documents stored; scope is registered.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.platform.requests — Phase 6

Durable normalized ingress and duplicate-event boundary.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| instance_id | uuid | no |
| provider_event_id | text | no |
| event_type | text | no |
| status | text | no |
| attempts | integer | no |
| lease_until | timestamptz | yes |
| next_attempt_at | timestamptz | yes |
| error_code | text | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: bise_db. Authority: local. Reusable template: platform.requests.

- Unique: (business_id, instance_id, event_type, provider_event_id).
- Unique: (business_id, id, instance_id).
- FK: (business_id) → bise_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, instance_id) → bise_db.platform.instances (business_id, id); delete RESTRICT.
- Required invariant: attempts >= 0; identifier nonempty; no raw event payload.
- Candidate nonunique index: (status, next_attempt_at); measure against actual queries.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.platform.messages — Phase 6

Redacted persistent conversational history; provider IDs and request link support deduplication.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| instance_id | uuid | no |
| conversation_id | uuid | no |
| request_id | uuid | yes |
| direction | text | no |
| role | text | no |
| content | text | no |
| provider_message_id | text | yes |
| delivery_state | text | no |
| occurred_at | timestamptz | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: bise_db. Authority: local. Reusable template: platform.messages.

- Unique: (business_id, request_id, direction).
- Unique: (business_id, instance_id, provider_message_id, direction).
- FK: (business_id) → bise_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, instance_id) → bise_db.platform.instances (business_id, id); delete RESTRICT.
- FK: (business_id, conversation_id, instance_id) → bise_db.platform.conversations (business_id, id, instance_id); delete RESTRICT.
- FK: (business_id, request_id, instance_id) → bise_db.platform.requests (business_id, id, instance_id); delete RESTRICT.
- Required invariant: direction inbound/outbound; role user/assistant/operator/system; initial one response per request; null request allowed for separately keyed proactive actions.
- Candidate nonunique index: (business_id, conversation_id, occurred_at, id); measure against actual queries.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.platform.actions — Phase 18

Confirmed immutable business intent and execution/idempotency state.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| session_id | uuid | no |
| verification_grant_id | uuid | yes |
| operation | text | no |
| idempotency_key | text | no |
| payload_hash | text | no |
| payload | jsonb | no |
| status | text | no |
| expires_at | timestamptz | no |
| version | integer | no |
| result_ref | text | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: bise_db. Authority: local. Reusable template: platform.actions.

- Unique: (business_id, operation, idempotency_key).
- FK: (business_id) → bise_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, session_id) → bise_db.platform.sessions (business_id, id); delete RESTRICT.
- FK: (business_id, verification_grant_id, session_id) → bise_db.platform.verification_grants (business_id, id, session_id); delete RESTRICT.
- Required invariant: Same key/different payload rejects; expires_at > created_at; minimized typed payload; version > 0.
- Required invariant: Grant, if required, must belong to this session and match action subject/scope; validate on execution, not only action creation.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.platform.approvals — Phase 19

Expiring approval bound to action hash/version; operator identity is an external trusted principal.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| action_id | uuid | no |
| action_hash | text | no |
| action_version | integer | no |
| principal_ref | text | no |
| decision | text | no |
| expires_at | timestamptz | no |
| used_at | timestamptz | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: bise_db. Authority: local. Reusable template: platform.approvals.

- FK: (business_id) → bise_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, action_id) → bise_db.platform.actions (business_id, id); delete RESTRICT.
- Required invariant: decision approve/reject; authenticated approver has permission; one-time use checked transactionally.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.platform.outbox — Phase 6

Durable response dispatch; records accepted/unknown separately from delivered.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| message_id | uuid | no |
| dispatch_key | text | no |
| status | text | no |
| attempts | integer | no |
| next_attempt_at | timestamptz | yes |
| lease_until | timestamptz | yes |
| provider_ref | text | yes |
| last_error_code | text | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: bise_db. Authority: local. Reusable template: platform.outbox.

- Unique: (business_id, message_id).
- Unique: (business_id, dispatch_key).
- FK: (business_id) → bise_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, message_id) → bise_db.platform.messages (business_id, id); delete RESTRICT.
- Required invariant: attempts >= 0; ambiguous send enters unknown, not blindly pending.
- Candidate nonunique index: (status, next_attempt_at); measure against actual queries.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.platform.audit_events — Phase 4

Append-only security/business metadata; no raw messages or credentials.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| request_ref | text | yes |
| actor_ref | text | no |
| event_type | text | no |
| resource_ref | text | yes |
| outcome | text | no |
| details | jsonb | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: bise_db. Authority: local. Reusable template: platform.audit_events.

- FK: (business_id) → bise_db.platform.businesses (id); delete RESTRICT.
- Required invariant: Details key/size allowlist; runtime cannot UPDATE/DELETE audit rows.
- Candidate nonunique index: (business_id, created_at, id); measure against actual queries.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.platform.tool_runs — Phase 8

Trace tool outcome/evidence, latency and versions without duplicating sensitive result bodies.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| request_id | uuid | no |
| tool_name | text | no |
| tool_version | text | no |
| outcome | text | no |
| source_refs | jsonb | no |
| duration_ms | integer | no |
| error_code | text | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: bise_db. Authority: local. Reusable template: platform.tool_runs.

- FK: (business_id) → bise_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, request_id) → bise_db.platform.requests (business_id, id); delete RESTRICT.
- Required invariant: duration_ms >= 0; redact source references as required.
- Candidate nonunique index: (business_id, request_id); measure against actual queries.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.platform.handoffs — Phase 19

Operator ownership and bot pause/resume record.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| conversation_id | uuid | no |
| reason_code | text | no |
| status | text | no |
| assigned_principal_ref | text | yes |
| updated_at | timestamptz | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: bise_db. Authority: local. Reusable template: platform.handoffs.

- FK: (business_id) → bise_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, conversation_id) → bise_db.platform.conversations (business_id, id); delete RESTRICT.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.bise.students — Phase 8

Synthetic student subject; production source mapping later, not an asserted Board schema.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| contact_id | uuid | no |
| source_student_ref | text | no |
| display_name | text | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: bise_db. Authority: local. Reusable template: bise.students.

- Unique: (business_id, contact_id).
- Unique: (business_id, source_student_ref).
- FK: (business_id) → bise_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, contact_id) → bise_db.platform.contacts (business_id, id); delete RESTRICT.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.bise.exams — Phase 8

Unambiguous examination/year/session/attempt context.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| exam_code | text | no |
| year | integer | no |
| session | text | no |
| attempt | text | no |
| publication_state | text | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: bise_db. Authority: local. Reusable template: bise.exams.

- Unique: (business_id, exam_code, year, session, attempt).
- FK: (business_id) → bise_db.platform.businesses (id); delete RESTRICT.
- Required invariant: publication_state draft/published/withheld.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.bise.registrations — Phase 8

Roll number scoped to an examination; names never act as unique identifiers.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| student_id | uuid | no |
| exam_id | uuid | no |
| roll_number | text | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: bise_db. Authority: local. Reusable template: bise.registrations.

- Unique: (business_id, exam_id, roll_number).
- Unique: (business_id, exam_id, student_id).
- FK: (business_id) → bise_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, student_id) → bise_db.bise.students (business_id, id); delete RESTRICT.
- FK: (business_id, exam_id) → bise_db.bise.exams (business_id, id); delete RESTRICT.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.bise.results — Phase 8

Source-issued result; null/unpublished/withheld are not zero marks.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| registration_id | uuid | no |
| status | text | no |
| total_marks | numeric(7,2) | yes |
| obtained_marks | numeric(7,2) | yes |
| grade | text | yes |
| source_version | text | no |
| published_at | timestamptz | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: bise_db. Authority: local. Reusable template: bise.results.

- Unique: (business_id, registration_id).
- FK: (business_id) → bise_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, registration_id) → bise_db.bise.registrations (business_id, id); delete RESTRICT.
- Required invariant: If present: 0 <= obtained_marks <= total_marks; explicit absent/withheld/missing states; source authority determines grade.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.bise.subject_marks — Phase 8

Per-result subject component; theory/practical distinguished.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| result_id | uuid | no |
| subject_code | text | no |
| subject_name | text | no |
| component | text | no |
| total_marks | numeric(7,2) | yes |
| obtained_marks | numeric(7,2) | yes |
| status | text | no |
| grade | text | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: bise_db. Authority: local. Reusable template: bise.subject_marks.

- Unique: (business_id, result_id, subject_code, component).
- FK: (business_id) → bise_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, result_id) → bise_db.bise.results (business_id, id); delete RESTRICT.
- Required invariant: If present: 0 <= obtained_marks <= total_marks; do not infer missing marks/grades.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.knowledge.documents — Phase 13

Stable approved-source identity, tenant and permitted audience.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| source_key | text | no |
| title | text | no |
| category | text | no |
| audience | text | no |
| source_ref | text | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: bise_db. Authority: local. Reusable template: knowledge.documents.

- Unique: (business_id, source_key).
- FK: (business_id) → bise_db.platform.businesses (id); delete RESTRICT.
- Required invariant: No student/patient/private transaction records admitted to shared knowledge.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.knowledge.versions — Phase 13

Immutable document version and approval/effectivity; unpublished indexes never exposed.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| document_id | uuid | no |
| version | integer | no |
| content_hash | text | no |
| status | text | no |
| effective_from | timestamptz | no |
| effective_to | timestamptz | yes |
| approver_ref | text | yes |
| source_text | text | no |
| embedding_model | text | no |
| embedding_revision | text | no |
| embedding_dimension | integer | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: bise_db. Authority: local. Reusable template: knowledge.versions.

- Unique: (business_id, document_id, version).
- FK: (business_id) → bise_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, document_id) → bise_db.knowledge.documents (business_id, id); delete RESTRICT.
- Required invariant: version > 0; dimension > 0; effective_to null or > effective_from; no conflicting active published windows per document unless explicitly segmented.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.knowledge.chunks — Phase 13

Shared chunk identity for genuine BM25 and pgvector; dimension finalized before vector DDL.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| version_id | uuid | no |
| ordinal | integer | no |
| content | text | no |
| content_hash | text | no |
| embedding | vector(d) | no |
| index_state | text | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: bise_db. Authority: local. Reusable template: knowledge.chunks.

- Unique: (business_id, version_id, ordinal).
- FK: (business_id) → bise_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, version_id) → bise_db.knowledge.versions (business_id, id); delete RESTRICT.
- Required invariant: ordinal >= 0; d must match approved embedding dimension; tenant/audience/version filter on both retrieval paths.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.knowledge.ingestion_jobs — Phase 14

Idempotent extraction/embedding/indexing work with retries and atomic publish gate.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| version_id | uuid | no |
| pipeline_version | text | no |
| status | text | no |
| attempts | integer | no |
| next_attempt_at | timestamptz | yes |
| lease_until | timestamptz | yes |
| error_code | text | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: bise_db. Authority: local. Reusable template: knowledge.ingestion_jobs.

- Unique: (business_id, version_id, pipeline_version).
- FK: (business_id) → bise_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, version_id) → bise_db.knowledge.versions (business_id, id); delete RESTRICT.
- Required invariant: attempts >= 0; published only when both retrieval paths are ready.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.platform.configuration_inbox — Phase 4

Idempotent config receipt and local projection changes committed together.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| origin_event_ref | uuid | no |
| config_revision | bigint | no |
| payload_hash | text | no |
| applied_at | timestamptz | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: bise_db. Authority: local. Reusable template: platform.configuration_inbox.

- Logical external reference (NOT a SQL FK): control_db.platform.configuration_outbox; Authenticated provisioning; local registry upsert and inbox record in same domain transaction; config revision replay protection.
- Unique: (business_id, origin_event_ref).
- Unique: (business_id, config_revision).
- FK: (business_id) → bise_db.platform.businesses (id); delete RESTRICT.

RLS and service authorization required; retention is defined by data class in the design review.

## bise_db.platform.reporting_outbox — Phase 6

Immutable reporting event inserted with local mutation/audit; delivery fields separately mutable.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| aggregate_ref | text | no |
| aggregate_version | bigint | no |
| event_type | text | no |
| payload | jsonb | no |
| payload_hash | text | no |
| status | text | no |
| attempts | integer | no |
| next_attempt_at | timestamptz | yes |
| lease_until | timestamptz | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: bise_db. Authority: local. Reusable template: platform.reporting_outbox.

- Unique: (business_id, aggregate_ref, aggregate_version, event_type).
- FK: (business_id) → bise_db.platform.businesses (id); delete RESTRICT.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.platform.businesses — Phase 4

Read-only domain projection of central routing/configuration; only scoped configuration consumer may update.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| id | uuid | no |
| code | text | no |
| display_name | text | no |
| domain | text | no |
| timezone | text | no |
| status | text | no |
| config_version | integer | no |
| created_at | timestamptz | no |
| config_revision | bigint | no |
| valid_until | timestamptz | no |

Primary key: id.

Database: hospital_db. Authority: provisioned_projection. Reusable template: platform.businesses.

- Logical external reference (NOT a SQL FK): control_db.platform.businesses; Versioned authenticated configuration events; never a cross-database FK; expired configuration denies dispatch.
- Unique: (code).
- Required invariant: domain in sales,bise,hospital; status in active,disabled; config_version > 0.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.platform.instances — Phase 4

Read-only domain projection of central routing/configuration; only scoped configuration consumer may update.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| provider | text | no |
| external_instance_id | text | no |
| status | text | no |
| created_at | timestamptz | no |
| config_revision | bigint | no |
| valid_until | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: provisioned_projection. Reusable template: platform.instances.

- Logical external reference (NOT a SQL FK): control_db.platform.instances; Versioned authenticated configuration events; never a cross-database FK; expired configuration denies dispatch.
- Unique: (provider, external_instance_id).
- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.
- Required invariant: Unique trusted routing mapping across businesses; status active/disabled.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.platform.contacts — Phase 5

Tenant-local person/customer reference; does not imply verified identity.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| display_name | text | yes |
| status | text | no |
| updated_at | timestamptz | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: local. Reusable template: platform.contacts.

- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.platform.channel_identities — Phase 5

Channel participant linked to contact within an instance; shared numbers require separate subject grants.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| instance_id | uuid | no |
| contact_id | uuid | no |
| jid | text | no |
| address_kind | text | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: local. Reusable template: platform.channel_identities.

- Unique: (business_id, instance_id, jid).
- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, instance_id) → hospital_db.platform.instances (business_id, id); delete RESTRICT.
- FK: (business_id, contact_id) → hospital_db.platform.contacts (business_id, id); delete RESTRICT.
- Required invariant: JID retained as identifier; LID is not assumed to be a phone number.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.platform.conversations — Phase 6

Conversation identity, scope and operator handoff state.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| instance_id | uuid | no |
| contact_id | uuid | no |
| chat_jid | text | no |
| status | text | no |
| version | integer | no |
| updated_at | timestamptz | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: local. Reusable template: platform.conversations.

- Unique: (business_id, instance_id, chat_jid).
- Unique: (business_id, id, contact_id).
- Unique: (business_id, id, instance_id).
- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, instance_id) → hospital_db.platform.instances (business_id, id); delete RESTRICT.
- FK: (business_id, contact_id) → hospital_db.platform.contacts (business_id, id); delete RESTRICT.
- Required invariant: Initial pilot direct chats only; version > 0.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.platform.sessions — Phase 6

Bounded context and pending-intent state; never authoritative authorization from LLM memory.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| conversation_id | uuid | no |
| actor_contact_id | uuid | no |
| state | jsonb | no |
| version | integer | no |
| last_seen_at | timestamptz | no |
| expires_at | timestamptz | no |
| absolute_expires_at | timestamptz | no |
| revoked_at | timestamptz | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: local. Reusable template: platform.sessions.

- Unique: (business_id, id, actor_contact_id).
- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, actor_contact_id) → hospital_db.platform.contacts (business_id, id); delete RESTRICT.
- FK: (business_id, conversation_id, actor_contact_id) → hospital_db.platform.conversations (business_id, id, contact_id); delete RESTRICT.
- Required invariant: created_at <= last_seen_at < expires_at <= absolute_expires_at; absolute expiry immutable; version > 0; state schema/size allowlist enforced by service.
- Candidate nonunique index: (business_id, conversation_id, created_at); measure against actual queries.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.platform.verification_grants — Phase 8

Server-created actor-to-subject authorization, including explicit guardian/delegate permission.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| session_id | uuid | no |
| actor_contact_id | uuid | no |
| subject_contact_id | uuid | no |
| scope | text | no |
| method | text | no |
| evidence_ref | text | no |
| expires_at | timestamptz | no |
| revoked_at | timestamptz | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: local. Reusable template: platform.verification_grants.

- Unique: (business_id, id, session_id).
- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, subject_contact_id) → hospital_db.platform.contacts (business_id, id); delete RESTRICT.
- FK: (business_id, session_id, actor_contact_id) → hospital_db.platform.sessions (business_id, id, actor_contact_id); delete RESTRICT.
- Required invariant: expires_at > created_at; no raw CNIC, OTP, or evidence documents stored; scope is registered.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.platform.requests — Phase 6

Durable normalized ingress and duplicate-event boundary.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| instance_id | uuid | no |
| provider_event_id | text | no |
| event_type | text | no |
| status | text | no |
| attempts | integer | no |
| lease_until | timestamptz | yes |
| next_attempt_at | timestamptz | yes |
| error_code | text | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: local. Reusable template: platform.requests.

- Unique: (business_id, instance_id, event_type, provider_event_id).
- Unique: (business_id, id, instance_id).
- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, instance_id) → hospital_db.platform.instances (business_id, id); delete RESTRICT.
- Required invariant: attempts >= 0; identifier nonempty; no raw event payload.
- Candidate nonunique index: (status, next_attempt_at); measure against actual queries.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.platform.messages — Phase 6

Redacted persistent conversational history; provider IDs and request link support deduplication.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| instance_id | uuid | no |
| conversation_id | uuid | no |
| request_id | uuid | yes |
| direction | text | no |
| role | text | no |
| content | text | no |
| provider_message_id | text | yes |
| delivery_state | text | no |
| occurred_at | timestamptz | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: local. Reusable template: platform.messages.

- Unique: (business_id, request_id, direction).
- Unique: (business_id, instance_id, provider_message_id, direction).
- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, instance_id) → hospital_db.platform.instances (business_id, id); delete RESTRICT.
- FK: (business_id, conversation_id, instance_id) → hospital_db.platform.conversations (business_id, id, instance_id); delete RESTRICT.
- FK: (business_id, request_id, instance_id) → hospital_db.platform.requests (business_id, id, instance_id); delete RESTRICT.
- Required invariant: direction inbound/outbound; role user/assistant/operator/system; initial one response per request; null request allowed for separately keyed proactive actions.
- Candidate nonunique index: (business_id, conversation_id, occurred_at, id); measure against actual queries.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.platform.actions — Phase 18

Confirmed immutable business intent and execution/idempotency state.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| session_id | uuid | no |
| verification_grant_id | uuid | yes |
| operation | text | no |
| idempotency_key | text | no |
| payload_hash | text | no |
| payload | jsonb | no |
| status | text | no |
| expires_at | timestamptz | no |
| version | integer | no |
| result_ref | text | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: local. Reusable template: platform.actions.

- Unique: (business_id, operation, idempotency_key).
- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, session_id) → hospital_db.platform.sessions (business_id, id); delete RESTRICT.
- FK: (business_id, verification_grant_id, session_id) → hospital_db.platform.verification_grants (business_id, id, session_id); delete RESTRICT.
- Required invariant: Same key/different payload rejects; expires_at > created_at; minimized typed payload; version > 0.
- Required invariant: Grant, if required, must belong to this session and match action subject/scope; validate on execution, not only action creation.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.platform.approvals — Phase 19

Expiring approval bound to action hash/version; operator identity is an external trusted principal.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| action_id | uuid | no |
| action_hash | text | no |
| action_version | integer | no |
| principal_ref | text | no |
| decision | text | no |
| expires_at | timestamptz | no |
| used_at | timestamptz | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: local. Reusable template: platform.approvals.

- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, action_id) → hospital_db.platform.actions (business_id, id); delete RESTRICT.
- Required invariant: decision approve/reject; authenticated approver has permission; one-time use checked transactionally.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.platform.outbox — Phase 6

Durable response dispatch; records accepted/unknown separately from delivered.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| message_id | uuid | no |
| dispatch_key | text | no |
| status | text | no |
| attempts | integer | no |
| next_attempt_at | timestamptz | yes |
| lease_until | timestamptz | yes |
| provider_ref | text | yes |
| last_error_code | text | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: local. Reusable template: platform.outbox.

- Unique: (business_id, message_id).
- Unique: (business_id, dispatch_key).
- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, message_id) → hospital_db.platform.messages (business_id, id); delete RESTRICT.
- Required invariant: attempts >= 0; ambiguous send enters unknown, not blindly pending.
- Candidate nonunique index: (status, next_attempt_at); measure against actual queries.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.platform.audit_events — Phase 4

Append-only security/business metadata; no raw messages or credentials.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| request_ref | text | yes |
| actor_ref | text | no |
| event_type | text | no |
| resource_ref | text | yes |
| outcome | text | no |
| details | jsonb | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: local. Reusable template: platform.audit_events.

- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.
- Required invariant: Details key/size allowlist; runtime cannot UPDATE/DELETE audit rows.
- Candidate nonunique index: (business_id, created_at, id); measure against actual queries.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.platform.tool_runs — Phase 8

Trace tool outcome/evidence, latency and versions without duplicating sensitive result bodies.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| request_id | uuid | no |
| tool_name | text | no |
| tool_version | text | no |
| outcome | text | no |
| source_refs | jsonb | no |
| duration_ms | integer | no |
| error_code | text | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: local. Reusable template: platform.tool_runs.

- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, request_id) → hospital_db.platform.requests (business_id, id); delete RESTRICT.
- Required invariant: duration_ms >= 0; redact source references as required.
- Candidate nonunique index: (business_id, request_id); measure against actual queries.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.platform.handoffs — Phase 19

Operator ownership and bot pause/resume record.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| conversation_id | uuid | no |
| reason_code | text | no |
| status | text | no |
| assigned_principal_ref | text | yes |
| updated_at | timestamptz | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: local. Reusable template: platform.handoffs.

- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, conversation_id) → hospital_db.platform.conversations (business_id, id); delete RESTRICT.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.hospital.departments — Phase 8

Approved administrative directory.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| code | text | no |
| name | text | no |
| description | text | yes |
| active | boolean | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: local. Reusable template: hospital.departments.

- Unique: (business_id, code).
- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.hospital.doctors — Phase 8

Approved directory with one primary department for initial synthetic pilot.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| department_id | uuid | no |
| doctor_code | text | no |
| display_name | text | no |
| specialization | text | no |
| active | boolean | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: local. Reusable template: hospital.doctors.

- Unique: (business_id, doctor_code).
- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, department_id) → hospital_db.hospital.departments (business_id, id); delete RESTRICT.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.hospital.slots — Phase 8

Materialized exclusive consultation slots in one pilot branch; times stored as instants.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| doctor_id | uuid | no |
| starts_at | timestamptz | no |
| ends_at | timestamptz | no |
| state | text | no |
| version | integer | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: local. Reusable template: hospital.slots.

- Unique: (business_id, doctor_id, starts_at).
- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, doctor_id) → hospital_db.hospital.doctors (business_id, id); delete RESTRICT.
- Required invariant: ends_at > starts_at; state open/blocked/retired; version > 0.
- Required invariant: EXCLUDE overlapping [start,end) ranges per business+doctor for non-retired slots; requires btree_gist at migration stage.
- Candidate nonunique index: (business_id, doctor_id, starts_at); measure against actual queries.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.hospital.appointments — Phase 18

Patient subject is a tenant contact; protected access requires a matching grant, including delegated access.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| patient_id | uuid | no |
| slot_id | uuid | no |
| action_id | uuid | no |
| booking_reference | text | no |
| status | text | no |
| hold_expires_at | timestamptz | yes |
| version | integer | no |
| updated_at | timestamptz | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: local. Reusable template: hospital.appointments.

- Unique: (business_id, booking_reference).
- Unique: (business_id, action_id).
- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, patient_id) → hospital_db.platform.contacts (business_id, id); delete RESTRICT.
- FK: (business_id, slot_id) → hospital_db.hospital.slots (business_id, id); delete RESTRICT.
- FK: (business_id, action_id) → hospital_db.platform.actions (business_id, id); delete RESTRICT.
- Required invariant: Partial UNIQUE(business_id,slot_id) for active reserving statuses held/confirmed; version > 0; reschedule atomically retains same booking id.
- Required invariant: held requires hold_expires_at > created_at; expiry worker transitions status under lock; no clock-dependent index predicate.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.hospital.appointment_events — Phase 18

Durable booking transition history, including previous/new slot on reschedule.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| appointment_id | uuid | no |
| action_id | uuid | no |
| from_slot_id | uuid | yes |
| to_slot_id | uuid | yes |
| event_type | text | no |
| actor_ref | text | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: local. Reusable template: hospital.appointment_events.

- Unique: (business_id, action_id).
- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, appointment_id) → hospital_db.hospital.appointments (business_id, id); delete RESTRICT.
- FK: (business_id, action_id) → hospital_db.platform.actions (business_id, id); delete RESTRICT.
- FK: (business_id, from_slot_id) → hospital_db.hospital.slots (business_id, id); delete RESTRICT.
- FK: (business_id, to_slot_id) → hospital_db.hospital.slots (business_id, id); delete RESTRICT.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.hospital.calendar_sync_jobs — Phase 18

Version-aware desired external projection and reconciliation; separate from appointment status.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| appointment_id | uuid | no |
| appointment_version | integer | no |
| provider | text | no |
| external_event_id | text | yes |
| operation | text | no |
| status | text | no |
| attempts | integer | no |
| next_attempt_at | timestamptz | yes |
| lease_until | timestamptz | yes |
| error_code | text | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: local. Reusable template: hospital.calendar_sync_jobs.

- Unique: (business_id, appointment_id, appointment_version, provider).
- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, appointment_id) → hospital_db.hospital.appointments (business_id, id); delete RESTRICT.
- Required invariant: attempts >= 0; appointment_version > 0; stable external identity and stale-job suppression.
- Candidate nonunique index: (status, next_attempt_at); measure against actual queries.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.knowledge.documents — Phase 13

Stable approved-source identity, tenant and permitted audience.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| source_key | text | no |
| title | text | no |
| category | text | no |
| audience | text | no |
| source_ref | text | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: local. Reusable template: knowledge.documents.

- Unique: (business_id, source_key).
- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.
- Required invariant: No student/patient/private transaction records admitted to shared knowledge.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.knowledge.versions — Phase 13

Immutable document version and approval/effectivity; unpublished indexes never exposed.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| document_id | uuid | no |
| version | integer | no |
| content_hash | text | no |
| status | text | no |
| effective_from | timestamptz | no |
| effective_to | timestamptz | yes |
| approver_ref | text | yes |
| source_text | text | no |
| embedding_model | text | no |
| embedding_revision | text | no |
| embedding_dimension | integer | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: local. Reusable template: knowledge.versions.

- Unique: (business_id, document_id, version).
- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, document_id) → hospital_db.knowledge.documents (business_id, id); delete RESTRICT.
- Required invariant: version > 0; dimension > 0; effective_to null or > effective_from; no conflicting active published windows per document unless explicitly segmented.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.knowledge.chunks — Phase 13

Shared chunk identity for genuine BM25 and pgvector; dimension finalized before vector DDL.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| version_id | uuid | no |
| ordinal | integer | no |
| content | text | no |
| content_hash | text | no |
| embedding | vector(d) | no |
| index_state | text | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: local. Reusable template: knowledge.chunks.

- Unique: (business_id, version_id, ordinal).
- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, version_id) → hospital_db.knowledge.versions (business_id, id); delete RESTRICT.
- Required invariant: ordinal >= 0; d must match approved embedding dimension; tenant/audience/version filter on both retrieval paths.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.knowledge.ingestion_jobs — Phase 14

Idempotent extraction/embedding/indexing work with retries and atomic publish gate.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| version_id | uuid | no |
| pipeline_version | text | no |
| status | text | no |
| attempts | integer | no |
| next_attempt_at | timestamptz | yes |
| lease_until | timestamptz | yes |
| error_code | text | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: local. Reusable template: knowledge.ingestion_jobs.

- Unique: (business_id, version_id, pipeline_version).
- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.
- FK: (business_id, version_id) → hospital_db.knowledge.versions (business_id, id); delete RESTRICT.
- Required invariant: attempts >= 0; published only when both retrieval paths are ready.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.platform.configuration_inbox — Phase 4

Idempotent config receipt and local projection changes committed together.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| origin_event_ref | uuid | no |
| config_revision | bigint | no |
| payload_hash | text | no |
| applied_at | timestamptz | no |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: local. Reusable template: platform.configuration_inbox.

- Logical external reference (NOT a SQL FK): control_db.platform.configuration_outbox; Authenticated provisioning; local registry upsert and inbox record in same domain transaction; config revision replay protection.
- Unique: (business_id, origin_event_ref).
- Unique: (business_id, config_revision).
- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.

RLS and service authorization required; retention is defined by data class in the design review.

## hospital_db.platform.reporting_outbox — Phase 6

Immutable reporting event inserted with local mutation/audit; delivery fields separately mutable.

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| aggregate_ref | text | no |
| aggregate_version | bigint | no |
| event_type | text | no |
| payload | jsonb | no |
| payload_hash | text | no |
| status | text | no |
| attempts | integer | no |
| next_attempt_at | timestamptz | yes |
| lease_until | timestamptz | yes |
| created_at | timestamptz | no |

Primary key: business_id, id.

Database: hospital_db. Authority: local. Reusable template: platform.reporting_outbox.

- Unique: (business_id, aggregate_ref, aggregate_version, event_type).
- FK: (business_id) → hospital_db.platform.businesses (id); delete RESTRICT.

RLS and service authorization required; retention is defined by data class in the design review.

