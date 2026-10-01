const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'docs/phase4'),read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const model=read(path.join(root,'docs/phase3/schema-catalog.json')),after=read(path.join(dir,'after-metadata.json')),before=read(path.join(dir,'before-metadata.json'));
const results=[];function test(name,fn){try{fn();results.push({name,status:'PASS'})}catch(e){results.push({name,status:'FAIL',error:e.message})}}
const typeMap={integer:'int4',bigint:'int8',timestamptz:'timestamptz',uuid:'uuid',text:'text',jsonb:'jsonb'};
let md='# Phase 4 — actual implemented catalog\n\nCaptured: '+after.captured_at+'. Actual PostgreSQL catalog metadata after migration; synthetic dev only. `app_meta.schema_migrations` is bookkeeping, excluded from the 16 foundational tables. Domain business/knowledge schemas are deferred until their feature phases.\n\n';
for(const db of model.databases){
 const r=after.records.find(r=>r.container==='business-agent-dev-postgres-1'&&r.database===db.name);
 test(db.name+' exists on isolated PostgreSQL 15',()=>{assert(r);assert(r.version.startsWith('15.'))});if(!r)continue;
 const expected=model.tables.filter(t=>t.database===db.name&&t.phase===4);
 test(db.name+' exact foundational table set',()=>assert.deepEqual(r.tables.filter(t=>t.schema==='platform').map(t=>t.schema+'.'+t.table).sort(),expected.map(t=>t.template).sort()));
 md+=`## ${db.name}\n\nVersion: ${r.version}. Schemas: ${r.schemas.join(', ')}.\n\n`;
 for(const t of expected){const short=t.template.split('.')[1],cols=r.columns.filter(c=>c.schema==='platform'&&c.table===short),constraints=r.constraints.filter(c=>c.schema==='platform'&&c.table===short);
  test(t.name+' actual columns/types/nullability',()=>{assert.deepEqual(cols.map(c=>c.column),Object.keys(t.columns));for(const c of cols){assert.equal(c.udt,typeMap[t.columns[c.column].type]);assert.equal(c.nullable,t.columns[c.column].nullable?'YES':'NO')}});
  test(t.name+' primary and unique keys',()=>{assert(constraints.some(c=>c.type==='p'&&c.definition===`PRIMARY KEY (${t.primaryKey.join(', ')})`));for(const u of t.unique)assert(constraints.some(c=>c.type==='u'&&c.definition===`UNIQUE (${u.join(', ')})`))});
  test(t.name+' FK locality and targets',()=>{const fks=constraints.filter(c=>c.type==='f');assert.equal(fks.length,t.foreignKeys.length);for(const f of t.foreignKeys){const target=f.target.split('.').slice(1).join('.');assert(fks.some(c=>c.definition===`FOREIGN KEY (${f.columns.join(', ')}) REFERENCES ${target}(${f.targetColumns.join(', ')}) ON DELETE RESTRICT`))}});
  md+=`### ${t.template}\n\n| Actual column | Actual type | Nullable | Default |\n| --- | --- | --- | --- |\n`;for(const c of cols)md+=`| ${c.column} | ${c.type} | ${c.nullable} | ${c.default||'none'} |\n`;md+='\n';for(const c of constraints)md+=`- ${c.definition}\n`;md+='\n';
 }
}
for(const r of before.records.filter(r=>r.container==='evolution-postgres'))test('Existing '+r.database+' catalog unchanged',()=>{const next=after.records.find(n=>n.container===r.container&&n.database===r.database);for(const k of ['tables','columns','constraints','extensions'])assert.deepEqual(next[k],r[k])});
const report={scope:'Actual post-migration catalog compared with reviewed Phase 3 foundational table definitions; existing Evolution catalog comparison is metadata only.',results,passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length};
fs.writeFileSync(path.join(dir,'catalog-verification.json'),JSON.stringify(report,null,2)+'\n');fs.writeFileSync(path.join(dir,'IMPLEMENTED_DATABASE_CATALOG.md'),md);
console.log(JSON.stringify({passed:report.passed,failed:report.failed,failures:results.filter(r=>r.status==='FAIL')},null,2));if(report.failed)process.exitCode=1;
