const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const root=path.resolve(__dirname,'..'),dir=path.join(root,'docs/phase5');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,'')),model=read(path.join(root,'docs/phase3/schema-catalog.json')),snapshot=read(path.join(dir,'database-metadata.json'));
const results=[];const test=(name,fn)=>{try{fn();results.push({name,status:'PASS'})}catch(e){results.push({name,status:'FAIL',error:e.message})}};
let md='# Phase 5 — actual schema and synthetic fixtures\n\nCaptured '+snapshot.captured_at+'. PostgreSQL metadata and aggregate synthetic counts only. No official student/patient data.\n\n';
for(const r of snapshot.records){
 const ts=model.tables.filter(t=>t.database===r.database&&t.phase<=5);
 test(r.database+' exact Phase 4+5 business table set',()=>assert.deepEqual(r.tables.filter(t=>t.schema!=='app_meta').map(t=>t.schema+'.'+t.table).sort(),ts.map(t=>t.template).sort()));
 if(r.database==='control_db')continue;
 test(r.database+' six synthetic contacts across two businesses',()=>{assert.equal(r.fixtures.contacts,6);assert.equal(r.fixtures.identities,6);assert.equal(r.fixtures.blocked,2);assert.equal(r.fixtures.synthetic_identities,6);assert.equal(r.fixtures.businesses,2)});
 if(r.database==='pos_db')test('POS four leads and eight events with progressed state',()=>{assert.equal(r.fixtures.leads,4);assert.equal(r.fixtures.lead_events,8);assert.deepEqual(r.fixtures.stages,{new:2,qualified:2})});
 md+=`## ${r.database}\n\nSynthetic counts: ${JSON.stringify(r.fixtures)}.\n\n`;
 for(const t of ts.filter(t=>t.phase===5)){
  const table=t.template.split('.')[1],cols=r.columns.filter(c=>c.schema===t.schema&&c.table===table),cs=r.constraints.filter(c=>c.schema===t.schema&&c.table===table);
  test(t.name+' columns/types/nullability',()=>{assert.deepEqual(cols.map(c=>c.column),Object.keys(t.columns));for(const c of cols){assert.equal(c.type,t.columns[c.column].type==='integer'?'int4':t.columns[c.column].type);assert.equal(c.nullable,t.columns[c.column].nullable?'YES':'NO')}});
  test(t.name+' primary/unique/foreign keys',()=>{assert(cs.some(c=>c.type==='p'&&c.definition===`PRIMARY KEY (${t.primaryKey.join(', ')})`));for(const u of t.unique)assert(cs.some(c=>c.type==='u'&&c.definition===`UNIQUE (${u.join(', ')})`));for(const f of t.foreignKeys)assert(cs.some(c=>c.type==='f'&&c.definition===`FOREIGN KEY (${f.columns.join(', ')}) REFERENCES ${f.target.split('.').slice(1).join('.')}(${f.targetColumns.join(', ')}) ON DELETE RESTRICT`));assert.equal(cs.filter(c=>c.type==='f').length,t.foreignKeys.length)});
  test(t.name+' owner and FORCE RLS',()=>{const actual=r.tables.find(x=>x.schema===t.schema&&x.table===table);assert(actual.rls&&actual.force_rls);assert.equal(actual.owner,r.database.replace('_db','')+'_owner')});
  md+=`### ${t.template}\n\n| Column | Actual type | Nullable |\n| --- | --- | --- |\n`;for(const c of cols)md+=`| ${c.column} | ${c.type} | ${c.nullable} |\n`;md+='\n';for(const c of cs)md+=`- ${c.definition}\n`;md+='\n';
 }
}
const report={scope:'Actual Phase 5 catalog, constraints, RLS and post-rerun fixture counts',results,passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length};fs.writeFileSync(path.join(dir,'catalog-verification.json'),JSON.stringify(report,null,2)+'\n');fs.writeFileSync(path.join(dir,'IMPLEMENTED_SCHEMA.md'),md);console.log(JSON.stringify({passed:report.passed,failed:report.failed,failures:results.filter(r=>r.status==='FAIL')},null,2));if(report.failed)process.exitCode=1;
