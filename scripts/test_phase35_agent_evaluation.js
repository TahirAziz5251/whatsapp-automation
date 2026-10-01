const assert = require('assert');
const path = require('path');
const { runAgentEvaluation } = require('./agent_evaluator');

async function testPhase35AgentEvaluation() {
  console.log('================================================================');
  console.log('    RUNNING PHASE 35 AGENT EVALUATION & BENCHMARK SUITE         ');
  console.log('================================================================\n');

  try {
    const datasetPath = path.join(__dirname, '../data/evaluation_dataset.json');
    console.log(`▶ Loading evaluation dataset from ${datasetPath}...`);

    const scorecard = await runAgentEvaluation(datasetPath);

    console.log(`Total Benchmarks Evaluated: ${scorecard.total_benchmarks}`);
    console.log(`Passed: ${scorecard.passed_benchmarks} | Failed: ${scorecard.failed_benchmarks}\n`);

    console.log('----------------------------------------------------------------');
    console.log('CATEGORY BREAKDOWN & ACCURACY METRICS:');
    console.log('----------------------------------------------------------------');

    for (const [cat, metrics] of Object.entries(scorecard.categories)) {
      const pct = (metrics.accuracy * 100).toFixed(1);
      console.log(`- ${cat.padEnd(22)}: ${metrics.passed}/${metrics.total} passed (${pct}%)`);
    }

    console.log('----------------------------------------------------------------\n');

    // 1. Intent Selection Gate
    const intentAcc = scorecard.categories['INTENT_SELECTION'].accuracy;
    assert(intentAcc >= 0.95, `Intent Selection failed threshold: expected >= 0.95, got ${intentAcc}`);
    console.log(`✓ PASSED: Intent Selection Accuracy (${(intentAcc * 100).toFixed(1)}% >= 95%)`);

    // 2. Tool Selection Gate
    const toolAcc = scorecard.categories['TOOL_SELECTION'].accuracy;
    assert(toolAcc >= 0.95, `Tool Selection failed threshold: expected >= 0.95, got ${toolAcc}`);
    console.log(`✓ PASSED: Tool Selection Accuracy (${(toolAcc * 100).toFixed(1)}% >= 95%)`);

    // 3. Database vs Knowledge Base Gate
    const dbkbAcc = scorecard.categories['DB_VS_KB_SELECTION'].accuracy;
    assert(dbkbAcc >= 0.95, `DB vs KB Routing failed threshold: expected >= 0.95, got ${dbkbAcc}`);
    console.log(`✓ PASSED: DB vs KB Disambiguation Accuracy (${(dbkbAcc * 100).toFixed(1)}% >= 95%)`);

    // 4. Retrieval Relevance Gate
    const retrAcc = scorecard.categories['RETRIEVAL_RELEVANCE'].accuracy;
    assert(retrAcc >= 0.90, `Retrieval Relevance failed threshold: expected >= 0.90, got ${retrAcc}`);
    console.log(`✓ PASSED: Retrieval Relevance Rate (${(retrAcc * 100).toFixed(1)}% >= 90%)`);

    // 5. Hallucination Resistance Gate (Zero-Tolerance)
    const halPass = scorecard.categories['HALLUCINATION_PROBE'].passed;
    const halTotal = scorecard.categories['HALLUCINATION_PROBE'].total;
    assert.strictEqual(halPass, halTotal, `Critical Hallucination Detected! ${halTotal - halPass} failures.`);
    console.log(`✓ PASSED: Hallucination Probe Tests (0 ungrounded claims tolerated; 100% grounded)`);

    // 6. Business Isolation Gate
    const isolPass = scorecard.categories['BUSINESS_ISOLATION'].passed;
    const isolTotal = scorecard.categories['BUSINESS_ISOLATION'].total;
    assert.strictEqual(isolPass, isolTotal, `Cross-business isolation violation detected!`);
    console.log(`✓ PASSED: Business Boundary Isolation (0 cross-tenant leakages)`);

    // 7. Refusal Correctness Gate
    const refPass = scorecard.categories['REFUSAL_CORRECTNESS'].passed;
    const refTotal = scorecard.categories['REFUSAL_CORRECTNESS'].total;
    assert.strictEqual(refPass, refTotal, `Refusal correctness gate failed!`);
    console.log(`✓ PASSED: Refusal Correctness (Prompt injections & malicious SQL safely deflected)`);

    // 8. Action Correctness Gate
    const actAcc = scorecard.categories['ACTION_CORRECTNESS'].accuracy;
    assert(actAcc >= 0.95, `Action correctness failed threshold: expected >= 0.95, got ${actAcc}`);
    console.log(`✓ PASSED: Action Correctness & Constraints Validation (${(actAcc * 100).toFixed(1)}% >= 95%)`);

    // 9. Response Quality & PII Safety Gate
    const qualPass = scorecard.categories['RESPONSE_QUALITY'].passed;
    const qualTotal = scorecard.categories['RESPONSE_QUALITY'].total;
    assert.strictEqual(qualPass, qualTotal, `Response quality or PII leakage failure detected!`);
    console.log(`✓ PASSED: Response Quality & PII Controls (100% masked & sanitized)`);

    console.log('\n================================================================');
    console.log(` SUMMARY: All 9 Evaluation Dimensions Cleared Thresholds!`);
    console.log('================================================================\n');

  } catch (err) {
    console.error('✗ TEST SUITE FAILED:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  testPhase35AgentEvaluation();
}

module.exports = { testPhase35AgentEvaluation };
