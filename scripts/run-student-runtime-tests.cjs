const fs=require('fs'),cp=require('child_process');
const workflow=JSON.parse(fs.readFileSync('scratch/student-remediation/workflow.json','utf8'));
const connection=workflow.nodes.find(n=>n.name==='Tool: Business Data Gateway').parameters.jsCode.match(/connectionString:("(?:[^"\\]|\\.)*")/)[1];
const payload={workflow,readonlyUrl:JSON.parse(connection)+'/bise_db'};
const script=fs.readFileSync('scripts/test-student-remediation-runtime.cjs','utf8');
const r=cp.spawnSync('docker',['exec','-i','n8n','node','-e',script],{input:JSON.stringify(payload),encoding:'utf8',windowsHide:true,timeout:300000,maxBuffer:1024*1024});
if(r.stdout.trim()){const report=JSON.parse(r.stdout.trim());fs.writeFileSync('docs/current-system-audit/remediation-runtime-tests.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}else console.log('Runtime test did not produce a report:',r.error?.message||r.stderr.slice(-300));
process.exitCode=r.status===null?1:r.status;
