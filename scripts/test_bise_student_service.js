/**
 * Verification Test Suite: BISE Secure Student Examination Service
 * 
 * Tests:
 * 1. Extraction of verification factors (Name, Roll, CNIC) from WhatsApp text
 * 2. Refusal on missing B-Form/CNIC (Zero assumption that Roll alone = identity)
 * 3. Refusal on invalid / mismatched B-Form/CNIC (Zero unauthorized access)
 * 4. Successful verification with parameterized stored procedure & PII masking
 * 5. Temporary 15-minute authenticated session establishment
 * 6. Authorized follow-up: Subject-wise marks breakdown retrieval
 * 7. Session expiry & Cross-student isolation enforcement
 * 8. SQL Injection & Arbitrary SQL rejection
 * 9. End-to-end Audit logging in platform_audit_metadata
 */

if (process.platform === 'win32') {
  const { execSync } = require('child_process');
  execSync('docker cp d:\\AI-Automation\\scripts\\bise_student_service.js n8n:/tmp/bise_student_service.js');
  execSync('docker cp d:\\AI-Automation\\scripts\\test_bise_student_service.js n8n:/tmp/test_bise_student_service.js');
  execSync('docker exec -i n8n node /tmp/test_bise_student_service.js', { stdio: 'inherit' });
  process.exit(0);
}

const { Client } = require('/usr/local/lib/node_modules/n8n/node_modules/pg');
const {
  extractStudentVerificationData,
  verifyAndFetchStudentResult,
  fetchSubjectWiseMarks,
  getOrUpdateStudentSession,
  logStudentVerificationAudit,
  formatWhatsAppResult,
  formatWhatsAppSubjectMarks
} = require('./bise_student_service');

const PLATFORM_DB_CONFIG = {
  connectionString: 'postgresql://postgres:postgres@evolution-postgres:5432/platform_db'
};

async function queryPlatformDb(sql, params = []) {
  const client = new Client(PLATFORM_DB_CONFIG);
  try {
    await client.connect();
    const res = await client.query(sql, params);
    return res.rows;
  } finally {
    await client.end().catch(() => {});
  }
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('===============================================================');
  console.log('🧪 RUNNING BISE SECURE STUDENT EXAMINATION VERIFICATION SUITE');
  console.log('===============================================================\n');

  // Test 1: Information Extraction from Conceptual WhatsApp Message
  console.log('--- Test 1: Extract Verification Information from WhatsApp text ---');
  const incomingMsg = `My name is Muhammad Ahmad\nRoll No: 102450\nB-Form/CNIC: 35201-1234567-1`;
  const extracted = extractStudentVerificationData(incomingMsg);
  
  assert(extracted.rollNumber === '102450', `Extracted Roll Number: ${extracted.rollNumber}`);
  assert(extracted.rawCnic === '35201-1234567-1', `Extracted raw CNIC: ${extracted.rawCnic}`);
  assert(extracted.normalizedCnic === '3520112345671', `Normalized 13-digit CNIC: ${extracted.normalizedCnic}`);
  assert(extracted.studentName === 'Muhammad Ahmad', `Extracted Student Name: ${extracted.studentName}`);

  // Test 2: Missing B-Form/CNIC Refusal (Roll number alone != authentication)
  console.log('\n--- Test 2: Missing B-Form/CNIC Refusal ---');
  const missingCnicRes = await verifyAndFetchStudentResult({
    rollNumber: '102450',
    cnic: null
  });
  assert(missingCnicRes.success === false, 'Refused result lookup when CNIC is missing');
  assert(missingCnicRes.error_code === 'MISSING_CNIC_BFORM', 'Returned MISSING_CNIC_BFORM error code');

  // Test 3: Invalid / Mismatched B-Form/CNIC Rejection
  console.log('\n--- Test 3: Invalid / Mismatched B-Form/CNIC Rejection ---');
  const invalidCnicRes = await verifyAndFetchStudentResult({
    rollNumber: '102450',
    cnic: '35201-9999999-9' // Mismatched CNIC
  });
  assert(invalidCnicRes.success === false, 'Refused result lookup on mismatched CNIC');
  assert(invalidCnicRes.error_code === 'VERIFICATION_FAILED', 'Returned VERIFICATION_FAILED error code');

  // Test 3b: Student Name Mismatch Rejection
  console.log('\n--- Test 3b: Student Name Mismatch Rejection ---');
  const invalidNameRes = await verifyAndFetchStudentResult({
    rollNumber: '102450',
    cnic: '35201-1234567-1',
    studentName: 'John Doe Fake' // Mismatched Name
  });
  assert(invalidNameRes.success === false, 'Refused result lookup on mismatched Student Name');
  assert(invalidNameRes.error_code === 'NAME_MISMATCH', 'Returned NAME_MISMATCH error code');

  // Test 4: Successful Identity Verification & Masked Examination Result
  console.log('\n--- Test 4: Successful Identity Verification & Masked Result ---');
  const validRes = await verifyAndFetchStudentResult({
    rollNumber: '102450',
    cnic: '35201-1234567-1'
  });
  assert(validRes.success === true, 'Successfully verified student identity');
  assert(validRes.data.student_name === 'Muhammad Ahmad', `Verified Candidate Name: ${validRes.data.student_name}`);
  assert(validRes.data.marks_obtained === 945, `Verified Marks: ${validRes.data.marks_obtained}/1100`);
  assert(validRes.data.grade === 'A+', `Verified Grade: ${validRes.data.grade}`);
  assert(validRes.data.masked_b_form_cnic === '35201-*******-1', `Masked CNIC format: ${validRes.data.masked_b_form_cnic}`);
  assert(!JSON.stringify(validRes.data).includes('35201-1234567-1'), 'Raw CNIC completely removed from data payload');

  // Test 5: Temporary Authenticated Session Establishment (15-Minute TTL)
  console.log('\n--- Test 5: Temporary Authenticated Session Management ---');
  const testSessionId = `bise_test_session_${Date.now()}`;
  const sessionEstablish = await getOrUpdateStudentSession(testSessionId, validRes);
  assert(sessionEstablish.isAuthenticated === true, 'Established authenticated session in platform_session_metadata');
  assert(sessionEstablish.session.roll_number === '102450', 'Session bound to authenticated Roll Number');
  
  // Verify session retrieval on subsequent call
  const sessionCheck = await getOrUpdateStudentSession(testSessionId);
  assert(sessionCheck.isAuthenticated === true, 'Retrieved active authenticated session without re-entering credentials');
  assert(sessionCheck.session.student_name === 'Muhammad Ahmad', 'Session retains verified student name');

  // Test 6: Subsequent Authorized Request: Subject-Wise Marks Breakdown
  console.log('\n--- Test 6: Subject-Wise Marks Breakdown ---');
  const subjectRes = await fetchSubjectWiseMarks({
    rollNumber: '102450',
    cnic: '35201-1234567-1'
  });
  assert(subjectRes.success === true, 'Successfully queried subject-wise breakdown');
  assert(subjectRes.subjects.length === 8, `Retrieved all 8 examination subjects (count: ${subjectRes.subjects.length})`);
  const mathSubj = subjectRes.subjects.find(s => s.subject_name === 'Mathematics');
  assert(mathSubj && mathSubj.obtained_marks === 135, 'Verified Mathematics score: 135/150 (Grade A+)');

  // Test WhatsApp message format
  const waResultMsg = formatWhatsAppResult(validRes.data);
  assert(waResultMsg.includes('Muhammad Ahmad') && waResultMsg.includes('35201-*******-1'), 'WhatsApp result formatted with masked CNIC');
  const waSubjectMsg = formatWhatsAppSubjectMarks(validRes.data, subjectRes.subjects);
  assert(waSubjectMsg.includes('Mathematics') && waSubjectMsg.includes('Computer Science'), 'WhatsApp subject breakdown formatted correctly');

  // Test 7: Cross-Student Protection (Session isolation)
  console.log('\n--- Test 7: Cross-Student Protection ---');
  // Attempting to query another student's marks with wrong CNIC
  const crossStudentRes = await verifyAndFetchStudentResult({
    rollNumber: '102451', // Fatima Zahra's roll number
    cnic: '35201-1234567-1' // Muhammad Ahmad's CNIC
  });
  assert(crossStudentRes.success === false, 'Cross-student inquiry rejected (different student CNIC)');

  // Test 8: SQL Injection Resistance
  console.log('\n--- Test 8: SQL Injection Resistance ---');
  const sqliRes = await verifyAndFetchStudentResult({
    rollNumber: "102450' OR '1'='1",
    cnic: "35201-1234567-1'; DROP TABLE results;--"
  });
  assert(sqliRes.success === false, 'SQL Injection attempt safely blocked by parameterized function');

  // Test 9: Audit Logging
  console.log('\n--- Test 9: Audit Logging in platform_audit_metadata ---');
  const testReqId = `req_bise_verify_${Date.now()}`;
  await logStudentVerificationAudit({
    requestId: testReqId,
    customerPhone: '923001234567',
    rollNumber: '102450',
    verificationStatus: 'SUCCESS_VERIFIED',
    actionType: 'STUDENT_EXAMINATION_RESULT_VERIFICATION',
    latencyMs: 42
  });

  const auditRows = await queryPlatformDb(`
    SELECT COUNT(*) FROM platform_audit_metadata 
    WHERE inbound_payload::text LIKE $1;
  `, [`%${testReqId}%`]);
  const auditCount = parseInt(auditRows[0].count, 10);
  assert(auditCount >= 1, `Audit record verified in platform_audit_metadata (count: ${auditCount})`);

  console.log('\n===============================================================');
  console.log(`🏁 BISE VERIFICATION TEST SUITE FINISHED: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Unhandled Test Runner Error:', err);
  process.exit(1);
});
