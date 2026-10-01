/**
 * Phase 28 Test Suite: Business-Specific Domain Actions & Transaction Integrity
 * 
 * Verifies:
 * 1. POS Actions: create_order (stock deduction), update_order, cancel_order (atomic restocking), insufficient stock error.
 * 2. BISE Actions: submit_verification_request, submit_service_application (fee lookup), track_service_application, invalid roll check.
 * 3. Hospital Actions: create_appointment, reschedule_appointment, cancel_appointment, double-booking prevention, audit history tracking.
 * 4. Multi-Tenant Policy Gate: Outside-LLM cross-tenant denials for unauthorized domain actions.
 * 5. Read vs. Write Guard: Rejection of pure read operations in Action Gateway.
 * 6. Database Least-Privilege Immutability: Verify gateway_action_writer cannot mutate bise_db.results.
 * 7. Audit Logging: Confirm audit trails in platform_audit_metadata.
 */

const { executeActionGateway, runPsql } = require('./action_gateway');

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passCount++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failCount++;
  }
}

async function runTestSuite() {
  console.log('========================================================================');
  console.log('   PHASE 28 TEST SUITE: BUSINESS-SPECIFIC DOMAIN ACTIONS & TRANSACTIONS');
  console.log('========================================================================\n');

  // =========================================================================
  // 1. POS DOMAIN ACTIONS & INVENTORY TRANSACTIONS
  // =========================================================================
  console.log('--- 1. POS Domain Actions (pos_db) ---');

  // 1.1 Check initial stock for POS-HW-002
  const initialStockRaw = runPsql(
    "SELECT stock_quantity FROM inventory WHERE product_id = (SELECT id FROM products WHERE sku = 'POS-HW-002');",
    'gateway_action_writer',
    'pos_db'
  );
  const initialStock = parseInt(initialStockRaw.trim(), 10);
  console.log(`  [INFO] Initial stock for POS-HW-002: ${initialStock} units`);

  // 1.2 Create Order with Stock Deduction
  const testOrdNum = `ORD-TEST-${Date.now()}`;
  const createRes = executeActionGateway({
    action: 'create_order',
    params: {
      order_number: testOrdNum,
      customer_phone: '+923001234567',
      customer_name: 'Phase 28 Tester',
      items: [{ sku: 'POS-HW-002', quantity: 2 }]
    },
    trustedSessionContext: {
      business_code: 'POS_RETAIL',
      instance_name: 'pos-instance',
      customerPhone: '+923001234567',
      allowed_tools: ['action_gateway']
    }
  });

  assert(createRes.status === 'SUCCESS', 'POS create_order executed successfully');
  assert(createRes.result.order_number === testOrdNum, `Order created with number ${testOrdNum}`);

  // Verify stock decreased by 2
  const postCreateStockRaw = runPsql(
    "SELECT stock_quantity FROM inventory WHERE product_id = (SELECT id FROM products WHERE sku = 'POS-HW-002');",
    'gateway_action_writer',
    'pos_db'
  );
  const postCreateStock = parseInt(postCreateStockRaw.trim(), 10);
  assert(postCreateStock === initialStock - 2, `Inventory deducted atomically (${initialStock} -> ${postCreateStock})`);

  // 1.3 Insufficient Stock Error
  const failStockRes = executeActionGateway({
    action: 'create_order',
    params: {
      customer_phone: '+923001234567',
      items: [{ sku: 'POS-HW-002', quantity: 99999 }]
    },
    trustedSessionContext: {
      business_code: 'POS_RETAIL',
      instance_name: 'pos-instance',
      customerPhone: '+923001234567',
      allowed_tools: ['action_gateway']
    }
  });
  assert(failStockRes.status === 'ERROR', 'create_order rejected when requested quantity exceeds available stock');
  assert(failStockRes.verdict.error.includes('Insufficient inventory'), 'Error message accurately indicates insufficient inventory');

  // 1.4 Update Order Status
  const updateRes = executeActionGateway({
    action: 'update_order',
    params: {
      order_number: testOrdNum,
      status: 'CONFIRMED'
    },
    trustedSessionContext: {
      business_code: 'POS_RETAIL',
      instance_name: 'pos-instance',
      customerPhone: '+923001234567',
      allowed_tools: ['action_gateway']
    }
  });
  assert(updateRes.status === 'SUCCESS', 'POS update_order executed successfully');
  assert(updateRes.result.new_status === 'CONFIRMED', 'Order status updated to CONFIRMED');

  // 1.5 Cancel Order with Atomic Restocking (Phase 29 Approval Compliant)
  const reqCancel = executeActionGateway({
    action: 'cancel_order',
    params: {
      order_number: testOrdNum,
      reason: 'Customer test cancellation'
    },
    trustedSessionContext: {
      business_code: 'POS_RETAIL',
      instance_name: 'pos-instance',
      customerPhone: '+923001234567',
      allowed_tools: ['action_gateway']
    }
  });
  const cancelToken = reqCancel.approval_token || reqCancel.token;
  executeActionGateway({
    action: 'approve_action',
    params: { approval_token: cancelToken, approver_id: 'sup_test', approver_name: 'POS Supervisor' },
    trustedSessionContext: { business_code: 'POS_RETAIL', instance_name: 'pos-instance', customerPhone: '+923001234567', allowed_tools: ['action_gateway'] }
  });
  const cancelRes = executeActionGateway({
    action: 'cancel_order',
    params: {
      order_number: testOrdNum,
      reason: 'Customer test cancellation',
      approval_token: cancelToken
    },
    trustedSessionContext: {
      business_code: 'POS_RETAIL',
      instance_name: 'pos-instance',
      customerPhone: '+923001234567',
      allowed_tools: ['action_gateway']
    }
  });
  assert(cancelRes.status === 'SUCCESS', 'POS cancel_order executed successfully with approval');
  assert(cancelRes.result.restocked_units === 2, 'cancel_order reported 2 units restocked');

  // Verify stock restored back to initialStock
  const postCancelStockRaw = runPsql(
    "SELECT stock_quantity FROM inventory WHERE product_id = (SELECT id FROM products WHERE sku = 'POS-HW-002');",
    'gateway_action_writer',
    'pos_db'
  );
  const postCancelStock = parseInt(postCancelStockRaw.trim(), 10);
  assert(postCancelStock === initialStock, `Inventory restored atomically (${postCreateStock} -> ${postCancelStock})`);

  // 1.6 Verify cancelling an already cancelled order is rejected
  const reqCancelAgain = executeActionGateway({
    action: 'cancel_order',
    params: { order_number: testOrdNum },
    trustedSessionContext: { business_code: 'POS_RETAIL', instance_name: 'pos-instance', customerPhone: '+923001234567', allowed_tools: ['action_gateway'] }
  });
  const cancelAgainToken = reqCancelAgain.approval_token || reqCancelAgain.token;
  executeActionGateway({
    action: 'approve_action',
    params: { approval_token: cancelAgainToken, approver_id: 'sup_test' },
    trustedSessionContext: { business_code: 'POS_RETAIL', instance_name: 'pos-instance', customerPhone: '+923001234567', allowed_tools: ['action_gateway'] }
  });
  const cancelAgainRes = executeActionGateway({
    action: 'cancel_order',
    params: { order_number: testOrdNum, approval_token: cancelAgainToken },
    trustedSessionContext: {
      business_code: 'POS_RETAIL',
      instance_name: 'pos-instance',
      customerPhone: '+923001234567',
      allowed_tools: ['action_gateway']
    }
  });
  assert(cancelAgainRes.status === 'ERROR', 'Cancelling an already CANCELLED order is rejected');

  // =========================================================================
  // 2. BISE EDUCATIONAL DOMAIN ACTIONS
  // =========================================================================
  console.log('\n--- 2. BISE Educational Domain Actions (bise_db) ---');

  // 2.1 Submit Verification Request (Valid Roll Number 102450)
  const verRes = executeActionGateway({
    action: 'submit_verification_request',
    params: {
      roll_number: '102450',
      applicant_name: 'Tahir Aziz',
      organization: 'Higher Education Commission'
    },
    trustedSessionContext: {
      business_code: 'BISE_EDU',
      instance_name: 'bise-instance',
      customerPhone: '+923001234567',
      allowed_tools: ['action_gateway']
    }
  });
  assert(verRes.status === 'SUCCESS', 'BISE submit_verification_request executed successfully');
  assert(verRes.result.roll_number === '102450', 'Roll number verified against examination records');
  assert(verRes.result.verification_status === 'PENDING', 'Verification request registered in PENDING status');
  const verRef = verRes.result.request_ref;

  // 2.2 Submit Verification Request for Invalid Roll Number (should fail)
  const failVerRes = executeActionGateway({
    action: 'submit_verification_request',
    params: {
      roll_number: '999999',
      applicant_name: 'Unknown Person'
    },
    trustedSessionContext: {
      business_code: 'BISE_EDU',
      instance_name: 'bise-instance',
      customerPhone: '+923001234567',
      allowed_tools: ['action_gateway']
    }
  });
  assert(failVerRes.status === 'ERROR', 'submit_verification_request rejects unverified roll number');

  // 2.3 Submit Service Application (NOC_MIGRATION with fee lookup)
  const appRes = executeActionGateway({
    action: 'submit_service_application',
    params: {
      roll_number: '102450',
      application_type: 'NOC_MIGRATION'
    },
    trustedSessionContext: {
      business_code: 'BISE_EDU',
      instance_name: 'bise-instance',
      customerPhone: '+923001234567',
      allowed_tools: ['action_gateway']
    }
  });
  assert(appRes.status === 'SUCCESS', 'BISE submit_service_application executed successfully');
  assert(appRes.result.fee_amount_pkr === 1800, 'Fee lookup dynamically resolved PKR 1,800.00 for NOC_MIGRATION');
  assert(appRes.result.status_code === 'PROCESSING', 'Application registered in PROCESSING status');
  const appNumber = appRes.result.application_number;

  // 2.4 Track Service Application
  const trackAppRes = executeActionGateway({
    action: 'track_service_application',
    params: { application_number: appNumber },
    trustedSessionContext: {
      business_code: 'BISE_EDU',
      instance_name: 'bise-instance',
      customerPhone: '+923001234567',
      allowed_tools: ['action_gateway']
    }
  });
  assert(trackAppRes.status === 'SUCCESS', 'BISE track_service_application resolved application');
  assert(trackAppRes.result.application_status === 'PROCESSING', 'Tracked status is PROCESSING');

  // 2.5 Track Verification Request
  const trackVerRes = executeActionGateway({
    action: 'track_service_application',
    params: { request_ref: verRef },
    trustedSessionContext: {
      business_code: 'BISE_EDU',
      instance_name: 'bise-instance',
      customerPhone: '+923001234567',
      allowed_tools: ['action_gateway']
    }
  });
  assert(trackVerRes.status === 'SUCCESS', 'BISE track_service_application resolved verification request');
  assert(trackVerRes.result.verification_status === 'PENDING', 'Tracked verification status is PENDING');

  // =========================================================================
  // 3. HOSPITAL HEALTHCARE DOMAIN ACTIONS
  // =========================================================================
  console.log('\n--- 3. Hospital Clinical Domain Actions (hospital_db) ---');

  // 3.1 Book Clinical Appointment
  const bookRes = executeActionGateway({
    action: 'create_appointment',
    params: {
      patient_phone: '+923331122334',
      patient_name: 'Naveed Akhtar',
      doctor_name: 'Dr. Tariq Mahmood',
      appointment_date: '2026-10-16',
      appointment_time: '10:00'
    },
    trustedSessionContext: {
      business_code: 'HOSP_HEALTH',
      instance_name: 'hospital-instance',
      customerPhone: '+923331122334',
      allowed_tools: ['action_gateway']
    }
  });
  assert(bookRes.status === 'SUCCESS', 'Hospital create_appointment executed successfully');
  assert(bookRes.result.doctor_name.includes('Dr. Tariq Mahmood'), 'Doctor resolved correctly');
  const apptNum = bookRes.result.appointment_number;

  // 3.2 Double Booking Prevention Check
  const doubleBookRes = executeActionGateway({
    action: 'book_appointment',
    params: {
      patient_phone: '+923459988776',
      patient_name: 'Another Patient',
      doctor_name: 'Dr. Tariq Mahmood',
      appointment_date: '2026-10-16',
      appointment_time: '10:00'
    },
    trustedSessionContext: {
      business_code: 'HOSP_HEALTH',
      instance_name: 'hospital-instance',
      customerPhone: '+923459988776',
      allowed_tools: ['action_gateway']
    }
  });
  assert(doubleBookRes.status === 'ERROR', 'Double-booking prevention blocked overlapping slot');
  assert(doubleBookRes.verdict.error.includes('already has an appointment booked'), 'Error clarifies slot conflict');

  // 3.3 Reschedule Clinical Appointment
  const reschedRes = executeActionGateway({
    action: 'reschedule_appointment',
    params: {
      appointment_number: apptNum,
      new_appointment_date: '2026-10-16',
      new_appointment_time: '11:30',
      reason: 'Doctor surgery timing adjustment'
    },
    trustedSessionContext: {
      business_code: 'HOSP_HEALTH',
      instance_name: 'hospital-instance',
      customerPhone: '+923331122334',
      allowed_tools: ['action_gateway']
    }
  });
  assert(reschedRes.status === 'SUCCESS', 'Hospital reschedule_appointment executed successfully');
  assert(reschedRes.result.new_schedule.includes('11:30'), 'New schedule confirmed');

  // Verify appointment_history has entry for reschedule
  const historyRaw = runPsql(
    `SELECT COUNT(*) FROM appointment_history WHERE appointment_id = (SELECT id FROM appointments WHERE appointment_number = '${apptNum}');`,
    'gateway_action_writer',
    'hospital_db'
  );
  const histCount = parseInt(historyRaw.trim(), 10);
  assert(histCount >= 2, `Appointment history tracked atomically (${histCount} entries logged)`);

  // 3.4 Cancel Clinical Appointment (Phase 29 Approval Compliant)
  const reqCancelAppt = executeActionGateway({
    action: 'cancel_appointment',
    params: {
      appointment_number: apptNum,
      reason: 'Patient resolved condition'
    },
    trustedSessionContext: {
      business_code: 'HOSP_HEALTH',
      instance_name: 'hospital-instance',
      customerPhone: '+923331122334',
      allowed_tools: ['action_gateway']
    }
  });
  const cancelApptToken = reqCancelAppt.approval_token || reqCancelAppt.token;
  executeActionGateway({
    action: 'approve_action',
    params: { approval_token: cancelApptToken, approver_id: 'dr_approver', approver_name: 'OPD Incharge' },
    trustedSessionContext: { business_code: 'HOSP_HEALTH', instance_name: 'hospital-instance', customerPhone: '+923331122334', allowed_tools: ['action_gateway'] }
  });
  const cancelApptRes = executeActionGateway({
    action: 'cancel_appointment',
    params: {
      appointment_number: apptNum,
      reason: 'Patient resolved condition',
      approval_token: cancelApptToken
    },
    trustedSessionContext: {
      business_code: 'HOSP_HEALTH',
      instance_name: 'hospital-instance',
      customerPhone: '+923331122334',
      allowed_tools: ['action_gateway']
    }
  });
  assert(cancelApptRes.status === 'SUCCESS', 'Hospital cancel_appointment executed successfully with approval');

  // 3.5 Attempting to reschedule a CANCELLED appointment should be rejected
  const reschedCancelledRes = executeActionGateway({
    action: 'reschedule_appointment',
    params: {
      appointment_number: apptNum,
      new_appointment_date: '2026-10-16',
      new_appointment_time: '10:00'
    },
    trustedSessionContext: {
      business_code: 'HOSP_HEALTH',
      instance_name: 'hospital-instance',
      customerPhone: '+923331122334',
      allowed_tools: ['action_gateway']
    }
  });
  assert(reschedCancelledRes.status === 'ERROR', 'Rescheduling a CANCELLED appointment is blocked');

  // =========================================================================
  // 4. MULTI-TENANT CROSS-DOMAIN POLICY ENFORCEMENT
  // =========================================================================
  console.log('\n--- 4. Multi-Tenant Cross-Domain Policy Gate ---');

  // 4.1 POS attempting BISE action
  const posCallingBise = executeActionGateway({
    action: 'submit_verification_request',
    params: { roll_number: '102450', applicant_name: 'Attacker' },
    trustedSessionContext: { business_code: 'POS_RETAIL', instance_name: 'pos-instance', allowed_tools: ['action_gateway'] }
  });
  assert(posCallingBise.status === 'DENIED', 'POS cannot execute BISE submit_verification_request');
  assert(posCallingBise.verdict.error_code === 'UNAUTHORIZED_TENANT_ACTION', 'Blocked with UNAUTHORIZED_TENANT_ACTION');

  // 4.2 POS attempting Hospital action
  const posCallingHosp = executeActionGateway({
    action: 'reschedule_appointment',
    params: { appointment_number: 'APT-2026-101', new_appointment_date: '2026-10-20', new_appointment_time: '10:00' },
    trustedSessionContext: { business_code: 'POS_RETAIL', instance_name: 'pos-instance', allowed_tools: ['action_gateway'] }
  });
  assert(posCallingHosp.status === 'DENIED', 'POS cannot execute Hospital reschedule_appointment');

  // 4.3 BISE attempting POS action
  const biseCallingPos = executeActionGateway({
    action: 'create_order',
    params: { customer_phone: '+923001234567', items: [{ sku: 'POS-HW-001', quantity: 1 }] },
    trustedSessionContext: { business_code: 'BISE_EDU', instance_name: 'bise-instance', allowed_tools: ['action_gateway'] }
  });
  assert(biseCallingPos.status === 'DENIED', 'BISE cannot execute POS create_order');

  // 4.4 Hospital attempting POS action
  const hospCallingPos = executeActionGateway({
    action: 'cancel_order',
    params: { order_number: 'ORD-2026-001' },
    trustedSessionContext: { business_code: 'HOSP_HEALTH', instance_name: 'hospital-instance', allowed_tools: ['action_gateway'] }
  });
  assert(hospCallingPos.status === 'DENIED', 'Hospital cannot execute POS cancel_order');

  // =========================================================================
  // 5. READ VS WRITE GUARD ENFORCEMENT
  // =========================================================================
  console.log('\n--- 5. Read vs. Write Guard ---');

  const readReject1 = executeActionGateway({
    action: 'get_student_result',
    params: { roll_number: '102450' },
    trustedSessionContext: { business_code: 'BISE_EDU', instance_name: 'bise-instance', allowed_tools: ['action_gateway'] }
  });
  assert(readReject1.status === 'REJECTED', 'Read operation get_student_result rejected by Action Gateway');
  assert(readReject1.verdict.error_code === 'READ_OPERATION_NOT_PERMITTED_IN_ACTION_GATEWAY', 'Correct read rejection error code');

  const readReject2 = executeActionGateway({
    action: 'check_inventory',
    params: { sku: 'POS-HW-001' },
    trustedSessionContext: { business_code: 'POS_RETAIL', instance_name: 'pos-instance', allowed_tools: ['action_gateway'] }
  });
  assert(readReject2.status === 'REJECTED', 'Read operation check_inventory rejected by Action Gateway');

  // =========================================================================
  // 6. DATABASE LEAST-PRIVILEGE ROLE IMMUTABILITY
  // =========================================================================
  console.log('\n--- 6. Database Least-Privilege Immutability (gateway_action_writer) ---');

  let tamperFailed = false;
  try {
    runPsql("UPDATE results SET marks_obtained = 1100 WHERE roll_number = '102450';", 'gateway_action_writer', 'bise_db');
  } catch (e) {
    tamperFailed = true;
    assert(e.message.includes('permission denied'), 'gateway_action_writer is strictly DENIED write access on bise_db.results');
  }
  if (!tamperFailed) {
    assert(false, 'SECURITY BREACH: gateway_action_writer was able to mutate bise_db.results!');
  }

  // =========================================================================
  // 7. AUDIT LOGGING VERIFICATION
  // =========================================================================
  console.log('\n--- 7. Audit Logging in platform_audit_metadata ---');

  const recentAuditRaw = runPsql(
    "SELECT COUNT(*) FROM platform_audit_metadata WHERE (inbound_payload->>'gateway') = 'action_gateway';",
    'gateway_action_writer',
    'platform_db'
  );
  const auditEntriesCount = parseInt(recentAuditRaw.trim(), 10);
  assert(auditEntriesCount > 0, `Action Gateway logged events to platform_audit_metadata (${auditEntriesCount} total entries recorded)`);

  // Summary
  console.log('\n========================================================================');
  console.log(`PHASE 28 TEST SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('========================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Fatal Test Suite Error:', err);
  process.exit(1);
});
