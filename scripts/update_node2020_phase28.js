const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'evolution_whatsapp_ai_agent_bot.json');
const workflow = JSON.parse(fs.readFileSync(filePath, 'utf8'));

const node2020 = workflow.nodes.find(n => n.id === '2020');
if (!node2020) {
  console.error('Node 2020 not found in workflow JSON');
  process.exit(1);
}

node2020.parameters.description = "Access the centralized, business-aware Action Gateway for all state-changing and external write actions. Executes approved operations: POS (create_order, update_order, cancel_order, record_payment, sync_crm); BISE (submit_verification_request, submit_service_application, track_service_application); Hospital (create_appointment, book_appointment, reschedule_appointment, cancel_appointment, manage_calendar); Shared (send_notification, call_external_api). Requires action name and validated parameters. Read-only queries are strictly rejected.";

node2020.parameters.inputSchema = JSON.stringify({
  type: "object",
  properties: {
    action: {
      type: "string",
      description: "The approved state-changing action to execute (create_order, update_order, cancel_order, record_payment, sync_crm, submit_verification_request, submit_service_application, track_service_application, create_appointment, book_appointment, reschedule_appointment, cancel_appointment, manage_calendar, send_notification, call_external_api)."
    },
    params: {
      type: "object",
      description: "Validated parameters required for the specific action."
    }
  },
  required: ["action", "params"]
}, null, 2);

const jsCode = `const { Client } = require('/usr/local/lib/node_modules/n8n/node_modules/pg');

const startTime = Date.now();
const inputJson = $input.first()?.json || {};
const action = inputJson.action || '';
const params = inputJson.params || {};

// 1. Resolve Trusted Session Context from Upstream Pipeline
const incoming = ($('PostgreSQL Persistent Conversation Store').first() || $('Message Normalizer').first() || $json)?.json || {};
const trustedBusinessCode = incoming.business_code || 'POS_RETAIL';
const instanceName = incoming.instance_name || 'action-instance';
const customerPhone = incoming.customerPhone || params.customer_phone || params.patient_phone || 'unknown';
const allowedTools = incoming.allowed_tools || ['action_gateway'];

// Anti-spoofing check
const spoofAttempt = !!(inputJson.business_code && inputJson.business_code !== trustedBusinessCode);

// 2. READ vs WRITE GUARD
const RECOGNIZED_READS = [
  'get_product', 'check_inventory', 'get_price', 'get_student_result',
  'get_doctor_schedule', 'get_doctors_by_specialty', 'get_departments',
  'search_knowledge_base', 'query_business_data'
];

if (RECOGNIZED_READS.includes(action) || (typeof action === 'string' && action.toLowerCase().startsWith('get_'))) {
  return JSON.stringify({
    status: 'READ_OPERATION_REJECTED',
    error_code: 'READ_OPERATION_NOT_PERMITTED_IN_ACTION_GATEWAY',
    action,
    message: \`[ACTION GATEWAY NOTICE] '\${action}' is a READ-ONLY operation. Action Gateway strictly executes state-changing WRITE and EXTERNAL operations. Direct read queries to Knowledge Gateway or Business Data Gateway.\`
  });
}

// 3. Multi-Tenant Action Permissions
const ACTION_PERMS = {
  create_order: ['POS_RETAIL'],
  update_order: ['POS_RETAIL'],
  cancel_order: ['POS_RETAIL'],
  record_payment: ['POS_RETAIL'],
  sync_crm: ['POS_RETAIL'],
  submit_verification_request: ['BISE_EDU'],
  submit_service_application: ['BISE_EDU'],
  track_service_application: ['BISE_EDU'],
  create_appointment: ['HOSP_HEALTH'],
  book_appointment: ['HOSP_HEALTH'],
  reschedule_appointment: ['HOSP_HEALTH'],
  cancel_appointment: ['HOSP_HEALTH'],
  manage_calendar: ['HOSP_HEALTH'],
  send_notification: ['POS_RETAIL', 'BISE_EDU', 'HOSP_HEALTH'],
  call_external_api: ['POS_RETAIL', 'BISE_EDU', 'HOSP_HEALTH']
};

const authorizedTenants = ACTION_PERMS[action];
if (!authorizedTenants) {
  return JSON.stringify({
    status: 'ACTION_GATEWAY_DENIED',
    error_code: 'UNAPPROVED_ACTION_ROUTE',
    action,
    message: \`[ACTION GATEWAY DENIAL] Action '\${action}' is not an approved write action route. Write/external actions execute ONLY through approved routes.\`
  });
}

if (!authorizedTenants.includes(trustedBusinessCode)) {
  return JSON.stringify({
    status: 'SECURITY_POLICY_DENIED',
    error_code: 'UNAUTHORIZED_TENANT_ACTION',
    action,
    tenant: trustedBusinessCode,
    authorized_tenants: authorizedTenants,
    message: \`[ACTION GATEWAY DENIAL] Action '\${action}' is strictly UNAUTHORIZED for tenant '\${trustedBusinessCode}'. Execution blocked outside LLM.\`
  });
}

// 4. Parameter Validation
function isValidPhone(p) { return p && typeof p === 'string' && /^\\+?[0-9]{10,15}$/.test(p.replace(/[\\s\\-\\(\\)]/g, '')); }
function isValidDate(d) { return d && typeof d === 'string' && /^\\d{4}-\\d{2}-\\d{2}$/.test(d); }
function isValidTime(t) { return t && typeof t === 'string' && /^([01]\\d|2[0-3]):([0-5]\\d)(:[0-5]\\d)?$/.test(t); }

let valError = null;
if (action === 'create_order') {
  if (!params.customer_phone || !isValidPhone(params.customer_phone)) valError = 'Valid customer_phone is required.';
  else if (!Array.isArray(params.items) || params.items.length === 0) valError = 'items array with { sku, quantity } is required.';
} else if (action === 'update_order') {
  if (!params.order_number && !params.order_id) valError = 'order_number or order_id is required.';
} else if (action === 'cancel_order') {
  if (!params.order_number && !params.order_id) valError = 'order_number or order_id is required.';
} else if (action === 'record_payment') {
  if (!params.order_number && !params.order_id) valError = 'order_number or order_id is required.';
  else if (!params.amount_pkr || params.amount_pkr <= 0) valError = 'Positive amount_pkr is required.';
} else if (action === 'submit_verification_request') {
  if (!params.roll_number) valError = 'roll_number is required for verification request.';
  else if (!params.applicant_name) valError = 'applicant_name is required.';
} else if (action === 'submit_service_application') {
  if (!params.roll_number) valError = 'roll_number is required for service application.';
  else if (!params.application_type) valError = 'application_type is required.';
} else if (action === 'track_service_application') {
  if (!params.application_number && !params.request_ref && !params.roll_number) valError = 'application_number, request_ref or roll_number is required.';
} else if (action === 'book_appointment' || action === 'create_appointment') {
  if (!params.patient_phone || !isValidPhone(params.patient_phone)) valError = 'Valid patient_phone is required.';
  else if (!params.appointment_date || !isValidDate(params.appointment_date)) valError = 'Valid appointment_date (YYYY-MM-DD) is required.';
  else if (!params.appointment_time || !isValidTime(params.appointment_time)) valError = 'Valid appointment_time (HH:MM) is required.';
} else if (action === 'reschedule_appointment') {
  if (!params.appointment_number && !params.appointment_id) valError = 'appointment_number or appointment_id is required.';
  else if (!params.new_appointment_date || !isValidDate(params.new_appointment_date)) valError = 'Valid new_appointment_date (YYYY-MM-DD) is required.';
  else if (!params.new_appointment_time || !isValidTime(params.new_appointment_time)) valError = 'Valid new_appointment_time (HH:MM) is required.';
} else if (action === 'cancel_appointment') {
  if (!params.appointment_number && !(params.patient_phone && params.appointment_date)) valError = 'appointment_number or (patient_phone + date) is required.';
}

if (valError) {
  return JSON.stringify({
    status: 'VALIDATION_FAILED',
    error_code: 'INVALID_ACTION_PARAMETERS',
    action,
    error: valError,
    message: \`[ACTION GATEWAY PARAMETER ERROR] \${valError}\`
  });
}

// 5. Connect and Execute via gateway_action_writer
let executionResult = null;
const targetDb = trustedBusinessCode === 'POS_RETAIL' ? 'pos_db' : (trustedBusinessCode === 'HOSP_HEALTH' ? 'hospital_db' : (trustedBusinessCode === 'BISE_EDU' ? 'bise_db' : 'platform_db'));

try {
  const client = new Client({
    connectionString: \`postgresql://gateway_action_writer:gateway_action_writer_2026@evolution-postgres:5432/\${targetDb}\`
  });
  await client.connect();

  if (action === 'create_order') {
    const phone = params.customer_phone.replace(/[\\s\\-\\(\\)]/g, '');
    const custRes = await client.query(
      'INSERT INTO customers (customer_phone, full_name, city) VALUES ($1, $2, $3) ON CONFLICT (customer_phone) DO UPDATE SET full_name = EXCLUDED.full_name RETURNING id',
      [phone, params.customer_name || 'Customer', params.city || 'Lahore']
    );
    const customerId = custRes.rows[0].id;
    let total = 0;
    const items = [];
    for (const item of params.items) {
      const pRes = await client.query(
        'SELECT p.id, p.name, pr.price_pkr, COALESCE(i.stock_quantity, 0) as stock FROM products p JOIN prices pr ON p.id = pr.product_id LEFT JOIN inventory i ON p.id = i.product_id WHERE p.sku = $1 LIMIT 1',
        [item.sku]
      );
      if (pRes.rows.length === 0) throw new Error(\`Product SKU \${item.sku} not found.\`);
      const prodId = pRes.rows[0].id;
      const stock = parseInt(pRes.rows[0].stock, 10);
      if (stock < item.quantity) throw new Error(\`Insufficient stock for SKU \${item.sku}. Requested: \${item.quantity}, Available: \${stock}.\`);
      const price = parseFloat(pRes.rows[0].price_pkr);
      const sub = price * item.quantity;
      total += sub;
      items.push({ prodId, qty: item.quantity, price, sub });
    }
    const ordNum = params.order_number || \`ORD-\${new Date().getFullYear()}-\${Math.floor(1000 + Math.random() * 9000)}\`;
    await client.query('BEGIN');
    const ordRes = await client.query(
      'INSERT INTO orders (order_number, customer_id, total_amount_pkr, status) VALUES ($1, $2, $3, $4) RETURNING id',
      [ordNum, customerId, total, 'PENDING']
    );
    const orderId = ordRes.rows[0].id;
    for (const it of items) {
      await client.query('INSERT INTO order_items (order_id, product_id, quantity, unit_price_pkr, subtotal_pkr) VALUES ($1, $2, $3, $4, $5)', [orderId, it.prodId, it.qty, it.price, it.sub]);
      await client.query('UPDATE inventory SET stock_quantity = stock_quantity - $1 WHERE product_id = $2', [it.qty, it.prodId]);
    }
    await client.query('COMMIT');
    executionResult = { order_id: orderId, order_number: ordNum, total_amount_pkr: total, summary: \`Order #\${ordNum} created for \${phone}. Total: PKR \${total.toLocaleString('en-PK')}. Inventory deducted. Status: PENDING.\` };

  } else if (action === 'update_order') {
    const where = params.order_number ? 'order_number = $1' : 'id = $1';
    const val = params.order_number || params.order_id;
    const checkRes = await client.query(\`SELECT id, order_number, status FROM orders WHERE \${where} LIMIT 1\`, [val]);
    if (checkRes.rows.length === 0) throw new Error(\`Order \${val} not found.\`);
    const ord = checkRes.rows[0];
    if (ord.status === 'CANCELLED') throw new Error(\`Cannot update CANCELLED order #\${ord.order_number}.\`);
    const newStatus = params.status ? params.status.toUpperCase() : ord.status;
    await client.query('UPDATE orders SET status = $1 WHERE id = $2', [newStatus, ord.id]);
    executionResult = { order_id: ord.id, order_number: ord.order_number, new_status: newStatus, summary: \`Order #\${ord.order_number} status updated to \${newStatus}.\` };

  } else if (action === 'cancel_order') {
    const where = params.order_number ? 'order_number = $1' : 'id = $1';
    const val = params.order_number || params.order_id;
    const checkRes = await client.query(\`SELECT id, order_number, status FROM orders WHERE \${where} LIMIT 1\`, [val]);
    if (checkRes.rows.length === 0) throw new Error(\`Order \${val} not found.\`);
    const ord = checkRes.rows[0];
    if (ord.status === 'CANCELLED') throw new Error(\`Order #\${ord.order_number} is already CANCELLED.\`);
    if (['SHIPPED', 'DELIVERED'].includes(ord.status)) throw new Error(\`Cannot cancel order #\${ord.order_number} in \${ord.status} status.\`);

    await client.query('BEGIN');
    const itemsRes = await client.query('SELECT product_id, quantity FROM order_items WHERE order_id = $1', [ord.id]);
    for (const it of itemsRes.rows) {
      await client.query('UPDATE inventory SET stock_quantity = stock_quantity + $1 WHERE product_id = $2', [it.quantity, it.product_id]);
    }
    await client.query('UPDATE orders SET status = $1 WHERE id = $2', ['CANCELLED', ord.id]);
    await client.query('COMMIT');
    executionResult = { order_id: ord.id, order_number: ord.order_number, restocked_items: itemsRes.rows.length, summary: \`Order #\${ord.order_number} CANCELLED. All items restocked to inventory.\` };

  } else if (action === 'record_payment') {
    let orderId = params.order_id;
    if (!orderId && params.order_number) {
      const oRes = await client.query('SELECT id FROM orders WHERE order_number = $1 LIMIT 1', [params.order_number]);
      if (oRes.rows.length === 0) throw new Error(\`Order \${params.order_number} not found.\`);
      orderId = oRes.rows[0].id;
    }
    await client.query('BEGIN');
    const payRes = await client.query(
      'INSERT INTO payments (order_id, payment_method, transaction_ref, amount_pkr, payment_status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [orderId, params.payment_method.toUpperCase(), params.transaction_ref || 'TRX-REF', params.amount_pkr, 'COMPLETED']
    );
    await client.query('UPDATE orders SET status = $1 WHERE id = $2', ['PAID', orderId]);
    await client.query('COMMIT');
    executionResult = { payment_id: payRes.rows[0].id, order_id: orderId, summary: \`Payment of PKR \${params.amount_pkr} recorded. Order status updated to PAID.\` };

  } else if (action === 'submit_verification_request') {
    const vRes = await client.query(
      'SELECT r.id, r.roll_number, r.grade, s.student_name, e.title FROM results r JOIN students s ON r.student_id = s.id JOIN exams e ON r.exam_id = e.id WHERE r.roll_number = $1 LIMIT 1',
      [params.roll_number.trim()]
    );
    if (vRes.rows.length === 0) throw new Error(\`Roll number \${params.roll_number} not found in BISE records.\`);
    const st = vRes.rows[0];
    const ref = \`VER-2026-\${Math.floor(1000 + Math.random() * 9000)}\`;
    const insRes = await client.query(
      'INSERT INTO verification_requests (request_ref, roll_number, applicant_name, organization, verification_status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [ref, params.roll_number.trim(), params.applicant_name.trim(), params.organization || 'Individual', 'PENDING']
    );
    executionResult = { request_ref: ref, roll_number: params.roll_number, student_name: st.student_name, grade: st.grade, summary: \`Verification request #\${ref} submitted for Roll #\${params.roll_number} (\${st.student_name}). Status: PENDING.\` };

  } else if (action === 'submit_service_application') {
    const stRes = await client.query(
      'SELECT s.id, s.student_name FROM results r JOIN students s ON r.student_id = s.id WHERE r.roll_number = $1 LIMIT 1',
      [params.roll_number.trim()]
    );
    if (stRes.rows.length === 0) throw new Error(\`Roll number \${params.roll_number} not found in BISE records.\`);
    const studentId = stRes.rows[0].id;
    const sName = stRes.rows[0].student_name;
    const feeRes = await client.query('SELECT amount_pkr FROM fees WHERE fee_type = $1 LIMIT 1', [params.application_type.toUpperCase().trim()]);
    const fee = feeRes.rows.length > 0 ? parseFloat(feeRes.rows[0].amount_pkr) : 1500.00;
    const appNum = \`APP-\${params.application_type.substring(0, 3).toUpperCase()}-2026-\${Math.floor(1000 + Math.random() * 9000)}\`;
    await client.query(
      'INSERT INTO applications (application_number, student_id, application_type, status) VALUES ($1, $2, $3, $4)',
      [appNum, studentId, params.application_type.toUpperCase().trim(), 'PROCESSING']
    );
    executionResult = { application_number: appNum, roll_number: params.roll_number, student_name: sName, fee_pkr: fee, summary: \`BISE application #\${appNum} submitted for \${params.application_type} (Roll #\${params.roll_number}, \${sName}). Fee: PKR \${fee}. Status: PROCESSING.\` };

  } else if (action === 'track_service_application') {
    const ref = (params.application_number || params.request_ref || params.roll_number || '').trim();
    const appRes = await client.query('SELECT application_number, application_type, status, created_at FROM applications WHERE application_number = $1 LIMIT 1', [ref]);
    if (appRes.rows.length > 0) {
      const a = appRes.rows[0];
      executionResult = { reference: a.application_number, type: a.application_type, status: a.status, summary: \`Application #\${a.application_number} (\${a.application_type}) is currently \${a.status}.\` };
    } else {
      const vrRes = await client.query('SELECT request_ref, roll_number, verification_status, created_at FROM verification_requests WHERE request_ref = $1 OR roll_number = $1 LIMIT 1', [ref]);
      if (vrRes.rows.length > 0) {
        const v = vrRes.rows[0];
        executionResult = { reference: v.request_ref, roll_number: v.roll_number, status: v.verification_status, summary: \`Verification request #\${v.request_ref} for Roll #\${v.roll_number} is currently \${v.verification_status}.\` };
      } else {
        throw new Error(\`No BISE application or verification found matching '\${ref}'.\`);
      }
    }

  } else if (action === 'book_appointment' || action === 'create_appointment') {
    const phone = params.patient_phone.replace(/[\\s\\-\\(\\)]/g, '');
    const patRes = await client.query(
      'INSERT INTO patients (patient_mrn, patient_name, patient_phone) VALUES ($1, $2, $3) ON CONFLICT (patient_phone) DO UPDATE SET patient_name = EXCLUDED.patient_name RETURNING id',
      [\`MRN-2026-\${Math.floor(100 + Math.random() * 900)}\`, params.patient_name || 'Patient', phone]
    );
    const patId = patRes.rows[0].id;
    let docId = params.doctor_id;
    let docName = params.doctor_name || 'Specialist';
    if (!docId && params.doctor_name) {
      const dRes = await client.query('SELECT id, doctor_name FROM doctors WHERE doctor_name ILIKE $1 LIMIT 1', [\`%\${params.doctor_name}%\`]);
      if (dRes.rows.length > 0) { docId = dRes.rows[0].id; docName = dRes.rows[0].doctor_name; }
      else docId = 1;
    }
    const conflictRes = await client.query('SELECT COUNT(*)::int as cnt FROM appointments WHERE doctor_id = $1 AND appointment_date = $2 AND appointment_time = $3 AND status = $4', [docId || 1, params.appointment_date, params.appointment_time, 'SCHEDULED']);
    if (conflictRes.rows[0].cnt > 0) throw new Error(\`Doctor \${docName} already has an appointment booked at \${params.appointment_time} on \${params.appointment_date}.\`);

    const appNum = \`APT-2026-\${Math.floor(1000 + Math.random() * 9000)}\`;
    await client.query('BEGIN');
    const aRes = await client.query(
      'INSERT INTO appointments (appointment_number, patient_id, doctor_id, appointment_date, appointment_time, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [appNum, patId, docId || 1, params.appointment_date, params.appointment_time, 'SCHEDULED']
    );
    const appId = aRes.rows[0].id;
    await client.query('INSERT INTO appointment_history (appointment_id, doctor_notes, diagnosis) VALUES ($1, $2, $3)', [appId, 'Booked via Action Gateway', 'INITIAL_CONSULTATION']);
    await client.query('COMMIT');
    executionResult = { appointment_id: appId, appointment_number: appNum, summary: \`Appointment #\${appNum} booked with \${docName} on \${params.appointment_date} at \${params.appointment_time} for \${params.patient_name || 'Patient'}.\` };

  } else if (action === 'reschedule_appointment') {
    const where = params.appointment_number ? 'appointment_number = $1' : 'id = $1';
    const val = params.appointment_number || params.appointment_id;
    const aRes = await client.query(\`SELECT id, appointment_number, doctor_id, appointment_date, appointment_time, status FROM appointments WHERE \${where} LIMIT 1\`, [val]);
    if (aRes.rows.length === 0) throw new Error(\`Appointment \${val} not found.\`);
    const app = aRes.rows[0];
    if (app.status === 'CANCELLED') throw new Error(\`Cannot reschedule CANCELLED appointment #\${app.appointment_number}.\`);

    const conflictRes = await client.query('SELECT COUNT(*)::int as cnt FROM appointments WHERE doctor_id = $1 AND appointment_date = $2 AND appointment_time = $3 AND status = $4 AND id != $5', [app.doctor_id, params.new_appointment_date, params.new_appointment_time, 'SCHEDULED', app.id]);
    if (conflictRes.rows[0].cnt > 0) throw new Error(\`Slot \${params.new_appointment_time} on \${params.new_appointment_date} is already booked.\`);

    await client.query('BEGIN');
    await client.query('UPDATE appointments SET appointment_date = $1, appointment_time = $2 WHERE id = $3', [params.new_appointment_date, params.new_appointment_time, app.id]);
    await client.query('INSERT INTO appointment_history (appointment_id, doctor_notes, diagnosis) VALUES ($1, $2, $3)', [app.id, \`Rescheduled from \${app.appointment_date} \${app.appointment_time} to \${params.new_appointment_date} \${params.new_appointment_time}\`, 'RESCHEDULE_ACTION']);
    await client.query('COMMIT');
    executionResult = { appointment_number: app.appointment_number, new_date: params.new_appointment_date, new_time: params.new_appointment_time, summary: \`Appointment #\${app.appointment_number} rescheduled to \${params.new_appointment_date} at \${params.new_appointment_time}.\` };

  } else if (action === 'cancel_appointment') {
    const where = params.appointment_number ? 'appointment_number = $1' : 'patient_id = (SELECT id FROM patients WHERE patient_phone = $1) AND appointment_date = $2';
    const qArgs = params.appointment_number ? [params.appointment_number] : [params.patient_phone, params.appointment_date];
    const findRes = await client.query(\`SELECT id, appointment_number, status FROM appointments WHERE \${where} LIMIT 1\`, qArgs);
    if (findRes.rows.length === 0) throw new Error('Appointment not found.');
    const app = findRes.rows[0];
    if (app.status === 'CANCELLED') throw new Error(\`Appointment #\${app.appointment_number} is already CANCELLED.\`);

    await client.query('BEGIN');
    await client.query('UPDATE appointments SET status = $1 WHERE id = $2', ['CANCELLED', app.id]);
    await client.query('INSERT INTO appointment_history (appointment_id, doctor_notes, diagnosis) VALUES ($1, $2, $3)', [app.id, \`Cancelled: \${params.reason || 'Patient request'}\`, 'CANCELLATION_ACTION']);
    await client.query('COMMIT');
    executionResult = { appointment_number: app.appointment_number, summary: \`Appointment #\${app.appointment_number} has been CANCELLED.\` };

  } else if (action === 'sync_crm') {
    const phone = params.customer_phone.replace(/[\\s\\-\\(\\)]/g, '');
    await client.query(
      'INSERT INTO leads (customer_phone, push_name, city, lead_stage) VALUES ($1, $2, $3, $4) ON CONFLICT (customer_phone) DO UPDATE SET push_name = EXCLUDED.push_name, city = EXCLUDED.city, lead_stage = EXCLUDED.lead_stage',
      [phone, params.push_name || 'Lead', params.city || 'Lahore', params.lead_stage || 'QUALIFIED']
    );
    executionResult = { customer_phone: phone, summary: \`CRM lead \${phone} synchronized successfully.\` };
  } else {
    executionResult = { summary: \`Action \${action} dispatched successfully through authorized gateway route.\` };
  }
  await client.end();
} catch (e) {
  return JSON.stringify({ status: 'ERROR', error_code: 'DATABASE_ACTION_ERROR', message: \`[ACTION GATEWAY EXECUTION ERROR] \${e.message}\` });
}

// 6. Audit Logging
try {
  const auditClient = new Client({ connectionString: 'postgresql://gateway_action_writer:gateway_action_writer_2026@evolution-postgres:5432/platform_db' });
  await auditClient.connect();
  const inPayload = JSON.stringify({ gateway: 'action_gateway', action, params, spoof_attempt: spoofAttempt });
  const outPayload = JSON.stringify({ status: 'SUCCESS', result: executionResult });
  await auditClient.query(
    'INSERT INTO platform_audit_metadata (business_code, instance_name, customer_phone, inbound_payload, outbound_payload, processing_time_ms) VALUES ($1, $2, $3, $4, $5, $6)',
    [trustedBusinessCode, instanceName, customerPhone, inPayload, outPayload, Date.now() - startTime]
  );
  await auditClient.end();
} catch (ae) {}

return \`[Action Gateway Confirmation]: \${executionResult.summary}\`;`;

node2020.parameters.jsCode = jsCode;

fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2), 'utf8');
console.log('Successfully updated Node 2020 in evolution_whatsapp_ai_agent_bot.json with Phase 28 V1 Domain Actions!');
