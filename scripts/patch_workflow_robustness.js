const fs = require('fs');
const path = require('path');

const wfPath = path.join(__dirname, '..', 'evolution_whatsapp_ai_agent_bot.json');
const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));

// 1. Patch Node 2003 (Message Normalizer)
const node2003 = wf.nodes.find(n => n.id === '2003');
if (node2003 && node2003.parameters && node2003.parameters.assignments) {
  const assignments = node2003.parameters.assignments.assignments;
  
  // Update timestamp
  const ts = assignments.find(a => a.name === 'timestamp');
  if (ts) ts.value = '={{ $now.toISO() }}';

  // Update messageText
  const msgText = assignments.find(a => a.name === 'messageText');
  if (msgText) {
    msgText.value = '={{ ($json.body?.data || $json.body?.body?.data || $json.data)?.Message?.conversation || ($json.body?.data || $json.body?.body?.data || $json.data)?.Message?.extendedTextMessage?.text || ($json.body?.data || $json.body?.body?.data || $json.data)?.message?.conversation || ($json.body?.data || $json.body?.body?.data || $json.data)?.message?.extendedTextMessage?.text || ($json.body?.data || $json.body?.body?.data || $json.data)?.caption || \'\' }}';
  }
}

// 2. Patch Node 2011 (Resolve Business)
const node2011 = wf.nodes.find(n => n.id === '2011');
if (node2011 && node2011.parameters) {
  node2011.parameters.jsCode = `const normalized = $input.first()?.json || {};
const rawInstance = String(normalized.instance_name || '').trim().toLowerCase();

const REGISTRY = {
  'student-assistant': {
    business_id: 2,
    business_code: 'BISE_EDU',
    business_name: 'BISE Educational Board System',
    target_db_name: 'bise_db',
    faiss_index_namespace: 'bise_collection'
  },
  'bise-bwp': {
    business_id: 2,
    business_code: 'BISE_EDU',
    business_name: 'BISE Educational Board System',
    target_db_name: 'bise_db',
    faiss_index_namespace: 'bise_collection'
  },
  'bise-instance': {
    business_id: 2,
    business_code: 'BISE_EDU',
    business_name: 'BISE Educational Board System',
    target_db_name: 'bise_db',
    faiss_index_namespace: 'bise_collection'
  },
  'hospital-assistant': {
    business_id: 3,
    business_code: 'HOSP_HEALTH',
    business_name: 'City Healthcare & Hospital System',
    target_db_name: 'hospital_db',
    faiss_index_namespace: 'hosp_collection'
  },
  'hospital-instance': {
    business_id: 3,
    business_code: 'HOSP_HEALTH',
    business_name: 'City Healthcare & Hospital System',
    target_db_name: 'hospital_db',
    faiss_index_namespace: 'hosp_collection'
  },
  'point-of-sale': {
    business_id: 1,
    business_code: 'POS_RETAIL',
    business_name: 'GlimsTech POS Retail Automation',
    target_db_name: 'pos_db',
    faiss_index_namespace: 'pos_collection'
  },
  'pos-instance': {
    business_id: 1,
    business_code: 'POS_RETAIL',
    business_name: 'GlimsTech POS Retail Automation',
    target_db_name: 'pos_db',
    faiss_index_namespace: 'pos_collection'
  }
};

const resolved = REGISTRY[rawInstance] || REGISTRY['point-of-sale'];

return {
  ...normalized,
  business_id: resolved.business_id,
  business_code: resolved.business_code,
  business_name: resolved.business_name,
  target_db_name: resolved.target_db_name,
  faiss_index_namespace: resolved.faiss_index_namespace
};`;
}

// 3. Patch Node 2012 (Load Business Profile)
const node2012 = wf.nodes.find(n => n.id === '2012');
if (node2012 && node2012.parameters) {
  node2012.parameters.jsCode = `const incoming = $input.first()?.json || {};
const businessCode = incoming.business_code || 'POS_RETAIL';

let promptVersion = 'v1.0';
let roleDescription = '';
let allowedScope = '';
let responseStyle = 'Professional and Courteous';
let behaviorRules = [];
let systemPrompt = '';
let defaultLang = 'en';
let timezone = 'Asia/Karachi';
let currency = 'PKR';
let allowedTools = [];
let modelProvider = 'Groq';
let modelName = 'openai/gpt-oss-120b';
let temperature = 0.3;

if (businessCode === 'BISE_EDU') {
  promptVersion = 'v1.0';
  roleDescription = 'Official Academic Examination Controller & Student Helpdesk Assistant';
  allowedScope = 'Matric & Intermediate exam results, roll number verification, date sheets, and certificate policies.';
  responseStyle = 'Formal, authoritative, clear, and reassuring with academic emojis.';
  behaviorRules = ['Require 6-digit roll number for result lookup', 'Never speculate marks or grades', 'Advise visiting board office for duplicate certificates'];
  systemPrompt = 'You represent BISE Educational Board System. Help students check exam results by Roll Number and view exam date sheets. Maintain academic rigor, accuracy, and official board tone.';
  allowedTools = ['search_knowledge_base', 'check_exam_results', 'query_business_data', 'get_student_result', 'get_fees'];
  temperature = 0.2;
} else if (businessCode === 'HOSP_HEALTH') {
  promptVersion = 'v1.0';
  roleDescription = 'Hospital Patient Care & Clinical OPD Appointment Coordinator';
  allowedScope = 'Doctor directories by specialty, OPD clinic timings, consultation fee inquiries in PKR, and appointments.';
  responseStyle = 'Empathetic, polite, cautious, patient-centric with healthcare emojis.';
  behaviorRules = ['STRICT: NEVER provide medical diagnosis, clinical advice, or prescribe medicine', 'Direct emergencies immediately to 24/7 Emergency Wing', 'Confirm doctor availability before appointment reservation'];
  systemPrompt = 'You represent City Healthcare & Hospital System. Assist patients with OPD doctor directory lookup, clinical schedules, consultation fees in PKR, and booking appointments. STRICTLY NEVER PROVIDE MEDICAL DIAGNOSIS OR DRUG PRESCRIPTIONS.';
  allowedTools = ['search_knowledge_base', 'manage_calendar', 'query_business_data', 'get_doctor_schedule', 'get_doctors_by_specialty', 'get_departments'];
  temperature = 0.2;
} else {
  promptVersion = 'v1.0';
  roleDescription = 'Senior Retail POS & Hardware Automation Advisor';
  allowedScope = 'Retail POS billing software, thermal receipt printers, barcode scanners, stock management, and demo bookings.';
  responseStyle = 'Consultative, energetic, commercial, dynamic with retail emojis.';
  behaviorRules = ['Always quote prices in PKR', 'Recommend hardware bundles for new retail setups', 'Encourage booking a software demo'];
  systemPrompt = 'You represent GlimsTech POS Retail Automation. Provide expert guidance on retail POS hardware, software bundles, and inventory setups. Quote prices in PKR and guide qualified leads to schedule a demo.';
  allowedTools = ['search_knowledge_base', 'sync_crm', 'query_business_data', 'get_product', 'check_inventory', 'get_price'];
  temperature = 0.3;
}

return {
  ...incoming,
  prompt_profile: {
    prompt_version: promptVersion,
    role_description: roleDescription,
    allowed_scope: allowedScope,
    response_style: responseStyle,
    behavior_rules: behaviorRules,
    system_prompt: systemPrompt,
    timezone: timezone,
    currency: currency
  },
  language: defaultLang,
  allowed_tools: allowedTools,
  model_config: {
    provider: modelProvider,
    model_name: modelName,
    temperature: temperature
  }
};`;
}

// 4. Patch Node 2014 (Redis Gate) - wrap require('net')
const node2014 = wf.nodes.find(n => n.id === '2014');
if (node2014 && node2014.parameters) {
  node2014.parameters.jsCode = `const incoming = $input.first()?.json || {};
const sessionId = incoming.session_id || \`\${incoming.business_code || 'POS_RETAIL'}:\${incoming.instance_name || 'point-of-sale'}:\${incoming.user_id || '923001234567'}\`;
const messageId = incoming.message_id || 'MSG_INIT';

let isDuplicate = false;
let isRateLimited = false;
let rateCount = 1;

let net = null;
try {
  net = require('net');
} catch (e) {
  // net module not allowed or unavailable
}

async function sendRedisCommand(cmdArgs) {
  if (!net) return null;
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    let req = \`*\${cmdArgs.length}\\r\\n\`;
    cmdArgs.forEach(arg => {
      const str = String(arg);
      req += \`$\${Buffer.byteLength(str)}\\r\\n\${str}\\r\\n\`;
    });
    socket.connect(6379, '127.0.0.1', () => { socket.write(req); });
    socket.on('data', (data) => { socket.destroy(); resolve(data.toString('utf-8')); });
    socket.on('error', () => { socket.destroy(); resolve(null); });
    socket.on('timeout', () => { socket.destroy(); resolve(null); });
  });
}

try {
  if (net) {
    const dedupRes = await sendRedisCommand(['SET', \`dedup:\${messageId}\`, '1', 'NX', 'EX', '300']);
    if (dedupRes && dedupRes.includes('nil')) isDuplicate = true;
    const incrRes = await sendRedisCommand(['INCR', \`ratelimit:\${sessionId}\`]);
    if (incrRes && incrRes.startsWith(':')) {
      rateCount = parseInt(incrRes.substring(1).trim(), 10);
      if (rateCount === 1) await sendRedisCommand(['EXPIRE', \`ratelimit:\${sessionId}\`, '60']);
      if (rateCount > 10) isRateLimited = true;
    }
    const sessionState = JSON.stringify({ session_id: sessionId, business_code: incoming.business_code, user_id: incoming.user_id, last_message: incoming.message, last_active: new Date().toISOString() });
    await sendRedisCommand(['SET', \`session:\${sessionId}\`, sessionState, 'EX', '86400']);
  }
} catch (e) { console.error('Redis Gate Error:', e.message); }

return {
  ...incoming,
  session_id: sessionId,
  redis_transient_state: {
    is_duplicate: isDuplicate,
    is_rate_limited: isRateLimited,
    rate_count: rateCount,
    ttl_seconds: 86400,
    storage: 'Redis (AOF restart-safe)'
  }
};`;
}

// 5. Patch Node 2015 (PostgreSQL Persistent Store) - safe require
const node2015 = wf.nodes.find(n => n.id === '2015');
if (node2015 && node2015.parameters) {
  node2015.parameters.jsCode = `const incoming = $input.first()?.json || {};

const sessionId = incoming.session_id || \`\${incoming.business_code || 'POS_RETAIL'}:\${incoming.instance_name || 'point-of-sale'}:\${incoming.user_id || '923001234567'}\`;
const businessCode = incoming.business_code || 'POS_RETAIL';
const instanceName = incoming.instance_name || 'point-of-sale';
const userId = incoming.user_id || '923001234567';
const customerPhone = incoming.customerPhone || userId;
const pushName = incoming.pushName || 'Customer';
const messageId = incoming.message_id || 'MSG_INIT';
const messageText = incoming.message || incoming.messageText || '';

let durableSummary = '';
let recentMessagesCount = 1;
let dbPersisted = false;

let Client = null;
try {
  Client = require('pg').Client;
} catch (e) {
  // pg module not allowed or unavailable
}

if (Client) {
  try {
    const client = new Client({ connectionString: 'postgresql://postgres:postgres@evolution-postgres:5432/platform_db' });
    await client.connect();

    const convQuery = \`
      INSERT INTO conversations (conversation_id, session_key, business_code, instance_name, user_id, customer_phone, push_name, status, last_active_at)
      VALUES ($1, $1, $2, $3, $4, $5, $6, 'ACTIVE', CURRENT_TIMESTAMP)
      ON CONFLICT (conversation_id) 
      DO UPDATE SET 
        message_count = conversations.message_count + 1,
        push_name = EXCLUDED.push_name,
        last_active_at = CURRENT_TIMESTAMP;
    \`;
    await client.query(convQuery, [sessionId, businessCode, instanceName, userId, customerPhone, pushName]);

    const sessQuery = \`
      INSERT INTO session_metadata (session_key, business_code, user_id, current_intent, last_sync_at)
      VALUES ($1, $2, $3, 'GENERAL', CURRENT_TIMESTAMP)
      ON CONFLICT (session_key) 
      DO UPDATE SET last_sync_at = CURRENT_TIMESTAMP;
    \`;
    await client.query(sessQuery, [sessionId, businessCode, userId]);

    if (messageText) {
      const msgQuery = \`
        INSERT INTO conversation_messages (conversation_id, message_id, sender_type, sender_phone, message_text, metadata)
        VALUES ($1, $2, 'USER', $3, $4, $5)
        ON CONFLICT DO NOTHING;
      \`;
      await client.query(msgQuery, [sessionId, messageId, customerPhone, messageText, JSON.stringify({ source: 'whatsapp', instance: instanceName })]);
    }

    const sumRes = await client.query('SELECT summary_text FROM conversation_summary WHERE conversation_id = $1 ORDER BY updated_at DESC LIMIT 1;', [sessionId]);
    if (sumRes.rows.length > 0) durableSummary = sumRes.rows[0].summary_text;

    const historyRes = await client.query('SELECT COUNT(*)::int as count FROM conversation_messages WHERE conversation_id = $1;', [sessionId]);
    if (historyRes.rows.length > 0) recentMessagesCount = historyRes.rows[0].count;

    await client.end();
    dbPersisted = true;
  } catch (e) {
    console.error('PostgreSQL Persistent Store Error:', e.message);
  }
}

return {
  ...incoming,
  persistent_conversation_store: {
    conversation_id: sessionId,
    db_persisted: dbPersisted,
    durable_summary: durableSummary,
    total_messages_count: recentMessagesCount,
    storage: 'PostgreSQL platform_db (durable restart-safe)'
  }
};`;
}

fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2), 'utf8');
console.log('Successfully patched evolution_whatsapp_ai_agent_bot.json with robust node definitions.');
