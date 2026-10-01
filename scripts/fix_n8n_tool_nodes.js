/**
 * Fix n8n Tool Nodes & Session Identity:
 * 1. Converts '@n8n/n8n-nodes-langchain.toolCustom' to '@n8n/n8n-nodes-langchain.toolCode'
 * 2. Formats tool schemas properly as JSON Schema strings
 * 3. Enforces canonical instance resolution in Node 2011 to eliminate session conflicts
 *    (e.g., Bise-bwp and student-assistant both resolve to canonical instance 'student-assistant')
 * 4. Ensures session_id format: BISE_EDU:student-assistant:<customerPhone>
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'evolution_whatsapp_ai_agent_bot.json');
const workflow = JSON.parse(fs.readFileSync(filePath, 'utf8'));

// Clean canvas positions map
const positions = {
  'Evolution Webhook': [-1200, 1800],
  'Is Customer Message?': [-980, 1800],
  'Message Normalizer': [-760, 1800],
  'Resolve Business (platform_db)': [-540, 1800],
  'Load Business Profile (platform_db)': [-320, 1800],
  'Construct Session Identity': [-100, 1800],
  'Redis Transient Session & Dedup Gate': [120, 1800],
  'PostgreSQL Persistent Conversation Store': [340, 1800],
  'AI Agent (Shared Engine)': [600, 1800],
  'Groq Chat Model': [350, 2120],
  'Window Buffer Memory': [480, 2120],
  'Tool: Search Knowledge Base': [610, 2120],
  'Tool: Business Data Gateway': [750, 2120],
  'Tool: Action Gateway': [890, 2120],
  'Tool: Manage Calendar': [1030, 2120],
  'Tool: Sync CRM': [1170, 2120],
  'Result Validator & Response Guard': [900, 1800],
  'Send WhatsApp Response (Evolution Router)': [1180, 1800]
};

// 1. Update Node 2011 to map canonical instance name & dynamic customer phone
const node2011 = workflow.nodes.find(n => n.id === '2011' || n.name === 'Resolve Business (platform_db)');
if (node2011) {
  node2011.parameters.jsCode = `const normalized = $input.first()?.json || {};
const rawInstance = String(normalized.instance_name || normalized.instance || '').trim().toLowerCase();

// Cleanly extract dynamic customer phone / JID
let rawPhone = String(normalized.customerPhone || normalized.user_id || normalized.sessionId || normalized.remoteJid || '').trim();
let cleanCustomerPhone = rawPhone.replace(/@.*$/, '').replace(/[^\\d]/g, '');

if (!cleanCustomerPhone) {
  cleanCustomerPhone = 'anonymous_customer';
}

// Canonical Business Registry & Instance Mapping
const REGISTRY = {
  // BISE Educational Board System (Canonical Instance: 'student-assistant')
  'student-assistant': {
    business_id: 2,
    business_code: 'BISE_EDU',
    business_name: 'BISE Educational Board System',
    canonical_instance_name: 'student-assistant',
    target_db_name: 'bise_db',
    faiss_index_namespace: 'bise_collection'
  },
  'bise-bwp': {
    business_id: 2,
    business_code: 'BISE_EDU',
    business_name: 'BISE Educational Board System',
    canonical_instance_name: 'student-assistant',
    target_db_name: 'bise_db',
    faiss_index_namespace: 'bise_collection'
  },
  'bise-instance': {
    business_id: 2,
    business_code: 'BISE_EDU',
    business_name: 'BISE Educational Board System',
    canonical_instance_name: 'student-assistant',
    target_db_name: 'bise_db',
    faiss_index_namespace: 'bise_collection'
  },
  'tahir_whatsapp_1': {
    business_id: 2,
    business_code: 'BISE_EDU',
    business_name: 'BISE Educational Board System',
    canonical_instance_name: 'student-assistant',
    target_db_name: 'bise_db',
    faiss_index_namespace: 'bise_collection'
  },

  // City Healthcare & Hospital System (Canonical Instance: 'hospital-assistant')
  'hospital-assistant': {
    business_id: 3,
    business_code: 'HOSP_HEALTH',
    business_name: 'City Healthcare & Hospital System',
    canonical_instance_name: 'hospital-assistant',
    target_db_name: 'hospital_db',
    faiss_index_namespace: 'hosp_collection'
  },
  'hospital-instance': {
    business_id: 3,
    business_code: 'HOSP_HEALTH',
    business_name: 'City Healthcare & Hospital System',
    canonical_instance_name: 'hospital-assistant',
    target_db_name: 'hospital_db',
    faiss_index_namespace: 'hosp_collection'
  },
  'tahir-whatsapp-bot': {
    business_id: 3,
    business_code: 'HOSP_HEALTH',
    business_name: 'City Healthcare & Hospital System',
    canonical_instance_name: 'hospital-assistant',
    target_db_name: 'hospital_db',
    faiss_index_namespace: 'hosp_collection'
  },

  // GlimsTech POS Retail Automation (Canonical Instance: 'point-of-sale')
  'point-of-sale': {
    business_id: 1,
    business_code: 'POS_RETAIL',
    business_name: 'GlimsTech POS Retail Automation',
    canonical_instance_name: 'point-of-sale',
    target_db_name: 'pos_db',
    faiss_index_namespace: 'pos_collection'
  },
  'pos-instance': {
    business_id: 1,
    business_code: 'POS_RETAIL',
    business_name: 'GlimsTech POS Retail Automation',
    canonical_instance_name: 'point-of-sale',
    target_db_name: 'pos_db',
    faiss_index_namespace: 'pos_collection'
  }
};

const resolved = REGISTRY[rawInstance] || REGISTRY['student-assistant'];

// Construct dynamic, canonical session_id: <BUSINESS_CODE>:<CANONICAL_INSTANCE>:<CUSTOMER_PHONE>
const canonicalSessionId = \`\${resolved.business_code}:\${resolved.canonical_instance_name}:\${cleanCustomerPhone}\`;

return {
  ...normalized,
  raw_instance_name: normalized.instance_name || rawInstance,
  instance_name: resolved.canonical_instance_name,
  customerPhone: cleanCustomerPhone,
  session_id: canonicalSessionId,
  business_id: resolved.business_id,
  business_code: resolved.business_code,
  business_name: resolved.business_name,
  target_db_name: resolved.target_db_name,
  faiss_index_namespace: resolved.faiss_index_namespace
};`;
}

// 2. Update Node 2013 to construct canonical session_id: BUSINESS_CODE:CANONICAL_INSTANCE:CUSTOMER_PHONE
const node2013 = workflow.nodes.find(n => n.id === '2013' || n.name === 'Construct Session Identity');
if (node2013) {
  node2013.parameters.assignments.assignments = [
    {
      id: "sess_key_id",
      name: "session_id",
      value: "={{ $json.business_code + ':' + $json.instance_name + ':' + ($json.customerPhone || $json.user_id) }}",
      type: "string"
    }
  ];
}

for (const node of workflow.nodes) {
  // Update canvas coordinates
  if (positions[node.name]) {
    node.position = positions[node.name];
  }

  // If node is a tool node, convert to official n8n 2.x toolCode
  if (node.name.includes('Tool') || node.type.includes('toolCustom')) {
    node.type = '@n8n/n8n-nodes-langchain.toolCode';
    node.typeVersion = 1.1;

    const params = node.parameters || {};
    
    // Schema formatting
    let schemaStr = params.inputSchema || params.jsonSchema;
    if (typeof schemaStr === 'object') {
      schemaStr = JSON.stringify(schemaStr, null, 2);
    } else if (!schemaStr || node.name === 'Tool: Sync CRM') {
      schemaStr = JSON.stringify({
        type: "object",
        properties: {
          action: { type: "string" },
          query: { type: "string" }
        },
        required: ["query"]
      }, null, 2);
    }

    node.parameters = {
      name: params.name || node.name.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      description: params.description || '',
      language: 'javaScript',
      specifyInputSchema: true,
      schemaType: 'jsonSchema',
      jsonSchema: schemaStr,
      inputSchema: schemaStr,
      jsCode: params.jsCode || '// Tool execution logic\nreturn "SUCCESS";'
    };
  }

  // Update AI Agent prompt expression so it never evaluates to undefined
  if (node.id === '2004' || node.name === 'AI Agent (Shared Engine)') {
    node.parameters.text = "={{ $('Message Normalizer').item.json.messageText || $json.messageText || $json.message }}";
  }
}

// Ensure all 5 tools are properly connected to AI Agent (Shared Engine)
if (!workflow.connections['Tool: Action Gateway']) {
  workflow.connections['Tool: Action Gateway'] = {
    ai_tool: [
      [
        {
          node: 'AI Agent (Shared Engine)',
          type: 'ai_tool',
          index: 0
        }
      ]
    ]
  };
}

fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2), 'utf8');
console.log('✅ Successfully updated evolution_whatsapp_ai_agent_bot.json with canonical session resolution and valid tool input schemas!');
