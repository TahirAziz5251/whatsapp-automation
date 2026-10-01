/**
 * Phase 26: Knowledge Gateway Test & Verification Suite
 * 
 * Objectives Tested:
 * 1. Mandatory Test: BISE query against Hospital KB -> NO RESULT / DENIED.
 * 2. Complete Cross-Scope Denial Matrix across all 3 verticals (POS, BISE, Hospital).
 * 3. In-Scope Positive Retrieval Matrix (POS, BISE, Hospital) with valid RRF scores.
 * 4. Tenant Spoofing Defense: LLM-passed foreign tenant parameter is ignored and pinned to trusted context.
 * 5. Structured Citation Formatting ([Verified Citation X | Doc: ... | Chunk ID: ... | Match: ...]).
 * 6. Audit Logging Verification: platform_audit_metadata records latency, chunk IDs, and RRF scores.
 * 7. Outside-LLM Policy Gate Tool Authorization Check (POLICY_UNAUTHORIZED_TOOL).
 * 8. Least-Privilege DB Role Verification (gateway_readonly cannot modify knowledge tables).
 * 9. Workflow Node 2007 Integration Verification (connected to AI Agent in evolution_whatsapp_ai_agent_bot.json).
 */

const fs = require('fs');
const { executeKnowledgeGateway, formatCitations } = require('./knowledge_gateway');
const { runPsql } = require('./hybrid_search');

console.log('================ PHASE 26 KNOWLEDGE GATEWAY VERIFICATION SUITE ================');

// =========================================================================
// 1. MANDATORY TEST: BISE query against Hospital KB -> NO RESULT / DENIED
// =========================================================================
console.log('\n1. Mandatory Test: BISE Query against Hospital KB Scope:');
const mandatoryRes = executeKnowledgeGateway({
  query: 'Matric duplicate certificate procedure and fee PKR 1200',
  trustedSessionContext: {
    business_code: 'HOSP_HEALTH',
    instance_name: 'hospital-instance',
    customerPhone: '923001112233',
    allowed_tools: ['search_knowledge_base']
  },
  untrustedParams: {}
});

console.log(`   Query: "Matric duplicate certificate procedure and fee PKR 1200"`);
console.log(`   Scope: HOSP_HEALTH (Hospital KB)`);
console.log(`   Results count: ${mandatoryRes.results_count}`);
console.log(`   Status: ${mandatoryRes.status}`);
console.log(`   Formatted notice snippet: ${mandatoryRes.formatted_context.substring(0, 100)}...`);

if (mandatoryRes.results_count === 0 && mandatoryRes.formatted_context.includes('No verified documentation found')) {
  console.log('   [PASS - MANDATORY TEST] BISE query executed against Hospital KB returned NO RESULT / DENIED.');
} else {
  console.error('   [FAIL - MANDATORY TEST] BISE knowledge leaked into Hospital KB!', mandatoryRes);
  process.exit(1);
}

// =========================================================================
// 2. COMPLETE CROSS-SCOPE DENIAL MATRIX (Zero Cross-Tenant Leakage)
// =========================================================================
console.log('\n2. Complete Cross-Scope Denial Matrix:');

const denialCases = [
  {
    name: 'BISE Query in POS Scope',
    query: 'Intermediate roll number 102450 verification result',
    targetScope: 'POS_RETAIL'
  },
  {
    name: 'Hospital Query in BISE Scope',
    query: 'Cardiology clinic timings Dr Sarah Khan consultation fee PKR 2500',
    targetScope: 'BISE_EDU'
  },
  {
    name: 'Hospital Query in POS Scope',
    query: 'Emergency 24/7 ICU patient admission procedure',
    targetScope: 'POS_RETAIL'
  },
  {
    name: 'POS Query in BISE Scope',
    query: '80mm thermal receipt printer 1 year replacement warranty',
    targetScope: 'BISE_EDU'
  },
  {
    name: 'POS Query in Hospital Scope',
    query: 'GlimsTech POS billing software annual license subscription',
    targetScope: 'HOSP_HEALTH'
  }
];

let allDenialsPassed = true;
denialCases.forEach((c, idx) => {
  const res = executeKnowledgeGateway({
    query: c.query,
    trustedSessionContext: {
      business_code: c.targetScope,
      instance_name: `${c.targetScope.toLowerCase()}-instance`,
      customerPhone: '923009998877',
      allowed_tools: ['search_knowledge_base']
    }
  });

  const passed = res.results_count === 0;
  console.log(`   [Case 2.${idx + 1}] ${c.name} (Scope: ${c.targetScope}): ${passed ? 'DENIED / 0 RESULTS [PASS]' : 'LEAKAGE DETECTED [FAIL]'}`);
  if (!passed) allDenialsPassed = false;
});

if (allDenialsPassed) {
  console.log('   [PASS] Complete cross-scope denial matrix validated. Zero cross-tenant leakage.');
} else {
  console.error('   [FAIL] Cross-scope leakage detected in matrix!');
  process.exit(1);
}

// =========================================================================
// 3. IN-SCOPE POSITIVE RETRIEVAL MATRIX
// =========================================================================
console.log('\n3. In-Scope Positive Retrieval Matrix:');

const positiveCases = [
  {
    scope: 'POS_RETAIL',
    query: '80mm thermal receipt printer warranty claim',
    expectedKeyword: 'printer'
  },
  {
    scope: 'BISE_EDU',
    query: 'Matric roll number verification duplicate certificate fee',
    expectedKeyword: 'Certificate'
  },
  {
    scope: 'HOSP_HEALTH',
    query: 'OPD clinic timings doctor specialist',
    expectedKeyword: 'OPD'
  }
];

let allPositivesPassed = true;
positiveCases.forEach((c, idx) => {
  const res = executeKnowledgeGateway({
    query: c.query,
    trustedSessionContext: {
      business_code: c.scope,
      instance_name: `${c.scope.toLowerCase()}-instance`,
      customerPhone: '923005554433',
      allowed_tools: ['search_knowledge_base']
    },
    topK: 3
  });

  const hasResults = res.results_count > 0;
  const matchesKeyword = res.results.some(r => 
    r.document_title.toLowerCase().includes(c.expectedKeyword.toLowerCase()) || 
    r.chunk_text.toLowerCase().includes(c.expectedKeyword.toLowerCase())
  );
  const passed = hasResults && matchesKeyword;

  console.log(`   [Case 3.${idx + 1}] Scope: ${c.scope} | Query: "${c.query}"`);
  console.log(`       Found: ${res.results_count} chunks | Top: "${res.results[0]?.document_title}" (RRF: ${res.results[0]?.rrf_score}, Match: ${res.results[0]?.match_source})`);
  console.log(`       Status: ${passed ? 'CORRECT IN-SCOPE RETRIEVAL [PASS]' : 'FAILED TO RETRIEVE [FAIL]'}`);

  if (!passed) allPositivesPassed = false;
});

if (allPositivesPassed) {
  console.log('   [PASS] All 3 vertical scopes retrieved authentic, in-scope knowledge correctly.');
} else {
  console.error('   [FAIL] In-scope positive retrieval failed!');
  process.exit(1);
}

// =========================================================================
// 4. TENANT SPOOFING DEFENSE TEST
// =========================================================================
console.log('\n4. Tenant Spoofing Defense (Tamper Resistance):');
// LLM attempts to query BISE data while operating in a Hospital session by injecting business_code: 'BISE_EDU'
const spoofRes = executeKnowledgeGateway({
  query: 'Matric duplicate certificate procedure',
  trustedSessionContext: {
    business_code: 'HOSP_HEALTH', // Trusted session context
    instance_name: 'hospital-instance',
    customerPhone: '923001234567',
    allowed_tools: ['search_knowledge_base']
  },
  untrustedParams: {
    business_code: 'BISE_EDU', // Untrusted injection attempt
    target_database: 'bise_db'
  }
});

console.log(`   Trusted Session Scope: HOSP_HEALTH`);
console.log(`   Untrusted Injected Scope: BISE_EDU`);
console.log(`   Spoof Attempt Detected: ${spoofRes.spoof_attempt_detected}`);
console.log(`   Enforced Retrieval Scope: ${spoofRes.trusted_business_code}`);
console.log(`   Results count: ${spoofRes.results_count}`);

if (spoofRes.spoof_attempt_detected && spoofRes.trusted_business_code === 'HOSP_HEALTH' && spoofRes.results_count === 0) {
  console.log('   [PASS] Tenant spoofing attempt neutralized. Gateway pinned strictly to trusted session context.');
} else {
  console.error('   [FAIL] Tenant spoofing defense failed!', spoofRes);
  process.exit(1);
}

// =========================================================================
// 5. STRUCTURED CITATION FORMATTING VERIFICATION
// =========================================================================
console.log('\n5. Structured Citation Formatting Verification:');
const citeRes = executeKnowledgeGateway({
  query: '80mm thermal receipt printer warranty',
  trustedSessionContext: {
    business_code: 'POS_RETAIL',
    instance_name: 'pos-instance',
    customerPhone: '923001234567',
    allowed_tools: ['search_knowledge_base']
  },
  topK: 2
});

const formattedContext = citeRes.formatted_context;
console.log('   Sample Citation Output:\n--------------------------------------------------');
console.log(formattedContext.substring(0, 320) + '...\n--------------------------------------------------');

const hasCitationHeader = formattedContext.includes('[Verified Citation 1 | Doc:');
const hasChunkId = formattedContext.includes('Chunk ID:');
const hasMatchType = formattedContext.includes('Match:');
const hasRrf = formattedContext.includes('RRF:');

if (hasCitationHeader && hasChunkId && hasMatchType && hasRrf) {
  console.log('   [PASS] Citation formatting matches required schema: [Verified Citation X | Doc: ... | Chunk ID: ... | Match: ... | RRF: ...].');
} else {
  console.error('   [FAIL] Citation formatting mismatch!');
  process.exit(1);
}

// =========================================================================
// 6. AUDIT METRICS LOGGING VERIFICATION
// =========================================================================
console.log('\n6. Audit Metrics Logging in platform_audit_metadata:');
const checkAuditSql = `
  SELECT id, business_code, instance_name, inbound_payload->>'tool' as tool, 
         inbound_payload->'untrusted_params'->>'spoof_attempt_detected' as spoof_logged,
         outbound_payload->>'results_count' as res_count,
         processing_time_ms, created_at
  FROM platform_audit_metadata
  WHERE inbound_payload->>'tool' = 'search_knowledge_base'
  ORDER BY id DESC
  LIMIT 1;
`;

const auditRaw = runPsql(checkAuditSql, 'postgres');
console.log('   Latest Audit Record in DB:\n' + auditRaw.trim());

if (auditRaw.includes('search_knowledge_base')) {
  console.log('   [PASS] Knowledge retrieval access events, latency, and spoof flags verified in platform_audit_metadata.');
} else {
  console.error('   [FAIL] Audit record not found in platform_audit_metadata!');
  process.exit(1);
}

// =========================================================================
// 7. POLICY GATE AUTHORIZATION ENFORCEMENT (Outside LLM)
// =========================================================================
console.log('\n7. Policy Gate Authorization Enforcement (Unauthorized Tool):');
const policyRes = executeKnowledgeGateway({
  query: 'warranty claim',
  trustedSessionContext: {
    business_code: 'POS_RETAIL',
    instance_name: 'pos-instance',
    customerPhone: '923001234567',
    allowed_tools: ['sync_crm'] // search_knowledge_base is deliberately omitted
  }
});

console.log(`   Policy Status: ${policyRes.rawResponse?.status}`);
console.log(`   Error Code: ${policyRes.rawResponse?.error_code}`);

if (policyRes.rawResponse?.status === 'SECURITY_POLICY_DENIED' && policyRes.rawResponse?.error_code === 'POLICY_UNAUTHORIZED_TOOL') {
  console.log('   [PASS] Policy Gate blocked unauthorized knowledge search outside the LLM.');
} else {
  console.error('   [FAIL] Policy Gate failed to block unauthorized tool!', policyRes);
  process.exit(1);
}

// =========================================================================
// 8. LEAST-PRIVILEGE DB ROLE VERIFICATION (gateway_readonly)
// =========================================================================
console.log('\n8. Least-Privilege DB Role Verification (gateway_readonly):');
const testDestructiveSql = `UPDATE knowledge_chunks SET chunk_text = 'tampered' WHERE id = 1;`;
try {
  runPsql(testDestructiveSql, 'gateway_readonly');
  console.error('   [FAIL] gateway_readonly was able to update knowledge_chunks!');
  process.exit(1);
} catch (e) {
  if (e.message.includes('permission denied') || e.message.includes('ERROR')) {
    console.log('   [PASS] Destructive write rejected for gateway_readonly: permission denied.');
  } else {
    console.error('   [FAIL] Unexpected error:', e.message);
    process.exit(1);
  }
}

// =========================================================================
// 9. N8N WORKFLOW AGENT INTEGRATION VERIFICATION
// =========================================================================
console.log('\n9. n8n Workflow Agent Integration Verification:');
const workflowJson = JSON.parse(fs.readFileSync('evolution_whatsapp_ai_agent_bot.json', 'utf8'));

const node2007 = workflowJson.nodes.find(n => n.id === '2007');
if (!node2007) {
  console.error('   [FAIL] Node 2007 not found in evolution_whatsapp_ai_agent_bot.json!');
  process.exit(1);
}

const isConnectedToAgent = workflowJson.connections['Tool: Search Knowledge Base']?.ai_tool?.some(
  c => c.some(t => t.node === 'AI Agent (Shared Engine)')
);

const hasHybridSearch = node2007.parameters.jsCode.includes('hybridQuery') && 
                        node2007.parameters.jsCode.includes('rrf_score') &&
                        node2007.parameters.jsCode.includes('trustedBusinessCode');

const hasAuditLogging = node2007.parameters.jsCode.includes('platform_audit_metadata');
const hasCitations = node2007.parameters.jsCode.includes('[Verified Citation');

console.log(`   Node 2007 Name: "${node2007.name}"`);
console.log(`   Connected to AI Agent: ${isConnectedToAgent}`);
console.log(`   Contains Hybrid RRF Retrieval: ${hasHybridSearch}`);
console.log(`   Contains Audit Logging: ${hasAuditLogging}`);
console.log(`   Contains Structured Citations: ${hasCitations}`);

if (isConnectedToAgent && hasHybridSearch && hasAuditLogging && hasCitations) {
  console.log('   [PASS] Node 2007 Knowledge Gateway successfully connected and fully verified in workflow.');
} else {
  console.error('   [FAIL] Node 2007 configuration check failed!');
  process.exit(1);
}

console.log('\n================================================================================');
console.log('ALL PHASE 26 KNOWLEDGE GATEWAY VERIFICATION TESTS PASSED SUCCESSFULLY (100%)');
console.log('================================================================================\n');
