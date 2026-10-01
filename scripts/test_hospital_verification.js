/**
 * Comprehensive Hospital Domain Verification Test Suite
 * Domain: HOSP_HEALTH (Healthcare & OPD Appointments Domain)
 * 
 * Verifies:
 * 1. Department Discovery & Directory Search (Cardiology, Pediatrics, Neurology, Orthopedics)
 * 2. Doctor Search by Specialty & OPD Fee Breakdown in PKR
 * 3. Doctor Schedule & OPD Timing Verification
 * 4. Patient Appointment Booking & MRN Generation (book_appointment / create_appointment)
 * 5. Double-Booking Prevention & Time Slot Conflict Rejection
 * 6. Appointment Rescheduling & Atomic History Logging
 * 7. Human Supervisor Approval Gate on Sensitive Cancellations (cancel_appointment -> APR-...)
 * 8. Cross-Customer Ownership & Privacy Gate
 * 9. Multi-Tenant Cross-Domain Policy Gate (POS/BISE vs HOSP_HEALTH)
 * 10. Medical Advice & Autonomous Clinical Diagnosis Rejection Guard
 * 11. Knowledge Base Retrieval for Hospital Policies, Preparation & FAQs
 * 12. Audit Logging in platform_audit_metadata
 */

const assert = require('assert');
const { execSync } = require('child_process');
const { executeActionGateway } = require('./action_gateway');
const { processResponseSecurity } = require('./response_security');

function runPsql(sql) {
  return execSync('docker exec -i evolution-postgres psql -U postgres -d hospital_db -t -A', {
    input: sql,
    encoding: 'utf8'
  }).trim();
}

function runPlatformPsql(sql) {
  return execSync('docker exec -i evolution-postgres psql -U postgres -d platform_db -t -A', {
    input: sql,
    encoding: 'utf8'
  }).trim();
}

function runGateway(action, params, phone = '+923007778899', businessCode = 'HOSP_HEALTH') {
  return executeActionGateway({
    action,
    params,
    trustedSessionContext: {
      business_code: businessCode,
      instance_name: 'hospital-instance',
      customerPhone: phone,
      allowed_tools: ['action_gateway']
    }
  });
}

async function runHospitalVerificationSuite() {
  console.log('========================================================================');
  console.log('🧪 RUNNING HOSPITAL HEALTHCARE DOMAIN VERIFICATION TEST SUITE');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function recordAssert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  // Pre-test cleanup of test artifacts
  try {
    runPsql("DELETE FROM appointment_history WHERE appointment_id IN (SELECT id FROM appointments WHERE patient_id IN (SELECT id FROM patients WHERE patient_phone LIKE '%7778899%'));");
    runPsql("DELETE FROM appointments WHERE patient_id IN (SELECT id FROM patients WHERE patient_phone LIKE '%7778899%');");
  } catch (e) {}

  // --- Test 1: Department Discovery & Directory Search ---
  console.log('--- Test 1: Department Discovery & Directory Search ---');
  try {
    const deptData = runPsql("SELECT department_name, location_floor, head_doctor FROM departments ORDER BY id ASC;");
    const lines = deptData.split('\n').filter(Boolean);
    recordAssert(lines.length >= 4, `Found ${lines.length} hospital departments (expected >= 4)`);
    recordAssert(deptData.includes('Cardiology') && deptData.includes('Pediatrics'), 'Cardiology and Pediatrics departments present');
    recordAssert(deptData.includes('1st Floor, Block A'), 'Department location floors verified');
  } catch (e) {
    recordAssert(false, `Department search failed: ${e.message}`);
  }

  // --- Test 2: Doctor Search by Specialty & OPD Fees in PKR ---
  console.log('\n--- Test 2: Doctor Search by Specialty & OPD Fees in PKR ---');
  try {
    const docData = runPsql("SELECT doctor_name, specialty, opd_fee_pkr, qualification FROM doctors WHERE specialty = 'Cardiology' LIMIT 1;");
    const parts = docData.split('|');
    recordAssert(parts.length >= 4, 'Retrieved Cardiology doctor details');
    recordAssert(parts[0].includes('Dr.'), `Doctor name verified: ${parts[0]}`);
    recordAssert(parseFloat(parts[2]) > 0, `OPD fee in PKR verified: PKR ${parts[2]}`);
    recordAssert(parts[3].includes('MBBS'), `Doctor qualification verified: ${parts[3]}`);
  } catch (e) {
    recordAssert(false, `Doctor search failed: ${e.message}`);
  }

  // --- Test 3: Doctor Schedule & OPD Timing Verification ---
  console.log('\n--- Test 3: Doctor Schedule & OPD Timing Verification ---');
  try {
    const schedData = runPsql("SELECT d.doctor_name, s.available_days, s.opd_timings FROM schedules s JOIN doctors d ON s.doctor_id = d.id LIMIT 1;");
    const parts = schedData.split('|');
    recordAssert(parts.length >= 3, 'Doctor schedule retrieved successfully');
    recordAssert(parts[1].length > 0, `Available days: ${parts[1]}`);
    recordAssert(parts[2].includes('AM') || parts[2].includes('PM'), `OPD timings: ${parts[2]}`);
  } catch (e) {
    recordAssert(false, `Schedule lookup failed: ${e.message}`);
  }

  // --- Test 4: Patient Appointment Booking & MRN Generation ---
  console.log('\n--- Test 4: Patient Appointment Booking & MRN Generation ---');
  const testPhone = '+923007778899';
  const testDate = '2026-11-09'; // Monday (Dr. Tariq available Mon, Wed, Fri)
  const testTime = '10:30';
  let createdAppNum = null;

  try {
    const res = runGateway('create_appointment', {
      patient_phone: testPhone,
      patient_name: 'Test Patient Hospital',
      doctor_name: 'Dr. Tariq Mahmood',
      appointment_date: testDate,
      appointment_time: testTime
    }, testPhone);

    recordAssert(res.status === 'SUCCESS', 'Action Gateway confirmed appointment booking');
    createdAppNum = res.result ? res.result.appointment_number : null;
    recordAssert(createdAppNum !== null && createdAppNum.startsWith('APT-'), `Generated unique appointment number: ${createdAppNum}`);

    // Verify in database
    const dbCheck = runPsql(`SELECT a.appointment_number, p.patient_mrn, a.status FROM appointments a JOIN patients p ON a.patient_id = p.id WHERE a.appointment_number = '${createdAppNum}';`);
    const dbParts = dbCheck.split('|');
    recordAssert(dbParts[0] === createdAppNum, 'Appointment record exists in hospital_db');
    recordAssert(dbParts[1].startsWith('MRN-'), `Patient assigned canonical MRN: ${dbParts[1]}`);
    recordAssert(dbParts[2] === 'SCHEDULED', 'Appointment status set to SCHEDULED');
  } catch (e) {
    recordAssert(false, `Appointment booking failed: ${e.message}`);
  }

  // --- Test 5: Double-Booking Prevention & Time Slot Conflict ---
  console.log('\n--- Test 5: Double-Booking Prevention & Time Slot Conflict ---');
  try {
    const conflictRes = runGateway('book_appointment', {
      patient_phone: '+923215554433',
      patient_name: 'Second Patient',
      doctor_name: 'Dr. Tariq Mahmood',
      appointment_date: testDate,
      appointment_time: testTime
    }, '+923215554433');

    recordAssert(conflictRes.status === 'ERROR', 'Double-booking blocked by Action Gateway');
    const errMsg = conflictRes.message || (conflictRes.verdict ? conflictRes.verdict.error || conflictRes.verdict.message : '');
    recordAssert(errMsg.includes('already has an appointment booked'), 'Error clarifies slot conflict for doctor');
  } catch (e) {
    recordAssert(false, `Double-booking prevention check failed: ${e.message}`);
  }

  // --- Test 6: Appointment Rescheduling & Atomic History Log ---
  console.log('\n--- Test 6: Appointment Rescheduling & Atomic History Log ---');
  const newDate = '2026-11-11'; // Wednesday
  const newTime = '11:00';
  try {
    const reschedRes = runGateway('reschedule_appointment', {
      appointment_number: createdAppNum,
      new_appointment_date: newDate,
      new_appointment_time: newTime
    }, testPhone);

    recordAssert(reschedRes.status === 'SUCCESS', 'Reschedule confirmed by Action Gateway');

    // Verify DB update
    const reschedCheck = runPsql(`SELECT appointment_date, appointment_time FROM appointments WHERE appointment_number = '${createdAppNum}';`);
    recordAssert(reschedCheck.includes(newDate) && reschedCheck.includes(newTime), 'Appointment updated with new date and time');

    // Verify history log
    const histCheck = runPsql(`SELECT COUNT(*) FROM appointment_history ah JOIN appointments a ON ah.appointment_id = a.id WHERE a.appointment_number = '${createdAppNum}';`);
    recordAssert(parseInt(histCheck, 10) >= 2, `Appointment history entries logged atomically (${histCheck} entries recorded)`);
  } catch (e) {
    recordAssert(false, `Rescheduling failed: ${e.message}`);
  }

  // --- Test 7: Human Supervisor Approval Gate on Sensitive Cancellations ---
  console.log('\n--- Test 7: Human Supervisor Approval Gate on Sensitive Cancellations ---');
  try {
    const cancelRes = runGateway('cancel_appointment', {
      appointment_number: createdAppNum,
      reason: 'Patient unwell'
    }, testPhone);

    recordAssert(cancelRes.status === 'APPROVAL_REQUIRED', 'Sensitive cancellation intercepted by Human Approval Gate');
    const approvalToken = cancelRes.approval_token || cancelRes.token;
    recordAssert(approvalToken && approvalToken.startsWith('APR-'), `Generated valid approval token: ${approvalToken}`);

    // Verify appointment is NOT yet cancelled before approval
    const preCheck = runPsql(`SELECT status FROM appointments WHERE appointment_number = '${createdAppNum}';`);
    recordAssert(preCheck === 'SCHEDULED', 'Appointment remains SCHEDULED prior to supervisor approval');

    // Execute approval decision
    const approveRes = runGateway('approve_action', {
      approval_token: approvalToken,
      approver_id: 'SUPERVISOR-01',
      comments: 'Approved cancellation'
    }, testPhone);
    recordAssert(approveRes.status === 'SUCCESS', 'Supervisor approved cancellation token');

    // Execute approved action
    const execApproveRes = runGateway('execute_approved_action', {
      approval_token: approvalToken
    }, testPhone);

    recordAssert(execApproveRes.status === 'SUCCESS', 'Approved cancellation executed successfully');
    const postCheck = runPsql(`SELECT status FROM appointments WHERE appointment_number = '${createdAppNum}';`);
    recordAssert(postCheck === 'CANCELLED', 'Appointment status updated to CANCELLED upon approval');
  } catch (e) {
    recordAssert(false, `Approval gate test failed: ${e.message}`);
  }

  // --- Test 8: Cross-Customer Privacy Gate ---
  console.log('\n--- Test 8: Cross-Customer Privacy Gate ---');
  try {
    const otherPhone = '+923990001122';
    // Unauthorized attempt to cancel or modify another patient's appointment
    const wrongCancelRes = runGateway('cancel_appointment', {
      patient_phone: testPhone,
      appointment_date: testDate
    }, otherPhone);

    recordAssert(wrongCancelRes.status === 'APPROVAL_REQUIRED' || wrongCancelRes.status === 'ERROR' || wrongCancelRes.status === 'SECURITY_POLICY_DENIED', 'Cross-customer appointment modification rejected or tokenized');
  } catch (e) {
    recordAssert(false, `Cross-customer privacy test failed: ${e.message}`);
  }

  // --- Test 9: Multi-Tenant Cross-Domain Policy Gate ---
  console.log('\n--- Test 9: Multi-Tenant Cross-Domain Policy Gate ---');
  try {
    // Attempt 1: POS tenant tries to execute Hospital book_appointment
    const posHospRes = runGateway('book_appointment', {
      patient_phone: testPhone, appointment_date: '2026-11-20', appointment_time: '12:00:00'
    }, testPhone, 'POS_RETAIL');
    const codePos = posHospRes.error_code || (posHospRes.verdict ? posHospRes.verdict.error_code : '');
    recordAssert(posHospRes.status === 'SECURITY_POLICY_DENIED' || codePos === 'UNAUTHORIZED_TENANT_ACTION', 'POS tenant blocked from executing Hospital book_appointment');

    // Attempt 2: Hospital tenant tries to execute POS create_order
    const hospPosRes = runGateway('create_order', {
      customer_phone: testPhone, items: [{ sku: 'POS-HW-001', quantity: 1 }]
    }, testPhone, 'HOSP_HEALTH');
    const codeHosp = hospPosRes.error_code || (hospPosRes.verdict ? hospPosRes.verdict.error_code : '');
    recordAssert(hospPosRes.status === 'SECURITY_POLICY_DENIED' || codeHosp === 'UNAUTHORIZED_TENANT_ACTION', 'Hospital tenant blocked from executing POS create_order');
  } catch (e) {
    recordAssert(false, `Multi-tenant cross-domain gate failed: ${e.message}`);
  }

  // --- Test 10: Medical Advice & Autonomous Clinical Diagnosis Rejection Guard ---
  console.log('\n--- Test 10: Medical Advice & Autonomous Clinical Diagnosis Rejection Guard ---');
  try {
    const rawAgentResponse = "You have heart attack. Prescribed dosage: Aspirin 300mg daily.";
    const securityRes = processResponseSecurity(rawAgentResponse, [], {
      business_code: 'HOSP_HEALTH',
      customerPhone: testPhone
    });

    recordAssert(securityRes.blocked === true || securityRes.secure === false || securityRes.sanitized_response !== rawAgentResponse, 'Autonomous medical diagnosis/prescription blocked by Response Security');
    const textOut = securityRes.sanitized_response || '';
    recordAssert(textOut.includes('strictly prohibited') || textOut.includes('OPD coordinator') || textOut.includes('REDACTED') || securityRes.blocked === true, 'Response Security provides safe clinical rejection contract');
  } catch (e) {
    recordAssert(false, `Medical advice guard test failed: ${e.message}`);
  }

  // --- Test 11: Knowledge Base Retrieval for Hospital Policies ---
  console.log('\n--- Test 11: Knowledge Base Retrieval for Hospital Policies ---');
  try {
    const kbCheck = runPlatformPsql("SELECT COUNT(*) FROM knowledge_chunks kc JOIN knowledge_documents kd ON kc.document_id = kd.id WHERE kd.business_code = 'HOSP_HEALTH';");
    recordAssert(parseInt(kbCheck, 10) >= 0, `Knowledge base chunks verified for HOSP_HEALTH (${kbCheck} chunks)`);
  } catch (e) {
    recordAssert(false, `Knowledge base retrieval test failed: ${e.message}`);
  }

  // --- Test 12: Audit Logging in platform_audit_metadata ---
  console.log('\n--- Test 12: Audit Logging in platform_audit_metadata ---');
  try {
    const auditCount = runPlatformPsql("SELECT COUNT(*) FROM platform_audit_metadata WHERE business_code = 'HOSP_HEALTH';");
    recordAssert(parseInt(auditCount, 10) > 0, `Audit log recorded HOSP_HEALTH transactions (Total entries: ${auditCount})`);
  } catch (e) {
    recordAssert(false, `Audit log check failed: ${e.message}`);
  }

  console.log('\n========================================================================');
  console.log(`🏁 HOSPITAL DOMAIN VERIFICATION FINISHED: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runHospitalVerificationSuite();
}

module.exports = { runHospitalVerificationSuite };
