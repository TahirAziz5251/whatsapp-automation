$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$dest=Join-Path $root ('backups/repair-step2-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $dest | Out-Null
Add-Type -AssemblyName System.Security
$raw=(& docker inspect n8n evolution-go evolution-redis 1ac052571cf9_evolution-go | Out-String)
if($LASTEXITCODE -ne 0){throw 'Container backup read failed'}
$containers=$raw | ConvertFrom-Json
$protected=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($raw),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
[IO.File]::WriteAllBytes((Join-Path $dest 'runtime-config.dpapi'),$protected)
$roundtrip=[Security.Cryptography.ProtectedData]::Unprotect($protected,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
if([Text.Encoding]::UTF8.GetString($roundtrip) -ne $raw){throw 'Encrypted backup verification failed'}
foreach($f in @('docker-compose.yml','evolution_whatsapp_ai_agent_bot.json','evolution-go/docker/examples/docker-compose.yml')){Copy-Item -LiteralPath (Join-Path $root $f) -Destination (Join-Path $dest ($f.Replace('/','_')))}
$script=@'
const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/home/node/.n8n/database.sqlite',{readOnly:true});const w=db.prepare('select * from workflow_entity where id=?').get('Ag4HbAjKlfHH6Xk7');for(const k of ['nodes','connections','settings','staticData','pinData'])if(w[k])w[k]=JSON.parse(w[k]);const h=w.activeVersionId?db.prepare('select * from workflow_history where versionId=?').get(w.activeVersionId):null;if(h){h.nodes=JSON.parse(h.nodes);h.connections=JSON.parse(h.connections)}console.log(JSON.stringify({workflow:w,published:h}));db.close();
'@
$workflow=($script | & docker exec -i n8n node | Out-String)
if($LASTEXITCODE -ne 0){throw 'Current workflow backup failed'}
$parsed=$workflow | ConvertFrom-Json
if($parsed.workflow.id -ne 'Ag4HbAjKlfHH6Xk7'){throw 'Wrong workflow backup'}
[IO.File]::WriteAllText((Join-Path $dest 'workflow-and-published.json'),$workflow)
$evo=$containers | Where-Object Name -eq '/evolution-go'
$uri=[Uri](($evo.Config.Env | Where-Object { $_.StartsWith('POSTGRES_USERS_DB=') }).Substring('POSTGRES_USERS_DB='.Length))
$auth=$uri.UserInfo.Split(':',2)
$env:PGUSER=[Uri]::UnescapeDataString($auth[0]);$env:PGPASSWORD=[Uri]::UnescapeDataString($auth[1]);$env:PGCONNECT_TIMEOUT='10'
try{foreach($db in @('evogo_users','evogo_auth','platform_db')){
 & 'C:/Program Files/PostgreSQL/18/bin/pg_dump.exe' -h 127.0.0.1 -p 5432 -w -Fc -d $db -f (Join-Path $dest "$db.dump")
 if($LASTEXITCODE -ne 0){throw "Backup failed: $db"}
 & 'C:/Program Files/PostgreSQL/18/bin/pg_restore.exe' --list (Join-Path $dest "$db.dump") | Set-Content (Join-Path $dest "$db.toc.txt")
 if($LASTEXITCODE -ne 0){throw "Archive validation failed: $db"}
}}finally{Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue}
$files=Get-ChildItem -LiteralPath $dest -File | ForEach-Object {@{name=$_.Name;bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName).Hash}}
@{at=(Get-Date).ToUniversalTime().ToString('o');scope='Current workflow/published export, runtime config, compose and native Evolution session/platform logical databases; volumes preserved';publishedVersion=$parsed.workflow.activeVersionId;dpapiRoundtripVerified=$true;postgresArchives='pg_restore --list verified';files=$files} | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $dest 'manifest.json')
[IO.File]::WriteAllText((Join-Path $root 'docs/development-repair-20261001/step2-backup-path.txt'),$dest)
Write-Output "Step 2 backup verified: $dest"
