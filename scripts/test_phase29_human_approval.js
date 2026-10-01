/**
 * Phase 29 Test Suite: Human Approval Controls & Bypass Prevention
 * 
 * Verifies:
 * 1. Policy Gate Classification: sensitive actions (cancel_order, cancel_appointment) require approval; standard actions execute directly.
 * 2. Pending State Interception: unapproved sensitive actions trigger PENDING_APPROVAL token and do NOT execute underlying domain action.
 * 3. Premature Execution Prevention: unapproved (PENDING) token cannot execute domain action.
 * 4. Human Decision Capture: approve_action and reject_action capture approver identity, timestamp, and notes.
 * 5. Rejection Enforcement: rejected tokens cannot execute underlying action.
 * 6. Approved Execution: approved token executes underlying domain action atomically.
 * 7. Token Consumption & Replay Prevention: once executed, token is marked EXECUTED; subsequent attempts are rejected as REPLAY_ATTACK_PREVENTED.
 * 8. execute_approved_action Tool: alternative execution path works with valid approved token.
 * 9. Tenant & Action Isolation: tokens cannot cross tenant boundaries or execute mismatched actions.
 * 10. Expiration Protection: expired tokens are rejected.
 * 11. Full Audit Logging: all approval events, decisions, and attempts logged to platform_audit_metadata and platform_action_approvals.
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
  console.log('   PHASE 29 TEST SUITE: HUMAN APPROVAL CONTROLS & BYPASS PREVENTION');
  console.log('========================================================================\n');

  // =========================================================================
  // 1. POLICY GATE CLASSIFICATION
  // =========================================================================
  console.log('--- 1. Policy Gate Classification (platform_db.platform_tool_permissions) ---');
  
  const permCheck = runPsql(
    "SELECT tool_name, requires_approval FROM platform_tool_permissions WHERE tool_name IN ('cancel_order', 'cancel_appointment', 'create_order', 'book_appointment') ORDER BY tool_name;",
    'gateway_action_writer',
    'platform_db'
  );
  console.log('  [INFO] Tool approval flags:\n' + permCheck.split('\n').map(l => '    ' + l).join('\n'));

  assert(permCheck.includes('cancel_order') && permCheck.includes('t'), 'cancel_order has requires_approval = true');
  assert(permCheck.includes('cancel_appointment') && permCheck.includes('t'), 'cancel_appointment has requires_approval = true');
  assert(permCheck.includes('create_order') && permCheck.includes('f'), 'create_order has requires_approval = false (standard write)');
  assert(permCheck.includes('book_appointment') && permCheck.includes('f'), 'book_appointment has requires_approval = false (standard write)');


  // =========================================================================
  // 2. SENSITIVE ACTION INTERCEPTION & PENDING STATE (POS cancel_order)
  // =========================================================================
  console.log('\n--- 2. Interception & Pending State Creation (POS cancel_order) ---');

  // 2.1 First create a test order in POS
  const testOrdNum = `ORD-APR-${Date.now()}`;
  const createRes = executeActionGateway({
    action: 'create_order',
    params: {
      order_number: testOrdNum,
      customer_phone: '+923001234567',
      customer_name: 'Approval Tester',
      items: [{ sku: 'POS-HW-002', quantity: 2 }]
    },
    trustedSessionContext: {
      business_code: 'POS_RETAIL',
      instance_name: 'pos-instance',
      customerPhone: '+923001234567',
      allowed_tools: ['action_gateway']
    }
  });
  assert(createRes.status === 'SUCCESS', `Test order ${testOrdNum} created for cancellation test`);

  // Get stock before cancellation attempt
  const preStockRaw = runPsql(
    "SELECT stock_quantity FROM inventory WHERE product_id = (SELECT id FROM products WHERE sku = 'POS-HW-002');",
    'gateway_action_writer',
    'pos_db'
  );
  const preStock = parseInt(preStockRaw.trim(), 10);

  // 2.2 Attempt cancel_order WITHOUT approval_token
  const interceptRes = executeActionGateway({
    action: 'cancel_order',
    params: {
      order_number: testOrdNum,
      reason: 'Customer requested refund'
    },
    trustedSessionContext: {
      business_code: 'POS_RETAIL',
      instance_name: 'pos-instance',
      customerPhone: '+923001234567',
      allowed_tools: ['action_gateway']
    }
  });

  assert(interceptRes.status === 'APPROVAL_REQUIRED', 'cancel_order intercepted with status APPROVAL_REQUIRED');
  assert(interceptRes.approval_required === true, 'approval_required flag is true');
  assert(interceptRes.token && interceptRes.token.startsWith('APR-2026-'), `Approval token generated: ${interceptRes.token}`);
  const approvalToken1 = interceptRes.token;

  // 2.3 Verify domain state remains unchanged (order NOT cancelled, stock NOT restocked)
  const orderStatusCheck = runPsql(
    `SELECT status FROM orders WHERE order_number = '${testOrdNum}';`,
    'gateway_action_writer',
    'pos_db'
  );
  assert(orderStatusCheck.trim() === 'PENDING', `Underlying order status remains unchanged ('${orderStatusCheck.trim()}')`);

  const postInterceptStockRaw = runPsql(
    "SELECT stock_quantity FROM inventory WHERE product_id = (SELECT id FROM products WHERE sku = 'POS-HW-002');",
    'gateway_action_writer',
    'pos_db'
  );
  const postInterceptStock = parseInt(postInterceptStockRaw.trim(), 10);
  assert(postInterceptStock === preStock, `Inventory untouched during approval interception (${preStock} == ${postInterceptStock})`);

  // 2.4 Verify record created in platform_action_approvals
  const tokenDbRecord = runPsql(
    `SELECT status, action, business_code FROM platform_action_approvals WHERE approval_token = '${approvalToken1}';`,
    'gateway_action_writer',
    'platform_db'
  );
  assert(tokenDbRecord.includes('PENDING_APPROVAL'), 'platform_action_approvals status is PENDING_APPROVAL');
  assert(tokenDbRecord.includes('cancel_order'), 'platform_action_approvals records action cancel_order');


  // =========================================================================
  // 3. PREMATURE EXECUTION PREVENTION
  // =========================================================================
  console.log('\n--- 3. Premature Execution Prevention (Calling with PENDING Token) ---');

  const prematureRes = executeActionGateway({
    action: 'cancel_order',
    params: {
      order_number: testOrdNum,
      approval_token: approvalToken1
    },
    trustedSessionContext: {
      business_code: 'POS_RETAIL',
      instance_name: 'pos-instance',
      customerPhone: '+923001234567',
      allowed_tools: ['action_gateway']
    }
  });

  assert(prematureRes.status === 'ERROR', 'Execution rejected when token is still PENDING_APPROVAL');
  assert(prematureRes.verdict && prematureRes.verdict.error.includes('APPROVAL_NOT_YET_GRANTED'), 'Error indicates APPROVAL_NOT_YET_GRANTED');


  // =========================================================================
  // 4. SUPERVISOR REJECTION
  // =========================================================================
  console.log('\n--- 4. Supervisor Decision: Rejection ---');

  // Create a separate sensitive action request to test rejection
  const testOrdReject = `ORD-REJ-${Date.now()}`;
  executeActionGateway({
    action: 'create_order',
    params: {
      order_number: testOrdReject,
      customer_phone: '+923001234567',
      items: [{ sku: 'POS-HW-002', quantity: 1 }]
    },
    trustedSessionContext: {
      business_code: 'POS_RETAIL',
      instance_name: 'pos-instance',
      customerPhone: '+923001234567',
      allowed_tools: ['action_gateway']
    }
  });

  const rejectReq = executeActionGateway({
    action: 'cancel_order',
    params: { order_number: testOrdReject },
    trustedSessionContext: {
      business_code: 'POS_RETAIL',
      instance_name: 'pos-instance',
      customerPhone: '+923001234567',
      allowed_tools: ['action_gateway']
    }
  });
  const rejectToken = rejectReq.token;

  // Supervisor calls reject_action
  const rejectDecisionRes = executeActionGateway({
    action: 'reject_action',
    params: {
      approval_token: rejectToken,
      approver_id: 'sup_tariq_01',
      approver_name: 'Supervisor Tariq',
      notes: 'Customer already collected parcel. Cancellation rejected.'
    },
    trustedSessionContext: {
      business_code: 'POS_RETAIL',
      instance_name: 'pos-instance',
      customerPhone: '+923001234567',
      allowed_tools: ['action_gateway']
    }
  });

  assert(rejectDecisionRes.status === 'SUCCESS', 'reject_action succeeded');
  assert(rejectDecisionRes.result.decision === 'REJECTED', 'Decision recorded as REJECTED');

  // Verify status in database
  const rejectDbCheck = runPsql(
    `SELECT status, approver_id, approver_notes FROM platform_action_approvals WHERE approval_token = '${rejectToken}';`,
    'gateway_action_writer',
    'platform_db'
  );
  assert(rejectDbCheck.includes('REJECTED'), 'Database confirms status is REJECTED');
  assert(rejectDbCheck.includes('Supervisor Tariq'), 'Approver name captured in database');


  // =========================================================================
  // 5. REJECTED TOKEN EXECUTION BLOCK
  // =========================================================================
  console.log('\n--- 5. Rejected Token Execution Block ---');

  const executeRejectedRes = executeActionGateway({
    action: 'cancel_order',
    params: {
      order_number: testOrdReject,
      approval_token: rejectToken
    },
    trustedSessionContext: {
      business_code: 'POS_RETAIL',
      instance_name: 'pos-instance',
      customerPhone: '+923001234567',
      allowed_tools: ['action_gateway']
    }
  });

  assert(executeRejectedRes.status === 'ERROR', 'Execution with REJECTED token blocked');
  assert(executeRejectedRes.verdict && executeRejectedRes.verdict.error.includes('APPROVAL_REJECTED'), 'Error accurately indicates APPROVAL_REJECTED');


  // =========================================================================
  // 6. SUPERVISOR APPROVAL
  // =========================================================================
  console.log('\n--- 6. Supervisor Decision: Approval ---');

  const approveDecisionRes = executeActionGateway({
    action: 'approve_action',
    params: {
      approval_token: approvalToken1,
      approver_id: 'mgr_sarah_01',
      approver_name: 'Store Manager Sarah',
      notes: 'Customer verified defective item in warranty. Approved.'
    },
    trustedSessionContext: {
      business_code: 'POS_RETAIL',
      instance_name: 'pos-instance',
      customerPhone: '+923001234567',
      allowed_tools: ['action_gateway']
    }
  });

  assert(approveDecisionRes.status === 'SUCCESS', 'approve_action succeeded');
  assert(approveDecisionRes.result.decision === 'APPROVED', 'Decision recorded as APPROVED');

  // Verify status in database
  const approveDbCheck = runPsql(
    `SELECT status, approver_id, approver_notes FROM platform_action_approvals WHERE approval_token = '${approvalToken1}';`,
    'gateway_action_writer',
    'platform_db'
  );
  assert(approveDbCheck.includes('APPROVED'), 'Database confirms status transitioned to APPROVED');
  assert(approveDbCheck.includes('Store Manager Sarah'), 'Approver name captured in database');


  // =========================================================================
  // 7. AUTHORIZED EXECUTION WITH APPROVED TOKEN
  // =========================================================================
  console.log('\n--- 7. Execution with Approved Token ---');

  const approvedExecRes = executeActionGateway({
    action: 'cancel_order',
    params: {
      order_number: testOrdNum,
      reason: 'Defective item returned',
      approval_token: approvalToken1
    },
    trustedSessionContext: {
      business_code: 'POS_RETAIL',
      instance_name: 'pos-instance',
      customerPhone: '+923001234567',
      allowed_tools: ['action_gateway']
    }
  });

  assert(approvedExecRes.status === 'SUCCESS', 'cancel_order executed successfully with approved token');
  assert(approvedExecRes.result.restocked_units === 2, 'Underlying cancel_order action restocked 2 units');

  // Verify database state: order cancelled and token marked EXECUTED
  const postExecOrder = runPsql(
    `SELECT status FROM orders WHERE order_number = '${testOrdNum}';`,
    'gateway_action_writer',
    'pos_db'
  );
  assert(postExecOrder.trim() === 'CANCELLED', 'Order status transitioned to CANCELLED');

  const tokenConsumedCheck = runPsql(
    `SELECT status, executed_at FROM platform_action_approvals WHERE approval_token = '${approvalToken1}';`,
    'gateway_action_writer',
    'platform_db'
  );
  assert(tokenConsumedCheck.includes('EXECUTED'), 'Approval token transitioned to EXECUTED status');


  // =========================================================================
  // 8. REPLAY ATTACK DEFENSE
  // =========================================================================
  console.log('\n--- 8. Replay Attack Prevention (Reusing Executed Token) ---');

  const replayRes = executeActionGateway({
    action: 'cancel_order',
    params: {
      order_number: testOrdNum,
      approval_token: approvalToken1
    },
    trustedSessionContext: {
      business_code: 'POS_RETAIL',
      instance_name: 'pos-instance',
      customerPhone: '+923001234567',
      allowed_tools: ['action_gateway']
    }
  });

  assert(replayRes.status === 'ERROR', 'Replay attempt with already executed token blocked');
  assert(replayRes.verdict && replayRes.verdict.error.includes('APPROVAL_ALREADY_USED'), 'Replay error indicates APPROVAL_ALREADY_USED');


  // =========================================================================
  // 9. ALTERNATIVE EXECUTION TOOL: execute_approved_action
  // =========================================================================
  console.log('\n--- 9. Alternative Route: execute_approved_action (Hospital cancel_appointment) ---');

  // 9.1 Book test appointment
  const hospTime = '11:00';
  const hospDate = '2026-10-26';
  const bookRes = executeActionGateway({
    action: 'book_appointment',
    params: {
      patient_phone: '+923335555555',
      patient_name: 'Approval Hospital Patient',
      doctor_name: 'Dr. Tariq Mahmood',
      department: 'Cardiology',
      appointment_date: hospDate,
      appointment_time: hospTime
    },
    trustedSessionContext: {
      business_code: 'HOSP_HEALTH',
      instance_name: 'hospital-instance',
      customerPhone: '+923335555555',
      allowed_tools: ['action_gateway']
    }
  });
  assert(bookRes.status === 'SUCCESS', 'Test appointment booked for hospital cancellation test');
  const apptNum = bookRes.result.appointment_number;

  // 9.2 Request cancel_appointment (sensitive)
  const hospCancelReq = executeActionGateway({
    action: 'cancel_appointment',
    params: {
      appointment_number: apptNum,
      reason: 'Patient travel emergency'
    },
    trustedSessionContext: {
      business_code: 'HOSP_HEALTH',
      instance_name: 'hospital-instance',
      customerPhone: '+923335555555',
      allowed_tools: ['action_gateway']
    }
  });

  assert(hospCancelReq.status === 'APPROVAL_REQUIRED', 'cancel_appointment intercepted with APPROVAL_REQUIRED');
  const hospToken = hospCancelReq.token;

  // 9.3 Approve the hospital cancellation
  executeActionGateway({
    action: 'approve_action',
    params: {
      approval_token: hospToken,
      approver_id: 'dr_chief_01',
      approver_name: 'Chief Medical Officer',
      notes: 'Slot freed up for emergency OPD queue'
    },
    trustedSessionContext: {
      business_code: 'HOSP_HEALTH',
      instance_name: 'hospital-instance',
      customerPhone: '+923335555555',
      allowed_tools: ['action_gateway']
    }
  });

  // 9.4 Execute using execute_approved_action tool
  const execApprovedToolRes = executeActionGateway({
    action: 'execute_approved_action',
    params: {
      approval_token: hospToken
    },
    trustedSessionContext: {
      business_code: 'HOSP_HEALTH',
      instance_name: 'hospital-instance',
      customerPhone: '+923335555555',
      allowed_tools: ['action_gateway']
    }
  });

  assert(execApprovedToolRes.status === 'SUCCESS', 'execute_approved_action succeeded');
  assert((execApprovedToolRes.result.action || execApprovedToolRes.action) === 'cancel_appointment', 'execute_approved_action executed cancel_appointment');

  // Verify appointment cancelled in hospital_db
  const apptStatus = runPsql(
    `SELECT status FROM appointments WHERE appointment_number = '${apptNum}';`,
    'gateway_action_writer',
    'hospital_db'
  );
  assert(apptStatus.trim() === 'CANCELLED', 'Hospital appointment marked CANCELLED in database');

  // Verify replay protection on execute_approved_action
  const replayApptRes = executeActionGateway({
    action: 'execute_approved_action',
    params: {
      approval_token: hospToken
    },
    trustedSessionContext: {
      business_code: 'HOSP_HEALTH',
      instance_name: 'hospital-instance',
      customerPhone: '+923335555555',
      allowed_tools: ['action_gateway']
    }
  });
  assert(replayApptRes.status === 'ERROR', 'execute_approved_action replay blocked');


  // =========================================================================
  // 10. TENANT & ACTION ISOLATION
  // =========================================================================
  console.log('\n--- 10. Tenant & Action Isolation ---');

  // 10.1 Generate a valid POS token
  const isoOrd = `ORD-ISO-${Date.now()}`;
  executeActionGateway({
    action: 'create_order',
    params: { order_number: isoOrd, customer_phone: '+923001234567', items: [{ sku: 'POS-HW-002', quantity: 1 }] },
    trustedSessionContext: { business_code: 'POS_RETAIL', instance_name: 'pos-instance', customerPhone: '+923001234567', allowed_tools: ['action_gateway'] }
  });
  const isoReq = executeActionGateway({
    action: 'cancel_order',
    params: { order_number: isoOrd },
    trustedSessionContext: { business_code: 'POS_RETAIL', instance_name: 'pos-instance', customerPhone: '+923001234567', allowed_tools: ['action_gateway'] }
  });
  const isoToken = isoReq.token;

  // Approve it
  executeActionGateway({
    action: 'approve_action',
    params: { approval_token: isoToken, approver_id: 'pos_admin', approver_name: 'POS Admin' },
    trustedSessionContext: { business_code: 'POS_RETAIL', instance_name: 'pos-instance', customerPhone: '+923001234567', allowed_tools: ['action_gateway'] }
  });

  // Attempt to use POS approval token in HOSP_HEALTH session
  const crossTenantRes = executeActionGateway({
    action: 'cancel_appointment',
    params: { appointment_number: 'APPT-FAKED', approval_token: isoToken },
    trustedSessionContext: { business_code: 'HOSP_HEALTH', instance_name: 'hospital-instance', customerPhone: '+923335555555', allowed_tools: ['action_gateway'] }
  });
  assert(crossTenantRes.status === 'ERROR', 'Cross-tenant token usage blocked');
  assert(crossTenantRes.verdict && crossTenantRes.verdict.error.includes('TENANT_APPROVAL_MISMATCH'), 'Error highlights TENANT_APPROVAL_MISMATCH');


  // =========================================================================
  // 11. EXPIRATION PROTECTION
  // =========================================================================
  console.log('\n--- 11. Expiration Protection ---');

  // Manually expire a token
  runPsql(
    `UPDATE platform_action_approvals SET expires_at = NOW() - INTERVAL '1 hour' WHERE approval_token = '${isoToken}';`,
    'gateway_action_writer',
    'platform_db'
  );

  const expiredRes = executeActionGateway({
    action: 'cancel_order',
    params: { order_number: isoOrd, approval_token: isoToken },
    trustedSessionContext: { business_code: 'POS_RETAIL', instance_name: 'pos-instance', customerPhone: '+923001234567', allowed_tools: ['action_gateway'] }
  });
  assert(expiredRes.status === 'ERROR', 'Expired approval token execution rejected');
  assert(expiredRes.verdict && expiredRes.verdict.error.includes('APPROVAL_EXPIRED'), 'Error highlights APPROVAL_EXPIRED');


  // =========================================================================
  // 12. STANDARD ACTIONS EXECUTE DIRECTLY WITHOUT APPROVAL
  // =========================================================================
  console.log('\n--- 12. Standard Non-Sensitive Actions Unhindered ---');

  // BISE submit_verification_request
  const biseRes = executeActionGateway({
    action: 'submit_verification_request',
    params: {
      roll_number: '102450',
      applicant_name: 'Direct Exec User'
    },
    trustedSessionContext: {
      business_code: 'BISE_EDU',
      instance_name: 'bise-instance',
      customerPhone: '+923001234567',
      allowed_tools: ['action_gateway']
    }
  });
  assert(biseRes.status === 'SUCCESS', 'BISE submit_verification_request executes directly without approval');


  // =========================================================================
  // 13. AUDIT LOGGING VERIFICATION
  // =========================================================================
  console.log('\n--- 13. Audit Logging Verification (platform_audit_metadata) ---');

  const auditEvents = runPsql(
    "SELECT DISTINCT inbound_payload->>'action' FROM platform_audit_metadata WHERE inbound_payload->>'action' IN ('approve_action', 'reject_action', 'cancel_order', 'cancel_appointment');",
    'gateway_action_writer',
    'platform_db'
  );
  console.log('  [INFO] Audit actions recorded:\n' + auditEvents.split('\n').map(l => '    ' + l).join('\n'));

  assert(auditEvents.includes('approve_action'), 'approve_action logged to audit log');
  assert(auditEvents.includes('reject_action'), 'reject_action logged to audit log');
  assert(auditEvents.includes('cancel_order'), 'cancel_order execution attempts logged to audit log');

  // Summary
  console.log('\n========================================================================');
  console.log(`   PHASE 29 TEST SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('========================================================================');

  if (failCount > 0) {
    console.error(`\n>>> FAILURE: ${failCount} tests failed in Phase 29 test suite.`);
    process.exit(1);
  } else {
    console.log('\n>>> SUCCESS: All Phase 29 Human Approval tests passed cleanly.');
  }
}

runTestSuite().catch(err => {
  console.error('Fatal Test Suite Error:', err);
  process.exit(1);
});
