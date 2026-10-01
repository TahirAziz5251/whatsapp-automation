const fs=require('fs'),cp=require('child_process'),path=require('path');
(async()=>{
 const dir=fs.readFileSync('docs/development-repair-20261001/step1-backup-path.txt','utf8').trim();
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
 for(const f of ['evogo_users.dump','evogo_auth.dump','workflow-and-published.json'])if(!manifest.files.some(x=>x.name===f&&x.bytes>0))throw Error('Required backup missing');
 const c=JSON.parse(cp.execFileSync('docker',['inspect','evolution-go'],{encoding:'utf8',windowsHide:true,timeout:60000}))[0];
 const env=Object.fromEntries(c.Config.Env.map(x=>{const p=x.indexOf('=');return[x.slice(0,p),x.slice(p+1)]}));
 const api=async(url,key,body)=>{const r=await fetch('http://127.0.0.1:4000'+url,{method:body?'POST':'GET',headers:{apikey:key,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});return {httpStatus:r.status,body:await r.json()}};
 const all=await api('/instance/all',env.GLOBAL_API_KEY),i=all.body.data.find(i=>i.name==='student-assistant');if(!i)throw Error('Student instance missing');
 const number=String(i.jid||'').split('@')[0].split(':')[0];if(number!=='923127118485')throw Error('Stored account does not match the user-designated student number');
 const token=i.token||i.Token||i.instanceToken;const status=async()=>{const r=await api('/instance/status',token);return {httpStatus:r.httpStatus,connected:r.body.data?.Connected,loggedIn:r.body.data?.LoggedIn}};
 const report={at:new Date().toISOString(),instance:i.name,backup:dir,before:await status()};
 if(!report.before.connected||!report.before.loggedIn){const r=await api('/instance/forcereconnect/'+i.id,env.GLOBAL_API_KEY,{number});report.reconnect={httpStatus:r.httpStatus,message:r.body.message||r.body.error};}
 report.after=await status();report.pass=Boolean(report.after.connected&&report.after.loggedIn);
 fs.writeFileSync('docs/development-repair-20261001/step1-reconnect.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.message.replace(/gsk_[\w-]+/g,'[REDACTED]'));process.exitCode=1});
