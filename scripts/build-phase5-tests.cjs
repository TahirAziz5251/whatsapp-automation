const fs=require('node:fs'),path=require('node:path');const dir=path.resolve(__dirname,'../database/phase5');const fixtures=JSON.parse(fs.readFileSync(path.join(dir,'fixtures.json')));
const checks=[];
for(const db of ['pos_db','bise_db','hospital_db']){
 const f=fixtures.filter(f=>f.db===db),a=f[0],b=f[3],blocked=f[2],prefix=db.replace('_db','');let sql='BEGIN;\n';
 function test(name,body){checks.push({database:db,name});sql+=`DO $test$ DECLARE c uuid; r jsonb; n bigint; BEGIN ${body} RAISE NOTICE 'P5PASS|${name}'; END $test$;\n`;}
 const assert=expr=>`IF (${expr}) IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Assertion failed'; END IF;`;
 const deny=(stmt,state)=>`BEGIN ${stmt}; RAISE EXCEPTION 'Expected rejection'; EXCEPTION WHEN SQLSTATE '${state}' THEN NULL; END;`;
 const ensure=(inst,jid,name='Test Contact')=>`platform.ensure_contact('${inst}','${jid}','synthetic','${name}')`;
 test('missing_context_hides_contacts',assert('(SELECT count(*)=0 FROM platform.contacts)'));
 test('missing_context_cannot_create',deny(`PERFORM ${ensure(a.instance,'phase5-test@example.invalid')}`,'42501'));
 sql+=`SET LOCAL app.business_id='${a.business}';\n`;
 test('actor_required',deny(`PERFORM ${ensure(a.instance,'phase5-test@example.invalid')}`,'42501'));
 sql+="SET LOCAL app.actor_ref='phase5_test_actor';\n";
 test('three_contacts_only_in_authorized_business',assert(`(SELECT count(*)=3 AND bool_and(business_id='${a.business}') FROM platform.contacts)`));
 test('other_business_profile_hidden',assert(`NOT EXISTS(SELECT 1 FROM platform.contacts WHERE id='${b.contact}')`));
 test('other_business_instance_rejected',deny(`PERFORM ${ensure(b.instance,'phase5-test@example.invalid')}`,'42501'));
 test('blocked_contact_rejected',deny(`PERFORM ${ensure(a.instance,blocked.jid)}`,'42501'));
 test('invalid_identity_kind_rejected',deny(`PERFORM platform.ensure_contact('${a.instance}','bad@example.invalid','invalid','Test')`,'22023'));
 test('contact_create_replay_audit_and_profile_preservation',`SELECT count(*) INTO n FROM platform.audit_events; c:=${ensure(a.instance,'phase5-new@example.invalid','Original Synthetic Name')}; ${assert(`c=${ensure(a.instance,'phase5-new@example.invalid','Untrusted Changed Name')}`)} ${assert("(SELECT display_name='Original Synthetic Name' FROM platform.contacts WHERE id=c)")} ${assert('(SELECT count(*)=n+1 FROM platform.audit_events)')} ${assert("(SELECT count(*)=1 FROM platform.channel_identities WHERE jid='phase5-new@example.invalid')")}`);
 test('shared_identity_does_not_merge_businesses',assert(`${ensure(a.instance,a.jid)}='${a.contact}'::uuid`));
 sql+=`SET LOCAL app.business_id='${b.business}';\n`;
 test('same_identity_in_business_B_stays_separate',assert(`${ensure(b.instance,b.jid)}='${b.contact}'::uuid`)+assert(`NOT EXISTS(SELECT 1 FROM platform.contacts WHERE id='${a.contact}')`));
 sql+=`SET LOCAL app.business_id='${a.business}';\n`;
 test('direct_contact_insert_denied',deny(`INSERT INTO platform.contacts(business_id,display_name,status) VALUES('${a.business}','Test','active')`,'42501'));
 test('direct_contact_update_denied',deny("UPDATE platform.contacts SET display_name='Forged'",'42501'));
 test('direct_contact_delete_denied',deny('DELETE FROM platform.contacts','42501'));
 test('direct_identity_rebinding_denied',deny(`UPDATE platform.channel_identities SET contact_id='${b.contact}'`,'42501'));
 test('runtime_cannot_assume_owner',deny(`EXECUTE 'SET ROLE ${prefix}_owner'`,'42501'));
 test('functions_have_fixed_path_and_no_public_execute',assert(`NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname IN ('platform','crm') AND (NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) ac WHERE ac.grantee=0 AND ac.privilege_type='EXECUTE')))`));
 if(db==='pos_db'){
  test('two_seed_leads_visible_and_progressed_stage_preserved',assert(`(SELECT count(*)=2 FROM crm.leads)`)+assert(`(SELECT stage='qualified' AND version=3 FROM crm.leads WHERE contact_id='${a.contact}')`));
  test('cross_tenant_lead_command_denied',deny(`PERFORM crm.apply_lead_event('${b.contact}','cross','new',0)`,'42501'));
  test('blocked_contact_cannot_create_lead',deny(`PERFORM crm.apply_lead_event('${blocked.contact}','blocked','new',0)`,'42501'));
  test('lead_create_advance_replay_returns_original_outcome',`c:=${ensure(a.instance,'phase5-new@example.invalid')}; r:=crm.apply_lead_event(c,'p5-new','new',0); ${assert("r->>'version'='1' AND r->>'replayed'='false'")} PERFORM crm.apply_lead_event(c,'p5-contacted','contacted',1); PERFORM crm.apply_lead_event(c,'p5-qualified','qualified',2); r:=crm.apply_lead_event(c,'p5-new','new',0); ${assert("r->>'version'='1' AND r->>'stage'='new' AND r->>'replayed'='true'")} ${assert("(SELECT stage='qualified' AND version=3 FROM crm.leads WHERE contact_id=c)")} ${assert("(SELECT count(*)=3 FROM crm.lead_events WHERE lead_id=(r->>'lead_id')::uuid)")} ${assert("(SELECT count(*)=3 FROM platform.audit_events WHERE event_type='crm.lead_transition' AND resource_ref=r->>'lead_id')")}`);
  test('same_event_key_changed_payload_rejected',`c:=${ensure(a.instance,'phase5-new@example.invalid')}; `+deny("PERFORM crm.apply_lead_event(c,'p5-new','lost',0)",'22023'));
  test('stale_expected_version_rejected',`c:=${ensure(a.instance,'phase5-new@example.invalid')}; `+deny("PERFORM crm.apply_lead_event(c,'p5-stale','won',2)",'40001'));
  test('general_inquiry_cannot_reset_progressed_lead',`c:=${ensure(a.instance,'phase5-new@example.invalid')}; `+deny("PERFORM crm.apply_lead_event(c,'p5-reset','new',3)",'22023'));
  test('changed_actor_cannot_replay_event',`c:=${ensure(a.instance,'phase5-new@example.invalid')}; PERFORM set_config('app.actor_ref','changed_actor',true); `+deny("PERFORM crm.apply_lead_event(c,'p5-new','new',0)",'22023')+" PERFORM set_config('app.actor_ref','phase5_test_actor',true);");
  test('failed_outer_operation_rolls_back_lead_event_and_audit',`c:=${ensure(a.instance,'phase5-rollback@example.invalid')}; SELECT count(*) INTO n FROM platform.audit_events; BEGIN PERFORM crm.apply_lead_event(c,'p5-rollback','new',0); PERFORM 1/0; EXCEPTION WHEN division_by_zero THEN NULL; END; ${assert('NOT EXISTS(SELECT 1 FROM crm.leads WHERE contact_id=c)')} ${assert("NOT EXISTS(SELECT 1 FROM crm.lead_events WHERE source_event_key='p5-rollback')")} ${assert('(SELECT count(*)=n FROM platform.audit_events)')}`);
  for(const [name,stmt]of [['raw_lead_update_denied',"UPDATE crm.leads SET stage='new'"],['event_update_denied',"UPDATE crm.lead_events SET to_stage='won'"],['event_delete_denied','DELETE FROM crm.lead_events']])test(name,deny(stmt,'42501'));
 }
 sql+='ROLLBACK;\n';fs.writeFileSync(path.join(dir,db+'.runtime-tests.sql'),sql);
 // Owner-level invariants: tables FORCE RLS even for the migration owner.
 const r0=checks.length;sql=`BEGIN; SET LOCAL ROLE ${prefix}_owner; SET LOCAL app.business_id='${a.business}';\n`;
 test('owner_cross_tenant_identity_FK_rejected',deny(`INSERT INTO platform.channel_identities(business_id,instance_id,contact_id,jid,address_kind) VALUES('${a.business}','${a.instance}','${b.contact}','bad-fk@example.invalid','synthetic')`,'23503'));
 test('duplicate_instance_identity_rejected',deny(`INSERT INTO platform.channel_identities(business_id,instance_id,contact_id,jid,address_kind) VALUES('${a.business}','${a.instance}','${a.contact}','${a.jid}','synthetic')`,'23505'));
 test('owner_force_RLS_rejects_cross_business_insert',deny(`INSERT INTO platform.contacts(business_id,display_name,status) VALUES('${b.business}','Wrong tenant','active')`,'42501'));
 test('failed_DDL_transaction_leaves_no_probe',`BEGIN CREATE TABLE app_meta.phase5_failure_probe(id int); PERFORM 1/0; EXCEPTION WHEN division_by_zero THEN NULL; END; ${assert("to_regclass('app_meta.phase5_failure_probe') IS NULL")}`);
 sql+='ROLLBACK;\n';fs.writeFileSync(path.join(dir,db+'.owner-tests.sql'),sql);
 checks.slice(r0).forEach(c=>c.role='migrator');
}
fs.writeFileSync(path.join(dir,'test-plan.json'),JSON.stringify(checks,null,2)+'\n');console.log(`Generated ${checks.length} meaningful SQL contract tests in 6 batched role connections.`);
