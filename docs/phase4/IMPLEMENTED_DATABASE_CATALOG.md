# Phase 4 — actual implemented catalog

Captured: 2026-09-23T15:21:35.7297223Z. Actual PostgreSQL catalog metadata after migration; synthetic dev only. `app_meta.schema_migrations` is bookkeeping, excluded from the 16 foundational tables. Domain business/knowledge schemas are deferred until their feature phases.

## control_db

Version: 15.19. Schemas: app_meta, platform, public.

### platform.businesses

| Actual column | Actual type | Nullable | Default |
| --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() |
| code | text | NO | none |
| display_name | text | NO | none |
| domain | text | NO | none |
| timezone | text | NO | none |
| status | text | NO | none |
| config_version | integer | NO | none |
| created_at | timestamp with time zone | NO | now() |

- CHECK ((((length(code) >= 1) AND (length(code) <= 80)) AND ((length(display_name) >= 1) AND (length(display_name) <= 200))))
- UNIQUE (code)
- CHECK ((config_version > 0))
- CHECK ((domain = ANY (ARRAY['sales'::text, 'bise'::text, 'hospital'::text])))
- PRIMARY KEY (id)
- CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])))
- CHECK ((timezone = 'Asia/Karachi'::text))

### platform.instances

| Actual column | Actual type | Nullable | Default |
| --- | --- | --- | --- |
| business_id | uuid | NO | none |
| id | uuid | NO | gen_random_uuid() |
| provider | text | NO | none |
| external_instance_id | text | NO | none |
| credential_ref | text | NO | none |
| status | text | NO | none |
| created_at | timestamp with time zone | NO | now() |

- FOREIGN KEY (business_id) REFERENCES platform.businesses(id) ON DELETE RESTRICT
- CHECK ((((length(provider) >= 1) AND (length(provider) <= 80)) AND ((length(external_instance_id) >= 1) AND (length(external_instance_id) <= 200))))
- PRIMARY KEY (business_id, id)
- UNIQUE (provider, external_instance_id)
- CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])))

### platform.audit_events

| Actual column | Actual type | Nullable | Default |
| --- | --- | --- | --- |
| business_id | uuid | NO | none |
| id | uuid | NO | gen_random_uuid() |
| request_ref | text | YES | none |
| actor_ref | text | NO | none |
| event_type | text | NO | none |
| resource_ref | text | YES | none |
| outcome | text | NO | none |
| details | jsonb | NO | none |
| created_at | timestamp with time zone | NO | now() |

- FOREIGN KEY (business_id) REFERENCES platform.businesses(id) ON DELETE RESTRICT
- CHECK ((((length(actor_ref) >= 1) AND (length(actor_ref) <= 128)) AND ((length(event_type) >= 1) AND (length(event_type) <= 80))))
- CHECK (((jsonb_typeof(details) = 'object'::text) AND (octet_length((details)::text) <= 2048) AND ((details - ARRAY['reason_code'::text, 'config_revision'::text, 'correlation_ref'::text]) = '{}'::jsonb)))
- CHECK ((outcome = ANY (ARRAY['success'::text, 'denied'::text, 'failure'::text])))
- PRIMARY KEY (business_id, id)

### platform.configuration_outbox

| Actual column | Actual type | Nullable | Default |
| --- | --- | --- | --- |
| business_id | uuid | NO | none |
| id | uuid | NO | gen_random_uuid() |
| config_revision | bigint | NO | none |
| event_type | text | NO | none |
| payload | jsonb | NO | none |
| payload_hash | text | NO | none |
| status | text | NO | none |
| attempts | integer | NO | none |
| next_attempt_at | timestamp with time zone | YES | none |
| lease_until | timestamp with time zone | YES | none |
| created_at | timestamp with time zone | NO | now() |

- CHECK ((attempts >= 0))
- UNIQUE (business_id, config_revision)
- FOREIGN KEY (business_id) REFERENCES platform.businesses(id) ON DELETE RESTRICT
- CHECK ((config_revision > 0))
- CHECK (((jsonb_typeof(payload) = 'object'::text) AND (octet_length((payload)::text) <= 16384)))
- CHECK ((payload_hash ~ '^[0-9a-f]{64}$'::text))
- PRIMARY KEY (business_id, id)
- CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'delivered'::text, 'retry_wait'::text, 'failed'::text])))

## pos_db

Version: 15.19. Schemas: app_meta, platform, public.

### platform.businesses

| Actual column | Actual type | Nullable | Default |
| --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() |
| code | text | NO | none |
| display_name | text | NO | none |
| domain | text | NO | none |
| timezone | text | NO | none |
| status | text | NO | none |
| config_version | integer | NO | none |
| created_at | timestamp with time zone | NO | now() |
| config_revision | bigint | NO | none |
| valid_until | timestamp with time zone | NO | none |

- CHECK ((((length(code) >= 1) AND (length(code) <= 80)) AND ((length(display_name) >= 1) AND (length(display_name) <= 200))))
- CHECK ((valid_until > created_at))
- CHECK ((config_revision = config_version))
- UNIQUE (code)
- CHECK ((config_revision > 0))
- CHECK ((config_version > 0))
- CHECK ((domain = 'sales'::text))
- PRIMARY KEY (id)
- CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])))
- CHECK ((timezone = 'Asia/Karachi'::text))

### platform.instances

| Actual column | Actual type | Nullable | Default |
| --- | --- | --- | --- |
| business_id | uuid | NO | none |
| id | uuid | NO | gen_random_uuid() |
| provider | text | NO | none |
| external_instance_id | text | NO | none |
| status | text | NO | none |
| created_at | timestamp with time zone | NO | now() |
| config_revision | bigint | NO | none |
| valid_until | timestamp with time zone | NO | none |

- FOREIGN KEY (business_id) REFERENCES platform.businesses(id) ON DELETE RESTRICT
- CHECK ((valid_until > created_at))
- CHECK ((((length(provider) >= 1) AND (length(provider) <= 80)) AND ((length(external_instance_id) >= 1) AND (length(external_instance_id) <= 200))))
- CHECK ((config_revision > 0))
- PRIMARY KEY (business_id, id)
- UNIQUE (provider, external_instance_id)
- CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])))

### platform.audit_events

| Actual column | Actual type | Nullable | Default |
| --- | --- | --- | --- |
| business_id | uuid | NO | none |
| id | uuid | NO | gen_random_uuid() |
| request_ref | text | YES | none |
| actor_ref | text | NO | none |
| event_type | text | NO | none |
| resource_ref | text | YES | none |
| outcome | text | NO | none |
| details | jsonb | NO | none |
| created_at | timestamp with time zone | NO | now() |

- FOREIGN KEY (business_id) REFERENCES platform.businesses(id) ON DELETE RESTRICT
- CHECK ((((length(actor_ref) >= 1) AND (length(actor_ref) <= 128)) AND ((length(event_type) >= 1) AND (length(event_type) <= 80))))
- CHECK (((jsonb_typeof(details) = 'object'::text) AND (octet_length((details)::text) <= 2048) AND ((details - ARRAY['reason_code'::text, 'config_revision'::text, 'correlation_ref'::text]) = '{}'::jsonb)))
- CHECK ((outcome = ANY (ARRAY['success'::text, 'denied'::text, 'failure'::text])))
- PRIMARY KEY (business_id, id)

### platform.configuration_inbox

| Actual column | Actual type | Nullable | Default |
| --- | --- | --- | --- |
| business_id | uuid | NO | none |
| id | uuid | NO | gen_random_uuid() |
| origin_event_ref | uuid | NO | none |
| config_revision | bigint | NO | none |
| payload_hash | text | NO | none |
| applied_at | timestamp with time zone | NO | none |
| created_at | timestamp with time zone | NO | now() |

- UNIQUE (business_id, config_revision)
- FOREIGN KEY (business_id) REFERENCES platform.businesses(id) ON DELETE RESTRICT
- UNIQUE (business_id, origin_event_ref)
- CHECK ((config_revision > 0))
- CHECK ((payload_hash ~ '^[0-9a-f]{64}$'::text))
- PRIMARY KEY (business_id, id)

## bise_db

Version: 15.19. Schemas: app_meta, platform, public.

### platform.businesses

| Actual column | Actual type | Nullable | Default |
| --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() |
| code | text | NO | none |
| display_name | text | NO | none |
| domain | text | NO | none |
| timezone | text | NO | none |
| status | text | NO | none |
| config_version | integer | NO | none |
| created_at | timestamp with time zone | NO | now() |
| config_revision | bigint | NO | none |
| valid_until | timestamp with time zone | NO | none |

- CHECK ((((length(code) >= 1) AND (length(code) <= 80)) AND ((length(display_name) >= 1) AND (length(display_name) <= 200))))
- CHECK ((valid_until > created_at))
- CHECK ((config_revision = config_version))
- UNIQUE (code)
- CHECK ((config_revision > 0))
- CHECK ((config_version > 0))
- CHECK ((domain = 'bise'::text))
- PRIMARY KEY (id)
- CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])))
- CHECK ((timezone = 'Asia/Karachi'::text))

### platform.instances

| Actual column | Actual type | Nullable | Default |
| --- | --- | --- | --- |
| business_id | uuid | NO | none |
| id | uuid | NO | gen_random_uuid() |
| provider | text | NO | none |
| external_instance_id | text | NO | none |
| status | text | NO | none |
| created_at | timestamp with time zone | NO | now() |
| config_revision | bigint | NO | none |
| valid_until | timestamp with time zone | NO | none |

- FOREIGN KEY (business_id) REFERENCES platform.businesses(id) ON DELETE RESTRICT
- CHECK ((valid_until > created_at))
- CHECK ((((length(provider) >= 1) AND (length(provider) <= 80)) AND ((length(external_instance_id) >= 1) AND (length(external_instance_id) <= 200))))
- CHECK ((config_revision > 0))
- PRIMARY KEY (business_id, id)
- UNIQUE (provider, external_instance_id)
- CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])))

### platform.audit_events

| Actual column | Actual type | Nullable | Default |
| --- | --- | --- | --- |
| business_id | uuid | NO | none |
| id | uuid | NO | gen_random_uuid() |
| request_ref | text | YES | none |
| actor_ref | text | NO | none |
| event_type | text | NO | none |
| resource_ref | text | YES | none |
| outcome | text | NO | none |
| details | jsonb | NO | none |
| created_at | timestamp with time zone | NO | now() |

- FOREIGN KEY (business_id) REFERENCES platform.businesses(id) ON DELETE RESTRICT
- CHECK ((((length(actor_ref) >= 1) AND (length(actor_ref) <= 128)) AND ((length(event_type) >= 1) AND (length(event_type) <= 80))))
- CHECK (((jsonb_typeof(details) = 'object'::text) AND (octet_length((details)::text) <= 2048) AND ((details - ARRAY['reason_code'::text, 'config_revision'::text, 'correlation_ref'::text]) = '{}'::jsonb)))
- CHECK ((outcome = ANY (ARRAY['success'::text, 'denied'::text, 'failure'::text])))
- PRIMARY KEY (business_id, id)

### platform.configuration_inbox

| Actual column | Actual type | Nullable | Default |
| --- | --- | --- | --- |
| business_id | uuid | NO | none |
| id | uuid | NO | gen_random_uuid() |
| origin_event_ref | uuid | NO | none |
| config_revision | bigint | NO | none |
| payload_hash | text | NO | none |
| applied_at | timestamp with time zone | NO | none |
| created_at | timestamp with time zone | NO | now() |

- UNIQUE (business_id, config_revision)
- FOREIGN KEY (business_id) REFERENCES platform.businesses(id) ON DELETE RESTRICT
- UNIQUE (business_id, origin_event_ref)
- CHECK ((config_revision > 0))
- CHECK ((payload_hash ~ '^[0-9a-f]{64}$'::text))
- PRIMARY KEY (business_id, id)

## hospital_db

Version: 15.19. Schemas: app_meta, platform, public.

### platform.businesses

| Actual column | Actual type | Nullable | Default |
| --- | --- | --- | --- |
| id | uuid | NO | gen_random_uuid() |
| code | text | NO | none |
| display_name | text | NO | none |
| domain | text | NO | none |
| timezone | text | NO | none |
| status | text | NO | none |
| config_version | integer | NO | none |
| created_at | timestamp with time zone | NO | now() |
| config_revision | bigint | NO | none |
| valid_until | timestamp with time zone | NO | none |

- CHECK ((((length(code) >= 1) AND (length(code) <= 80)) AND ((length(display_name) >= 1) AND (length(display_name) <= 200))))
- CHECK ((valid_until > created_at))
- CHECK ((config_revision = config_version))
- UNIQUE (code)
- CHECK ((config_revision > 0))
- CHECK ((config_version > 0))
- CHECK ((domain = 'hospital'::text))
- PRIMARY KEY (id)
- CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])))
- CHECK ((timezone = 'Asia/Karachi'::text))

### platform.instances

| Actual column | Actual type | Nullable | Default |
| --- | --- | --- | --- |
| business_id | uuid | NO | none |
| id | uuid | NO | gen_random_uuid() |
| provider | text | NO | none |
| external_instance_id | text | NO | none |
| status | text | NO | none |
| created_at | timestamp with time zone | NO | now() |
| config_revision | bigint | NO | none |
| valid_until | timestamp with time zone | NO | none |

- FOREIGN KEY (business_id) REFERENCES platform.businesses(id) ON DELETE RESTRICT
- CHECK ((valid_until > created_at))
- CHECK ((((length(provider) >= 1) AND (length(provider) <= 80)) AND ((length(external_instance_id) >= 1) AND (length(external_instance_id) <= 200))))
- CHECK ((config_revision > 0))
- PRIMARY KEY (business_id, id)
- UNIQUE (provider, external_instance_id)
- CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])))

### platform.audit_events

| Actual column | Actual type | Nullable | Default |
| --- | --- | --- | --- |
| business_id | uuid | NO | none |
| id | uuid | NO | gen_random_uuid() |
| request_ref | text | YES | none |
| actor_ref | text | NO | none |
| event_type | text | NO | none |
| resource_ref | text | YES | none |
| outcome | text | NO | none |
| details | jsonb | NO | none |
| created_at | timestamp with time zone | NO | now() |

- FOREIGN KEY (business_id) REFERENCES platform.businesses(id) ON DELETE RESTRICT
- CHECK ((((length(actor_ref) >= 1) AND (length(actor_ref) <= 128)) AND ((length(event_type) >= 1) AND (length(event_type) <= 80))))
- CHECK (((jsonb_typeof(details) = 'object'::text) AND (octet_length((details)::text) <= 2048) AND ((details - ARRAY['reason_code'::text, 'config_revision'::text, 'correlation_ref'::text]) = '{}'::jsonb)))
- CHECK ((outcome = ANY (ARRAY['success'::text, 'denied'::text, 'failure'::text])))
- PRIMARY KEY (business_id, id)

### platform.configuration_inbox

| Actual column | Actual type | Nullable | Default |
| --- | --- | --- | --- |
| business_id | uuid | NO | none |
| id | uuid | NO | gen_random_uuid() |
| origin_event_ref | uuid | NO | none |
| config_revision | bigint | NO | none |
| payload_hash | text | NO | none |
| applied_at | timestamp with time zone | NO | none |
| created_at | timestamp with time zone | NO | now() |

- UNIQUE (business_id, config_revision)
- FOREIGN KEY (business_id) REFERENCES platform.businesses(id) ON DELETE RESTRICT
- UNIQUE (business_id, origin_event_ref)
- CHECK ((config_revision > 0))
- CHECK ((payload_hash ~ '^[0-9a-f]{64}$'::text))
- PRIMARY KEY (business_id, id)

