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
