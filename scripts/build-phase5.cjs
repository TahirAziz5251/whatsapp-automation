const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'database/phase5');fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.join(root,'docs/phase5'),{recursive:true});
const model=JSON.parse(fs.readFileSync(path.join(root,'docs/phase3/schema-catalog.json'))),businesses=JSON.parse(fs.readFileSync(path.join(root,'database/phase4/fixtures.json')));
const fixtures=[];
for(const db of ['pos_db','bise_db','hospital_db']){
 const prefix=db.replace('_db',''),runtime=prefix+'_runtime';let sql=`-- Phase 5 ${db}: run as ${prefix}_owner inside one transaction.\n`;
 if(db==='pos_db')sql+=`CREATE SCHEMA crm AUTHORIZATION pos_owner; REVOKE ALL ON SCHEMA crm FROM PUBLIC; GRANT USAGE ON SCHEMA crm TO pos_runtime;\n`;
 for(const t of model.tables.filter(t=>t.database===db&&t.phase===5)){
  const cols=Object.entries(t.columns).map(([n,c])=>`${n} ${c.type}${c.nullable?'':' NOT NULL'}${n==='id'?' DEFAULT gen_random_uuid()':['created_at','updated_at'].includes(n)?' DEFAULT now()':''}`);
  cols.push(`PRIMARY KEY (${t.primaryKey.join(',')})`);
  for(const u of t.unique)cols.push(`UNIQUE (${u.join(',')})`);
  for(const f of t.foreignKeys)cols.push(`FOREIGN KEY (${f.columns.join(',')}) REFERENCES ${f.target.split('.').slice(1).join('.')} (${f.targetColumns.join(',')}) ON DELETE RESTRICT`);
  if(t.template==='platform.contacts')cols.push("CHECK (status IN ('active','inactive','blocked'))","CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 200)");
  if(t.template==='platform.channel_identities')cols.push("CHECK (length(jid) BETWEEN 1 AND 200 AND jid=btrim(jid))","CHECK (address_kind IN ('individual','lid','synthetic'))");
  if(t.template==='crm.leads')cols.push("CHECK (stage IN ('new','contacted','qualified','won','lost'))","CHECK (version>0)","CHECK (notes IS NULL OR length(notes)<=2000)");
  if(t.template==='crm.lead_events')cols.push("CHECK (to_stage IN ('new','contacted','qualified','won','lost'))","CHECK (from_stage IS NULL OR from_stage IN ('new','contacted','qualified','won','lost'))","CHECK (expected_version>=0 AND result_version=expected_version+1)","CHECK (payload_hash ~ '^[0-9a-f]{64}$')","CHECK (length(source_event_key) BETWEEN 1 AND 160 AND length(actor_ref) BETWEEN 1 AND 128)");
  sql+=`CREATE TABLE ${t.template} (\n ${cols.join(',\n ')}\n);\nALTER TABLE ${t.template} ENABLE ROW LEVEL SECURITY;\nALTER TABLE ${t.template} FORCE ROW LEVEL SECURITY;\nCREATE POLICY tenant_scope ON ${t.template} USING (business_id=nullif(current_setting('app.business_id',true),'')::uuid) WITH CHECK (business_id=nullif(current_setting('app.business_id',true),'')::uuid);\nGRANT SELECT ON ${t.template} TO ${runtime};\n`;
  for(const [i,idx]of t.indexes.entries())sql+=`CREATE INDEX ${t.template.split('.')[1]}_lookup_${i} ON ${t.template}(${idx.join(',')});\n`;
 }
 sql+=fs.readFileSync(path.join(dir,'contact-api.sql'),'utf8')+`\nGRANT EXECUTE ON FUNCTION platform.ensure_contact(uuid,text,text,text) TO ${runtime};\n`;
 if(db==='pos_db')sql+=fs.readFileSync(path.join(dir,'lead-api.sql'),'utf8')+'\nGRANT EXECUTE ON FUNCTION crm.apply_lead_event(uuid,text,text,integer) TO pos_runtime;\n';
 fs.writeFileSync(path.join(dir,db+'.sql'),sql);
 let seed="-- Reserved synthetic identities: not routable WhatsApp addresses.\nSET LOCAL app.actor_ref='phase5_fixture_loader';\n";
 for(const [i,b]of businesses.filter(b=>b.db===db).entries()){
  seed+=`SET LOCAL app.business_id='${b.business}';\n`;
  for(let n=1;n<=3;n++){
   const person=`50000000-0000-4000-8000-${String((['pos_db','bise_db','hospital_db'].indexOf(db)+1)*10000+i*100+n).padStart(12,'0')}`;
   const jid=`synthetic-person-${n}@example.invalid`,name=`Synthetic ${prefix} ${i?'B':'A'} ${['Ayesha','Bilal','Inactive Contact'][n-1]}`;
   // Deterministic IDs make fixture assertions and cross-tenant tests reproducible.
   seed+=`INSERT INTO platform.contacts(business_id,id,display_name,status) VALUES('${b.business}','${person}','${name}','${n===3?'blocked':'active'}');\nINSERT INTO platform.channel_identities(business_id,instance_id,contact_id,jid,address_kind) VALUES('${b.business}','${b.instance}','${person}','${jid}','synthetic');\nINSERT INTO platform.audit_events(business_id,actor_ref,event_type,resource_ref,outcome,details) VALUES('${b.business}','phase5_fixture_loader','contact.fixture_created','${person}','success','{}');\n`;
   if(db==='pos_db'&&n<3){seed+=`SELECT crm.apply_lead_event('${person}','seed-${i}-${n}-new','new',0);\n`;if(n===1)seed+=`SELECT crm.apply_lead_event('${person}','seed-${i}-${n}-contacted','contacted',1);\nSELECT crm.apply_lead_event('${person}','seed-${i}-${n}-qualified','qualified',2);\n`;}
   fixtures.push({...b,contact:person,jid,display_name:name,status:n===3?'blocked':'active'});
  }
 }
 fs.writeFileSync(path.join(dir,db+'.seed.sql'),seed);
}
fs.writeFileSync(path.join(dir,'fixtures.json'),JSON.stringify(fixtures,null,2)+'\n');console.log('Generated 8 Phase 5 tables, controlled APIs and 18 synthetic contacts. No SQL executed.');
