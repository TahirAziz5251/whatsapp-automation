const fs = require('fs');
const { execSync } = require('child_process');

console.log('================ IMPLEMENTING PHASE 22: KNOWLEDGE SCHEMA + ISOLATION ================');

// 1. Seed Canonical Multi-Tenant Knowledge Documents & Chunks into platform_db
function runPsql(sql) {
  return execSync(
    `docker exec -i evolution-postgres psql -U postgres -d platform_db -t`,
    { input: sql, encoding: 'utf8' }
  ).trim();
}

// Generate sample 384-dim unit vector
function generateVector(dim) {
  const v = new Array(384).fill(0.01);
  v[dim] = 0.99;
  return `[${v.join(',')}]`;
}

const seedSql = `
-- Clean existing test rows
TRUNCATE TABLE knowledge_chunks, knowledge_documents RESTART IDENTITY CASCADE;

-- Insert POS Retail Documents
INSERT INTO knowledge_documents (business_code, namespace, source, title, doc_type, version, status, content)
VALUES 
  ('POS_RETAIL', 'pos_collection', 'catalog', 'POS Hardware & Warranty Policy', 'POLICY', 'v1.0', 'ACTIVE',
   'Official hardware catalog and warranty policy for GlimsTech POS retail products including 80mm thermal receipt printers, omnidirectional 2D barcode scanners, cash drawers, and touch POS terminals with 1-year replacement warranty.'),
  ('POS_RETAIL', 'pos_collection', 'manual', 'POS Software Features & Demo Guide', 'SPECIFICATION', 'v1.0', 'ACTIVE',
   'Detailed guide for GlimsTech POS Desktop Pro software license featuring offline inventory sync, fast barcode billing, multi-store support, daily sales summary reports, and PKR price quotations.');

-- Insert BISE Education Documents
INSERT INTO knowledge_documents (business_code, namespace, source, title, doc_type, version, status, content)
VALUES 
  ('BISE_EDU', 'bise_collection', 'official_gazette', 'Matric & Intermediate Examination Rules', 'POLICY', 'v1.0', 'ACTIVE',
   'Official Board of Intermediate and Secondary Education regulations regarding matric and intermediate annual and supplementary examination criteria, minimum 33% passing marks per subject, A+ to F grade thresholds, and online result checking via 6-digit roll numbers.'),
  ('BISE_EDU', 'bise_collection', 'fee_schedule', 'Migration Certificate (NOC) & Duplicate Degree Policy', 'GUIDELINE', 'v1.0', 'ACTIVE',
   'Board migration certificate NOC application procedure, urgent processing fee of PKR 1800, and duplicate degree certificate urgent fee of PKR 3500 payable via bank challan.');

-- Insert Hospital Healthcare Documents
INSERT INTO knowledge_documents (business_code, namespace, source, title, doc_type, version, status, content)
VALUES 
  ('HOSP_HEALTH', 'hosp_collection', 'directory', 'OPD Clinic Timings & Specialty Directory', 'DIRECTORY', 'v1.0', 'ACTIVE',
   'City Healthcare & Hospital specialist clinical directory covering Cardiology, Pediatrics, Neurology, and Orthopedics. OPD consulting hours are Monday through Saturday 9:00 AM to 6:00 PM with 24/7 emergency medical trauma services.'),
  ('HOSP_HEALTH', 'hosp_collection', 'policy', 'Patient Consultation Fees & Appointment Reservation', 'POLICY', 'v1.0', 'ACTIVE',
   'Patient OPD consultation fees are PKR 3000 for Cardiology, PKR 2500 for Pediatrics, and PKR 3500 for Neurology. Appointment booking requires 4-hour advance reservation and cancellation policy.');

-- Insert POS Chunks
INSERT INTO knowledge_chunks (document_id, business_code, chunk_index, chunk_title, chunk_text, token_count, embedding)
VALUES 
  (1, 'POS_RETAIL', 0, 'Thermal Receipt Printer 80mm Specs & Warranty',
   'GlimsTech 80mm Thermal Receipt Printer features auto-cut mechanism, dual USB and Ethernet ports, high-speed 260mm/sec printing, and comes with a 1-year replacement warranty in Pakistan.',
   35, '${generateVector(0)}'),
  (1, 'POS_RETAIL', 1, 'Omnidirectional 2D Barcode Scanner Specs',
   'Omnidirectional 2D hands-free desktop barcode scanner reads QR codes, DataMatrix, and all 1D retail product barcodes at high velocity with plug-and-play USB connection.',
   30, '${generateVector(1)}'),
  (2, 'POS_RETAIL', 0, 'POS Software Desktop Pro Licensing',
   'GlimsTech POS Desktop Pro is a lifetime retail license with offline-first local database, instant billing, receipt generation, inventory decrement, and WhatsApp customer invoice delivery.',
   33, '${generateVector(2)}');

-- Insert BISE Chunks
INSERT INTO knowledge_chunks (document_id, business_code, chunk_index, chunk_title, chunk_text, token_count, embedding)
VALUES 
  (3, 'BISE_EDU', 0, 'Exam Passing Marks & Grading Policy',
   'BISE board requires minimum 33 percent marks in theory and practicals to pass. Grades awarded: 80 percent and above is A+, 70 to 79 percent is A, 60 to 69 percent is B. Results can be verified online using 6-digit roll number.',
   42, '${generateVector(100)}'),
  (4, 'BISE_EDU', 0, 'Migration NOC & Duplicate Certificate Fees',
   'Board Migration Certificate NOC fee is PKR 1800 with 3-day turnaround. Duplicate matric or intermediate degree urgent fee is PKR 3500. Application requires CNIC or B-Form copy and bank challan.',
   34, '${generateVector(101)}');

-- Insert Hospital Chunks
INSERT INTO knowledge_chunks (document_id, business_code, chunk_index, chunk_title, chunk_text, token_count, embedding)
VALUES 
  (5, 'HOSP_HEALTH', 0, 'Cardiology & Pediatrics OPD Timings',
   'Dr. Tariq Mahmood (Cardiology) conducts OPD on Monday, Wednesday, Friday 09:00 AM - 01:00 PM. Dr. Ayesha Khan (Pediatrics) conducts OPD on Tuesday, Thursday, Saturday 02:00 PM - 06:00 PM.',
   36, '${generateVector(200)}'),
  (6, 'HOSP_HEALTH', 0, 'Hospital OPD Consultation Fees & Emergency Wing',
   'Cardiology OPD fee is PKR 3000. Pediatrics OPD fee is PKR 2500. Neurology OPD fee is PKR 3500. Emergency department is open 24/7 with round-the-clock trauma surgeons and acute care.',
   34, '${generateVector(201)}');
`;

console.log('Seeding canonical knowledge documents and chunks in platform_db...');
runPsql(seedSql);
console.log('PASS: Seeded 6 documents and 7 chunks across POS, BISE, and Hospital.');

// 2. Update Node 2007 (Tool: Search Knowledge Base) in Workflow JSON
const workflowFile = 'evolution_whatsapp_ai_agent_bot.json';
const data = JSON.parse(fs.readFileSync(workflowFile, 'utf8'));

const node2007 = data.nodes.find(n => n.id === '2007');
if (node2007) {
  node2007.parameters.jsCode = `const { Client } = require('/usr/local/lib/node_modules/n8n/node_modules/pg');
const userQuery = $input.first()?.json?.query || $input.first()?.json?.userQuery || $input.first()?.json?.messageText || '';
const incoming = ($('PostgreSQL Persistent Conversation Store').first() || $('Message Normalizer').first() || $json)?.json || {};
const businessCode = incoming.business_code || 'POS_RETAIL';
const allowedTools = incoming.allowed_tools || ['search_knowledge_base', 'sync_crm'];

// ================= POLICY & PERMISSION GATE =================
if (!allowedTools.includes('search_knowledge_base')) {
  return JSON.stringify({
    status: 'SECURITY_POLICY_DENIED',
    error_code: 'POLICY_UNAUTHORIZED_TOOL',
    tool: 'search_knowledge_base',
    tenant: businessCode,
    action: 'READ',
    message: \`[POLICY GATE DENIAL] Tool 'search_knowledge_base' is NOT authorized for tenant '\${businessCode}'. Execution blocked outside LLM.\`
  });
}
// ============================================================

// Query PostgreSQL Canonical Knowledge Schema with Strict Multi-Tenant Isolation
let searchResults = [];
try {
  const client = new Client({
    connectionString: 'postgresql://gateway_readonly:gateway_secure_readonly_2026@evolution-postgres:5432/platform_db'
  });
  await client.connect();

  const searchQuery = \`
    SELECT d.title, c.chunk_title, c.chunk_text,
           ts_rank(to_tsvector('english', c.chunk_text), plainto_tsquery('english', $1)) AS rank
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON c.document_id = d.id
    WHERE c.business_code = $2 
      AND d.status = 'ACTIVE'
      AND (
        to_tsvector('english', c.chunk_text) @@ plainto_tsquery('english', $1)
        OR c.chunk_text ILIKE ('%' || $1 || '%')
        OR d.title ILIKE ('%' || $1 || '%')
      )
    ORDER BY rank DESC
    LIMIT 3;
  \`;

  const res = await client.query(searchQuery, [userQuery.trim(), businessCode]);
  searchResults = res.rows;
  await client.end();
} catch (e) {
  console.error('Knowledge Base Query Error:', e.message);
}

if (searchResults.length > 0) {
  return searchResults.map(r => \`[Verified Knowledge - \${r.chunk_title || r.title}]: \${r.chunk_text}\`).join('\\n');
}

// Fallback to domain default verified profile
if (businessCode === 'BISE_EDU') {
  return \`BISE Educational Board: Annual & Supplementary Examination Services, Roll Number Inquiries, Result Cards & Certificates. Operating hours: Mon-Fri 9 AM - 4 PM. Contact support for verified board verification.\`;
} else if (businessCode === 'HOSP_HEALTH') {
  return \`City Healthcare & Hospital System: OPD Timings 9 AM - 6 PM, Specialist Doctors in Cardiology, Pediatrics, General Medicine. Emergency open 24/7. Address: Main Boulevard, Lahore.\`;
} else {
  return \`\${incoming.business_name || 'GlimsTech POS'}: Complete business automation, products, and customer support services. Timings: Mon-Sat 9 AM - 7 PM PKT.\`;
}`;

  fs.writeFileSync(workflowFile, JSON.stringify(data, null, 2), 'utf8');
  console.log('PASS: Updated Node 2007 in ' + workflowFile + ' with native PostgreSQL knowledge schema retrieval.');
} else {
  console.error('FAIL: Node 2007 not found in ' + workflowFile);
  process.exit(1);
}

console.log('SUCCESS: Phase 22 Knowledge Schema + Isolation implemented successfully.');
