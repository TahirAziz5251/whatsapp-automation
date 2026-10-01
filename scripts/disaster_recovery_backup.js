/**
 * Phase 38: Automated Disaster Recovery Backup Engine
 * 
 * Objectives:
 * 1. Dump all 4 platform databases (platform_db, pos_db, bise_db, hospital_db).
 * 2. Backup n8n workflow definitions and configuration JSON files.
 * 3. Snapshot Redis state and record key metadata.
 * 4. Backup Docker composition and environment manifests.
 * 5. Generate cryptographic SHA-256 manifest for point-in-time RPO calculation.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

function getTimestamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${min}${ss}`;
}

function calculateSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

function runCommand(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', ...opts }).trim();
  } catch (err) {
    console.error(`Command failed: ${cmd}\nError: ${err.message}`);
    throw err;
  }
}

function createDisasterRecoveryBackup(customDir = null) {
  const timestamp = getTimestamp();
  const backupDir = customDir || path.join('d:', 'AI-Automation', 'backups', `dr-backup-${timestamp}`);
  
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  console.log(`\n================================================================`);
  console.log(`📦 STARTING DISASTER RECOVERY BACKUP: ${backupDir}`);
  console.log(`================================================================\n`);

  const manifest = {
    timestamp: new Date().toISOString(),
    backup_directory: backupDir,
    databases: {},
    files: {},
    redis_state: {},
    containers: [],
    rpo_status: 'SUCCESS'
  };

  // 1. PostgreSQL Database Logical Dumps
  const targetDbs = ['platform_db', 'pos_db', 'bise_db', 'hospital_db'];
  console.log(`Step 1: Exporting PostgreSQL databases (${targetDbs.join(', ')})...`);
  
  for (const db of targetDbs) {
    const dumpFile = path.join(backupDir, `${db}.sql`);
    console.log(`  -> Dumping ${db} to ${dumpFile}...`);
    
    // Dump database structure and data
    const dumpCmd = `docker exec evolution-postgres pg_dump -U postgres ${db}`;
    const dumpOutput = runCommand(dumpCmd, { maxBuffer: 50 * 1024 * 1024 });
    fs.writeFileSync(dumpFile, dumpOutput, 'utf8');

    // Get Table Counts for verification
    const countCmd = `docker exec -i evolution-postgres psql -U postgres -d ${db} -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema');"`;
    const tableCount = parseInt(runCommand(countCmd) || '0', 10);

    const stat = fs.statSync(dumpFile);
    manifest.databases[db] = {
      file: `${db}.sql`,
      size_bytes: stat.size,
      table_count: tableCount,
      sha256: calculateSha256(dumpFile)
    };
    console.log(`     ✓ ${db} dumped successfully (${(stat.size / 1024).toFixed(2)} KB, ${tableCount} tables).`);
  }

  // 2. n8n Workflow & Application Files Backup
  console.log(`\nStep 2: Backing up n8n workflows and knowledge metadata...`);
  const appFiles = [
    'evolution_whatsapp_ai_agent_bot.json',
    'knowledge_base.json',
    'crm_store.json',
    'docker-compose.yml',
    'database/init-platform-db.sql',
    'database/init-pos-db.sql',
    'database/init-bise-db.sql',
    'database/init-hospital-db.sql'
  ];

  for (const relFile of appFiles) {
    const srcPath = path.join('d:', 'AI-Automation', relFile);
    if (fs.existsSync(srcPath)) {
      const fileName = path.basename(relFile);
      const destPath = path.join(backupDir, fileName);
      fs.copyFileSync(srcPath, destPath);
      const stat = fs.statSync(destPath);
      manifest.files[fileName] = {
        size_bytes: stat.size,
        sha256: calculateSha256(destPath)
      };
      console.log(`  ✓ Copied ${fileName} (${(stat.size / 1024).toFixed(2)} KB).`);
    } else {
      console.warn(`  ⚠️ File not found: ${srcPath}`);
    }
  }

  // 3. Redis Persistence & Key Count Snapshot
  console.log(`\nStep 3: Snapshotting Redis cache state...`);
  try {
    runCommand('docker exec evolution-redis redis-cli SAVE');
    const dbsizeStr = runCommand('docker exec evolution-redis redis-cli DBSIZE');
    const keyCount = parseInt(dbsizeStr.replace(/[^0-9]/g, '') || '0', 10);
    manifest.redis_state = {
      save_status: 'OK',
      dbsize_keys: keyCount,
      timestamp: new Date().toISOString()
    };
    console.log(`  ✓ Redis SAVE executed. Active keys in Redis: ${keyCount}`);
  } catch (err) {
    console.warn(`  ⚠️ Redis snapshot warning: ${err.message}`);
    manifest.redis_state = { save_status: 'WARN', error: err.message };
  }

  // 4. Docker Container Status Log
  console.log(`\nStep 4: Recording Docker container state manifest...`);
  try {
    const psOutput = runCommand('docker ps --format "{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}"');
    const containers = psOutput.split('\n').filter(Boolean).map(line => {
      const [name, image, status, ports] = line.split('|');
      return { name, image, status, ports };
    });
    manifest.containers = containers;
    console.log(`  ✓ Recorded ${containers.length} running container states.`);
  } catch (err) {
    manifest.containers = [];
  }

  // 5. Save Manifest JSON
  const manifestFile = path.join(backupDir, 'manifest.json');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`\nStep 5: Manifest written to ${manifestFile}`);

  console.log(`\n================================================================`);
  console.log(`✅ DISASTER RECOVERY BACKUP COMPLETED LOCALLY`);
  console.log(`================================================================\n`);

  return { backupDir, manifest };
}

if (require.main === module) {
  createDisasterRecoveryBackup();
}

module.exports = { createDisasterRecoveryBackup, getTimestamp, calculateSha256 };
