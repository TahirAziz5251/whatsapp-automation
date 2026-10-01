/**
 * Phase 30: Result Validation + Business Rules Test Suite
 * 
 * Verifies:
 * 1. DB/API status & affected rows validation.
 * 2. Transaction commit verification (row existence).
 * 3. Stock deduction & catalog price consistency (tampering blocked).
 * 4. Payment amount rules (underpayment rejected).
 * 5. Doctor working schedule & Sunday OPD closure checks.
 * 6. Appointment slot conflict / double-booking prevention.
 * 7. Customer / Patient ownership constraints across orders & appointments.
 * 8. Simulated tool failure response generation.
 * 9. False-success response blocking: tool fails -> agent claiming success is BLOCKED and sanitized.
 * 10. Roman Urdu false-success blocking and entity ID consistency verification.
 */

const { executeActionGateway, runPsql } = require('./action_gateway');
const { verifyActionResult, validateAgentResponse } = require('./result_validator');

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('  PHASE 30: RESULT VALIDATION & BUSINESS RULES VERIFICATION');
  console.log('================================================================\n');

  const posContext = {
    business_code: 'POS_RETAIL',
    instance_name: 'pos-instance',
    customerPhone: '+923001234567',
    allowed_tools: ['action_gateway']
  };

  const hospContext = {
    business_code: 'HOSP_HEALTH',
    instance_name: 'hosp-instance',
    customerPhone: '+923007654321',
    allowed_tools: ['action_gateway']
  };

  const biseContext = {
    business_code: 'BISE_EDU',
    instance_name: 'bise-instance',
    customerPhone: '+92300998877',
    allowed_tools: ['action_gateway']
  };

  // Idempotent test setup: clear test appointments on test date
  try {
    runPsql("DELETE FROM appointment_history WHERE appointment_id IN (SELECT id FROM appointments WHERE appointment_date = '2026-10-09');", 'postgres', 'hospital_db');
    runPsql("DELETE FROM appointments WHERE appointment_date = '2026-10-09';", 'postgres', 'hospital_db');
  } catch (e) {}

  // -------------------------------------------------------------------------
  // Test 1: DB/API Status & Affected Rows Validation (create_order)
  // -------------------------------------------------------------------------
  console.log('Test 1: Validating DB status & affected rows on order creation...');
  const orderRes = executeActionGateway({
    action: 'create_order',
    params: {
      customer_phone: '+923001234567',
      customer_name: 'Zeeshan Ul Haq',
      items: [
        { sku: 'POS-CS-001', quantity: 2 } // 6,500 * 2 = 13,000 PKR
      ]
    },
    trustedSessionContext: posContext
  });

  assert(orderRes.status === 'SUCCESS', 'Order creation returned SUCCESS');
  assert(orderRes.result.order_number.startsWith('ORD-'), 'Order number generated');
  assert(orderRes.result.verified === true, 'Order verified by Phase 30 validator');
  assert(orderRes.result.verification_details.verified_items === 1, 'Affected rows in order_items matches input');

  // Verify directly in database
  const createdOrdNum = orderRes.result.order_number;
  const dbOrdCheck = runPsql(`SELECT status, total_amount_pkr FROM orders WHERE order_number = '${createdOrdNum}';`, 'gateway_action_writer', 'pos_db');
  assert(dbOrdCheck.includes('PENDING') && dbOrdCheck.includes('13000'), 'Database contains committed order with PENDING status and exact PKR 13,000 total');

  // -------------------------------------------------------------------------
  // Test 2: Price Consistency & Price Tampering Rejection
  // -------------------------------------------------------------------------
  console.log('\nTest 2: Price tampering rejection (tampered unit price)...');
  const tamperedRes = executeActionGateway({
    action: 'create_order',
    params: {
      customer_phone: '+923001234567',
      customer_name: 'Zeeshan Ul Haq',
      items: [
        { sku: 'POS-HW-001', quantity: 1, unit_price: 1500 } // Catalog is 35,000, attacker attempts 1,500!
      ]
    },
    trustedSessionContext: posContext
  });

  assert(tamperedRes.status === 'ERROR', 'Price tampering was rejected with ERROR');
  assert(tamperedRes.verdict.error.includes('Price tampering detected'), 'Error explicitly mentions price tampering detection');

  // -------------------------------------------------------------------------
  // Test 3: Payment Amount Rule (Underpayment Rejection)
  // -------------------------------------------------------------------------
  console.log('\nTest 3: Payment amount rule (underpayment rejection)...');
  const underpayRes = executeActionGateway({
    action: 'record_payment',
    params: {
      order_number: createdOrdNum,
      amount_pkr: 5000, // Total is 13,000, attempts to pay 5,000
      payment_method: 'BANK_TRANSFER',
      transaction_ref: 'TRX-UNDERPAY-001'
    },
    trustedSessionContext: posContext
  });

  assert(underpayRes.status === 'ERROR', 'Underpayment attempt was rejected');
  assert(underpayRes.verdict.error.includes('Underpayment is rejected'), 'Error explicitly identifies underpayment rejection');

  // Exact payment succeeds
  const fullPayRes = executeActionGateway({
    action: 'record_payment',
    params: {
      order_number: createdOrdNum,
      amount_pkr: 13000,
      payment_method: 'BANK_TRANSFER',
      transaction_ref: 'TRX-FULLPAY-001'
    },
    trustedSessionContext: posContext
  });

  assert(fullPayRes.status === 'SUCCESS', 'Full payment of exact order amount succeeded');
  assert(fullPayRes.result.verified === true, 'Payment and order status update verified in DB');

  // -------------------------------------------------------------------------
  // Test 4: Ownership Constraint Violation Rejection
  // -------------------------------------------------------------------------
  console.log('\nTest 4: Ownership constraint enforcement across customers...');
  const foreignContext = {
    business_code: 'POS_RETAIL',
    instance_name: 'pos-instance',
    customerPhone: '+923119998877', // Different customer trying to modify Zeeshan's order!
    allowed_tools: ['action_gateway']
  };

  const stealUpdateRes = executeActionGateway({
    action: 'update_order',
    params: {
      order_number: createdOrdNum,
      status: 'CONFIRMED'
    },
    trustedSessionContext: foreignContext
  });

  assert(stealUpdateRes.status === 'ERROR', 'Foreign caller order update rejected');
  assert(stealUpdateRes.verdict.error.includes('Ownership constraint violation'), 'Error mentions ownership constraint violation');

  // Also verify result_validator independently blocks ownership violation
  const valCheck = verifyActionResult('update_order', { order_number: createdOrdNum, status: 'PENDING' }, { order_number: createdOrdNum }, 'POS_RETAIL', '+923119998877');
  assert(valCheck.verified === false && valCheck.reason.includes('Ownership violation'), 'Result validator independently blocks ownership violation');

  // -------------------------------------------------------------------------
  // Test 5: Doctor Schedule Rule & Sunday OPD Closure
  // -------------------------------------------------------------------------
  console.log('\nTest 5: Sunday OPD closure & doctor schedule enforcement...');
  // Find a known Sunday in 2026: 2026-10-04 is a Sunday
  const sundayRes = executeActionGateway({
    action: 'book_appointment',
    params: {
      patient_name: 'Ali Raza',
      patient_phone: '+923007654321',
      doctor_name: 'Dr. Tariq Mahmood', // Cardiologist: Mon, Wed, Fri
      appointment_date: '2026-10-04', // Sunday!
      appointment_time: '10:00'
    },
    trustedSessionContext: hospContext
  });

  assert(sundayRes.status === 'ERROR', 'Sunday appointment booking was blocked');
  assert(sundayRes.verdict.error.includes('Hospital OPD is closed on Sundays'), 'Sunday OPD closure error returned');

  // Book on Tuesday for Dr. Fatima Tariq (Available only Mon, Wed, Fri) -> 2026-09-29 is a Tuesday
  const wrongDayRes = executeActionGateway({
    action: 'book_appointment',
    params: {
      patient_name: 'Ali Raza',
      patient_phone: '+923007654321',
      doctor_name: 'Dr. Tariq Mahmood',
      appointment_date: '2026-09-29', // Tuesday!
      appointment_time: '10:00'
    },
    trustedSessionContext: hospContext
  });

  assert(wrongDayRes.status === 'ERROR', 'Doctor off-duty day booking was blocked');
  assert(wrongDayRes.verdict.error.includes('is not available on Tuesdays'), 'Doctor schedule off-duty error returned');

  // Book on Friday (Valid day for Dr. Fatima Tariq) -> 2026-10-09 is a Friday
  const validAppRes = executeActionGateway({
    action: 'book_appointment',
    params: {
      patient_name: 'Ali Raza',
      patient_phone: '+923007654321',
      doctor_name: 'Dr. Tariq Mahmood',
      appointment_date: '2026-10-09', // Friday
      appointment_time: '10:30'
    },
    trustedSessionContext: hospContext
  });

  assert(validAppRes.status === 'SUCCESS', 'Valid appointment on doctor duty day succeeded');
  assert(validAppRes.result.appointment_number.startsWith('APT-'), 'Appointment number generated');
  assert(validAppRes.result.verified === true, 'Appointment verified in hospital DB with schedule confirmation');
  const validAppNumber = validAppRes.result.appointment_number;

  // -------------------------------------------------------------------------
  // Test 6: Slot Conflict / Double-Booking Prevention
  // -------------------------------------------------------------------------
  console.log('\nTest 6: Slot conflict / double-booking prevention...');
  const doubleBookRes = executeActionGateway({
    action: 'book_appointment',
    params: {
      patient_name: 'Hamza Khan',
      patient_phone: '+923001112233',
      doctor_name: 'Dr. Tariq Mahmood',
      appointment_date: '2026-10-09', // Same doctor, same date
      appointment_time: '10:30'  // Same time!
    },
    trustedSessionContext: { ...hospContext, customerPhone: '+923001112233' }
  });

  assert(doubleBookRes.status === 'ERROR', 'Double-booking the same doctor and slot was rejected');
  assert(doubleBookRes.verdict.error.includes('already has an appointment booked'), 'Slot conflict detected');

  // -------------------------------------------------------------------------
  // Test 7: Patient Ownership on Appointment Modification / Cancellation
  // -------------------------------------------------------------------------
  console.log('\nTest 7: Patient ownership on appointment modification...');
  const foreignPatientContext = {
    business_code: 'HOSP_HEALTH',
    instance_name: 'hosp-instance',
    customerPhone: '+923459990011', // Foreign caller
    allowed_tools: ['action_gateway']
  };

  const stealReschedRes = executeActionGateway({
    action: 'reschedule_appointment',
    params: {
      appointment_number: validAppNumber,
      new_appointment_date: '2026-10-05', // Monday (Dr. Fatima Tariq is available)
      new_appointment_time: '11:00'
    },
    trustedSessionContext: foreignPatientContext
  });

  assert(stealReschedRes.status === 'ERROR', 'Foreign caller appointment reschedule rejected');
  assert(stealReschedRes.verdict.error.includes('Ownership constraint violation'), 'Ownership constraint verified on appointment');

  // Also verify result_validator independently blocks ownership violation on appointment
  const hospValCheck = verifyActionResult('cancel_appointment', { appointment_number: validAppNumber }, { appointment_number: validAppNumber }, 'HOSP_HEALTH', '+923459990011');
  assert(hospValCheck.verified === false && hospValCheck.reason.includes('Ownership violation'), 'Result validator independently blocks appointment ownership violation');

  // -------------------------------------------------------------------------
  // Test 8: Simulated Tool Failure
  // -------------------------------------------------------------------------
  console.log('\nTest 8: Simulating tool failure via simulate_failure flag...');
  const simFailRes = executeActionGateway({
    action: 'create_order',
    params: {
      simulate_failure: true,
      customer_phone: '+923001234567',
      items: [{ sku: 'POS-HW-002', quantity: 1 }]
    },
    trustedSessionContext: posContext
  });

  assert(simFailRes.status === 'ERROR', 'Simulated tool failure returns ERROR');
  assert(simFailRes.verdict.error.includes('Simulated tool failure'), 'Error message confirms simulated failure');

  // -------------------------------------------------------------------------
  // Test 9: False-Success Response Blocking (English)
  // -------------------------------------------------------------------------
  console.log('\nTest 9: Intercepting and blocking false-success responses (English)...');
  // Scenario: Tool execution failed (simFailRes), but LLM hallucinated success!
  const hallucinatedSuccessText = "Great news! Your order has been placed successfully and will be delivered shortly.";
  
  const guardResult = validateAgentResponse(hallucinatedSuccessText, [simFailRes]);

  assert(guardResult.blocked === true, 'False-success response was successfully BLOCKED by guard');
  assert(guardResult.reason === 'FALSE_SUCCESS_BLOCKED', 'Guard reported FALSE_SUCCESS_BLOCKED');
  assert(!guardResult.sanitized_response.includes('placed successfully'), 'Sanitized response does not claim success');
  assert(guardResult.sanitized_response.includes('could not be completed'), 'Sanitized response informs user that request could not be completed');
  assert(guardResult.sanitized_response.includes('No changes have been made'), 'Sanitized response assures no changes made');

  // -------------------------------------------------------------------------
  // Test 10: False-Success Response Blocking (Roman Urdu)
  // -------------------------------------------------------------------------
  console.log('\nTest 10: Intercepting false-success responses in Roman Urdu...');
  const romanUrduHallucination = "Aap ka order confirm ho gaya hai, mubarak ho!";
  const romanGuardResult = validateAgentResponse(romanUrduHallucination, [simFailRes]);

  assert(romanGuardResult.blocked === true, 'Roman Urdu false-success was BLOCKED');
  assert(!romanGuardResult.sanitized_response.includes('confirm ho gaya'), 'Sanitized output blocks false Urdu confirmation');

  // -------------------------------------------------------------------------
  // Test 11: Valid Truthful Failure Response Allowed Through
  // -------------------------------------------------------------------------
  console.log('\nTest 11: Truthful failure response is permitted without blocking...');
  const truthfulFailureText = "I am sorry, but your order could not be placed because the payment gateway timed out.";
  const truthfulGuardResult = validateAgentResponse(truthfulFailureText, [simFailRes]);

  assert(truthfulGuardResult.blocked === false, 'Truthful failure response was not falsely blocked');
  assert(truthfulGuardResult.conveyed_failure === true, 'Guard recognizes truthful failure conveyance');

  // -------------------------------------------------------------------------
  // Test 12: Entity Number Integrity (Hallucinated ID Correction)
  // -------------------------------------------------------------------------
  console.log('\nTest 12: Entity number alignment with verified DB record...');
  const hallucinatedIdResponse = `Your appointment has been booked. Your appointment number is APT-2026-9999.`;
  const alignResult = validateAgentResponse(hallucinatedIdResponse, [validAppRes], hospContext);

  assert(alignResult.blocked === false, 'Successful response allowed through');
  assert(alignResult.sanitized_response.includes(validAppNumber), `Sanitized response contains the true database ID (${validAppNumber})`);

  console.log('\n================================================================');
  console.log(`  ALL ${totalTests} TESTS PASSED SUCCESSFULLY! (100%)`);
  console.log('================================================================');
}

if (require.main === module) {
  runTestSuite().catch(err => {
    console.error('\n❌ Test suite failed:', err);
    process.exit(1);
  });
}

module.exports = { runTestSuite };
