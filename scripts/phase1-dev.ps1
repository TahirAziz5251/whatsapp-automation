param([string]$Workspace='D:\AI-Automation')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$path=Join-Path $Workspace 'development/secrets.dpapi'
if (Test-Path -LiteralPath $path) {
    $bytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($path),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    $secrets=[Text.Encoding]::UTF8.GetString($bytes)|ConvertFrom-Json
} else {
    $secrets=@{db=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32));n8n=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))}
    $bytes=[Text.Encoding]::UTF8.GetBytes(($secrets|ConvertTo-Json -Compress))
    [IO.File]::WriteAllBytes($path,[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))
}
$env:AGENT_DEV_DB_PASSWORD=$secrets.db
$env:AGENT_DEV_N8N_KEY=$secrets.n8n
try {
    docker compose -f (Join-Path $Workspace 'development/compose.yml') config --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Dev compose validation failed' }
    docker compose -f (Join-Path $Workspace 'development/compose.yml') up -d --pull never
    if ($LASTEXITCODE -ne 0) { throw 'Dev environment startup failed' }
    docker compose -f (Join-Path $Workspace 'development/compose.yml') ps
} finally {
    Remove-Item Env:AGENT_DEV_DB_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:AGENT_DEV_N8N_KEY -ErrorAction SilentlyContinue
}
