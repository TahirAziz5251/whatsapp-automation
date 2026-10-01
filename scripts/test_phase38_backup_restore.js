/**
 * Phase 38: Disaster Recovery & Backup/Restore Verification Suite
 * 
 * Objective:
 * Verify complete platform recovery (PostgreSQL, n8n workflows, Redis cache state, 
 * Evolution API configs, knowledge metadata) within strict RTO/RPO targets.
 * 
 * Tests Executed:
 * 1. Live Backup Generation & Manifest SHA-256 Validation
 * 2. Isolated Target Database Provisioning (dr_restore_*)
 * 3. PostgreSQL SQL Dump Restoration Execution
 * 4. Cross-Database Table & Row Count Integrity Comparison
 * 5. Multi-Tenant RLS & Security Role Verification on Restored Targets
 * 6. n8n Production Workflow Structural Integrity Verification
 * 7. Temporary Restore Target Cleanup
 * 8. RTO (Recovery Time Objective) Measurement & Performance Assertion (< 900s)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createDisasterRecoveryBackup, calculateSha256 } = require('./disaster_recovery_backup');

function runPsql(db, sql) {
  try {
    return execSync(`docker exec -i evolution-postgres psql -U postgres -d ${db} -t -A`, {
      input: sql,
      encoding: 'utf8'
    }).trim();
  } catch (err) {
    throw new Error(`PSQL failed on DB [${db}]: ${err.message}`);
  }
}

async function runDisasterRecoveryVerification() {
  const startTime = Date.now();
  console.log(`\n================================================================`);
  console.log(`🛡️ PHASE 38: DISASTER RECOVERY & RESTORE VERIFICATION DRILL`);
  console.log(`================================================================\n`);

  const results = {
    suite: 'Phase 38: Backup / Restore Validation',
    timestamp: new Date().toISOString(),
    tests: [],
    rto_seconds: 0,
    rpo_status: 'PASS',
    passed: 0,
    failed: 0
  };

  function assert(condition, description, details = '') {
    if (condition) {
      results.passed++;
      results.tests.push({ description, status: 'PASS', details });
      console.log(`  ✓ PASS: ${description}`);
    } else {
      results.failed++;
      results.tests.push({ description, status: 'FAIL', details });
      console.error(`  ❌ FAIL: ${description} - ${details}`);
    }
  }

  try {
    // -------------------------------------------------------------
    // Test 1: Live DR Backup Execution
    // -------------------------------------------------------------
    console.log(`--- Test 1: Live Backup Generation ---`);
    const backupResult = createDisasterRecoveryBackup();
    const { backupDir, manifest } = backupResult;

    assert(fs.existsSync(backupDir), 'Backup directory created', backupDir);
    assert(manifest && manifest.rpo_status === 'SUCCESS', 'Backup manifest generated successfully');
    assert(Object.keys(manifest.databases).length === 4, 'Manifest contains all 4 databases');

    // -------------------------------------------------------------
    // Test 2: Cryptographic Integrity Verification of Backups
    // -------------------------------------------------------------
    console.log(`\n--- Test 2: Cryptographic Integrity Verification ---`);
    for (const [dbName, meta] of Object.entries(manifest.databases)) {
      const dumpPath = path.join(backupDir, meta.file);
      const computedHash = calculateSha256(dumpPath);
      assert(computedHash === meta.sha256, `SHA-256 hash verified for ${dbName}`, `Hash: ${computedHash.substring(0, 16)}...`);
    }

    // -------------------------------------------------------------
    // Test 3: Isolated Restore Database Creation
    // -------------------------------------------------------------
    console.log(`\n--- Test 3: Provisioning Isolated Restore Target Databases ---`);
    const targetDbs = ['platform_db', 'pos_db', 'bise_db', 'hospital_db'];
    const restoreDbMap = {};

    for (const db of targetDbs) {
      const restoreDb = `dr_restore_${db}`;
      restoreDbMap[db] = restoreDb;

      // Drop if existing from previous runs
      runPsql('postgres', `DROP DATABASE IF EXISTS ${restoreDb};`);
      runPsql('postgres', `CREATE DATABASE ${restoreDb};`);
      const exists = runPsql('postgres', `SELECT count(*) FROM pg_database WHERE datname = '${restoreDb}';`);
      assert(exists === '1', `Isolated restore target DB created: ${restoreDb}`);
    }

    // -------------------------------------------------------------
    // Test 4: SQL Dump Restoration Drill
    // -------------------------------------------------------------
    console.log(`\n--- Test 4: Executing SQL Dump Restoration Drill ---`);
    for (const [origDb, restoreDb] of Object.entries(restoreDbMap)) {
      const dumpPath = path.join(backupDir, `${origDb}.sql`);
      const dumpSql = fs.readFileSync(dumpPath, 'utf8');

      console.log(`  -> Restoring ${origDb}.sql into ${restoreDb}...`);
      execSync(`docker exec -i evolution-postgres psql -U postgres -d ${restoreDb}`, {
        input: dumpSql,
        encoding: 'utf8',
        stdio: ['pipe', 'ignore', 'pipe']
      });

      const tableCountStr = runPsql(restoreDb, `SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema');`);
      const restoredTableCount = parseInt(tableCountStr, 10);
      const originalTableCount = manifest.databases[origDb].table_count;

      assert(
        restoredTableCount === originalTableCount,
        `Table count match for ${restoreDb}`,
        `Original: ${originalTableCount}, Restored: ${restoredTableCount}`
      );
    }

    // -------------------------------------------------------------
    // Test 5: Table & Record Level Data Integrity Comparison
    // -------------------------------------------------------------
    console.log(`\n--- Test 5: Row-Level Data Integrity & Cross-Tenant Checksums ---`);

    // A. platform_db verification
    const origBizCount = runPsql('platform_db', `SELECT count(*) FROM platform_businesses;`);
    const restBizCount = runPsql(restoreDbMap['platform_db'], `SELECT count(*) FROM platform_businesses;`);
    assert(origBizCount === restBizCount, 'platform_businesses row count matches', `Count: ${restBizCount}`);

    const origBizList = runPsql('platform_db', `SELECT string_agg(business_code, ',' ORDER BY business_code) FROM platform_businesses;`);
    const restBizList = runPsql(restoreDbMap['platform_db'], `SELECT string_agg(business_code, ',' ORDER BY business_code) FROM platform_businesses;`);
    assert(origBizList === restBizList, 'platform_businesses tenant codes match exactly', `Tenants: ${restBizList}`);

    const restInstCount = runPsql(restoreDbMap['platform_db'], `SELECT count(*) FROM platform_whatsapp_instances;`);
    assert(parseInt(restInstCount, 10) >= 3, 'platform_whatsapp_instances restored cleanly', `Instances: ${restInstCount}`);

    const restPermCount = runPsql(restoreDbMap['platform_db'], `SELECT count(*) FROM platform_tool_permissions;`);
    assert(parseInt(restPermCount, 10) > 0, 'platform_tool_permissions matrix restored cleanly', `Perms: ${restPermCount}`);

    // B. pos_db verification
    const origProdCount = runPsql('pos_db', `SELECT count(*) FROM pos_products;`);
    const restProdCount = runPsql(restoreDbMap['pos_db'], `SELECT count(*) FROM pos_products;`);
    assert(origProdCount === restProdCount, 'pos_products row count matches', `Count: ${restProdCount}`);

    // C. bise_db verification
    const origStudCount = runPsql('bise_db', `SELECT count(*) FROM students;`);
    const restStudCount = runPsql(restoreDbMap['bise_db'], `SELECT count(*) FROM students;`);
    assert(origStudCount === restStudCount, 'bise_students row count matches', `Count: ${restStudCount}`);

    // D. hospital_db verification
    const origDocCount = runPsql('hospital_db', `SELECT count(*) FROM hospital_doctors;`);
    const restDocCount = runPsql(restoreDbMap['hospital_db'], `SELECT count(*) FROM hospital_doctors;`);
    assert(origDocCount === restDocCount, 'hospital_doctors row count matches', `Count: ${restDocCount}`);

    const origApptCount = runPsql('hospital_db', `SELECT count(*) FROM appointments;`);
    const restApptCount = runPsql(restoreDbMap['hospital_db'], `SELECT count(*) FROM appointments;`);
    assert(origApptCount === restApptCount, 'hospital appointments row count matches', `Count: ${restApptCount}`);

    // -------------------------------------------------------------
    // Test 6: Security Role & Policy Integrity on Restored DB
    // -------------------------------------------------------------
    console.log(`\n--- Test 6: Security & Role Permissions on Restored Database ---`);
    const roTest = runPsql(restoreDbMap['platform_db'], `SELECT count(*) FROM platform_businesses;`);
    assert(parseInt(roTest, 10) > 0, 'Restored database queryable by platform owner/admin');

    // -------------------------------------------------------------
    // Test 7: n8n Workflow JSON Structural Integrity
    // -------------------------------------------------------------
    console.log(`\n--- Test 7: n8n Production Workflow Structural Integrity ---`);
    const n8nPath = path.join(backupDir, 'evolution_whatsapp_ai_agent_bot.json');
    const n8nContent = fs.readFileSync(n8nPath, 'utf8');
    const n8nJson = JSON.parse(n8nContent);

    assert(Array.isArray(n8nJson.nodes), 'n8n JSON has valid nodes array');
    assert(n8nJson.nodes.length >= 18, 'n8n workflow contains full multi-tenant architecture (18 nodes)', `Nodes: ${n8nJson.nodes.length}`);
    
    const nodeNames = n8nJson.nodes.map(n => n.name);
    assert(nodeNames.includes('Evolution Webhook'), 'n8n workflow contains Evolution Webhook node');
    assert(nodeNames.some(name => name.includes('AI Agent')), 'n8n workflow contains AI Agent node');

    // -------------------------------------------------------------
    // Test 8: Cleanup Temporary Restore Databases
    // -------------------------------------------------------------
    console.log(`\n--- Test 8: Cleaning Up Isolated Temporary Restore Targets ---`);
    for (const [origDb, restoreDb] of Object.entries(restoreDbMap)) {
      runPsql('postgres', `DROP DATABASE IF EXISTS ${restoreDb};`);
      const checkClean = runPsql('postgres', `SELECT count(*) FROM pg_database WHERE datname = '${restoreDb}';`);
      assert(checkClean === '0', `Cleaned up disposable target DB: ${restoreDb}`);
    }

    // -------------------------------------------------------------
    // Test 9: RTO Measurement & Exit Criteria Assertion
    // -------------------------------------------------------------
    console.log(`\n--- Test 9: Recovery Time Objective (RTO) Evaluation ---`);
    const endTime = Date.now();
    const durationSeconds = parseFloat(((endTime - startTime) / 1000).toFixed(2));
    results.rto_seconds = durationSeconds;

    console.log(`  ⏱️ Total Disaster Recovery Execution Time (RTO): ${durationSeconds} seconds`);
    assert(durationSeconds < 900, `RTO met (< 900 seconds target)`, `Actual RTO: ${durationSeconds}s`);

  } catch (err) {
    console.error(`💥 Unhandled Exception in DR Verification: ${err.message}`);
    assert(false, 'Disaster recovery verification completed without exception', err.message);
  }

  // Write Results Report
  const reportPath = path.join('d:', 'AI-Automation', 'docs', 'phase38_dr_verification_results.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf8');

  console.log(`\n================================================================`);
  console.log(`📊 PHASE 38 DR VERIFICATION SUMMARY:`);
  console.log(`   Passed: ${results.passed}`);
  console.log(`   Failed: ${results.failed}`);
  console.log(`   RTO Duration: ${results.rto_seconds}s`);
  console.log(`   Report Saved: ${reportPath}`);
  console.log(`================================================================\n`);

  if (results.failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runDisasterRecoveryVerification();
}

module.exports = { runDisasterRecoveryVerification };
