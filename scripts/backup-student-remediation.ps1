$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot=Join-Path $taskRoot "backups/student-remediation-$stamp"
New-Item -ItemType Directory -Path $backupRoot | Out-Null
foreach($file in @('docker-compose.yml','evolution_whatsapp_ai_agent_bot.json','evolution-go/docker/examples/docker-compose.yml')) {
  Copy-Item -LiteralPath (Join-Path $taskRoot $file) -Destination (Join-Path $backupRoot ($file.Replace('/','_')))
}
$inspectText=(& docker inspect n8n evolution-go | Out-String)
if($LASTEXITCODE -ne 0){throw 'Container inspection failed'}
$containers=$inspectText | ConvertFrom-Json
Add-Type -AssemblyName System.Security
$protected=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($inspectText),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
[IO.File]::WriteAllBytes((Join-Path $backupRoot 'runtime-config.dpapi'),$protected)
$evo=$containers | Where-Object Name -eq '/evolution-go'
$connection=($evo.Config.Env | Where-Object { $_.StartsWith('POSTGRES_USERS_DB=') }).Substring('POSTGRES_USERS_DB='.Length)
$uri=[Uri]$connection
$auth=$uri.UserInfo.Split(':',2)
$env:PGUSER=[Uri]::UnescapeDataString($auth[0]); $env:PGPASSWORD=[Uri]::UnescapeDataString($auth[1]);$env:PGCONNECT_TIMEOUT='10'
try {
 foreach($db in @('platform_db','bise_db','pos_db','hospital_db','evogo_users','evogo_auth')) {
  & 'C:/Program Files/PostgreSQL/18/bin/pg_dump.exe' -h 127.0.0.1 -p 5432 -w -Fc -d $db -f (Join-Path $backupRoot "$db.dump")
  if($LASTEXITCODE -ne 0){throw "Backup failed: $db"}
  & 'C:/Program Files/PostgreSQL/18/bin/pg_restore.exe' --list (Join-Path $backupRoot "$db.dump") | Set-Content (Join-Path $backupRoot "$db.toc.txt")
  if($LASTEXITCODE -ne 0){throw "Backup validation failed: $db"}
 }
}finally{Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue}
$sqliteScript=@'
const fs=require('fs');const {DatabaseSync,backup}=require('node:sqlite');
(async()=>{const db=new DatabaseSync('/home/node/.n8n/database.sqlite',{readOnly:true});const w=db.prepare('select * from workflow_entity where active=1').get();for(const k of ['nodes','connections','settings','staticData','pinData'])if(w[k])w[k]=JSON.parse(w[k]);fs.writeFileSync('/tmp/student-before-workflow.json',JSON.stringify(w,null,2));await backup(db,'/tmp/student-before.sqlite',{rate:1000000});db.close();const copy=new DatabaseSync('/tmp/student-before.sqlite',{readOnly:true});const check=copy.prepare('PRAGMA quick_check').get();copy.close();if(check.quick_check!=='ok')throw Error('SQLite check failed');console.log('Consistent SQLite snapshot validated');})().catch(e=>{console.error(e.message);process.exitCode=1});
'@
$sqliteScript | & docker exec -i n8n node
if($LASTEXITCODE -ne 0){throw 'SQLite backup failed'}
& docker cp n8n:/tmp/student-before.sqlite (Join-Path $backupRoot 'n8n.sqlite')
if($LASTEXITCODE -ne 0){throw 'SQLite copy failed'}
& docker cp n8n:/tmp/student-before-workflow.json (Join-Path $backupRoot 'active-workflow.json')
if($LASTEXITCODE -ne 0){throw 'Workflow copy failed'}
$manifest=Get-ChildItem -LiteralPath $backupRoot -File | ForEach-Object { @{name=$_.Name;bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash} }
@{created_at=(Get-Date).ToUniversalTime().ToString('o');backup_root=$backupRoot;files=$manifest;sqlite_quick_check='ok';postgres_archives='pg_restore --list validated'} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $backupRoot 'manifest.json')
[IO.File]::WriteAllText((Join-Path $taskRoot 'docs/current-system-audit/backup-path.txt'),$backupRoot)
Write-Output "Backup verified: $backupRoot"
