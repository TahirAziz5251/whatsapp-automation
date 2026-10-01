param([ValidateSet('before','after')][string]$Stage='before')
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$out=Join-Path $root 'docs/phase4'
New-Item -ItemType Directory -Force $out | Out-Null
$query=@'
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
SELECT json_build_object(
 'database',current_database(),'version',current_setting('server_version'),'read_only',current_setting('transaction_read_only'),
 'schemas',(SELECT json_agg(nspname ORDER BY nspname) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema'),
 'tables',(SELECT json_agg(json_build_object('schema',table_schema,'table',table_name) ORDER BY table_schema,table_name) FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema')),
 'columns',(SELECT json_agg(json_build_object('schema',table_schema,'table',table_name,'column',column_name,'position',ordinal_position,'type',data_type,'udt',udt_name,'nullable',is_nullable,'default',column_default) ORDER BY table_schema,table_name,ordinal_position) FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema')),
 'constraints',(SELECT json_agg(json_build_object('schema',n.nspname,'table',t.relname,'name',c.conname,'type',c.contype,'definition',pg_get_constraintdef(c.oid)) ORDER BY n.nspname,t.relname,c.conname) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema')),
 'security',(SELECT json_agg(json_build_object('schema',n.nspname,'table',t.relname,'owner',pg_get_userbyid(t.relowner),'rls',t.relrowsecurity,'force_rls',t.relforcerowsecurity)) FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE t.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema')),
 'extensions',(SELECT json_agg(json_build_object('name',extname,'version',extversion)) FROM pg_extension),
 'vector_available',EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='vector'));
ROLLBACK;
'@
$targets=@(@{container='evolution-postgres';user='postgres';db='evogo_auth'},@{container='evolution-postgres';user='postgres';db='evogo_users'},@{container='evolution-postgres';user='postgres';db='postgres'},@{container='business-agent-dev-postgres-1';user='agent_dev';db='agent_dev'})
$names=& docker exec business-agent-dev-postgres-1 psql -X -U agent_dev -d agent_dev -Atc "SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY datname"
if($LASTEXITCODE){throw 'Dev database discovery failed'}
foreach($db in @('control_db','pos_db','bise_db','hospital_db')){if($names -contains $db){$targets+=@{container='business-agent-dev-postgres-1';user='agent_dev';db=$db}}}
$records=@()
foreach($t in $targets){
 $lines=$query | & docker exec -i $t.container psql -X -U $t.user -d $t.db -v ON_ERROR_STOP=1 -At
 if($LASTEXITCODE){throw "Read-only catalog analysis failed for $($t.db)"}
 $record=($lines|Where-Object {$_ -match '^\{'})|ConvertFrom-Json
 if($record.read_only -ne 'on'){throw 'Read-only metadata gate failed'}
 $record|Add-Member -NotePropertyName container -NotePropertyValue $t.container
 $records+=$record
}
@{stage=$Stage;captured_at=[DateTime]::UtcNow.ToString('o');development_databases=@($names);records=$records}|ConvertTo-Json -Depth 30|Set-Content -LiteralPath (Join-Path $out "$Stage-metadata.json") -Encoding utf8
Write-Output "$Stage metadata captured: $($records.Count) databases; no business rows read."
