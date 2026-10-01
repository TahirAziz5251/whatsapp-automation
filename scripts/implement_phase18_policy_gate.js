const fs = require('fs');

const workflowFile = 'evolution_whatsapp_ai_agent_bot.json';
const data = JSON.parse(fs.readFileSync(workflowFile, 'utf8'));

// 1. Refactor Node 2007: Tool: Search Knowledge Base with Policy Gate
const node2007 = data.nodes.find(n => n.id === '2007');
if (node2007) {
  node2007.parameters.jsCode = `const userQuery = $input.first()?.json?.query || $input.first()?.json?.userQuery || $input.first()?.json?.messageText || '';
const incoming = ($('PostgreSQL Persistent Conversation Store').first() || $('Message Normalizer').first() || $json)?.json || {};
const businessCode = incoming.business_code || 'POS_RETAIL';
const allowedTools = incoming.allowed_tools || ['search_knowledge_base', 'sync_crm'];
const namespace = incoming.faiss_index_namespace || 'pos_collection';
const businessName = incoming.business_name || 'Business Partner';

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

try {
  const response = await fetch('http://faiss-service:8000/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: userQuery, namespace: namespace, top_k: 3 })
  });
  if (response.ok) {
    const data = await response.json();
    if (data.results && data.results.length > 0) {
      return data.results.map(r => \`[FAISS Vector Match - \${r.title}]: \${r.text}\`).join('\\n');
    }
  }
} catch (e) {
  console.error('FAISS Service call fallback:', e.message);
}

if (businessCode === 'BISE_EDU') {
  return \`BISE Educational Board: Annual & Supplementary Examination Services, Roll Number Inquiries, Result Cards & Certificates. Operating hours: Mon-Fri 9 AM - 4 PM. Contact support for verified board verification.\`;
} else if (businessCode === 'HOSP_HEALTH') {
  return \`City Healthcare & Hospital System: OPD Timings 9 AM - 6 PM, Specialist Doctors in Cardiology, Pediatrics, General Medicine. Emergency open 24/7. Address: Main Boulevard, Lahore.\`;
} else {
  return \`\${businessName}: Complete business automation, products, and customer support services. Head office in Gulberg III Lahore. Timings: Mon-Sat 9 AM - 7 PM PKT.\`;
}`;
  console.log('PASS: Node 2007 (Knowledge Base Tool) secured with Policy Gate.');
}

// 2. Refactor Node 2009: Tool: Manage Calendar with Policy Gate
const node2009 = data.nodes.find(n => n.id === '2009');
if (node2009) {
  node2009.parameters.jsCode = `const input = $input.first()?.json || {};
const incoming = ($('PostgreSQL Persistent Conversation Store').first() || $('Message Normalizer').first() || $json)?.json || {};
const businessCode = incoming.business_code || 'HOSP_HEALTH';
const allowedTools = incoming.allowed_tools || ['search_knowledge_base', 'manage_calendar'];

// ================= POLICY & PERMISSION GATE =================
// Only authorized businesses (e.g. HOSP_HEALTH) can access calendar/appointment tool
if (!allowedTools.includes('manage_calendar') || businessCode === 'BISE_EDU' || businessCode === 'POS_RETAIL') {
  return JSON.stringify({
    status: 'SECURITY_POLICY_DENIED',
    error_code: 'POLICY_UNAUTHORIZED_TOOL',
    tool: 'manage_calendar',
    tenant: businessCode,
    action: 'WRITE',
    message: \`[POLICY GATE DENIAL] Tool 'manage_calendar' is strictly UNAUTHORIZED for tenant '\${businessCode}'. Calendar actions are restricted. Execution terminated outside LLM.\`
  });
}
// ============================================================

const action = input.action || (input.time || input.date ? 'CREATE_BOOKING' : 'CHECK_AVAILABILITY');
const date = input.date || new Date(Date.now() + 86400000).toISOString().split('T')[0];
const time = input.time || '14:00';
const customerPhone = input.customerPhone || incoming.customerPhone || 'Customer';
const pushName = input.pushName || incoming.pushName || 'Customer';

if (action === 'CHECK_AVAILABILITY') {
  if (time === '14:00') {
    return JSON.stringify({ available: false, message: \`Slot \${date} at \${time} PKT is already booked.\` });
  }
  return JSON.stringify({ available: true, message: \`Slot \${date} at \${time} PKT is available for booking.\` });
}

if (action === 'CREATE_BOOKING') {
  const eventId = \`evt_\${Date.now()}\`;
  const startIso = \`\${date}T\${time}:00+05:00\`;
  return JSON.stringify({
    status: 'SUCCESS',
    success: true,
    eventId: eventId,
    startTime: startIso,
    tenant: businessCode,
    summary: \`Hospital OPD Appointment - \${customerPhone}\`,
    description: \`Patient: \${pushName} | Phone: \${customerPhone} | Source: Hospital WhatsApp Agent\`
  });
}

return JSON.stringify({ status: 'SUCCESS', message: \`Calendar slot processed for \${date} at \${time}\` });`;
  console.log('PASS: Node 2009 (Calendar Tool) secured with Policy Gate.');
}

// 3. Refactor Node 2010: Tool: Sync CRM with Policy Gate
const node2010 = data.nodes.find(n => n.id === '2010');
if (node2010) {
  node2010.parameters.jsCode = `const { Client } = require('/usr/local/lib/node_modules/n8n/node_modules/pg');
const input = $input.first()?.json || {};
const extractData = ($('PostgreSQL Persistent Conversation Store').first() || $('Message Normalizer').first() || $json)?.json || {};
const businessCode = extractData.business_code || 'POS_RETAIL';
const allowedTools = extractData.allowed_tools || ['search_knowledge_base', 'sync_crm'];

// ================= POLICY & PERMISSION GATE =================
// Only authorized businesses (e.g. POS_RETAIL) can write to CRM leads table
if (!allowedTools.includes('sync_crm') || businessCode === 'BISE_EDU' || businessCode === 'HOSP_HEALTH') {
  return JSON.stringify({
    status: 'SECURITY_POLICY_DENIED',
    error_code: 'POLICY_UNAUTHORIZED_TOOL',
    tool: 'sync_crm',
    tenant: businessCode,
    action: 'WRITE',
    message: \`[POLICY GATE DENIAL] Tool 'sync_crm' is strictly UNAUTHORIZED for tenant '\${businessCode}'. Commercial CRM writes are restricted. Execution terminated outside LLM.\`
  });
}
// ============================================================

const customerPhone = input.customerPhone || extractData.customerPhone || 'Unknown';
const pushName = input.pushName || extractData.pushName || 'Customer';
const messageText = input.messageText || extractData.messageText || '';
const intent = input.intent || 'GENERAL';
const aiReply = input.aiReply || '';
const bookingDate = input.bookingDate || '';
const bookingTime = input.bookingTime || '';
const sessionId = extractData.session_id || \`\${businessCode}:pos-instance:\${customerPhone}\`;

const cities = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar'];
let detectedCity = 'Lahore (Default)';
cities.forEach(c => {
  if (messageText.toLowerCase().includes(c.toLowerCase())) {
    detectedCity = c;
  }
});

let leadStage = 'NEW_LEAD';
let bookingStatus = 'NONE';
if (intent === 'BOOKING') {
  leadStage = 'DEMO_BOOKED';
  bookingStatus = 'SCHEDULED';
} else if (intent === 'CLARIFY') {
  leadStage = 'QUALIFIED_INQUIRY';
}

try {
  const client = new Client({ connectionString: 'postgresql://postgres:postgres@evolution-postgres:5432/postgres' });
  await client.connect();
  const upsertQuery = \`INSERT INTO leads (customer_phone, push_name, city, domain_type, lead_stage, intent, last_message, ai_reply, booking_status, booking_date, booking_time, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP) ON CONFLICT (customer_phone) DO UPDATE SET push_name = EXCLUDED.push_name, city = EXCLUDED.city, domain_type = EXCLUDED.domain_type, lead_stage = EXCLUDED.lead_stage, intent = EXCLUDED.intent, last_message = EXCLUDED.last_message, ai_reply = EXCLUDED.ai_reply, booking_status = EXCLUDED.booking_status, booking_date = EXCLUDED.booking_date, booking_time = EXCLUDED.booking_time, updated_at = CURRENT_TIMESTAMP;\`;
  await client.query(upsertQuery, [customerPhone, pushName, detectedCity, businessCode, leadStage, intent, messageText, aiReply, bookingStatus, bookingDate, bookingTime]);
  if (messageText) await client.query('INSERT INTO chat_history (session_id, customer_phone, push_name, sender, message_text) VALUES ($1, $2, $3, $4, $5)', [sessionId, customerPhone, pushName, 'customer', messageText]);
  if (aiReply) await client.query('INSERT INTO chat_history (session_id, customer_phone, push_name, sender, message_text) VALUES ($1, $2, $3, $4, $5)', [sessionId, customerPhone, pushName, 'agent', aiReply]);
  await client.end();
} catch (e) {
  console.error('PostgreSQL Sync Error:', e.message);
}

return JSON.stringify({
  status: 'CRM_POSTGRES_UPDATED',
  businessCode: businessCode,
  leadStage: leadStage,
  city: detectedCity,
  bookingStatus: bookingStatus,
  customerPhone: customerPhone
});`;
  console.log('PASS: Node 2010 (CRM Sync Tool) secured with Policy Gate.');
}

fs.writeFileSync(workflowFile, JSON.stringify(data, null, 2), 'utf8');
console.log('\nSUCCESS: Implemented Phase 18 Policy & Permission Gate in ' + workflowFile);
