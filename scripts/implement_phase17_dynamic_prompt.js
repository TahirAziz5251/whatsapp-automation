const fs = require('fs');

const workflowFile = 'evolution_whatsapp_ai_agent_bot.json';
const data = JSON.parse(fs.readFileSync(workflowFile, 'utf8'));

// 1. Refactor Node 2012: Versioned Business Profile Loader
const node2012 = data.nodes.find(n => n.id === '2012');
if (node2012) {
  node2012.parameters.jsCode = `const { Client } = require('/usr/local/lib/node_modules/n8n/node_modules/pg');
const incoming = $input.first()?.json || {};
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

try {
  const client = new Client({ connectionString: 'postgresql://postgres:postgres@evolution-postgres:5432/platform_db' });
  await client.connect();
  
  const profQuery = \`
    SELECT prompt_version, role_description, allowed_scope, response_style, behavior_rules, system_prompt, default_language, timezone, currency 
    FROM platform_business_profiles 
    WHERE business_code = $1 AND is_active = TRUE 
    ORDER BY created_at DESC 
    LIMIT 1;
  \`;
  const profRes = await client.query(profQuery, [businessCode]);
  if (profRes.rows.length > 0) {
    const row = profRes.rows[0];
    promptVersion = row.prompt_version || 'v1.0';
    roleDescription = row.role_description || '';
    allowedScope = row.allowed_scope || '';
    responseStyle = row.response_style || 'Professional';
    behaviorRules = typeof row.behavior_rules === 'string' ? JSON.parse(row.behavior_rules) : (row.behavior_rules || []);
    systemPrompt = row.system_prompt || '';
    defaultLang = row.default_language || 'en';
    timezone = row.timezone || 'Asia/Karachi';
    currency = row.currency || 'PKR';
  }

  const toolsRes = await client.query('SELECT tool_name FROM platform_tool_permissions WHERE business_code = $1 AND is_allowed = TRUE;', [businessCode]);
  allowedTools = toolsRes.rows.map(r => r.tool_name);

  const cfgRes = await client.query('SELECT model_provider, model_name, temperature FROM platform_agent_configs WHERE business_code = $1;', [businessCode]);
  if (cfgRes.rows.length > 0) {
    modelProvider = cfgRes.rows[0].model_provider;
    modelName = cfgRes.rows[0].model_name;
    temperature = parseFloat(cfgRes.rows[0].temperature);
  }

  await client.end();
} catch (e) {
  console.error('Profile Loader Error:', e.message);
}

// Resilient fallback by business code
if (!roleDescription) {
  if (businessCode === 'BISE_EDU') {
    promptVersion = 'v1.0';
    roleDescription = 'Official Academic Examination Controller & Student Helpdesk Assistant';
    allowedScope = 'Matric & Intermediate exam results, roll number verification, date sheets, and certificate policies.';
    responseStyle = 'Formal, authoritative, clear, and reassuring with academic emojis.';
    behaviorRules = ['Require 6-digit roll number for result lookup', 'Never speculate marks or grades', 'Advise visiting board office for duplicate certificates'];
    systemPrompt = 'You represent BISE Educational Board System. Help students check exam results by Roll Number and view exam date sheets. Maintain academic rigor, accuracy, and official board tone.';
    allowedTools = ['search_knowledge_base', 'check_exam_results'];
    temperature = 0.2;
  } else if (businessCode === 'HOSP_HEALTH') {
    promptVersion = 'v1.0';
    roleDescription = 'Hospital Patient Care & Clinical OPD Appointment Coordinator';
    allowedScope = 'Doctor directories by specialty, OPD clinic timings, consultation fee inquiries in PKR, and appointments.';
    responseStyle = 'Empathetic, polite, cautious, patient-centric with healthcare emojis.';
    behaviorRules = ['STRICT: NEVER provide medical diagnosis, clinical advice, or prescribe medicine', 'Direct emergencies immediately to 24/7 Emergency Wing', 'Confirm doctor availability before appointment reservation'];
    systemPrompt = 'You represent City Healthcare & Hospital System. Assist patients with OPD doctor directory lookup, clinical schedules, consultation fees in PKR, and booking appointments. STRICTLY NEVER PROVIDE MEDICAL DIAGNOSIS OR DRUG PRESCRIPTIONS.';
    allowedTools = ['search_knowledge_base', 'manage_calendar'];
    temperature = 0.2;
  } else {
    promptVersion = 'v1.0';
    roleDescription = 'Senior Retail POS & Hardware Automation Advisor';
    allowedScope = 'Retail POS billing software, thermal receipt printers, barcode scanners, stock management, and demo bookings.';
    responseStyle = 'Consultative, energetic, commercial, dynamic with retail emojis.';
    behaviorRules = ['Always quote prices in PKR', 'Recommend hardware bundles for new retail setups', 'Encourage booking a software demo'];
    systemPrompt = 'You represent GlimsTech POS Retail Automation. Provide expert guidance on retail POS hardware, software bundles, and inventory setups. Quote prices in PKR and guide qualified leads to schedule a demo.';
    allowedTools = ['search_knowledge_base', 'sync_crm'];
    temperature = 0.3;
  }
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
  console.log('PASS: Node 2012 refactored with Versioned Dynamic Profile Loading.');
}

// 2. Refactor Node 2004: AI Agent (Shared Engine) System Message
const node2004 = data.nodes.find(n => n.id === '2004');
if (node2004) {
  node2004.parameters.options.systemMessage = `You are the centralized, autonomous WhatsApp AI Agent exclusively representing {{ $json.business_name || 'Our Valued Business' }} (Tenant Code: {{ $json.business_code || 'DEFAULT' }} | Prompt Version: {{ $json.prompt_profile?.prompt_version || 'v1.0' }}).

ROLE & PURPOSE:
{{ $json.prompt_profile?.role_description || 'Intelligent Multi-Tenant AI Assistant' }}

AUTHORITY & ALLOWED SCOPE:
{{ $json.prompt_profile?.allowed_scope || 'Answer verified customer inquiries within business policy.' }}

COMMUNICATION STYLE & TONE:
{{ $json.prompt_profile?.response_style || 'Professional, courteous, and accurate' }}

TENANT SYSTEM INSTRUCTIONS:
{{ $json.prompt_profile?.system_prompt || 'Provide exceptional assistance to the user.' }}

TENANT ISOLATED ENVIRONMENT & CONTEXT:
- Active Business: {{ $json.business_name }} ({{ $json.business_code }})
- Target Domain Database: {{ $json.target_db_name }}
- Knowledge Namespace: {{ $json.faiss_index_namespace }}
- Allowed Tools for this Tenant: {{ ($json.allowed_tools || []).join(', ') }}
- Operational Timezone: {{ $json.prompt_profile?.timezone || 'Asia/Karachi' }}
- Operating Currency: {{ $json.prompt_profile?.currency || 'PKR' }}
- Customer Identity: {{ $json.pushName || 'Customer' }} ({{ $json.customerPhone || 'Unknown' }})
- Session ID: {{ $json.session_id }}
- Active Conversation Summary: {{ $json.persistent_conversation_store?.durable_summary || 'No previous summary.' }}

STRICT BUSINESS ISOLATION & DATA GOVERNANCE:
1. STRICT BOUNDARY: You represent EXCLUSIVELY {{ $json.business_name }}. NEVER discuss, offer services, or claim affiliation with any other organization or vertical.
2. ZERO CROSS-TENANT DATA MIXING: Under NO circumstances disclose product prices, patient records, or student exam results belonging to another business.
3. ANTI-HALLUCINATION: If a requested service, doctor, exam, or product is not verified in knowledge or tools, politely clarify that {{ $json.business_name }} does not have records for that request.
4. ZERO CODE EXPOSURE: NEVER output raw n8n expressions, node names, database table names, or template brackets {{ ... }} in WhatsApp messages.
5. WHATSAPP FORMATTING: Follow {{ $json.prompt_profile?.response_style }} with dynamic domain emojis.`;
  console.log('PASS: Node 2004 updated with Versioned Dynamic Prompt Context.');
}

fs.writeFileSync(workflowFile, JSON.stringify(data, null, 2), 'utf8');
console.log('\nSUCCESS: Implemented Phase 17 Dynamic Business Prompt Loading in ' + workflowFile);
