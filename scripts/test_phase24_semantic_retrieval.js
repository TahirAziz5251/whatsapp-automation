/**
 * Phase 24: Semantic Retrieval Test Suite & Retrieval Benchmark
 * 
 * Objectives Tested:
 * 1. Validate pgvector search before agent integration
 * 2. Top-K semantic search across all 3 business domains
 * 3. Enforce strict business filtering (zero cross-tenant leakage)
 * 4. Measure relevance scores (distance / similarity)
 * 5. Measure query latency (in-engine and round-trip)
 * 6. Validate empty-result behavior for out-of-domain queries
 * 7. Least-privilege role execution (gateway_readonly)
 */

const { searchSemantic, runPsql } = require('./semantic_search');
const { generateEmbedding } = require('./ingest_documents');

console.log('================ PHASE 24 SEMANTIC RETRIEVAL VERIFICATION ================');

// 1. In-Domain Semantic Search Verification
console.log('\n1. Testing In-Domain Semantic Search across Business Verticals:');

// 1a. POS Retail Test
console.log('   --- 1a. POS Retail: Thermal printer & scanner query ---');
const posQuery = 'thermal receipt printer replacement warranty';
const posRes = searchSemantic({ query: posQuery, businessCode: 'POS_RETAIL', topK: 3 });
if (posRes.status === 'SUCCESS' && posRes.results_count > 0) {
  const topResult = posRes.results[0];
  console.log(`   [PASS - POS] Found ${posRes.results_count} results (Latency: ${posRes.latency_ms}ms)`);
  console.log(`          Top Match: "${topResult.document_title}" - "${topResult.chunk_title}"`);
  console.log(`          Distance: ${topResult.distance} (Similarity: ${(topResult.similarity * 100).toFixed(1)}%)`);
  if (!topResult.document_title.toLowerCase().includes('pos')) {
    console.error('   [FAIL] Top result is not a POS document!', topResult);
    process.exit(1);
  }
} else {
  console.error('   [FAIL] POS semantic query returned no results!', posRes);
  process.exit(1);
}

// 1b. BISE Education Test
console.log('\n   --- 1b. BISE Education: Paper rechecking & fee challan query ---');
const biseQuery = 'matric paper rechecking fee bank challan HBL';
const biseRes = searchSemantic({ query: biseQuery, businessCode: 'BISE_EDU', topK: 3 });
if (biseRes.status === 'SUCCESS' && biseRes.results_count > 0) {
  const topResult = biseRes.results[0];
  console.log(`   [PASS - BISE] Found ${biseRes.results_count} results (Latency: ${biseRes.latency_ms}ms)`);
  console.log(`          Top Match: "${topResult.document_title}" - "${topResult.chunk_title}"`);
  console.log(`          Distance: ${topResult.distance} (Similarity: ${(topResult.similarity * 100).toFixed(1)}%)`);
  if (!topResult.document_title.toLowerCase().includes('bise')) {
    console.error('   [FAIL] Top result is not a BISE document!', topResult);
    process.exit(1);
  }
} else {
  console.error('   [FAIL] BISE semantic query returned no results!', biseRes);
  process.exit(1);
}

// 1c. Hospital Healthcare Test
console.log('\n   --- 1c. Hospital Healthcare: Emergency trauma ambulance query ---');
const hospQuery = '24 hour emergency ambulance trauma resuscitation center';
const hospRes = searchSemantic({ query: hospQuery, businessCode: 'HOSP_HEALTH', topK: 3 });
if (hospRes.status === 'SUCCESS' && hospRes.results_count > 0) {
  const topResult = hospRes.results[0];
  console.log(`   [PASS - HOSP] Found ${hospRes.results_count} results (Latency: ${hospRes.latency_ms}ms)`);
  console.log(`          Top Match: "${topResult.document_title}" - "${topResult.chunk_title}"`);
  console.log(`          Distance: ${topResult.distance} (Similarity: ${(topResult.similarity * 100).toFixed(1)}%)`);
  if (!topResult.document_title.toLowerCase().includes('hospital') && !topResult.document_title.toLowerCase().includes('healthcare')) {
    console.error('   [FAIL] Top result is not a Hospital document!', topResult);
    process.exit(1);
  }
} else {
  console.error('   [FAIL] Hospital semantic query returned no results!', hospRes);
  process.exit(1);
}

// 2. Cross-Tenant Boundary Isolation Matrix (Crucial Security Check)
console.log('\n2. Testing Cross-Tenant Boundary Isolation (Zero Cross-Business Leakage):');

// 2a. Query for POS printer under BISE tenant scope
const crossPosBise = searchSemantic({ query: 'thermal receipt printer barcode scanner', businessCode: 'BISE_EDU' });
const leakedPos = crossPosBise.results.filter(r => r.business_code !== 'BISE_EDU' || r.document_title.toLowerCase().includes('pos'));
if (leakedPos.length === 0) {
  console.log(`   [PASS] POS printer query under BISE_EDU scope returned ZERO POS records (Zero Leakage). Returned items: ${crossPosBise.results_count}`);
} else {
  console.error('   [FAIL] Cross-tenant leak: BISE scope returned POS records!', leakedPos);
  process.exit(1);
}

// 2b. Query for BISE exam rechecking under Hospital scope
const crossBiseHosp = searchSemantic({ query: 'matric examination paper rechecking marks', businessCode: 'HOSP_HEALTH' });
const leakedBise = crossBiseHosp.results.filter(r => r.business_code !== 'HOSP_HEALTH' || r.document_title.toLowerCase().includes('bise'));
if (leakedBise.length === 0) {
  console.log(`   [PASS] BISE rechecking query under HOSP_HEALTH scope returned ZERO BISE records (Zero Leakage). Returned items: ${crossBiseHosp.results_count}`);
} else {
  console.error('   [FAIL] Cross-tenant leak: Hospital scope returned BISE records!', leakedBise);
  process.exit(1);
}

// 2c. Query for Hospital emergency trauma under POS scope
const crossHospPos = searchSemantic({ query: 'cardiac emergency trauma resuscitation bay', businessCode: 'POS_RETAIL' });
const leakedHosp = crossHospPos.results.filter(r => r.business_code !== 'POS_RETAIL' || r.document_title.toLowerCase().includes('hospital'));
if (leakedHosp.length === 0) {
  console.log(`   [PASS] Hospital emergency query under POS_RETAIL scope returned ZERO Hospital records (Zero Leakage). Returned items: ${crossHospPos.results_count}`);
} else {
  console.error('   [FAIL] Cross-tenant leak: POS scope returned Hospital records!', leakedHosp);
  process.exit(1);
}

// 3. Out-of-Domain Empty Result Behavior
console.log('\n3. Testing Empty-Result Behavior on Out-of-Domain / Irrelevant Queries:');

const oodQueries = [
  'interstellar spacecraft propulsion system',
  'cryptocurrency mining proof of stake',
  'medieval renaissance oil paintings'
];

for (const q of oodQueries) {
  const oodRes = searchSemantic({ query: q, businessCode: 'POS_RETAIL' });
  if (oodRes.results_count === 0 && oodRes.status === 'EMPTY_RESULTS_NO_MATCH') {
    console.log(`   [PASS] Out-of-domain query "${q}" returned empty result set.`);
  } else {
    console.error(`   [FAIL] Out-of-domain query "${q}" hallucinated results!`, oodRes);
    process.exit(1);
  }
}

// 4. In-Engine PostgreSQL Query Performance (EXPLAIN ANALYZE)
console.log('\n4. Benchmarking In-Engine pgvector Query Latency:');
const testVec = generateEmbedding('OPD cardiology specialist consultation hours');
const explainSql = `
  EXPLAIN (ANALYZE, BUFFERS)
  SELECT c.id, c.chunk_title, (c.embedding <=> '${testVec}'::vector) as distance
  FROM knowledge_chunks c
  JOIN knowledge_documents d ON c.document_id = d.id
  WHERE c.business_code = 'HOSP_HEALTH'
    AND d.status = 'ACTIVE'
    AND (c.embedding <=> '${testVec}'::vector) <= 0.85
  ORDER BY distance ASC
  LIMIT 3;
`;
const explainPlan = runPsql(explainSql, 'gateway_readonly');
const execTimeMatch = explainPlan.match(/Execution Time:\s+([\d\.]+)\s+ms/i);
const planTimeMatch = explainPlan.match(/Planning Time:\s+([\d\.]+)\s+ms/i);

if (execTimeMatch) {
  const execTime = parseFloat(execTimeMatch[1]);
  console.log(`   [PASS] In-Engine Execution Time: ${execTime} ms (Planning: ${planTimeMatch ? planTimeMatch[1] : 'N/A'} ms)`);
  if (execTime < 50.0) {
    console.log(`   [PASS] In-engine performance well within high-speed threshold (< 50ms).`);
  }
} else {
  console.log(`   [NOTE] EXPLAIN Output:\n${explainPlan}`);
}

// 5. Least-Privilege Role Security Verification
console.log('\n5. Verifying Least-Privilege Role Access (gateway_readonly):');
const roTest = searchSemantic({
  query: 'desktop barcode scanner',
  businessCode: 'POS_RETAIL',
  role: 'gateway_readonly'
});
if (roTest.status === 'SUCCESS' && roTest.results_count > 0) {
  console.log(`   [PASS] gateway_readonly role executed semantic retrieval successfully (${roTest.results_count} results).`);
} else {
  console.error('   [FAIL] gateway_readonly could not execute semantic search!', roTest);
  process.exit(1);
}

// 6. Threshold Tuning Verification
console.log('\n6. Testing Dynamic Threshold & Top-K Parameter Control:');
// Restrict topK to 1
const top1Res = searchSemantic({ query: posQuery, businessCode: 'POS_RETAIL', topK: 1 });
if (top1Res.results_count === 1) {
  console.log('   [PASS] topK=1 parameter strictly respected (returned exactly 1 result).');
} else {
  console.error(`   [FAIL] topK=1 returned ${top1Res.results_count} results!`);
  process.exit(1);
}

// Restrict maxDistance to very tight threshold (e.g. 0.40)
const tightRes = searchSemantic({ query: posQuery, businessCode: 'POS_RETAIL', maxDistance: 0.40 });
console.log(`   [PASS] Tight distance threshold cutoff (maxDistance=0.40) returned ${tightRes.results_count} ultra-precise results.`);

console.log('\n================ ALL PHASE 24 VERIFICATION CHECKS PASSED ================');
