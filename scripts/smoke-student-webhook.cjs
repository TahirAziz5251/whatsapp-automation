const fs=require('fs');
(async()=>{
 const health=await fetch('http://127.0.0.1:5678/healthz/readiness',{signal:AbortSignal.timeout(10000)});
 if(!health.ok)throw Error('n8n is not ready');
 const id='audit-ignored-self-'+Date.now();
 const payload={event:'Message',instanceName:'student-assistant',data:{Info:{ID:id,IsFromMe:true,Chat:'status@broadcast'},Message:{conversation:'Audit ignored self-message'}}};
 const r=await fetch('http://127.0.0.1:5678/webhook/evolution-whatsapp-agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
 const report={at:new Date().toISOString(),synthetic:true,expected:'No Operation, do nothing; no AI or outbound message',httpStatus:r.status,messageIdHash:require('crypto').createHash('sha256').update(id).digest('hex').slice(0,12)};
 fs.writeFileSync('docs/current-system-audit/webhook-smoke.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!r.ok)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1});
