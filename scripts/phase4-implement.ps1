# Only the fixed isolated development container is supported. No production targets accepted.
. (Join-Path $PSScriptRoot 'phase4-common.ps1')
$reportDir=Join-Path $Phase4Root 'docs/phase4'
if(!(Test-Path -LiteralPath (Join-Path $reportDir 'DATABASE_ANALYSIS_REPORT.md'))){throw 'Generate and inspect the pre-implementation analysis first.'}
$version=Assert-Phase4Sql (Invoke-Phase4Sql 'agent_dev' "SELECT current_setting('server_version_num')") 'PostgreSQL compatibility check'
if([int]$version -lt 150000 -or [int]$version -ge 160000){throw 'This migration is reviewed for PostgreSQL 15 only.'}
$identity=Invoke-Phase4Docker -Arguments @('inspect','--format','{{ index .Config.Labels "com.docker.compose.project" }}',$Phase4Container)
if($identity.code -ne 0 -or $identity.output.Trim() -ne 'business-agent-dev'){throw 'Wrong development container identity'}
$manifestPath=Join-Path $reportDir 'provisioning-manifest.json'
$manifest=@{target=$Phase4Container;postgres_version_num=$version;status='in_progress';databases=@();updated_at=[DateTime]::UtcNow.ToString('o')}
function Save-Phase4Manifest {$manifest.updated_at=[DateTime]::UtcNow.ToString('o');$manifest|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $manifestPath -Encoding utf8}
$secretPath=Join-Path $Phase4Root 'development/phase4-secrets.dpapi'
if(Test-Path -LiteralPath $secretPath){$secrets=Get-Phase4Secrets}else{
 $secrets=@{}
 foreach($db in $Phase4Databases){$prefix=$db.Replace('_db','');foreach($suffix in @('runtime','migrator')){$secrets["${prefix}_${suffix}"]=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))}}
 Protect-Phase4Text $secretPath ($secrets|ConvertTo-Json -Compress)
}
Save-Phase4Manifest
try {
 # Server-local dump includes role recovery; encrypted before disk storage. No production data accessed.
 $backupDir=Join-Path $Phase4Root ('backups/phase4-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
 New-Item -ItemType Directory -Force $backupDir|Out-Null
 $dump=Invoke-Phase4Docker -Arguments @('exec',$Phase4Container,'pg_dumpall','-U','agent_dev')
 if($dump.code){throw 'Pre-migration dev backup failed'}
 $backupPath=Join-Path $backupDir 'dev-before.sql.dpapi';Protect-Phase4Text $backupPath $dump.output
 $roundtrip=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($backupPath),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))
 if($roundtrip -cne $dump.output){throw 'Backup encryption roundtrip failed'}
 $manifest.backup=@{path=$backupPath;encrypted=$true;decryption_verified=$true;full_server_restore_tested=$false}
 . (Join-Path $PSScriptRoot 'phase4-hba.ps1')
 $null=Assert-Phase4Sql (Invoke-Phase4Sql 'agent_dev' "REVOKE CONNECT, TEMPORARY ON DATABASE agent_dev, postgres FROM PUBLIC;") 'Restrict bootstrap database connections'
 foreach($db in $Phase4Databases){
  $prefix=$db.Replace('_db','');$owner="${prefix}_owner";$migrator="${prefix}_migrator";$runtime="${prefix}_runtime"
  foreach($role in @($owner,$migrator,$runtime)){
   $existing=Assert-Phase4Sql (Invoke-Phase4Sql 'agent_dev' "SELECT coalesce(shobj_description(oid,'pg_authid'),'UNMANAGED') FROM pg_roles WHERE rolname='$role'") 'Role ownership check'
   if($existing -and $existing -ne 'phase4-dev-managed'){throw "Existing unmanaged role collision: $role"}
   if(!$existing){
    $login=if($role -eq $owner){'NOLOGIN'}else{"LOGIN PASSWORD '$($secrets[$role])'"}
    $sql="SET password_encryption='scram-sha-256'; CREATE ROLE $role $login NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT; COMMENT ON ROLE $role IS 'phase4-dev-managed';"
    $null=Assert-Phase4Sql (Invoke-Phase4Sql 'agent_dev' $sql) "Create restricted role $role"
   }
  }
  $null=Assert-Phase4Sql (Invoke-Phase4Sql 'agent_dev' "GRANT $owner TO $migrator; ALTER ROLE $runtime SET statement_timeout='10s'; ALTER ROLE $runtime SET idle_in_transaction_session_timeout='15s'; ALTER ROLE $runtime SET search_path=pg_catalog,platform;") 'Configure scoped roles'
  $existing=Assert-Phase4Sql (Invoke-Phase4Sql 'agent_dev' "SELECT coalesce(shobj_description(oid,'pg_database'),'UNMANAGED') FROM pg_database WHERE datname='$db'") 'Database ownership check'
  if($existing -and $existing -ne 'phase4-dev-managed'){throw "Existing unmanaged database collision: $db"}
  if(!$existing){
   $null=Assert-Phase4Sql (Invoke-Phase4Sql 'agent_dev' "CREATE DATABASE $db OWNER $owner TEMPLATE template0 ENCODING 'UTF8';") "Create $db"
   $null=Assert-Phase4Sql (Invoke-Phase4Sql 'agent_dev' "COMMENT ON DATABASE $db IS 'phase4-dev-managed';") 'Mark managed database'
  }
  $null=Assert-Phase4Sql (Invoke-Phase4Sql 'agent_dev' "REVOKE ALL ON DATABASE $db FROM PUBLIC; GRANT CONNECT ON DATABASE $db TO $runtime,$migrator;") 'Apply database access boundary'
  $state=@{database=$db;roles=@($owner,$runtime,$migrator);status='provisioned'};$manifest.databases+=,$state;Save-Phase4Manifest
  foreach($step in @(@{name='004_core';file="$db.sql"},@{name='004_dummy_bootstrap';file="$db.seed.sql"})){
   $file=Join-Path $Phase4Root "database/phase4/$($step.file)";$body=[IO.File]::ReadAllText($file)
   $hash=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
   $exists=Assert-Phase4Sql (Invoke-Phase4Sql $db "SELECT to_regclass('app_meta.schema_migrations') IS NOT NULL") 'Check migration ledger'
   $applied=if($exists -eq 't'){Assert-Phase4Sql (Invoke-Phase4Sql $db "SELECT checksum FROM app_meta.schema_migrations WHERE version='$($step.name)'") 'Read migration ledger'}else{''}
   if($applied){if($applied -ne $hash){throw "Migration checksum mismatch: $db / $($step.name)"};Write-Output "$db / $($step.name): already applied; checksum verified";continue}
   $sql="BEGIN; SET LOCAL ROLE $owner; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'; SELECT pg_advisory_xact_lock(400004);`n$body`nINSERT INTO app_meta.schema_migrations(version,checksum) VALUES('$($step.name)','$hash'); COMMIT;"
   $null=Assert-Phase4Sql (Invoke-Phase4Sql $db $sql $migrator $secrets[$migrator]) "Transactional migration $db / $($step.name)"
   Write-Output "$db / $($step.name): committed"
  }
  $state.status='migrated_and_seeded';Save-Phase4Manifest
 }
 # Offline fixture loader applied corresponding configuration events to all domains.
 $null=Assert-Phase4Sql (Invoke-Phase4Sql 'control_db' "UPDATE platform.configuration_outbox SET status='delivered',attempts=1 WHERE event_type='config.bootstrap' AND status='pending';") 'Acknowledge synthetic bootstrap events'
 $manifest.status='implemented_pending_tests';Save-Phase4Manifest
 Write-Output 'Phase 4 dev provisioning completed. Runtime verification is still required. No workflow changed.'
}catch{$manifest.status='failed';$manifest.failure=$_.Exception.Message;Save-Phase4Manifest;throw}
