// Structural design checks only. These do not execute SQL or prove production security.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const dir=path.resolve(__dirname,'../docs/phase3');
const model=JSON.parse(fs.readFileSync(path.join(dir,'schema-catalog.json'),'utf8'));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function validate(m){
 assert.equal(m.version,2);
 assert.deepEqual(m.databases.map(d=>d.name),['control_db','pos_db','bise_db','hospital_db']);
 assert.equal(new Set(m.databases.map(d=>d.runtimeRole)).size,4,'shared runtime credential');
 for(const d of m.databases){for(const value of Object.values(d.runtimePrivileges))assert.equal(value,false,'overprivileged runtime');assert.equal(d.vectorExtension,d.name==='control_db'?null:'vector');}
 assert.equal(m.boundaries.crossDatabaseForeignKeys,false);assert.equal(m.boundaries.distributedTransactions,false);assert.equal(m.boundaries.localAuditOutboxIdempotency,true);
 const byName=new Map(m.tables.map(t=>[t.name,t]));
 assert.equal(byName.size,m.tables.length,'duplicate entity');
 assert.equal(m.vectorEngine,'pgvector');
 assert.equal(m.status,'PROPOSED_DESIGN_ONLY');
 for(const t of m.tables){
  assert(m.databases.some(d=>d.name===t.database),'unknown database');
  assert.equal(t.name,t.database+'.'+t.template,'database-qualified ownership mismatch');
  const domain=m.databases.find(d=>d.name===t.database).domain;
  const allowed=domain==='control'?['platform']:['platform','knowledge',domain,...(domain==='sales'?['crm']:[])];
  assert(allowed.includes(t.schema),'table in wrong domain database');
  assert.equal(t.schema,t.template.split('.')[0],'schema mismatch');
  for(const ref of t.externalReferences||[]){
   assert(ref.contract&&ref.localColumns.length===ref.targetColumns.length,'external reference contract missing');
   for(const col of ref.localColumns)assert(t.columns[col],'external reference local column missing');
   const targets=ref.target.startsWith('{authorized_domain_db}.')
    ? ['pos_db','bise_db','hospital_db'].map(db=>ref.target.replace('{authorized_domain_db}',db)) : [ref.target];
   for(const name of targets){const target=byName.get(name);assert(target,'external target missing');for(const col of ref.targetColumns)assert(target.columns[col],'external target column missing');}
  }
  if(t.database!=='control_db'&&['platform.businesses','platform.instances'].includes(t.template)){
   assert.equal(t.authority,'provisioned_projection');assert(!t.columns.credential_ref);
   assert(t.columns.valid_until);assert(t.externalReferences.some(r=>r.target==='control_db.'+t.template&&r.contract));
  }
  assert(t.purpose && Number.isInteger(t.phase),'purpose/phase missing');
  assert(t.phase>=4 && t.phase<=35,'invalid phase');
  assert.equal(t.rls,'required','RLS declaration missing');
  for(const key of [t.primaryKey,...t.unique,...t.indexes]){
   assert(key.length>0,'empty key');
   for(const c of key)assert(t.columns[c],`missing key column ${t.name}.${c}`);
  }
  for(const c of t.primaryKey)assert.equal(t.columns[c].nullable,false,'nullable primary key');
  if(t.template!=='platform.businesses'){
   assert(t.columns.business_id && !t.columns.business_id.nullable,'missing tenant');
   assert(same(t.primaryKey,['business_id','id']),'unscoped primary key');
   assert(t.foreignKeys.some(f=>f.target===t.database+'.platform.businesses' && same(f.columns,['business_id'])),'tenant ownership FK missing');
   for(const key of t.unique)assert(key.includes('business_id')||(t.template==='platform.instances'&&same(key,['provider','external_instance_id'])),'unscoped unique business key');
  }
  for(const f of t.foreignKeys){
   const parent=byName.get(f.target);assert(parent,'unknown FK target');assert.equal(parent.database,t.database,'cross-database FK forbidden');
   assert.equal(f.columns.length,f.targetColumns.length,'FK arity');
   assert(parent.phase<=t.phase,'reference to later-phase entity');
   assert([parent.primaryKey,...parent.unique].some(k=>same(k,f.targetColumns)),'FK target not unique');
   if(parent.template!=='platform.businesses'){
    assert.equal(f.columns[0],'business_id','cross-tenant FK');
    assert.equal(f.targetColumns[0],'business_id','cross-tenant target');
   }
   f.columns.forEach((c,i)=>{
    assert(t.columns[c] && parent.columns[f.targetColumns[i]],'missing FK column');
    assert.equal(t.columns[c].type,parent.columns[f.targetColumns[i]].type,'FK type mismatch');
   });
   assert.equal(f.onDelete,'RESTRICT','unreviewed cascading deletion');
  }
  for(const [name,c] of Object.entries(t.columns)){
   if(name.endsWith('_id') && !['business_id','provider_event_id','provider_message_id','external_instance_id','external_event_id'].includes(name)){
    assert(t.foreignKeys.some(f=>f.columns.includes(name)),`unlinked ID ${t.name}.${name}`);
   }
   if(['price','unit_price','total','amount'].includes(name))assert(c.type.startsWith('numeric('),'inexact money type');
   if(name.endsWith('_at')||name.endsWith('_until'))assert.equal(c.type,'timestamptz','timezone missing');
  }
 }
 for(const db of ['pos_db','bise_db','hospital_db']){
  for(const short of ['platform.businesses','platform.sessions','platform.actions','platform.audit_events','platform.reporting_outbox','platform.configuration_inbox','platform.outbox','knowledge.chunks'])assert(byName.has(db+'.'+short),'missing domain-local component');
 }
 for(const short of ['platform.configuration_outbox','platform.reporting_events','platform.session_directory'])assert(byName.has('control_db.'+short),'missing control component');
 assert(!m.tables.some(t=>t.database==='control_db'&&['platform.sessions','platform.messages','platform.verification_grants','platform.actions'].includes(t.template)),'private operational state centralized');
 const phases=m.tables.filter(t=>t.phase===4).map(t=>t.name).sort();
 assert.deepEqual(phases,[...m.phase4Tables].sort(),'phase 4 scope drift');
 // Acyclic FK dependencies allow a deterministic migration ordering within a phase.
 const visited=new Set(),active=new Set();
 function visit(name){if(visited.has(name))return;assert(!active.has(name),'FK cycle requires explicit migration plan');active.add(name);for(const f of byName.get(name).foreignKeys)visit(f.target);active.delete(name);visited.add(name);}
 for(const name of byName.keys())visit(name);
 return [...visited];
}
const results=[];
function test(name,fn){try{fn();results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',error:e.message});}}
test('Catalog keys, FK types/targets, tenant scope, dependency phases and types',()=>validate(model));
function negative(name,mutate){test(name,()=>{const copy=structuredClone(model);mutate(copy);assert.throws(()=>validate(copy));});}
negative('Reject missing business ownership FK',m=>m.tables.find(t=>t.template==='crm.leads').foreignKeys.shift());
negative('Reject ID-only cross-tenant FK',m=>{const f=m.tables.find(t=>t.template==='sales.order_items').foreignKeys.find(f=>f.target.endsWith('.sales.orders'));f.columns=['order_id'];f.targetColumns=['id'];});
negative('Reject missing referenced entity',m=>m.tables.find(t=>t.template==='hospital.appointments').foreignKeys[1].target='hospital.missing');
negative('Reject future-phase dependency',m=>m.tables.find(t=>t.template==='sales.products').phase=20);
negative('Reject floating point money',m=>m.tables.find(t=>t.template==='sales.skus').columns.price.type='float8');
negative('Reject unscoped business uniqueness',m=>m.tables.find(t=>t.template==='sales.skus').unique=[['sku']]);
negative('Reject nullable tenant identity',m=>m.tables.find(t=>t.template==='platform.contacts').columns.business_id.nullable=true);
negative('Reject timestamp without timezone',m=>m.tables.find(t=>t.template==='hospital.slots').columns.starts_at.type='timestamp');
// Small relational witnesses verify that proposed ownership tuples reject mismatched actors/tenants.
function matches(fk,child,parent){return fk.columns.every((c,i)=>child[c]===parent[fk.targetColumns[i]]);}
test('Tenant-scoped FK witness: same ID in another business cannot satisfy order FK',()=>{
 const fk=model.tables.find(t=>t.template==='sales.order_items').foreignKeys.find(f=>f.target.endsWith('.sales.orders'));
 assert(matches(fk,{business_id:'A',order_id:'x'},{business_id:'A',id:'x'}));
 assert(!matches(fk,{business_id:'A',order_id:'x'},{business_id:'B',id:'x'}));
});
test('Session ownership tuple rejects different conversation actor',()=>{
 const fk=model.tables.find(t=>t.template==='platform.sessions').foreignKeys.find(f=>f.target.endsWith('.platform.conversations'));
 assert(!matches(fk,{business_id:'A',conversation_id:'c',actor_contact_id:'attacker'},{business_id:'A',id:'c',contact_id:'owner'}));
});
test('Verification grant ownership tuple rejects another session actor',()=>{
 const fk=model.tables.find(t=>t.template==='platform.verification_grants').foreignKeys.find(f=>f.target.endsWith('.platform.sessions'));
 assert(!matches(fk,{business_id:'A',session_id:'s',actor_contact_id:'attacker'},{business_id:'A',id:'s',actor_contact_id:'owner'}));
});
test('Message tuple rejects request from another instance in the same tenant',()=>{
 const fk=model.tables.find(t=>t.template==='platform.messages').foreignKeys.find(f=>f.target.endsWith('.platform.requests'));
 assert(!matches(fk,{business_id:'A',request_id:'r',instance_id:'instance-1'},{business_id:'A',id:'r',instance_id:'instance-2'}));
});
test('Action tuple rejects verification grant from another session',()=>{
 const fk=model.tables.find(t=>t.template==='platform.actions').foreignKeys.find(f=>f.target.endsWith('.platform.verification_grants'));
 assert(!matches(fk,{business_id:'A',verification_grant_id:'g',session_id:'s1'},{business_id:'A',id:'g',session_id:'s2'}));
});
negative('Reject cross-database FK even with compatible keys',m=>m.tables.find(t=>t.name==='pos_db.platform.contacts').foreignKeys[0].target='control_db.platform.businesses');
negative('Reject shared runtime role',m=>m.databases[1].runtimeRole=m.databases[0].runtimeRole);
negative('Reject runtime BYPASSRLS',m=>m.databases[1].runtimePrivileges.bypassrls=true);
negative('Reject missing local reporting outbox',m=>m.tables=m.tables.filter(t=>t.name!=='bise_db.platform.reporting_outbox'));
negative('Reject missing local idempotency action store',m=>m.tables=m.tables.filter(t=>t.name!=='pos_db.platform.actions'));
negative('Reject mutable authoritative domain tenant registry',m=>m.tables.find(t=>t.name==='bise_db.platform.businesses').authority='local');
negative('Reject domain credential reference copied from gateway',m=>m.tables.find(t=>t.name==='hospital_db.platform.instances').columns.credential_ref={type:'text',nullable:false});
negative('Reject distributed transaction dependency',m=>m.boundaries.distributedTransactions=true);
negative('Reject missing pgvector domain plan',m=>m.databases[2].vectorExtension=null);
negative('Reject broken logical central reference',m=>m.tables.find(t=>t.name==='pos_db.platform.businesses').externalReferences[0].target='control_db.platform.missing');
negative('Reject external reference without recovery/sync contract',m=>m.tables.find(t=>t.name==='bise_db.platform.configuration_inbox').externalReferences[0].contract='');
negative('Reject database/schema ownership mismatch',m=>m.tables.find(t=>t.name==='hospital_db.hospital.slots').schema='sales');
test('Each domain action idempotency key stays business scoped',()=>{
 for(const db of ['pos_db','bise_db','hospital_db'])assert(model.tables.find(t=>t.name===db+'.platform.actions').unique.some(k=>same(k,['business_id','operation','idempotency_key'])));
});
test('Central reporting deduplication includes source domain and tenant',()=>{
 assert(model.tables.find(t=>t.name==='control_db.platform.reporting_events').unique.some(k=>same(k,['business_id','origin_database','origin_event_ref'])));
});
test('Phase 4 contains only sixteen foundational catalog tables',()=>{
 assert.equal(model.phase4Tables.length,16);
 for(const name of model.phase4Tables)assert(/\.platform\.(businesses|instances|audit_events|configuration_outbox|configuration_inbox)$/.test(name));
});
const failures=results.filter(r=>r.status==='FAIL');
const report={scope:'Offline design lint and relational tuple witnesses only; no database migrations, real concurrency, RLS, restore, workflow or business E2E tests performed.',modelVersion:model.version,databases:model.databases.map(d=>d.name),entities:model.tables.length,foreignKeys:model.tables.reduce((n,t)=>n+t.foreignKeys.length,0),results,migrationOrder:failures.length?[]:validate(model),passed:results.length-failures.length,failed:failures.length};
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({entities:report.entities,foreignKeys:report.foreignKeys,passed:report.passed,failed:report.failed,failures},null,2));
if(failures.length)process.exitCode=1;
