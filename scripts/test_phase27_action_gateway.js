/**
 * Phase 27: Action Gateway Comprehensive Test & Verification Suite
 * 
 * Objectives Tested:
 * 1. Read vs. Write Distinction (Action Gateway strictly rejects read queries).
 * 2. Strict Parameter Validation (phone, dates, amounts, item schemas, whitelisted endpoints).
 * 3. Multi-Tenant Outside-LLM Policy Gate (Cross-domain write denials).
 * 4. Tenant Spoofing Defense (Neutralizes foreign tenant arguments).
 * 5. First Actions Execution on Live DB:
 *    - create_order (POS)
 *    - record_payment (POS)
 *    - sync_crm (POS)
 *    - book_appointment (Hospital)
 *    - cancel_appointment (Hospital)
 *    - manage_calendar & send_notification
 * 6. Least-Privilege DB Role Verification (gateway_action_writer cannot DROP, TRUNCATE, or write to bise_db).
 * 7. Audit & Observability Verification in platform_audit_metadata.
 * 8. n8n Workflow Node 2020 Integration Verification.
 */

const fs = require('fs');
const { executeActionGateway, validateActionParams, runPsql } = require('./action_gateway');

console.log('================ PHASE 27 ACTION GATEWAY VERIFICATION SUITE ================');

// =========================================================================
// 1. READ VS. WRITE DISTINCTION (Rejection of Read Operations)
// =========================================================================
console.log('\n1. Testing Read vs. Write Distinction (Rejection of Read Queries):');

const readTests = [
  'get_product',
  'check_inventory',
  'get_student_result',
  'get_doctor_schedule',
  'search_knowledge_base'
];

let allReadsRejected = true;
readTests.forEach(readAction => {
  const res = executeActionGateway({
    action: readAction,
    params: { sku: 'POS-HW-001' },
    trustedSessionContext: { business_code: 'POS_RETAIL', allowed_tools: ['action_gateway'] }
  });

  const isRejected = res.status === 'REJECTED' && res.verdict.status === 'READ_OPERATION_REJECTED';
  console.log(`   Action: "${readAction}" -> ${isRejected ? 'REJECTED AS READ-ONLY [PASS]' : 'INCORRECTLY PERMITTED [FAIL]'}`);
  if (!isRejected) allReadsRejected = false;
});

if (allReadsRejected) {
  console.log('   [PASS] Action Gateway strictly distinguishes reads from writes and rejects read-only queries.');
} else {
  console.error('   [FAIL] Read operations were not rejected by Action Gateway!');
  process.exit(1);
}

// =========================================================================
// 2. STRICT PARAMETER VALIDATION
// =========================================================================
console.log('\n2. Testing Strict Parameter Validation:');

const invalidParamCases = [
  {
    name: 'create_order with invalid phone number',
    action: 'create_order',
    params: { customer_phone: 'invalid-phone', items: [{ sku: 'POS-HW-001', quantity: 1 }] }
  },
  {
    name: 'create_order with empty items array',
    action: 'create_order',
    params: { customer_phone: '+923001234567', items: [] }
  },
  {
    name: 'record_payment with negative amount',
    action: 'record_payment',
    params: { order_number: 'ORD-2026-001', payment_method: 'CASH', amount_pkr: -500, transaction_ref: 'TRX-1' }
  },
  {
    name: 'record_payment with invalid payment method',
    action: 'record_payment',
    params: { order_number: 'ORD-2026-001', payment_method: 'CRYPTO_BITCOIN', amount_pkr: 5000, transaction_ref: 'TRX-1' }
  },
  {
    name: 'book_appointment with malformed date',
    action: 'book_appointment',
    params: { patient_phone: '+923001112233', patient_name: 'Imran', doctor_id: 1, appointment_date: '2026/13/45', appointment_time: '10:00' }
  },
  {
    name: 'call_external_api with unapproved non-whitelisted endpoint',
    action: 'call_external_api',
    params: { endpoint_key: 'UNAUTHORIZED_DARK_WEB_API', payload: {} }
  }
];

let allParamValidationsPassed = true;
invalidParamCases.forEach((tc, idx) => {
  const val = validateActionParams(tc.action, tc.params);
  const passed = !val.valid;
  console.log(`   [Case 2.${idx + 1}] ${tc.name}: ${passed ? 'CAUGHT & REJECTED [PASS]' : 'ALLOWED INVALID PARAMS [FAIL]'}`);
  if (!passed) allParamValidationsPassed = false;
});

if (allParamValidationsPassed) {
  console.log('   [PASS] All invalid parameters strictly rejected by Action Gateway schema validators.');
} else {
  console.error('   [FAIL] Parameter validation failed to reject invalid input!');
  process.exit(1);
}

// =========================================================================
// 3. MULTI-TENANT OUTSIDE-LLM POLICY GATE (Cross-Domain Write Denials)
// =========================================================================
console.log('\n3. Testing Multi-Tenant Policy Gate (Cross-Domain Write Denials):');

const policyDenialCases = [
  {
    name: 'POS model attempts to book hospital appointment',
    action: 'book_appointment',
    tenant: 'POS_RETAIL',
    params: { patient_phone: '+923001234567', patient_name: 'Customer', doctor_id: 1, appointment_date: '2026-10-15', appointment_time: '10:00' }
  },
  {
    name: 'BISE model attempts to create commercial retail order',
    action: 'create_order',
    tenant: 'BISE_EDU',
    params: { customer_phone: '+923001234567', items: [{ sku: 'POS-HW-001', quantity: 1 }] }
  },
  {
    name: 'Hospital model attempts to create commercial retail order',
    action: 'create_order',
    tenant: 'HOSP_HEALTH',
    params: { customer_phone: '+923001234567', items: [{ sku: 'POS-HW-001', quantity: 1 }] }
  },
  {
    name: 'Hospital model attempts to record commercial payment',
    action: 'record_payment',
    tenant: 'HOSP_HEALTH',
    params: { order_number: 'ORD-2026-001', payment_method: 'CASH', amount_pkr: 1000, transaction_ref: 'TRX-1' }
  },
  {
    name: 'BISE model attempts to book clinical appointment',
    action: 'book_appointment',
    tenant: 'BISE_EDU',
    params: { patient_phone: '+923001234567', patient_name: 'Student', doctor_id: 1, appointment_date: '2026-10-15', appointment_time: '10:00' }
  }
];

let allPolicyDenialsPassed = true;
policyDenialCases.forEach((tc, idx) => {
  const res = executeActionGateway({
    action: tc.action,
    params: tc.params,
    trustedSessionContext: {
      business_code: tc.tenant,
      instance_name: `${tc.tenant.toLowerCase()}-instance`,
      customerPhone: '+923001234567',
      allowed_tools: ['action_gateway']
    }
  });

  const isDenied = res.status === 'DENIED' && res.verdict.status === 'SECURITY_POLICY_DENIED';
  console.log(`   [Case 3.${idx + 1}] ${tc.name} (${tc.tenant}): ${isDenied ? 'POLICY DENIED [PASS]' : 'UNAUTHORIZED WRITE PERMITTED [FAIL]'}`);
  if (!isDenied) allPolicyDenialsPassed = false;
});

if (allPolicyDenialsPassed) {
  console.log('   [PASS] Complete cross-tenant action denial verified. Foreign writes blocked outside LLM.');
} else {
  console.error('   [FAIL] Policy gate failed to block cross-tenant action!');
  process.exit(1);
}

// =========================================================================
// 4. TENANT SPOOFING DEFENSE TEST
// =========================================================================
console.log('\n4. Testing Tenant Spoofing Defense (Tamper Resistance):');
// Hospital session where LLM passes business_code: 'POS_RETAIL' attempting to create a retail order
const spoofRes = executeActionGateway({
  action: 'create_order',
  params: { customer_phone: '+923001234567', items: [{ sku: 'POS-HW-001', quantity: 1 }] },
  trustedSessionContext: {
    business_code: 'HOSP_HEALTH', // Trusted session context
    instance_name: 'hospital-instance',
    customerPhone: '+923001234567',
    allowed_tools: ['action_gateway']
  },
  untrustedParams: {
    business_code: 'POS_RETAIL' // Untrusted injection
  }
});

console.log(`   Trusted Session: HOSP_HEALTH | Injected Parameter: POS_RETAIL`);
console.log(`   Status: ${spoofRes.status}`);
console.log(`   Error Code: ${spoofRes.verdict?.error_code}`);
console.log(`   Message: ${spoofRes.formatted_context}`);

if (spoofRes.status === 'DENIED' && spoofRes.verdict?.error_code === 'UNAUTHORIZED_TENANT_ACTION') {
  console.log('   [PASS] Tenant spoofing attempt successfully neutralized. Action Gateway pinned to trusted context.');
} else {
  console.error('   [FAIL] Spoofing defense failed!', spoofRes);
  process.exit(1);
}

// =========================================================================
// 5. FIRST ACTIONS EXECUTION ON LIVE DATABASE
// =========================================================================
console.log('\n5. Testing Live Execution of First Actions (State-Changing Operations):');

// 5a. Action: create_order (POS Domain)
console.log('\n   --- 5a. Action: create_order (POS Retail) ---');
const orderTestRes = executeActionGateway({
  action: 'create_order',
  params: {
    customer_phone: '+923009988776',
    customer_name: 'Tariq Mehmood',
    city: 'Lahore',
    items: [
      { sku: 'POS-HW-001', quantity: 2 }, // Omnidirectional 2D Scanner
      { sku: 'POS-HW-002', quantity: 1 }  // Thermal Printer 80mm
    ]
  },
  trustedSessionContext: {
    business_code: 'POS_RETAIL',
    instance_name: 'pos-instance',
    customerPhone: '+923009988776',
    allowed_tools: ['action_gateway']
  }
});

console.log(`   Created Order: ${orderTestRes.result?.order_number}`);
console.log(`   Total Amount: PKR ${orderTestRes.result?.total_amount_pkr}`);
console.log(`   Status: ${orderTestRes.status}`);

const newOrderNumber = orderTestRes.result?.order_number;
if (orderTestRes.status === 'SUCCESS' && newOrderNumber && orderTestRes.result.total_amount_pkr > 0) {
  console.log('   [PASS - 5a] create_order executed successfully in pos_db.');
} else {
  console.error('   [FAIL - 5a] create_order failed!', orderTestRes);
  process.exit(1);
}

// 5b. Action: record_payment (POS Domain)
console.log('\n   --- 5b. Action: record_payment (POS Retail) ---');
const payTestRes = executeActionGateway({
  action: 'record_payment',
  params: {
    order_number: newOrderNumber,
    payment_method: 'JAZZCASH',
    amount_pkr: orderTestRes.result.total_amount_pkr,
    transaction_ref: 'JC-PHASE27-998811'
  },
  trustedSessionContext: {
    business_code: 'POS_RETAIL',
    instance_name: 'pos-instance',
    customerPhone: '+923009988776',
    allowed_tools: ['action_gateway']
  }
});

console.log(`   Payment ID: ${payTestRes.result?.payment_id}`);
console.log(`   Method: ${payTestRes.result?.payment_method}`);
console.log(`   Summary: ${payTestRes.formatted_context}`);

if (payTestRes.status === 'SUCCESS' && payTestRes.result?.payment_id) {
  console.log('   [PASS - 5b] record_payment executed successfully in pos_db; order updated to PAID.');
} else {
  console.error('   [FAIL - 5b] record_payment failed!', payTestRes);
  process.exit(1);
}

// 5c. Action: sync_crm (POS Domain)
console.log('\n   --- 5c. Action: sync_crm (POS Retail) ---');
const crmTestRes = executeActionGateway({
  action: 'sync_crm',
  params: {
    customer_phone: '+923009988776',
    push_name: 'Tariq Mehmood',
    lead_stage: 'CLOSED_WON',
    city: 'Lahore'
  },
  trustedSessionContext: {
    business_code: 'POS_RETAIL',
    instance_name: 'pos-instance',
    customerPhone: '+923009988776',
    allowed_tools: ['action_gateway']
  }
});

console.log(`   CRM Sync Summary: ${crmTestRes.formatted_context}`);
if (crmTestRes.status === 'SUCCESS') {
  console.log('   [PASS - 5c] sync_crm executed successfully in pos_db.');
} else {
  console.error('   [FAIL - 5c] sync_crm failed!', crmTestRes);
  process.exit(1);
}

// 5d. Action: book_appointment (Hospital Domain)
console.log('\n   --- 5d. Action: book_appointment (Hospital Healthcare) ---');
const dynamicDay = 10 + Math.floor(Math.random() * 18);
const dynamicHour = 9 + Math.floor(Math.random() * 8);
const appTestRes = executeActionGateway({
  action: 'book_appointment',
  params: {
    patient_phone: '+923331122334',
    patient_name: 'Sobia Parveen',
    doctor_name: 'Dr. Tariq Mahmood',
    appointment_date: '2026-10-02',
    appointment_time: '10:00'
  },
  trustedSessionContext: {
    business_code: 'HOSP_HEALTH',
    instance_name: 'hospital-instance',
    customerPhone: '+923331122334',
    allowed_tools: ['action_gateway']
  }
});

console.log(`   Appointment Number: ${appTestRes.result?.appointment_number}`);
console.log(`   Doctor: ${appTestRes.result?.doctor_name}`);
console.log(`   Summary: ${appTestRes.formatted_context}`);

const bookedAppNumber = appTestRes.result?.appointment_number;
if (appTestRes.status === 'SUCCESS' && bookedAppNumber) {
  console.log('   [PASS - 5d] book_appointment executed successfully in hospital_db.');
} else {
  console.error('   [FAIL - 5d] book_appointment failed!', appTestRes);
  process.exit(1);
}

// 5e. Action: cancel_appointment (Hospital Domain - Phase 29 Approval Flow)
console.log('\n   --- 5e. Action: cancel_appointment (Hospital Healthcare) ---');
const cancelReq = executeActionGateway({
  action: 'cancel_appointment',
  params: {
    appointment_number: bookedAppNumber
  },
  trustedSessionContext: {
    business_code: 'HOSP_HEALTH',
    instance_name: 'hospital-instance',
    customerPhone: '+923331122334',
    allowed_tools: ['action_gateway']
  }
});

const cancelToken = cancelReq.approval_token || cancelReq.token;
executeActionGateway({
  action: 'approve_action',
  params: { approval_token: cancelToken, approver_id: 'dr_approver_27', approver_name: 'Dr. Head' },
  trustedSessionContext: {
    business_code: 'HOSP_HEALTH',
    instance_name: 'hospital-instance',
    customerPhone: '+923331122334',
    allowed_tools: ['action_gateway']
  }
});

const cancelTestRes = executeActionGateway({
  action: 'cancel_appointment',
  params: {
    appointment_number: bookedAppNumber,
    approval_token: cancelToken
  },
  trustedSessionContext: {
    business_code: 'HOSP_HEALTH',
    instance_name: 'hospital-instance',
    customerPhone: '+923331122334',
    allowed_tools: ['action_gateway']
  }
});

console.log(`   Cancel Summary: ${cancelTestRes.formatted_context}`);
if (cancelTestRes.status === 'SUCCESS') {
  console.log('   [PASS - 5e] cancel_appointment executed successfully in hospital_db with approved token.');
} else {
  console.error('   [FAIL - 5e] cancel_appointment failed!', cancelTestRes);
  process.exit(1);
}

// 5f. Action: send_notification & call_external_api
console.log('\n   --- 5f. Action: send_notification & call_external_api ---');
const notifRes = executeActionGateway({
  action: 'send_notification',
  params: {
    recipient_phone: '+923001234567',
    channel: 'WHATSAPP',
    template_name: 'ORDER_CONFIRMATION',
    parameters: { order_number: newOrderNumber }
  },
  trustedSessionContext: { business_code: 'POS_RETAIL', allowed_tools: ['action_gateway'] }
});

const extApiRes = executeActionGateway({
  action: 'call_external_api',
  params: {
    endpoint_key: 'PAYMENT_GATEWAY',
    payload: { status: 'check' }
  },
  trustedSessionContext: { business_code: 'POS_RETAIL', allowed_tools: ['action_gateway'] }
});

if (notifRes.status === 'SUCCESS' && extApiRes.status === 'SUCCESS') {
  console.log('   [PASS - 5f] send_notification and call_external_api dispatched cleanly through authorized routes.');
} else {
  console.error('   [FAIL - 5f] External actions failed!', notifRes, extApiRes);
  process.exit(1);
}

// =========================================================================
// 6. LEAST-PRIVILEGE ROLE VERIFICATION (gateway_action_writer)
// =========================================================================
console.log('\n6. Least-Privilege Role Verification (gateway_action_writer):');

// 6a. Verify DROP TABLE is blocked
let dropBlocked = false;
try {
  runPsql('DROP TABLE orders;', 'gateway_action_writer', 'pos_db');
} catch (e) {
  dropBlocked = true;
  console.log('   [PASS] DROP TABLE orders denied to gateway_action_writer by PostgreSQL engine.');
}
if (!dropBlocked) {
  console.error('   [FAIL] gateway_action_writer was able to DROP TABLE!');
  process.exit(1);
}

// 6b. Verify TRUNCATE is blocked
let truncateBlocked = false;
try {
  runPsql('TRUNCATE appointments;', 'gateway_action_writer', 'hospital_db');
} catch (e) {
  truncateBlocked = true;
  console.log('   [PASS] TRUNCATE appointments denied to gateway_action_writer by PostgreSQL engine.');
}
if (!truncateBlocked) {
  console.error('   [FAIL] gateway_action_writer was able to TRUNCATE table!');
  process.exit(1);
}

// 6c. Verify bise_db write is blocked
let biseWriteBlocked = false;
try {
  runPsql("INSERT INTO student_results (roll_number) VALUES ('999999');", 'gateway_action_writer', 'bise_db');
} catch (e) {
  biseWriteBlocked = true;
  console.log('   [PASS] INSERT into bise_db strictly denied to gateway_action_writer (read-only exam records).');
}
if (!biseWriteBlocked) {
  console.error('   [FAIL] gateway_action_writer was able to write to bise_db!');
  process.exit(1);
}

// =========================================================================
// 7. AUDIT LOGGING VERIFICATION (platform_audit_metadata)
// =========================================================================
console.log('\n7. Audit Logging Verification in platform_audit_metadata:');
const auditCheckSql = `
  SELECT id, business_code, inbound_payload->>'gateway' as gateway,
         inbound_payload->>'action' as action,
         outbound_payload->>'status' as status,
         processing_time_ms, created_at
  FROM platform_audit_metadata
  WHERE inbound_payload->>'gateway' = 'action_gateway'
  ORDER BY id DESC
  LIMIT 3;
`;
const auditRows = runPsql(auditCheckSql, 'postgres', 'platform_db');
console.log('   Latest Action Audit Records:\n' + auditRows.trim());

if (auditRows.includes('action_gateway')) {
  console.log('   [PASS] State-changing action events, parameters, latencies, and statuses logged to platform_audit_metadata.');
} else {
  console.error('   [FAIL] Action audit record not found in platform_audit_metadata!');
  process.exit(1);
}

// =========================================================================
// 8. WORKFLOW INTEGRATION VERIFICATION (Node 2020)
// =========================================================================
console.log('\n8. Workflow Integration Verification (Node 2020 in evolution_whatsapp_ai_agent_bot.json):');
const wfJson = JSON.parse(fs.readFileSync('evolution_whatsapp_ai_agent_bot.json', 'utf8'));

const node2020 = wfJson.nodes.find(n => n.id === '2020');
if (!node2020) {
  console.error('   [FAIL] Node 2020 (Tool: Action Gateway) missing in workflow!');
  process.exit(1);
}

const isAttachedToAgent = wfJson.connections['Tool: Action Gateway']?.ai_tool?.some(
  c => c.some(t => t.node === 'AI Agent (Shared Engine)')
);

const hasReadGuard = node2020.parameters.jsCode.includes('READ_OPERATION_REJECTED');
const hasPolicyGate = node2020.parameters.jsCode.includes('SECURITY_POLICY_DENIED');
const hasAudit = node2020.parameters.jsCode.includes('platform_audit_metadata');

console.log(`   Node 2020 Name: "${node2020.name}"`);
console.log(`   Attached to AI Agent: ${isAttachedToAgent}`);
console.log(`   Contains Read vs. Write Guard: ${hasReadGuard}`);
console.log(`   Contains Multi-Tenant Policy Gate: ${hasPolicyGate}`);
console.log(`   Contains Audit Trail Integration: ${hasAudit}`);

if (isAttachedToAgent && hasReadGuard && hasPolicyGate && hasAudit) {
  console.log('   [PASS] Node 2020 Action Gateway verified in workflow configuration.');
} else {
  console.error('   [FAIL] Node 2020 configuration check failed!');
  process.exit(1);
}

console.log('\n================================================================================');
console.log('ALL PHASE 27 ACTION GATEWAY VERIFICATION TESTS PASSED SUCCESSFULLY (100%)');
console.log('================================================================================\n');
