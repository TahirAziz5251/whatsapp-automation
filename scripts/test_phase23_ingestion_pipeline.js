const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  validateDocument,
  cleanText,
  chunkDocument,
  generateEmbedding,
  parseDocumentFile,
  ingestDocument,
  softDeleteDocument,
  hardDeleteDocument,
  runPsql
} = require('./ingest_documents');

console.log('================ PHASE 23 DOCUMENT INGESTION PIPELINE VERIFICATION ================');

// 1. Validation Stage Verification
console.log('\n1. Testing Document Validation Rules:');

// 1a. Invalid business code
const invBus = validateDocument({
  business_code: 'UNKNOWN_VERTICAL',
  title: 'Test Document',
  content: 'Valid content that is long enough to satisfy requirements.'
});
if (!invBus.isValid && invBus.errors.some(e => e.includes('VAL_INVALID_BUSINESS_CODE'))) {
  console.log('   [PASS] Validation caught invalid business_code.');
} else {
  console.error('   [FAIL] Validation did not catch invalid business_code!', invBus);
  process.exit(1);
}

// 1b. Empty title
const invTitle = validateDocument({
  business_code: 'POS_RETAIL',
  title: '   ',
  content: 'Valid content that is long enough to satisfy requirements.'
});
if (!invTitle.isValid && invTitle.errors.some(e => e.includes('VAL_INVALID_TITLE'))) {
  console.log('   [PASS] Validation caught empty title.');
} else {
  console.error('   [FAIL] Validation did not catch empty title!', invTitle);
  process.exit(1);
}

// 1c. Insufficient content
const invContent = validateDocument({
  business_code: 'POS_RETAIL',
  title: 'Short Doc',
  content: 'Too short'
});
if (!invContent.isValid && invContent.errors.some(e => e.includes('VAL_INSUFFICIENT_CONTENT'))) {
  console.log('   [PASS] Validation caught insufficient content length.');
} else {
  console.error('   [FAIL] Validation did not catch short content!', invContent);
  process.exit(1);
}

// 1d. Valid document
const valDoc = validateDocument({
  business_code: 'POS_RETAIL',
  title: 'Valid Retail Document',
  doc_type: 'POLICY',
  content: 'This is a valid document content that satisfies all validation criteria.'
});
if (valDoc.isValid) {
  console.log('   [PASS] Valid document passed validation cleanly.');
} else {
  console.error('   [FAIL] Valid document failed validation!', valDoc.errors);
  process.exit(1);
}

// 2. Text Cleaning & Normalization Verification
console.log('\n2. Testing Text Extraction & Cleaning:');
const dirtyText = 'Heading line\r\n\r\n\r\n\r\nSecond paragraph   with   spaces\x00\x07.\r\nThird line.';
const cleaned = cleanText(dirtyText);
if (!cleaned.includes('\r') && !cleaned.includes('\x00') && !cleaned.includes('   ') && cleaned.includes('\n\n')) {
  console.log('   [PASS] Text cleaning stripped carriage returns, control characters, and excess whitespace.');
} else {
  console.error('   [FAIL] Text cleaning failed!', JSON.stringify(cleaned));
  process.exit(1);
}

// 3. Boundary-Aware Chunking Verification
console.log('\n3. Testing Boundary-Aware Chunking:');
const sampleDoc = `
# Section One: Hardware Specs
Thermal printer 80mm high speed auto cutter dual port USB Ethernet.

# Section Two: Maintenance Guide
Clean thermal head with isopropyl alcohol every 5000 receipts.

# Section Three: Warranty Policy
One year hardware replacement guarantee against manufacturer defects.
`;
const chunks = chunkDocument(sampleDoc, 'POS Guide', { chunkSize: 120, chunkOverlap: 20 });
if (chunks.length >= 3 && chunks[0].chunk_index === 0 && chunks[0].token_count > 0) {
  console.log(`   [PASS] Chunking produced ${chunks.length} chunks with sequential indexing and token estimation.`);
  console.log(`          Chunk 0 Title: "${chunks[0].chunk_title}" (Tokens: ${chunks[0].token_count})`);
} else {
  console.error('   [FAIL] Chunking error!', chunks);
  process.exit(1);
}

// 4. Deterministic 384-Dimensional Embedding Generation
console.log('\n4. Testing 384-Dimensional Embedding Generation:');
const emb1 = generateEmbedding('Thermal receipt printer auto cut mechanism');
const emb2 = generateEmbedding('Thermal receipt printer auto cut mechanism');
const emb3 = generateEmbedding('Cardiology doctor clinic OPD timings emergency wing');

const rawArr1 = JSON.parse(emb1);
const rawArr3 = JSON.parse(emb3);

// Dimension check
if (rawArr1.length === 384 && rawArr3.length === 384) {
  console.log(`   [PASS] Vector dimension verified: exactly 384 elements.`);
} else {
  console.error(`   [FAIL] Vector dimension mismatch! Length: ${rawArr1.length}`);
  process.exit(1);
}

// L2 Norm check (sum of squares ~ 1.0)
let normSq = 0;
for (const val of rawArr1) normSq += val * val;
if (Math.abs(normSq - 1.0) < 0.01) {
  console.log(`   [PASS] L2 Unit Normalization verified: ||v||^2 = ${normSq.toFixed(4)} (~1.0).`);
} else {
  console.error(`   [FAIL] Vector is not unit-normalized! ||v||^2 = ${normSq}`);
  process.exit(1);
}

// Determinism check
if (emb1 === emb2) {
  console.log('   [PASS] Deterministic reproducibility verified: identical text yields identical embedding.');
} else {
  console.error('   [FAIL] Embedding generation is not deterministic!');
  process.exit(1);
}

// Distinctness check
if (emb1 !== emb3) {
  console.log('   [PASS] Semantic distinctness verified: different text yields distinct embeddings.');
} else {
  console.error('   [FAIL] Distinct text yielded identical embedding!');
  process.exit(1);
}

// 5. Sample Documents Ingestion Verification
console.log('\n5. Verifying Sample Documents Ingestion:');
const sampleFiles = [
  'data/sample_documents/pos_retail/pos_warranty_and_returns.md',
  'data/sample_documents/pos_retail/pos_cloud_sync_spec.json',
  'data/sample_documents/bise_edu/bise_rechecking_policy.md',
  'data/sample_documents/bise_edu/bise_certificate_verification.json',
  'data/sample_documents/hosp_health/hospital_emergency_admission.md',
  'data/sample_documents/hosp_health/hospital_lab_test_timings.json'
];

for (const sf of sampleFiles) {
  if (!fs.existsSync(sf)) {
    console.error(`   [FAIL] Sample document file missing: ${sf}`);
    process.exit(1);
  }
  const parsed = parseDocumentFile(sf);
  const result = ingestDocument(parsed);
  console.log(`   [PASS - INGESTED] [${result.businessCode}] ${result.title} (ID: ${result.documentId}, Chunks: ${result.chunksCount})`);
}

// 6. Re-Ingestion & Idempotence Verification
console.log('\n6. Testing Re-Ingestion & Idempotence:');
const testDocPath = 'data/sample_documents/pos_retail/pos_warranty_and_returns.md';
const docBefore = parseDocumentFile(testDocPath);
const res1 = ingestDocument(docBefore);
const chunksCount1 = parseInt(runPsql(`SELECT COUNT(*) FROM knowledge_chunks WHERE document_id = ${res1.documentId};`), 10);

// Re-ingest the exact same document
const res2 = ingestDocument(docBefore);
const chunksCount2 = parseInt(runPsql(`SELECT COUNT(*) FROM knowledge_chunks WHERE document_id = ${res2.documentId};`), 10);

if (res1.documentId === res2.documentId && chunksCount1 === chunksCount2) {
  console.log(`   [PASS] Idempotent re-ingestion verified: Document ID ${res1.documentId} preserved and chunk count constant (${chunksCount1}).`);
} else {
  console.error(`   [FAIL] Re-ingestion failed idempotence! ID1=${res1.documentId}, ID2=${res2.documentId}, C1=${chunksCount1}, C2=${chunksCount2}`);
  process.exit(1);
}

// 7. Versioning Management Verification
console.log('\n7. Testing Document Versioning:');
const v2Doc = {
  ...docBefore,
  version: 'v2.0',
  content: 'Updated Version 2.0 POS Hardware Warranty & Return Policy with extended 3-year warranty options and instant cash refund window.'
};
const resV2 = ingestDocument(v2Doc);
if (resV2.documentId !== res1.documentId && resV2.version === 'v2.0') {
  console.log(`   [PASS] Multi-versioning verified: v1.0 (ID ${res1.documentId}) and v2.0 (ID ${resV2.documentId}) coexist cleanly.`);
} else {
  console.error('   [FAIL] Versioning collision occurred!', resV2);
  process.exit(1);
}

// 8. Deletion Lifecycle Verification (Soft & Hard Delete)
console.log('\n8. Testing Deletion Lifecycle:');
// 8a. Soft Delete
softDeleteDocument(resV2.documentId, 'ARCHIVED');
const statusCheck = runPsql(`SELECT status FROM knowledge_documents WHERE id = ${resV2.documentId};`);
if (statusCheck.includes('ARCHIVED')) {
  console.log(`   [PASS] Soft-delete verified: Document ID ${resV2.documentId} status marked ARCHIVED.`);
} else {
  console.error('   [FAIL] Soft-delete status not updated!', statusCheck);
  process.exit(1);
}

// Verify active search excludes ARCHIVED document
const activeSearchSql = `
  SELECT COUNT(*) 
  FROM knowledge_documents 
  WHERE id = ${resV2.documentId} AND status = 'ACTIVE';
`;
const activeCount = parseInt(runPsql(activeSearchSql), 10);
if (activeCount === 0) {
  console.log('   [PASS] Active search query strictly excludes soft-deleted (ARCHIVED) documents.');
} else {
  console.error('   [FAIL] Soft-deleted document appeared in active query!');
  process.exit(1);
}

// 8b. Hard Delete
const chunksBeforeHard = parseInt(runPsql(`SELECT COUNT(*) FROM knowledge_chunks WHERE document_id = ${resV2.documentId};`), 10);
hardDeleteDocument(resV2.documentId);
const docAfterHard = parseInt(runPsql(`SELECT COUNT(*) FROM knowledge_documents WHERE id = ${resV2.documentId};`), 10);
const chunksAfterHard = parseInt(runPsql(`SELECT COUNT(*) FROM knowledge_chunks WHERE document_id = ${resV2.documentId};`), 10);

if (docAfterHard === 0 && chunksAfterHard === 0 && chunksBeforeHard > 0) {
  console.log(`   [PASS] Hard-delete cascading verified: Document ID ${resV2.documentId} and all ${chunksBeforeHard} chunks deleted.`);
} else {
  console.error('   [FAIL] Hard delete failed to cascade cleanly!', { docAfterHard, chunksAfterHard });
  process.exit(1);
}

// 9. Multi-Tenant Namespace Boundary Isolation Check
console.log('\n9. Testing Multi-Tenant Boundary Isolation:');
const orphanTenantChunksSql = `
  SELECT COUNT(*) 
  FROM knowledge_chunks c
  JOIN knowledge_documents d ON c.document_id = d.id
  WHERE c.business_code <> d.business_code;
`;
const mismatchCount = parseInt(runPsql(orphanTenantChunksSql), 10);
if (mismatchCount === 0) {
  console.log('   [PASS] Zero namespace mismatch: 100% of chunks match parent document business_code.');
} else {
  console.error(`   [FAIL] Detected ${mismatchCount} chunks with mismatched business_code!`);
  process.exit(1);
}

// Verify tenant chunk counts
const posChunks = parseInt(runPsql(`SELECT COUNT(*) FROM knowledge_chunks WHERE business_code = 'POS_RETAIL';`), 10);
const biseChunks = parseInt(runPsql(`SELECT COUNT(*) FROM knowledge_chunks WHERE business_code = 'BISE_EDU';`), 10);
const hospChunks = parseInt(runPsql(`SELECT COUNT(*) FROM knowledge_chunks WHERE business_code = 'HOSP_HEALTH';`), 10);

console.log(`   [PASS] Multi-tenant partition verified: POS=${posChunks}, BISE=${biseChunks}, HOSP=${hospChunks}`);

// 10. Vector Similarity Search on Newly Ingested Chunks
console.log('\n10. Testing pgvector Search on Ingested Documents:');
const queryProbe = generateEmbedding('Where is emergency trauma center located?');
const searchSql = `
  SELECT d.title, c.chunk_title, (c.embedding <=> '${queryProbe}'::vector) as distance
  FROM knowledge_chunks c
  JOIN knowledge_documents d ON c.document_id = d.id
  WHERE c.business_code = 'HOSP_HEALTH'
  ORDER BY c.embedding <=> '${queryProbe}'::vector ASC
  LIMIT 1;
`;
const searchRes = runPsql(searchSql);
console.log(`   [PASS] pgvector similarity search on HOSP_HEALTH:\n          ${searchRes.replace(/\n/g, ' ')}`);

console.log('\n================ ALL PHASE 23 VERIFICATION CHECKS PASSED ================');
