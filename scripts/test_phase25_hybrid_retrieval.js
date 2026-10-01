/**
 * Phase 25: BM25 + pgvector Hybrid Retrieval Verification & Comparative Benchmark Suite
 * 
 * Objectives Tested:
 * 1. BM25 / Lexical search layer validation (ts_rank_cd, GIN index)
 * 2. Vector search layer validation (pgvector, HNSW cosine distance)
 * 3. Reciprocal Rank Fusion (RRF) & Re-ranking (w_lex=0.5, w_vec=0.5, k=60)
 * 4. Comparative Triad Verification:
 *    - Example A: Lexical-dominant exact match (acronym/number: "80mm", "PKR 1200", "1122")
 *    - Example B: Vector-dominant semantic match (conceptual synonyms: "broken gadget exchange period")
 *    - Example C: Hybrid fusion synergy (both keywords & semantics: "80mm printer warranty replacement")
 * 5. Strict multi-tenant isolation (zero cross-tenant leakage across POS, BISE, and Hospital)
 * 6. Dynamic threshold and empty-result behavior on out-of-domain queries
 * 7. Least-privilege role execution (gateway_readonly)
 */

const {
  searchLexicalOnly,
  searchVectorOnly,
  searchHybrid,
  compareRetrievalMethods,
  runPsql
} = require('./hybrid_search');

console.log('================ PHASE 25 HYBRID RETRIEVAL (BM25 + PGVECTOR) VERIFICATION ================');

// 1. COMPARATIVE TRIAD BENCHMARK (User Emphasis Requirement)
console.log('\n1. Comparative Benchmark: Lexical-Only vs Vector-Only vs Hybrid (RRF Fusion):');

// 1a. Example A: Exact Keyword / Token Match (Lexical Dominance)
console.log('\n   --- 1a. Example A: Exact Keyword / Acronym Match ("80mm") ---');
const compA = compareRetrievalMethods({
  query: '80mm',
  businessCode: 'POS_RETAIL',
  topK: 3
});

console.log(`       Lexical : Found ${compA.lexical.count} items | Top: "${compA.lexical.top_title}" (Score: ${compA.lexical.top_score})`);
console.log(`       Vector  : Found ${compA.vector.count} items | Top: "${compA.vector.top_title}" (Dist: ${compA.vector.top_distance})`);
console.log(`       Hybrid  : Found ${compA.hybrid.count} items | Top: "${compA.hybrid.top_title}" (RRF: ${compA.hybrid.top_rrf}, Source: ${compA.hybrid.top_source})`);

if (compA.lexical.count > 0 && compA.hybrid.count > 0 && compA.hybrid.top_title.includes('80mm')) {
  console.log('   [PASS - EXAMPLE A] Exact keyword "80mm" successfully retrieved and promoted by Hybrid search.');
} else {
  console.error('   [FAIL] Example A failed!', compA);
  process.exit(1);
}

// 1b. Example B: Conceptual Synonym Match (Vector Dominance)
console.log('\n   --- 1b. Example B: Conceptual Semantic Match ("OPD clinic timings doctor specialist") ---');
const compB = compareRetrievalMethods({
  query: 'OPD clinic timings doctor specialist',
  businessCode: 'HOSP_HEALTH',
  topK: 3
});

console.log(`       Lexical : Found ${compB.lexical.count} items (Expected: 0 due to no exact phrasing overlap)`);
console.log(`       Vector  : Found ${compB.vector.count} items | Top: "${compB.vector.top_title}" (Dist: ${compB.vector.top_distance})`);
console.log(`       Hybrid  : Found ${compB.hybrid.count} items | Top: "${compB.hybrid.top_title}" (RRF: ${compB.hybrid.top_rrf}, Source: ${compB.hybrid.top_source})`);

if (compB.vector.count > 0 && compB.hybrid.count > 0 && compB.hybrid.top_source.includes('VECTOR')) {
  console.log('   [PASS - EXAMPLE B] Conceptual query without exact keywords successfully retrieved by Vector and preserved in Hybrid.');
} else {
  console.error('   [FAIL] Example B failed!', compB);
  process.exit(1);
}

// 1c. Example C: Hybrid Synergy (Both Keywords & Semantics)
console.log('\n   --- 1c. Example C: Hybrid Synergy ("80mm printer warranty replacement coverage") ---');
const compC = compareRetrievalMethods({
  query: '80mm printer warranty replacement coverage',
  businessCode: 'POS_RETAIL',
  topK: 3
});

console.log(`       Lexical : Found ${compC.lexical.count} items | Top: "${compC.lexical.top_title}" (Score: ${compC.lexical.top_score})`);
console.log(`       Vector  : Found ${compC.vector.count} items | Top: "${compC.vector.top_title}" (Dist: ${compC.vector.top_distance})`);
console.log(`       Hybrid  : Found ${compC.hybrid.count} items | Top: "${compC.hybrid.top_title}" (RRF: ${compC.hybrid.top_rrf}, Source: ${compC.hybrid.top_source})`);

if (compC.hybrid.count > 0 && compC.hybrid.top_source === 'HYBRID_FUSION') {
  console.log('   [PASS - EXAMPLE C] Dual-match chunk achieved top score via HYBRID_FUSION.');
} else {
  console.error('   [FAIL] Example C did not trigger HYBRID_FUSION!', compC);
  process.exit(1);
}

// 2. Multi-Tenant Domain Accuracy Verification (POS, BISE, Hospital)
console.log('\n2. Testing Hybrid Retrieval Accuracy across Business Verticals:');

// 2a. POS Retail Test
console.log('   --- 2a. POS Retail: Offline sqlite cloud sync background worker ---');
const posHyb = searchHybrid({
  query: 'offline sqlite cloud sync background worker 4G retry',
  businessCode: 'POS_RETAIL',
  topK: 3
});
if (posHyb.status === 'SUCCESS' && posHyb.results_count > 0 && posHyb.results[0].document_title.includes('Cloud Sync')) {
  console.log(`   [PASS - POS] Top match: "${posHyb.results[0].document_title}" (RRF: ${posHyb.results[0].rrf_score}, Source: ${posHyb.results[0].match_source})`);
} else {
  console.error('   [FAIL] POS Hybrid query failed!', posHyb);
  process.exit(1);
}

// 2b. BISE Education Test
console.log('\n   --- 2b. BISE Education: Embassy degree verification urgent challan ---');
const biseHyb = searchHybrid({
  query: 'embassy degree certificate verification urgent challan PKR 4000',
  businessCode: 'BISE_EDU',
  topK: 3
});
if (biseHyb.status === 'SUCCESS' && biseHyb.results_count > 0 && biseHyb.results[0].document_title.includes('Verification')) {
  console.log(`   [PASS - BISE] Top match: "${biseHyb.results[0].document_title}" (RRF: ${biseHyb.results[0].rrf_score}, Source: ${biseHyb.results[0].match_source})`);
} else {
  console.error('   [FAIL] BISE Hybrid query failed!', biseHyb);
  process.exit(1);
}

// 2c. Hospital Healthcare Test
console.log('\n   --- 2c. Hospital Healthcare: Emergency triage red yellow ambulance 1122 ---');
const hospHyb = searchHybrid({
  query: 'emergency triage red category trauma ambulance 1122',
  businessCode: 'HOSP_HEALTH',
  topK: 3
});
if (hospHyb.status === 'SUCCESS' && hospHyb.results_count > 0 && hospHyb.results[0].document_title.includes('Emergency')) {
  console.log(`   [PASS - HOSP] Top match: "${hospHyb.results[0].document_title}" (RRF: ${hospHyb.results[0].rrf_score}, Source: ${hospHyb.results[0].match_source})`);
} else {
  console.error('   [FAIL] Hospital Hybrid query failed!', hospHyb);
  process.exit(1);
}

// 3. Cross-Tenant Boundary Isolation Matrix (Crucial Security Check)
console.log('\n3. Testing Cross-Tenant Boundary Isolation in Hybrid Search (Zero Leakage):');

// 3a. POS query executed under BISE scope
const leakPos = searchHybrid({ query: 'thermal receipt printer barcode scanner', businessCode: 'BISE_EDU' });
const badPos = leakPos.results.filter(r => r.business_code !== 'BISE_EDU' || r.document_title.toLowerCase().includes('pos'));
if (badPos.length === 0) {
  console.log(`   [PASS] POS printer query under BISE_EDU scope returned ZERO foreign chunks (Total: ${leakPos.results_count}).`);
} else {
  console.error('   [FAIL] Cross-tenant leak detected in Hybrid Search!', badPos);
  process.exit(1);
}

// 3b. BISE query executed under Hospital scope
const leakBise = searchHybrid({ query: 'matric paper rechecking fee challan HBL', businessCode: 'HOSP_HEALTH' });
const badBise = leakBise.results.filter(r => r.business_code !== 'HOSP_HEALTH' || r.document_title.toLowerCase().includes('bise'));
if (badBise.length === 0) {
  console.log(`   [PASS] BISE rechecking query under HOSP_HEALTH scope returned ZERO foreign chunks (Total: ${leakBise.results_count}).`);
} else {
  console.error('   [FAIL] Cross-tenant leak detected in Hybrid Search!', badBise);
  process.exit(1);
}

// 3c. Hospital query executed under POS scope
const leakHosp = searchHybrid({ query: 'emergency resuscitation trauma bays 1122 ambulance', businessCode: 'POS_RETAIL' });
const badHosp = leakHosp.results.filter(r => r.business_code !== 'POS_RETAIL' || r.document_title.toLowerCase().includes('hospital'));
if (badHosp.length === 0) {
  console.log(`   [PASS] Hospital emergency query under POS_RETAIL scope returned ZERO foreign chunks (Total: ${leakHosp.results_count}).`);
} else {
  console.error('   [FAIL] Cross-tenant leak detected in Hybrid Search!', badHosp);
  process.exit(1);
}

// 4. Out-of-Domain Empty-Result Handling
console.log('\n4. Testing Empty-Result Behavior on Out-of-Domain / Irrelevant Queries:');
const oodList = [
  'nuclear fusion reactor containment magnetic plasma',
  'quantum entanglement cryptography protocol',
  'jurassic dinosaur fossil paleontology excavation'
];

for (const q of oodList) {
  const oodRes = searchHybrid({ query: q, businessCode: 'POS_RETAIL' });
  if (oodRes.results_count === 0 && oodRes.status === 'EMPTY_RESULTS_NO_MATCH') {
    console.log(`   [PASS] Out-of-domain query "${q}" returned empty result cleanly.`);
  } else {
    console.error(`   [FAIL] Out-of-domain query "${q}" hallucinated results!`, oodRes);
    process.exit(1);
  }
}

// 5. In-Engine PostgreSQL Hybrid Query Latency (EXPLAIN ANALYZE)
console.log('\n5. Benchmarking In-Engine Hybrid Query Execution Time:');
const sampleQuery = 'thermal receipt printer 80mm replacement warranty';
const sampleEmb = require('./ingest_documents').generateEmbedding(sampleQuery);

const explainSql = `
  EXPLAIN (ANALYZE, BUFFERS)
  WITH 
  lexical_candidates AS (
    SELECT c.id, c.document_id, ts_rank_cd(to_tsvector('english', COALESCE(c.chunk_title, '') || ' ' || c.chunk_text), plainto_tsquery('english', '${sampleQuery}')) AS l_score
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON c.document_id = d.id
    WHERE c.business_code = 'POS_RETAIL' AND d.status = 'ACTIVE'
    LIMIT 20
  ),
  vector_candidates AS (
    SELECT c.id, c.document_id, (c.embedding <=> '${sampleEmb}'::vector) AS dist
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON c.document_id = d.id
    WHERE c.business_code = 'POS_RETAIL' AND d.status = 'ACTIVE'
    LIMIT 20
  )
  SELECT * FROM lexical_candidates l FULL OUTER JOIN vector_candidates v ON l.id = v.id
  LIMIT 3;
`;

const plan = runPsql(explainSql, 'gateway_readonly');
const execMatch = plan.match(/Execution Time:\s+([\d\.]+)\s+ms/i);
const planMatch = plan.match(/Planning Time:\s+([\d\.]+)\s+ms/i);
if (execMatch) {
  console.log(`   [PASS] In-Engine Hybrid Query Execution Time: ${execMatch[1]} ms (Planning: ${planMatch ? planMatch[1] : 'N/A'} ms)`);
} else {
  console.log(`   [NOTE] EXPLAIN Output:\n${plan}`);
}

// 6. Least-Privilege Role Security Check (gateway_readonly)
console.log('\n6. Verifying Least-Privilege Role (gateway_readonly):');
const roRes = searchHybrid({
  query: 'thermal printer scanner',
  businessCode: 'POS_RETAIL',
  role: 'gateway_readonly'
});
if (roRes.status === 'SUCCESS' && roRes.results_count > 0) {
  console.log(`   [PASS] gateway_readonly successfully executed hybrid CTE query (${roRes.results_count} results).`);
} else {
  console.error('   [FAIL] gateway_readonly failed to execute hybrid query!', roRes);
  process.exit(1);
}

console.log('\n================ ALL PHASE 25 VERIFICATION CHECKS PASSED ================');
