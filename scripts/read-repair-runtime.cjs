const cp=require('child_process'),fs=require('fs');
const c=JSON.parse(cp.execFileSync('docker',['inspect','evolution-go'],{encoding:'utf8',windowsHide:true,timeout:60000}))[0];
const env=Object.fromEntries(c.Config.Env.map(x=>{const p=x.indexOf('=');return[x.slice(0,p),x.slice(p+1)]}));
const secretValues=Object.entries(env).filter(([k])=>/KEY|TOKEN|PASSWORD|SECRET|POSTGRES/.test(k)).map(([,v])=>v).filter(v=>v.length>5);
const redact=s=>{for(const v of secretValues)s=s.split(v).join('[CONFIG_REDACTED]');return s.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi,'[DB_URI_REDACTED]').replace(/\b[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}\b/gi,'[UUID_REDACTED]').replace(/\b\d{10,16}\b/g,'[NUMBER_REDACTED]')};
const r=cp.spawnSync('docker',['logs','--timestamps','--tail','80','evolution-go'],{encoding:'utf8',windowsHide:true,timeout:60000});
const report={at:new Date().toISOString(),name:c.Name,state:c.State,globalWebhookDisabled:!env.WEBHOOK_URL,ports:c.NetworkSettings.Ports,logs:redact((r.stdout||'')+'\n'+(r.stderr||'')).split('\n').filter(l=>/error|fatal|server|listen|connect|database|start|ready/i.test(l))};
fs.writeFileSync('docs/development-repair-20261001/step1-runtime.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
