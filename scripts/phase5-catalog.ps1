. (Join-Path $PSScriptRoot 'phase4-common.ps1')
$records=@()
foreach($db in $Phase4Databases){
 $query=@'
BEGIN READ ONLY;
SELECT json_build_object('database',current_database(),'version',current_setting('server_version'),
'tables',(SELECT json_agg(json_build_object('schema',n.nspname,'table',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN ('platform','crm','app_meta')),
'columns',(SELECT json_agg(json_build_object('schema',table_schema,'table',table_name,'column',column_name,'type',udt_name,'nullable',is_nullable) ORDER BY table_schema,table_name,ordinal_position) FROM information_schema.columns WHERE table_schema IN ('platform','crm','app_meta')),
'constraints',(SELECT json_agg(json_build_object('schema',n.nspname,'table',c.relname,'type',k.contype,'definition',pg_get_constraintdef(k.oid))) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('platform','crm')));
ROLLBACK;
'@
 $r=Assert-Phase4Sql (Invoke-Phase4Sql $db $query) 'Read Phase 5 actual catalog'
 $record=($r -split "`n"|Where-Object {$_ -match '^\{'})|ConvertFrom-Json
 if($db -ne 'control_db'){
  $crm=if($db -eq 'pos_db'){",'leads',(SELECT count(*) FROM crm.leads),'lead_events',(SELECT count(*) FROM crm.lead_events),'stages',(SELECT json_object_agg(stage,n) FROM (SELECT stage,count(*) n FROM crm.leads GROUP BY stage) s)"}else{''}
  $q="SELECT json_build_object('contacts',(SELECT count(*) FROM platform.contacts),'identities',(SELECT count(*) FROM platform.channel_identities),'blocked',(SELECT count(*) FROM platform.contacts WHERE status='blocked'),'synthetic_identities',(SELECT count(*) FROM platform.channel_identities WHERE jid LIKE '%@example.invalid' AND address_kind='synthetic'),'businesses',(SELECT count(DISTINCT business_id) FROM platform.contacts)$crm);"
  $counts=Assert-Phase4Sql (Invoke-Phase4Sql $db $q) 'Read synthetic fixture counts'
  $record|Add-Member -NotePropertyName fixtures -NotePropertyValue ($counts|ConvertFrom-Json)
 }
 $records+=,$record
}
@{captured_at=[DateTime]::UtcNow.ToString('o');records=$records}|ConvertTo-Json -Depth 30|Set-Content -LiteralPath (Join-Path $Phase4Root 'docs/phase5/database-metadata.json') -Encoding utf8
Write-Output 'Phase 5 actual catalog and synthetic fixture counts captured.'
