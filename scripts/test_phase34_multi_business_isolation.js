/**
 * Phase 34: Multi-Business Isolation Test Suite
 * 
 * Objective:
 * Prove data, knowledge, tool, and session isolation across all business domains.
 * Any cross-domain result is treated as a release-blocking defect.
 * 
 * Critical Acceptance Matrix:
 * | Test | Expected |
 * |---|---|
 * | POS -> pos_db | Allowed |
 * | POS -> hospital_db | Denied |
 * | BISE -> BISE KB | Allowed |
 * | BISE -> Hospital KB | Denied |
 * | Hospital session -> POS session | Denied |
 * | POS tool -> Hospital-only action | Denied |
 * | Inactive business access | Denied |
 */

const assert = require('assert');
const iso = require('./multi_business_isolation');
const responseRouter = require('./response_router');

console.log('================================================================');
console.log('     RUNNING PHASE 34 MULTI-BUSINESS ISOLATION TEST SUITE       ');
console.log('================================================================\n');

async function runTests() {
  let passedAssertions = 0;

  // =========================================================================
  // 1. DATABASE ACCESS ISOLATION (Allowed vs. Forbidden)
  // =========================================================================
  console.log('▶ Test 1: Database Access Isolation (Allowed vs. Forbidden)...');
  
  // 1a. POS -> pos_db: Allowed
  const posToPos = iso.verifyDatabaseIsolation('POS_RETAIL', 'pos_db', 'GET_PRODUCTS');
  assert.strictEqual(posToPos.allowed, true, 'POS -> pos_db must be Allowed');
  assert.strictEqual(posToPos.status, 'GATEWAY_SUCCESS', 'Status must be GATEWAY_SUCCESS');
  assert(posToPos.record_count > 0, 'Must retrieve records from pos_db');
  passedAssertions += 3;
  console.log('  ✓ PASSED: POS -> pos_db: Allowed');

  // 1b. POS -> hospital_db: Denied
  const posToHosp = iso.verifyDatabaseIsolation('POS_RETAIL', 'hospital_db', 'GET_PRODUCTS');
  assert.strictEqual(posToHosp.allowed, false, 'POS -> hospital_db must be Denied');
  assert.strictEqual(posToHosp.status, 'GATEWAY_CROSS_DOMAIN_DENIED', 'Status must be GATEWAY_CROSS_DOMAIN_DENIED');
  assert.strictEqual(posToHosp.error_code, 'CROSS_DATABASE_ACCESS_FORBIDDEN', 'Error code must be CROSS_DATABASE_ACCESS_FORBIDDEN');
  passedAssertions += 3;
  console.log('  ✓ PASSED: POS -> hospital_db: Denied');

  // 1c. BISE -> bise_db: Allowed
  const biseToBise = iso.verifyDatabaseIsolation('BISE_EDU', 'bise_db', 'GET_EXAM_RESULT');
  assert.strictEqual(biseToBise.allowed, true, 'BISE -> bise_db must be Allowed');
  assert.strictEqual(biseToBise.status, 'GATEWAY_SUCCESS', 'Status must be GATEWAY_SUCCESS');
  passedAssertions += 2;
  console.log('  ✓ PASSED: BISE -> bise_db: Allowed');

  // 1d. BISE -> pos_db: Denied
  const biseToPos = iso.verifyDatabaseIsolation('BISE_EDU', 'pos_db', 'GET_EXAM_RESULT');
  assert.strictEqual(biseToPos.allowed, false, 'BISE -> pos_db must be Denied');
  assert.strictEqual(biseToPos.status, 'GATEWAY_CROSS_DOMAIN_DENIED', 'Status must be GATEWAY_CROSS_DOMAIN_DENIED');
  passedAssertions += 2;
  console.log('  ✓ PASSED: BISE -> pos_db: Denied');

  // 1e. Hospital -> hospital_db: Allowed
  const hospToHosp = iso.verifyDatabaseIsolation('HOSP_HEALTH', 'hospital_db', 'GET_DOCTOR_SCHEDULE');
  assert.strictEqual(hospToHosp.allowed, true, 'Hospital -> hospital_db must be Allowed');
  assert.strictEqual(hospToHosp.status, 'GATEWAY_SUCCESS', 'Status must be GATEWAY_SUCCESS');
  passedAssertions += 2;
  console.log('  ✓ PASSED: Hospital -> hospital_db: Allowed');

  // 1f. Hospital -> pos_db: Denied
  const hospToPos = iso.verifyDatabaseIsolation('HOSP_HEALTH', 'pos_db', 'GET_DOCTOR_SCHEDULE');
  assert.strictEqual(hospToPos.allowed, false, 'Hospital -> pos_db must be Denied');
  assert.strictEqual(hospToPos.status, 'GATEWAY_CROSS_DOMAIN_DENIED', 'Status must be GATEWAY_CROSS_DOMAIN_DENIED');
  passedAssertions += 2;
  console.log('  ✓ PASSED: Hospital -> pos_db: Denied');

  // =========================================================================
  // 2. KNOWLEDGE BASE CROSS-DOMAIN ISOLATION (Zero Chunk Leakage)
  // =========================================================================
  console.log('\n▶ Test 2: Knowledge Base Cross-Domain Isolation (Zero Chunk Leakage)...');

  // 2a. BISE -> BISE KB: Allowed
  const biseKb = iso.verifyKnowledgeIsolation('BISE_EDU', 'Matric roll number verification duplicate certificate fee');
  assert.strictEqual(biseKb.allowed, true, 'BISE -> BISE KB query must be executed');
  assert(biseKb.chunk_count > 0, 'BISE -> BISE KB must return matching documentation chunks');
  passedAssertions += 2;
  console.log(`  ✓ PASSED: BISE -> BISE KB: Allowed (${biseKb.chunk_count} chunks found)`);

  // 2b. BISE -> Hospital KB: Denied (Zero chunks leaked)
  const biseToHospKb = iso.verifyKnowledgeIsolation('BISE_EDU', 'Cardiology clinic timings Dr Sarah Khan consultation fee');
  assert.strictEqual(biseToHospKb.chunk_count, 0, 'BISE -> Hospital KB must return ZERO chunks (zero leakage)');
  assert(biseToHospKb.formatted_context.includes('No verified documentation found'), 'Must format isolation notice');
  passedAssertions += 2;
  console.log('  ✓ PASSED: BISE -> Hospital KB: Denied (0 chunks leaked)');

  // 2c. POS -> BISE KB: Denied (Zero chunks leaked)
  const posToBiseKb = iso.verifyKnowledgeIsolation('POS_RETAIL', 'Intermediate roll number 102450 verification result');
  assert.strictEqual(posToBiseKb.chunk_count, 0, 'POS -> BISE KB must return ZERO chunks');
  passedAssertions += 1;
  console.log('  ✓ PASSED: POS -> BISE KB: Denied (0 chunks leaked)');

  // 2d. Tenant Spoofing Defense in KB: LLM-passed foreign tenant parameter ignored
  const spoofKb = iso.verifyKnowledgeIsolation('POS_RETAIL', 'Intermediate roll number 102450 verification result', { business_code: 'BISE_EDU' });
  assert.strictEqual(spoofKb.chunk_count, 0, 'Tenant spoofing in KB search must be ignored and return 0 results');
  passedAssertions += 1;
  console.log('  ✓ PASSED: Tenant spoofing attempt ignored; pinned to caller trusted context');

  // =========================================================================
  // 3. SESSION STORE COLLISION & STATE ISOLATION
  // =========================================================================
  console.log('\n▶ Test 3: Session Store Collision & State Isolation...');
  const testPhone = '+923009988776';
  const sessionResult = iso.verifySessionIsolation(testPhone, 'POS_RETAIL', 'HOSP_HEALTH');

  assert.strictEqual(sessionResult.isolated, true, 'Sessions must be completely isolated');
  assert.strictEqual(sessionResult.state_a_has_cart, true, 'POS session must retain cart state');
  assert.strictEqual(sessionResult.state_b_has_cardiology, true, 'Hospital session must retain clinical state');
  assert.strictEqual(sessionResult.cross_read_empty, true, 'Cross-tenant session reading must be denied/empty');
  passedAssertions += 4;
  console.log('  ✓ PASSED: Hospital session -> POS session: Denied & Isolated (0 collision)');

  // =========================================================================
  // 4. ACTION GATEWAY / TOOL ISOLATION (Outside-LLM Enforcement)
  // =========================================================================
  console.log('\n▶ Test 4: Action Gateway / Tool Isolation (Outside-LLM Enforcement)...');

  // 4a. POS tool -> Hospital-only action (book_appointment): Denied
  const posHospAction = iso.verifyToolIsolation('POS_RETAIL', 'book_appointment', {
    doctor_id: 1,
    appointment_date: '2026-10-09',
    time_slot: '10:00'
  });
  assert.strictEqual(posHospAction.status, 'SECURITY_POLICY_DENIED', 'Status must be SECURITY_POLICY_DENIED');
  assert.strictEqual(posHospAction.error_code, 'UNAUTHORIZED_TENANT_ACTION', 'Error code must be UNAUTHORIZED_TENANT_ACTION');
  passedAssertions += 2;
  console.log('  ✓ PASSED: POS tool -> Hospital-only action (book_appointment): Denied');

  // 4b. Hospital tool -> POS-only action (create_order): Denied
  const hospPosAction = iso.verifyToolIsolation('HOSP_HEALTH', 'create_order', {
    items: [{ sku: 'POS-HW-001', quantity: 1 }]
  });
  assert.strictEqual(hospPosAction.status, 'SECURITY_POLICY_DENIED', 'Status must be SECURITY_POLICY_DENIED');
  assert.strictEqual(hospPosAction.error_code, 'UNAUTHORIZED_TENANT_ACTION', 'Error code must be UNAUTHORIZED_TENANT_ACTION');
  passedAssertions += 2;
  console.log('  ✓ PASSED: Hospital tool -> POS-only action (create_order): Denied');

  // 4c. BISE tool -> POS-only action (create_order): Denied
  const bisePosAction = iso.verifyToolIsolation('BISE_EDU', 'create_order', {
    items: [{ sku: 'POS-HW-001', quantity: 1 }]
  });
  assert.strictEqual(bisePosAction.status, 'SECURITY_POLICY_DENIED', 'Status must be SECURITY_POLICY_DENIED');
  assert.strictEqual(bisePosAction.error_code, 'UNAUTHORIZED_TENANT_ACTION', 'Error code must be UNAUTHORIZED_TENANT_ACTION');
  passedAssertions += 2;
  console.log('  ✓ PASSED: BISE tool -> POS-only action (create_order): Denied');

  // 4d. Hospital tool -> BISE-only action (submit_service_application): Denied
  const hospBiseAction = iso.verifyToolIsolation('HOSP_HEALTH', 'submit_service_application', {
    service_type: 'NOC_MIGRATION'
  });
  assert.strictEqual(hospBiseAction.status, 'SECURITY_POLICY_DENIED', 'Status must be SECURITY_POLICY_DENIED');
  passedAssertions += 1;
  console.log('  ✓ PASSED: Hospital tool -> BISE-only action (submit_service_application): Denied');

  // =========================================================================
  // 5. INACTIVE BUSINESS BARRIER TESTS
  // =========================================================================
  console.log('\n▶ Test 5: Inactive Business Barrier Tests (INACTIVE_CORP)...');

  // 5a. Inactive Business DB access: Denied
  const inactDb = iso.verifyDatabaseIsolation('INACTIVE_CORP', 'pos_db', 'GET_PRODUCTS');
  assert.strictEqual(inactDb.allowed, false, 'Inactive business DB access must be Denied');
  assert.strictEqual(inactDb.status, 'INACTIVE_BUSINESS_DENIED', 'Status must be INACTIVE_BUSINESS_DENIED');
  passedAssertions += 2;
  console.log('  ✓ PASSED: Inactive business DB access: Denied');

  // 5b. Inactive Business KB access: Denied
  const inactKb = iso.verifyKnowledgeIsolation('INACTIVE_CORP', 'any query text');
  assert.strictEqual(inactKb.allowed, false, 'Inactive business KB access must be Denied');
  assert.strictEqual(inactKb.status, 'INACTIVE_BUSINESS_DENIED', 'Status must be INACTIVE_BUSINESS_DENIED');
  passedAssertions += 2;
  console.log('  ✓ PASSED: Inactive business KB access: Denied');

  // 5c. Inactive Business Action execution: Denied
  const inactAction = iso.verifyToolIsolation('INACTIVE_CORP', 'create_order', {});
  assert.strictEqual(inactAction.status, 'DENIED', 'Inactive business action execution must be Denied');
  assert.strictEqual(inactAction.error_code, 'BUSINESS_INACTIVE_DENIED', 'Error code must be BUSINESS_INACTIVE_DENIED');
  passedAssertions += 2;
  console.log('  ✓ PASSED: Inactive business Action execution: Denied');

  // 5d. Inactive Business Response Router mapping: Denied
  const inactRouter = responseRouter.resolveInstanceMapping('inactive-instance', 'INACTIVE_CORP');
  assert.strictEqual(inactRouter.valid, false, 'Inactive business response routing must be Denied');
  passedAssertions += 1;
  console.log('  ✓ PASSED: Inactive business Response Router dispatch: Denied');

  console.log('\n================================================================');
  console.log(` SUMMARY: ${passedAssertions} Assertions Passed | 0 Failures`);
  console.log('================================================================');
}

runTests().catch(err => {
  console.error('\n❌ ISOLATION TEST SUITE FAILED:', err);
  process.exit(1);
});
