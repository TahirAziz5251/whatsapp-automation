// Run via stdin inside the existing n8n container; no WhatsApp messages are sent.
const fs=require('fs'),assert=require('assert/strict');
const payload=JSON.parse(fs.readFileSync(0,'utf8'));
const w=payload.workflow,AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const get=n=>w.nodes.find(x=>x.name===n).parameters.jsCode;
const modules=n=>require('/usr/local/lib/node_modules/n8n/node_modules/'+n);
const report={at:new Date().toISOString(),tests:[]};
const test=async(name,fn)=>{try{await fn();report.tests.push({name,status:'PASS'})}catch(e){report.tests.push({name,status:'FAIL',error:e.message.replace(/postgres(?:ql)?:\/\/[^\s]+/g,'[REDACTED]')})}};
const context=(tenant='BISE_EDU')=>({business_code:tenant,allowed_tools:['query_business_data'],instance_name:'student-assistant',session_id:'audit',messageText:'Result for 102450'});
const invoke=async(args,c=context(),moduleFn=modules)=>JSON.parse(await new AsyncFunction('query','$','require',get('Tool: Business Data Gateway'))(args,()=>({first:()=>({json:c})}),moduleFn));
(async()=>{
const {Client}=modules('pg');const c=new Client({connectionString:payload.readonlyUrl,connectionTimeoutMillis:5000,options:'-c default_transaction_read_only=on'});await c.connect();
const baseline=(await c.query('SELECT roll_number,marks_obtained,total_marks,grade,status FROM results ORDER BY roll_number')).rows;await c.end();
for(const row of baseline)await test('Live BISE result matches independent SQL: '+row.roll_number,async()=>{const r=await invoke({operation:'get_student_result',parameters:{roll_number:row.roll_number}});assert.equal(r.status,'FOUND');assert.equal(r.verified_live,true);for(const k of Object.keys(row))assert.equal(r.records[0][k],row[k]);assert(!JSON.stringify(r).includes('b_form_cnic'));assert(!JSON.stringify(r).includes('student_phone'));});
await test('Subject marks come from live rows',async()=>{const r=await invoke({operation:'get_student_result',parameters:{roll_number:'102450'}});assert(r.records[0].subjects.length>0)});
await test('Unknown roll has no seeded fallback',async()=>assert.equal((await invoke({operation:'get_student_result',parameters:{roll_number:'999999'}})).status,'NOT_FOUND'));
await test('Nonexistent exam year is NOT_FOUND',async()=>assert.equal((await invoke({operation:'get_student_result',parameters:{roll_number:'102450',exam_year:2001}})).status,'NOT_FOUND'));
await test('Malformed roll and SQL injection are rejected',async()=>{for(const roll of ['102450 OR 1=1','abc102450','12345',"102450';DROP TABLE results;--"])assert.equal((await invoke({operation:'get_student_result',parameters:{roll_number:roll}})).status,'INVALID_INPUT')});
await test('Cross-tenant operation denied',async()=>assert.equal((await invoke({operation:'get_student_result',parameters:{roll_number:'102450'}},context('POS_RETAIL'))).status,'POLICY_DENIED'));
await test('Database failure never returns seed success',async()=>assert.equal((await invoke({operation:'get_student_result',parameters:{roll_number:'102450'}},context(),()=>{throw Error('database unavailable')})).status,'DB_UNAVAILABLE'));
await test('BISE fees retrieved from DB',async()=>{const r=await invoke({operation:'get_fees',parameters:{}});assert.equal(r.records.length,4);assert.equal(r.source_database,'bise_db')});
await test('POS returns exactly the active database SKUs',async()=>{const pc=new Client({connectionString:payload.readonlyUrl.replace(/bise_db$/,'pos_db'),connectionTimeoutMillis:5000,options:'-c default_transaction_read_only=on'});try{await pc.connect();const expected=(await pc.query('SELECT sku FROM products WHERE is_active ORDER BY sku')).rows.map(r=>r.sku);const r=await invoke({operation:'get_product',parameters:{}},context('POS_RETAIL'));assert.deepEqual(r.records.map(r=>r.sku).sort(),expected);assert.equal(r.source_database,'pos_db')}finally{await pc.end()}});
await test('Hospital live doctor filter',async()=>{const r=await invoke({operation:'get_doctors_by_specialty',parameters:{specialty:'Cardiology'}},context('HOSP_HEALTH'));assert.equal(r.status,'FOUND');assert(r.records.every(r=>r.specialty.toLowerCase().includes('cardiology')))});
await test('Hospital unknown doctor is NOT_FOUND',async()=>assert.equal((await invoke({operation:'get_doctor_schedule',parameters:{doctor_name:'AUDIT_DOCTOR_DOES_NOT_EXIST'}},context('HOSP_HEALTH'))).status,'NOT_FOUND'));
const normalize=new AsyncFunction('$input',get('Message Normalizer'));
const raw={body:{event:'Message',instanceName:'student-assistant',instanceToken:'test',data:{Info:{ID:'AUDIT-ID',IsFromMe:false,Chat:'923000000000@s.whatsapp.net',Sender:'923000000000:17@s.whatsapp.net'},Message:{conversation:'Result 102450'}}}};
await test('Real Info.ID and device JID normalization',async()=>{const a=await normalize({first:()=>({json:raw})});assert.equal(a[0].json.message_id,'AUDIT-ID');assert.equal(a[0].json.user_id,'923000000000')});
await test('Missing ID/self/group/non-message do not process',async()=>{for(const kind of ['missing','self','group','receipt']){const p=structuredClone(raw);if(kind==='missing')delete p.body.data.Info.ID;if(kind==='self')p.body.data.Info.IsFromMe=true;if(kind==='group')p.body.data.Info.Chat='1@g.us';if(kind==='receipt')p.body.event='Receipt';assert.deepEqual(await normalize({first:()=>({json:p})}),[])}});
await test('Live resolver and session identity preserve tenant and message',async()=>{let item=(await normalize({first:()=>({json:raw})}))[0].json;for(const name of ['Resolve Business (platform_db)','Load Business Profile (platform_db)','Construct Session Identity']){const fn=new AsyncFunction('$input','require',get(name));item=(await fn({first:()=>({json:item})},modules))[0].json;}assert.equal(item.business_code,'BISE_EDU');assert.equal(item.message_id,'AUDIT-ID');assert.equal(item.messageText,'Result 102450');assert(item.allowed_tools.includes('query_business_data'))});
await test('Unknown instance fails closed',async()=>{const fn=new AsyncFunction('$input','require',get('Resolve Business (platform_db)'));assert.deepEqual(await fn({first:()=>({json:{instance_name:'audit-unknown'}})},modules),[])});
const Redis=modules('ioredis'),redis=new Redis({host:'evolution-redis',maxRetriesPerRequest:0});const id='AUDIT-'+Date.now();const keys=[];
try{
 const gate=new AsyncFunction('$input','require',get('Redis Transient Session & Dedup Gate'));
 const runGate=inst=>{keys.push('wa:dedup:v2:'+inst+':'+id);return gate({first:()=>({json:{instance_name:inst,message_id:id,session_id:'audit'}})},modules)};
 await test('12 concurrent duplicate claims admit exactly one',async()=>{const res=await Promise.all(Array.from({length:12},()=>runGate('audit-student')));assert.equal(res.filter(r=>r.length).length,1)});
 await test('Same ID across instances is isolated',async()=>assert.equal((await runGate('audit-other')).length,1));
}finally{await redis.del(...new Set(keys));redis.disconnect()}
await test('Response guard overwrites fabricated marks with live record',async()=>{const result=await invoke({operation:'get_student_result',parameters:{roll_number:'102450'}});const guard=new AsyncFunction('$input','$',get('Result Validator & Response Guard'));const actual=await guard({first:()=>({json:{output:'Marks 1100/1100',intermediateSteps:[{observation:JSON.stringify(result)}]}})},()=>({first:()=>({json:context()})}));assert(actual[0].json.output.includes('945/1100'));assert(!actual[0].json.output.includes('Marks 1100/1100'));assert.equal(actual[0].json.validation_guard.status,'DATABASE_VERIFIED')});
console.log(JSON.stringify(report));process.exitCode=report.tests.some(t=>t.status==='FAIL')?1:0;
})().catch(e=>{console.log(JSON.stringify({error:e.message}));process.exitCode=1});
