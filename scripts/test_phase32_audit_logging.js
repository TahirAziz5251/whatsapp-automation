/**
 * Phase 32 Test Suite: Audit Logging + Error Handling
 * 
 * Tests end-to-end request tracing, secret sanitization, recoverable vs fatal error paths,
 * dual logging (stdout + PostgreSQL platform_audit_metadata), and result validator integration.
 */

const assert = require('assert');
const { execSync } = require('child_process');
const auditLogger = require('./audit_logger');
const { validateAgentResponse } = require('./result_validator');

function runPsql(sqlCommand, dbName = 'platform_db') {
  const sanitizedSql = sqlCommand.replace(/\n/g, ' ');
  const cmd = `docker exec -i evolution-postgres psql -U postgres -d ${dbName} -t -A -c "${sanitizedSql}"`;
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

console.log('================================================================');
console.log('       RUNNING PHASE 32 AUDIT LOGGING & ERROR HANDLING TESTS     ');
console.log('================================================================\n');

async function runTests() {
  let passedAssertions = 0;

  // 1. Request ID Generation & Format Test
  console.log('▶ Test 1: Request ID Generation & Prefix Format...');
  const reqId1 = auditLogger.generateRequestId('req_test');
  assert(reqId1.startsWith('req_test_'), 'Request ID must start with custom prefix');
  assert(reqId1.length > 15, 'Request ID must be sufficiently long and unique');
  passedAssertions++;
  console.log('  ✓ PASSED: Unique Request ID generated:', reqId1);

  // 2. Secret & PII Sanitization Test
  console.log('\n▶ Test 2: Secret & Sensitive Payload Sanitization...');
  const dirtyPayload = {
    request_id: reqId1,
    db_url: 'postgres://admin:SuperSecretPass123!@localhost:5432/pos_db',
    password: 'MyTopSecretPassword',
    api_key: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    user_cnic: '35202-7654321-9',
    credit_card: '4532 1122 3344 9988',
    iban: 'PK36HABB0000112233445566',
    normal_field: 'Public Order Info'
  };

  const cleanPayload = auditLogger.sanitizeSecrets(dirtyPayload);
  assert.strictEqual(cleanPayload.password, '[REDACTED_SECRET]', 'Password must be redacted');
  assert.strictEqual(cleanPayload.api_key, '[REDACTED_SECRET]', 'API key must be redacted');
  assert.strictEqual(cleanPayload.db_url, '[REDACTED_DB_CONNECTION]', 'Database URL must be redacted');
  assert.strictEqual(cleanPayload.user_cnic, '35202-*******-9', 'CNIC must be masked');
  assert.strictEqual(cleanPayload.credit_card, '**** **** **** 9988', 'Credit Card must be masked');
  assert.strictEqual(cleanPayload.iban, 'PK** **** **** **** **** 5566', 'IBAN must be masked');
  assert.strictEqual(cleanPayload.normal_field, 'Public Order Info', 'Normal fields must be preserved');
  passedAssertions += 7;
  console.log('  ✓ PASSED: All secrets, connection strings, and PII properly sanitized');

  // 3. Request Trace Field Completeness Test
  console.log('\n▶ Test 3: Request Trace 12-Field Completeness Test...');
  const reqId3 = auditLogger.generateRequestId('trace_test');
  const trace3 = auditLogger.createRequestTrace({
    request_id: reqId3,
    business_id: 'POS_RETAIL',
    instance: 'pos-main',
    user_session: '923009988776',
    intent: 'create_order',
    tool_requested: 'action_write',
    tool_executed: 'create_order',
    execution_result: 'SUCCESS',
    response: 'Order ORD-2026-999 created successfully.',
    latency_ms: 125,
    error: 'NONE',
    timestamp: new Date().toISOString()
  });

  const REQUIRED_FIELDS = [
    'request_id', 'business_id', 'instance', 'user_session',
    'intent', 'tool_requested', 'tool_executed', 'execution_result',
    'response', 'latency_ms', 'error', 'timestamp'
  ];

  REQUIRED_FIELDS.forEach(field => {
    assert(trace3.hasOwnProperty(field), `Trace missing required field: ${field}`);
    assert(trace3[field] !== undefined && trace3[field] !== null, `Field ${field} must not be null/undefined`);
  });
  passedAssertions += 12;
  console.log('  ✓ PASSED: Complete 12-field trace verified for request ID:', reqId3);

  // 4. PostgreSQL DB Audit Log Persistence Test
  console.log('\n▶ Test 4: PostgreSQL Audit Log Persistence Test...');
  const reqId4 = auditLogger.generateRequestId('db_audit');
  const trace4 = auditLogger.createRequestTrace({
    request_id: reqId4,
    business_id: 'HOSP_HEALTH',
    instance: 'hosp-main',
    user_session: '923114455667',
    intent: 'book_appointment',
    tool_requested: 'action_write',
    tool_executed: 'book_appointment',
    execution_result: 'SUCCESS',
    response: 'Appointment APT-2026-1234 booked.',
    latency_ms: 210,
    error: 'NONE'
  });

  auditLogger.logAuditTrace(trace4);

  // Query platform_db.platform_audit_metadata to verify DB record creation
  const dbCheckSql = `
    SELECT request_id, business_code, execution_result, error_category, processing_time_ms
    FROM platform_audit_metadata
    WHERE request_id = '${reqId4}'
    LIMIT 1;
  `;
  const dbResultRaw = runPsql(dbCheckSql, 'platform_db');
  assert(dbResultRaw && dbResultRaw.length > 0, 'Audit record must exist in platform_audit_metadata table');

  const [dbReqId, dbBCode, dbExecRes, dbErrCat, dbLatency] = dbResultRaw.split('|').map(s => s.trim());
  assert.strictEqual(dbReqId, reqId4, 'Database request_id must match');
  assert.strictEqual(dbBCode, 'HOSP_HEALTH', 'Database business_code must match');
  assert.strictEqual(dbExecRes, 'SUCCESS', 'Database execution_result must match');
  assert.strictEqual(dbErrCat, 'NONE', 'Database error_category must match');
  assert.strictEqual(parseInt(dbLatency, 10), 210, 'Database processing_time_ms must match');
  passedAssertions += 6;
  console.log('  ✓ PASSED: Audit trace successfully persisted to platform_audit_metadata');

  // 5. Recoverable Error Path Test
  console.log('\n▶ Test 5: Standardized Recoverable Error Path...');
  const recResult = auditLogger.handleError('Read operation get_product is not permitted in Action Gateway', {
    request_id: auditLogger.generateRequestId('rec_err'),
    business_code: 'POS_RETAIL',
    instance_name: 'pos-main',
    customer_phone: '923001112233',
    intent: 'get_product',
    tool_requested: 'action_write',
    error_code: 'READ_OPERATION_REJECTED',
    user_message: '[ACTION GATEWAY NOTICE] Read operations belong in Knowledge Gateway.'
  });

  assert.strictEqual(recResult.status, 'RECOVERABLE_ERROR', 'Status must be RECOVERABLE_ERROR');
  assert.strictEqual(recResult.error_category, 'READ_OPERATION_REJECTED', 'Category must match error code');
  assert(recResult.message && recResult.message.toLowerCase().includes('action gateway'), 'Message must contain user notice');
  assert.strictEqual(recResult.sanitized_trace.execution_result, 'REJECTED', 'Execution result must be REJECTED');
  passedAssertions += 4;
  console.log('  ✓ PASSED: Recoverable error path verified without crashing');

  // 6. Fatal Error Path Test
  console.log('\n▶ Test 6: Standardized Fatal System Error Path...');
  const fakeFatalErr = new Error('psql: error: connection to server on socket failed: FATAL');
  fakeFatalErr.stack = 'Error: psql: error...\n at runPsql (/app/scripts/action_gateway.js:45:12)';

  const fatalReqId = auditLogger.generateRequestId('fatal_test');
  const fatalResult = auditLogger.handleError(fakeFatalErr, {
    request_id: fatalReqId,
    business_code: 'BISE_EDU',
    instance_name: 'bise-main',
    customer_phone: '923008889900',
    intent: 'submit_verification',
    error_code: 'DB_CONNECTION_ERROR'
  });

  assert.strictEqual(fatalResult.status, 'FATAL_ERROR', 'Status must be FATAL_ERROR');
  assert.strictEqual(fatalResult.error_category, 'DB_CONNECTION_ERROR', 'Category must be DB_CONNECTION_ERROR');
  assert(fatalResult.message.includes(fatalReqId), 'Polite message must include request_id reference');
  assert(!fatalResult.message.includes('socket failed'), 'Internal stack error must not leak to user');
  assert.strictEqual(fatalResult.sanitized_trace.execution_result, 'FATAL_ERROR', 'Execution result must be FATAL_ERROR');
  passedAssertions += 5;
  console.log('  ✓ PASSED: Fatal error caught cleanly, trace logged, internal details hidden from user');

  // 7. Result Validator Integration & Trace Attach Test
  console.log('\n▶ Test 7: Result Validator Integration & End-to-End Audit Log...');
  const valContext = {
    request_id: auditLogger.generateRequestId('val_test'),
    business_code: 'POS_RETAIL',
    instance_name: 'pos-main',
    customerPhone: '923004455667',
    intent: 'create_order',
    start_time: Date.now() - 85
  };

  const mockExecutions = [{
    action: 'create_order',
    status: 'SUCCESS',
    result: { order_number: 'ORD-2026-8888', total_amount_pkr: 2500 }
  }];

  const valRes = validateAgentResponse('Your order ORD-2026-8888 has been created successfully.', mockExecutions, valContext);

  assert.strictEqual(valRes.blocked, false, 'Validation should pass');
  assert(valRes.request_id, 'Result must include request_id');
  assert(valRes.trace, 'Result must include audit trace');
  assert.strictEqual(valRes.trace.business_id, 'POS_RETAIL', 'Trace business_id must match context');
  assert.strictEqual(valRes.trace.tool_executed, 'create_order', 'Trace tool_executed must match execution action');
  assert.strictEqual(valRes.trace.execution_result, 'SUCCESS', 'Trace execution_result must be SUCCESS');
  assert(valRes.trace.latency_ms >= 85, 'Trace latency must reflect elapsed time');
  passedAssertions += 7;
  console.log('  ✓ PASSED: Result Validator successfully integrated with Phase 32 Audit Logger');

  console.log('\n================================================================');
  console.log(` SUMMARY: ${passedAssertions} Assertions Passed | 0 Failures`);
  console.log('================================================================');
}

runTests().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
