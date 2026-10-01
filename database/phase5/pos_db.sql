-- Phase 5 pos_db: run as pos_owner inside one transaction.
CREATE SCHEMA crm AUTHORIZATION pos_owner; REVOKE ALL ON SCHEMA crm FROM PUBLIC; GRANT USAGE ON SCHEMA crm TO pos_runtime;
CREATE TABLE platform.contacts (
 business_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 display_name text,
 status text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id,id),
 FOREIGN KEY (business_id) REFERENCES platform.businesses (id) ON DELETE RESTRICT,
 CHECK (status IN ('active','inactive','blocked')),
 CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 200)
);
ALTER TABLE platform.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON platform.contacts USING (business_id=nullif(current_setting('app.business_id',true),'')::uuid) WITH CHECK (business_id=nullif(current_setting('app.business_id',true),'')::uuid);
GRANT SELECT ON platform.contacts TO pos_runtime;
CREATE TABLE platform.channel_identities (
 business_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 instance_id uuid NOT NULL,
 contact_id uuid NOT NULL,
 jid text NOT NULL,
 address_kind text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id,id),
 UNIQUE (business_id,instance_id,jid),
 FOREIGN KEY (business_id) REFERENCES platform.businesses (id) ON DELETE RESTRICT,
 FOREIGN KEY (business_id,instance_id) REFERENCES platform.instances (business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY (business_id,contact_id) REFERENCES platform.contacts (business_id,id) ON DELETE RESTRICT,
 CHECK (length(jid) BETWEEN 1 AND 200 AND jid=btrim(jid)),
 CHECK (address_kind IN ('individual','lid','synthetic'))
);
ALTER TABLE platform.channel_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.channel_identities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON platform.channel_identities USING (business_id=nullif(current_setting('app.business_id',true),'')::uuid) WITH CHECK (business_id=nullif(current_setting('app.business_id',true),'')::uuid);
GRANT SELECT ON platform.channel_identities TO pos_runtime;
CREATE TABLE crm.leads (
 business_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 contact_id uuid NOT NULL,
 stage text NOT NULL,
 notes text,
 version integer NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id,id),
 UNIQUE (business_id,contact_id),
 FOREIGN KEY (business_id) REFERENCES platform.businesses (id) ON DELETE RESTRICT,
 FOREIGN KEY (business_id,contact_id) REFERENCES platform.contacts (business_id,id) ON DELETE RESTRICT,
 CHECK (stage IN ('new','contacted','qualified','won','lost')),
 CHECK (version>0),
 CHECK (notes IS NULL OR length(notes)<=2000)
);
ALTER TABLE crm.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.leads FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON crm.leads USING (business_id=nullif(current_setting('app.business_id',true),'')::uuid) WITH CHECK (business_id=nullif(current_setting('app.business_id',true),'')::uuid);
GRANT SELECT ON crm.leads TO pos_runtime;
CREATE TABLE crm.lead_events (
 business_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 lead_id uuid NOT NULL,
 source_event_key text NOT NULL,
 from_stage text,
 to_stage text NOT NULL,
 actor_ref text NOT NULL,
 expected_version integer NOT NULL,
 result_version integer NOT NULL,
 payload_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (business_id,id),
 UNIQUE (business_id,source_event_key),
 FOREIGN KEY (business_id) REFERENCES platform.businesses (id) ON DELETE RESTRICT,
 FOREIGN KEY (business_id,lead_id) REFERENCES crm.leads (business_id,id) ON DELETE RESTRICT,
 CHECK (to_stage IN ('new','contacted','qualified','won','lost')),
 CHECK (from_stage IS NULL OR from_stage IN ('new','contacted','qualified','won','lost')),
 CHECK (expected_version>=0 AND result_version=expected_version+1),
 CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
 CHECK (length(source_event_key) BETWEEN 1 AND 160 AND length(actor_ref) BETWEEN 1 AND 128)
);
ALTER TABLE crm.lead_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lead_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON crm.lead_events USING (business_id=nullif(current_setting('app.business_id',true),'')::uuid) WITH CHECK (business_id=nullif(current_setting('app.business_id',true),'')::uuid);
GRANT SELECT ON crm.lead_events TO pos_runtime;
CREATE INDEX lead_events_lookup_0 ON crm.lead_events(business_id,lead_id,created_at);
-- Owner is NOLOGIN and all affected tables FORCE RLS. Caller supplies trusted service context.
CREATE FUNCTION platform.ensure_contact(p_instance uuid,p_jid text,p_kind text,p_display_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b uuid:=nullif(current_setting('app.business_id',true),'')::uuid;
 actor text:=nullif(current_setting('app.actor_ref',true),''); found_id uuid; found_status text;
BEGIN
 IF b IS NULL OR actor IS NULL OR length(actor)>128 THEN RAISE EXCEPTION 'Missing trusted context' USING ERRCODE='42501'; END IF;
 IF p_jid IS NULL OR length(p_jid) NOT BETWEEN 1 AND 200 OR p_jid<>btrim(p_jid) OR p_kind IS NULL OR p_kind NOT IN ('individual','lid','synthetic') OR length(p_display_name)>200 THEN RAISE EXCEPTION 'Invalid contact input' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM platform.businesses WHERE id=b AND status='active' AND valid_until>now()) OR NOT EXISTS(SELECT 1 FROM platform.instances WHERE business_id=b AND id=p_instance AND status='active' AND valid_until>now()) THEN RAISE EXCEPTION 'Unavailable authorized routing' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(b::text||':'||p_instance::text||':'||p_jid,5));
 SELECT c.id,c.status INTO found_id,found_status FROM platform.channel_identities i JOIN platform.contacts c ON c.business_id=i.business_id AND c.id=i.contact_id WHERE i.business_id=b AND i.instance_id=p_instance AND i.jid=p_jid;
 IF FOUND THEN
  IF found_status<>'active' THEN RAISE EXCEPTION 'Contact not active' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM platform.channel_identities WHERE business_id=b AND instance_id=p_instance AND jid=p_jid AND address_kind=p_kind) THEN RAISE EXCEPTION 'Identity kind conflict' USING ERRCODE='22023'; END IF;
  RETURN found_id; -- Incoming display name cannot silently overwrite an established profile.
 END IF;
 INSERT INTO platform.contacts(business_id,display_name,status) VALUES(b,nullif(btrim(p_display_name),''),'active') RETURNING id INTO found_id;
 INSERT INTO platform.channel_identities(business_id,instance_id,contact_id,jid,address_kind) VALUES(b,p_instance,found_id,p_jid,p_kind);
 INSERT INTO platform.audit_events(business_id,actor_ref,event_type,resource_ref,outcome,details) VALUES(b,actor,'contact.created',found_id::text,'success','{}');
 RETURN found_id;
END $$;
REVOKE ALL ON FUNCTION platform.ensure_contact(uuid,text,text,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION platform.ensure_contact(uuid,text,text,text) TO pos_runtime;
CREATE FUNCTION crm.apply_lead_event(p_contact uuid,p_key text,p_stage text,p_expected integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b uuid:=nullif(current_setting('app.business_id',true),'')::uuid;
 actor text:=nullif(current_setting('app.actor_ref',true),''); h text; prior crm.lead_events%ROWTYPE; lead crm.leads%ROWTYPE; old_stage text; next_version integer;
BEGIN
 IF b IS NULL OR actor IS NULL OR length(actor)>128 THEN RAISE EXCEPTION 'Missing trusted context' USING ERRCODE='42501'; END IF;
 IF p_contact IS NULL OR p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 160 OR p_expected IS NULL OR p_expected<0 OR p_stage IS NULL OR p_stage NOT IN ('new','contacted','qualified','won','lost') THEN RAISE EXCEPTION 'Invalid command' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM platform.businesses WHERE id=b AND status='active' AND valid_until>now()) OR NOT EXISTS(SELECT 1 FROM platform.contacts WHERE business_id=b AND id=p_contact AND status='active') THEN RAISE EXCEPTION 'Contact unavailable' USING ERRCODE='42501'; END IF;
 h:=encode(sha256(convert_to(jsonb_build_object('business',b,'contact',p_contact,'actor',actor,'stage',p_stage,'expected',p_expected)::text,'UTF8')),'hex');
 -- Always key lock then contact lock: duplicate commands and simultaneous lead creation serialize.
 PERFORM pg_advisory_xact_lock(hashtextextended(b::text||':event:'||p_key,5));
 SELECT * INTO prior FROM crm.lead_events WHERE business_id=b AND source_event_key=p_key;
 IF FOUND THEN
  IF prior.payload_hash<>h THEN RAISE EXCEPTION 'Idempotency conflict' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('lead_id',prior.lead_id,'stage',prior.to_stage,'version',prior.result_version,'replayed',true);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(b::text||':contact:'||p_contact::text,5));
 SELECT * INTO lead FROM crm.leads WHERE business_id=b AND contact_id=p_contact FOR UPDATE;
 IF NOT FOUND THEN
  IF p_stage<>'new' OR p_expected<>0 THEN RAISE EXCEPTION 'Lead must start new at version zero' USING ERRCODE='22023'; END IF;
  old_stage:=NULL;next_version:=1;
  INSERT INTO crm.leads(business_id,contact_id,stage,version) VALUES(b,p_contact,'new',1) RETURNING * INTO lead;
 ELSE
  IF lead.version<>p_expected THEN RAISE EXCEPTION 'Stale lead version' USING ERRCODE='40001'; END IF;
  IF NOT ((lead.stage='new' AND p_stage IN ('contacted','qualified','lost')) OR (lead.stage='contacted' AND p_stage IN ('qualified','lost')) OR (lead.stage='qualified' AND p_stage IN ('won','lost'))) THEN RAISE EXCEPTION 'Invalid stage transition' USING ERRCODE='22023'; END IF;
  old_stage:=lead.stage;next_version:=lead.version+1;
  UPDATE crm.leads SET stage=p_stage,version=next_version,updated_at=now() WHERE business_id=b AND id=lead.id;
 END IF;
 INSERT INTO crm.lead_events(business_id,lead_id,source_event_key,from_stage,to_stage,actor_ref,expected_version,result_version,payload_hash) VALUES(b,lead.id,p_key,old_stage,p_stage,actor,p_expected,next_version,h);
 INSERT INTO platform.audit_events(business_id,actor_ref,event_type,resource_ref,outcome,details) VALUES(b,actor,'crm.lead_transition',lead.id::text,'success','{}');
 RETURN jsonb_build_object('lead_id',lead.id,'stage',p_stage,'version',next_version,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION crm.apply_lead_event(uuid,text,text,integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION crm.apply_lead_event(uuid,text,text,integer) TO pos_runtime;
