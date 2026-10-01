const fs=require('fs'),cp=require('child_process');
(async()=>{
 const src=fs.readFileSync('scripts/audit-groq-runtime.cjs','utf8');
 const keyScript=src.slice(0,src.indexOf('const r=await fetch')).replace("db.prepare('select nodes from workflow_entity where active=1').get()", "db.prepare('select nodes from workflow_entity where id=?').get('Ag4HbAjKlfHH6Xk7')")+'console.log(cred.apiKey);db.close()})().catch(e=>{console.error(e.message);process.exit(1)});';
 const key=cp.execFileSync('docker',['exec','-i','n8n','node'],{input:keyScript,encoding:'utf8',windowsHide:true,timeout:90000}).trim();
 const w=JSON.parse(fs.readFileSync('scratch/student-remediation/workflow.json','utf8'));
 const tool=w.nodes.find(n=>n.name==='Tool: Business Data Gateway').parameters;
 const model=w.nodes.find(n=>n.name==='Groq Chat Model').parameters;
 const system=w.nodes.find(n=>n.name==='AI Agent (Shared Engine)').parameters.options.systemMessage.replace(/^=/,'').replace('{{ $json.business_name }}','BISE Educational Board System').replace('{{ $json.prompt_profile.allowed_scope }}','BISE examination results and fees');
 const r=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},signal:AbortSignal.timeout(30000),body:JSON.stringify({model:model.model,max_tokens:model.options.maxTokensToSample,temperature:0.1,messages:[{role:'system',content:system},{role:'user',content:'Mera roll number 102450 hai. Result aur subject marks bata dein.'}],tools:[{type:'function',function:{name:tool.name,description:tool.description,parameters:JSON.parse(tool.inputSchema)}}],tool_choice:'auto'})});
 const b=await r.json();const call=b.choices?.[0]?.message?.tool_calls?.[0];let args;try{args=JSON.parse(call?.function.arguments)}catch{}
 const report={at:new Date().toISOString(),model:model.model,httpStatus:r.status,finishReason:b.choices?.[0]?.finish_reason,usage:b.usage,rateLimits:Object.fromEntries([...r.headers].filter(([k])=>k.startsWith('x-ratelimit')||k==='retry-after')),tool:call?.function.name,arguments:args,error:b.error?.message};
 report.pass=r.ok&&call?.function.name==='query_business_data'&&args?.operation==='get_student_result'&&String(args?.parameters?.roll_number)==='102450';

 if(report.pass){
  const context={business_code:'BISE_EDU',allowed_tools:['query_business_data'],messageText:'Mera roll number 102450 hai. Result aur subject marks bata dein.'};
  const runtime="const fs=require('fs');const p=JSON.parse(fs.readFileSync(0,'utf8'));const A=Object.getPrototypeOf(async function(){}).constructor;(async()=>{console.log(await new A('query','$','require',p.code)(p.args,()=>({first:()=>({json:p.context})}),n=>require('/usr/local/lib/node_modules/n8n/node_modules/'+n)))})().catch(()=>process.exit(1));";
  const result=cp.execFileSync('docker',['exec','-i','n8n','node','-e',runtime],{input:JSON.stringify({code:tool.jsCode,args,context}),encoding:'utf8',windowsHide:true,timeout:120000}).trim();
  const data=JSON.parse(result); if(data.status!=='FOUND'||data.records.length!==1)throw Error('Live database result unavailable');
  if(/b_form_cnic|date_of_birth|student_phone/.test(result))throw Error('Unexpected sensitive fields');
  const r2=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},signal:AbortSignal.timeout(30000),body:JSON.stringify({model:model.model,max_tokens:model.options.maxTokensToSample,temperature:0.1,messages:[{role:'system',content:system},{role:'user',content:context.messageText},b.choices[0].message,{role:'tool',tool_call_id:call.id,content:result}],tools:[{type:'function',function:{name:tool.name,description:tool.description,parameters:JSON.parse(tool.inputSchema)}}],tool_choice:'auto'})});
  const b2=await r2.json();const output=b2.choices?.[0]?.message?.content;
  const guardCode=w.nodes.find(n=>n.name==='Result Validator & Response Guard').parameters.jsCode;
  const A=Object.getPrototypeOf(async function(){}).constructor;
  const guarded=await new A('$input','$',guardCode)({first:()=>({json:{output,intermediateSteps:[{observation:result}]}})},()=>({first:()=>({json:context})}));
  report.roundTrip={httpStatus:r2.status,finishReason:b2.choices?.[0]?.finish_reason,usage:b2.usage,error:b2.error?.message,guard:guarded[0].json.validation_guard.status,marksMatch:guarded[0].json.output.includes(data.records[0].marks_obtained+'/'+data.records[0].total_marks),subjectCount:data.records[0].subjects.length};
  report.pass=report.pass&&r2.ok&&b2.choices?.[0]?.finish_reason==='stop'&&Boolean(output)&&report.roundTrip.guard==='DATABASE_VERIFIED'&&report.roundTrip.marksMatch;
 }

 fs.writeFileSync('docs/current-system-audit/groq-selection-test.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.pass)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1});
