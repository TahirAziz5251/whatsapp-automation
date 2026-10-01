/**
 * Phase 37: Business Administration & Dynamic Onboarding Verification Test Suite
 * 
 * Verifies:
 * 1. Control-Plane Business Directory (platform_businesses)
 * 2. WhatsApp Instance Mapping (platform_whatsapp_instances)
 * 3. Database Mapping (platform_database_mappings)
 * 4. Knowledge Base Vector Namespace Mapping (platform_knowledge_mappings)
 * 5. Dynamic Profile & System Prompt Resolution (Node 2012 simulator)
 * 6. Multi-Tenant Tool Permissions & Policy Isolation (platform_tool_permissions)
 * 7. Zero-Workflow Mutation Exit Criteria (Onboarding strictly via DB config)
 */

const assert = require('assert');
const { execSync } = require('child_process');
const { onboardBusiness } = require('./onboard_new_business');
const { executePolicyGate } = require('./multi_business_isolation');

function runPlatformPsql(sql) {
  return execSync('docker exec -i evolution-postgres psql -U postgres -d platform_db -t -A', {
    input: sql,
    encoding: 'utf8'
  }).trim();
}

async function runPhase37Test() {
  console.log('========================================================================');
  console.log('🧪 RUNNING PHASE 37: BUSINESS ADMINISTRATION & ONBOARDING SUITE');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function recordAssert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  // --- Step 0: Run Onboarding Engine for Test Business: RESTAURANT_FOOD ---
  console.log('--- Step 0: Executing Automated Business Onboarding Engine ---');
  try {
    const onboardRes = onboardBusiness({
      businessCode: 'RESTAURANT_FOOD',
      businessName: 'Gourmet Express Restaurant & Food Delivery',
      industryType: 'FOOD_BEVERAGE',
      instanceName: 'restaurant-instance',
      instanceToken: 'rest_token_998877',
      targetDbName: 'platform_db',
      faissNamespace: 'restaurant_collection',
      systemPrompt: 'You represent Gourmet Express Restaurant. Guide customers through food menu selection, table reservations, and delivery tracking.',
      allowedTools: ['search_knowledge_base', 'action_gateway', 'query_business_data'],
      modelProvider: 'Groq',
      modelName: 'openai/gpt-oss-120b',
      temperature: 0.3
    });
    recordAssert(onboardRes.status === 'SUCCESS', 'Onboarding CLI executed successfully');
  } catch (e) {
    recordAssert(false, `Onboarding engine failed: ${e.message}`);
  }

  // --- Test 1: Control-Plane Business Directory ---
  console.log('\n--- Test 1: Control-Plane Business Directory ---');
  try {
    const bizData = runPlatformPsql("SELECT name, industry_type, status FROM platform_businesses WHERE business_code = 'RESTAURANT_FOOD' LIMIT 1;");
    const parts = bizData.split('|');
    recordAssert(parts.length >= 3, 'Registered in platform_businesses');
    recordAssert(parts[0].trim().includes('Gourmet Express'), `Business name verified: ${parts[0].trim()}`);
    recordAssert(parts[1].trim() === 'FOOD_BEVERAGE', `Industry type verified: ${parts[1].trim()}`);
    recordAssert(parts[2].trim() === 'ACTIVE', 'Business status set to ACTIVE');
  } catch (e) {
    recordAssert(false, `Business directory check failed: ${e.message}`);
  }

  // --- Test 2: WhatsApp Instance Mapping ---
  console.log('\n--- Test 2: WhatsApp Instance Mapping ---');
  try {
    const instData = runPlatformPsql("SELECT business_code, status FROM platform_whatsapp_instances WHERE instance_name = 'restaurant-instance' LIMIT 1;");
    const parts = instData.split('|');
    recordAssert(parts[0].trim() === 'RESTAURANT_FOOD', 'Instance dynamically maps to RESTAURANT_FOOD');
    recordAssert(parts[1].trim() === 'CONNECTED', 'Instance status set to CONNECTED');
  } catch (e) {
    recordAssert(false, `WhatsApp instance mapping check failed: ${e.message}`);
  }

  // --- Test 3: Database Mapping ---
  console.log('\n--- Test 3: Database Mapping ---');
  try {
    const dbData = runPlatformPsql("SELECT target_db_name FROM platform_database_mappings WHERE business_code = 'RESTAURANT_FOOD' LIMIT 1;");
    recordAssert(dbData.includes('platform_db'), 'Mapped target database verified: platform_db');
  } catch (e) {
    recordAssert(false, `Database mapping check failed: ${e.message}`);
  }

  // --- Test 4: Knowledge Base Namespace Mapping ---
  console.log('\n--- Test 4: Knowledge Base Namespace Mapping ---');
  try {
    const kbData = runPlatformPsql("SELECT faiss_index_namespace FROM platform_knowledge_mappings WHERE business_code = 'RESTAURANT_FOOD' LIMIT 1;");
    recordAssert(kbData.includes('restaurant_collection'), 'Vector namespace verified: restaurant_collection');
  } catch (e) {
    recordAssert(false, `Knowledge mapping check failed: ${e.message}`);
  }

  // --- Test 5: Dynamic Profile Loading without n8n Mutation ---
  console.log('\n--- Test 5: Dynamic Profile Loading without n8n Workflow Mutation ---');
  try {
    const profData = runPlatformPsql("SELECT system_prompt, default_language, currency FROM platform_business_profiles WHERE business_code = 'RESTAURANT_FOOD' LIMIT 1;");
    const parts = profData.split('|');
    recordAssert(parts[0].trim().includes('Gourmet Express'), 'Dynamic system prompt loaded successfully');
    recordAssert(parts[1].trim() === 'en' && parts[2].trim() === 'PKR', 'Operating parameters loaded (en / PKR)');
  } catch (e) {
    recordAssert(false, `Dynamic profile loading test failed: ${e.message}`);
  }

  // --- Test 6: Policy Gate Isolation Enforcement ---
  console.log('\n--- Test 6: Policy Gate Isolation Enforcement ---');
  try {
    const allowedCheck = runPlatformPsql("SELECT tool_name FROM platform_tool_permissions WHERE business_code = 'RESTAURANT_FOOD' AND is_allowed = TRUE ORDER BY tool_name;");
    const tools = allowedCheck.split('\n').map(t => t.trim());
    recordAssert(tools.includes('search_knowledge_base'), 'Granted search_knowledge_base permission');
    recordAssert(tools.includes('action_gateway'), 'Granted action_gateway permission');
    recordAssert(!tools.includes('check_exam_results'), 'Blocked access to alien BISE tool (check_exam_results)');
    recordAssert(!tools.includes('get_doctor_schedule'), 'Blocked access to alien Hospital tool (get_doctor_schedule)');
  } catch (e) {
    recordAssert(false, `Policy gate isolation test failed: ${e.message}`);
  }

  // --- Test 7: Exit Criteria - Zero Workflow Mutation ---
  console.log('\n--- Test 7: Exit Criteria - Zero Workflow Mutation Verification ---');
  try {
    const fs = require('fs');
    const workflowContent = fs.readFileSync('evolution_whatsapp_ai_agent_bot.json', 'utf8');
    recordAssert(workflowContent.includes('platform_whatsapp_instances'), 'n8n workflow uses dynamic instance resolver query');
    recordAssert(workflowContent.includes('platform_business_profiles'), 'n8n workflow uses dynamic profile loader query');
    recordAssert(!workflowContent.includes('RESTAURANT_FOOD'), 'Exit Criteria Passed: Zero hardcoded tenant references in n8n workflow JSON!');
  } catch (e) {
    recordAssert(false, `Exit criteria check failed: ${e.message}`);
  }

  console.log('\n========================================================================');
  console.log(`🏁 PHASE 37 FINISHED: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runPhase37Test();
}

module.exports = { runPhase37Test };
