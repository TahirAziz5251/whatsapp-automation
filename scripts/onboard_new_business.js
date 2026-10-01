/**
 * Phase 37: Automated Business Onboarding CLI & Helper Script
 * 
 * Objective:
 * Onboard future business verticals strictly through controlled database configuration records,
 * allowing new business tenants to be added without redesigning or modifying the core n8n workflow.
 * 
 * Workflow Steps Executed by Onboarding Engine:
 * 1. Register Business in platform_businesses directory
 * 2. Bind WhatsApp Instance in platform_whatsapp_instances
 * 3. Configure Database Mapping in platform_database_mappings
 * 4. Configure Knowledge Namespace in platform_knowledge_mappings
 * 5. Insert System Prompt Profile in platform_business_profiles
 * 6. Set Tool Permissions in platform_tool_permissions
 * 7. Configure LLM Agent Settings in platform_agent_configs
 */

const { execSync } = require('child_process');

function runPlatformPsql(sql) {
  return execSync('docker exec -i evolution-postgres psql -U postgres -d platform_db -t -A', {
    input: sql,
    encoding: 'utf8'
  }).trim();
}

/**
 * Onboards a new business tenant dynamically into platform_db control-plane
 * 
 * @param {Object} bizConfig - Business Onboarding Configuration Object
 */
function onboardBusiness(bizConfig) {
  const {
    businessCode,
    businessName,
    industryType = 'OTHER',
    instanceName,
    instanceToken = `token_${Date.now()}`,
    targetDbName,
    faissNamespace,
    systemPrompt,
    allowedTools = ['search_knowledge_base', 'action_gateway', 'query_business_data'],
    modelProvider = 'Groq',
    modelName = 'openai/gpt-oss-120b',
    temperature = 0.3
  } = bizConfig;

  console.log(`\n================================================================`);
  console.log(`🚀 ONBOARDING NEW BUSINESS TENANT: [${businessCode}] - ${businessName}`);
  console.log(`================================================================\n`);

  function escapeSql(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/'/g, "''");
  }

  // Step 1: Register Business Directory
  console.log(`Step 1: Registering business '${businessCode}' in platform_businesses...`);
  const sql1 = `
    INSERT INTO platform_businesses (business_code, name, industry_type, status)
    VALUES ('${escapeSql(businessCode)}', '${escapeSql(businessName)}', '${escapeSql(industryType)}', 'ACTIVE')
    ON CONFLICT (business_code) DO UPDATE SET 
      name = EXCLUDED.name, 
      industry_type = EXCLUDED.industry_type, 
      status = 'ACTIVE';
  `;
  runPlatformPsql(sql1);
  console.log(`  ✓ Business '${businessCode}' registered.`);

  // Step 2: Register Evolution WhatsApp Instance
  console.log(`Step 2: Mapping WhatsApp instance '${instanceName}'...`);
  const sql2 = `
    INSERT INTO platform_whatsapp_instances (business_code, instance_name, instance_token, status)
    VALUES ('${escapeSql(businessCode)}', '${escapeSql(instanceName)}', '${escapeSql(instanceToken)}', 'CONNECTED')
    ON CONFLICT (instance_name) DO UPDATE SET 
      business_code = EXCLUDED.business_code, 
      instance_token = EXCLUDED.instance_token, 
      status = 'CONNECTED';
  `;
  runPlatformPsql(sql2);
  console.log(`  ✓ WhatsApp instance '${instanceName}' mapped to '${businessCode}'.`);

  // Step 3: Database Mapping
  console.log(`Step 3: Configuring database mapping to '${targetDbName}'...`);
  const sql3 = `
    DELETE FROM platform_database_mappings WHERE business_code = '${escapeSql(businessCode)}';
    INSERT INTO platform_database_mappings (business_code, target_db_name, target_schema)
    VALUES ('${escapeSql(businessCode)}', '${escapeSql(targetDbName)}', 'public');
  `;
  runPlatformPsql(sql3);
  console.log(`  ✓ Target database '${targetDbName}' mapped.`);

  // Step 4: Knowledge Base Namespace Mapping
  console.log(`Step 4: Configuring vector namespace '${faissNamespace}'...`);
  const sql4 = `
    DELETE FROM platform_knowledge_mappings WHERE business_code = '${escapeSql(businessCode)}';
    INSERT INTO platform_knowledge_mappings (business_code, faiss_index_namespace, similarity_threshold, top_k)
    VALUES ('${escapeSql(businessCode)}', '${escapeSql(faissNamespace)}', 0.75, 3);
  `;
  runPlatformPsql(sql4);
  console.log(`  ✓ Knowledge namespace '${faissNamespace}' mapped.`);

  // Step 5: System Prompt Profile
  console.log(`Step 5: Inserting prompt profile in platform_business_profiles...`);
  const sql5 = `
    INSERT INTO platform_business_profiles (
      business_code, system_prompt, default_language, timezone, currency
    )
    VALUES (
      '${escapeSql(businessCode)}', '${escapeSql(systemPrompt)}', 'en', 'Asia/Karachi', 'PKR'
    )
    ON CONFLICT (business_code) DO UPDATE SET
      system_prompt = EXCLUDED.system_prompt;
  `;
  runPlatformPsql(sql5);
  console.log(`  ✓ Prompt profile configured for '${businessCode}'.`);

  // Step 6: Tool Permissions Matrix
  console.log(`Step 6: Setting tool permissions matrix...`);
  for (const tool of allowedTools) {
    const actionType = tool.includes('action') || tool.includes('sync') || tool.includes('create') ? 'WRITE' : 'READ';
    const sql6 = `
      INSERT INTO platform_tool_permissions (business_code, tool_name, action_type, min_identity_level, requires_approval, is_allowed, access_level, resource_target)
      VALUES ('${escapeSql(businessCode)}', '${escapeSql(tool)}', '${actionType}', 'ANONYMOUS', false, true, 'FULL', 'general')
      ON CONFLICT (business_code, tool_name) DO UPDATE SET is_allowed = TRUE;
    `;
    runPlatformPsql(sql6);
  }
  console.log(`  ✓ Permissions granted for ${allowedTools.length} tools.`);

  // Step 7: Agent Model Configuration
  console.log(`Step 7: Setting LLM model configuration...`);
  const sql7 = `
    DELETE FROM platform_agent_configs WHERE business_code = '${escapeSql(businessCode)}';
    INSERT INTO platform_agent_configs (business_code, model_provider, model_name, temperature)
    VALUES ('${escapeSql(businessCode)}', '${escapeSql(modelProvider)}', '${escapeSql(modelName)}', ${temperature});
  `;
  runPlatformPsql(sql7);
  console.log(`  ✓ Model config set to ${modelProvider} / ${modelName} (temp: ${temperature}).`);

  console.log(`\n================================================================`);
  console.log(`✅ BUSINESS ONBOARDING SUCCESSFUL: [${businessCode}] IS READY FOR TRAFFIC`);
  console.log(`================================================================\n`);

  return { status: 'SUCCESS', business_code: businessCode, instance_name: instanceName };
}

// Example Onboarding Invocation for Test Business: RESTAURANT_FOOD
if (require.main === module) {
  onboardBusiness({
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
}

module.exports = { onboardBusiness };
