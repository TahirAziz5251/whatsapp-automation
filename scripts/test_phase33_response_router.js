/**
 * Phase 33 Test Suite: Evolution Response Router
 * 
 * Verifies business-aware instance resolution, cross-domain instance isolation,
 * dynamic endpoint construction, retry mechanism, secret sanitization, and DB audit logging.
 */

const assert = require('assert');
const { execSync } = require('child_process');
const fs = require('fs');
const responseRouter = require('./response_router');
const auditLogger = require('./audit_logger');

function runPsql(sqlCommand, dbName = 'platform_db') {
  const sanitizedSql = sqlCommand.replace(/\n/g, ' ');
  const cmd = `docker exec -i evolution-postgres psql -U postgres -d ${dbName} -t -A -c "${sanitizedSql}"`;
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

console.log('================================================================');
console.log('      RUNNING PHASE 33 EVOLUTION RESPONSE ROUTER VERIFICATION    ');
console.log('================================================================\n');

async function runTests() {
  let passedAssertions = 0;

  // 1. Instance Resolution for User-Selected Instance Names
  console.log('▶ Test 1: User-Selected Instance Name & Domain Resolution...');
  
  const posMap = responseRouter.resolveInstanceMapping('point-of-sale', 'POS_RETAIL');
  assert.strictEqual(posMap.valid, true, 'POS instance mapping must be valid');
  assert.strictEqual(posMap.business_code, 'POS_RETAIL', 'Business code must be POS_RETAIL');
  assert.strictEqual(posMap.instance_name, 'point-of-sale', 'Instance name must be point-of-sale');
  passedAssertions += 3;
  console.log('  ✓ PASSED: point-of-sale -> POS_RETAIL verified');

  const biseMap = responseRouter.resolveInstanceMapping('student-assistant', 'BISE_EDU');
  assert.strictEqual(biseMap.valid, true, 'BISE instance mapping must be valid');
  assert.strictEqual(biseMap.business_code, 'BISE_EDU', 'Business code must be BISE_EDU');
  assert.strictEqual(biseMap.instance_name, 'student-assistant', 'Instance name must be student-assistant');
  passedAssertions += 3;
  console.log('  ✓ PASSED: student-assistant -> BISE_EDU verified');

  const hospMap = responseRouter.resolveInstanceMapping('hospital-assistant', 'HOSP_HEALTH');
  assert.strictEqual(hospMap.valid, true, 'Hospital instance mapping must be valid');
  assert.strictEqual(hospMap.business_code, 'HOSP_HEALTH', 'Business code must be HOSP_HEALTH');
  assert.strictEqual(hospMap.instance_name, 'hospital-assistant', 'Instance name must be hospital-assistant');
  passedAssertions += 3;
  console.log('  ✓ PASSED: hospital-assistant -> HOSP_HEALTH verified');

  // 2. Cross-Business Mismatch Denial (Isolation Guard)
  console.log('\n▶ Test 2: Cross-Business Instance Mismatch Denial...');
  const mismatchMap = responseRouter.resolveInstanceMapping('hospital-assistant', 'POS_RETAIL');
  assert.strictEqual(mismatchMap.valid, false, 'Cross-tenant mapping must be denied');
  assert.strictEqual(mismatchMap.error_code, 'CROSS_INSTANCE_MISMATCH', 'Error code must be CROSS_INSTANCE_MISMATCH');
  passedAssertions += 2;
  console.log('  ✓ PASSED: Cross-tenant instance mismatch strictly denied');

  // 3. Dynamic Endpoint Addressing
  console.log('\n▶ Test 3: Dynamic Endpoint Construction...');
  const endpoint = responseRouter.buildEvolutionEndpoint('point-of-sale', 'http://host.docker.internal:4000');
  assert.strictEqual(endpoint, 'http://host.docker.internal:4000/send/text', 'Endpoint URL must match Evolution Go path');
  passedAssertions++;
  console.log('  ✓ PASSED: Dynamic endpoint URL verified:', endpoint);

  // 4. Retry Mechanism & Simulated Dispatch
  console.log('\n▶ Test 4: Retry Mechanism & Simulated HTTP Dispatch...');
  let attemptCounter = 0;
  const mockFailThenSucceed = (url, payload, apiKey) => {
    attemptCounter++;
    if (attemptCounter < 3) {
      throw new Error(`Simulated transient network timeout on attempt ${attemptCounter}`);
    }
    return { statusCode: 200, body: JSON.stringify({ status: 'SUCCESS', messageId: 'MSG_10029' }) };
  };

  const dispatchResult = await responseRouter.dispatchWhatsAppResponse(
    'Thank you for your order! Your receipt is ready. CNIC: 35202-1234567-1',
    {
      request_id: auditLogger.generateRequestId('rr_test'),
      business_code: 'POS_RETAIL',
      instance_name: 'point-of-sale',
      customerPhone: '923009876543'
    },
    {
      mockDispatch: mockFailThenSucceed,
      maxRetries: 3,
      retryDelayMs: 10
    }
  );

  assert.strictEqual(dispatchResult.status, 'DELIVERED', 'Status must be DELIVERED after retry');
  assert.strictEqual(dispatchResult.attempts, 3, 'Must have attempted 3 times before succeeding');
  assert.strictEqual(dispatchResult.sanitized_response.includes('35202-*******-1'), true, 'Response PII must be sanitized');
  passedAssertions += 3;
  console.log('  ✓ PASSED: Response Router retried automatically and delivered after 3 attempts');

  // 5. Audit Log Database Persistence Verification
  console.log('\n▶ Test 5: PostgreSQL Audit Log Persistence Verification...');
  const dbCheckSql = `
    SELECT inbound_payload->>'request_id', business_code, instance_name, outbound_payload->>'execution_result'
    FROM platform_audit_metadata
    WHERE inbound_payload->>'request_id' = '${dispatchResult.request_id}'
    LIMIT 1;
  `;
  const dbRaw = runPsql(dbCheckSql, 'platform_db');
  assert(dbRaw && dbRaw.length > 0, 'Audit record must exist in platform_audit_metadata');

  const [dbReqId, dbBCode, dbInst, dbExecRes] = dbRaw.split('|').map(s => s.trim());
  assert.strictEqual(dbReqId, dispatchResult.request_id, 'Audit request_id must match');
  assert.strictEqual(dbBCode, 'POS_RETAIL', 'Audit business_code must match POS_RETAIL');
  assert.strictEqual(dbInst, 'point-of-sale', 'Audit instance_name must match point-of-sale');
  assert.strictEqual(dbExecRes, 'SUCCESS', 'Audit execution_result must be SUCCESS');
  passedAssertions += 5;
  console.log('  ✓ PASSED: Response Router audit trace successfully persisted in platform_audit_metadata');

  // 6. Workflow Integration Verification (Node 2008)
  console.log('\n▶ Test 6: Workflow Integration Verification (Node 2008 in evolution_whatsapp_ai_agent_bot.json)...');
  const wfJson = JSON.parse(fs.readFileSync('evolution_whatsapp_ai_agent_bot.json', 'utf8'));
  const node2008 = wfJson.nodes.find(n => n.id === '2008');

  assert(node2008, 'Node 2008 must exist in workflow JSON');
  assert(node2008.name.includes('Evolution Router'), 'Node 2008 name must reflect Evolution Router');
  assert(node2008.parameters.description.includes('point-of-sale'), 'Description must include point-of-sale');
  assert(node2008.parameters.description.includes('student-assistant') || node2008.parameters.description.includes('Bise-bwp'), 'Description must include student-assistant');
  assert(node2008.parameters.description.includes('hospital-assistant'), 'Description must include hospital-assistant');
  passedAssertions += 5;
  console.log('  ✓ PASSED: Node 2008 workflow integration verified with all configured instance names');

  console.log('\n================================================================');
  console.log(` SUMMARY: ${passedAssertions} Assertions Passed | 0 Failures`);
  console.log('================================================================');
}

runTests().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
