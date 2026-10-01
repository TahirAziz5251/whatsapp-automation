// Generate reviewed SQL for the isolated dev server; this generator executes no SQL.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'database/phase4');fs.mkdirSync(dir,{recursive:true});
const model=JSON.parse(fs.readFileSync(path.join(root,'docs/phase3/schema-catalog.json'),'utf8'));
const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
const fixtures=[];
for(const [i,domain] of ['sales','bise','hospital'].entries())for(let j=1;j<=2;j++){
 const n=(i+1)*10+j,uuid=k=>`40000000-0000-4000-8000-${String(n*100+k).padStart(12,'0')}`;
 const f={business:uuid(1),instance:uuid(2),event:uuid(3),audit:uuid(4),inbox:uuid(5),domain,db:domain==='sales'?'pos_db':domain+'_db',code:`dummy_${domain}_${j}`,external:`phase4_dummy_${domain}_${j}`};
 f.payload=JSON.stringify({schema_version:1,business_id:f.business,domain,revision:1,instance_id:f.instance,external_instance_id:f.external,status:'active'});
 f.hash=crypto.createHash('sha256').update(f.payload).digest('hex');fixtures.push(f);
}
fs.writeFileSync(path.join(dir,'fixtures.json'),JSON.stringify(fixtures,null,2)+'\n');
for(const db of model.databases){
 const prefix=db.name.replace('_db',''),owner=prefix+'_owner',runtime=prefix+'_runtime';
 let sql=`-- Phase 4 foundational schema for ${db.name}; migration runner wraps this in one transaction.\nCREATE SCHEMA platform AUTHORIZATION ${owner};\nCREATE SCHEMA app_meta AUTHORIZATION ${owner};\nREVOKE ALL ON SCHEMA public FROM PUBLIC;\nREVOKE ALL ON SCHEMA platform, app_meta FROM PUBLIC;\nGRANT USAGE ON SCHEMA platform TO ${runtime};\nALTER DEFAULT PRIVILEGES FOR ROLE ${owner} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;\nALTER DEFAULT PRIVILEGES FOR ROLE ${owner} REVOKE ALL ON TABLES FROM PUBLIC;\nCREATE TABLE app_meta.schema_migrations(version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());\n`;
 for(const t of model.tables.filter(t=>t.database===db.name&&t.phase===4)){
  const cols=Object.entries(t.columns).map(([n,c])=>`  ${n} ${c.type}${c.nullable?'':' NOT NULL'}${n==='id'?' DEFAULT gen_random_uuid()':n==='created_at'?' DEFAULT now()':''}`);
  cols.push(`  PRIMARY KEY (${t.primaryKey.join(', ')})`);
  for(const u of t.unique)cols.push(`  UNIQUE (${u.join(', ')})`);
  for(const f of t.foreignKeys)cols.push(`  FOREIGN KEY (${f.columns.join(', ')}) REFERENCES ${f.target.split('.').slice(1).join('.')} (${f.targetColumns.join(', ')}) ON DELETE RESTRICT`);
  if(t.template==='platform.businesses'){
   cols.push(`  CHECK (domain IN (${db.domain==='control'?"'sales','bise','hospital'":literal(db.domain)}))`,"  CHECK (config_version > 0)","  CHECK (length(code) BETWEEN 1 AND 80 AND length(display_name) BETWEEN 1 AND 200)","  CHECK (timezone = 'Asia/Karachi')");
  }
  if(t.template==='platform.businesses'||t.template==='platform.instances')cols.push("  CHECK (status IN ('active','disabled'))");
  if(t.columns.config_revision)cols.push('  CHECK (config_revision > 0)');
  if(t.columns.valid_until)cols.push('  CHECK (valid_until > created_at)');
  if(t.template==='platform.businesses'&&t.columns.config_revision)cols.push('  CHECK (config_revision = config_version)');
  if(t.template==='platform.instances')cols.push("  CHECK (length(provider) BETWEEN 1 AND 80 AND length(external_instance_id) BETWEEN 1 AND 200)");
  if(t.template==='platform.audit_events')cols.push("  CHECK (outcome IN ('success','denied','failure'))","  CHECK (length(actor_ref) BETWEEN 1 AND 128 AND length(event_type) BETWEEN 1 AND 80)","  CHECK (jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 2048 AND details - ARRAY['reason_code','config_revision','correlation_ref']::text[] = '{}'::jsonb)");
  if(t.columns.payload_hash)cols.push("  CHECK (payload_hash ~ '^[0-9a-f]{64}$')");
  if(t.columns.payload)cols.push("  CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 16384)");
  if(t.columns.attempts)cols.push("  CHECK (attempts >= 0)","  CHECK (status IN ('pending','sending','delivered','retry_wait','failed'))");
  sql+=`\nCREATE TABLE ${t.template} (\n${cols.join(',\n')}\n);\n`;
  for(const [i,idx] of t.indexes.entries())sql+=`CREATE INDEX ${t.template.split('.')[1]}_lookup_${i} ON ${t.template} (${idx.join(', ')});\n`;
  const key=t.template==='platform.businesses'?'id':'business_id';
  const scope=`${key} = nullif(current_setting('app.business_id', true), '')::uuid`;
  sql+=`ALTER TABLE ${t.template} ENABLE ROW LEVEL SECURITY;\nALTER TABLE ${t.template} FORCE ROW LEVEL SECURITY;\nCREATE POLICY tenant_scope ON ${t.template} USING (${scope}) WITH CHECK (${scope});\n`;
 }
 sql+=`\nGRANT SELECT ON platform.businesses, platform.instances TO ${runtime};\nGRANT SELECT, INSERT ON platform.audit_events TO ${runtime};\n`;
 fs.writeFileSync(path.join(dir,db.name+'.sql'),sql);
 let seed='-- Synthetic fixtures only; run transactionally as scoped database owner.\n';
 for(const f of fixtures.filter(f=>db.domain==='control'||f.db===db.name)){
  const local=db.domain!=='control';seed+=`SET LOCAL app.business_id = '${f.business}';\n`;
  seed+=`INSERT INTO platform.businesses(id,code,display_name,domain,timezone,status,config_version${local?',config_revision,valid_until':''}) VALUES('${f.business}','${f.code}','Synthetic ${f.code}','${f.domain}','Asia/Karachi','active',1${local?",1,now()+interval '24 hours'":''});\n`;
  seed+=`INSERT INTO platform.instances(business_id,id,provider,external_instance_id,status${local?',config_revision,valid_until':',credential_ref'}) VALUES('${f.business}','${f.instance}','evolution_go','${f.external}','active',${local?"1,now()+interval '24 hours'":"'dummy:no-live-credential'"});\n`;
  seed+=`INSERT INTO platform.audit_events(business_id,id,actor_ref,event_type,outcome,details) VALUES('${f.business}','${f.audit}','phase4_fixture_loader','config.bootstrap','success','{"config_revision":1}');\n`;
  seed+=local?`INSERT INTO platform.configuration_inbox(business_id,id,origin_event_ref,config_revision,payload_hash,applied_at) VALUES('${f.business}','${f.inbox}','${f.event}',1,'${f.hash}',now());\n`:`INSERT INTO platform.configuration_outbox(business_id,id,config_revision,event_type,payload,payload_hash,status,attempts) VALUES('${f.business}','${f.event}',1,'config.bootstrap',${literal(f.payload)},'${f.hash}','pending',0);\n`;
 }
 fs.writeFileSync(path.join(dir,db.name+'.seed.sql'),seed);
}
console.log('Generated 4 migrations and synthetic bootstrap fixtures. PostgreSQL operations have not been run by this generator.');
