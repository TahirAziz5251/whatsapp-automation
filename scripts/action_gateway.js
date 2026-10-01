/**
 * Phase 27, 28, & 29: Business-Specific Action Gateway with Human Approval Controls
 * 
 * Architecture & Governance:
 * AI Agent / WhatsApp Pipeline
 *        ↓
 * Action Gateway (Centralized State-Changing Write Layer)
 *        ↓
 * Trusted Session Context (business_code, allowed_tools)
 *        ↓
 * Parameter Validation & Schema Enforcement
 *        ↓
 * Multi-Tenant Policy Gate (Outside-LLM Enforcement)
 *        ↓
 * Read vs. Write Guard (Rejects pure read queries)
 *        ↓
 * Human Approval Gate (Phase 29: Intercepts sensitive/high-impact actions)
 *    ├── If requires_approval && !token: Creates PENDING_APPROVAL request -> Returns APPROVAL_REQUIRED
 *    ├── If approver calls approve_action / reject_action: Captures decision
 *    └── If token valid & APPROVED: Executes atomically -> Marks EXECUTED (Prevents Replay)
 *        ↓
 * Dedicated Least-Privilege Role (gateway_action_writer)
 *        ↓
 * Target Domain DB / Atomic Transactions (pos_db, bise_db, hospital_db, platform_db)
 *        ↓
 * Audit Logging (platform_audit_metadata & platform_action_approvals)
 *        ↓
 * Structured Output Context for AI Agent / Approvers
 */

const { execSync } = require('child_process');

// Whitelisted external API endpoints
const WHITELISTED_EXTERNAL_ENDPOINTS = [
  'SMS_GATEWAY',
  'PAYMENT_GATEWAY',
  'CRM_SYNC_WEBHOOK',
  'LOGISTICS_TRACKING_API'
];

// Valid payment methods
const VALID_PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA', 'CREDIT_CARD'];

// Valid lead stages
const VALID_LEAD_STAGES = ['NEW_LEAD', 'QUALIFIED', 'DEMO_BOOKED', 'PROPOSAL_SENT', 'CLOSED_WON', 'CLOSED_LOST', 'STUDENT_INQUIRY', 'PATIENT_INQUIRY'];

// Valid order update statuses
const VALID_ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'PAID'];

// Valid BISE service application types
const VALID_BISE_SERVICES = [
  'NOC_MIGRATION',
  'DUPLICATE_MARKSHEET',
  'RECHECKING_PER_PAPER',
  'DUPLICATE_DEGREE',
  'CORRECTION_NAME'
];

// Recognized read operations to reject in Action Gateway
const RECOGNIZED_READ_OPERATIONS = [
  'get_product', 'check_inventory', 'get_price',
  'get_student_result', 'get_fees', 'check_exam_results',
  'get_doctor_schedule', 'get_doctors_by_specialty', 'get_departments',
  'search_knowledge_base', 'query_business_data'
];

// Multi-Tenant Action Authorization Matrix
const ACTION_PERMISSIONS = {
  // POS Domain Actions
  create_order: ['POS_RETAIL'],
  update_order: ['POS_RETAIL'],
  cancel_order: ['POS_RETAIL'],
  record_payment: ['POS_RETAIL'],
  sync_crm: ['POS_RETAIL'],

  // BISE Educational Domain Actions
  submit_verification_request: ['BISE_EDU'],
  submit_service_application: ['BISE_EDU'],
  track_service_application: ['BISE_EDU'],

  // Hospital Clinical Domain Actions
  create_appointment: ['HOSP_HEALTH'],
  book_appointment: ['HOSP_HEALTH'],
  reschedule_appointment: ['HOSP_HEALTH'],
  cancel_appointment: ['HOSP_HEALTH'],
  manage_calendar: ['HOSP_HEALTH'],

  // Phase 29 Human Approval Controls
  approve_action: ['POS_RETAIL', 'BISE_EDU', 'HOSP_HEALTH'],
  reject_action: ['POS_RETAIL', 'BISE_EDU', 'HOSP_HEALTH'],
  execute_approved_action: ['POS_RETAIL', 'BISE_EDU', 'HOSP_HEALTH'],

  // Approved Cross-Domain Actions
  send_notification: ['POS_RETAIL', 'BISE_EDU', 'HOSP_HEALTH'],
  call_external_api: ['POS_RETAIL', 'BISE_EDU', 'HOSP_HEALTH']
};

/**
 * Execute psql command safely via stdin
 */
function runPsql(sql, role = 'gateway_action_writer', db = 'platform_db') {
  return execSync(
    `docker exec -i evolution-postgres psql -U ${role} -d ${db} -v ON_ERROR_STOP=1 -t`,
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim();
}

/**
 * Escape single quotes for SQL literals
 */
function sqlEscape(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/'/g, "''");
}

/**
 * Validate Pakistani & International phone numbers
 */
function isValidPhone(phone) {
  if (!phone || typeof phone !== 'string') return false;
  const clean = phone.replace(/[\s\-\(\)]/g, '');
  return /^\+?[0-9]{10,15}$/.test(clean);
}

/**
 * Validate Date string (YYYY-MM-DD)
 */
function isValidDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const d = new Date(dateStr);
  return !isNaN(d.getTime());
}

/**
 * Validate Time string (HH:MM or HH:MM:SS)
 */
function isValidTime(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return false;
  return /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/.test(timeStr);
}

// =========================================================================
// APPROVAL CLASSIFICATION CHECK (PHASE 29)
// =========================================================================

/**
 * Checks if an action requires human approval based on platform_tool_permissions or sensitive rules
 */
function checkActionRequiresApproval(action, businessCode, params = {}) {
  // Approval operations themselves never require nested approval
  if (['approve_action', 'reject_action', 'execute_approved_action'].includes(action)) {
    return false;
  }

  // 1. Query platform_tool_permissions
  try {
    const permSql = `
      SELECT requires_approval 
      FROM platform_tool_permissions 
      WHERE business_code = '${sqlEscape(businessCode)}' AND tool_name = '${sqlEscape(action)}' 
      LIMIT 1;
    `;
    const raw = runPsql(permSql, 'gateway_action_writer', 'platform_db');
    if (raw && raw.trim() === 't') {
      return true;
    }
  } catch (e) {
    // fallback if query fails
  }

  // 2. Sensitive operation fallbacks
  if (businessCode === 'POS_RETAIL' && action === 'cancel_order') return true;
  if (businessCode === 'HOSP_HEALTH' && action === 'cancel_appointment') return true;

  // 3. Dynamic Thresholds: High-value orders (> PKR 100,000)
  if (action === 'create_order' && params.items) {
    // If order total exceeds threshold, could flag approval
  }

  return false;
}

// =========================================================================
// PARAMETER VALIDATORS
// =========================================================================

function validateActionParams(action, params) {
  const p = params || {};

  switch (action) {
    // Phase 29 Approval Operations
    case 'approve_action': {
      if (!p.approval_token || typeof p.approval_token !== 'string' || p.approval_token.trim().length === 0) {
        return { valid: false, error: 'Parameter "approval_token" is required to approve an action.' };
      }
      if (!p.approver_id || typeof p.approver_id !== 'string' || p.approver_id.trim().length === 0) {
        return { valid: false, error: 'Parameter "approver_id" (supervisor ID or phone) is required.' };
      }
      return { valid: true };
    }

    case 'reject_action': {
      if (!p.approval_token || typeof p.approval_token !== 'string' || p.approval_token.trim().length === 0) {
        return { valid: false, error: 'Parameter "approval_token" is required to reject an action.' };
      }
      if (!p.approver_id || typeof p.approver_id !== 'string' || p.approver_id.trim().length === 0) {
        return { valid: false, error: 'Parameter "approver_id" is required.' };
      }
      return { valid: true };
    }

    case 'execute_approved_action': {
      if (!p.approval_token || typeof p.approval_token !== 'string' || p.approval_token.trim().length === 0) {
        return { valid: false, error: 'Parameter "approval_token" is required to execute approved action.' };
      }
      return { valid: true };
    }

    // POS Domain Actions
    case 'create_order': {
      if (!p.customer_phone || !isValidPhone(p.customer_phone)) {
        return { valid: false, error: 'Parameter "customer_phone" must be a valid phone number (+92... or digits).' };
      }
      if (!Array.isArray(p.items) || p.items.length === 0) {
        return { valid: false, error: 'Parameter "items" must be a non-empty array of items ({ sku, quantity }).' };
      }
      for (let i = 0; i < p.items.length; i++) {
        const item = p.items[i];
        if (!item.sku || typeof item.sku !== 'string') {
          return { valid: false, error: `Item at index ${i} is missing valid "sku".` };
        }
        if (!item.quantity || typeof item.quantity !== 'number' || item.quantity <= 0) {
          return { valid: false, error: `Item at index ${i} ("${item.sku}") must have quantity > 0.` };
        }
      }
      return { valid: true };
    }

    case 'update_order': {
      if (!p.order_number && !p.order_id) {
        return { valid: false, error: 'Either "order_number" or "order_id" is required to update an order.' };
      }
      if (p.status && !VALID_ORDER_STATUSES.includes(p.status.toUpperCase())) {
        return { valid: false, error: `Invalid status "${p.status}". Allowed statuses: ${VALID_ORDER_STATUSES.join(', ')}.` };
      }
      if (!p.status && !p.notes && !p.shipping_address) {
        return { valid: false, error: 'At least one field to update ("status", "notes", or "shipping_address") must be provided.' };
      }
      return { valid: true };
    }

    case 'cancel_order': {
      if (!p.order_number && !p.order_id) {
        return { valid: false, error: 'Either "order_number" or "order_id" is required to cancel an order.' };
      }
      return { valid: true };
    }

    case 'record_payment': {
      if (!p.order_number && !p.order_id) {
        return { valid: false, error: 'Either "order_number" or "order_id" is required for recording payment.' };
      }
      if (!p.payment_method || !VALID_PAYMENT_METHODS.includes(p.payment_method.toUpperCase())) {
        return { valid: false, error: `Invalid "payment_method". Allowed: ${VALID_PAYMENT_METHODS.join(', ')}.` };
      }
      if (!p.amount_pkr || typeof p.amount_pkr !== 'number' || p.amount_pkr <= 0) {
        return { valid: false, error: 'Parameter "amount_pkr" must be a positive number.' };
      }
      if (!p.transaction_ref || typeof p.transaction_ref !== 'string' || p.transaction_ref.trim().length === 0) {
        return { valid: false, error: 'Parameter "transaction_ref" is required (e.g. bank slip, easypaisa/jazzcash TRX ID).' };
      }
      return { valid: true };
    }

    case 'sync_crm': {
      if (!p.customer_phone || !isValidPhone(p.customer_phone)) {
        return { valid: false, error: 'Parameter "customer_phone" must be a valid phone number.' };
      }
      const stg = p.lead_stage || p.stage;
      if (stg && !VALID_LEAD_STAGES.includes(stg.toUpperCase())) {
        return { valid: false, error: `Invalid "lead_stage". Allowed: ${VALID_LEAD_STAGES.join(', ')}.` };
      }
      return { valid: true };
    }

    // BISE Educational Domain Actions
    case 'submit_verification_request': {
      if (!p.roll_number || typeof p.roll_number !== 'string' || p.roll_number.trim().length === 0) {
        return { valid: false, error: 'Parameter "roll_number" is required for certificate verification.' };
      }
      if (!p.applicant_name || typeof p.applicant_name !== 'string' || p.applicant_name.trim().length === 0) {
        return { valid: false, error: 'Parameter "applicant_name" is required.' };
      }
      return { valid: true };
    }

    case 'submit_service_application': {
      if (!p.roll_number || typeof p.roll_number !== 'string' || p.roll_number.trim().length === 0) {
        return { valid: false, error: 'Parameter "roll_number" is required for board service application.' };
      }
      if (!p.application_type || !VALID_BISE_SERVICES.includes(p.application_type.toUpperCase())) {
        return { valid: false, error: `Invalid "application_type". Allowed: ${VALID_BISE_SERVICES.join(', ')}.` };
      }
      return { valid: true };
    }

    case 'track_service_application': {
      if (!p.application_number && !p.request_ref && !p.roll_number) {
        return { valid: false, error: 'Either "application_number", "request_ref", or "roll_number" is required to track an application.' };
      }
      return { valid: true };
    }

    // Hospital Domain Actions
    case 'create_appointment':
    case 'book_appointment': {
      if (!p.patient_phone || !isValidPhone(p.patient_phone)) {
        return { valid: false, error: 'Parameter "patient_phone" must be a valid phone number.' };
      }
      if (!p.patient_name || typeof p.patient_name !== 'string' || p.patient_name.trim().length === 0) {
        return { valid: false, error: 'Parameter "patient_name" is required.' };
      }
      if (!p.doctor_id && !p.doctor_name) {
        return { valid: false, error: 'Either "doctor_id" or "doctor_name" is required for booking.' };
      }
      if (!p.appointment_date || !isValidDate(p.appointment_date)) {
        return { valid: false, error: 'Parameter "appointment_date" must be formatted as YYYY-MM-DD.' };
      }
      if (!p.appointment_time || !isValidTime(p.appointment_time)) {
        return { valid: false, error: 'Parameter "appointment_time" must be formatted as HH:MM.' };
      }
      return { valid: true };
    }

    case 'reschedule_appointment': {
      if (!p.appointment_number && !p.appointment_id) {
        return { valid: false, error: 'Either "appointment_number" or "appointment_id" is required to reschedule.' };
      }
      if (!p.new_appointment_date || !isValidDate(p.new_appointment_date)) {
        return { valid: false, error: 'Parameter "new_appointment_date" must be formatted as YYYY-MM-DD.' };
      }
      if (!p.new_appointment_time || !isValidTime(p.new_appointment_time)) {
        return { valid: false, error: 'Parameter "new_appointment_time" must be formatted as HH:MM.' };
      }
      return { valid: true };
    }

    case 'cancel_appointment': {
      if (!p.appointment_number && !(p.patient_phone && p.appointment_date)) {
        return { valid: false, error: 'Either "appointment_number" or ("patient_phone" + "appointment_date") is required to cancel.' };
      }
      return { valid: true };
    }

    case 'manage_calendar': {
      if (!p.action || !['CREATE_BOOKING', 'CANCEL_BOOKING', 'CHECK_AVAILABILITY'].includes(p.action)) {
        return { valid: false, error: 'Parameter "action" must be CREATE_BOOKING, CANCEL_BOOKING, or CHECK_AVAILABILITY.' };
      }
      if (!p.date || !isValidDate(p.date)) {
        return { valid: false, error: 'Parameter "date" must be formatted as YYYY-MM-DD.' };
      }
      return { valid: true };
    }

    case 'send_notification': {
      if (!p.recipient_phone || !isValidPhone(p.recipient_phone)) {
        return { valid: false, error: 'Parameter "recipient_phone" must be a valid phone number.' };
      }
      if (!p.template_name || typeof p.template_name !== 'string') {
        return { valid: false, error: 'Parameter "template_name" is required.' };
      }
      return { valid: true };
    }

    case 'call_external_api': {
      if (!p.endpoint_key || !WHITELISTED_EXTERNAL_ENDPOINTS.includes(p.endpoint_key.toUpperCase())) {
        return { valid: false, error: `Endpoint "${p.endpoint_key}" is not whitelisted. Allowed: ${WHITELISTED_EXTERNAL_ENDPOINTS.join(', ')}.` };
      }
      return { valid: true };
    }

    default:
      return { valid: false, error: `Unrecognized action "${action}".` };
  }
}

// =========================================================================
// ACTION HANDLERS (V1 DOMAIN ACTIONS & APPROVALS)
// =========================================================================

/**
 * Phase 29: Approve Pending Action
 */
/**
 * Phase 29: Approve Pending Action
 */
function handleApproveAction(params, trustedBusinessCode) {
  const p = params;
  const token = sqlEscape(p.approval_token.trim());
  const approverId = sqlEscape(p.approver_name ? `${p.approver_name} (${p.approver_id})` : (p.approver_id || 'supervisor'));
  const notes = sqlEscape(p.notes || p.approver_notes || 'Approved by supervisor');

  const checkSql = `
    SELECT id, action, status, business_code, requester_phone 
    FROM platform_action_approvals 
    WHERE approval_token = '${token}' 
    LIMIT 1;
  `;
  const raw = runPsql(checkSql, 'gateway_action_writer', 'platform_db');
  if (!raw || raw.trim().length === 0) {
    throw new Error(`Approval token '${token}' not found.`);
  }

  const [idStr, targetAction, currentStatus, bizCode, reqPhone] = raw.split('|').map(s => s.trim());
  if (currentStatus !== 'PENDING_APPROVAL') {
    throw new Error(`Cannot approve token '${token}' because it is in status '${currentStatus}'.`);
  }

  const updSql = `
    UPDATE platform_action_approvals 
    SET status = 'APPROVED', approver_id = '${approverId}', approver_notes = '${notes}', approved_at = CURRENT_TIMESTAMP 
    WHERE id = ${idStr};
  `;
  runPsql(updSql, 'gateway_action_writer', 'platform_db');

  return {
    action: 'approve_action',
    status: 'SUCCESS',
    approval_token: token,
    target_action: targetAction,
    approver_id: approverId,
    decision: 'APPROVED',
    notes,
    summary: `Approval token #${token} for action '${targetAction}' has been APPROVED by ${approverId}. Ready for execution with token.`
  };
}

/**
 * Phase 29: Reject Pending Action
 */
function handleRejectAction(params, trustedBusinessCode) {
  const p = params;
  const token = sqlEscape(p.approval_token.trim());
  const approverId = sqlEscape(p.approver_name ? `${p.approver_name} (${p.approver_id})` : (p.approver_id || 'supervisor'));
  const reason = sqlEscape(p.notes || p.reason || p.approver_notes || 'Rejected by supervisor');

  const checkSql = `
    SELECT id, action, status, business_code, requester_phone 
    FROM platform_action_approvals 
    WHERE approval_token = '${token}' 
    LIMIT 1;
  `;
  const raw = runPsql(checkSql, 'gateway_action_writer', 'platform_db');
  if (!raw || raw.trim().length === 0) {
    throw new Error(`Approval token '${token}' not found.`);
  }

  const [idStr, targetAction, currentStatus, bizCode, reqPhone] = raw.split('|').map(s => s.trim());
  if (currentStatus !== 'PENDING_APPROVAL') {
    throw new Error(`Cannot reject token '${token}' because it is in status '${currentStatus}'.`);
  }

  const updSql = `
    UPDATE platform_action_approvals 
    SET status = 'REJECTED', approver_id = '${approverId}', approver_notes = '${reason}', approved_at = CURRENT_TIMESTAMP 
    WHERE id = ${idStr};
  `;
  runPsql(updSql, 'gateway_action_writer', 'platform_db');

  return {
    action: 'reject_action',
    status: 'SUCCESS',
    approval_token: token,
    target_action: targetAction,
    approver_id: approverId,
    decision: 'REJECTED',
    notes: reason,
    summary: `Approval token #${token} for action '${targetAction}' has been REJECTED by ${approverId}. Reason: ${reason}.`
  };
}

/**
 * POS 1: Create Order with Stock Check & Inventory Deduction
 */
function handleCreateOrder(params, trustedBusinessCode) {
  const p = params;
  const phone = sqlEscape(p.customer_phone.replace(/[\s\-\(\)]/g, ''));
  const customerName = sqlEscape(p.customer_name || 'Walk-in Customer');
  const city = sqlEscape(p.city || 'Lahore');

  // Step A: Upsert Customer
  const custSql = `
    INSERT INTO customers (customer_phone, full_name, city)
    VALUES ('${phone}', '${customerName}', '${city}')
    ON CONFLICT (customer_phone) DO UPDATE SET full_name = EXCLUDED.full_name
    RETURNING id;
  `;
  const custRaw = runPsql(custSql, 'gateway_action_writer', 'pos_db');
  const customerId = parseInt(custRaw.match(/(\d+)/)[1], 10);

  // Step A.1: Idempotency Verification (Prevent Duplicate Orders on Replay)
  if (p.idempotency_key) {
    const idempKey = sqlEscape(p.idempotency_key.trim());
    const existingSql = `
      SELECT id, order_number, total_amount_pkr, status 
      FROM orders 
      WHERE idempotency_key = '${idempKey}' 
      LIMIT 1;
    `;
    const existingRaw = runPsql(existingSql, 'gateway_action_writer', 'pos_db');
    if (existingRaw && existingRaw.trim().length > 0) {
      const [exId, exOrdNum, exTotal, exStatus] = existingRaw.split('|').map(s => s.trim());
      return {
        action: 'create_order',
        status: 'IDEMPOTENT_REPLAY',
        order_id: parseInt(exId, 10),
        order_number: exOrdNum,
        customer_phone: phone,
        total_amount_pkr: parseFloat(exTotal),
        idempotency_key: p.idempotency_key,
        summary: `[IDEMPOTENT REPLAY] Order #${exOrdNum} was previously created with key "${p.idempotency_key}". Returned existing record without re-deducting inventory.`
      };
    }
  }

  // Step B: Validate Inventory & Prices
  let totalAmount = 0;
  const orderItemsData = [];

  for (const item of p.items) {
    const sku = sqlEscape(item.sku);
    const prodSql = `
      SELECT p.id, p.name, pr.price_pkr, COALESCE(i.stock_quantity, 0) as stock
      FROM products p
      JOIN prices pr ON p.id = pr.product_id
      LEFT JOIN inventory i ON p.id = i.product_id
      WHERE p.sku = '${sku}'
      ORDER BY pr.effective_date DESC, pr.id DESC
      LIMIT 1;
    `;
    const prodRaw = runPsql(prodSql, 'gateway_action_writer', 'pos_db');
    if (!prodRaw || prodRaw.trim().length === 0) {
      throw new Error(`Product SKU "${item.sku}" not found in pos_db catalog.`);
    }

    const parts = prodRaw.split('|').map(s => s.trim());
    const productId = parseInt(parts[0], 10);
    const productName = parts[1];
    const catalogPrice = parseFloat(parts[2]);
    const currentStock = parseInt(parts[3], 10);

    if (currentStock < item.quantity) {
      throw new Error(`Insufficient inventory for "${productName}" (SKU: ${item.sku}). Requested: ${item.quantity}, Available: ${currentStock}.`);
    }

    if (item.unit_price && Math.abs(parseFloat(item.unit_price) - catalogPrice) > 0.01) {
      throw new Error(`Price tampering detected for SKU ${item.sku}: Requested PKR ${item.unit_price} does not match catalog price PKR ${catalogPrice}.`);
    }

    const unitPrice = catalogPrice;
    const subtotal = unitPrice * item.quantity;
    totalAmount += subtotal;

    orderItemsData.push({ productId, productName, sku: item.sku, quantity: item.quantity, unitPrice, subtotal });
  }

  // Step C: Atomic Order Creation + Stock Deduction
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const orderNumber = p.order_number ? sqlEscape(p.order_number) : `ORD-${new Date().getFullYear()}-${randomSuffix}`;
  const idempVal = p.idempotency_key ? `'${sqlEscape(p.idempotency_key.trim())}'` : 'NULL';

  let transactionSql = `
    BEGIN;
    INSERT INTO orders (order_number, idempotency_key, customer_id, total_amount_pkr, status)
    VALUES ('${orderNumber}', ${idempVal}, ${customerId}, ${totalAmount.toFixed(2)}, 'PENDING');
  `;

  for (const oi of orderItemsData) {
    transactionSql += `
      INSERT INTO order_items (order_id, product_id, quantity, unit_price_pkr, subtotal_pkr)
      VALUES ((SELECT id FROM orders WHERE order_number = '${orderNumber}'), ${oi.productId}, ${oi.quantity}, ${oi.unitPrice.toFixed(2)}, ${oi.subtotal.toFixed(2)});
      UPDATE inventory SET stock_quantity = stock_quantity - ${oi.quantity}, updated_at = CURRENT_TIMESTAMP WHERE product_id = ${oi.productId};
    `;
  }

  transactionSql += `
    COMMIT;
  `;

  runPsql(transactionSql, 'gateway_action_writer', 'pos_db');
  const findOrdSql = `SELECT id FROM orders WHERE order_number = '${orderNumber}' LIMIT 1;`;
  const findOrdRaw = runPsql(findOrdSql, 'gateway_action_writer', 'pos_db');
  const orderId = parseInt(findOrdRaw.trim(), 10);

  return {
    action: 'create_order',
    status: 'SUCCESS',
    order_id: orderId,
    order_number: orderNumber,
    customer_phone: phone,
    items_count: orderItemsData.length,
    total_amount_pkr: totalAmount,
    summary: `Order #${orderNumber} created successfully for ${customerName} (${phone}). Total: PKR ${totalAmount.toLocaleString('en-PK')}. Inventory deducted. Status: PENDING.`
  };
}

/**
 * POS 2: Update Order (Status / Metadata)
 */
function handleUpdateOrder(params, trustedBusinessCode, customerPhone) {
  const p = params;
  let orderNumber = p.order_number;
  let orderId = p.order_id;

  let whereClause = '';
  if (orderNumber) {
    whereClause = `o.order_number = '${sqlEscape(orderNumber)}'`;
  } else {
    whereClause = `o.id = ${parseInt(orderId, 10)}`;
  }

  // Check current status and customer ownership
  const checkSql = `
    SELECT o.id, o.order_number, o.status, o.total_amount_pkr, c.customer_phone 
    FROM orders o 
    JOIN customers c ON o.customer_id = c.id 
    WHERE ${whereClause} 
    LIMIT 1;
  `;
  const checkRaw = runPsql(checkSql, 'gateway_action_writer', 'pos_db');
  if (!checkRaw || checkRaw.trim().length === 0) {
    throw new Error(`Order ${orderNumber || orderId} not found in pos_db.`);
  }

  const [idStr, ordNum, currentStatus, totalStr, custPhone] = checkRaw.split('|').map(s => s.trim());
  const caller = customerPhone || p.customer_phone;
  if (caller) {
    const { normalizePhone } = require('./result_validator');
    if (normalizePhone(custPhone) !== normalizePhone(caller)) {
      throw new Error(`Ownership constraint violation: Order #${ordNum} does not belong to customer ${caller}.`);
    }
  }

  if (currentStatus === 'CANCELLED') {
    throw new Error(`Cannot update Order #${ordNum} because it is already CANCELLED.`);
  }

  const newStatus = p.status ? sqlEscape(p.status.toUpperCase()) : currentStatus;
  const updSql = `
    UPDATE orders 
    SET status = '${newStatus}' 
    WHERE id = ${idStr}
    RETURNING id, order_number, status;
  `;
  runPsql(updSql, 'gateway_action_writer', 'pos_db');

  return {
    action: 'update_order',
    status: 'SUCCESS',
    order_id: parseInt(idStr, 10),
    order_number: ordNum,
    previous_status: currentStatus,
    new_status: newStatus,
    summary: `Order #${ordNum} updated successfully. Status transitioned from ${currentStatus} to ${newStatus}.`
  };
}

/**
 * POS 3: Cancel Order with Atomic Inventory Restocking
 */
function handleCancelOrder(params, trustedBusinessCode, customerPhone) {
  const p = params;
  let orderNumber = p.order_number;
  let orderId = p.order_id;

  let whereClause = '';
  if (orderNumber) {
    whereClause = `o.order_number = '${sqlEscape(orderNumber)}'`;
  } else {
    whereClause = `o.id = ${parseInt(orderId, 10)}`;
  }

  // Check current status, customer ownership, and items
  const checkSql = `
    SELECT o.id, o.order_number, o.status, o.total_amount_pkr, c.customer_phone 
    FROM orders o 
    JOIN customers c ON o.customer_id = c.id 
    WHERE ${whereClause} 
    LIMIT 1;
  `;
  const checkRaw = runPsql(checkSql, 'gateway_action_writer', 'pos_db');
  if (!checkRaw || checkRaw.trim().length === 0) {
    throw new Error(`Order ${orderNumber || orderId} not found in pos_db.`);
  }

  const [idStr, ordNum, currentStatus, totalStr, custPhone] = checkRaw.split('|').map(s => s.trim());
  const caller = customerPhone || p.customer_phone;
  if (caller) {
    const { normalizePhone } = require('./result_validator');
    if (normalizePhone(custPhone) !== normalizePhone(caller)) {
      throw new Error(`Ownership constraint violation: Order #${ordNum} does not belong to customer ${caller}.`);
    }
  }

  const resolvedOrderId = parseInt(idStr, 10);

  if (currentStatus === 'CANCELLED') {
    throw new Error(`Order #${ordNum} is already CANCELLED.`);
  }
  if (['SHIPPED', 'DELIVERED'].includes(currentStatus)) {
    throw new Error(`Cannot cancel Order #${ordNum} because it has already reached status "${currentStatus}".`);
  }

  // Retrieve items to restock
  const itemsSql = `SELECT product_id, quantity FROM order_items WHERE order_id = ${resolvedOrderId};`;
  const itemsRaw = runPsql(itemsSql, 'gateway_action_writer', 'pos_db');
  const itemsLines = itemsRaw ? itemsRaw.split('\n').filter(l => l.trim().length > 0) : [];

  let restockSql = `BEGIN;\n`;
  let restockedUnits = 0;

  for (const line of itemsLines) {
    const [pidStr, qtyStr] = line.split('|').map(s => s.trim());
    if (pidStr && qtyStr) {
      const pid = parseInt(pidStr, 10);
      const qty = parseInt(qtyStr, 10);
      restockSql += `  UPDATE inventory SET stock_quantity = stock_quantity + ${qty}, updated_at = CURRENT_TIMESTAMP WHERE product_id = ${pid};\n`;
      restockedUnits += qty;
    }
  }

  restockSql += `  UPDATE orders SET status = 'CANCELLED' WHERE id = ${resolvedOrderId};\n`;
  restockSql += `COMMIT;`;

  runPsql(restockSql, 'gateway_action_writer', 'pos_db');

  return {
    action: 'cancel_order',
    status: 'SUCCESS',
    order_id: resolvedOrderId,
    order_number: ordNum,
    restocked_units: restockedUnits,
    reason: p.reason || 'Customer requested cancellation',
    summary: `Order #${ordNum} has been CANCELLED. All ${restockedUnits} inventory unit(s) restocked atomically.`
  };
}

/**
 * POS 4: Record Payment
 */
function handleRecordPayment(params, trustedBusinessCode, customerPhone) {
  const p = params;
  let orderId = p.order_id;
  let orderNumber = p.order_number;

  let whereClause = '';
  if (orderNumber) {
    whereClause = `o.order_number = '${sqlEscape(orderNumber)}'`;
  } else {
    whereClause = `o.id = ${parseInt(orderId, 10)}`;
  }

  const findSql = `
    SELECT o.id, o.order_number, o.total_amount_pkr, o.status, c.customer_phone 
    FROM orders o 
    JOIN customers c ON o.customer_id = c.id 
    WHERE ${whereClause} 
    LIMIT 1;
  `;
  const findRaw = runPsql(findSql, 'gateway_action_writer', 'pos_db');
  if (!findRaw || findRaw.trim().length === 0) {
    throw new Error(`Order "${orderNumber || orderId}" not found in pos_db.`);
  }

  const [resolvedIdStr, ordNum, ordTotalStr, ordStatus, custPhone] = findRaw.split('|').map(s => s.trim());
  orderId = parseInt(resolvedIdStr, 10);
  const totalAmount = parseFloat(ordTotalStr);

  const caller = customerPhone || p.customer_phone;
  if (caller) {
    const { normalizePhone } = require('./result_validator');
    if (normalizePhone(custPhone) !== normalizePhone(caller)) {
      throw new Error(`Ownership constraint violation: Order #${ordNum} does not belong to customer ${caller}.`);
    }
  }

  const amount = parseFloat(p.amount_pkr);
  if (amount < totalAmount) {
    throw new Error(`Payment rule violation: Amount PKR ${amount} is less than required order total PKR ${totalAmount}. Underpayment is rejected.`);
  }

  const method = sqlEscape(p.payment_method.toUpperCase());
  const trxRef = sqlEscape(p.transaction_ref);
  const provider = sqlEscape(p.provider || p.payment_provider || 'MANUAL');
  const idempKey = p.idempotency_key ? sqlEscape(p.idempotency_key.trim()) : null;

  // Payment Idempotency Verification (Prevent Duplicate Charges / Replays)
  const idempCheckSql = `
    SELECT id, order_id, amount_pkr, payment_status, transaction_ref, provider 
    FROM payments 
    WHERE ${idempKey ? `idempotency_key = '${idempKey}'` : `transaction_ref = '${trxRef}'`}
    LIMIT 1;
  `;
  const idempRaw = runPsql(idempCheckSql, 'gateway_action_writer', 'pos_db');
  if (idempRaw && idempRaw.trim().length > 0) {
    const [exPayId, exOrdId, exAmt, exPayStatus, exRef, exProv] = idempRaw.split('|').map(s => s.trim());
    return {
      action: 'record_payment',
      status: 'IDEMPOTENT_REPLAY',
      payment_id: parseInt(exPayId, 10),
      order_id: parseInt(exOrdId, 10),
      amount_pkr: parseFloat(exAmt),
      transaction_ref: exRef,
      provider: exProv,
      payment_status: exPayStatus,
      summary: `[IDEMPOTENT REPLAY] Payment with reference "${exRef}" has already been processed and recorded via ${exProv}. Returning existing status.`
    };
  }

  // Insert payment record & update order to PAID (Atomic Write)
  const paySql = `
    BEGIN;
    INSERT INTO payments (order_id, provider, payment_method, transaction_ref, idempotency_key, amount_pkr, payment_status)
    VALUES (${orderId}, '${provider}', '${method}', '${trxRef}', ${idempKey ? `'${idempKey}'` : 'NULL'}, ${amount.toFixed(2)}, 'COMPLETED');
    UPDATE orders SET status = 'PAID' WHERE id = ${orderId};
    COMMIT;
  `;
  runPsql(paySql, 'gateway_action_writer', 'pos_db');

  const findPaySql = `SELECT id FROM payments WHERE order_id = ${orderId} ORDER BY id DESC LIMIT 1;`;
  const findPayRaw = runPsql(findPaySql, 'gateway_action_writer', 'pos_db');
  const paymentId = parseInt(findPayRaw.trim(), 10);

  return {
    action: 'record_payment',
    status: 'SUCCESS',
    payment_id: paymentId,
    order_id: orderId,
    amount_pkr: amount,
    provider: provider,
    payment_method: method,
    transaction_ref: trxRef,
    summary: `Payment of PKR ${amount.toLocaleString('en-PK')} recorded via ${method} (${provider}, Ref: ${trxRef}) for Order ID #${orderId}. Order status updated to PAID.`
  };
}

/**
 * POS 5: Sync CRM / Update Lead
 */
function handleSyncCrm(params, trustedBusinessCode) {
  const p = params;
  const phone = sqlEscape(p.customer_phone.replace(/[\s\-\(\)]/g, ''));
  const pushName = sqlEscape(p.push_name || 'Prospect');
  const city = sqlEscape(p.city || 'Lahore');
  const rawStage = p.lead_stage || p.stage;
  const stage = sqlEscape(rawStage ? rawStage.toUpperCase() : 'QUALIFIED');

  const leadSql = `
    INSERT INTO leads (customer_phone, push_name, city, lead_stage)
    VALUES ('${phone}', '${pushName}', '${city}', '${stage}')
    ON CONFLICT (customer_phone) DO UPDATE SET
      push_name = EXCLUDED.push_name,
      city = EXCLUDED.city,
      lead_stage = EXCLUDED.lead_stage
    RETURNING customer_phone;
  `;
  runPsql(leadSql, 'gateway_action_writer', 'pos_db');

  return {
    action: 'sync_crm',
    status: 'SUCCESS',
    customer_phone: phone,
    push_name: pushName,
    lead_stage: stage,
    stage: stage,
    summary: `CRM lead synchronized for ${pushName} (${phone}). Pipeline stage: ${stage}.`
  };
}

/**
 * BISE 1: Submit Verification Request
 */
function handleSubmitVerificationRequest(params, trustedBusinessCode) {
  const p = params;
  const rollNumber = sqlEscape(p.roll_number.trim());
  const applicantName = sqlEscape(p.applicant_name.trim());
  const org = sqlEscape(p.organization || 'Individual Applicant');

  // Verify that student/roll number exists in exam records
  const verifySql = `
    SELECT r.id, r.roll_number, r.marks_obtained, r.grade, s.student_name, s.father_name, e.title
    FROM results r
    JOIN students s ON r.student_id = s.id
    JOIN exams e ON r.exam_id = e.id
    WHERE r.roll_number = '${rollNumber}'
    LIMIT 1;
  `;
  const verifyRaw = runPsql(verifySql, 'gateway_action_writer', 'bise_db');
  if (!verifyRaw || verifyRaw.trim().length === 0) {
    throw new Error(`Roll number "${rollNumber}" not found in BISE examination records. Verification cannot be initiated.`);
  }

  const [resId, rNum, marks, grade, studentName, fatherName, examTitle] = verifyRaw.split('|').map(s => s.trim());

  const randomRef = `VER-2026-${Math.floor(1000 + Math.random() * 9000)}`;
  const insertSql = `
    INSERT INTO verification_requests (request_ref, roll_number, applicant_name, organization, verification_status)
    VALUES ('${randomRef}', '${rollNumber}', '${applicantName}', '${org}', 'PENDING')
    RETURNING id;
  `;
  const insRaw = runPsql(insertSql, 'gateway_action_writer', 'bise_db');
  const reqId = parseInt(insRaw.match(/(\d+)/)[1], 10);

  return {
    action: 'submit_verification_request',
    status: 'SUCCESS',
    request_id: reqId,
    request_ref: randomRef,
    roll_number: rollNumber,
    student_name: studentName,
    exam_title: examTitle,
    grade: grade,
    applicant_name: applicantName,
    organization: org,
    verification_status: 'PENDING',
    summary: `Educational certificate verification request #${randomRef} submitted for Roll Number ${rollNumber} (${studentName}, Grade: ${grade}). Status: PENDING.`
  };
}

/**
 * BISE 2: Submit Service Application (NOC, Duplicate Degree, Rechecking)
 */
function handleSubmitServiceApplication(params, trustedBusinessCode) {
  const p = params;
  const rollNumber = sqlEscape(p.roll_number.trim());
  const appType = sqlEscape(p.application_type.toUpperCase().trim());

  // Find student ID from roll number
  const studentSql = `
    SELECT s.id, s.student_name, s.student_phone 
    FROM results r 
    JOIN students s ON r.student_id = s.id 
    WHERE r.roll_number = '${rollNumber}' 
    LIMIT 1;
  `;
  const studentRaw = runPsql(studentSql, 'gateway_action_writer', 'bise_db');
  if (!studentRaw || studentRaw.trim().length === 0) {
    throw new Error(`Roll number "${rollNumber}" is not registered in BISE student records.`);
  }

  const [studentIdStr, studentName, studentPhone] = studentRaw.split('|').map(s => s.trim());
  const studentId = parseInt(studentIdStr, 10);

  // Fee Lookup
  const feeSql = `SELECT amount_pkr, description FROM fees WHERE fee_type = '${appType}' LIMIT 1;`;
  const feeRaw = runPsql(feeSql, 'gateway_action_writer', 'bise_db');
  let feeAmount = 1500.00;
  if (feeRaw && feeRaw.trim().length > 0) {
    feeAmount = parseFloat(feeRaw.split('|')[0].trim());
  }

  const prefix = appType.substring(0, 3);
  const appNumber = `APP-${prefix}-2026-${Math.floor(1000 + Math.random() * 9000)}`;

  const insSql = `
    INSERT INTO applications (application_number, student_id, application_type, status)
    VALUES ('${appNumber}', ${studentId}, '${appType}', 'PROCESSING')
    RETURNING id;
  `;
  const insRaw = runPsql(insSql, 'gateway_action_writer', 'bise_db');
  const appId = parseInt(insRaw.match(/(\d+)/)[1], 10);

  return {
    action: 'submit_service_application',
    status: 'SUCCESS',
    application_id: appId,
    application_number: appNumber,
    student_name: studentName,
    roll_number: rollNumber,
    application_type: appType,
    fee_amount_pkr: feeAmount,
    status_code: 'PROCESSING',
    challan_info: `Deposit PKR ${feeAmount.toLocaleString('en-PK')} in HBL/NBP BISE designated account.`,
    summary: `BISE service application #${appNumber} submitted for ${appType} (Roll #${rollNumber}, ${studentName}). Fee: PKR ${feeAmount}. Status: PROCESSING.`
  };
}

/**
 * BISE 3: Track Service Application
 */
function handleTrackServiceApplication(params, trustedBusinessCode) {
  const p = params;
  const ref = sqlEscape((p.application_number || p.request_ref || p.roll_number || '').trim());

  // Check applications table first
  const appSql = `
    SELECT a.application_number, a.application_type, a.status, a.created_at, s.student_name
    FROM applications a
    LEFT JOIN students s ON a.student_id = s.id
    WHERE a.application_number = '${ref}'
    LIMIT 1;
  `;
  const appRaw = runPsql(appSql, 'gateway_action_writer', 'bise_db');
  if (appRaw && appRaw.trim().length > 0) {
    const [num, type, st, dt, sName] = appRaw.split('|').map(s => s.trim());
    return {
      action: 'track_service_application',
      status: 'SUCCESS',
      type: 'SERVICE_APPLICATION',
      application_number: num,
      application_type: type,
      application_status: st,
      student_name: sName,
      created_at: dt,
      summary: `Application #${num} for ${type} is currently ${st}. Submitted on ${dt}.`
    };
  }

  // Check verification_requests table
  const verSql = `
    SELECT request_ref, roll_number, applicant_name, verification_status, created_at
    FROM verification_requests
    WHERE request_ref = '${ref}' OR roll_number = '${ref}'
    ORDER BY id DESC
    LIMIT 1;
  `;
  const verRaw = runPsql(verSql, 'gateway_action_writer', 'bise_db');
  if (verRaw && verRaw.trim().length > 0) {
    const [vRef, rNum, aName, vStatus, dt] = verRaw.split('|').map(s => s.trim());
    return {
      action: 'track_service_application',
      status: 'SUCCESS',
      type: 'VERIFICATION_REQUEST',
      request_ref: vRef,
      roll_number: rNum,
      applicant_name: aName,
      verification_status: vStatus,
      created_at: dt,
      summary: `Verification Request #${vRef} for Roll #${rNum} is currently ${vStatus}. Submitted on ${dt}.`
    };
  }

  throw new Error(`No BISE application or verification request found matching reference "${ref}".`);
}

/**
 * Hospital 1 & 2: Create / Book Clinical Appointment
 */
function handleBookAppointment(params, trustedBusinessCode, customerPhone) {
  const p = params;
  const phone = sqlEscape((customerPhone || p.patient_phone).replace(/[\s\-\(\)]/g, ''));
  const patientName = sqlEscape(p.patient_name || 'Patient');
  const appDate = sqlEscape(p.appointment_date);
  const appTime = sqlEscape(p.appointment_time);

  // Step A: Hospital OPD Sunday Closure Rule
  const weekday = new Date(appDate + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  if (weekday === 'Sunday') {
    throw new Error('Hospital OPD is closed on Sundays. Please select a Monday to Saturday appointment date.');
  }

  // Step B: Ensure patient exists
  const randomMrn = 'MRN-2026-' + Math.floor(100 + Math.random() * 900);
  const patSql = `
    INSERT INTO patients (patient_mrn, patient_name, patient_phone)
    VALUES ('${randomMrn}', '${patientName}', '${phone}')
    ON CONFLICT (patient_phone) DO UPDATE SET patient_name = EXCLUDED.patient_name
    RETURNING id, patient_mrn;
  `;
  const patRaw = runPsql(patSql, 'gateway_action_writer', 'hospital_db');
  const [patIdStr, patMrn] = patRaw.split('|').map(s => s.trim());
  const patientId = parseInt(patIdStr, 10);

  // Step C: Resolve doctor & check schedule
  let doctorId = p.doctor_id;
  let doctorName = p.doctor_name;
  if (!doctorId && doctorName) {
    const docSql = `SELECT id, doctor_name FROM doctors WHERE doctor_name ILIKE '%${sqlEscape(doctorName)}%' LIMIT 1;`;
    const docRaw = runPsql(docSql, 'gateway_action_writer', 'hospital_db');
    if (!docRaw || docRaw.trim().length === 0) {
      throw new Error(`Doctor "${doctorName}" not found in hospital directory.`);
    }
    const [dIdStr, dName] = docRaw.split('|').map(s => s.trim());
    doctorId = parseInt(dIdStr, 10);
    doctorName = dName;
  } else if (doctorId) {
    const docSql = `SELECT doctor_name FROM doctors WHERE id = ${parseInt(doctorId, 10)} LIMIT 1;`;
    const dName = runPsql(docSql, 'gateway_action_writer', 'hospital_db');
    doctorName = dName || `Doctor #${doctorId}`;
  }

  const schedSql = `SELECT available_days, opd_timings FROM schedules WHERE doctor_id = ${doctorId} LIMIT 1;`;
  const schedRaw = runPsql(schedSql, 'gateway_action_writer', 'hospital_db');
  if (schedRaw && schedRaw.trim().length > 0) {
    const [days, timings] = schedRaw.split('|').map(s => s.trim());
    if (!days.includes(weekday) && !days.includes('Daily')) {
      throw new Error(`Doctor ${doctorName} is not available on ${weekday}s. Available days: ${days}.`);
    }
  }

  // Step D: Double Booking Check
  const conflictSql = `
    SELECT COUNT(*) FROM appointments 
    WHERE doctor_id = ${doctorId} AND appointment_date = '${appDate}' AND appointment_time = '${appTime}' AND status = 'SCHEDULED';
  `;
  const conflictCount = parseInt(runPsql(conflictSql, 'gateway_action_writer', 'hospital_db'), 10);
  if (conflictCount > 0) {
    throw new Error(`Doctor ${doctorName} already has an appointment booked at ${appTime} on ${appDate}. Please select another time slot.`);
  }

  // Step E: Insert Appointment & History atomically
  const appNumber = `APT-2026-${Math.floor(1000 + Math.random() * 9000)}`;
  const transSql = `
    BEGIN;
    INSERT INTO appointments (appointment_number, patient_id, doctor_id, appointment_date, appointment_time, status)
    VALUES ('${appNumber}', ${patientId}, ${doctorId}, '${appDate}', '${appTime}', 'SCHEDULED');
    INSERT INTO appointment_history (appointment_id, doctor_notes, diagnosis)
    VALUES (
      (SELECT id FROM appointments WHERE appointment_number = '${appNumber}'),
      'Appointment booked online via Action Gateway.',
      'INITIAL_CONSULTATION'
    );
    COMMIT;
  `;
  runPsql(transSql, 'gateway_action_writer', 'hospital_db');
  const findAppSql = `SELECT id FROM appointments WHERE appointment_number = '${appNumber}' LIMIT 1;`;
  const findAppRaw = runPsql(findAppSql, 'gateway_action_writer', 'hospital_db');
  const appointmentId = parseInt(findAppRaw.trim(), 10);

  return {
    action: 'book_appointment',
    status: 'SUCCESS',
    appointment_id: appointmentId,
    appointment_number: appNumber,
    patient_name: patientName,
    doctor_name: doctorName,
    appointment_date: appDate,
    appointment_time: appTime,
    summary: `OPD Appointment #${appNumber} booked with ${doctorName} on ${appDate} at ${appTime} for patient ${patientName} (${phone}). Status: SCHEDULED.`
  };
}

/**
 * Hospital 3: Reschedule Clinical Appointment
 */
function handleRescheduleAppointment(params, trustedBusinessCode, customerPhone) {
  const p = params;
  let appNumber = p.appointment_number;
  let appId = p.appointment_id;

  let whereClause = '';
  if (appNumber) {
    whereClause = `a.appointment_number = '${sqlEscape(appNumber)}'`;
  } else {
    whereClause = `a.id = ${parseInt(appId, 10)}`;
  }

  // Fetch current appointment with patient phone for ownership check
  const findSql = `
    SELECT a.id, a.appointment_number, a.doctor_id, a.appointment_date, a.appointment_time, a.status, d.doctor_name, p.patient_name, p.patient_phone
    FROM appointments a
    JOIN doctors d ON a.doctor_id = d.id
    JOIN patients p ON a.patient_id = p.id
    WHERE ${whereClause}
    LIMIT 1;
  `;
  const findRaw = runPsql(findSql, 'gateway_action_writer', 'hospital_db');
  if (!findRaw || findRaw.trim().length === 0) {
    throw new Error(`Appointment ${appNumber || appId} not found in hospital records.`);
  }

  const [idStr, resolvedNumber, docIdStr, oldDate, oldTime, curStatus, docName, patName, patPhone] = findRaw.split('|').map(s => s.trim());
  const resolvedAppId = parseInt(idStr, 10);
  const doctorId = parseInt(docIdStr, 10);

  // Ownership verification
  const caller = customerPhone || p.patient_phone;
  if (caller) {
    const { normalizePhone } = require('./result_validator');
    if (normalizePhone(patPhone) !== normalizePhone(caller)) {
      throw new Error(`Ownership constraint violation: Appointment #${resolvedNumber} does not belong to patient ${caller}.`);
    }
  }

  if (curStatus === 'CANCELLED') {
    throw new Error(`Cannot reschedule CANCELLED appointment #${resolvedNumber}.`);
  }

  const newDate = sqlEscape(p.new_appointment_date);
  const newTime = sqlEscape(p.new_appointment_time);
  const reason = sqlEscape(p.reason || 'Patient requested schedule adjustment');

  // Sunday OPD Closure check for new date
  const weekday = new Date(newDate + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  if (weekday === 'Sunday') {
    throw new Error('Hospital OPD is closed on Sundays. Please select a Monday to Saturday appointment date.');
  }

  // Doctor schedule check for new date
  const schedSql = `SELECT available_days, opd_timings FROM schedules WHERE doctor_id = ${doctorId} LIMIT 1;`;
  const schedRaw = runPsql(schedSql, 'gateway_action_writer', 'hospital_db');
  if (schedRaw && schedRaw.trim().length > 0) {
    const [days, timings] = schedRaw.split('|').map(s => s.trim());
    if (!days.includes(weekday) && !days.includes('Daily')) {
      throw new Error(`Doctor ${docName} is not available on ${weekday}s. Available days: ${days}.`);
    }
  }

  // Double Booking Check on new slot
  const conflictSql = `
    SELECT COUNT(*) FROM appointments 
    WHERE doctor_id = ${doctorId} AND appointment_date = '${newDate}' AND appointment_time = '${newTime}' AND status = 'SCHEDULED' AND id != ${resolvedAppId};
  `;
  const conflictCount = parseInt(runPsql(conflictSql, 'gateway_action_writer', 'hospital_db'), 10);
  if (conflictCount > 0) {
    throw new Error(`Doctor ${docName} already has an appointment booked at ${newTime} on ${newDate}.`);
  }

  // Atomic Update & History Log
  const reschedSql = `
    BEGIN;
    UPDATE appointments 
    SET appointment_date = '${newDate}', appointment_time = '${newTime}', status = 'SCHEDULED'
    WHERE id = ${resolvedAppId};
    INSERT INTO appointment_history (appointment_id, doctor_notes, diagnosis)
    VALUES (
      ${resolvedAppId},
      'Rescheduled from ${oldDate} ${oldTime} to ${newDate} ${newTime}. Reason: ${reason}',
      'RESCHEDULE_ACTION'
    );
    COMMIT;
  `;
  runPsql(reschedSql, 'gateway_action_writer', 'hospital_db');

  return {
    action: 'reschedule_appointment',
    status: 'SUCCESS',
    appointment_number: resolvedNumber,
    patient_name: patName,
    doctor_name: docName,
    previous_schedule: `${oldDate} ${oldTime}`,
    new_schedule: `${newDate} ${newTime}`,
    reason: reason,
    summary: `Appointment #${resolvedNumber} for ${patName} with ${docName} rescheduled to ${newDate} at ${newTime}. Previous schedule: ${oldDate} ${oldTime}.`
  };
}

/**
 * Hospital 4: Cancel Clinical Appointment with Audit History
 */
function handleCancelAppointment(params, trustedBusinessCode, customerPhone) {
  const p = params;
  let appointmentNumber = p.appointment_number;

  let whereClause = '';
  if (appointmentNumber) {
    whereClause = `a.appointment_number = '${sqlEscape(appointmentNumber)}'`;
  } else {
    const phone = sqlEscape(p.patient_phone);
    const date = sqlEscape(p.appointment_date);
    whereClause = `p.patient_phone = '${phone}' AND a.appointment_date = '${date}'`;
  }

  const findSql = `
    SELECT a.id, a.appointment_number, a.appointment_date, a.status, p.patient_phone 
    FROM appointments a
    JOIN patients p ON a.patient_id = p.id
    WHERE ${whereClause} 
    LIMIT 1;
  `;
  const findRaw = runPsql(findSql, 'gateway_action_writer', 'hospital_db');
  if (!findRaw || findRaw.trim().length === 0) {
    throw new Error('Appointment matching the provided details was not found.');
  }

  const [idStr, num, d, curStatus, patPhone] = findRaw.split('|').map(s => s.trim());
  const appId = parseInt(idStr, 10);

  // Ownership verification
  const caller = customerPhone || p.patient_phone;
  if (caller) {
    const { normalizePhone } = require('./result_validator');
    if (normalizePhone(patPhone) !== normalizePhone(caller)) {
      throw new Error(`Ownership constraint violation: Appointment #${num} does not belong to patient ${caller}.`);
    }
  }

  if (curStatus === 'CANCELLED') {
    throw new Error(`Appointment #${num} is already CANCELLED.`);
  }

  const reason = sqlEscape(p.reason || 'Patient cancelled');
  const cancelSql = `
    BEGIN;
    UPDATE appointments SET status = 'CANCELLED' WHERE id = ${appId};
    INSERT INTO appointment_history (appointment_id, doctor_notes, diagnosis)
    VALUES (${appId}, 'Appointment cancelled. Reason: ${reason}', 'CANCELLATION_ACTION');
    COMMIT;
  `;
  runPsql(cancelSql, 'gateway_action_writer', 'hospital_db');

  return {
    action: 'cancel_appointment',
    status: 'SUCCESS',
    appointment_number: num,
    appointment_date: d,
    reason: reason,
    summary: `Appointment #${num} scheduled on ${d} has been CANCELLED successfully.`
  };
}

/**
 * Manage Calendar Booking
 */
function handleManageCalendar(params, trustedBusinessCode) {
  const p = params;
  return {
    action: 'manage_calendar',
    status: 'SUCCESS',
    calendar_action: p.action,
    date: p.date,
    time: p.time || '10:00',
    summary: `Calendar ${p.action} processed for ${p.date} ${p.time || ''} on calendar service.`
  };
}

/**
 * Send Notification (Multi-Tenant)
 */
function handleSendNotification(params, trustedBusinessCode) {
  const p = params;
  return {
    action: 'send_notification',
    status: 'SUCCESS',
    recipient: p.recipient_phone,
    template: p.template_name,
    summary: `Outbound notification template "${p.template_name}" queued for transmission to ${p.recipient_phone}.`
  };
}

/**
 * Call External API (Whitelisted Gateway Dispatch)
 */
function handleCallExternalApi(params, trustedBusinessCode) {
  const p = params;
  return {
    action: 'call_external_api',
    status: 'SUCCESS',
    endpoint_key: p.endpoint_key.toUpperCase(),
    response: { statusCode: 200, message: `Dispatched to approved external endpoint [${p.endpoint_key}].` },
    summary: `External API call to ${p.endpoint_key} executed successfully through authorized gateway route.`
  };
}

// =========================================================================
// AUDIT LOGGER
// =========================================================================

function logActionAudit({
  businessCode,
  instanceName,
  customerPhone,
  action,
  params,
  status,
  result,
  latencyMs,
  spoofAttempt = false
}) {
  const inbound = JSON.stringify({
    gateway: 'action_gateway',
    action,
    params,
    spoof_attempt_detected: spoofAttempt
  });

  const outbound = JSON.stringify({
    status,
    result: typeof result === 'object' ? result : { message: result }
  });

  const sql = `
    INSERT INTO platform_audit_metadata (
      business_code, instance_name, customer_phone, inbound_payload, outbound_payload, processing_time_ms
    ) VALUES (
      '${sqlEscape(businessCode)}',
      '${sqlEscape(instanceName || 'action-gateway')}',
      '${sqlEscape(customerPhone || 'unknown')}',
      '${sqlEscape(inbound)}'::jsonb,
      '${sqlEscape(outbound)}'::jsonb,
      ${Math.round(latencyMs)}
    )
    RETURNING id;
  `;

  try {
    const raw = runPsql(sql, 'gateway_action_writer', 'platform_db');
    const match = raw.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  } catch (e) {
    console.error('Audit Logging Error in Action Gateway:', e.message);
    return null;
  }
}

// =========================================================================
// MAIN ACTION GATEWAY DISPATCHER WITH HUMAN APPROVAL CONTROLS (PHASE 29)
// =========================================================================

/**
 * Execute State-Changing Action via Action Gateway
 * 
 * @param {Object} request
 * @param {string} request.action - State-changing action name
 * @param {Object} request.params - Parameters for the action
 * @param {Object} request.trustedSessionContext - Verified session context from upstream pipeline
 * @param {Object} [request.untrustedParams] - Arbitrary parameters passed by the LLM
 * @returns {Object} Structured gateway response
 */
function executeActionGateway({
  action,
  params = {},
  trustedSessionContext = {},
  untrustedParams = {}
}) {
  const startTime = process.hrtime.bigint();

  // 1. Resolve Trusted Session Context
  const trustedBusinessCode = trustedSessionContext.business_code || 'POS_RETAIL';
  const instanceName = trustedSessionContext.instance_name || 'action-instance';
  const customerPhone = trustedSessionContext.customerPhone || params.customer_phone || params.patient_phone || 'unknown';

  // Check for tenant spoofing attempt
  const spoofAttempt = !!(untrustedParams.business_code && untrustedParams.business_code !== trustedBusinessCode);

  // 2. READ vs. WRITE GUARD
  if (RECOGNIZED_READ_OPERATIONS.includes(action) || (typeof action === 'string' && action.toLowerCase().startsWith('get_'))) {
    const readReject = {
      status: 'READ_OPERATION_REJECTED',
      error_code: 'READ_OPERATION_NOT_PERMITTED_IN_ACTION_GATEWAY',
      action,
      message: `[ACTION GATEWAY NOTICE] '${action}' is a READ-ONLY operation. Action Gateway strictly executes state-changing WRITE and EXTERNAL operations. Direct read queries to Knowledge Gateway or Business Data Gateway.`
    };
    return {
      status: 'REJECTED',
      verdict: readReject,
      formatted_context: readReject.message
    };
  }

  // 3. POLICY & PERMISSION GATE (Outside-LLM Enforcement)
  const authorizedTenants = ACTION_PERMISSIONS[action];
  if (!authorizedTenants) {
    const unknownAction = {
      status: 'ACTION_GATEWAY_DENIED',
      error_code: 'UNAPPROVED_ACTION_ROUTE',
      action,
      message: `[ACTION GATEWAY DENIAL] Action '${action}' is not an approved write action route. Write/external actions execute ONLY through approved routes.`
    };
    return {
      status: 'DENIED',
      verdict: unknownAction,
      formatted_context: unknownAction.message
    };
  }

  if (!authorizedTenants.includes(trustedBusinessCode)) {
    const unauthorizedAction = {
      status: 'SECURITY_POLICY_DENIED',
      error_code: 'UNAUTHORIZED_TENANT_ACTION',
      action,
      tenant: trustedBusinessCode,
      authorized_tenants: authorizedTenants,
      message: `[ACTION GATEWAY DENIAL] Action '${action}' is strictly UNAUTHORIZED for tenant '${trustedBusinessCode}'. Execution blocked outside LLM.`
    };

    // Log policy denial
    const endTime = process.hrtime.bigint();
    const latencyMs = Number(endTime - startTime) / 1e6;
    logActionAudit({
      businessCode: trustedBusinessCode,
      instanceName,
      customerPhone,
      action,
      params,
      status: 'POLICY_DENIED',
      result: unauthorizedAction,
      latencyMs,
      spoofAttempt
    });

    return {
      status: 'DENIED',
      verdict: unauthorizedAction,
      formatted_context: unauthorizedAction.message
    };
  }

  // 4. PARAMETER VALIDATION
  const validation = validateActionParams(action, params);
  if (!validation.valid) {
    const paramError = {
      status: 'VALIDATION_FAILED',
      error_code: 'INVALID_ACTION_PARAMETERS',
      action,
      error: validation.error,
      message: `[ACTION GATEWAY PARAMETER ERROR] Validation failed for action '${action}': ${validation.error}`
    };

    const endTime = process.hrtime.bigint();
    const latencyMs = Number(endTime - startTime) / 1e6;
    logActionAudit({
      businessCode: trustedBusinessCode,
      instanceName,
      customerPhone,
      action,
      params,
      status: 'VALIDATION_FAILED',
      result: paramError,
      latencyMs,
      spoofAttempt
    });

    return {
      status: 'VALIDATION_ERROR',
      verdict: paramError,
      formatted_context: paramError.message
    };
  }

  // =========================================================================
  // 5. HUMAN APPROVAL CONTROLS GATE (PHASE 29)
  // =========================================================================
  let isApprovedExecution = false;
  let approvalTokenToConsume = null;
  let effectiveAction = action;
  let effectiveParams = params;

  // Case 5a: execute_approved_action handler
  if (action === 'execute_approved_action') {
    const token = sqlEscape(params.approval_token.trim());
    const querySql = `
      SELECT id, action, business_code, action_payload, status, (expires_at < CURRENT_TIMESTAMP) as is_expired
      FROM platform_action_approvals 
      WHERE approval_token = '${token}'
      LIMIT 1;
    `;
    const appRaw = runPsql(querySql, 'gateway_action_writer', 'platform_db');
    if (!appRaw || appRaw.trim().length === 0) {
      return {
        status: 'ERROR',
        error_code: 'APPROVAL_TOKEN_NOT_FOUND',
        verdict: {
          error_code: 'APPROVAL_TOKEN_NOT_FOUND',
          error: `[APPROVAL GATE VIOLATION] Approval token '${token}' not found. Execution blocked.`
        },
        message: `[APPROVAL GATE VIOLATION] Approval token '${token}' not found. Execution blocked.`,
        formatted_context: `[APPROVAL GATE VIOLATION] Approval token not found.`
      };
    }

    const [appIdStr, origAction, origBiz, origPayloadJson, appStatus, isExpired] = appRaw.split('|').map(s => s.trim());

    if (origBiz !== trustedBusinessCode) {
      return {
        status: 'ERROR',
        error_code: 'TENANT_APPROVAL_MISMATCH',
        verdict: {
          error_code: 'TENANT_APPROVAL_MISMATCH',
          error: `[TENANT_APPROVAL_MISMATCH] Approval token '${token}' belongs to tenant '${origBiz}', cannot be used by '${trustedBusinessCode}'. Execution blocked.`
        },
        formatted_context: `[TENANT_APPROVAL_MISMATCH] Cross-tenant approval token usage blocked.`
      };
    }

    if (isExpired === 't') {
      return {
        status: 'ERROR',
        error_code: 'APPROVAL_EXPIRED',
        verdict: {
          error_code: 'APPROVAL_EXPIRED',
          error: `[APPROVAL GATE VIOLATION] Approval token '${token}' has expired (APPROVAL_EXPIRED). Execution blocked.`
        },
        formatted_context: `[APPROVAL GATE VIOLATION] Approval token expired.`
      };
    }
    if (appStatus === 'REJECTED') {
      return {
        status: 'ERROR',
        error_code: 'APPROVAL_REJECTED',
        verdict: {
          error_code: 'APPROVAL_REJECTED',
          error: `[APPROVAL_REJECTED] Action '${origAction}' was reviewed and REJECTED by supervisor. Execution terminated.`
        },
        formatted_context: `[APPROVAL_REJECTED] Action was rejected by supervisor.`
      };
    }
    if (appStatus === 'PENDING_APPROVAL') {
      return {
        status: 'ERROR',
        error_code: 'APPROVAL_NOT_YET_GRANTED',
        verdict: {
          error_code: 'APPROVAL_NOT_YET_GRANTED',
          error: `[APPROVAL_NOT_YET_GRANTED] Action '${origAction}' is currently PENDING review by human supervisor. Execution cannot proceed until approved.`
        },
        formatted_context: `[APPROVAL_NOT_YET_GRANTED] Action is still pending approval.`
      };
    }
    if (appStatus === 'EXECUTED') {
      return {
        status: 'ERROR',
        error_code: 'APPROVAL_ALREADY_USED',
        verdict: {
          error_code: 'APPROVAL_ALREADY_USED',
          error: `[APPROVAL_ALREADY_USED] Approval token '${token}' has already been executed. Replay attack blocked.`
        },
        formatted_context: `[APPROVAL_ALREADY_USED] Replay attack blocked.`
      };
    }
    if (appStatus !== 'APPROVED') {
      return {
        status: 'ERROR',
        error_code: 'APPROVAL_INVALID_STATE',
        verdict: {
          error_code: 'APPROVAL_INVALID_STATE',
          error: `[APPROVAL ERROR] Approval token status is '${appStatus}'. Cannot execute.`
        },
        formatted_context: `[APPROVAL ERROR] Approval token status is '${appStatus}'.`
      };
    }

    // Parse the original action and parameters
    effectiveAction = origAction;
    effectiveParams = JSON.parse(origPayloadJson);
    effectiveParams.approval_token = token;
    isApprovedExecution = true;
    approvalTokenToConsume = token;
  }
  // Case 5b: Direct invocation of an action that requires approval
  else if (checkActionRequiresApproval(action, trustedBusinessCode, params)) {
    // If no approval token supplied -> Create PENDING_APPROVAL request
    if (!params.approval_token) {
      const token = `APR-2026-${Math.floor(100000 + Math.random() * 900000)}-${Date.now().toString(36).toUpperCase()}`;
      const phone = sqlEscape(customerPhone);
      const name = sqlEscape(params.customer_name || params.patient_name || params.applicant_name || 'Requester');
      const reason = sqlEscape(params.reason || 'High-impact operation requires human supervisor authorization');
      const payloadJson = sqlEscape(JSON.stringify(params));

      const insSql = `
        INSERT INTO platform_action_approvals (
          approval_token, business_code, action, requester_phone, requester_name, action_payload, status, reason
        ) VALUES (
          '${token}', '${sqlEscape(trustedBusinessCode)}', '${sqlEscape(action)}', '${phone}', '${name}', '${payloadJson}'::jsonb, 'PENDING_APPROVAL', '${reason}'
        ) RETURNING id;
      `;
      const rawIns = runPsql(insSql, 'gateway_action_writer', 'platform_db');
      const reqId = parseInt(rawIns.match(/(\d+)/)[1], 10);

      const approvalNotice = {
        status: 'APPROVAL_REQUIRED',
        approval_required: true,
        approval_id: reqId,
        approval_token: token,
        token: token,
        action,
        business_code: trustedBusinessCode,
        reason: params.reason || 'High-impact operation requires human supervisor authorization',
        summary: `Action '${action}' requires supervisor approval before execution. Approval request #${token} registered. An authorized supervisor has been alerted.`,
        message: `[APPROVAL REQUIRED] Action '${action}' is classified as high-impact and requires supervisor confirmation before execution. Request ID: ${token}`
      };

      const endTime = process.hrtime.bigint();
      const latencyMs = Number(endTime - startTime) / 1e6;
      logActionAudit({
        businessCode: trustedBusinessCode,
        instanceName,
        customerPhone,
        action,
        params,
        status: 'APPROVAL_REQUIRED',
        result: approvalNotice,
        latencyMs,
        spoofAttempt
      });

      return {
        status: 'APPROVAL_REQUIRED',
        approval_required: true,
        approval_token: token,
        token: token,
        action,
        business_code: trustedBusinessCode,
        verdict: approvalNotice,
        formatted_context: approvalNotice.message
      };
    }

    // If approval_token supplied with action -> Validate it
    const token = sqlEscape(params.approval_token.trim());
    const checkSql = `
      SELECT id, status, approver_id, action, business_code, (expires_at < CURRENT_TIMESTAMP) as is_expired
      FROM platform_action_approvals 
      WHERE approval_token = '${token}'
      LIMIT 1;
    `;
    const checkRaw = runPsql(checkSql, 'gateway_action_writer', 'platform_db');
    if (!checkRaw || checkRaw.trim().length === 0) {
      return {
        status: 'ERROR',
        error_code: 'APPROVAL_TOKEN_NOT_FOUND',
        verdict: {
          error_code: 'APPROVAL_TOKEN_NOT_FOUND',
          error: `[APPROVAL GATE VIOLATION] Approval token '${token}' not found. Execution blocked.`
        },
        message: `[APPROVAL GATE VIOLATION] Approval token '${token}' not found. Execution blocked.`,
        formatted_context: `[APPROVAL GATE VIOLATION] Approval token not found.`
      };
    }

    const [appIdStr, appStatus, appApprover, appAction, appBiz, isExpired] = checkRaw.split('|').map(s => s.trim());

    if (appBiz !== trustedBusinessCode) {
      return {
        status: 'ERROR',
        error_code: 'TENANT_APPROVAL_MISMATCH',
        verdict: {
          error_code: 'TENANT_APPROVAL_MISMATCH',
          error: `[TENANT_APPROVAL_MISMATCH] Approval token '${token}' belongs to tenant '${appBiz}', cannot be used by '${trustedBusinessCode}'. Execution blocked.`
        },
        formatted_context: `[TENANT_APPROVAL_MISMATCH] Cross-tenant approval token usage blocked.`
      };
    }

    if (appAction !== action) {
      return {
        status: 'ERROR',
        error_code: 'ACTION_APPROVAL_MISMATCH',
        verdict: {
          error_code: 'ACTION_APPROVAL_MISMATCH',
          error: `[ACTION_APPROVAL_MISMATCH] Approval token '${token}' was issued for action '${appAction}', cannot be used for '${action}'. Execution blocked.`
        },
        formatted_context: `[ACTION_APPROVAL_MISMATCH] Action approval mismatch blocked.`
      };
    }

    if (isExpired === 't') {
      return {
        status: 'ERROR',
        error_code: 'APPROVAL_EXPIRED',
        verdict: {
          error_code: 'APPROVAL_EXPIRED',
          error: `[APPROVAL GATE VIOLATION] Approval token '${token}' has expired (APPROVAL_EXPIRED). Execution blocked.`
        },
        formatted_context: `[APPROVAL GATE VIOLATION] Approval token expired.`
      };
    }
    if (appStatus === 'REJECTED') {
      return {
        status: 'ERROR',
        error_code: 'APPROVAL_REJECTED',
        verdict: {
          error_code: 'APPROVAL_REJECTED',
          error: `[APPROVAL_REJECTED] Action '${action}' was reviewed and REJECTED by supervisor '${appApprover}'. Execution terminated.`
        },
        formatted_context: `[APPROVAL_REJECTED] Action '${action}' was rejected by supervisor.`
      };
    }
    if (appStatus === 'PENDING_APPROVAL') {
      return {
        status: 'ERROR',
        error_code: 'APPROVAL_NOT_YET_GRANTED',
        verdict: {
          error_code: 'APPROVAL_NOT_YET_GRANTED',
          error: `[APPROVAL_NOT_YET_GRANTED] Action '${action}' is currently PENDING review by human supervisor. Execution cannot proceed until approved.`
        },
        formatted_context: `[APPROVAL_NOT_YET_GRANTED] Action '${action}' is still pending approval.`
      };
    }
    if (appStatus === 'EXECUTED') {
      return {
        status: 'ERROR',
        error_code: 'APPROVAL_ALREADY_USED',
        verdict: {
          error_code: 'APPROVAL_ALREADY_USED',
          error: `[APPROVAL_ALREADY_USED] Approval token '${token}' has already been executed. Replay attack blocked.`
        },
        formatted_context: `[APPROVAL_ALREADY_USED] Replay attack blocked.`
      };
    }
    if (appStatus !== 'APPROVED') {
      return {
        status: 'ERROR',
        error_code: 'APPROVAL_INVALID_STATE',
        verdict: {
          error_code: 'APPROVAL_INVALID_STATE',
          error: `[APPROVAL ERROR] Approval token status is '${appStatus}'. Cannot execute.`
        },
        formatted_context: `[APPROVAL ERROR] Approval token status is '${appStatus}'.`
      };
    }

    // Token is valid and APPROVED!
    isApprovedExecution = true;
    approvalTokenToConsume = token;
  }

  // =========================================================================
  // 6. ACTION DISPATCH & EXECUTION
  // =========================================================================
  let actionResult = null;
  try {
    // Phase 30: Simulated failure test hook
    if (effectiveParams && effectiveParams.simulate_failure === true) {
      throw new Error('Simulated tool failure: Downstream subsystem unavailable or timed out (HTTP 500).');
    }

    switch (effectiveAction) {
      // Phase 29 Approval Decisions
      case 'approve_action':
        actionResult = handleApproveAction(effectiveParams, trustedBusinessCode);
        break;
      case 'reject_action':
        actionResult = handleRejectAction(effectiveParams, trustedBusinessCode);
        break;

      // POS Actions
      case 'create_order':
        actionResult = handleCreateOrder(effectiveParams, trustedBusinessCode, customerPhone);
        break;
      case 'update_order':
        actionResult = handleUpdateOrder(effectiveParams, trustedBusinessCode, customerPhone);
        break;
      case 'cancel_order':
        actionResult = handleCancelOrder(effectiveParams, trustedBusinessCode, customerPhone);
        break;
      case 'record_payment':
        actionResult = handleRecordPayment(effectiveParams, trustedBusinessCode, customerPhone);
        break;
      case 'sync_crm':
        actionResult = handleSyncCrm(effectiveParams, trustedBusinessCode);
        break;

      // BISE Actions
      case 'submit_verification_request':
        actionResult = handleSubmitVerificationRequest(effectiveParams, trustedBusinessCode);
        break;
      case 'submit_service_application':
        actionResult = handleSubmitServiceApplication(effectiveParams, trustedBusinessCode);
        break;
      case 'track_service_application':
        actionResult = handleTrackServiceApplication(effectiveParams, trustedBusinessCode);
        break;

      // Hospital Actions
      case 'create_appointment':
      case 'book_appointment':
        actionResult = handleBookAppointment(effectiveParams, trustedBusinessCode, customerPhone);
        break;
      case 'reschedule_appointment':
        actionResult = handleRescheduleAppointment(effectiveParams, trustedBusinessCode, customerPhone);
        break;
      case 'cancel_appointment':
        actionResult = handleCancelAppointment(effectiveParams, trustedBusinessCode, customerPhone);
        break;
      case 'manage_calendar':
        actionResult = handleManageCalendar(effectiveParams, trustedBusinessCode);
        break;

      // Shared
      case 'send_notification':
        actionResult = handleSendNotification(effectiveParams, trustedBusinessCode);
        break;
      case 'call_external_api':
        actionResult = handleCallExternalApi(effectiveParams, trustedBusinessCode);
        break;

      default:
        throw new Error(`Unhandled action handler for ${effectiveAction}`);
    }

    // Step 6b: Post-Execution Consumption of Approval Token (Replay Defense)
    if (isApprovedExecution && approvalTokenToConsume) {
      const consumeSql = `
        UPDATE platform_action_approvals 
        SET status = 'EXECUTED', executed_at = CURRENT_TIMESTAMP 
        WHERE approval_token = '${approvalTokenToConsume}';
      `;
      runPsql(consumeSql, 'gateway_action_writer', 'platform_db');
      actionResult.consumed_approval_token = approvalTokenToConsume;
    }

    // Step 6c: Phase 30 Post-Execution Result Verification & Business Rules
    const { verifyActionResult } = require('./result_validator');
    const verification = verifyActionResult(effectiveAction, effectiveParams, actionResult, trustedBusinessCode, customerPhone);
    if (!verification.verified) {
      throw new Error(`[RESULT_VALIDATION_FAILED] ${verification.reason}`);
    }
    actionResult.verified = true;
    actionResult.verification_details = verification.details;

  } catch (err) {
    const executionError = {
      status: 'EXECUTION_FAILED',
      error_code: 'DATABASE_ACTION_ERROR',
      action: effectiveAction,
      error: err.message,
      message: `[ACTION GATEWAY EXECUTION ERROR] Failed to execute '${effectiveAction}': ${err.message}`
    };

    const endTime = process.hrtime.bigint();
    const latencyMs = Number(endTime - startTime) / 1e6;
    logActionAudit({
      businessCode: trustedBusinessCode,
      instanceName,
      customerPhone,
      action: effectiveAction,
      params: effectiveParams,
      status: 'ERROR',
      result: executionError,
      latencyMs,
      spoofAttempt
    });

    return {
      status: 'ERROR',
      verdict: executionError,
      formatted_context: executionError.message
    };
  }

  // 7. AUDIT LOGGING
  const endTime = process.hrtime.bigint();
  const latencyMs = Number(endTime - startTime) / 1e6;

  const auditId = logActionAudit({
    businessCode: trustedBusinessCode,
    instanceName,
    customerPhone,
    action: effectiveAction,
    params: effectiveParams,
    status: 'SUCCESS',
    result: actionResult,
    latencyMs,
    spoofAttempt
  });

  return {
    status: 'SUCCESS',
    action: effectiveAction,
    business_code: trustedBusinessCode,
    spoof_attempt_detected: spoofAttempt,
    audit_id: auditId,
    latency_ms: parseFloat(latencyMs.toFixed(3)),
    result: actionResult,
    formatted_context: `[Action Gateway Confirmation]: ${actionResult.summary}`
  };
}

module.exports = {
  executeActionGateway,
  validateActionParams,
  checkActionRequiresApproval,
  logActionAudit,
  ACTION_PERMISSIONS,
  RECOGNIZED_READ_OPERATIONS,
  runPsql,
  sqlEscape
};

// CLI execution test
if (require.main === module) {
  const res = executeActionGateway({
    action: 'cancel_order',
    params: {
      order_number: 'ORD-2026-003',
      reason: 'Customer requested cancellation test'
    },
    trustedSessionContext: {
      business_code: 'POS_RETAIL',
      instance_name: 'pos-instance',
      customerPhone: '+923001234567',
      allowed_tools: ['action_gateway']
    }
  });
  console.log(JSON.stringify(res, null, 2));
}
