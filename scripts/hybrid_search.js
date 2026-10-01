/**
 * Phase 25: BM25 + pgvector Hybrid Retrieval Engine
 * 
 * Pipeline:
 * Lexical Search (BM25 / ts_rank_cd)
 *        +
 * Vector Search (pgvector / <=> Cosine Distance)
 *        +
 * Reciprocal Rank Fusion (RRF) & Re-ranking
 *        =
 * Hybrid Retrieval
 * 
 * Capabilities:
 * - Pure BM25 Lexical Retrieval
 * - Pure pgvector Semantic Retrieval
 * - Combined Hybrid Retrieval via Reciprocal Rank Fusion (RRF, k=60)
 * - Comparative benchmarking between Lexical, Vector, and Hybrid
 * - Strict multi-tenant isolation (business_code)
 * - Least-privilege database role execution (gateway_readonly)
 */

const { execSync } = require('child_process');
const { generateEmbedding } = require('./ingest_documents');

const RRF_K = 60; // Standard Reciprocal Rank Fusion smoothing constant
const DEFAULT_TOP_K = 3;
const DEFAULT_MAX_DISTANCE = 0.80;

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
 * 1. Pure Lexical Search (PostgreSQL BM25 / ts_rank_cd)
 */
function searchLexicalOnly({
  query,
  businessCode,
  topK = DEFAULT_TOP_K,
  role = 'gateway_readonly'
}) {
  const startTime = process.hrtime.bigint();

  if (!businessCode || !query || query.trim().length === 0) {
    return { query, business_code: businessCode, results_count: 0, latency_ms: 0, results: [] };
  }

  const cleanQ = query.trim();
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
      'lexical_score', ts_rank_cd(to_tsvector('english', COALESCE(c.chunk_title, '') || ' ' || c.chunk_text), plainto_tsquery('english', '${sqlEscape(cleanQ)}')),
      'match_source', 'LEXICAL_ONLY'
    )::text
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON c.document_id = d.id
    WHERE c.business_code = '${sqlEscape(businessCode)}'
      AND d.status = 'ACTIVE'
      AND (
        to_tsvector('english', COALESCE(c.chunk_title, '') || ' ' || c.chunk_text) @@ plainto_tsquery('english', '${sqlEscape(cleanQ)}')
        OR c.chunk_text ILIKE ('%' || '${sqlEscape(cleanQ)}' || '%')
        OR c.chunk_title ILIKE ('%' || '${sqlEscape(cleanQ)}' || '%')
      )
    ORDER BY ts_rank_cd(to_tsvector('english', COALESCE(c.chunk_title, '') || ' ' || c.chunk_text), plainto_tsquery('english', '${sqlEscape(cleanQ)}')) DESC
    LIMIT ${topK};
  `;

  let raw = '';
  try {
    raw = runPsql(sql, role);
  } catch (e) {
    // Return empty on parse error
  }

  const endTime = process.hrtime.bigint();
  const latencyMs = Number(endTime - startTime) / 1e6;

  const results = [];
  if (raw.trim().length > 0) {
    for (const line of raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
      try {
        results.push(JSON.parse(line));
      } catch (err) {}
    }
  }

  return {
    query: cleanQ,
    business_code: businessCode,
    retrieval_mode: 'LEXICAL_ONLY',
    results_count: results.length,
    latency_ms: parseFloat(latencyMs.toFixed(3)),
    results
  };
}

/**
 * 2. Pure Semantic Vector Search (pgvector <=> Cosine Distance)
 */
function searchVectorOnly({
  query,
  businessCode,
  topK = DEFAULT_TOP_K,
  maxDistance = DEFAULT_MAX_DISTANCE,
  role = 'gateway_readonly'
}) {
  const startTime = process.hrtime.bigint();

  if (!businessCode || !query || query.trim().length === 0) {
    return { query, business_code: businessCode, results_count: 0, latency_ms: 0, results: [] };
  }

  const cleanQ = query.trim();
  const queryEmbedding = generateEmbedding(cleanQ);

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
      'vector_distance', (c.embedding <=> '${queryEmbedding}'::vector),
      'vector_similarity', (1.0 - (c.embedding <=> '${queryEmbedding}'::vector)),
      'match_source', 'VECTOR_ONLY'
    )::text
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON c.document_id = d.id
    WHERE c.business_code = '${sqlEscape(businessCode)}'
      AND d.status = 'ACTIVE'
      AND (c.embedding <=> '${queryEmbedding}'::vector) <= ${maxDistance}
    ORDER BY (c.embedding <=> '${queryEmbedding}'::vector) ASC
    LIMIT ${topK};
  `;

  let raw = '';
  try {
    raw = runPsql(sql, role);
  } catch (e) {
    // Return empty on error
  }

  const endTime = process.hrtime.bigint();
  const latencyMs = Number(endTime - startTime) / 1e6;

  const results = [];
  if (raw.trim().length > 0) {
    for (const line of raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
      try {
        results.push(JSON.parse(line));
      } catch (err) {}
    }
  }

  return {
    query: cleanQ,
    business_code: businessCode,
    retrieval_mode: 'VECTOR_ONLY',
    results_count: results.length,
    latency_ms: parseFloat(latencyMs.toFixed(3)),
    results
  };
}

/**
 * 3. BM25 + pgvector Hybrid Retrieval with Reciprocal Rank Fusion (RRF)
 */
function searchHybrid({
  query,
  businessCode,
  topK = DEFAULT_TOP_K,
  vectorWeight = 0.5,
  lexicalWeight = 0.5,
  maxDistance = DEFAULT_MAX_DISTANCE,
  role = 'gateway_readonly'
}) {
  const startTime = process.hrtime.bigint();

  if (!businessCode || typeof businessCode !== 'string') {
    throw new Error('HYBRID_SEARCH_ERROR: businessCode is mandatory to enforce multi-tenant isolation.');
  }

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return {
      query: '',
      business_code: businessCode,
      retrieval_mode: 'HYBRID_FUSION',
      results_count: 0,
      latency_ms: 0,
      status: 'EMPTY_QUERY',
      results: []
    };
  }

  const cleanQ = query.trim();
  const queryEmbedding = generateEmbedding(cleanQ);

  const hybridSql = `
    WITH 
    -- 1. Lexical BM25 Candidate Retrieval (Top 20)
    lexical_candidates AS (
      SELECT 
        c.id AS chunk_id,
        c.document_id,
        c.business_code,
        c.chunk_title,
        c.chunk_text,
        c.token_count,
        ts_rank_cd(to_tsvector('english', COALESCE(c.chunk_title, '') || ' ' || c.chunk_text), plainto_tsquery('english', '${sqlEscape(cleanQ)}')) AS lexical_score,
        ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(to_tsvector('english', COALESCE(c.chunk_title, '') || ' ' || c.chunk_text), plainto_tsquery('english', '${sqlEscape(cleanQ)}')) DESC
        ) AS lexical_rank
      FROM knowledge_chunks c
      JOIN knowledge_documents d ON c.document_id = d.id
      WHERE c.business_code = '${sqlEscape(businessCode)}'
        AND d.status = 'ACTIVE'
        AND (
          to_tsvector('english', COALESCE(c.chunk_title, '') || ' ' || c.chunk_text) @@ plainto_tsquery('english', '${sqlEscape(cleanQ)}')
          OR c.chunk_text ILIKE ('%' || '${sqlEscape(cleanQ)}' || '%')
          OR c.chunk_title ILIKE ('%' || '${sqlEscape(cleanQ)}' || '%')
        )
      LIMIT 20
    ),

    -- 2. Semantic Vector Candidate Retrieval (Top 20)
    vector_candidates AS (
      SELECT 
        c.id AS chunk_id,
        c.document_id,
        c.business_code,
        c.chunk_title,
        c.chunk_text,
        c.token_count,
        (c.embedding <=> '${queryEmbedding}'::vector) AS vector_distance,
        (1.0 - (c.embedding <=> '${queryEmbedding}'::vector)) AS vector_similarity,
        ROW_NUMBER() OVER (
          ORDER BY (c.embedding <=> '${queryEmbedding}'::vector) ASC
        ) AS vector_rank
      FROM knowledge_chunks c
      JOIN knowledge_documents d ON c.document_id = d.id
      WHERE c.business_code = '${sqlEscape(businessCode)}'
        AND d.status = 'ACTIVE'
        AND (c.embedding <=> '${queryEmbedding}'::vector) <= ${maxDistance}
      ORDER BY (c.embedding <=> '${queryEmbedding}'::vector) ASC
      LIMIT 20
    ),

    -- 3. Reciprocal Rank Fusion (RRF) & Re-ranking
    combined AS (
      SELECT 
        COALESCE(l.chunk_id, v.chunk_id) AS chunk_id,
        COALESCE(l.document_id, v.document_id) AS document_id,
        COALESCE(l.business_code, v.business_code) AS business_code,
        COALESCE(l.chunk_title, v.chunk_title) AS chunk_title,
        COALESCE(l.chunk_text, v.chunk_text) AS chunk_text,
        COALESCE(l.token_count, v.token_count) AS token_count,
        COALESCE(l.lexical_score, 0.0) AS lexical_score,
        l.lexical_rank,
        COALESCE(v.vector_distance, 1.0) AS vector_distance,
        COALESCE(v.vector_similarity, 0.0) AS vector_similarity,
        v.vector_rank,
        (
          COALESCE(${lexicalWeight} / (${RRF_K} + l.lexical_rank), 0.0) +
          COALESCE(${vectorWeight} / (${RRF_K} + v.vector_rank), 0.0)
        ) AS rrf_score,
        CASE 
          WHEN l.chunk_id IS NOT NULL AND v.chunk_id IS NOT NULL THEN 'HYBRID_FUSION'
          WHEN l.chunk_id IS NOT NULL THEN 'LEXICAL_ONLY'
          ELSE 'VECTOR_ONLY'
        END AS match_source
      FROM lexical_candidates l
      FULL OUTER JOIN vector_candidates v ON l.chunk_id = v.chunk_id
    )

    SELECT json_build_object(
      'chunk_id', c.chunk_id,
      'document_id', c.document_id,
      'document_title', d.title,
      'document_source', d.source,
      'doc_type', d.doc_type,
      'business_code', c.business_code,
      'chunk_title', c.chunk_title,
      'chunk_text', c.chunk_text,
      'token_count', c.token_count,
      'lexical_score', c.lexical_score,
      'lexical_rank', c.lexical_rank,
      'vector_distance', c.vector_distance,
      'vector_similarity', c.vector_similarity,
      'vector_rank', c.vector_rank,
      'rrf_score', c.rrf_score,
      'match_source', c.match_source
    )::text
    FROM combined c
    JOIN knowledge_documents d ON c.document_id = d.id
    ORDER BY c.rrf_score DESC
    LIMIT ${topK};
  `;

  let raw = '';
  try {
    raw = runPsql(hybridSql, role);
  } catch (err) {
    throw new Error(`HYBRID_SEARCH_DB_ERROR: ${err.message}`);
  }

  const endTime = process.hrtime.bigint();
  const latencyMs = Number(endTime - startTime) / 1e6;

  const results = [];
  if (raw.trim().length > 0) {
    for (const line of raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
      try {
        const item = JSON.parse(line);
        results.push({
          chunk_id: item.chunk_id,
          document_id: item.document_id,
          document_title: item.document_title,
          document_source: item.document_source,
          doc_type: item.doc_type,
          business_code: item.business_code,
          chunk_title: item.chunk_title,
          chunk_text: item.chunk_text,
          token_count: item.token_count,
          lexical_score: parseFloat((item.lexical_score || 0).toFixed(4)),
          lexical_rank: item.lexical_rank || null,
          vector_distance: parseFloat((item.vector_distance || 1.0).toFixed(6)),
          vector_similarity: parseFloat((item.vector_similarity || 0.0).toFixed(6)),
          vector_rank: item.vector_rank || null,
          rrf_score: parseFloat((item.rrf_score || 0).toFixed(6)),
          match_source: item.match_source
        });
      } catch (e) {}
    }
  }

  const status = results.length > 0 ? 'SUCCESS' : 'EMPTY_RESULTS_NO_MATCH';

  return {
    query: cleanQ,
    business_code: businessCode,
    retrieval_mode: 'HYBRID_FUSION',
    top_k: topK,
    results_count: results.length,
    latency_ms: parseFloat(latencyMs.toFixed(3)),
    status,
    results
  };
}

/**
 * 4. Comparative Benchmark Function
 */
function compareRetrievalMethods({ query, businessCode, topK = DEFAULT_TOP_K }) {
  const lexical = searchLexicalOnly({ query, businessCode, topK });
  const vector = searchVectorOnly({ query, businessCode, topK });
  const hybrid = searchHybrid({ query, businessCode, topK });

  return {
    query,
    business_code: businessCode,
    lexical: {
      count: lexical.results_count,
      latency_ms: lexical.latency_ms,
      top_title: lexical.results[0]?.chunk_title || null,
      top_score: lexical.results[0]?.lexical_score || null
    },
    vector: {
      count: vector.results_count,
      latency_ms: vector.latency_ms,
      top_title: vector.results[0]?.chunk_title || null,
      top_distance: vector.results[0]?.vector_distance || null,
      top_similarity: vector.results[0]?.vector_similarity || null
    },
    hybrid: {
      count: hybrid.results_count,
      latency_ms: hybrid.latency_ms,
      top_title: hybrid.results[0]?.chunk_title || null,
      top_rrf: hybrid.results[0]?.rrf_score || null,
      top_source: hybrid.results[0]?.match_source || null
    }
  };
}

module.exports = {
  searchLexicalOnly,
  searchVectorOnly,
  searchHybrid,
  compareRetrievalMethods,
  runPsql
};

// CLI Execution Support
if (require.main === module) {
  const args = process.argv.slice(2);
  const query = args[0];
  const busIdx = args.indexOf('--business');
  const businessCode = busIdx !== -1 ? args[busIdx + 1] : 'POS_RETAIL';
  const isCompare = args.includes('--compare');

  if (!query) {
    console.log('Usage: node scripts/hybrid_search.js "<query>" --business <CODE> [--compare] [--top-k 3]');
    process.exit(1);
  }

  if (isCompare) {
    const comp = compareRetrievalMethods({ query, businessCode });
    console.log(JSON.stringify(comp, null, 2));
  } else {
    const res = searchHybrid({ query, businessCode });
    console.log(JSON.stringify(res, null, 2));
  }
}
