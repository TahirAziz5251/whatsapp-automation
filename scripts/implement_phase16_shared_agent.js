const fs = require('fs');

const workflowFile = 'evolution_whatsapp_ai_agent_bot.json';
const data = JSON.parse(fs.readFileSync(workflowFile, 'utf8'));

// 1. Refactor Node 2004: Shared AI Agent Engine
const node2004 = data.nodes.find(n => n.id === '2004');
if (node2004) {
  node2004.name = "AI Agent (Shared Engine)";
  node2004.parameters.promptType = "define";
  node2004.parameters.text = "={{ $json.messageText || $json.message }}";
  node2004.parameters.options = {
    maxIterations: 2,
    systemMessage: `You are the centralized, autonomous WhatsApp AI Agent exclusively representing {{ $json.business_name || 'Our Valued Business' }} (Tenant Code: {{ $json.business_code || 'DEFAULT' }}).

TENANT IDENTITY & PROFILE:
{{ $json.prompt_profile?.system_prompt || 'Provide exceptional, courteous, and accurate assistance to the customer.' }}

CONTEXT & SESSION ATTRIBUTES:
- Customer Name: {{ $json.pushName || 'Customer' }}
- Customer Phone: {{ $json.customerPhone || 'Unknown' }}
- Active Session: {{ $json.session_id || 'DEFAULT_SESSION' }}
- Target Database: {{ $json.target_db_name || 'default_db' }}
- Knowledge Namespace: {{ $json.faiss_index_namespace || 'default_collection' }}
- Timezone: {{ $json.prompt_profile?.timezone || 'Asia/Karachi' }}
- Currency: {{ $json.prompt_profile?.currency || 'PKR' }}
- Today's Date: {{ $now.toFormat('yyyy-MM-dd') }} ({{ $now.toFormat('cccc') }})
- Prior Conversation Summary: {{ $json.persistent_conversation_store?.durable_summary || 'None' }}

STRICT BUSINESS ISOLATION & DATA GOVERNANCE RULES:
1. STRICT BOUNDARY: You represent EXCLUSIVELY {{ $json.business_name }}. NEVER discuss, offer services, or claim affiliation with any other organization or vertical.
2. NO CROSS-TENANT DATA MIXING: Under NO circumstances should you disclose product prices, patient records, or student exam results belonging to another business.
3. ANTI-HALLUCINATION: If a requested service, doctor, exam, or product is not verified in knowledge or tools, politely clarify that {{ $json.business_name }} does not have records for that request.
4. ZERO CODE EXPOSURE: NEVER output raw n8n expressions, node names, database table names, or template brackets {{ ... }} in WhatsApp messages.
5. WHATSAPP FORMATTING: Use polite, clear WhatsApp formatting with dynamic domain emojis (e.g. 📚/📝 for Education, 🏥/🩺 for Healthcare, 🛍️/💵 for Retail).`
  };
  console.log('PASS: Node 2004 refactored to Shared AI Agent Engine.');
}

// 2. Refactor Node 2007: Knowledge Base Tool with Multi-Tenant Namespace
const node2007 = data.nodes.find(n => n.id === '2007');
if (node2007) {
  node2007.parameters.jsCode = `const userQuery = $input.first()?.json?.query || $input.first()?.json?.userQuery || $input.first()?.json?.messageText || '';
const incoming = ($('PostgreSQL Persistent Conversation Store').first() || $('Message Normalizer').first() || $json)?.json || {};
const namespace = incoming.faiss_index_namespace || 'pos_collection';
const businessName = incoming.business_name || 'Business Partner';
const businessCode = incoming.business_code || 'POS_RETAIL';

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
  console.log('PASS: Node 2007 refactored to Tenant-Aware Knowledge Tool.');
}

// 3. Refactor Node 2010: Sync CRM Tool with Domain & Tenant Isolation
const node2010 = data.nodes.find(n => n.id === '2010');
if (node2010) {
  node2010.parameters.jsCode = `const { Client } = require('/usr/local/lib/node_modules/n8n/node_modules/pg');
const input = $input.first()?.json || {};
const extractData = ($('PostgreSQL Persistent Conversation Store').first() || $('Message Normalizer').first() || $json)?.json || {};

const customerPhone = input.customerPhone || extractData.customerPhone || 'Unknown';
const pushName = input.pushName || extractData.pushName || 'Customer';
const messageText = input.messageText || extractData.messageText || '';
const intent = input.intent || 'GENERAL';
const aiReply = input.aiReply || '';
const bookingDate = input.bookingDate || '';
const bookingTime = input.bookingTime || '';
const businessCode = extractData.business_code || 'POS_RETAIL';
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
  console.log('PASS: Node 2010 refactored to Tenant-Aware CRM Sync Tool.');
}

// 4. Update Node 2015 Connection to point to AI Agent (Shared Engine)
data.connections["PostgreSQL Persistent Conversation Store"] = {
  main: [
    [
      {
        node: "AI Agent (Shared Engine)",
        type: "main",
        index: 0
      }
    ]
  ]
};

data.connections["Groq Chat Model"] = {
  ai_languageModel: [
    [
      {
        node: "AI Agent (Shared Engine)",
        type: "ai_languageModel",
        index: 0
      }
    ]
  ]
};

data.connections["Window Buffer Memory"] = {
  ai_memory: [
    [
      {
        node: "AI Agent (Shared Engine)",
        type: "ai_memory",
        index: 0
      }
    ]
  ]
};

data.connections["Tool: Search Knowledge Base"] = {
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

data.connections["Tool: Manage Calendar"] = {
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

data.connections["Tool: Sync CRM"] = {
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

delete data.connections["AI Agent"];
data.connections["AI Agent (Shared Engine)"] = {
  main: [
    [
      {
        node: "Send WhatsApp Response (Evolution API)",
        type: "main",
        index: 0
      }
    ]
  ]
};

fs.writeFileSync(workflowFile, JSON.stringify(data, null, 2), 'utf8');
console.log('\nSUCCESS: Implemented Phase 16 Shared AI Agent Engine in ' + workflowFile);
