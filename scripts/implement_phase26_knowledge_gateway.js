const fs = require('fs');

console.log('================ IMPLEMENTING PHASE 26: KNOWLEDGE GATEWAY ================');

const workflowFile = 'evolution_whatsapp_ai_agent_bot.json';
const data = JSON.parse(fs.readFileSync(workflowFile, 'utf8'));

const node2007 = data.nodes.find(n => n.id === '2007');
if (!node2007) {
  console.error('FAIL: Node 2007 not found!');
  process.exit(1);
}

node2007.parameters.description = 'Access the secure, business-aware Knowledge Gateway. Searches official company documentation, FAQs, warranties, policies, exam regulations, and clinical directories using hybrid semantic and lexical retrieval.';

node2007.parameters.jsCode = `const { Client } = require('/usr/local/lib/node_modules/n8n/node_modules/pg');
const crypto = require('crypto');

const startTime = Date.now();
const inputJson = $input.first()?.json || {};
const userQuery = inputJson.query || inputJson.userQuery || inputJson.messageText || '';

// 1. Resolve Trusted Session Context from Upstream Pipeline
const incoming = ($('PostgreSQL Persistent Conversation Store').first() || $('Message Normalizer').first() || $json)?.json || {};
const trustedBusinessCode = incoming.business_code || 'POS_RETAIL';
const businessCode = trustedBusinessCode;
const instanceName = incoming.instance_name || 'pos-instance';
const customerPhone = incoming.customerPhone || 'unknown';
const allowedTools = incoming.allowed_tools || ['search_knowledge_base', 'sync_crm'];

// Check if model attempted to pass a spoofed tenant parameter
const spoofAttempt = !!(inputJson.business_code && inputJson.business_code !== trustedBusinessCode);

// ================= POLICY & PERMISSION GATE =================
if (!allowedTools.includes('search_knowledge_base')) {
  return JSON.stringify({
    status: 'SECURITY_POLICY_DENIED',
    error_code: 'POLICY_UNAUTHORIZED_TOOL',
    tool: 'search_knowledge_base',
    tenant: trustedBusinessCode,
    action: 'READ',
    message: \`[POLICY GATE DENIAL] Tool 'search_knowledge_base' is NOT authorized for tenant '\${trustedBusinessCode}'. Execution blocked outside LLM.\`
  });
}
// ============================================================

// 2. Generate 384-dimensional query embedding
function getQueryEmbedding(text, dim = 384) {
  const vec = new Float64Array(dim);
  if (!text || text.trim().length === 0) {
    vec[0] = 1.0;
    return \`[\${Array.from(vec).join(',')}]\`;
  }
  const normalized = text.toLowerCase().replace(/[^a-z0-9\\s]/g, ' ');
  const words = normalized.split(/\\s+/).filter(w => w.length > 1);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const hash = crypto.createHash('md5').update(word).digest();
    const index = hash.readUInt16BE(0) % dim;
    const sign = (hash.readUInt8(2) % 2 === 0) ? 1.0 : -1.0;
    const weight = 1.0 / Math.sqrt(i + 1);
    vec[index] += sign * weight;

    if (word.length >= 3) {
      for (let j = 0; j <= word.length - 3; j++) {
        const tri = word.substring(j, j + 3);
        const triHash = crypto.createHash('sha256').update(tri).digest();
        const triIdx = triHash.readUInt16BE(0) % dim;
        const triSign = (triHash.readUInt8(2) % 2 === 0) ? 0.5 : -0.5;
        vec[triIdx] += triSign * 0.3;
      }
    }
  }
  let sumSq = 0;
  for (let i = 0; i < dim; i++) sumSq += vec[i] * vec[i];
  const norm = Math.sqrt(sumSq) || 1.0;
  const unit = [];
  for (let i = 0; i < dim; i++) unit.push((vec[i] / norm).toFixed(6));
  return \`[\${unit.join(',')}]\`;
}

// 3. Execute Hybrid Retrieval with Reciprocal Rank Fusion
let searchResults = [];
let latencyMs = 0;

try {
  const client = new Client({
    connectionString: 'postgresql://gateway_readonly:gateway_secure_readonly_2026@evolution-postgres:5432/platform_db'
  });
  await client.connect();

  const queryVector = getQueryEmbedding(userQuery.trim());

  const hybridQuery = \`
    WITH 
    lexical_candidates AS (
      SELECT 
        c.id AS chunk_id, c.document_id, c.chunk_title, c.chunk_text, c.token_count,
        ts_rank_cd(to_tsvector('english', COALESCE(c.chunk_title, '') || ' ' || c.chunk_text), plainto_tsquery('english', $1)) AS l_score,
        ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(to_tsvector('english', COALESCE(c.chunk_title, '') || ' ' || c.chunk_text), plainto_tsquery('english', $1)) DESC
        ) AS l_rank
      FROM knowledge_chunks c
      JOIN knowledge_documents d ON c.document_id = d.id
      WHERE c.business_code = $2 AND d.status = 'ACTIVE'
        AND (
          to_tsvector('english', COALESCE(c.chunk_title, '') || ' ' || c.chunk_text) @@ plainto_tsquery('english', $1)
          OR c.chunk_text ILIKE ('%' || $1 || '%')
          OR c.chunk_title ILIKE ('%' || $1 || '%')
        )
      LIMIT 10
    ),
    vector_candidates AS (
      SELECT 
        c.id AS chunk_id, c.document_id, c.chunk_title, c.chunk_text, c.token_count,
        (c.embedding <=> $3::vector) AS v_dist,
        (1.0 - (c.embedding <=> $3::vector)) AS v_sim,
        ROW_NUMBER() OVER (ORDER BY (c.embedding <=> $3::vector) ASC) AS v_rank
      FROM knowledge_chunks c
      JOIN knowledge_documents d ON c.document_id = d.id
      WHERE c.business_code = $2 AND d.status = 'ACTIVE'
        AND (c.embedding <=> $3::vector) <= 0.80
      ORDER BY (c.embedding <=> $3::vector) ASC
      LIMIT 10
    ),
    combined AS (
      SELECT 
        COALESCE(l.chunk_id, v.chunk_id) AS chunk_id,
        COALESCE(l.document_id, v.document_id) AS document_id,
        COALESCE(l.chunk_title, v.chunk_title) AS chunk_title,
        COALESCE(l.chunk_text, v.chunk_text) AS chunk_text,
        COALESCE(l.token_count, v.token_count) AS token_count,
        COALESCE(l.l_score, 0.0) AS lexical_score,
        COALESCE(v.v_dist, 1.0) AS vector_distance,
        (
          COALESCE(0.5 / (60 + l.l_rank), 0.0) +
          COALESCE(0.5 / (60 + v.v_rank), 0.0)
        ) AS rrf_score,
        CASE 
          WHEN l.chunk_id IS NOT NULL AND v.chunk_id IS NOT NULL THEN 'HYBRID_FUSION'
          WHEN l.chunk_id IS NOT NULL THEN 'LEXICAL_ONLY'
          ELSE 'VECTOR_ONLY'
        END AS match_source
      FROM lexical_candidates l
      FULL OUTER JOIN vector_candidates v ON l.chunk_id = v.chunk_id
    )
    SELECT d.title, c.chunk_id, c.chunk_title, c.chunk_text, d.doc_type, c.rrf_score, c.match_source
    FROM combined c
    JOIN knowledge_documents d ON c.document_id = d.id
    ORDER BY c.rrf_score DESC
    LIMIT 3;
  \`;

  const res = await client.query(hybridQuery, [userQuery.trim(), trustedBusinessCode, queryVector]);
  searchResults = res.rows;
  latencyMs = Date.now() - startTime;

  // 4. Log Access & Retrieval Metrics to platform_audit_metadata
  const auditSql = \`
    INSERT INTO platform_audit_metadata (
      business_code, instance_name, customer_phone, inbound_payload, outbound_payload, processing_time_ms
    ) VALUES ($1, $2, $3, $4, $5, $6);
  \`;

  const inPayload = JSON.stringify({ tool: 'search_knowledge_base', query: userQuery, spoof_attempt: spoofAttempt });
  const outPayload = JSON.stringify({
    results_count: searchResults.length,
    chunk_ids: searchResults.map(r => r.chunk_id),
    match_sources: searchResults.map(r => r.match_source),
    top_rrf: searchResults[0]?.rrf_score || 0
  });

  await client.query(auditSql, [trustedBusinessCode, instanceName, customerPhone, inPayload, outPayload, latencyMs]);
  await client.end();
} catch (e) {
  console.error('Knowledge Gateway Execution Error:', e.message);
}

// 5. Format Citations for AI Agent
if (searchResults.length > 0) {
  return searchResults.map((r, i) => {
    return \`[Verified Citation \${i + 1} | Doc: "\${r.title}" | Chunk ID: \${r.chunk_id} | Type: \${r.doc_type} | Match: \${r.match_source} | RRF: \${parseFloat(r.rrf_score).toFixed(4)}]:\\n\${r.chunk_text}\`;
  }).join('\\n\\n');
}

// 6. Graceful Empty-Result Fallback
return \`[Knowledge Gateway Notice]: No verified documentation found for "\${userQuery}" within business scope "\${trustedBusinessCode}". Do not speculate beyond verified records.\`;`;

fs.writeFileSync(workflowFile, JSON.stringify(data, null, 2), 'utf8');
console.log('PASS: Node 2007 upgraded to Knowledge Gateway in ' + workflowFile);
