param([string]$Workspace = 'D:\AI-Automation')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dest = Join-Path $Workspace "backups\phase1-$stamp"
New-Item -ItemType Directory -Path $dest -Force | Out-Null

function DockerBytes([string[]]$Arguments) {
    $p = [Diagnostics.Process]::new()
    $p.StartInfo = [Diagnostics.ProcessStartInfo]::new('docker')
    $p.StartInfo.UseShellExecute = $false
    $p.StartInfo.CreateNoWindow = $true
    $p.StartInfo.RedirectStandardOutput = $true
    $p.StartInfo.RedirectStandardError = $true
    foreach ($a in $Arguments) { $p.StartInfo.ArgumentList.Add($a) }
    $null = $p.Start()
    $err = $p.StandardError.ReadToEndAsync()
    $stream = [IO.MemoryStream]::new()
    $p.StandardOutput.BaseStream.CopyTo($stream)
    $p.WaitForExit()
    if ($p.ExitCode -ne 0) { throw "Docker operation failed (exit $($p.ExitCode)); diagnostic withheld to protect secrets." }
    $null = $err.GetAwaiter().GetResult()
    return ,$stream.ToArray()
}

$manifest = [Collections.Generic.List[object]]::new()
function SaveEncrypted([string]$Name, [byte[]]$Bytes) {
    if ($Bytes.Length -eq 0) { throw "Empty backup: $Name" }
    $protected = [Security.Cryptography.ProtectedData]::Protect($Bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $path = Join-Path $dest "$Name.dpapi"
    [IO.File]::WriteAllBytes($path, $protected)
    $roundtrip = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($path), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Bytes))
    if ($hash -ne [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($roundtrip))) { throw "Encryption verification failed: $Name" }
    $manifest.Add([pscustomobject]@{name="$Name.dpapi";plaintextBytes=$Bytes.Length;plaintextSha256=$hash;encryptedSha256=(Get-FileHash -LiteralPath $path).Hash;decryptVerified=$true})
    Write-Output "Encrypted and roundtrip-verified: $Name"
}

# Online SQLite backup API creates a consistent DB snapshot without stopping n8n.
$snapshot = "/tmp/phase1-$stamp.sqlite"
$code = 'const s=require("/usr/local/lib/node_modules/n8n/node_modules/sqlite3");const d=new s.Database("/home/node/.n8n/database.sqlite",s.OPEN_READONLY);const target=process.argv[1];const b=d.backup(target);b.step(-1,e=>{b.finish(f=>{d.close();if(e||f){console.error("snapshot failed");process.exitCode=1;return;}const v=new s.Database(target,s.OPEN_READONLY);v.all("PRAGMA integrity_check",(x,r)=>{if(x||r.length!==1||r[0].integrity_check!=="ok"){console.error("integrity failure");process.exitCode=1;}else console.log("sqlite snapshot integrity ok");v.close();});});});'
try {
    $result = DockerBytes @('exec','n8n','node','-e',$code,$snapshot)
    Write-Output ([Text.Encoding]::UTF8.GetString($result).Trim())
    SaveEncrypted 'n8n.sqlite' (DockerBytes @('exec','n8n','cat',$snapshot))
} finally {
    $null = DockerBytes @('exec','n8n','node','-e','require("fs").unlinkSync(process.argv[1])',$snapshot)
}

SaveEncrypted 'postgres-cluster.sql' (DockerBytes @('exec','evolution-postgres','pg_dumpall','-U','postgres'))
# Includes encryption key/environment privately; never print the raw inspect response.
SaveEncrypted 'runtime-containers.json' (DockerBytes @('inspect','evolution-go','n8n','evolution-postgres'))
SaveEncrypted 'n8n-files.tar' (DockerBytes @('exec','n8n','tar','-C','/home/node/.n8n','--exclude=database.sqlite','--exclude=database.sqlite-wal','--exclude=database.sqlite-shm','--exclude=*.log','--exclude=crash.journal','-cf','-','.'))
SaveEncrypted 'evolution-dbdata.tar' (DockerBytes @('exec','evolution-go','tar','-C','/app/dbdata','-cf','-','.'))

$files = @('evolution_whatsapp_ai_agent_bot.json','knowledge_base.json','crm_store.json','docker-compose.yml','init-crm-db.sql','evolution-go/docker/examples/docker-compose.yml','evolution-go/docker/examples/init-db.sql','evolution-go/.env','faiss-service/main.py','faiss-service/ingest_data.py','faiss-service/requirements.txt','faiss-service/Dockerfile')
foreach ($file in $files) {
    $path = Join-Path $Workspace $file
    if (Test-Path -LiteralPath $path -PathType Leaf) { SaveEncrypted ($file.Replace('/','__')) ([IO.File]::ReadAllBytes($path)) }
}
[pscustomobject]@{createdAt=(Get-Date).ToString('o');protection='Windows DPAPI CurrentUser: recovery requires this Windows identity and DPAPI keys';scope='Current Evolution/n8n deployment only; unrelated n8n-automation-db-1 excluded';consistency='SQLite online snapshot; pg_dumpall per-database snapshots, not one cross-database atomic snapshot; ancillary file archives captured live';restoreStatus='Encryption roundtrip and SQLite integrity verified; full application restore not yet performed';artifacts=$manifest} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $dest 'manifest.json') -Encoding utf8
Write-Output "Backup directory: $dest"
