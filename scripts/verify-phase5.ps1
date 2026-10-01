. (Join-Path $PSScriptRoot 'phase4-common.ps1')
$secrets=Get-Phase4Secrets;$results=@();$out=Join-Path $Phase4Root 'docs/phase5'
$plan=Get-Content -Raw -LiteralPath (Join-Path $Phase4Root 'database/phase5/test-plan.json')|ConvertFrom-Json
foreach($db in @('pos_db','bise_db','hospital_db')){
 foreach($kind in @('runtime','owner')){
  $role=$db.Replace('_db','')+$(if($kind -eq 'owner'){'_migrator'}else{'_runtime'})
  $sql=Get-Content -Raw -LiteralPath (Join-Path $Phase4Root "database/phase5/$db.$kind-tests.sql")
  $sql="\set VERBOSITY default`n"+$sql
  $r=Invoke-Phase4Sql $db $sql $role $secrets[$role]
  $passNames=@([regex]::Matches($r.error+' '+$r.output,'P5PASS\|([a-zA-Z0-9_]+)')|ForEach-Object {$_.Groups[1].Value})
  foreach($case in $plan|Where-Object {$_.database -eq $db -and $(if($kind -eq 'owner'){$_.role -eq 'migrator'}else{$_.role -ne 'migrator'})}){
   $results+=@{database=$db;role=$role;name=$case.name;status=$(if($case.name -in $passNames){'PASS'}else{'FAIL'})}
  }
  if($r.code){$results+=@{database=$db;role=$role;name='batch_completed';status='FAIL';error=$r.error}}
  Write-Output "${db} $kind tests: $($passNames.Count) passing checks; exit $($r.code)"
 }
}
$report=@{scope='Live Phase 5 batched SQL contract tests using real restricted credentials. Mutations occur inside rolled-back test transactions. Does not verify public WhatsApp/subject authorization or live CRM synchronization.';tested_at=[DateTime]::UtcNow.ToString('o');results=$results;passed=@($results|Where-Object status -eq 'PASS').Count;failed=@($results|Where-Object status -eq 'FAIL').Count}
$report|ConvertTo-Json -Depth 12|Set-Content -LiteralPath (Join-Path $out 'verification.json') -Encoding utf8
Write-Output "Phase 5 live SQL: $($report.passed) PASS, $($report.failed) FAIL"
if($report.failed){throw 'Phase 5 verification failed; inspect the report.'}
