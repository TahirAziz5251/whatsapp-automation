const fs=require('fs'),cp=require('child_process'),assert=require('assert/strict'),path=require('path');
const run=args=>cp.execFileSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:3*1024*1024});
const file='evolution-go/docker/examples/docker-compose.yml';
const backup=fs.readFileSync('docs/development-repair-20261001/step1-backup-path.txt','utf8').trim();
const manifest=JSON.parse(fs.readFileSync(path.join(backup,'manifest.json'),'utf8'));
assert(manifest.dpapiRoundtripVerified&&manifest.files.some(f=>f.name==='evogo_auth.dump'),'Validated backup required');
const current=JSON.parse(run(['inspect','evolution-go']))[0],config=JSON.parse(run(['compose','-f',file,'config','--format','json'])),service=config.services['evolution-go'];
const env=Object.fromEntries(current.Config.Env.map(x=>{const p=x.indexOf('=');return[x.slice(0,p),x.slice(p+1)]}));
const changedKeys=Object.keys(service.environment).filter(k=>String(service.environment[k]??'')!==String(env[k]??''));
assert.deepEqual(changedKeys,[],'Unrelated compose environment drift must be reviewed before recreation');
assert.equal(JSON.parse(run(['image','inspect',service.image]))[0].Id,current.Image,'Image must remain unchanged');
for(const m of current.Mounts){const v=service.volumes.find(v=>v.target===m.Destination);assert(v,'Missing persistent mount');assert.equal(config.volumes[v.source]?.name||v.source,m.Name||m.Source,'Persistent mount must remain unchanged')}
const original=fs.readFileSync(file,'utf8'),saved=fs.readFileSync(path.join(backup,'evolution-go_docker_examples_docker-compose.yml'),'utf8');assert(original===saved,'Compose changed since backup');
const matches=original.match(/^\s+WEBHOOK_URL:\s*"http:\/\/host\.docker\.internal:5678\/webhook\/evolution-whatsapp-agent"\s*$/gm);assert.equal(matches?.length,1,'Expected one Evolution global callback');
const updated=original.replace(/^(\s+WEBHOOK_URL:)\s*"http:\/\/host\.docker\.internal:5678\/webhook\/evolution-whatsapp-agent"\s*$/m,(_,prefix)=>prefix+' ""');
fs.writeFileSync(file,updated);
const after=JSON.parse(run(['compose','-f',file,'config','--format','json']));assert.equal(after.services['evolution-go'].environment.WEBHOOK_URL,'');
const report={at:new Date().toISOString(),backup,action:'Stage instance-only dispatch; global webhook disabled',sameImage:true,sameVolumes:true,originalEnvironmentMatches:true,changedEnvironmentKeys:['WEBHOOK_URL'],publishedWorkflowUnchanged:true};
fs.writeFileSync('docs/development-repair-20261001/step1-dispatch-design.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
