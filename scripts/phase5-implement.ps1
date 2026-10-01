. (Join-Path $PSScriptRoot 'phase4-common.ps1')
$out=Join-Path $Phase4Root 'docs/phase5';New-Item -ItemType Directory -Force $out|Out-Null
$accepted=Get-Content -Raw -LiteralPath (Join-Path $Phase4Root 'docs/phase4/acceptance.json')|ConvertFrom-Json
if($accepted.status -ne 'PASS_FOUNDATIONAL_DEV_SCOPE'){throw 'Phase 4 acceptance is missing'}
$identity=Invoke-Phase4Docker -Arguments @('inspect','--format','{{ index .Config.Labels "com.docker.compose.project" }}',$Phase4Container)
if($identity.code -ne 0 -or $identity.output.Trim() -ne 'business-agent-dev'){throw 'Unexpected Docker target'}
$secrets=Get-Phase4Secrets;$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$backup=Join-Path $Phase4Root "backups/phase5-$stamp";New-Item -ItemType Directory -Force $backup|Out-Null
$manifest=@{status='in_progress';target=$Phase4Container;started_at=[DateTime]::UtcNow.ToString('o');databases=@()}
function Save-Phase5 {$manifest|ConvertTo-Json -Depth 12|Set-Content -LiteralPath (Join-Path $out 'implementation.json') -Encoding utf8}
Save-Phase5
try{
 foreach($db in @('pos_db','bise_db','hospital_db')){
  $prefix=$db.Replace('_db','');$owner="${prefix}_owner";$migrator="${prefix}_migrator"
  $meta=Assert-Phase4Sql (Invoke-Phase4Sql $db "BEGIN READ ONLY; SELECT json_build_object('database',current_database(),'version',current_setting('server_version'),'owner',pg_get_userbyid(datdba),'managed',shobj_description(oid,'pg_database'),'phase4_entries',(SELECT count(*) FROM app_meta.schema_migrations WHERE version IN ('004_core','004_dummy_bootstrap')),'phase5_entries',(SELECT json_object_agg(version,checksum) FROM app_meta.schema_migrations WHERE version LIKE '005_%'),'base_tables',(SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_type='BASE TABLE')) FROM pg_database WHERE datname=current_database(); ROLLBACK;") 'Phase 5 live preflight'
  $state=($meta -split "`n"|Where-Object {$_ -match '^\{'})|ConvertFrom-Json
  if($state.managed -ne 'phase4-dev-managed' -or $state.owner -ne $owner -or $state.phase4_entries -ne 2 -or $state.version -notlike '15.*'){throw "Preflight mismatch: $db"}
  $record=@{database=$db;before=$state;status='preflight_passed'};$manifest.databases+=,$record;Save-Phase5
  $paths=@((Join-Path $Phase4Root "database/phase5/$db.sql"),(Join-Path $Phase4Root "database/phase5/$db.seed.sql"))
  $hashes=@($paths|ForEach-Object {(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()})
  if($state.phase5_entries){
   if($state.phase5_entries.'005_customer_crm' -ne $hashes[0] -or $state.phase5_entries.'005_synthetic_fixtures' -ne $hashes[1]){throw "Applied Phase 5 checksum/partial-state mismatch: $db"}
   $record.status='already_applied_checksums_match';Save-Phase5;Write-Output "${db}: Phase 5 checksum-verified; no duplicate data";continue
  }
  $dump=Invoke-Phase4Docker -Arguments @('exec',$Phase4Container,'pg_dump','-U','agent_dev','-d',$db)
  if($dump.code){throw "Pre-migration backup failed: $db"}
  $file=Join-Path $backup "$db.before.sql.dpapi";Protect-Phase4Text $file $dump.output
  $decoded=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($file),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))
  if($decoded -cne $dump.output){throw 'Backup decryption mismatch'}
  $record.backup=$file;$record.backup_roundtrip='PASS';Save-Phase5
  $body=[IO.File]::ReadAllText($paths[0])+"`n"+[IO.File]::ReadAllText($paths[1])
  $sql="BEGIN; SET LOCAL ROLE $owner; SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='45s'; SELECT pg_advisory_xact_lock(500005);`n$body`nINSERT INTO app_meta.schema_migrations(version,checksum) VALUES('005_customer_crm','$($hashes[0])'),('005_synthetic_fixtures','$($hashes[1])'); COMMIT;"
  $null=Assert-Phase4Sql (Invoke-Phase4Sql $db $sql $migrator $secrets[$migrator]) "Phase 5 atomic migration/fixtures $db"
  $record.status='committed';Save-Phase5;Write-Output "${db}: Phase 5 schema and synthetic fixtures committed atomically"
 }
 $manifest.status='implemented_pending_verification';$manifest.completed_at=[DateTime]::UtcNow.ToString('o');Save-Phase5
}catch{$manifest.status='failed';$manifest.error=$_.Exception.Message;Save-Phase5;throw}
