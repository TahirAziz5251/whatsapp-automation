. (Join-Path $PSScriptRoot 'phase4-common.ps1')
$secrets=Get-Phase4Secrets
$fixtures=Get-Content -Raw -LiteralPath (Join-Path $Phase4Root 'database/phase4/fixtures.json')|ConvertFrom-Json
$results=[Collections.Generic.List[object]]::new()
function Test-Phase4([string]$Name,[scriptblock]$Run){
 try{& $Run;$results.Add(@{name=$Name;status='PASS'})}catch{$results.Add(@{name=$Name;status='FAIL';error=$_.Exception.Message})}
}
function Expect-Value($r,[string]$Expected){$value=Assert-Phase4Sql $r 'Test query';if(($value -split "`n")[-1].Trim() -ne $Expected){throw "Expected '$Expected', got '$value'"}}
function Expect-Denied($r,[string]$State='42501'){if($r.code -eq 0 -or $r.error -notmatch $State){throw "Expected SQLSTATE $State rejection; got code $($r.code), $($r.error)"}}
foreach($db in $Phase4Databases){
 $prefix=$db.Replace('_db','');$role="${prefix}_runtime";$migrator="${prefix}_migrator";$owner="${prefix}_owner";$password=$secrets[$role]
 $businesses=@($fixtures|Where-Object {$db -eq 'control_db' -or $_.db -eq $db});$a=$businesses[0].business;$b=$businesses[1].business
 $context="BEGIN; SET LOCAL app.business_id='$a';"
 Test-Phase4 "$db password-authenticated runtime connection" {Expect-Value (Invoke-Phase4Sql $db 'SELECT current_user' $role $password) $role}
 Test-Phase4 "$db rejects wrong password" {Expect-Denied (Invoke-Phase4Sql $db 'SELECT 1' $role 'incorrect-phase4-test-password') '28P01|password authentication failed'}
 Test-Phase4 "$db Unix socket cannot impersonate runtime without password" {Expect-Denied (Invoke-Phase4Docker -Arguments @('exec',$Phase4Container,'psql','-X','-w','-U',$role,'-d',$db,'-c','SELECT 1')) 'no password supplied|password authentication failed'}
 foreach($other in @($Phase4Databases+@('agent_dev','postgres')|Where-Object {$_ -ne $db})){
  Test-Phase4 "$role cannot connect to $other" {Expect-Denied (Invoke-Phase4Sql $other 'SELECT 1' $role $password) '42501|permission denied for database'}
 }
 Test-Phase4 "$db four platform tables plus separate migration ledger" {Expect-Value (Invoke-Phase4Sql $db "SELECT count(*) FROM information_schema.tables WHERE table_schema='platform' AND table_type='BASE TABLE'") '4'}
 Test-Phase4 "$db all foundational tables FORCE RLS owned by nonruntime" {Expect-Value (Invoke-Phase4Sql $db "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='platform' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)='$owner'") '4'}
 Test-Phase4 "$db runtime has no privileged flags or role memberships" {Expect-Value (Invoke-Phase4Sql $db "SELECT (NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)) FROM pg_roles r WHERE rolname='$role'") 't'}
 Test-Phase4 "$db missing tenant context returns no rows" {Expect-Value (Invoke-Phase4Sql $db 'SELECT count(*) FROM platform.businesses' $role $password) '0'}
 Test-Phase4 "$db tenant A sees only A and not B" {Expect-Value (Invoke-Phase4Sql $db "$context SELECT count(*)=1 AND bool_and(id='$a') FROM platform.businesses;" $role $password) 't'}
 Test-Phase4 "$db transaction-local scope does not leak after COMMIT" {Expect-Value (Invoke-Phase4Sql $db "$context SELECT count(*) FROM platform.businesses; COMMIT; SELECT count(*) FROM platform.businesses;" $role $password) '0'}
 Test-Phase4 "$db same-tenant audit insert succeeds and is rolled back" {Expect-Value (Invoke-Phase4Sql $db "$context INSERT INTO platform.audit_events(business_id,actor_ref,event_type,outcome,details) VALUES('$a','test','phase4.test','success','{}'); SELECT count(*) FROM platform.audit_events WHERE event_type='phase4.test';" $role $password) '1'}
 Test-Phase4 "$db cross-tenant audit INSERT denied by WITH CHECK" {Expect-Denied (Invoke-Phase4Sql $db "$context INSERT INTO platform.audit_events(business_id,actor_ref,event_type,outcome,details) VALUES('$b','test','phase4.test','success','{}');" $role $password)}
 Test-Phase4 "$db missing tenant INSERT denied" {Expect-Denied (Invoke-Phase4Sql $db "INSERT INTO platform.audit_events(business_id,actor_ref,event_type,outcome,details) VALUES('$a','test','phase4.test','success','{}');" $role $password)}
 Test-Phase4 "$db malformed tenant context fails closed" {Expect-Denied (Invoke-Phase4Sql $db "BEGIN; SET LOCAL app.business_id='invalid'; SELECT * FROM platform.businesses;" $role $password) '22P02'}
 Test-Phase4 "$db runtime cannot edit routing" {Expect-Denied (Invoke-Phase4Sql $db "$context UPDATE platform.instances SET status='disabled';" $role $password)}
 foreach($op in @("UPDATE platform.audit_events SET outcome='failure'","DELETE FROM platform.audit_events","TRUNCATE platform.audit_events","CREATE TABLE platform.attack(id int)","CREATE TEMP TABLE attack(id int)","SET ROLE $owner","SELECT * FROM app_meta.schema_migrations","SET row_security=off; SELECT * FROM platform.businesses")){
  Test-Phase4 "$db rejects runtime operation: $op" {Expect-Denied (Invoke-Phase4Sql $db "$context $op;" $role $password)}
 }
 Test-Phase4 "$db audit detail allowlist rejects sensitive key" {Expect-Denied (Invoke-Phase4Sql $db "$context INSERT INTO platform.audit_events(business_id,actor_ref,event_type,outcome,details) VALUES('$a','test','phase4.test','success','{`"cnic`":`"synthetic-canary`"}');" $role $password) '23514'}
 Test-Phase4 "$db orphan tenant FK rejected" {Expect-Denied (Invoke-Phase4Sql $db "BEGIN; SET LOCAL app.business_id='40000000-0000-4000-8000-999999999999'; INSERT INTO platform.audit_events(business_id,actor_ref,event_type,outcome,details) VALUES('40000000-0000-4000-8000-999999999999','test','phase4.test','success','{}');" $role $password) '23503'}
 Test-Phase4 "$db duplicate authoritative instance mapping rejected" {
  $extra=if($db -eq 'control_db'){",credential_ref) VALUES('$b',gen_random_uuid(),'evolution_go','$($businesses[0].external)','active','dummy:test')"}else{",config_revision,valid_until) VALUES('$b',gen_random_uuid(),'evolution_go','$($businesses[0].external)','active',1,now()+interval '1 hour')"}
  Expect-Denied (Invoke-Phase4Sql $db "BEGIN; SET LOCAL ROLE $owner; SET LOCAL app.business_id='$b'; INSERT INTO platform.instances(business_id,id,provider,external_instance_id,status$extra;" $migrator $secrets[$migrator]) '23505'
 }
 Test-Phase4 "$db failed transactional migration leaves no partial table" {
  Expect-Denied (Invoke-Phase4Sql $db "BEGIN; SET LOCAL ROLE $owner; CREATE TABLE app_meta.phase4_failure_probe(id int); SELECT 1/0; COMMIT;" $migrator $secrets[$migrator]) '22012'
  Expect-Value (Invoke-Phase4Sql $db "SELECT to_regclass('app_meta.phase4_failure_probe') IS NULL") 't'
 }
 Test-Phase4 "$db checksum ledger contains core and fixture migration" {Expect-Value (Invoke-Phase4Sql $db "SELECT count(*) FROM app_meta.schema_migrations WHERE version IN ('004_core','004_dummy_bootstrap') AND checksum ~ '^[0-9a-f]{64}$'") '2'}
 if($db -ne 'control_db'){
  Test-Phase4 "$db excludes gateway credential reference" {Expect-Value (Invoke-Phase4Sql $db "SELECT count(*) FROM information_schema.columns WHERE table_schema='platform' AND column_name='credential_ref'") '0'}
  Test-Phase4 "$db local config event receipt matches fixture hash" {Expect-Value (Invoke-Phase4Sql $db "SELECT count(*) FROM platform.configuration_inbox WHERE business_id='$a' AND payload_hash='$($businesses[0].hash)' AND origin_event_ref='$($businesses[0].event)'") '1'}
 }
}
Test-Phase4 'No runtime role receives CREATE or TEMP on any app DB' {Expect-Value (Invoke-Phase4Sql 'agent_dev' "SELECT NOT EXISTS(SELECT 1 FROM pg_roles r CROSS JOIN pg_database d WHERE r.rolname IN ('control_runtime','pos_runtime','bise_runtime','hospital_runtime') AND d.datname IN ('control_db','pos_db','bise_db','hospital_db') AND (has_database_privilege(r.oid,d.oid,'CREATE') OR has_database_privilege(r.oid,d.oid,'TEMP')))") 't'}
$report=@{scope='Live isolated PostgreSQL tests using password-authenticated restricted roles; synthetic fixtures only. Does not certify workflow authorization, Board verification, full server restore, vector retrieval or business E2E.';captured_at=[DateTime]::UtcNow.ToString('o');results=@($results.ToArray());passed=@($results|Where-Object status -eq 'PASS').Count;failed=@($results|Where-Object status -eq 'FAIL').Count}
$report|ConvertTo-Json -Depth 10|Set-Content -LiteralPath (Join-Path $Phase4Root 'docs/phase4/verification.json') -Encoding utf8
Write-Output "Phase 4 live tests: $($report.passed) PASS, $($report.failed) FAIL."
$results|Where-Object status -eq 'FAIL'|ConvertTo-Json -Depth 5|Write-Output
if($report.failed){throw 'Phase 4 live verification failed; inspect sanitized report.'}
