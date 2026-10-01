$ErrorActionPreference = 'Stop'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = "d:\AI-Automation\backups\baseline-$timestamp"

Write-Host "Creating backup directory: $backupDir"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

# 1. Copy project config & workflow files
Write-Host "Backing up configuration and workflow files..."
Copy-Item "d:\AI-Automation\evolution_whatsapp_ai_agent_bot.json" "$backupDir\"
Copy-Item "d:\AI-Automation\knowledge_base.json" "$backupDir\"
Copy-Item "d:\AI-Automation\crm_store.json" "$backupDir\"
Copy-Item "d:\AI-Automation\docker-compose.yml" "$backupDir\"
Copy-Item "d:\AI-Automation\init-crm-db.sql" "$backupDir\"

# 2. Backup PostgreSQL databases
Write-Host "Backing up PostgreSQL databases..."
& docker exec -t evolution-postgres pg_dump -U postgres postgres > "$backupDir\postgres_crm.sql"
& docker exec -t evolution-postgres pg_dump -U postgres evogo_auth > "$backupDir\evogo_auth.sql"
& docker exec -t evolution-postgres pg_dump -U postgres evogo_users > "$backupDir\evogo_users.sql"

# 3. Create Manifest
$manifest = @{
    Timestamp = $timestamp
    BackupDirectory = $backupDir
    Files = (Get-ChildItem -Path $backupDir | Select-Object Name, Length, LastWriteTime)
}

$manifest | ConvertTo-Json | Out-File "$backupDir\manifest.json"

Write-Host "SUCCESS: Baseline Backup created at $backupDir"
