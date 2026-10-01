// Read-only audit. No workflow execution, service mutation, or credential disclosure.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'docs', 'current-system-audit');
fs.mkdirSync(out, {recursive:true});
function run(cmd,args,input) { const r=cp.spawnSync(cmd,args,{input,encoding:'utf8',timeout:60000,maxBuffer:30*1024*1024,windowsHide:true}); if(r.status!==0) throw Error((r.stderr||r.error?.message||'command failed').slice(0,500));return r.stdout.trim(); }
function save(name,data){fs.writeFileSync(path.join(out,name),redact(JSON.stringify(data,null,2)));}
function redact(s){return String(s).replace(/postgres(?:ql)?:\/\/([^:]+):[^@]+@/gi,'postgresql://$1:[REDACTED]@').replace(/(password\s*[:=]\s*)['"][^'"]+['"]/gi,'$1"[REDACTED]"').replace(/(instanceToken[^\n]{0,30}\|\|\s*)'[a-f0-9-]{36}'/gi,"$1'[REDACTED]'").replace(/gsk_[A-Za-z0-9]+/g,'[REDACTED]').replace(/\b\d{10,16}(?:@[^\s"']+)?/g,'[PHONE]');}
const local=JSON.parse(fs.readFileSync(path.join(root,'evolution_whatsapp_ai_agent_bot.json'),'utf8'));
save('local-workflow.json',{id:local.id,name:local.name,nodes:local.nodes.map(n=>({...n,parameters:JSON.parse(redact(JSON.stringify(n.parameters)))})),connections:local.connections});
const names=['n8n','evolution-go','evolution-redis','evolution-postgres'];
const containers=JSON.parse(run('docker',['inspect',...names]));
save('docker.json',containers.map(c=>({name:c.Name,image:c.Config.Image,imageId:c.Image,state:c.State,restarts:c.RestartCount,networks:c.NetworkSettings.Networks,ports:c.HostConfig.PortBindings,mounts:c.Mounts,compose:c.Config.Labels['com.docker.compose.project.config_files'],env:c.Config.Env.map(e=>{const i=e.indexOf('=');const k=e.slice(0,i);return /PASSWORD|TOKEN|KEY|SECRET|AUTHENTICATION|DATABASE_URL|CONNECTION/i.test(k)?k+'=[REDACTED]':e;})})));
const runtime=String.raw`
const fs=require('fs'),crypto=require('crypto');
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('/home/node/.n8n/database.sqlite',{readOnly:true});
const all=q=>db.prepare(q).all();
const clean=s=>String(s).replace(/postgres(?:ql)?:\/\/([^:]+):[^@]+@/gi,'postgresql://$1:[REDACTED]@').replace(/(password\s*[:=]\s*)['"][^'"]+['"]/gi,'$1"[REDACTED]"').replace(/gsk_[A-Za-z0-9]+/g,'[REDACTED]');
const hash=s=>crypto.createHash('sha256').update(String(s||'')).digest('hex').slice(0,12);
const workflows=all('select * from workflow_entity').map(w=>({id:w.id,name:w.name,active:w.active,versionId:w.versionId,activeVersionId:w.activeVersionId,updatedAt:w.updatedAt,settings:w.settings,nodes:JSON.parse(clean(w.nodes)),connections:JSON.parse(w.connections)}));
const versions=[];for(const w of workflows){if(w.activeVersionId){const v=db.prepare('select * from workflow_history where versionId=?').get(w.activeVersionId);if(v) versions.push({workflowId:w.id,versionId:v.versionId,nodes:JSON.parse(clean(v.nodes)),connections:JSON.parse(v.connections)});}}
const credentials=all('select id,name,type from credentials_entity');
const executions=all('select id,workflowId,mode,status,retryOf,startedAt,stoppedAt from execution_entity order by id desc limit 120');
let parse;try{parse=require('/usr/local/lib/node_modules/n8n/node_modules/flatted').parse}catch{}
for(const e of executions){const row=db.prepare('select data from execution_data where executionId=?').get(e.id);if(!row)continue;try{const d=parse?parse(row.data):JSON.parse(row.data);const r=d.resultData||{};e.lastNode=r.lastNodeExecuted;e.error=r.error?{message:clean(r.error.message),description:clean(r.error.description||''),node:r.error.node?.name}:null;const runs=r.runData||{};e.nodes=Object.keys(runs);const w=runs['Evolution Webhook']?.[0]?.data?.main?.[0]?.[0]?.json;const body=w?.body||{};const data=body.data||body.body?.data||{};e.event=body.event||body.type;e.instance=body.instanceName||body.instance;e.fromMe=data.IsFromMe??data.Info?.IsFromMe??data.key?.fromMe;e.messageIdHash=hash(data.ID||data.Info?.ID||data.Info?.Id||data.key?.id);e.messageTextHash=hash(data.Message?.conversation||data.Message?.extendedTextMessage?.text||data.message?.conversation);e.bodyKeys=Object.keys(body);e.dataKeys=Object.keys(data);e.infoKeys=Object.keys(data.Info||{});e.agentRuns=runs['AI Agent (Shared Engine)']?.length||0;}catch(err){e.parseError=err.message;}}
console.log(JSON.stringify({at:new Date().toISOString(),node:process.version,workflows,versions,credentials,webhooks:all('select * from webhook_entity'),executions}));db.close();
`;
try {save('n8n-runtime.json',JSON.parse(run('docker',['exec','-i','n8n','node'],runtime)));console.log('n8n runtime audit saved');}catch(e){console.log('runtime inspection failed:',e.message);}
const logStats={};for(const n of ['n8n','evolution-go']){const r=cp.spawnSync('docker',['logs','--since','48h','--tail','1500',n],{encoding:'utf8',timeout:60000,maxBuffer:20*1024*1024,windowsHide:true});const lines=(r.stdout+'\n'+r.stderr).split('\n');logStats[n]={lineCount:lines.length,matches:lines.filter(l=>/error|rate.limit|too.many|token|failed|webhook|disconnect/i.test(l)).map(l=>redact(l).replace(/("?(?:apikey|instanceToken|token)"?\s*[:=]\s*)[^,}\s]+/gi,'$1[REDACTED]')).slice(-90)};}save('logs.json',logStats);
console.log('Audit artifacts:',out);
