-- Phase 4 foundational schema for control_db; migration runner wraps this in one transaction.
CREATE SCHEMA platform AUTHORIZATION control_owner;
CREATE SCHEMA app_meta AUTHORIZATION control_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA platform, app_meta FROM PUBLIC;
GRANT USAGE ON SCHEMA platform TO control_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE control_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE control_owner REVOKE ALL ON TABLES FROM PUBLIC;
CREATE TABLE app_meta.schema_migrations(version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE platform.businesses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  display_name text NOT NULL,
  domain text NOT NULL,
  timezone text NOT NULL,
  status text NOT NULL,
  config_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (code),
  CHECK (domain IN ('sales','bise','hospital')),
  CHECK (config_version > 0),
  CHECK (length(code) BETWEEN 1 AND 80 AND length(display_name) BETWEEN 1 AND 200),
  CHECK (timezone = 'Asia/Karachi'),
  CHECK (status IN ('active','disabled'))
);
ALTER TABLE platform.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.businesses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON platform.businesses USING (id = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK (id = nullif(current_setting('app.business_id', true), '')::uuid);

CREATE TABLE platform.instances (
  business_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  external_instance_id text NOT NULL,
  credential_ref text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, id),
  UNIQUE (provider, external_instance_id),
  FOREIGN KEY (business_id) REFERENCES platform.businesses (id) ON DELETE RESTRICT,
  CHECK (status IN ('active','disabled')),
  CHECK (length(provider) BETWEEN 1 AND 80 AND length(external_instance_id) BETWEEN 1 AND 200)
);
ALTER TABLE platform.instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.instances FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON platform.instances USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid);

CREATE TABLE platform.audit_events (
  business_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  request_ref text,
  actor_ref text NOT NULL,
  event_type text NOT NULL,
  resource_ref text,
  outcome text NOT NULL,
  details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, id),
  FOREIGN KEY (business_id) REFERENCES platform.businesses (id) ON DELETE RESTRICT,
  CHECK (outcome IN ('success','denied','failure')),
  CHECK (length(actor_ref) BETWEEN 1 AND 128 AND length(event_type) BETWEEN 1 AND 80),
  CHECK (jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 2048 AND details - ARRAY['reason_code','config_revision','correlation_ref']::text[] = '{}'::jsonb)
);
CREATE INDEX audit_events_lookup_0 ON platform.audit_events (business_id, created_at, id);
ALTER TABLE platform.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON platform.audit_events USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid);

CREATE TABLE platform.configuration_outbox (
  business_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  config_revision bigint NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL,
  attempts integer NOT NULL,
  next_attempt_at timestamptz,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, id),
  UNIQUE (business_id, config_revision),
  FOREIGN KEY (business_id) REFERENCES platform.businesses (id) ON DELETE RESTRICT,
  CHECK (config_revision > 0),
  CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 16384),
  CHECK (attempts >= 0),
  CHECK (status IN ('pending','sending','delivered','retry_wait','failed'))
);
ALTER TABLE platform.configuration_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.configuration_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON platform.configuration_outbox USING (business_id = nullif(current_setting('app.business_id', true), '')::uuid) WITH CHECK (business_id = nullif(current_setting('app.business_id', true), '')::uuid);

GRANT SELECT ON platform.businesses, platform.instances TO control_runtime;
GRANT SELECT, INSERT ON platform.audit_events TO control_runtime;
