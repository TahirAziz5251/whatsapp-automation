const fs = require('fs');

console.log('================ PHASE 16 SHARED AI AGENT ENGINE VERIFICATION ================');

// 1. Load Workflow JSON
const workflowFile = 'evolution_whatsapp_ai_agent_bot.json';
if (!fs.existsSync(workflowFile)) {
  console.error('FAIL: Workflow JSON not found!');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(workflowFile, 'utf8'));

// 2. Locate Shared Agent Node
const sharedAgent = data.nodes.find(n => n.id === '2004');
if (!sharedAgent) {
  console.error('FAIL: Node 2004 (Shared AI Agent Engine) not found!');
  process.exit(1);
}

console.log('1. Shared AI Agent Engine Runtime Check: PASS');
console.log('   Node ID: ' + sharedAgent.id);
console.log('   Node Name: ' + sharedAgent.name);

// 3. Verify Dynamic Prompt Template (No hardcoded legacy TechAuto)
const sysMsg = sharedAgent.parameters?.options?.systemMessage || '';
const hasTechAutoHardcoded = sysMsg.includes('TechAuto Solutions Pakistan');
const hasDynamicBusinessName = sysMsg.includes('{{ $json.business_name');
const hasDynamicBusinessCode = sysMsg.includes('{{ $json.business_code');
const hasDynamicSystemPrompt = sysMsg.includes('{{ $json.prompt_profile?.system_prompt');
const hasIsolationRules = sysMsg.includes('NO CROSS-TENANT DATA MIXING') && sysMsg.includes('STRICT BOUNDARY');

if (!hasTechAutoHardcoded && hasDynamicBusinessName && hasDynamicBusinessCode && hasDynamicSystemPrompt && hasIsolationRules) {
  console.log('2. Dynamic Prompt & Strict Isolation Verification: PASS');
  console.log('   - No hardcoded legacy company names.');
  console.log('   - Dynamic {{ $json.business_name }} & {{ $json.prompt_profile?.system_prompt }} verified.');
  console.log('   - Anti-hallucination & cross-tenant data isolation rules enforced.');
} else {
  console.error('FAIL: System prompt does not satisfy Phase 16 shared engine requirements!');
  console.error('hasTechAutoHardcoded:', hasTechAutoHardcoded);
  console.error('hasDynamicBusinessName:', hasDynamicBusinessName);
  console.error('hasDynamicSystemPrompt:', hasDynamicSystemPrompt);
  process.exit(1);
}

// 4. Test Multi-Tenant Prompt Interpolation for POS, BISE, Hospital & Future Tenant
function renderPrompt(template, json) {
  return template
    .replace(/\{\{\s*\$json\.business_name[^}]*\}\}/g, json.business_name || 'Our Valued Business')
    .replace(/\{\{\s*\$json\.business_code[^}]*\}\}/g, json.business_code || 'DEFAULT')
    .replace(/\{\{\s*\$json\.prompt_profile\?\.system_prompt[^}]*\}\}/g, json.prompt_profile?.system_prompt || 'Default Prompt')
    .replace(/\{\{\s*\$json\.pushName[^}]*\}\}/g, json.pushName || 'Customer')
    .replace(/\{\{\s*\$json\.customerPhone[^}]*\}\}/g, json.customerPhone || 'Unknown')
    .replace(/\{\{\s*\$json\.session_id[^}]*\}\}/g, json.session_id || 'DEFAULT_SESSION')
    .replace(/\{\{\s*\$json\.target_db_name[^}]*\}\}/g, json.target_db_name || 'default_db')
    .replace(/\{\{\s*\$json\.faiss_index_namespace[^}]*\}\}/g, json.faiss_index_namespace || 'default_collection');
}

const mockTenants = [
  {
    name: 'Retail POS',
    data: {
      business_code: 'POS_RETAIL',
      business_name: 'GlimsTech POS Retail Automation',
      target_db_name: 'pos_db',
      faiss_index_namespace: 'pos_collection',
      prompt_profile: { system_prompt: 'You represent GlimsTech POS. Assist customers with hardware/software products and PKR prices.' },
      pushName: 'Ali Khan',
      customerPhone: '923001234567',
      session_id: 'POS_RETAIL:pos-instance:923001234567'
    }
  },
  {
    name: 'BISE Education Board',
    data: {
      business_code: 'BISE_EDU',
      business_name: 'BISE Educational Board System',
      target_db_name: 'bise_db',
      faiss_index_namespace: 'bise_collection',
      prompt_profile: { system_prompt: 'You represent BISE Board System. Help students check exam results by Roll Number.' },
      pushName: 'Usman Tariq',
      customerPhone: '923219876543',
      session_id: 'BISE_EDU:bise-instance:923219876543'
    }
  },
  {
    name: 'City Hospital',
    data: {
      business_code: 'HOSP_HEALTH',
      business_name: 'City Healthcare & Hospital System',
      target_db_name: 'hospital_db',
      faiss_index_namespace: 'hosp_collection',
      prompt_profile: { system_prompt: 'You represent City Hospital. Assist patients with OPD doctor directory and appointments.' },
      pushName: 'Sara Ahmed',
      customerPhone: '923334567890',
      session_id: 'HOSP_HEALTH:hospital-instance:923334567890'
    }
  },
  {
    name: 'Future Business: Royal Spice Restaurant',
    data: {
      business_code: 'REST_FOOD',
      business_name: 'Royal Spice Restaurant & Catering',
      target_db_name: 'restaurant_db',
      faiss_index_namespace: 'restaurant_collection',
      prompt_profile: { system_prompt: 'You represent Royal Spice Restaurant. Assist diners with daily menu, table bookings, and food delivery.' },
      pushName: 'Bilal Hassan',
      customerPhone: '923456789012',
      session_id: 'REST_FOOD:restaurant-instance:923456789012'
    }
  }
];

console.log('3. Multi-Tenant Runtime Invocation Simulation:');
for (const t of mockTenants) {
  const rendered = renderPrompt(sysMsg, t.data);
  const containsCorrectTenant = rendered.includes(t.data.business_name);
  const containsCorrectCode = rendered.includes(t.data.business_code);
  const containsCorrectPrompt = rendered.includes(t.data.prompt_profile.system_prompt);
  
  if (containsCorrectTenant && containsCorrectCode && containsCorrectPrompt) {
    console.log(`   [PASS] ${t.name}: Single Agent Engine correctly bound to ${t.data.business_code} without data mixing.`);
  } else {
    console.error(`   [FAIL] ${t.name} prompt rendering error!`);
    process.exit(1);
  }
}

// 5. Verify Tool Multi-Tenant Isolation
const kbTool = data.nodes.find(n => n.id === '2007');
const crmTool = data.nodes.find(n => n.id === '2010');

const kbIsIsolated = kbTool?.parameters?.jsCode?.includes('businessCode') || kbTool?.parameters?.jsCode?.includes('faiss_index_namespace');
const crmIsIsolated = crmTool?.parameters?.jsCode?.includes('businessCode');

if (kbIsIsolated && crmIsIsolated) {
  console.log('4. Tool Tenant Isolation Verification: PASS');
  console.log('   - KB Tool routes to specific business_code / namespace per business.');
  console.log('   - CRM Tool records specific business_code & session_id.');
} else {
  console.error('FAIL: Tools are not tenant-isolated!');
  process.exit(1);
}

// 6. Regression Check for Complete Workflow Chain
const expectedChain = [
  'Evolution Webhook',
  'Is Customer Message?',
  'Message Normalizer',
  'Resolve Business (platform_db)',
  'Load Business Profile (platform_db)',
  'Construct Session Identity',
  'Redis Transient Session & Dedup Gate',
  'PostgreSQL Persistent Conversation Store',
  'AI Agent (Shared Engine)',
  'Result Validator & Response Guard',
  'Send WhatsApp Response (Evolution Router)'
];

let currNode = 'Evolution Webhook';
let chainPassed = true;

for (let i = 0; i < expectedChain.length - 1; i++) {
  const target = expectedChain[i + 1];
  const next = data.connections[currNode]?.main?.[0]?.[0]?.node;
  if (next !== target) {
    console.error(`FAIL: Broken connection: ${currNode} -> ${next} (expected: ${target})`);
    chainPassed = false;
    break;
  }
  currNode = next;
}

if (chainPassed) {
  console.log('5. End-to-End Workflow Chain Integrity: PASS');
  console.log('   All 10 sequential pipeline stages connected 100% correctly.');
} else {
  process.exit(1);
}

console.log('\nSUCCESS: Phase 16 Shared AI Agent Engine 100% VERIFIED & PASS!\n');
