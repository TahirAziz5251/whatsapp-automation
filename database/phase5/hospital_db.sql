-- Phase 5 hospital_db: run as hospital_owner inside one transaction.
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
GRANT SELECT ON platform.contacts TO hospital_runtime;
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
GRANT SELECT ON platform.channel_identities TO hospital_runtime;
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

GRANT EXECUTE ON FUNCTION platform.ensure_contact(uuid,text,text,text) TO hospital_runtime;
