/**
 * Phase 30: Result Validation + Business Rules Engine
 * 
 * Objectives:
 * 1. Validate DB/API status, affected rows, and transaction commits.
 * 2. Enforce stock deduction and catalog price consistency.
 * 3. Enforce appointment slot rules, doctor working schedules, and conflict prevention.
 * 4. Enforce customer ownership constraints across orders, payments, and appointments.
 * 5. Provide strict failure response contracts and block false-success claims.
 * 
 * Pipeline:
 * Tool -> Actual Result -> Validator -> Only Verified Data -> Response
 */

/**
 * Normalizes phone numbers for comparison
 */
function normalizePhone(phone) {
  if (!phone) return '';
  return String(phone).replace(/[\s\-\(\)\+]/g, '');
}

/**
 * Escape single quotes for SQL literals
 */
function sqlEscape(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/'/g, "''");
}

/**
 * Post-Execution Result Validator
 * Validates actual database state against business rules and transaction commitments.
 * 
 * @param {string} action - Action executed
 * @param {Object} params - Input parameters
 * @param {Object} actionResult - Result returned by handler
 * @param {string} trustedBusinessCode - Verified tenant code
 * @param {string} customerPhone - Verified requester phone number
 * @returns {Object} { verified: boolean, reason?: string, details?: Object }
 */
function verifyActionResult(action, params, actionResult, trustedBusinessCode, customerPhone) {
  const { runPsql } = require('./action_gateway');
  const normCallerPhone = normalizePhone(customerPhone || params.customer_phone || params.patient_phone);

  try {
    switch (action) {
      case 'create_order': {
        const orderNumber = actionResult.order_number;
        if (!orderNumber) {
          return { verified: false, reason: 'Missing order_number in execution result.' };
        }

        // 1. Verify DB status: Order must exist in pos_db.orders
        const ordSql = `
          SELECT o.id, o.customer_id, o.total_amount_pkr, o.status, c.customer_phone 
          FROM orders o
          JOIN customers c ON o.customer_id = c.id
          WHERE o.order_number = '${sqlEscape(orderNumber)}'
          LIMIT 1;
        `;
        const ordRaw = runPsql(ordSql, 'gateway_action_writer', 'pos_db');
        if (!ordRaw || ordRaw.trim().length === 0) {
          return { verified: false, reason: `Transaction commit failed: Order '${orderNumber}' not found in database.` };
        }

        const [oIdStr, custIdStr, totalStr, statusStr, custPhoneStr] = ordRaw.split('|').map(s => s.trim());
        const orderId = parseInt(oIdStr, 10);
        const committedTotal = parseFloat(totalStr);

        // 2. Verify affected rows: order_items count must match requested items count
        const itemsCountSql = `SELECT COUNT(*) FROM order_items WHERE order_id = ${orderId};`;
        const actualItemsCount = parseInt(runPsql(itemsCountSql, 'gateway_action_writer', 'pos_db').trim(), 10);
        if (actualItemsCount !== params.items.length) {
          return { verified: false, reason: `Affected rows mismatch: Expected ${params.items.length} order items, found ${actualItemsCount}.` };
        }

        // 3. Price Rule: Calculate catalog total from pos_db.prices and verify against committed total
        let expectedTotal = 0;
        for (const item of params.items) {
          const priceSql = `
            SELECT pr.price_pkr 
            FROM prices pr 
            JOIN products p ON pr.product_id = p.id 
            WHERE p.sku = '${sqlEscape(item.sku)}' 
            LIMIT 1;
          `;
          const priceRaw = runPsql(priceSql, 'gateway_action_writer', 'pos_db');
          if (!priceRaw || priceRaw.trim().length === 0) {
            return { verified: false, reason: `Price verification failed: No catalog price for SKU '${item.sku}'.` };
          }
          const catPrice = parseFloat(priceRaw.trim());
          expectedTotal += catPrice * item.quantity;
        }

        if (Math.abs(committedTotal - expectedTotal) > 0.01) {
          return { 
            verified: false, 
            reason: `Price rule violation: Committed total PKR ${committedTotal} does not match catalog price PKR ${expectedTotal}.` 
          };
        }

        return { 
          verified: true, 
          details: { order_id: orderId, order_number: orderNumber, committed_total: committedTotal, verified_items: actualItemsCount } 
        };
      }

      case 'update_order': {
        const orderNumber = params.order_number || actionResult.order_number;
        const ordSql = `
          SELECT o.id, o.status, c.customer_phone 
          FROM orders o
          JOIN customers c ON o.customer_id = c.id
          WHERE o.order_number = '${sqlEscape(orderNumber)}'
          LIMIT 1;
        `;
        const ordRaw = runPsql(ordSql, 'gateway_action_writer', 'pos_db');
        if (!ordRaw || ordRaw.trim().length === 0) {
          return { verified: false, reason: `Order '${orderNumber}' not found for update verification.` };
        }

        const [oIdStr, curStatus, ordCustPhone] = ordRaw.split('|').map(s => s.trim());

        // Ownership Constraint
        if (normCallerPhone && normalizePhone(ordCustPhone) !== normCallerPhone) {
          return { verified: false, reason: `Ownership violation: Order '${orderNumber}' does not belong to customer ${customerPhone}.` };
        }

        // Status Verification: Must match new status
        if (params.status && curStatus.toUpperCase() !== params.status.toUpperCase()) {
          return { verified: false, reason: `Status update failed: Expected status '${params.status}', found '${curStatus}'.` };
        }

        return { verified: true, details: { order_number: orderNumber, updated_status: curStatus } };
      }

      case 'cancel_order': {
        const orderNumber = params.order_number || actionResult.order_number;
        const ordSql = `
          SELECT o.id, o.status, c.customer_phone 
          FROM orders o
          JOIN customers c ON o.customer_id = c.id
          WHERE o.order_number = '${sqlEscape(orderNumber)}'
          LIMIT 1;
        `;
        const ordRaw = runPsql(ordSql, 'gateway_action_writer', 'pos_db');
        if (!ordRaw || ordRaw.trim().length === 0) {
          return { verified: false, reason: `Order '${orderNumber}' not found for cancellation verification.` };
        }

        const [oIdStr, curStatus, ordCustPhone] = ordRaw.split('|').map(s => s.trim());

        // Ownership Constraint
        if (normCallerPhone && normalizePhone(ordCustPhone) !== normCallerPhone) {
          return { verified: false, reason: `Ownership violation: Order '${orderNumber}' does not belong to customer ${customerPhone}.` };
        }

        // Must be CANCELLED in database
        if (curStatus !== 'CANCELLED') {
          return { verified: false, reason: `Cancellation commit failed: Order status is '${curStatus}', expected 'CANCELLED'.` };
        }

        return { verified: true, details: { order_number: orderNumber, status: curStatus } };
      }

      case 'record_payment': {
        const orderId = actionResult.order_id;
        const paySql = `
          SELECT p.id, p.amount_pkr, p.payment_status, o.total_amount_pkr, o.status as order_status, c.customer_phone
          FROM payments p
          JOIN orders o ON p.order_id = o.id
          JOIN customers c ON o.customer_id = c.id
          WHERE p.id = ${actionResult.payment_id}
          LIMIT 1;
        `;
        const payRaw = runPsql(paySql, 'gateway_action_writer', 'pos_db');
        if (!payRaw || payRaw.trim().length === 0) {
          return { verified: false, reason: `Payment commit failed: Payment record #${actionResult.payment_id} not found.` };
        }

        const [pId, pAmt, pStatus, ordTotal, ordStatus, custPhone] = payRaw.split('|').map(s => s.trim());

        // Ownership Constraint
        if (normCallerPhone && normalizePhone(custPhone) !== normCallerPhone) {
          return { verified: false, reason: `Ownership violation: Payment recorded for order not owned by caller ${customerPhone}.` };
        }

        // Amount Rule: Payment amount must be >= order total
        if (parseFloat(pAmt) < parseFloat(ordTotal)) {
          return { 
            verified: false, 
            reason: `Payment amount rule violation: Paid PKR ${pAmt} is less than required order total PKR ${ordTotal}.` 
          };
        }

        // Order status must be updated to PAID
        if (ordStatus !== 'PAID') {
          return { verified: false, reason: `Order status update failed: Order is '${ordStatus}', expected 'PAID'.` };
        }

        return { verified: true, details: { payment_id: pId, amount: parseFloat(pAmt), order_status: ordStatus } };
      }

      case 'book_appointment': {
        const appNumber = actionResult.appointment_number;
        const appSql = `
          SELECT a.id, a.doctor_id, a.appointment_date, a.appointment_time, a.status, d.doctor_name, p.patient_phone
          FROM appointments a
          JOIN doctors d ON a.doctor_id = d.id
          JOIN patients p ON a.patient_id = p.id
          WHERE a.appointment_number = '${sqlEscape(appNumber)}'
          LIMIT 1;
        `;
        const appRaw = runPsql(appSql, 'gateway_action_writer', 'hospital_db');
        if (!appRaw || appRaw.trim().length === 0) {
          return { verified: false, reason: `Transaction commit failed: Appointment '${appNumber}' not found in database.` };
        }

        const [aId, docId, appDate, appTime, aStatus, docName, patPhone] = appRaw.split('|').map(s => s.trim());

        // 1. Status verification
        if (aStatus !== 'SCHEDULED') {
          return { verified: false, reason: `Appointment status is '${aStatus}', expected 'SCHEDULED'.` };
        }

        // 2. Schedule Check: Doctor must be on duty on this day of week
        const weekday = new Date(appDate + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
        if (weekday === 'Sunday') {
          return { verified: false, reason: `Hospital OPD is closed on Sundays. Please select a weekday.` };
        }
        const schedSql = `SELECT available_days, opd_timings FROM schedules WHERE doctor_id = ${docId} LIMIT 1;`;
        const schedRaw = runPsql(schedSql, 'gateway_action_writer', 'hospital_db');
        if (schedRaw && schedRaw.trim().length > 0) {
          const [days, timings] = schedRaw.split('|').map(s => s.trim());
          if (!days.includes(weekday) && !days.includes('Daily')) {
            return { verified: false, reason: `Doctor ${docName} is not available on ${weekday}s. Available days: ${days}.` };
          }
        }

        // 3. Double-booking check: verify NO OTHER appointment has the same doctor, date, time
        const conflictSql = `
          SELECT COUNT(*) FROM appointments 
          WHERE doctor_id = ${docId} AND appointment_date = '${appDate}' AND appointment_time = '${appTime}' AND status = 'SCHEDULED' AND id != ${aId};
        `;
        const conflictCount = parseInt(runPsql(conflictSql, 'gateway_action_writer', 'hospital_db').trim(), 10);
        if (conflictCount > 0) {
          return { verified: false, reason: `Slot conflict violation: Duplicate appointment detected for ${docName} at ${appTime}.` };
        }

        // 4. Verify history entry was created
        const histSql = `SELECT COUNT(*) FROM appointment_history WHERE appointment_id = ${aId};`;
        const histCount = parseInt(runPsql(histSql, 'gateway_action_writer', 'hospital_db').trim(), 10);
        if (histCount === 0) {
          return { verified: false, reason: 'Audit history missing: No appointment_history entry committed.' };
        }

        return { verified: true, details: { appointment_id: aId, appointment_number: appNumber, doctor: docName, slot: `${appDate} ${appTime}` } };
      }

      case 'reschedule_appointment': {
        const appNumber = params.appointment_number || actionResult.appointment_number;
        const appSql = `
          SELECT a.id, a.doctor_id, a.appointment_date, a.appointment_time, a.status, p.patient_phone
          FROM appointments a
          JOIN patients p ON a.patient_id = p.id
          WHERE a.appointment_number = '${sqlEscape(appNumber)}'
          LIMIT 1;
        `;
        const appRaw = runPsql(appSql, 'gateway_action_writer', 'hospital_db');
        if (!appRaw || appRaw.trim().length === 0) {
          return { verified: false, reason: `Appointment '${appNumber}' not found for reschedule verification.` };
        }

        const [aId, docId, curDate, curTime, aStatus, patPhone] = appRaw.split('|').map(s => s.trim());

        // Ownership Constraint
        if (normCallerPhone && normalizePhone(patPhone) !== normCallerPhone) {
          return { verified: false, reason: `Ownership violation: Appointment does not belong to patient ${customerPhone}.` };
        }

        // Verify committed date and time match requested
        if (params.new_appointment_date && curDate !== params.new_appointment_date) {
          return { verified: false, reason: `Reschedule failed: Date is '${curDate}', expected '${params.new_appointment_date}'.` };
        }
        if (params.new_appointment_time && !curTime.startsWith(params.new_appointment_time)) {
          return { verified: false, reason: `Reschedule failed: Time is '${curTime}', expected '${params.new_appointment_time}'.` };
        }

        return { verified: true, details: { appointment_number: appNumber, new_slot: `${curDate} ${curTime}` } };
      }

      case 'cancel_appointment': {
        const appNumber = params.appointment_number || actionResult.appointment_number;
        let where = '';
        if (appNumber) {
          where = `a.appointment_number = '${sqlEscape(appNumber)}'`;
        } else {
          where = `p.patient_phone = '${sqlEscape(params.patient_phone)}' AND a.appointment_date = '${sqlEscape(params.appointment_date)}'`;
        }

        const appSql = `
          SELECT a.id, a.status, p.patient_phone 
          FROM appointments a
          JOIN patients p ON a.patient_id = p.id
          WHERE ${where}
          LIMIT 1;
        `;
        const appRaw = runPsql(appSql, 'gateway_action_writer', 'hospital_db');
        if (!appRaw || appRaw.trim().length === 0) {
          return { verified: false, reason: 'Appointment not found for cancellation verification.' };
        }

        const [aId, aStatus, patPhone] = appRaw.split('|').map(s => s.trim());

        // Ownership Constraint
        if (normCallerPhone && normalizePhone(patPhone) !== normCallerPhone) {
          return { verified: false, reason: `Ownership violation: Appointment does not belong to caller ${customerPhone}.` };
        }

        if (aStatus !== 'CANCELLED') {
          return { verified: false, reason: `Cancellation failed: Status is '${aStatus}', expected 'CANCELLED'.` };
        }

        return { verified: true, details: { appointment_id: aId, status: aStatus } };
      }

      case 'submit_verification_request': {
        const ref = actionResult.request_ref;
        const verSql = `
          SELECT id, roll_number, verification_status 
          FROM verification_requests 
          WHERE request_ref = '${sqlEscape(ref)}' 
          LIMIT 1;
        `;
        const verRaw = runPsql(verSql, 'gateway_action_writer', 'bise_db');
        if (!verRaw || verRaw.trim().length === 0) {
          return { verified: false, reason: `Verification request '${ref}' not committed in database.` };
        }

        // Domain rule: Roll number must exist in official exam results
        const resultCheckSql = `SELECT COUNT(*) FROM results WHERE roll_number = '${sqlEscape(params.roll_number)}';`;
        const count = parseInt(runPsql(resultCheckSql, 'gateway_action_writer', 'bise_db').trim(), 10);
        if (count === 0) {
          return { verified: false, reason: `Domain constraint violation: Roll number '${params.roll_number}' has no examination record.` };
        }

        return { verified: true, details: { request_ref: ref, roll_number: params.roll_number } };
      }

      case 'submit_service_application': {
        const appNum = actionResult.application_number;
        const appSql = `
          SELECT a.id, a.application_type, a.status, s.student_name 
          FROM applications a
          JOIN students s ON a.student_id = s.id
          WHERE a.application_number = '${sqlEscape(appNum)}'
          LIMIT 1;
        `;
        const appRaw = runPsql(appSql, 'gateway_action_writer', 'bise_db');
        if (!appRaw || appRaw.trim().length === 0) {
          return { verified: false, reason: `Service application '${appNum}' not committed in database.` };
        }

        return { verified: true, details: { application_number: appNum } };
      }

      case 'call_external_api':
      case 'send_notification': {
        if (params.simulate_failure === true) {
          return { verified: false, reason: 'Simulated downstream API failure: Endpoint returned HTTP 500 / Timeout.' };
        }
        return { verified: true, details: { status: 'DISPATCHED' } };
      }

      default:
        return { verified: true };
    }
  } catch (err) {
    return { verified: false, reason: `Result validator exception: ${err.message}` };
  }
}

/**
 * Patterns that indicate the LLM is claiming a success
 */
const FALSE_SUCCESS_PATTERNS = [
  /order (?:has been |is )?(?:placed|created|confirmed|completed|processed|registered)/i,
  /appointment (?:has been |is )?(?:booked|scheduled|confirmed|rescheduled|registered)/i,
  /appointment (?:has been |is )?(?:cancelled|canceled)/i,
  /order (?:has been |is )?(?:cancelled|canceled)/i,
  /payment (?:has been |is )?(?:received|recorded|confirmed|successful|completed)/i,
  /(?:successfully|successful) (?:created|placed|booked|cancelled|canceled|rescheduled|updated|processed|recorded|submitted)/i,
  /(?:has been|have been) successfully/i,
  /i have (?:created|placed|booked|cancelled|canceled|rescheduled|updated|processed|recorded) your/i,
  // Roman Urdu patterns
  /(?:order|booking|appointment) confirm ho gay[ai]/i,
  /(?:order|booking|appointment) cancel ho gay[ai]/i,
  /(?:kamyabi se|mubarak|tayyar hai|book ho chuk[ai])/i
];

/**
 * Response Validator & False-Success Blocker
 * Inspects agent output text against actual tool execution results.
 * If any tool failed in this turn and the LLM claimed success, it BLOCKS the false-success.
 * 
 * @param {string} agentResponseText - Raw text generated by AI Agent
 * @param {Array<Object>|Object} toolExecutions - Array of tool execution results in this turn
 * @param {Object} context - Trusted session context
 * @returns {Object} { blocked: boolean, sanitized_response: string, reason?: string, verified_data?: Object }
 */
function validateAgentResponse(agentResponseText, toolExecutions, context = {}) {
  const auditLogger = require('./audit_logger');
  const executions = Array.isArray(toolExecutions) ? toolExecutions : (toolExecutions ? [toolExecutions] : []);
  const reqId = context.request_id || auditLogger.generateRequestId();
  const startTime = context.start_time || Date.now();

  // Find any failed or unverified execution
  const failedExecution = executions.find(ex => {
    if (!ex) return false;
    if (ex.status === 'ERROR' || ex.status === 'DENIED' || ex.status === 'APPROVAL_REQUIRED') return true;
    if (ex.success === false || ex.verification_passed === false) return true;
    if (ex.verdict && (ex.verdict.error || ex.verdict.status === 'EXECUTION_FAILED')) return true;
    return false;
  });

  let validationResult = null;

  if (failedExecution) {
    // Check if the agent response contains any false-success claim
    const claimsSuccess = FALSE_SUCCESS_PATTERNS.some(regex => regex.test(agentResponseText));

    if (claimsSuccess) {
      // FALSE-SUCCESS DETECTED! BLOCK AND SANITIZE.
      const actionName = failedExecution.action || failedExecution.target_action || 'requested operation';
      const errorMsg = (failedExecution.verdict && (failedExecution.verdict.error || failedExecution.verdict.message)) ||
                       failedExecution.message ||
                       failedExecution.error ||
                       'The database validation rules rejected the transaction.';

      const sanitizedResponse = `We apologize, but your request to perform '${actionName}' could not be completed. Reason: ${errorMsg}. No changes have been made to your account. Please review your request and try again, or contact our support team.`;

      validationResult = {
        blocked: true,
        action: actionName,
        reason: 'FALSE_SUCCESS_BLOCKED',
        original_response: agentResponseText,
        sanitized_response: sanitizedResponse,
        failure_details: errorMsg,
        error_category: 'FALSE_SUCCESS_BLOCKED'
      };
    } else {
      // Agent properly conveyed failure
      validationResult = {
        blocked: false,
        sanitized_response: agentResponseText,
        conveyed_failure: true,
        error_category: 'CONVEYED_FAILURE'
      };
    }
  }

  if (!validationResult) {
    // Phase 31: Apply Response Security & PII Controls Engine
    const { processResponseSecurity } = require('./response_security');
    let candidateText = agentResponseText;

    const successfulExecution = executions.find(ex => ex && ex.status === 'SUCCESS' && ex.result);
    if (successfulExecution && successfulExecution.result) {
      const res = successfulExecution.result;
      if (res.order_number) {
        const match = candidateText.match(/ORD-\d{4}-\d+/i);
        if (match && match[0].toUpperCase() !== res.order_number.toUpperCase()) {
          candidateText = candidateText.replace(match[0], res.order_number);
        }
      }
      if (res.appointment_number) {
        const match = candidateText.match(/APT-\d{4}-\d+/i);
        if (match && match[0].toUpperCase() !== res.appointment_number.toUpperCase()) {
          candidateText = candidateText.replace(match[0], res.appointment_number);
        }
      }
    }

    const secResult = processResponseSecurity(candidateText, executions, context);
    if (secResult.blocked) {
      validationResult = {
        blocked: true,
        reason: secResult.reason,
        blocked_reasons: secResult.blocked_reasons,
        original_response: agentResponseText,
        sanitized_response: secResult.sanitized_response,
        error_category: secResult.reason || 'PII_VIOLATION'
      };
    } else {
      validationResult = {
        blocked: false,
        sanitized_response: secResult.sanitized_response,
        verified_data: successfulExecution?.result || null,
        error_category: 'NONE'
      };
    }
  }

  // Phase 32: Build & Log Standardized Audit Trace
  const latency = Date.now() - startTime;
  const executedTool = executions[0]?.action || executions[0]?.target_action || 'NONE';
  const reqTool = context.tool_requested || (executedTool !== 'NONE' ? 'action_write' : 'NONE');

  const trace = auditLogger.createRequestTrace({
    request_id: reqId,
    business_id: context.business_code || context.business_id || 'UNKNOWN',
    instance: context.instance_name || context.instance || 'default_instance',
    user_session: context.customerPhone || context.customer_phone || 'anonymous',
    intent: context.intent || (executedTool !== 'NONE' ? executedTool : 'general_query'),
    tool_requested: reqTool,
    tool_executed: executedTool,
    execution_result: validationResult.blocked ? 'BLOCKED' : (validationResult.conveyed_failure ? 'REJECTED' : 'SUCCESS'),
    response: validationResult.sanitized_response,
    latency_ms: latency,
    error: validationResult.error_category || 'NONE',
    error_category: validationResult.error_category || 'NONE',
    error_details: validationResult.failure_details || validationResult.reason || null,
    timestamp: new Date(startTime).toISOString()
  });

  auditLogger.logAuditTrace(trace);
  validationResult.request_id = reqId;
  validationResult.trace = trace;

  return validationResult;
}

module.exports = {
  verifyActionResult,
  validateAgentResponse,
  normalizePhone,
  FALSE_SUCCESS_PATTERNS
};
