const fs = require('fs');

const workflowFile = 'evolution_whatsapp_ai_agent_bot.json';
const data = JSON.parse(fs.readFileSync(workflowFile, 'utf8'));

// 1. Define Node 2019: Tool: Business Data Gateway
const node2019 = {
  parameters: {
    name: "query_business_data",
    description: "Centralized Data Gateway to query verified structured records from the domain database (products/prices for Retail, student roll number results for BISE Board, doctor schedules for Hospital). Accepts operation ('GET_PRODUCTS', 'GET_PRODUCT_BY_SKU', 'CHECK_INVENTORY', 'GET_EXAM_RESULT', 'GET_FEES', 'GET_DOCTORS_BY_SPECIALTY', 'GET_DOCTOR_SCHEDULE') and parameters.",
    specifyInputSchema: true,
    jsonSchema: "{\n  \"type\": \"object\",\n  \"properties\": {\n    \"operation\": {\n      \"type\": \"string\",\n      \"description\": \"Approved operation: GET_PRODUCTS, GET_PRODUCT_BY_SKU, CHECK_INVENTORY, GET_EXAM_RESULT, GET_FEES, GET_DOCTORS_BY_SPECIALTY, GET_DOCTOR_SCHEDULE\"\n    },\n    \"parameters\": {\n      \"type\": \"object\",\n      \"description\": \"Filter parameters like { sku }, { roll_number }, { specialty }, or { doctor_name }\"\n    }\n  },\n  \"required\": [\"operation\"]\n}",
    jsCode: `const { Client } = require('/usr/local/lib/node_modules/n8n/node_modules/pg');
const input = $input.first()?.json || {};
const incoming = ($('PostgreSQL Persistent Conversation Store').first() || $('Message Normalizer').first() || $json)?.json || {};

const businessCode = incoming.business_code || 'POS_RETAIL';
const allowedTools = incoming.allowed_tools || ['query_business_data', 'search_knowledge_base'];
const targetDbName = incoming.target_db_name || (businessCode === 'BISE_EDU' ? 'bise_db' : businessCode === 'HOSP_HEALTH' ? 'hospital_db' : 'pos_db');
const operation = (input.operation || '').trim().toUpperCase();
const params = input.parameters || {};

// ================= POLICY & PERMISSION GATE =================
if (!allowedTools.includes('query_business_data')) {
  return JSON.stringify({
    status: 'SECURITY_POLICY_DENIED',
    error_code: 'POLICY_UNAUTHORIZED_TOOL',
    tool: 'query_business_data',
    tenant: businessCode,
    action: 'READ',
    message: \`[DATA GATEWAY SECURITY DENIAL] Tool 'query_business_data' is NOT authorized for tenant '\${businessCode}'. Access terminated outside LLM.\`
  });
}

// Enforce Domain Operation Scope
const domainAllowedOps = {
  'POS_RETAIL': ['GET_PRODUCTS', 'GET_PRODUCT_BY_SKU', 'CHECK_INVENTORY'],
  'BISE_EDU': ['GET_EXAM_RESULT', 'GET_FEES'],
  'HOSP_HEALTH': ['GET_DOCTORS_BY_SPECIALTY', 'GET_DOCTOR_SCHEDULE', 'GET_DEPARTMENTS']
};

const allowedForTenant = domainAllowedOps[businessCode] || [];
if (!allowedForTenant.includes(operation)) {
  return JSON.stringify({
    status: 'GATEWAY_CROSS_DOMAIN_DENIED',
    error_code: 'GATEWAY_OPERATION_UNAUTHORIZED_FOR_TENANT',
    requested_operation: operation,
    tenant: businessCode,
    allowed_operations: allowedForTenant,
    message: \`[DATA GATEWAY VIOLATION] Operation '\${operation}' is not permitted for tenant '\${businessCode}'. Cross-tenant or unapproved read operations are strictly blocked.\`
  });
}
// ============================================================

const startTime = Date.now();
let results = [];
let queryExecuted = '';

try {
  const client = new Client({ connectionString: \`postgresql://postgres:postgres@evolution-postgres:5432/\${targetDbName}\` });
  await client.connect();

  if (businessCode === 'POS_RETAIL') {
    if (operation === 'GET_PRODUCTS') {
      const q = 'SELECT p.sku, p.name, pr.price_pkr, i.stock_quantity FROM products p LEFT JOIN prices pr ON p.id = pr.product_id LEFT JOIN inventory i ON p.id = i.product_id WHERE p.is_active = TRUE LIMIT 10;';
      queryExecuted = q;
      const res = await client.query(q);
      results = res.rows;
    } else if (operation === 'GET_PRODUCT_BY_SKU') {
      const q = 'SELECT p.sku, p.name, p.description, pr.price_pkr, i.stock_quantity FROM products p LEFT JOIN prices pr ON p.id = pr.product_id LEFT JOIN inventory i ON p.id = i.product_id WHERE p.sku = $1 LIMIT 1;';
      queryExecuted = q;
      const res = await client.query(q, [params.sku || 'BOT-SETUP-01']);
      results = res.rows;
    } else if (operation === 'CHECK_INVENTORY') {
      const q = 'SELECT p.sku, p.name, i.stock_quantity, i.reorder_level FROM products p JOIN inventory i ON p.id = i.product_id WHERE p.sku = $1;';
      queryExecuted = q;
      const res = await client.query(q, [params.sku || '']);
      results = res.rows;
    }
  } else if (businessCode === 'BISE_EDU') {
    if (operation === 'GET_EXAM_RESULT') {
      const rollNum = String(params.roll_number || '102450').trim();
      const q = 'SELECT r.roll_number, s.student_name, e.title AS exam_title, e.exam_year, r.marks_obtained, r.total_marks, r.grade, r.status FROM results r JOIN students s ON r.student_id = s.id JOIN exams e ON r.exam_id = e.id WHERE r.roll_number = $1 LIMIT 1;';
      queryExecuted = q;
      const res = await client.query(q, [rollNum]);
      results = res.rows;
    } else if (operation === 'GET_FEES') {
      const q = 'SELECT fee_type, amount_pkr, description FROM fees;';
      queryExecuted = q;
      const res = await client.query(q);
      results = res.rows;
    }
  } else if (businessCode === 'HOSP_HEALTH') {
    if (operation === 'GET_DOCTORS_BY_SPECIALTY') {
      const spec = params.specialty ? \`%\${params.specialty}%\` : '%';
      const q = 'SELECT d.id, d.doctor_name, d.specialty, d.opd_fee_pkr, d.qualification, dep.department_name FROM doctors d LEFT JOIN departments dep ON d.department_id = dep.id WHERE d.specialty ILIKE $1;';
      queryExecuted = q;
      const res = await client.query(q, [spec]);
      results = res.rows;
    } else if (operation === 'GET_DOCTOR_SCHEDULE') {
      const docName = params.doctor_name ? \`%\${params.doctor_name}%\` : '%';
      const q = 'SELECT d.doctor_name, d.specialty, s.available_days, s.opd_timings, s.max_daily_patients FROM doctors d JOIN schedules s ON d.id = s.doctor_id WHERE d.doctor_name ILIKE $1 LIMIT 5;';
      queryExecuted = q;
      const res = await client.query(q, [docName]);
      results = res.rows;
    } else if (operation === 'GET_DEPARTMENTS') {
      const q = 'SELECT department_name, location_floor, head_doctor FROM departments;';
      queryExecuted = q;
      const res = await client.query(q);
      results = res.rows;
    }
  }

  await client.end();
} catch (e) {
  console.error('Data Gateway DB Execution Error:', e.message);
}

// Log Structured Read Access in platform_audit_metadata
const durationMs = Date.now() - startTime;
try {
  const auditClient = new Client({ connectionString: 'postgresql://postgres:postgres@evolution-postgres:5432/platform_db' });
  await auditClient.connect();
  const auditQ = 'INSERT INTO platform_audit_metadata (business_code, instance_name, customer_phone, inbound_payload, outbound_payload, processing_time_ms) VALUES ($1, $2, $3, $4, $5, $6);';
  await auditClient.query(auditQ, [
    businessCode,
    incoming.instance_name || 'unknown-instance',
    incoming.customerPhone || 'unknown-user',
    JSON.stringify({ tool: 'query_business_data', operation: operation, parameters: params }),
    JSON.stringify({ row_count: results.length, target_db: targetDbName }),
    durationMs
  ]);
  await auditClient.end();
} catch (ae) {
  console.error('Audit Logging Error:', ae.message);
}

return JSON.stringify({
  status: 'GATEWAY_SUCCESS',
  tenant: businessCode,
  target_database: targetDbName,
  operation: operation,
  count: results.length,
  records: results
});`
  },
  id: "2019",
  name: "Tool: Business Data Gateway",
  type: "@n8n/n8n-nodes-langchain.toolCustom",
  typeVersion: 1.1,
  position: [
    0,
    2140
  ]
};

// Check if Node 2019 already exists
const existingIdx = data.nodes.findIndex(n => n.id === '2019');
if (existingIdx >= 0) {
  data.nodes[existingIdx] = node2019;
} else {
  data.nodes.push(node2019);
}

// 2. Update Node 2012 (Profile Loader) to include query_business_data in tool fallbacks
const node2012 = data.nodes.find(n => n.id === '2012');
if (node2012) {
  node2012.parameters.jsCode = node2012.parameters.jsCode
    .replace("allowedTools = ['search_knowledge_base', 'sync_crm'];", "allowedTools = ['search_knowledge_base', 'sync_crm', 'query_business_data'];")
    .replace("allowedTools = ['search_knowledge_base', 'check_exam_results'];", "allowedTools = ['search_knowledge_base', 'check_exam_results', 'query_business_data'];")
    .replace("allowedTools = ['search_knowledge_base', 'manage_calendar'];", "allowedTools = ['search_knowledge_base', 'manage_calendar', 'query_business_data'];");
  console.log('PASS: Updated Node 2012 allowed_tools with query_business_data.');
}

// 3. Connect Node 2019 to AI Agent (Shared Engine)
data.connections["Tool: Business Data Gateway"] = {
  ai_tool: [
    [
      {
        node: "AI Agent (Shared Engine)",
        type: "ai_tool",
        index: 0
      }
    ]
  ]
};

fs.writeFileSync(workflowFile, JSON.stringify(data, null, 2), 'utf8');
console.log('PASS: Injected Node 2019 (Tool: Business Data Gateway) into ' + workflowFile);
