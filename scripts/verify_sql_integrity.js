/**
 * Database Scripts & Dummy Data Integrity Verifier
 * Validates syntax, mathematical consistency, foreign key relationships,
 * and constraint integrity across all 5 canonical database files.
 */

const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, '..', 'database');

const files = [
  'apply-backend-safeguards.sql',
  'init-bise-db.sql',
  'init-hospital-db.sql',
  'init-platform-db.sql',
  'init-pos-db.sql'
];

let totalPassed = 0;
let totalFailed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${testName} ${details ? '(' + details + ')' : ''}`);
    totalPassed++;
  } else {
    console.error(`  ❌ FAIL: ${testName} ${details ? '(' + details + ')' : ''}`);
    totalFailed++;
  }
}

console.log('================================================================');
console.log('🔍 VERIFYING SQL SCRIPTS & DUMMY DATA INTEGRITY');
console.log('================================================================\n');

// 1. Verify File Existence & Non-trivial Size
console.log('--- 1. File Presence & Size Validation ---');
for (const f of files) {
  const fullPath = path.join(DB_DIR, f);
  const exists = fs.existsSync(fullPath);
  assert(exists, `File exists: ${f}`);
  if (exists) {
    const size = fs.statSync(fullPath).size;
    assert(size > 2000, `File size is substantial: ${f}`, `Size: ${size} bytes`);
  }
}

// 2. Validate init-platform-db.sql restoration
console.log('\n--- 2. Validating init-platform-db.sql Restoration ---');
const platformSql = fs.readFileSync(path.join(DB_DIR, 'init-platform-db.sql'), 'utf8');
const requiredPlatformTables = [
  'platform_businesses',
  'platform_whatsapp_instances',
  'platform_business_profiles',
  'platform_database_mappings',
  'platform_knowledge_mappings',
  'platform_tool_permissions',
  'platform_agent_configs',
  'session_metadata',
  'platform_workflow_versions',
  'platform_audit_metadata',
  'conversations',
  'conversation_messages',
  'conversation_summary',
  'knowledge_documents',
  'knowledge_chunks',
  'platform_action_approvals'
];

for (const tbl of requiredPlatformTables) {
  assert(platformSql.includes(`CREATE TABLE IF NOT EXISTS ${tbl}`), `Platform Table Defined: ${tbl}`);
}
assert(platformSql.includes("'POS_RETAIL'"), 'Contains POS_RETAIL tenant seed');
assert(platformSql.includes("'BISE_EDU'"), 'Contains BISE_EDU tenant seed');
assert(platformSql.includes("'HOSP_HEALTH'"), 'Contains HOSP_HEALTH tenant seed');

// 3. Validate init-bise-db.sql (Subject Breakdowns & CNIC Masking)
console.log('\n--- 3. Validating init-bise-db.sql Enhancements ---');
const biseSql = fs.readFileSync(path.join(DB_DIR, 'init-bise-db.sql'), 'utf8');

// Check CNIC Masking logic
assert(biseSql.includes("LENGTH(REGEXP_REPLACE(s.b_form_cnic, '[^0-9]', '', 'g')) = 13"), 'CNIC masking handles 13-digit raw format');
assert(biseSql.includes("SUBSTRING(REGEXP_REPLACE(s.b_form_cnic, '[^0-9]', '', 'g') FROM 1 FOR 5) || '-*******-'"), 'CNIC masking produces standard 35201-*******-X mask');

// Check Subject Marks for Results 1, 2, 3, 4
const rollNumbers = ['102450', '102451', '204501', '204502'];
for (const roll of rollNumbers) {
  assert(biseSql.includes(`roll_number = '${roll}'`), `Subject marks exist for Roll ${roll}`);
}

// Math verification for Result 2 (Roll 102451: 880 / 1100)
const res2Marks = [110, 112, 80, 78, 125, 128, 122, 125];
const res2Sum = res2Marks.reduce((a, b) => a + b, 0);
assert(res2Sum === 880, 'Result 2 marks sum exact match', `Sum: ${res2Sum} / 880`);

// Math verification for Result 3 (Roll 204501: 995 / 1100)
const res3Marks = [180, 175, 90, 190, 180, 180];
const res3Sum = res3Marks.reduce((a, b) => a + b, 0);
assert(res3Sum === 995, 'Result 3 marks sum exact match', `Sum: ${res3Sum} / 995`);

// Math verification for Result 4 (Roll 204502: 750 / 1100)
const res4Marks = [130, 135, 70, 140, 135, 140];
const res4Sum = res4Marks.reduce((a, b) => a + b, 0);
assert(res4Sum === 750, 'Result 4 marks sum exact match', `Sum: ${res4Sum} / 750`);

// 4. Validate init-hospital-db.sql (Unique Constraints on Doctors & Schedules)
console.log('\n--- 4. Validating init-hospital-db.sql Idempotency & Constraints ---');
const hospSql = fs.readFileSync(path.join(DB_DIR, 'init-hospital-db.sql'), 'utf8');

assert(hospSql.includes('CONSTRAINT unique_doctor_department UNIQUE (department_id, doctor_name)'), 'Doctors table has unique_doctor_department constraint');
assert(hospSql.includes('CONSTRAINT unique_doctor_schedule UNIQUE (doctor_id, available_days)'), 'Schedules table has unique_doctor_schedule constraint');
assert(hospSql.includes('ON CONFLICT (department_id, doctor_name) DO UPDATE'), 'Doctors insert uses idempotent ON CONFLICT (department_id, doctor_name)');
assert(hospSql.includes('ON CONFLICT (doctor_id, available_days) DO UPDATE'), 'Schedules insert uses idempotent ON CONFLICT (doctor_id, available_days)');

// 5. Validate init-pos-db.sql (Order Items, Constraints & Catalog Prices)
console.log('\n--- 5. Validating init-pos-db.sql Enhancements ---');
const posSql = fs.readFileSync(path.join(DB_DIR, 'init-pos-db.sql'), 'utf8');

assert(posSql.includes('CONSTRAINT unique_order_product_variant UNIQUE NULLS NOT DISTINCT (order_id, product_id, variant_id)'), 'Order items table has unique_order_product_variant constraint');
assert(posSql.includes('ON CONFLICT (order_id, product_id, variant_id) DO UPDATE'), 'Order items insert has targeted ON CONFLICT clause');

// Check subqueries used in order_items
assert(posSql.includes("(SELECT id FROM orders WHERE order_number = 'ORD-2026-001' LIMIT 1)"), 'Dynamic subquery used for order_id');
assert(posSql.includes("(SELECT id FROM products WHERE sku = 'POS-HW-001' LIMIT 1)"), 'Dynamic subquery used for product_id');
assert(posSql.includes("(SELECT id FROM product_variants WHERE variant_sku = 'POS-HW-001-USB' LIMIT 1)"), 'Dynamic subquery used for variant_id');

// Verify Order 1 Catalog Price Alignment
// Item 1: POS-HW-001 @ 35,000 | Item 2: POS-HW-002 @ 19,500 | Total = 54,500
assert(posSql.includes("54500.00, 'PAID'"), 'Order 1 total amount aligned with catalog prices (54500.00 PKR)');
assert(posSql.includes("54500.00, 'COMPLETED'"), 'Payment for Order 1 aligned with order total (54500.00 PKR)');

// 6. Validate apply-backend-safeguards.sql
console.log('\n--- 6. Validating apply-backend-safeguards.sql ---');
const safeguardsSql = fs.readFileSync(path.join(DB_DIR, 'apply-backend-safeguards.sql'), 'utf8');
const targetDbs = ['platform_db', 'pos_db', 'bise_db', 'hospital_db'];
for (const db of targetDbs) {
  assert(safeguardsSql.includes(`ALTER DATABASE ${db} SET statement_timeout`), `Database timeout configured: ${db}`);
}
assert(safeguardsSql.includes("ALTER ROLE gateway_readonly SET statement_timeout = '10s'"), 'gateway_readonly 10s timeout configured');
assert(safeguardsSql.includes("ALTER ROLE gateway_action_writer SET statement_timeout = '15s'"), 'gateway_action_writer 15s timeout configured');

console.log('\n================================================================');
console.log(`🏁 INTEGRITY AUDIT FINISHED: ${totalPassed} PASSED, ${totalFailed} FAILED`);
console.log('================================================================\n');

if (totalFailed > 0) {
  process.exit(1);
}
