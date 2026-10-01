const { execSync } = require('child_process');
const path = require('path');

const testFiles = [
  'test_phase15_persistent_store.js',
  'test_phase16_shared_agent.js',
  'test_phase17_dynamic_prompts.js',
  'test_phase18_policy_gate.js',
  'test_phase19_data_gateway.js',
  'test_phase20_sql_tools.js',
  'test_phase21_pgvector.js',
  'test_phase22_knowledge_schema.js',
  'test_phase23_ingestion_pipeline.js',
  'test_phase24_semantic_retrieval.js',
  'test_phase25_hybrid_retrieval.js',
  'test_phase26_knowledge_gateway.js',
  'test_phase27_action_gateway.js',
  'test_phase28_domain_actions.js',
  'test_phase29_human_approval.js',
  'test_phase30_result_validation.js',
  'test_phase31_response_security.js',
  'test_phase32_audit_logging.js',
  'test_phase33_response_router.js',
  'test_phase34_multi_business_isolation.js',
  'test_phase35_agent_evaluation.js',
  'test_phase36_e2e_whatsapp.js',
  'test_bise_student_service.js',
  'test_pos_verification.js',
  'test_hospital_verification.js',
  'test_phase37_business_onboarding.js',
  'test_phase38_backup_restore.js',
  'test_phase39_monitoring_observability.js',
  'test_phase40_docker_architecture.js'
];

console.log('================================================================');
console.log('       RUNNING ALL PHASE TEST SUITES (PHASE 15 TO 40)');
console.log('================================================================\n');

let passedCount = 0;
let failedCount = 0;
const results = [];

for (const file of testFiles) {
  const filePath = path.join(__dirname, file);
  console.log(`\n▶ Running: ${file}...`);
  try {
    const output = execSync(`node "${filePath}"`, { encoding: 'utf8', stdio: 'pipe' });
    console.log(`  ✓ SUCCESS: ${file}`);
    passedCount++;
    results.push({ file, status: 'PASSED', output: output.trim().split('\n').pop() });
  } catch (err) {
    console.error(`  ✗ FAILED: ${file}`);
    console.error(err.stdout || err.stderr || err.message);
    failedCount++;
    results.push({ file, status: 'FAILED', error: err.message });
  }
}

console.log('\n================================================================');
console.log(`SUMMARY: Total Test Suites: ${testFiles.length} | Passed: ${passedCount} | Failed: ${failedCount}`);
console.log('================================================================\n');

if (failedCount > 0) {
  process.exit(1);
}
