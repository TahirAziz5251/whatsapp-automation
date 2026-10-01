param([string]$Workspace='D:\AI-Automation')
$ErrorActionPreference='Stop'
$outDir=Join-Path $Workspace 'docs/phase2'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$sql=@'
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
SELECT json_build_object(
 'database',current_database(), 'version',current_setting('server_version'),
 'read_only',current_setting('transaction_read_only'),
 'columns',(SELECT json_agg(json_build_object('schema',table_schema,'table',table_name,'column',column_name,'position',ordinal_position,'type',udt_name,'nullable',is_nullable) ORDER BY table_schema,table_name,ordinal_position) FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema')),
 'constraints',(SELECT json_agg(json_build_object('schema',n.nspname,'table',t.relname,'name',c.conname,'type',c.contype,'definition',pg_get_constraintdef(c.oid)) ORDER BY n.nspname,t.relname,c.conname) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema')),
 'indexes',(SELECT json_agg(json_build_object('schema',schemaname,'table',tablename,'name',indexname,'definition',indexdef)) FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog','information_schema')),
 'security',(SELECT json_agg(json_build_object('schema',n.nspname,'table',t.relname,'rls',t.relrowsecurity,'force_rls',t.relforcerowsecurity,'owner',pg_get_userbyid(t.relowner))) FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE t.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema')),
 'roles',(SELECT json_agg(json_build_object('role',rolname,'superuser',rolsuper,'login',rolcanlogin,'bypass_rls',rolbypassrls)) FROM pg_roles WHERE rolname NOT LIKE 'pg_%'),
 'grants',(SELECT json_agg(json_build_object('schema',table_schema,'table',table_name,'grantee',grantee,'privilege',privilege_type)) FROM information_schema.table_privileges WHERE table_schema NOT IN ('pg_catalog','information_schema')),
 'extensions',(SELECT json_agg(json_build_object('name',extname,'version',extversion)) FROM pg_extension),
 'vector_available',EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='vector')
);
ROLLBACK;
'@
$targets=@(
 @{container='evolution-postgres';user='postgres';db='evogo_auth'},
 @{container='evolution-postgres';user='postgres';db='evogo_users'},
 @{container='evolution-postgres';user='postgres';db='postgres'},
 @{container='business-agent-dev-postgres-1';user='agent_dev';db='agent_dev'}
)
$evidence=@()
foreach($t in $targets){
 $lines=& docker exec $t.container psql -X -U $t.user -d $t.db -v ON_ERROR_STOP=1 -Atc $sql
 if($LASTEXITCODE -ne 0){throw "Metadata discovery failed: $($t.db)"}
 $record=($lines | Where-Object {$_ -match '^\{'})|ConvertFrom-Json
 if($record.read_only -ne 'on'){throw 'Read-only transaction check failed'}
 $evidence+=$record
 Write-Output "$($t.db): metadata collected under read-only transaction"
}
$evidence|ConvertTo-Json -Depth 20|Set-Content -LiteralPath (Join-Path $outDir 'database-metadata.json') -Encoding utf8

# Export only node types/names and one-way comparison hashes, never code or credentials.
$js=@'
const fs=require('fs'),crypto=require('crypto');
const s=require('/usr/local/lib/node_modules/n8n/node_modules/sqlite3');
const db=new s.Database('/home/node/.n8n/database.sqlite',s.OPEN_READONLY);
const stable=x=>Array.isArray(x)?x.map(stable):(x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x);
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(stable(x))).digest('hex');
const arr=x=>typeof x==='string'?JSON.parse(x):x;
function summary(nodes,connections){nodes=arr(nodes);return {nodes:nodes.map(n=>({name:n.name,type:n.type,typeVersion:n.typeVersion})),definitionHash:hash({nodes:nodes.map(n=>({name:n.name,type:n.type,typeVersion:n.typeVersion,parameters:n.parameters})).sort((a,b)=>a.name.localeCompare(b.name)),connections:arr(connections)}),faissReferenced:JSON.stringify(nodes).includes('faiss-service'),oldNodeReference:JSON.stringify(nodes).includes('Extract Message Data1')};}
db.get('SELECT * FROM workflow_entity WHERE id=?',['Iin5wt0nRAhO7UV9'],(e,r)=>{
 if(e||!r){console.error('Requested workflow not available');db.close();process.exitCode=1;return;}
 const output={id:r.id,active:!!r.active,versionId:r.versionId,activeVersionId:r.activeVersionId||null,storedDefinition:summary(r.nodes,r.connections)};
 if(!r.activeVersionId){console.log(JSON.stringify(output));db.close();return;}
 db.get('SELECT nodes,connections FROM workflow_history WHERE versionId=? AND workflowId=?',[r.activeVersionId,r.id],(e,v)=>{
  if(e||!v){output.publishedDefinitionVerified=false;}else{output.publishedDefinitionVerified=true;output.publishedDefinition=summary(v.nodes,v.connections);}
  console.log(JSON.stringify(output));db.close();
 });
});
'@
$workflow=& docker exec n8n node -e $js
if($LASTEXITCODE -ne 0){throw 'Workflow metadata read failed'}
$workflow|ConvertFrom-Json|ConvertTo-Json -Depth 10|Set-Content -LiteralPath (Join-Path $outDir 'workflow-metadata.json') -Encoding utf8
Write-Output 'Sanitized workflow metadata saved; no message/customer records exported.'
