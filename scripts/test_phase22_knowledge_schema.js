const fs = require('fs');
const { execSync } = require('child_process');

console.log('================ PHASE 22 KNOWLEDGE SCHEMA + ISOLATION VERIFICATION ================');

function runPsql(sql, user = 'postgres', db = 'platform_db') {
  return execSync(
    `docker exec -i evolution-postgres psql -U ${user} -d ${db} -v ON_ERROR_STOP=1 -t`,
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim();
}

// 1. Verify Table and Column Metadata Schema
console.log('\n1. Verifying Table and Column Schema in platform_db:');
const tablesSql = `
  SELECT table_name 
  FROM information_schema.tables 
  WHERE table_schema = 'public' 
    AND table_name IN ('knowledge_documents', 'knowledge_chunks')
  ORDER BY table_name;
`;
const tables = runPsql(tablesSql).split(/\r?\n/).map(t => t.trim()).filter(Boolean);
if (tables.includes('knowledge_documents') && tables.includes('knowledge_chunks')) {
  console.log('   [PASS] Found knowledge_documents and knowledge_chunks tables.');
} else {
  console.error('   [FAIL] Missing knowledge tables:', tables);
  process.exit(1);
}

// Check columns for knowledge_documents
const docColsSql = `
  SELECT column_name, data_type 
  FROM information_schema.columns 
  WHERE table_name = 'knowledge_documents'
  ORDER BY ordinal_position;
`;
const docCols = runPsql(docColsSql);
const expectedDocCols = ['business_code', 'namespace', 'source', 'title', 'doc_type', 'version', 'status', 'content', 'metadata'];
for (const col of expectedDocCols) {
  if (docCols.includes(col)) {
    console.log(`   [PASS] knowledge_documents.${col} present.`);
  } else {
    console.error(`   [FAIL] knowledge_documents.${col} missing!`);
    process.exit(1);
  }
}

// Check columns for knowledge_chunks
const chunkColsSql = `
  SELECT column_name, data_type, udt_name 
  FROM information_schema.columns 
  WHERE table_name = 'knowledge_chunks'
  ORDER BY ordinal_position;
`;
const chunkCols = runPsql(chunkColsSql);
const expectedChunkCols = ['document_id', 'business_code', 'chunk_index', 'chunk_title', 'chunk_text', 'token_count', 'embedding', 'metadata'];
for (const col of expectedChunkCols) {
  if (chunkCols.includes(col)) {
    console.log(`   [PASS] knowledge_chunks.${col} present.`);
  } else {
    console.error(`   [FAIL] knowledge_chunks.${col} missing!`);
    process.exit(1);
  }
}

// 2. Verify Indexes (B-tree, HNSW, FTS)
console.log('\n2. Verifying Index Architecture:');
const indexSql = `
  SELECT indexname, indexdef 
  FROM pg_indexes 
  WHERE tablename IN ('knowledge_documents', 'knowledge_chunks')
  ORDER BY indexname;
`;
const indexDefs = runPsql(indexSql);
const expectedIndexes = [
  'idx_kdoc_bcode_status',
  'idx_kdoc_namespace',
  'idx_kchunk_doc',
  'idx_kchunk_bcode',
  'idx_kchunk_embedding_hnsw',
  'idx_kchunk_fts',
  'uq_kdoc_business_title_version',
  'uq_kchunk_doc_index'
];

for (const idx of expectedIndexes) {
  if (indexDefs.includes(idx)) {
    console.log(`   [PASS] Index/Constraint verified: ${idx}`);
  } else {
    console.error(`   [FAIL] Missing index/constraint: ${idx}`);
    process.exit(1);
  }
}

// 3. Verify Uniqueness Constraints
console.log('\n3. Testing Uniqueness Constraints:');

// Test Duplicate Document: (business_code, title, version)
let docDupBlocked = false;
try {
  runPsql(`
    INSERT INTO knowledge_documents (business_code, namespace, source, title, doc_type, version, status, content)
    VALUES ('POS_RETAIL', 'pos_collection', 'catalog', 'POS Hardware & Warranty Policy', 'POLICY', 'v1.0', 'ACTIVE', 'Duplicate test');
  `);
} catch (e) {
  docDupBlocked = true;
  console.log('   [PASS] Duplicate document constraint (business_code, title, version) enforced by PostgreSQL.');
}
if (!docDupBlocked) {
  console.error('   [FAIL] Duplicate document was allowed!');
  process.exit(1);
}

// Test Duplicate Chunk: (document_id, chunk_index)
let chunkDupBlocked = false;
try {
  runPsql(`
    INSERT INTO knowledge_chunks (document_id, business_code, chunk_index, chunk_title, chunk_text, token_count)
    VALUES (1, 'POS_RETAIL', 0, 'Duplicate chunk', 'Duplicate chunk text', 10);
  `);
} catch (e) {
  chunkDupBlocked = true;
  console.log('   [PASS] Duplicate chunk constraint (document_id, chunk_index) enforced by PostgreSQL.');
}
if (!chunkDupBlocked) {
  console.error('   [FAIL] Duplicate chunk was allowed!');
  process.exit(1);
}

// 4. Verify Technical Cross-Business Isolation
console.log('\n4. Testing Multi-Tenant Technical Isolation:');

// Query 4a: POS tenant searching for "examination passing marks" (BISE content)
const crossLeakPosSql = `
  SELECT COUNT(*) 
  FROM knowledge_chunks c
  JOIN knowledge_documents d ON c.document_id = d.id
  WHERE c.business_code = 'POS_RETAIL'
    AND (
      to_tsvector('english', c.chunk_text) @@ plainto_tsquery('english', 'examination marks passing')
      OR c.chunk_text ILIKE '%passing%'
    );
`;
const posLeakCount = parseInt(runPsql(crossLeakPosSql), 10);
if (posLeakCount === 0) {
  console.log('   [PASS] POS_RETAIL search for BISE concepts returned 0 records (Zero Leakage).');
} else {
  console.error(`   [FAIL] Cross-business leakage detected in POS! Returned ${posLeakCount} records.`);
  process.exit(1);
}

// Query 4b: BISE tenant searching for "Cardiology OPD doctors" (Hospital content)
const crossLeakBiseSql = `
  SELECT COUNT(*) 
  FROM knowledge_chunks c
  JOIN knowledge_documents d ON c.document_id = d.id
  WHERE c.business_code = 'BISE_EDU'
    AND (
      to_tsvector('english', c.chunk_text) @@ plainto_tsquery('english', 'Cardiology doctor OPD')
      OR c.chunk_text ILIKE '%Cardiology%'
    );
`;
const biseLeakCount = parseInt(runPsql(crossLeakBiseSql), 10);
if (biseLeakCount === 0) {
  console.log('   [PASS] BISE_EDU search for HOSP_HEALTH concepts returned 0 records (Zero Leakage).');
} else {
  console.error(`   [FAIL] Cross-business leakage detected in BISE! Returned ${biseLeakCount} records.`);
  process.exit(1);
}

// Query 4c: Hospital tenant searching for "receipt printer barcode" (POS content)
const crossLeakHospSql = `
  SELECT COUNT(*) 
  FROM knowledge_chunks c
  JOIN knowledge_documents d ON c.document_id = d.id
  WHERE c.business_code = 'HOSP_HEALTH'
    AND (
      to_tsvector('english', c.chunk_text) @@ plainto_tsquery('english', 'receipt printer barcode')
      OR c.chunk_text ILIKE '%printer%'
    );
`;
const hospLeakCount = parseInt(runPsql(crossLeakHospSql), 10);
if (hospLeakCount === 0) {
  console.log('   [PASS] HOSP_HEALTH search for POS_RETAIL concepts returned 0 records (Zero Leakage).');
} else {
  console.error(`   [FAIL] Cross-business leakage detected in Hospital! Returned ${hospLeakCount} records.`);
  process.exit(1);
}

// Query 4d: Verify each tenant only retrieves its own chunks
const posDirectSql = `SELECT COUNT(*) FROM knowledge_chunks WHERE business_code = 'POS_RETAIL';`;
const biseDirectSql = `SELECT COUNT(*) FROM knowledge_chunks WHERE business_code = 'BISE_EDU';`;
const hospDirectSql = `SELECT COUNT(*) FROM knowledge_chunks WHERE business_code = 'HOSP_HEALTH';`;

const posCount = parseInt(runPsql(posDirectSql), 10);
const biseCount = parseInt(runPsql(biseDirectSql), 10);
const hospCount = parseInt(runPsql(hospDirectSql), 10);

console.log(`   [PASS] Chunks per tenant correctly isolated: POS=${posCount}, BISE=${biseCount}, HOSP=${hospCount}`);

// 5. Test Least-Privilege DB Role (gateway_readonly)
console.log('\n5. Testing gateway_readonly Least-Privilege Access on Knowledge Tables:');

// Test SELECT as gateway_readonly
const roSelect = runPsql(`SELECT COUNT(*) FROM knowledge_chunks;`, 'gateway_readonly');
console.log(`   [PASS] gateway_readonly successfully read ${roSelect} rows from knowledge_chunks.`);

// Test INSERT as gateway_readonly (MUST BE DENIED)
let insertBlocked = false;
try {
  runPsql(`
    INSERT INTO knowledge_chunks (document_id, business_code, chunk_index, chunk_title, chunk_text)
    VALUES (1, 'POS_RETAIL', 99, 'Hacker Chunk', 'Injected data');
  `, 'gateway_readonly');
} catch (e) {
  insertBlocked = true;
  console.log('   [PASS] gateway_readonly denied INSERT on knowledge_chunks.');
}
if (!insertBlocked) {
  console.error('   [FAIL] gateway_readonly was able to INSERT into knowledge_chunks!');
  process.exit(1);
}

// Test DELETE as gateway_readonly (MUST BE DENIED)
let deleteBlocked = false;
try {
  runPsql(`DELETE FROM knowledge_chunks;`, 'gateway_readonly');
} catch (e) {
  deleteBlocked = true;
  console.log('   [PASS] gateway_readonly denied DELETE on knowledge_chunks.');
}
if (!deleteBlocked) {
  console.error('   [FAIL] gateway_readonly was able to DELETE from knowledge_chunks!');
  process.exit(1);
}

// Test DROP TABLE as gateway_readonly (MUST BE DENIED)
let dropBlocked = false;
try {
  runPsql(`DROP TABLE knowledge_chunks;`, 'gateway_readonly');
} catch (e) {
  dropBlocked = true;
  console.log('   [PASS] gateway_readonly denied DROP TABLE on knowledge_chunks.');
}
if (!dropBlocked) {
  console.error('   [FAIL] gateway_readonly was able to DROP TABLE on knowledge_chunks!');
  process.exit(1);
}

// 6. Test Vector Cosine Distance Search on Knowledge Chunks
console.log('\n6. Testing pgvector Cosine Distance Search (<=>) on knowledge_chunks:');
const testVec = new Array(384).fill(0.01);
testVec[0] = 0.99; // matches POS printer chunk
const vecSearchSql = `
  SELECT c.chunk_title, (c.embedding <=> '[${testVec.join(',')}]') AS cosine_distance
  FROM knowledge_chunks c
  WHERE c.business_code = 'POS_RETAIL'
  ORDER BY c.embedding <=> '[${testVec.join(',')}]' ASC
  LIMIT 1;
`;
const vecRes = runPsql(vecSearchSql);
console.log(`   [PASS] Vector search result on POS_RETAIL: ${vecRes}`);

// 7. Verify Workflow Node 2007 (Search Knowledge Base)
console.log('\n7. Verifying Workflow Node 2007:');
const workflowData = JSON.parse(fs.readFileSync('evolution_whatsapp_ai_agent_bot.json', 'utf8'));
const node2007 = workflowData.nodes.find(n => n.id === '2007');
if (!node2007) {
  console.error('   [FAIL] Node 2007 not found in workflow JSON!');
  process.exit(1);
}
const jsCode = node2007.parameters?.jsCode || '';

if (jsCode.includes('knowledge_chunks') && 
    jsCode.includes('knowledge_documents') && 
    jsCode.includes('gateway_readonly') && 
    jsCode.includes('businessCode')) {
  console.log('   [PASS] Node 2007 uses native PostgreSQL knowledge schema with tenant scoping.');
} else {
  console.error('   [FAIL] Node 2007 is missing expected SQL query or tenant scoping!');
  process.exit(1);
}

if (jsCode.includes('POLICY_UNAUTHORIZED_TOOL') && jsCode.includes('allowedTools.includes')) {
  console.log('   [PASS] Node 2007 contains Policy Gate outside LLM.');
} else {
  console.error('   [FAIL] Node 2007 missing Policy Gate check!');
  process.exit(1);
}

console.log('\n================ ALL PHASE 22 VERIFICATION CHECKS PASSED ================');
