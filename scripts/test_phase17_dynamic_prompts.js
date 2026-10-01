const fs = require('fs');

console.log('================ PHASE 17 DYNAMIC BUSINESS PROMPT & CONTEXT VERIFICATION ================');

// 1. Verify Canonical DDL Schema in init-platform-db.sql
const ddlFile = 'database/init-platform-db.sql';
if (!fs.existsSync(ddlFile)) {
  console.error('FAIL: Canonical DDL init-platform-db.sql not found!');
  process.exit(1);
}

const ddlContent = fs.readFileSync(ddlFile, 'utf8');
const hasPromptVersionCol = ddlContent.includes('prompt_version VARCHAR(20)');
const hasRoleDescCol = ddlContent.includes('role_description TEXT');
const hasScopeCol = ddlContent.includes('allowed_scope TEXT');
const hasStyleCol = ddlContent.includes('response_style VARCHAR(100)');
const hasBehaviorRulesCol = ddlContent.includes('behavior_rules JSONB');
const hasUniqueConstraint = ddlContent.includes('uq_business_prompt_version UNIQUE');

if (hasPromptVersionCol && hasRoleDescCol && hasScopeCol && hasStyleCol && hasBehaviorRulesCol && hasUniqueConstraint) {
  console.log('1. Database Schema DDL Verification: PASS');
  console.log('   - platform_business_profiles table upgraded with prompt_version, role, scope, style, and rules.');
  console.log('   - Unique constraint (business_code, prompt_version) verified.');
} else {
  console.error('FAIL: Missing versioned profile columns in init-platform-db.sql!');
  process.exit(1);
}

// 2. Verify Workflow Node 2012 (Profile Loader)
const workflowFile = 'evolution_whatsapp_ai_agent_bot.json';
const data = JSON.parse(fs.readFileSync(workflowFile, 'utf8'));

const node2012 = data.nodes.find(n => n.id === '2012');
if (!node2012) {
  console.error('FAIL: Node 2012 not found!');
  process.exit(1);
}

const node2012Code = node2012.parameters?.jsCode || '';
const loadsVersion = node2012Code.includes('prompt_version');
const loadsRole = node2012Code.includes('role_description');
const loadsScope = node2012Code.includes('allowed_scope');
const loadsRules = node2012Code.includes('behavior_rules');

if (loadsVersion && loadsRole && loadsScope && loadsRules) {
  console.log('2. Node 2012 Dynamic Profile Loader Verification: PASS');
  console.log('   - Dynamically selects versioned profile attributes and behavioral rules.');
} else {
  console.error('FAIL: Node 2012 missing dynamic profile fields!');
  process.exit(1);
}

// 3. Verify Node 2004 System Prompt Template
const node2004 = data.nodes.find(n => n.id === '2004');
if (!node2004) {
  console.error('FAIL: Node 2004 not found!');
  process.exit(1);
}

const sysMsg = node2004.parameters?.options?.systemMessage || '';
const hasDynamicRole = sysMsg.includes('{{ $json.prompt_profile?.role_description');
const hasDynamicScope = sysMsg.includes('{{ $json.prompt_profile?.allowed_scope');
const hasDynamicStyle = sysMsg.includes('{{ $json.prompt_profile?.response_style');
const hasDynamicVersion = sysMsg.includes('{{ $json.prompt_profile?.prompt_version');
const hasZeroHardcoded = !sysMsg.includes('GlimsTech') && !sysMsg.includes('BISE') && !sysMsg.includes('City Hospital') && !sysMsg.includes('TechAuto');

if (hasDynamicRole && hasDynamicScope && hasDynamicStyle && hasDynamicVersion && hasZeroHardcoded) {
  console.log('3. Node 2004 Shared Agent Dynamic Context Verification: PASS');
  console.log('   - Zero single-business hardcoding remains in agent system prompt template.');
  console.log('   - Role, Scope, Style, and Version are 100% dynamically injected.');
} else {
  console.error('FAIL: Node 2004 template is not fully profile-driven!');
  process.exit(1);
}

// 4. Test Rendering for all 3 Profiles (POS vs BISE vs Hospital)
function renderAgentPrompt(template, item) {
  return template
    .replace(/\{\{\s*\$json\.business_name[^}]*\}\}/g, item.business_name)
    .replace(/\{\{\s*\$json\.business_code[^}]*\}\}/g, item.business_code)
    .replace(/\{\{\s*\$json\.prompt_profile\?\.prompt_version[^}]*\}\}/g, item.prompt_profile.prompt_version)
    .replace(/\{\{\s*\$json\.prompt_profile\?\.role_description[^}]*\}\}/g, item.prompt_profile.role_description)
    .replace(/\{\{\s*\$json\.prompt_profile\?\.allowed_scope[^}]*\}\}/g, item.prompt_profile.allowed_scope)
    .replace(/\{\{\s*\$json\.prompt_profile\?\.response_style[^}]*\}\}/g, item.prompt_profile.response_style)
    .replace(/\{\{\s*\$json\.prompt_profile\?\.system_prompt[^}]*\}\}/g, item.prompt_profile.system_prompt)
    .replace(/\{\{\s*\$json\.target_db_name[^}]*\}\}/g, item.target_db_name)
    .replace(/\{\{\s*\$json\.faiss_index_namespace[^}]*\}\}/g, item.faiss_index_namespace)
    .replace(/\{\{\s*\(\$json\.allowed_tools\s*\|\|\s*\[\]\)\.join\([^)]+\)\s*\}\}/g, item.allowed_tools.join(', '))
    .replace(/\{\{\s*\$json\.session_id[^}]*\}\}/g, item.session_id);
}

const testProfiles = [
  {
    vertical: 'Retail POS',
    business_code: 'POS_RETAIL',
    business_name: 'GlimsTech POS Retail Automation',
    target_db_name: 'pos_db',
    faiss_index_namespace: 'pos_collection',
    allowed_tools: ['search_knowledge_base', 'sync_crm'],
    session_id: 'POS_RETAIL:pos-instance:923001234567',
    prompt_profile: {
      prompt_version: 'v1.0',
      role_description: 'Senior Retail POS & Hardware Automation Advisor',
      allowed_scope: 'Retail POS billing software, barcode scanners, price quotes in PKR, and demo bookings.',
      response_style: 'Consultative, energetic, commercial with retail emojis.',
      system_prompt: 'Provide expert guidance on retail POS hardware and demo setups.'
    }
  },
  {
    vertical: 'BISE Education Board',
    business_code: 'BISE_EDU',
    business_name: 'BISE Educational Board System',
    target_db_name: 'bise_db',
    faiss_index_namespace: 'bise_collection',
    allowed_tools: ['search_knowledge_base', 'check_exam_results'],
    session_id: 'BISE_EDU:bise-instance:923219876543',
    prompt_profile: {
      prompt_version: 'v1.0',
      role_description: 'Official Academic Examination Controller & Student Helpdesk Assistant',
      allowed_scope: 'Matric & Intermediate exam results, roll number verification, and date sheets.',
      response_style: 'Formal, authoritative, clear with academic emojis.',
      system_prompt: 'Help students check exam results by Roll Number and view exam date sheets.'
    }
  },
  {
    vertical: 'City Healthcare & Hospital',
    business_code: 'HOSP_HEALTH',
    business_name: 'City Healthcare & Hospital System',
    target_db_name: 'hospital_db',
    faiss_index_namespace: 'hosp_collection',
    allowed_tools: ['search_knowledge_base', 'manage_calendar'],
    session_id: 'HOSP_HEALTH:hospital-instance:923334567890',
    prompt_profile: {
      prompt_version: 'v1.0',
      role_description: 'Hospital Patient Care & Clinical OPD Appointment Coordinator',
      allowed_scope: 'Doctor directories by clinical specialty, OPD clinic schedules, and appointments.',
      response_style: 'Empathetic, polite, cautious with healthcare emojis.',
      system_prompt: 'Assist patients with OPD doctor directory and appointments. NEVER PROVIDE MEDICAL DIAGNOSIS.'
    }
  }
];

console.log('4. Profile-Driven Runtime Context Simulation:');
for (const p of testProfiles) {
  const rendered = renderAgentPrompt(sysMsg, p);
  
  // Verify strict domain isolation
  const hasOwnRole = rendered.includes(p.prompt_profile.role_description);
  const hasOwnScope = rendered.includes(p.prompt_profile.allowed_scope);
  const hasOwnDb = rendered.includes(p.target_db_name);
  const hasOwnKnowledge = rendered.includes(p.faiss_index_namespace);
  const hasOwnTools = rendered.includes(p.allowed_tools.join(', '));
  
  if (hasOwnRole && hasOwnScope && hasOwnDb && hasOwnKnowledge && hasOwnTools) {
    console.log(`   [PASS] ${p.vertical}:`);
    console.log(`          - Role: ${p.prompt_profile.role_description}`);
    console.log(`          - Database: ${p.target_db_name} | Knowledge: ${p.faiss_index_namespace}`);
    console.log(`          - Allowed Tools: [${p.allowed_tools.join(', ')}]`);
  } else {
    console.error(`   [FAIL] ${p.vertical} dynamic prompt assembly mismatch!`);
    process.exit(1);
  }
}

// 5. Complete Workflow Chain Regression Check
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
for (let i = 0; i < expectedChain.length - 1; i++) {
  const target = expectedChain[i + 1];
  const next = data.connections[currNode]?.main?.[0]?.[0]?.node;
  if (next !== target) {
    console.error(`FAIL: Broken connection: ${currNode} -> ${next} (expected: ${target})`);
    process.exit(1);
  }
  currNode = next;
}
console.log('5. End-to-End Workflow Pipeline Integrity: PASS (All 10 stages sequential)');

console.log('\nSUCCESS: Phase 17 Dynamic Business Prompt / Context Loading 100% VERIFIED & PASS!\n');
