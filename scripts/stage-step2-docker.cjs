const fs=require('fs'),cp=require('child_process'),assert=require('assert/strict'),path=require('path');
const run=args=>cp.execFileSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:45000,maxBuffer:4*1024*1024});
const backup=fs.readFileSync('docs/development-repair-20261001/step2-backup-path.txt','utf8').trim();
const manifest=JSON.parse(fs.readFileSync(path.join(backup,'manifest.json'),'utf8').replace(/^\uFEFF/,''));
assert(manifest.dpapiRoundtripVerified&&manifest.files.some(f=>f.name==='evogo_auth.dump'),'Verified backup required');
const rootFile='docker-compose.yml',evoFile='evolution-go/docker/examples/docker-compose.yml';
let root=fs.readFileSync(rootFile,'utf8'),evo=fs.readFileSync(evoFile,'utf8');
assert(root===fs.readFileSync(path.join(backup,'docker-compose.yml'),'utf8'),'Root Compose changed after backup');
assert(evo===fs.readFileSync(path.join(backup,'evolution-go_docker_examples_docker-compose.yml'),'utf8'),'Evolution Compose changed after backup');
const containers=JSON.parse(run(['inspect','n8n','evolution-go','evolution-redis']));
const oldConfigs=[rootFile,evoFile].map(file=>JSON.parse(run(['compose','-f',file,'config','--format','json'])));
const log='    logging:\n      driver: json-file\n      options:\n        max-size: "10m"\n        max-file: "3"\n';
function service(text,name,fn){const re=new RegExp('(^  '+name+':\\r?\\n)([\\s\\S]*?)(?=^  [a-zA-Z0-9_-]+:\\r?$|^volumes:|^networks:|(?![\\s\\S]))','m');let hits=0;const result=text.replace(re,(_,header,body)=>{hits++;return header+fn(body.replace(/\r\n/g,'\n'))});assert.equal(hits,1,'Service block not found: '+name);return result;}
function image(body,name){const c=containers.find(c=>c.Name==='/'+name);const i=JSON.parse(run(['image','inspect',c.Image]))[0];const digest=i.RepoDigests[0];assert(digest&&digest.endsWith(c.Image.split(':')[1]),'Image identity mismatch');return body.replace(/^    image:.*$/m,'    image: '+digest);}
root=root.replace(/^version:.*\r?\n\r?\n/,'');evo=evo.replace(/^version:.*\r?\n\r?\n/,'');
for(const [name,profile] of [['evolution-go','legacy-alternative'],['postgres','legacy-postgres'],['faiss-service','optional-kb']])root=service(root,name,b=>'    profiles: ["'+profile+'"]\n'+b);
root=service(root,'n8n',b=>image(b,'n8n')+log+'    healthcheck:\n      test: ["CMD", "node", "-e", "fetch(\'http://127.0.0.1:5678/healthz/readiness\',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]\n      interval: 30s\n      timeout: 6s\n      retries: 5\n      start_period: 120s\n\n');
root=service(root,'redis',b=>image(b,'evolution-redis').replace('"6379:6379"','"127.0.0.1:6379:6379"')+log+'    healthcheck:\n      test: ["CMD", "redis-cli", "ping"]\n      interval: 30s\n      timeout: 5s\n      retries: 3\n      start_period: 10s\n\n');
for(const [name,profile] of [['n8n','legacy-alternative'],['postgres','legacy-postgres']])evo=service(evo,name,b=>'    profiles: ["'+profile+'"]\n'+b);
evo=service(evo,'evolution-go',b=>image(b,'evolution-go').replace(/^      WEBHOOK_URL:.*$/m,'      WEBHOOK_URL: ""').replace('    networks:\n      - evolution_network','    networks:\n      - evolution_network\n      - automation_shared')+log+'    healthcheck:\n      test: ["CMD", "wget", "-q", "-T", "4", "-O", "/dev/null", "http://127.0.0.1:4000/server/ok"]\n      interval: 30s\n      timeout: 6s\n      retries: 5\n      start_period: 120s\n\n');
evo=evo.replace(/^networks:\r?\n/m,'networks:\n  automation_shared:\n    external: true\n    name: ai-automation_evolution_network\n');
fs.writeFileSync('docs/development-repair-20261001/step2-design.json',JSON.stringify({at:new Date().toISOString(),backup,changes:['Keep existing image digests and persistent volume names','Add Evolution to existing n8n/Redis network through external Compose network','Preserve instance-only dispatch and disable stale global callback in Compose','Gate unused conflicting services behind explicit profiles','Add readiness/liveness health checks and bounded Docker logs','Bind Redis host port to loopback; preserve current application host routes'],productionGaps:['TLS/reverse proxy and app port restrictions remain a separate production deployment requirement','Native PostgreSQL least privilege and host firewall need Step 3 review','Health checks report failures; they do not automatically restart unhealthy services']},null,2));
try{
 fs.writeFileSync(rootFile,root);fs.writeFileSync(evoFile,evo);
 const next=[rootFile,evoFile].map(file=>JSON.parse(run(['compose','-f',file,'config','--format','json'])));
 for(let j=0;j<2;j++)for(const [name,s] of Object.entries(next[j].services)){const old=oldConfigs[j].services[name];assert.deepEqual(s.volumes,old.volumes,'Volume declarations must be preserved');const expected={...old.environment};if(j===1&&name==='evolution-go')expected.WEBHOOK_URL='';assert(JSON.stringify(s.environment||{})===JSON.stringify(expected),'Unexpected environment change');}
 const defaults=next.map(c=>Object.keys(c.services).filter(k=>!(c.services[k].profiles||[]).length));
 assert.deepEqual(defaults[0].sort(),['n8n','redis']);
 assert.deepEqual(defaults[1],['evolution-go']);
 console.log(JSON.stringify({staged:true,backup,rootDefaultServices:defaults[0],evolutionDefaultServices:defaults[1],preservedVolumes:true,preservedCredentials:true}));
}catch(e){fs.copyFileSync(path.join(backup,'docker-compose.yml'),rootFile);fs.copyFileSync(path.join(backup,'evolution-go_docker_examples_docker-compose.yml'),evoFile);throw e}
