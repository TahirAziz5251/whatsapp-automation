const fs=require('fs'),cp=require('child_process'),crypto=require('crypto'),path=require('path');
const run=(args,input)=>cp.execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout:45000,maxBuffer:4*1024*1024});
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const report={at:new Date().toISOString(),tests:[]};const check=(name,pass,evidence)=>report.tests.push({name,status:pass?'PASS':'FAIL',evidence});
const before=JSON.parse(fs.readFileSync('docs/development-repair-20261001/step2-docker-before.json','utf8'));
const backup=fs.readFileSync('docs/development-repair-20261001/step2-backup-path.txt','utf8').trim();
const baseline=JSON.parse(fs.readFileSync(path.join(backup,'workflow-and-published.json'),'utf8'));
const current=JSON.parse(run(['inspect','n8n','evolution-go','evolution-redis','evolution-postgres']));
for(const c of current.filter(c=>c.Name!=='/evolution-postgres')){
 const old=before.containers.find(o=>o.name===c.Name.slice(1));
 check(c.Name+' healthy',c.State.Status==='running'&&c.State.Health?.Status==='healthy',{status:c.State.Status,health:c.State.Health?.Status});
 check(c.Name+' image unchanged',c.Image===old.imageId,{image:c.Image});
 const mounts=c.Mounts.map(m=>({type:m.Type,name:m.Name,target:m.Destination})).sort((a,b)=>a.target.localeCompare(b.target));
 const previous=old.mounts.map(m=>({type:m.type,name:m.name,target:m.target})).sort((a,b)=>a.target.localeCompare(b.target));
 check(c.Name+' persistent mounts preserved',hash(mounts)===hash(previous),mounts);
 check(c.Name+' restart policy preserved',c.HostConfig.RestartPolicy.Name===old.restart.Name,c.HostConfig.RestartPolicy);
 check(c.Name+' bounded Docker logs',c.HostConfig.LogConfig.Config['max-size']==='10m'&&c.HostConfig.LogConfig.Config['max-file']==='3',c.HostConfig.LogConfig);
 check(c.Name+' shared service network',Object.hasOwn(c.NetworkSettings.Networks,'ai-automation_evolution_network'),Object.keys(c.NetworkSettings.Networks));
}
check('Legacy PostgreSQL remains stopped',current.find(c=>c.Name==='/evolution-postgres').State.Status==='exited');
const redis=current.find(c=>c.Name==='/evolution-redis');check('Redis published only on loopback',redis.HostConfig.PortBindings['6379/tcp'].every(p=>p.HostIp==='127.0.0.1'),redis.HostConfig.PortBindings);
const evo=current.find(c=>c.Name==='/evolution-go');check('Global callback remains disabled',evo.Config.Env.includes('WEBHOOK_URL='));
const all=run(['ps','-a','--format','{{.Names}}']).trim().split('\n');check('No stalled replacement containers',!all.some(n=>/^[a-f0-9]{12}_(n8n|evolution-go|evolution-redis)$/.test(n)));
const sentinel=run(['exec','evolution-redis','redis-cli','GET','dev:step2:restart-check']).trim();check('Redis dummy key survived recreation',sentinel==='step2-20261001');
const persistence=run(['exec','evolution-redis','redis-cli','INFO','persistence']);check('Redis AOF enabled and writes healthy',/aof_enabled:1/.test(persistence)&&/aof_last_write_status:ok/.test(persistence));
const script=String.raw`const {DatabaseSync}=require('node:sqlite'),crypto=require('crypto');const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');const db=new DatabaseSync('/home/node/.n8n/database.sqlite',{readOnly:true});const w=db.prepare('select * from workflow_entity where id=?').get('Ag4HbAjKlfHH6Xk7');const h=db.prepare('select * from workflow_history where versionId=?').get(w.activeVersionId);console.log(JSON.stringify({active:w.active,version:w.activeVersionId,publishedHash:hash([JSON.parse(h.nodes),JSON.parse(h.connections)]),entityHash:hash([JSON.parse(w.nodes),JSON.parse(w.connections)]),quickCheck:db.prepare('PRAGMA quick_check').get(),webhooks:db.prepare('select method,webhookPath from webhook_entity where workflowId=?').all(w.id)}));db.close();`;
try{const actual=JSON.parse(run(['exec','-i','n8n','node'],script));check('Published workflow unchanged',actual.version===baseline.workflow.activeVersionId&&actual.publishedHash===hash([baseline.published.nodes,baseline.published.connections]),actual);check('Draft workflow unchanged',actual.entityHash===hash([baseline.workflow.nodes,baseline.workflow.connections]));check('Workflow active and webhook retained',actual.active===1&&actual.webhooks.some(w=>w.method==='POST'&&w.webhookPath==='evolution-whatsapp-agent'));check('SQLite integrity',Object.values(actual.quickCheck)[0]==='ok');}catch{check('Workflow and SQLite verification',false,'Read-only snapshot failed');}
const pg=cp.spawnSync('docker',['exec','evolution-go','nc','-z','-w','5','host.docker.internal','5432'],{encoding:'utf8',windowsHide:true,timeout:15000});check('Evolution can reach native PostgreSQL',pg.status===0);
report.pass=report.tests.every(t=>t.status==='PASS');fs.writeFileSync('docs/development-repair-20261001/step2-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
