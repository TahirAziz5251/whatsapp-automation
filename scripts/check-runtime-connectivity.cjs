const cp=require('child_process'),fs=require('fs');
const run=(args,input)=>cp.execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout:45000});
(async()=>{
 const src=fs.readFileSync('scripts/audit-groq-runtime.cjs','utf8');
 const keyScript=src.slice(0,src.indexOf('const r=await fetch'))+'console.log(cred.apiKey);db.close()})().catch(()=>process.exit(1));';
 const key=run(['exec','-i','n8n','node'],keyScript).trim();
 const report={at:new Date().toISOString()};
 try{const r=await fetch('https://api.groq.com/openai/v1/models',{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(12000)});const b=await r.json();report.hostGroq={status:r.status,models:b.data?.filter(x=>/gpt-oss|qwen/.test(x.id)).map(x=>x.id),error:b.error?.message};}catch(e){report.hostGroq={error:e.message}}
 const probe=String.raw`const dns=require('dns').promises;(async()=>{for(const host of ['host.docker.internal','api.groq.com','evolution-redis','evolution-postgres']){try{console.log(JSON.stringify({host,lookup:await Promise.race([dns.lookup(host),new Promise((_,r)=>setTimeout(()=>r(Error('timeout')),6000))])}))}catch(e){console.log(JSON.stringify({host,error:e.message}))}}process.exit()})();`;
 try{report.containerDNS=run(['exec','-i','n8n','node'],probe).split('\n').filter(Boolean).map(l=>JSON.parse(l));}catch(e){report.containerDNS={error:'probe timeout'}}
 fs.writeFileSync('docs/current-system-audit/connectivity.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.message.replace(/gsk_[A-Za-z0-9]+/g,'[REDACTED]'));process.exitCode=1});
