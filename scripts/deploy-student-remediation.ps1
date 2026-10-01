$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$backup=Join-Path $root 'backups/student-remediation-20261001-151004'
$manifest=Get-Content (Join-Path $backup 'manifest.json') -Raw | ConvertFrom-Json
if($manifest.sqlite_quick_check -ne 'ok'){throw 'A validated SQLite backup is required'}
$tests=Get-Content (Join-Path $root 'docs/current-system-audit/remediation-runtime-tests.json') -Raw | ConvertFrom-Json
if(@($tests.tests | Where-Object status -ne 'PASS').Count -gt 0 -or $tests.tests.Count -lt 21){throw 'Runtime tests not passing'}
$model=Get-Content (Join-Path $root 'docs/current-system-audit/groq-selection-test.json') -Raw | ConvertFrom-Json
if(!$model.pass){throw 'Model selection test not passing'}
& node (Join-Path $root 'scripts/preflight-student-deployment.cjs')
if($LASTEXITCODE -ne 0){throw 'Deployment preflight failed'}
$workflowPath=Join-Path $root 'evolution_whatsapp_ai_agent_bot.json'
$workflow=Get-Content $workflowPath -Raw | ConvertFrom-Json
if($workflow.id -ne 'Ag4HbAjKlfHH6Xk7'){throw 'Unexpected target workflow'}
& docker cp $workflowPath n8n:/tmp/student-remediation.json
if($LASTEXITCODE -ne 0){throw 'Workflow transfer failed'}
& docker exec n8n n8n import:workflow --input=/tmp/student-remediation.json
if($LASTEXITCODE -ne 0){throw 'Import failed; inspect before retry'}
& docker exec n8n n8n publish:workflow --id=Ag4HbAjKlfHH6Xk7
if($LASTEXITCODE -ne 0){throw 'Publish failed; inspect before retry'}
& docker compose -f (Join-Path $root 'docker-compose.yml') up -d --no-deps --pull never n8n
if($LASTEXITCODE -ne 0){throw 'n8n recreation failed; restore from backup'}
Write-Output 'Workflow imported and published. n8n recreated with pg,ioredis; verify readiness and exact active version before live testing.'
