const fs = require('fs');

const workflowFile = 'evolution_whatsapp_ai_agent_bot.json';
const data = JSON.parse(fs.readFileSync(workflowFile, 'utf8'));

// 1. Define Node 2019: Tool: Business Data Gateway (Enhanced with Phase 20 Secure Structured SQL Tools)
const node2019 = {
  parameters: {
    name: "query_business_data",
    description: "Centralized Secure Structured Data Gateway for verified parameterized database queries. Operates under least-privilege DB roles. Supported approved operations:\n- POS Retail: get_product, check_inventory, get_price\n- BISE Education: get_student_result, get_fees\n- Hospital Healthcare: get_doctor_schedule, get_doctors_by_specialty, get_departments.\nArbitrary dynamic SQL and destructive commands are strictly prohibited.",
    specifyInputSchema: true,
    jsonSchema: JSON.stringify({
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: [
            "get_product",
            "check_inventory",
            "get_price",
            "get_student_result",
            "get_doctor_schedule",
            "get_doctors_by_specialty",
            "get_fees",
            "get_departments"
          ],
          description: "Approved structured read operation."
        },
        parameters: {
          type: "object",
          properties: {
            sku: { type: "string", description: "Product SKU (e.g. POS-HW-001, POS-SW-001)" },
            product_name: { type: "string", description: "Product name or search keyword" },
            roll_number: { type: "string", description: "Student roll number (e.g. 102450, 204501)" },
            specialty: { type: "string", description: "Medical specialty (e.g. Cardiology, Pediatrics)" },
            doctor_name: { type: "string", description: "Doctor name (e.g. Dr. Tariq Mahmood)" },
            fee_type: { type: "string", description: "Fee type (e.g. ADMISSION_MATRIC, NOC_MIGRATION)" }
          }
        }
      },
      required: ["operation"]
    }, null, 2),
    jsCode: `const { Client } = require('/usr/local/lib/node_modules/n8n/node_modules/pg');
const input = $input.first()?.json || {};
const incoming = ($('PostgreSQL Persistent Conversation Store').first() || $('Message Normalizer').first() || $json)?.json || {};

const businessCode = incoming.business_code || 'POS_RETAIL';
const allowedTools = incoming.allowed_tools || ['query_business_data', 'get_product', 'check_inventory', 'get_price'];
const targetDbName = incoming.target_db_name || (businessCode === 'BISE_EDU' ? 'bise_db' : businessCode === 'HOSP_HEALTH' ? 'hospital_db' : 'pos_db');
const rawOperation = (input.operation || '').trim();
const operation = rawOperation.toLowerCase();
const params = input.parameters || {};

// ================= 1. SQL INJECTION & DESTRUCTIVE SQL INTERCEPTOR =================
const INJECTION_PATTERN = /(\\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER|CREATE|GRANT|REVOKE|EXEC|UNION)\\b|--|\\/\\*|\\*\\/|;|\\bOR\\b\\s+['\\d\\w]+=['\\d\\w]+|\\bAND\\b\\s+['\\d\\w]+=['\\d\\w]+)/i;

const checkPayload = JSON.stringify({ operation: rawOperation, params: params });
if (INJECTION_PATTERN.test(checkPayload)) {
  return JSON.stringify({
    status: 'SECURITY_SQL_INJECTION_DETECTED',
    error_code: 'DESTRUCTIVE_SQL_BLOCKED',
    tenant: businessCode,
    requested_operation: rawOperation,
    message: '[SQL SECURITY VIOLATION] Malicious SQL tokens or destructive statements detected. Execution halted outside database.'
  });
}

// ================= 2. POLICY & DOMAIN SCOPE GATE =================
const domainAllowedOps = {
  'POS_RETAIL': ['get_product', 'get_products', 'get_product_by_sku', 'check_inventory', 'get_price'],
  'BISE_EDU': ['get_student_result', 'get_exam_result', 'get_fees'],
  'HOSP_HEALTH': ['get_doctor_schedule', 'get_doctors_by_specialty', 'get_departments']
};

const allowedForTenant = domainAllowedOps[businessCode] || [];
if (!allowedForTenant.includes(operation)) {
  return JSON.stringify({
    status: 'GATEWAY_CROSS_DOMAIN_DENIED',
    error_code: 'CROSS_DOMAIN_OPERATION_UNAUTHORIZED',
    requested_operation: rawOperation,
    tenant: businessCode,
    allowed_operations: allowedForTenant,
    message: \`[DATA GATEWAY VIOLATION] Operation '\${rawOperation}' is not permitted for tenant '\${businessCode}'. Cross-tenant read operations are strictly blocked.\`
  });
}

// ================= 3. PARAMETERIZED QUERY EXECUTION (LEAST-PRIVILEGE ROLE) =================
const startTime = Date.now();
let results = [];
let queryExecuted = '';

try {
  // Connect using least-privilege read-only credentials
  const client = new Client({
    connectionString: \`postgresql://gateway_readonly:gateway_secure_readonly_2026@evolution-postgres:5432/\${targetDbName}\`
  });
  await client.connect();

  if (businessCode === 'POS_RETAIL') {
    if (operation === 'get_product' || operation === 'get_product_by_sku') {
      const sku = params.sku ? String(params.sku).trim() : null;
      const name = params.product_name || params.name ? \`%\${String(params.product_name || params.name).trim()}%\` : null;
      const q = \`SELECT DISTINCT ON (p.id) p.sku, p.name, p.description, pr.price_pkr, pr.currency, i.stock_quantity 
                 FROM products p 
                 LEFT JOIN prices pr ON p.id = pr.product_id 
                 LEFT JOIN inventory i ON p.id = i.product_id 
                 WHERE ($1::text IS NULL OR p.sku = $1) 
                   AND ($2::text IS NULL OR p.name ILIKE $2) 
                 ORDER BY p.id, pr.effective_date DESC 
                 LIMIT 10;\`;
      queryExecuted = q;
      const res = await client.query(q, [sku, name]);
      results = res.rows;
    } else if (operation === 'get_products') {
      const q = \`SELECT DISTINCT ON (p.id) p.sku, p.name, pr.price_pkr, i.stock_quantity 
                 FROM products p 
                 LEFT JOIN prices pr ON p.id = pr.product_id 
                 LEFT JOIN inventory i ON p.id = i.product_id 
                 WHERE p.is_active = TRUE 
                 ORDER BY p.id, pr.effective_date DESC 
                 LIMIT 10;\`;
      queryExecuted = q;
      const res = await client.query(q);
      results = res.rows;
    } else if (operation === 'check_inventory') {
      const sku = String(params.sku || '').trim();
      const q = \`SELECT p.sku, p.name, i.stock_quantity, i.reorder_level, 
                        CASE WHEN i.stock_quantity > i.reorder_level THEN 'IN_STOCK' 
                             WHEN i.stock_quantity > 0 THEN 'LOW_STOCK' 
                             ELSE 'OUT_OF_STOCK' END AS stock_status 
                 FROM products p 
                 JOIN inventory i ON p.id = i.product_id 
                 WHERE p.sku = $1;\`;
      queryExecuted = q;
      const res = await client.query(q, [sku]);
      results = res.rows;
    } else if (operation === 'get_price') {
      const sku = String(params.sku || '').trim();
      const q = \`SELECT p.sku, p.name, pr.price_pkr, pr.currency 
                 FROM products p 
                 JOIN prices pr ON p.id = pr.product_id 
                 WHERE p.sku = $1 
                 ORDER BY pr.effective_date DESC, pr.id DESC 
                 LIMIT 1;\`;
      queryExecuted = q;
      const res = await client.query(q, [sku]);
      results = res.rows;
    }
  } else if (businessCode === 'BISE_EDU') {
    if (operation === 'get_student_result' || operation === 'get_exam_result') {
      const rollNum = String(params.roll_number || params.rollNumber || '').trim();
      const q = \`SELECT r.roll_number, s.student_name, s.father_name, e.title AS exam_title, 
                        e.exam_year, e.exam_session, r.marks_obtained, r.total_marks, r.grade, r.status 
                 FROM results r 
                 JOIN students s ON r.student_id = s.id 
                 JOIN exams e ON r.exam_id = e.id 
                 WHERE r.roll_number = $1 
                 LIMIT 1;\`;
      queryExecuted = q;
      const res = await client.query(q, [rollNum]);
      results = res.rows;
    } else if (operation === 'get_fees') {
      const feeType = params.fee_type ? \`%\${String(params.fee_type).trim()}%\` : null;
      const q = \`SELECT fee_type, amount_pkr, description 
                 FROM fees 
                 WHERE ($1::text IS NULL OR fee_type ILIKE $1);\`;
      queryExecuted = q;
      const res = await client.query(q, [feeType]);
      results = res.rows;
    }
  } else if (businessCode === 'HOSP_HEALTH') {
    if (operation === 'get_doctor_schedule') {
      const docName = params.doctor_name ? \`%\${String(params.doctor_name).trim()}%\` : null;
      const q = \`SELECT d.doctor_name, d.specialty, d.opd_fee_pkr, s.available_days, s.opd_timings, s.max_daily_patients 
                 FROM doctors d 
                 JOIN schedules s ON d.id = s.doctor_id 
                 WHERE ($1::text IS NULL OR d.doctor_name ILIKE $1) 
                 LIMIT 10;\`;
      queryExecuted = q;
      const res = await client.query(q, [docName]);
      results = res.rows;
    } else if (operation === 'get_doctors_by_specialty') {
      const spec = params.specialty ? \`%\${String(params.specialty).trim()}%\` : '%';
      const q = \`SELECT d.id, d.doctor_name, d.specialty, d.opd_fee_pkr, d.qualification, dep.department_name, dep.location_floor 
                 FROM doctors d 
                 LEFT JOIN departments dep ON d.department_id = dep.id 
                 WHERE d.specialty ILIKE $1;\`;
      queryExecuted = q;
      const res = await client.query(q, [spec]);
      results = res.rows;
    } else if (operation === 'get_departments') {
      const q = \`SELECT department_name, location_floor, head_doctor FROM departments;\`;
      queryExecuted = q;
      const res = await client.query(q);
      results = res.rows;
    }
  }

  await client.end();
} catch (e) {
  console.error('Structured SQL Tool Execution Error:', e.message);
  return JSON.stringify({
    status: 'DATABASE_EXECUTION_ERROR',
    error: e.message,
    tenant: businessCode,
    target_database: targetDbName
  });
}

// ================= 4. ACCESS AUDIT LOGGING =================
const durationMs = Date.now() - startTime;
try {
  const auditClient = new Client({
    connectionString: 'postgresql://gateway_readonly:gateway_secure_readonly_2026@evolution-postgres:5432/platform_db'
  });
  await auditClient.connect();
  const auditQ = \`INSERT INTO platform_audit_metadata 
                  (business_code, instance_name, customer_phone, inbound_payload, outbound_payload, processing_time_ms) 
                  VALUES ($1, $2, $3, $4, $5, $6);\`;
  await auditClient.query(auditQ, [
    businessCode,
    incoming.instance_name || 'unknown-instance',
    incoming.customerPhone || 'unknown-user',
    JSON.stringify({ tool: 'secure_structured_sql', operation: rawOperation, parameters: params }),
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
  operation: rawOperation,
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

// Replace or Insert Node 2019
const existingIdx = data.nodes.findIndex(n => n.id === '2019');
if (existingIdx >= 0) {
  data.nodes[existingIdx] = node2019;
} else {
  data.nodes.push(node2019);
}

// 2. Update Node 2012 (Profile Loader) to add structured tools to allowedTools
const node2012 = data.nodes.find(n => n.id === '2012');
if (node2012) {
  node2012.parameters.jsCode = node2012.parameters.jsCode
    .replace(
      "allowedTools = ['search_knowledge_base', 'sync_crm', 'query_business_data'];",
      "allowedTools = ['search_knowledge_base', 'sync_crm', 'query_business_data', 'get_product', 'check_inventory', 'get_price'];"
    )
    .replace(
      "allowedTools = ['search_knowledge_base', 'check_exam_results', 'query_business_data'];",
      "allowedTools = ['search_knowledge_base', 'check_exam_results', 'query_business_data', 'get_student_result', 'get_fees'];"
    )
    .replace(
      "allowedTools = ['search_knowledge_base', 'manage_calendar', 'query_business_data'];",
      "allowedTools = ['search_knowledge_base', 'manage_calendar', 'query_business_data', 'get_doctor_schedule', 'get_doctors_by_specialty', 'get_departments'];"
    );
  console.log('PASS: Updated Node 2012 allowed_tools with Phase 20 structured SQL tools.');
}

// 3. Ensure AI Agent Tool Connection
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
console.log('PASS: Updated Node 2019 with Secure Structured SQL Tools in ' + workflowFile);
