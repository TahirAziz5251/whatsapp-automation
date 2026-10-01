# Isolated synthetic database restore drill. No outbound services connect to these temporary DBs.
param([ValidateSet('control_db','pos_db','bise_db','hospital_db')][string[]]$Only=@('control_db','pos_db','bise_db','hospital_db'),[switch]$ResumeTimedOutCreations)
. (Join-Path $PSScriptRoot 'phase4-common.ps1')
$secrets=Get-Phase4Secrets
$fixtures=Get-Content -Raw -LiteralPath (Join-Path $Phase4Root 'database/phase4/fixtures.json')|ConvertFrom-Json
$dest=Join-Path $Phase4Root ('backups/phase4-restore-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Force $dest|Out-Null
$results=@();$started=[DateTime]::UtcNow
$previousReport=Join-Path $Phase4Root 'docs/phase4/restore-verification.json'
if($Only.Count -lt 4 -and (Test-Path -LiteralPath $previousReport)){$results=@((Get-Content -Raw -LiteralPath $previousReport|ConvertFrom-Json).results|Where-Object {$_.database -notin $Only})}
foreach($db in $Only){
 $restore="phase4_restore_$db";$created=$false;$prefix=$db.Replace('_db','');$role="${prefix}_runtime";$owner="${prefix}_owner"
 $record=@{database=$db;temporary_database=$restore;status='FAIL';cleanup='not_created'}
 try{
  if($restore -notin @('phase4_restore_control_db','phase4_restore_pos_db','phase4_restore_bise_db','phase4_restore_hospital_db')){throw 'Invalid recovery target'}
  $exists=Assert-Phase4Sql (Invoke-Phase4Sql 'agent_dev' "SELECT count(*) FROM pg_database WHERE datname='$restore'") 'Restore target check'
  $resume=$false
  if($exists -ne '0'){
   if(!$ResumeTimedOutCreations){throw "Recovery target already exists; refusing to overwrite $restore"}
   $prior=(Get-Content -Raw -LiteralPath $previousReport|ConvertFrom-Json).results|Where-Object {$_.database -eq $db -and $_.temporary_database -eq $restore -and $_.status -eq 'FAIL' -and $_.error -match 'Create isolated restore target failed.*124'}
   if(!$prior){throw 'No matching recorded timeout authorizes recovery of this temporary target'}
   $valid=Assert-Phase4Sql (Invoke-Phase4Sql 'agent_dev' "SELECT pg_get_userbyid(datdba)='$owner' AND shobj_description(oid,'pg_database') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname='$restore') FROM pg_database WHERE datname='$restore';") 'Validate uncertain restore target ownership'
   $empty=Assert-Phase4Sql (Invoke-Phase4Sql $restore "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f');") 'Validate uncertain restore target is empty'
   if($valid -ne 't' -or $empty -ne '0'){throw 'Uncertain target is not the expected empty inactive restore database; refusing reuse'}
   $resume=$true
  }
  $dump=Invoke-Phase4Docker -Arguments @('exec',$Phase4Container,'pg_dump','-U','agent_dev','-d',$db)
  if($dump.code){throw 'Database dump failed'}
  $file=Join-Path $dest "$db.sql.dpapi";Protect-Phase4Text $file $dump.output
  $restoredText=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($file),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))
  if($restoredText -cne $dump.output){throw 'Encrypted backup roundtrip mismatch'}
  if(!$resume){$null=Assert-Phase4Sql (Invoke-Phase4Sql 'agent_dev' "CREATE DATABASE $restore OWNER $owner TEMPLATE template0;") 'Create isolated restore target'}
  $created=$true
  $null=Assert-Phase4Sql (Invoke-Phase4Sql 'agent_dev' "COMMENT ON DATABASE $restore IS 'phase4-disposable-restore'; REVOKE ALL ON DATABASE $restore FROM PUBLIC; GRANT CONNECT ON DATABASE $restore TO $role;") 'Restrict restore access'
  $null=Assert-Phase4Sql (Invoke-Phase4Sql $restore $restoredText) 'Restore encrypted dump'
  $tables=@('platform.businesses','platform.instances','platform.audit_events',$(if($db -eq 'control_db'){'platform.configuration_outbox'}else{'platform.configuration_inbox'}),'app_meta.schema_migrations')
  foreach($table in $tables){
   $key=if($table -eq 'app_meta.schema_migrations'){'version'}else{'id'}
   $sql="SELECT md5(coalesce(string_agg(row_to_json(t)::text,',' ORDER BY $key),'')) FROM $table t;"
   $source=Assert-Phase4Sql (Invoke-Phase4Sql $db $sql) 'Source fingerprint'
   $copy=Assert-Phase4Sql (Invoke-Phase4Sql $restore $sql) 'Restored fingerprint'
   if($source -ne $copy){throw "Restored content differs: $table"}
  }
  $rls=Assert-Phase4Sql (Invoke-Phase4Sql $restore "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='platform' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='$owner'") 'Restored RLS check'
  if($rls -ne '4'){throw 'Restored table ownership/RLS differs'}
  $none=Assert-Phase4Sql (Invoke-Phase4Sql $restore 'SELECT count(*) FROM platform.businesses' $role $secrets[$role]) 'Restored runtime no-scope query'
  if($none -ne '0'){throw 'Restored database discloses unscoped tenants'}
  $a=($fixtures|Where-Object {$db -eq 'control_db' -or $_.db -eq $db}|Select-Object -First 1).business
  $scoped=Assert-Phase4Sql (Invoke-Phase4Sql $restore "BEGIN; SET LOCAL app.business_id='$a'; SELECT count(*) FROM platform.businesses;" $role $secrets[$role]) 'Restored runtime scoped query'
  if(($scoped -split "`n")[-1].Trim() -ne '1'){throw 'Restored scoped query differs'}
  $record.status='PASS';$record.encrypted_backup=$file;$record.tables_compared=$tables.Count;$record.runtime_rls_verified=$true
 }catch{$record.error=$_.Exception.Message}finally{
  if($created){
   $marker=Assert-Phase4Sql (Invoke-Phase4Sql 'agent_dev' "SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname='$restore'") 'Disposable target ownership check'
   if($marker -eq 'phase4-disposable-restore'){$null=Assert-Phase4Sql (Invoke-Phase4Sql 'agent_dev' "DROP DATABASE $restore;") 'Remove verified disposable restore target';$record.cleanup='removed'}else{$record.cleanup='retained_marker_mismatch';$record.status='FAIL'}
  }
 }
 $results+=,$record;Write-Output "$db restore drill: $($record.status), temporary target $($record.cleanup)"
 if($record.error){Write-Output "Restore diagnostic: $($record.error)"}
}
$report=@{scope='Four individual synthetic dev database logical restore drills on the same server with existing cluster roles. Not off-machine/full-server recovery, coordinated live four-DB PITR, pgvector/BM25 rebuild or external-effect reconciliation.';started_at=$started.ToString('o');duration_seconds=([DateTime]::UtcNow-$started).TotalSeconds;results=$results;passed=@($results|Where-Object status -eq 'PASS').Count;failed=@($results|Where-Object status -ne 'PASS').Count}
$report|ConvertTo-Json -Depth 10|Set-Content -LiteralPath (Join-Path $Phase4Root 'docs/phase4/restore-verification.json') -Encoding utf8
if($report.failed){throw 'Restore verification failed; inspect sanitized report.'}
