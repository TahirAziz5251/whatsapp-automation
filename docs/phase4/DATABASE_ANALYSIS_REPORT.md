# Phase 4 — database analysis before implementation

Captured: 2026-09-23T15:15:43.8779607Z. Catalog-only read-only queries; no student/customer/patient records exported. Official Board source schema is not connected and must not be inferred from the dummy model.

| Server/container | Actual database | PostgreSQL | Schemas | Base tables | pgvector available |
| --- | --- | --- | --- | --- | --- |
| evolution-postgres | evogo_auth | 15.19 | public | 18 | false |
| evolution-postgres | evogo_users | 15.19 | public | 4 | false |
| evolution-postgres | postgres | 15.19 | public | 3 | false |
| business-agent-dev-postgres-1 | agent_dev | 15.19 | public | 0 | false |

Proposed target databases present before implementation:  (blank means none). Four new application DBs belong only to the isolated development server. Existing Evolution internal DBs, n8n storage and the unrelated n8n-automation container are not migration targets.

## BISE business concept mapping

“Not available” means actual Board table/column/type/nullability could not be inspected. Proposed fields below belong to our future synthetic model, NOT an official Board schema. Student/examination tables are Phase 8 scope, not Phase 4 foundational tables.

| Business concept | Actual table | Actual column | Actual type / nullable | Proposed synthetic field | Proposed type / nullable | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Student ID | Not available | Not available | Not available | bise.students.id | uuid / no | Composite identity includes business_id |
| Student Name | Not available | Not available | Not available | bise.students.display_name | text / no | Protected field |
| Roll Number | Not available | Not available | Not available | bise.registrations.roll_number | text / no | Unique per business/exam; preserve leading zeros |
| B-Form/CNIC | Not available | Not available | Not available | No raw identifier field in current catalog | Not yet designed | Protected verifier adapter; matching identifiers alone does not authenticate; keyed fingerprint/encrypted storage only if approved |
| Exam | Not available | Not available | Not available | bise.exams.exam_code; year; session; attempt | See Phase 3 dictionary | Registration references exam_id; exam context required |
| Subject | Not available | Not available | Not available | bise.subject_marks.subject_code; subject_name; component | text / no | Theory/practical distinguished |
| Obtained Marks | Not available | Not available | Not available | bise.subject_marks.obtained_marks; bise.results.obtained_marks | numeric / yes | Null/withheld is not zero |
| Total Marks | Not available | Not available | Not available | bise.subject_marks.total_marks; bise.results.total_marks | numeric / yes | Source authoritative |
| Grade | Not available | Not available | Not available | bise.results.grade; bise.subject_marks.grade | text / yes | Source-issued grade; no guessed computation |

## Recommended Phase 4 columns / keys by database

16 foundational business tables; per-database migration bookkeeping is additional. Owner/runtime roles are separate. business_id is required on business-owned child rows; businesses.id is the tenant key. Domain configuration projections omit credential_ref. Configuration sync workers are not enabled by creating their tables.

### control_db

#### platform.businesses

Trusted business boundary; not selected by user/LLM text.

Primary key: (id).

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

Unique: (code).

#### platform.instances

Trusted Evolution instance-to-business mapping; references credentials, never stores tokens.

Primary key: (business_id, id).

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| provider | text | no |
| external_instance_id | text | no |
| credential_ref | text | no |
| status | text | no |
| created_at | timestamptz | no |

Unique: (provider, external_instance_id).

FK (business_id) → control_db.platform.businesses (id).

#### platform.audit_events

Append-only security/business metadata; no raw messages or credentials.

Primary key: (business_id, id).

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

FK (business_id) → control_db.platform.businesses (id).

#### platform.configuration_outbox

Configuration publication intent committed with authoritative configuration and audit.

Primary key: (business_id, id).

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

Unique: (business_id, config_revision).

FK (business_id) → control_db.platform.businesses (id).

### pos_db

#### platform.businesses

Read-only domain projection of central routing/configuration; only scoped configuration consumer may update.

Primary key: (id).

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

Unique: (code).

#### platform.instances

Read-only domain projection of central routing/configuration; only scoped configuration consumer may update.

Primary key: (business_id, id).

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

Unique: (provider, external_instance_id).

FK (business_id) → pos_db.platform.businesses (id).

#### platform.audit_events

Append-only security/business metadata; no raw messages or credentials.

Primary key: (business_id, id).

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

FK (business_id) → pos_db.platform.businesses (id).

#### platform.configuration_inbox

Idempotent config receipt and local projection changes committed together.

Primary key: (business_id, id).

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| origin_event_ref | uuid | no |
| config_revision | bigint | no |
| payload_hash | text | no |
| applied_at | timestamptz | no |
| created_at | timestamptz | no |

Unique: (business_id, origin_event_ref).

Unique: (business_id, config_revision).

FK (business_id) → pos_db.platform.businesses (id).

### bise_db

#### platform.businesses

Read-only domain projection of central routing/configuration; only scoped configuration consumer may update.

Primary key: (id).

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

Unique: (code).

#### platform.instances

Read-only domain projection of central routing/configuration; only scoped configuration consumer may update.

Primary key: (business_id, id).

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

Unique: (provider, external_instance_id).

FK (business_id) → bise_db.platform.businesses (id).

#### platform.audit_events

Append-only security/business metadata; no raw messages or credentials.

Primary key: (business_id, id).

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

FK (business_id) → bise_db.platform.businesses (id).

#### platform.configuration_inbox

Idempotent config receipt and local projection changes committed together.

Primary key: (business_id, id).

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| origin_event_ref | uuid | no |
| config_revision | bigint | no |
| payload_hash | text | no |
| applied_at | timestamptz | no |
| created_at | timestamptz | no |

Unique: (business_id, origin_event_ref).

Unique: (business_id, config_revision).

FK (business_id) → bise_db.platform.businesses (id).

### hospital_db

#### platform.businesses

Read-only domain projection of central routing/configuration; only scoped configuration consumer may update.

Primary key: (id).

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

Unique: (code).

#### platform.instances

Read-only domain projection of central routing/configuration; only scoped configuration consumer may update.

Primary key: (business_id, id).

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

Unique: (provider, external_instance_id).

FK (business_id) → hospital_db.platform.businesses (id).

#### platform.audit_events

Append-only security/business metadata; no raw messages or credentials.

Primary key: (business_id, id).

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

FK (business_id) → hospital_db.platform.businesses (id).

#### platform.configuration_inbox

Idempotent config receipt and local projection changes committed together.

Primary key: (business_id, id).

| Column | Proposed type | Nullable |
| --- | --- | --- |
| business_id | uuid | no |
| id | uuid | no |
| origin_event_ref | uuid | no |
| config_revision | bigint | no |
| payload_hash | text | no |
| applied_at | timestamptz | no |
| created_at | timestamptz | no |

Unique: (business_id, origin_event_ref).

Unique: (business_id, config_revision).

FK (business_id) → hospital_db.platform.businesses (id).

## Actual existing columns and primary keys (before migration)

### evolution-postgres / evogo_auth

| Schema.table | Column | Actual type | Nullable |
| --- | --- | --- | --- |
| public.poll_votes | id | character varying (varchar) | NO |
| public.poll_votes | company_id | character varying (varchar) | NO |
| public.poll_votes | instance_id | character varying (varchar) | NO |
| public.poll_votes | poll_message_id | character varying (varchar) | NO |
| public.poll_votes | poll_chat_jid | character varying (varchar) | NO |
| public.poll_votes | vote_message_id | character varying (varchar) | NO |
| public.poll_votes | voter_jid | character varying (varchar) | NO |
| public.poll_votes | voter_phone | character varying (varchar) | YES |
| public.poll_votes | voter_name | character varying (varchar) | YES |
| public.poll_votes | selected_options | ARRAY (_text) | NO |
| public.poll_votes | voted_at | timestamp without time zone (timestamp) | NO |
| public.poll_votes | received_at | timestamp without time zone (timestamp) | NO |
| public.whatsmeow_app_state_mutation_macs | jid | text (text) | NO |
| public.whatsmeow_app_state_mutation_macs | name | text (text) | NO |
| public.whatsmeow_app_state_mutation_macs | version | bigint (int8) | NO |
| public.whatsmeow_app_state_mutation_macs | index_mac | bytea (bytea) | NO |
| public.whatsmeow_app_state_mutation_macs | value_mac | bytea (bytea) | NO |
| public.whatsmeow_app_state_sync_keys | jid | text (text) | NO |
| public.whatsmeow_app_state_sync_keys | key_id | bytea (bytea) | NO |
| public.whatsmeow_app_state_sync_keys | key_data | bytea (bytea) | NO |
| public.whatsmeow_app_state_sync_keys | timestamp | bigint (int8) | NO |
| public.whatsmeow_app_state_sync_keys | fingerprint | bytea (bytea) | NO |
| public.whatsmeow_app_state_version | jid | text (text) | NO |
| public.whatsmeow_app_state_version | name | text (text) | NO |
| public.whatsmeow_app_state_version | version | bigint (int8) | NO |
| public.whatsmeow_app_state_version | hash | bytea (bytea) | NO |
| public.whatsmeow_chat_settings | our_jid | text (text) | NO |
| public.whatsmeow_chat_settings | chat_jid | text (text) | NO |
| public.whatsmeow_chat_settings | muted_until | bigint (int8) | NO |
| public.whatsmeow_chat_settings | pinned | boolean (bool) | NO |
| public.whatsmeow_chat_settings | archived | boolean (bool) | NO |
| public.whatsmeow_contacts | our_jid | text (text) | NO |
| public.whatsmeow_contacts | their_jid | text (text) | NO |
| public.whatsmeow_contacts | first_name | text (text) | YES |
| public.whatsmeow_contacts | full_name | text (text) | YES |
| public.whatsmeow_contacts | push_name | text (text) | YES |
| public.whatsmeow_contacts | business_name | text (text) | YES |
| public.whatsmeow_contacts | redacted_phone | text (text) | YES |
| public.whatsmeow_device | jid | text (text) | NO |
| public.whatsmeow_device | lid | text (text) | YES |
| public.whatsmeow_device | facebook_uuid | uuid (uuid) | YES |
| public.whatsmeow_device | registration_id | bigint (int8) | NO |
| public.whatsmeow_device | noise_key | bytea (bytea) | NO |
| public.whatsmeow_device | identity_key | bytea (bytea) | NO |
| public.whatsmeow_device | signed_pre_key | bytea (bytea) | NO |
| public.whatsmeow_device | signed_pre_key_id | integer (int4) | NO |
| public.whatsmeow_device | signed_pre_key_sig | bytea (bytea) | NO |
| public.whatsmeow_device | adv_key | bytea (bytea) | NO |
| public.whatsmeow_device | adv_details | bytea (bytea) | NO |
| public.whatsmeow_device | adv_account_sig | bytea (bytea) | NO |
| public.whatsmeow_device | adv_account_sig_key | bytea (bytea) | NO |
| public.whatsmeow_device | adv_device_sig | bytea (bytea) | NO |
| public.whatsmeow_device | platform | text (text) | NO |
| public.whatsmeow_device | business_name | text (text) | NO |
| public.whatsmeow_device | push_name | text (text) | NO |
| public.whatsmeow_device | lid_migration_ts | bigint (int8) | NO |
| public.whatsmeow_event_buffer | our_jid | text (text) | NO |
| public.whatsmeow_event_buffer | ciphertext_hash | bytea (bytea) | NO |
| public.whatsmeow_event_buffer | plaintext | bytea (bytea) | YES |
| public.whatsmeow_event_buffer | server_timestamp | bigint (int8) | NO |
| public.whatsmeow_event_buffer | insert_timestamp | bigint (int8) | NO |
| public.whatsmeow_identity_keys | our_jid | text (text) | NO |
| public.whatsmeow_identity_keys | their_id | text (text) | NO |
| public.whatsmeow_identity_keys | identity | bytea (bytea) | NO |
| public.whatsmeow_lid_map | lid | text (text) | NO |
| public.whatsmeow_lid_map | pn | text (text) | NO |
| public.whatsmeow_message_secrets | our_jid | text (text) | NO |
| public.whatsmeow_message_secrets | chat_jid | text (text) | NO |
| public.whatsmeow_message_secrets | sender_jid | text (text) | NO |
| public.whatsmeow_message_secrets | message_id | text (text) | NO |
| public.whatsmeow_message_secrets | key | bytea (bytea) | NO |
| public.whatsmeow_nct_salt | our_jid | text (text) | NO |
| public.whatsmeow_nct_salt | salt | bytea (bytea) | NO |
| public.whatsmeow_pre_keys | jid | text (text) | NO |
| public.whatsmeow_pre_keys | key_id | integer (int4) | NO |
| public.whatsmeow_pre_keys | key | bytea (bytea) | NO |
| public.whatsmeow_pre_keys | uploaded | boolean (bool) | NO |
| public.whatsmeow_privacy_tokens | our_jid | text (text) | NO |
| public.whatsmeow_privacy_tokens | their_jid | text (text) | NO |
| public.whatsmeow_privacy_tokens | token | bytea (bytea) | NO |
| public.whatsmeow_privacy_tokens | timestamp | bigint (int8) | NO |
| public.whatsmeow_privacy_tokens | sender_timestamp | bigint (int8) | YES |
| public.whatsmeow_retry_buffer | our_jid | text (text) | NO |
| public.whatsmeow_retry_buffer | chat_jid | text (text) | NO |
| public.whatsmeow_retry_buffer | message_id | text (text) | NO |
| public.whatsmeow_retry_buffer | format | text (text) | NO |
| public.whatsmeow_retry_buffer | plaintext | bytea (bytea) | NO |
| public.whatsmeow_retry_buffer | timestamp | bigint (int8) | NO |
| public.whatsmeow_sender_keys | our_jid | text (text) | NO |
| public.whatsmeow_sender_keys | chat_id | text (text) | NO |
| public.whatsmeow_sender_keys | sender_id | text (text) | NO |
| public.whatsmeow_sender_keys | sender_key | bytea (bytea) | NO |
| public.whatsmeow_sessions | our_jid | text (text) | NO |
| public.whatsmeow_sessions | their_id | text (text) | NO |
| public.whatsmeow_sessions | session | bytea (bytea) | YES |
| public.whatsmeow_version | version | integer (int4) | YES |
| public.whatsmeow_version | compat | integer (int4) | YES |

Primary keys:

- public.poll_votes: PRIMARY KEY (id).
- public.whatsmeow_app_state_mutation_macs: PRIMARY KEY (jid, name, version, index_mac).
- public.whatsmeow_app_state_sync_keys: PRIMARY KEY (jid, key_id).
- public.whatsmeow_app_state_version: PRIMARY KEY (jid, name).
- public.whatsmeow_chat_settings: PRIMARY KEY (our_jid, chat_jid).
- public.whatsmeow_contacts: PRIMARY KEY (our_jid, their_jid).
- public.whatsmeow_device: PRIMARY KEY (jid).
- public.whatsmeow_event_buffer: PRIMARY KEY (our_jid, ciphertext_hash).
- public.whatsmeow_identity_keys: PRIMARY KEY (our_jid, their_id).
- public.whatsmeow_lid_map: PRIMARY KEY (lid).
- public.whatsmeow_message_secrets: PRIMARY KEY (our_jid, chat_jid, sender_jid, message_id).
- public.whatsmeow_nct_salt: PRIMARY KEY (our_jid).
- public.whatsmeow_pre_keys: PRIMARY KEY (jid, key_id).
- public.whatsmeow_privacy_tokens: PRIMARY KEY (our_jid, their_jid).
- public.whatsmeow_retry_buffer: PRIMARY KEY (our_jid, chat_jid, message_id).
- public.whatsmeow_sender_keys: PRIMARY KEY (our_jid, chat_id, sender_id).
- public.whatsmeow_sessions: PRIMARY KEY (our_jid, their_id).

### evolution-postgres / evogo_users

| Schema.table | Column | Actual type | Nullable |
| --- | --- | --- | --- |
| public.instances | id | uuid (uuid) | NO |
| public.instances | name | text (text) | YES |
| public.instances | token | text (text) | YES |
| public.instances | webhook | text (text) | YES |
| public.instances | rabbitmq_enable | text (text) | YES |
| public.instances | web_socket_enable | text (text) | YES |
| public.instances | nats_enable | text (text) | YES |
| public.instances | jid | text (text) | YES |
| public.instances | qrcode | text (text) | YES |
| public.instances | connected | boolean (bool) | YES |
| public.instances | expiration | bigint (int8) | YES |
| public.instances | disconnect_reason | text (text) | YES |
| public.instances | events | text (text) | YES |
| public.instances | os_name | text (text) | YES |
| public.instances | proxy | text (text) | YES |
| public.instances | client_name | text (text) | YES |
| public.instances | created_at | timestamp with time zone (timestamptz) | YES |
| public.instances | always_online | boolean (bool) | YES |
| public.instances | reject_call | boolean (bool) | YES |
| public.instances | msg_reject_call | text (text) | YES |
| public.instances | read_messages | boolean (bool) | YES |
| public.instances | ignore_groups | boolean (bool) | YES |
| public.instances | ignore_status | boolean (bool) | YES |
| public.labels | id | uuid (uuid) | NO |
| public.labels | instance_id | uuid (uuid) | YES |
| public.labels | label_id | text (text) | YES |
| public.labels | label_name | text (text) | YES |
| public.labels | label_color | text (text) | YES |
| public.labels | predefined_id | text (text) | YES |
| public.messages | id | uuid (uuid) | NO |
| public.messages | message_id | text (text) | YES |
| public.messages | timestamp | text (text) | YES |
| public.messages | status | text (text) | YES |
| public.messages | source | text (text) | YES |
| public.messages | referral | jsonb (jsonb) | YES |
| public.runtime_configs | id | bigint (int8) | NO |
| public.runtime_configs | key | character varying (varchar) | NO |
| public.runtime_configs | value | text (text) | NO |
| public.runtime_configs | created_at | timestamp with time zone (timestamptz) | YES |
| public.runtime_configs | updated_at | timestamp with time zone (timestamptz) | YES |

Primary keys:

- public.instances: PRIMARY KEY (id).
- public.labels: PRIMARY KEY (id).
- public.messages: PRIMARY KEY (id).
- public.runtime_configs: PRIMARY KEY (id).

### evolution-postgres / postgres

| Schema.table | Column | Actual type | Nullable |
| --- | --- | --- | --- |
| public.appointments | event_id | character varying (varchar) | NO |
| public.appointments | customer_phone | character varying (varchar) | NO |
| public.appointments | push_name | character varying (varchar) | YES |
| public.appointments | booking_date | character varying (varchar) | NO |
| public.appointments | booking_time | character varying (varchar) | NO |
| public.appointments | status | character varying (varchar) | YES |
| public.appointments | summary | character varying (varchar) | YES |
| public.appointments | created_at | timestamp with time zone (timestamptz) | YES |
| public.chat_history | id | integer (int4) | NO |
| public.chat_history | session_id | character varying (varchar) | NO |
| public.chat_history | customer_phone | character varying (varchar) | NO |
| public.chat_history | push_name | character varying (varchar) | YES |
| public.chat_history | sender | character varying (varchar) | NO |
| public.chat_history | message_text | text (text) | NO |
| public.chat_history | created_at | timestamp with time zone (timestamptz) | YES |
| public.leads | customer_phone | character varying (varchar) | NO |
| public.leads | push_name | character varying (varchar) | YES |
| public.leads | city | character varying (varchar) | YES |
| public.leads | lead_stage | character varying (varchar) | YES |
| public.leads | intent | character varying (varchar) | YES |
| public.leads | last_message | text (text) | YES |
| public.leads | ai_reply | text (text) | YES |
| public.leads | booking_status | character varying (varchar) | YES |
| public.leads | booking_date | character varying (varchar) | YES |
| public.leads | booking_time | character varying (varchar) | YES |
| public.leads | created_at | timestamp with time zone (timestamptz) | YES |
| public.leads | updated_at | timestamp with time zone (timestamptz) | YES |

Primary keys:

- public.appointments: PRIMARY KEY (event_id).
- public.chat_history: PRIMARY KEY (id).
- public.leads: PRIMARY KEY (customer_phone).

### business-agent-dev-postgres-1 / agent_dev

No application base tables.

## Implementation gates

PostgreSQL 15 compatibility is required; pgvector is deliberately deferred to Phase 12. Phase 4 does not create student/results, orders, appointments or knowledge tables. Runtime roles cannot own tables, bypass RLS, do DDL, edit configuration, or update/delete audit. Tenant context is supplied by trusted service code; raw SQL access is not a public authentication interface. Real verifier storage, Board mapping and full application authorization remain later feature gates.
