/**
 * Phase 24: Semantic Retrieval via pgvector
 * 
 * Objectives:
 * - Validate pure pgvector semantic search (<=> cosine distance) before agent integration
 * - Enforce strict business-scoped isolation (business_code)
 * - Measure latency, relevance scoring (distance / similarity), and empty-result behavior
 * - Least-privilege query execution via gateway_readonly
 */

const { execSync } = require('child_process');
const { generateEmbedding } = require('./ingest_documents');

const DEFAULT_TOP_K = 3;
const DEFAULT_MAX_DISTANCE = 0.80; // Cosine distance cutoff (distance <= 0.80 <=> similarity >= 0.20)

/**
 * Execute psql command safely via stdin
 */
function runPsql(sql, role = 'gateway_readonly', db = 'platform_db') {
  return execSync(
    `docker exec -i evolution-postgres psql -U ${role} -d ${db} -v ON_ERROR_STOP=1 -t`,
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim();
}

/**
 * Escape single quotes for SQL literals
 */
function sqlEscape(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/'/g, "''");
}

/**
 * Retrieve Business-Specific Knowledge Configuration
 */
function getBusinessKnowledgeConfig(businessCode) {
  const sql = `
    SELECT similarity_threshold, top_k 
    FROM platform_knowledge_mappings 
    WHERE business_code = '${sqlEscape(businessCode)}'
    LIMIT 1;
  `;
  try {
    const raw = runPsql(sql, 'gateway_readonly');
    if (raw) {
      const parts = raw.split('|').map(p => p.trim());
      return {
        similarity_threshold: parseFloat(parts[0]) || 0.80,
        top_k: parseInt(parts[1], 10) || DEFAULT_TOP_K
      };
    }
  } catch (e) {
    // Fallback to defaults
  }
  return {
    similarity_threshold: 0.80,
    top_k: DEFAULT_TOP_K
  };
}

/**
 * Perform Business-Scoped Semantic Retrieval via pgvector
 * 
 * @param {Object} params
 * @param {string} params.query - Customer user query
 * @param {string} params.businessCode - Tenant business code (e.g. POS_RETAIL, BISE_EDU, HOSP_HEALTH)
 * @param {number} [params.topK] - Max results to return
 * @param {number} [params.maxDistance] - Maximum cosine distance cutoff
 * @param {string} [params.role] - PostgreSQL DB role (default: gateway_readonly)
 * @returns {Object} Structured search result with latency and relevance metrics
 */
function searchSemantic({
  query,
  businessCode,
  topK,
  maxDistance,
  role = 'gateway_readonly'
}) {
  const startTime = process.hrtime.bigint();

  if (!businessCode || typeof businessCode !== 'string') {
    throw new Error('SEMANTIC_SEARCH_ERROR: businessCode is mandatory to prevent cross-business leakage.');
  }

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return {
      query: '',
      business_code: businessCode,
      results_count: 0,
      latency_ms: 0,
      status: 'EMPTY_QUERY',
      results: []
    };
  }

  // Retrieve business configuration
  const config = getBusinessKnowledgeConfig(businessCode);
  const effectiveTopK = topK || config.top_k || DEFAULT_TOP_K;
  const effectiveMaxDistance = maxDistance !== undefined ? maxDistance : DEFAULT_MAX_DISTANCE;

  // Generate 384-dimensional query embedding
  const queryEmbedding = generateEmbedding(query.trim());

  // Execute pgvector Cosine Distance Query with strict business scope and ACTIVE document filter
  const sql = `
    SELECT json_build_object(
      'chunk_id', c.id,
      'document_id', d.id,
      'business_code', c.business_code,
      'document_title', d.title,
      'document_source', d.source,
      'doc_type', d.doc_type,
      'chunk_title', c.chunk_title,
      'chunk_text', c.chunk_text,
      'token_count', c.token_count,
      'distance', (c.embedding <=> '${queryEmbedding}'::vector),
      'similarity', (1.0 - (c.embedding <=> '${queryEmbedding}'::vector))
    )::text
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON c.document_id = d.id
    WHERE c.business_code = '${sqlEscape(businessCode)}'
      AND d.status = 'ACTIVE'
      AND (c.embedding <=> '${queryEmbedding}'::vector) <= ${effectiveMaxDistance}
    ORDER BY (c.embedding <=> '${queryEmbedding}'::vector) ASC
    LIMIT ${effectiveTopK};
  `;

  let rawRows = '';
  try {
    rawRows = runPsql(sql, role);
  } catch (err) {
    throw new Error(`SEMANTIC_SEARCH_DB_ERROR: ${err.message}`);
  }

  const endTime = process.hrtime.bigint();
  const latencyMs = Number(endTime - startTime) / 1e6;

  const results = [];
  if (rawRows.trim().length > 0) {
    const lines = rawRows.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        results.push({
          chunk_id: item.chunk_id,
          document_id: item.document_id,
          document_title: item.document_title,
          document_source: item.document_source,
          doc_type: item.doc_type,
          chunk_title: item.chunk_title,
          chunk_text: item.chunk_text,
          token_count: item.token_count,
          distance: parseFloat(item.distance.toFixed(6)),
          similarity: parseFloat(item.similarity.toFixed(6))
        });
      } catch (e) {
        // Skip malformed rows
      }
    }
  }

  const status = results.length > 0 ? 'SUCCESS' : 'EMPTY_RESULTS_NO_MATCH';

  return {
    query: query.trim(),
    business_code: businessCode,
    top_k: effectiveTopK,
    max_distance: effectiveMaxDistance,
    results_count: results.length,
    latency_ms: parseFloat(latencyMs.toFixed(3)),
    status,
    results
  };
}

module.exports = {
  searchSemantic,
  getBusinessKnowledgeConfig,
  runPsql
};

// CLI Execution Support
if (require.main === module) {
  const args = process.argv.slice(2);
  const query = args[0];
  const busIdx = args.indexOf('--business');
  const businessCode = busIdx !== -1 ? args[busIdx + 1] : 'POS_RETAIL';

  if (!query) {
    console.log('Usage: node scripts/semantic_search.js "<query>" --business <POS_RETAIL|BISE_EDU|HOSP_HEALTH> [--top-k 3] [--max-distance 0.85]');
    process.exit(1);
  }

  const res = searchSemantic({ query, businessCode });
  console.log(JSON.stringify(res, null, 2));
}
