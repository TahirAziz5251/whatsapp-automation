const fs=require('fs'),cp=require('child_process');
(async()=>{
 const report={at:new Date().toISOString()};
 for(const path of ['/healthz','/healthz/readiness']){
  try{const r=await fetch('http://127.0.0.1:5678'+path,{signal:AbortSignal.timeout(10000)});report[path]=r.status}catch(e){report[path]=e.message}
 }
 const c=JSON.parse(cp.execFileSync('docker',['inspect','evolution-go'],{encoding:'utf8',windowsHide:true,timeout:30000}))[0];
 const env=Object.fromEntries(c.Config.Env.map(e=>{const i=e.indexOf('=');return[e.slice(0,i),e.slice(i+1)]}));
 const r=await fetch('http://127.0.0.1:4000/instance/all',{headers:{apikey:env.GLOBAL_API_KEY},signal:AbortSignal.timeout(15000)});
 const body=await r.json(),rows=Array.isArray(body)?body:(body.data||body.instances||[]);
 const i=rows.find(i=>(i.name||i.instanceName||i.Name)==='student-assistant');
 if(!i)throw Error('Student instance not found');
 const token=i.token||i.Token||i.instanceToken;
 const s=await fetch('http://127.0.0.1:4000/instance/status',{headers:{apikey:token},signal:AbortSignal.timeout(15000)});
 const status=await s.json();
 report.studentStatus={httpStatus:s.status,connected:status.data?.Connected,loggedIn:status.data?.LoggedIn};report.globalWebhookConfigured=Boolean(env.WEBHOOK_URL);report.instanceWebhookEmpty=!(i.webhook||i.webhookUrl||i.webhookURL||i.WebhookUrl);
 fs.writeFileSync('docs/current-system-audit/student-readiness.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1});
