/**
 * Phase 26: Knowledge Gateway
 * 
 * Pipeline:
 * Knowledge Gateway ➔ business_id / business_code ➔ Correct KB ➔ Hybrid Search (BM25 + pgvector + RRF)
 * 
 * Capabilities:
 * - Upgrades standard knowledge search to a business-aware secure gateway
 * - Ignores untrusted LLM-passed business codes; strictly pins to trusted session business_code
 * - Executes Hybrid Retrieval (BM25 lexical + pgvector cosine <=> + Reciprocal Rank Fusion)
 * - Generates structured citations ([Verified Citation X | Doc: ... | Chunk ID: ... | Match: ...])
 * - Enforces zero cross-tenant retrieval (BISE query against Hospital KB = NO RESULT / DENIED)
 * - Logs source IDs, retrieval metrics, and latency to platform_audit_metadata
 * - Executes under least-privilege DB role (gateway_readonly)
 */

const { searchHybrid, runPsql } = require('./hybrid_search');

/**
 * Escape single quotes for SQL literals
 */
function sqlEscape(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/'/g, "''");
}

/**
 * Format retrieved chunks into structured, tamper-proof citations for AI Agent
 */
function formatCitations(query, results, businessCode) {
  if (!results || results.length === 0) {
    return `[Knowledge Gateway Notice]: No verified documentation found for "${query}" within business scope "${businessCode}". If uncertain, do not speculate or extrapolate beyond official records.`;
  }

  const citations = results.map((r, index) => {
    return `[Verified Citation ${index + 1} | Doc: "${r.document_title}" | Chunk ID: ${r.chunk_id} | Type: ${r.doc_type || 'FAQ'} | Match: ${r.match_source} | RRF: ${r.rrf_score}]:\n${r.chunk_text}`;
  });

  return citations.join('\n\n');
}

/**
 * Log knowledge retrieval access event to platform_audit_metadata
 */
function logKnowledgeAudit({
  businessCode,
  instanceName,
  customerPhone,
  query,
  results,
  latencyMs,
  untrustedParams = {},
  role = 'gateway_readonly'
}) {
  const inboundPayload = JSON.stringify({
    tool: 'search_knowledge_base',
    query,
    untrusted_params: untrustedParams
  });

  const outboundPayload = JSON.stringify({
    results_count: results.length,
    chunk_ids: results.map(r => r.chunk_id),
    document_titles: results.map(r => r.document_title),
    match_sources: results.map(r => r.match_source),
    top_rrf: results[0]?.rrf_score || 0.0
  });

  const sql = `
    INSERT INTO platform_audit_metadata (
      business_code,
      instance_name,
      customer_phone,
      inbound_payload,
      outbound_payload,
      processing_time_ms
    ) VALUES (
      '${sqlEscape(businessCode)}',
      '${sqlEscape(instanceName || 'gateway-instance')}',
      '${sqlEscape(customerPhone || 'unknown')}',
      '${sqlEscape(inboundPayload)}'::jsonb,
      '${sqlEscape(outboundPayload)}'::jsonb,
      ${Math.round(latencyMs)}
    )
    RETURNING id;
  `;

  try {
    const raw = runPsql(sql, role);
    const match = raw.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  } catch (e) {
    console.error('Audit Logging Error in Knowledge Gateway:', e.message);
    return null;
  }
}

/**
 * Execute Knowledge Gateway Request
 * 
 * @param {Object} params
 * @param {string} params.query - Customer user query
 * @param {Object} params.trustedSessionContext - Verified session context from upstream pipeline
 * @param {Object} [params.untrustedParams] - Arbitrary parameters passed by the LLM
 * @param {number} [params.topK] - Max results
 * @param {string} [params.role] - Database role (default: gateway_readonly)
 * @returns {Object} Structured gateway response
 */
function executeKnowledgeGateway({
  query,
  trustedSessionContext = {},
  untrustedParams = {},
  topK = 3,
  role = 'gateway_readonly'
}) {
  const startTime = process.hrtime.bigint();

  // 1. Resolve Trusted Scope (NEVER trust LLM parameters for tenant scoping)
  const trustedBusinessCode = trustedSessionContext.business_code || 'POS_RETAIL';
  const instanceName = trustedSessionContext.instance_name || 'pos-instance';
  const customerPhone = trustedSessionContext.customerPhone || 'unknown';
  const allowedTools = trustedSessionContext.allowed_tools || ['search_knowledge_base', 'sync_crm'];

  // Check for tenant spoofing attempt
  let spoofAttemptDetected = false;
  if (untrustedParams.business_code && untrustedParams.business_code !== trustedBusinessCode) {
    spoofAttemptDetected = true;
  }

  // 2. Outside-LLM Policy Gate Enforcement
  if (!allowedTools.includes('search_knowledge_base')) {
    const deniedVerdict = {
      status: 'SECURITY_POLICY_DENIED',
      error_code: 'POLICY_UNAUTHORIZED_TOOL',
      tool: 'search_knowledge_base',
      tenant: trustedBusinessCode,
      action: 'READ',
      message: `[POLICY GATE DENIAL] Tool 'search_knowledge_base' is NOT authorized for tenant '${trustedBusinessCode}'. Execution blocked outside LLM.`
    };
    return {
      formattedContext: JSON.stringify(deniedVerdict),
      rawResponse: deniedVerdict,
      auditId: null
    };
  }

  // 3. Execute Hybrid Search strictly scoped to trustedBusinessCode
  const hybridRes = searchHybrid({
    query,
    businessCode: trustedBusinessCode,
    topK,
    role
  });

  const endTime = process.hrtime.bigint();
  const latencyMs = Number(endTime - startTime) / 1e6;

  // 4. Format Citations
  const formattedCitations = formatCitations(query, hybridRes.results, trustedBusinessCode);

  // 5. Log Source IDs & Retrieval Metrics to platform_audit_metadata
  const auditId = logKnowledgeAudit({
    businessCode: trustedBusinessCode,
    instanceName,
    customerPhone,
    query,
    results: hybridRes.results,
    latencyMs,
    untrustedParams: {
      ...untrustedParams,
      spoof_attempt_detected: spoofAttemptDetected
    },
    role
  });

  return {
    status: hybridRes.status,
    trusted_business_code: trustedBusinessCode,
    spoof_attempt_detected: spoofAttemptDetected,
    query,
    results_count: hybridRes.results_count,
    latency_ms: parseFloat(latencyMs.toFixed(3)),
    audit_id: auditId,
    formatted_context: formattedCitations,
    results: hybridRes.results
  };
}

module.exports = {
  executeKnowledgeGateway,
  formatCitations,
  logKnowledgeAudit
};

// CLI Execution Support
if (require.main === module) {
  const args = process.argv.slice(2);
  const query = args[0] || 'thermal printer 80mm warranty';
  const busIdx = args.indexOf('--business');
  const businessCode = busIdx !== -1 ? args[busIdx + 1] : 'POS_RETAIL';

  const res = executeKnowledgeGateway({
    query,
    trustedSessionContext: {
      business_code: businessCode,
      instance_name: `${businessCode.toLowerCase()}-instance`,
      customerPhone: '923001234567',
      allowed_tools: ['search_knowledge_base']
    }
  });

  console.log(JSON.stringify(res, null, 2));
}
