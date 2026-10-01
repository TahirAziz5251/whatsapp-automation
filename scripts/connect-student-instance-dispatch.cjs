const fs=require('fs'),cp=require('child_process');
(async()=>{
 const backup=fs.readFileSync('docs/development-repair-20261001/step1-backup-path.txt','utf8').trim();if(!fs.existsSync(backup+'/manifest.json'))throw Error('Validated backup required');
 const c=JSON.parse(cp.execFileSync('docker',['inspect','evolution-go'],{encoding:'utf8',windowsHide:true,timeout:60000}))[0];const env=Object.fromEntries(c.Config.Env.map(x=>{const p=x.indexOf('=');return[x.slice(0,p),x.slice(p+1)]}));if(env.WEBHOOK_URL)throw Error('Global callback must be disabled before enabling instance dispatch');
 const api=async(url,key,body)=>{const r=await fetch('http://127.0.0.1:4000'+url,{method:body?'POST':'GET',headers:{apikey:key,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});return {status:r.status,body:await r.json()}};
 const all=await api('/instance/all',env.GLOBAL_API_KEY),i=all.body.data?.find(i=>i.name==='student-assistant');if(!i)throw Error('Student instance missing');const token=i.token||i.Token||i.instanceToken;
 const report={at:new Date().toISOString(),backup,instance:i.name,beforeWebhook:i.webhook,globalWebhookDisabled:true};
 const r=await api('/instance/connect',token,{webhookUrl:'http://host.docker.internal:5678/webhook/evolution-whatsapp-agent',subscribe:(i.events||'MESSAGE').split(','),immediate:true,rabbitmqEnable:i.rabbitmqEnable,websocketEnable:i.websocketEnable,natsEnable:i.natsEnable});report.connectHttpStatus=r.status;
 const current=(await api('/instance/all',env.GLOBAL_API_KEY)).body.data.find(x=>x.id===i.id),s=await api('/instance/status',token);report.instanceWebhook=current.webhook;report.events=current.events;report.connected=s.body.data?.Connected;report.loggedIn=s.body.data?.LoggedIn;report.dispatchConfigured=r.status===200&&Boolean(current.webhook)&&!env.WEBHOOK_URL;report.sessionReady=Boolean(report.connected&&report.loggedIn);
 fs.writeFileSync('docs/development-repair-20261001/step1-dispatch-applied.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1});
