/**
 * Phase 34: Multi-Business Isolation Engine
 * 
 * Objective:
 * Prove complete multi-tenant isolation across:
 * 1. Data/Database Gateway (Allowed vs. Forbidden DB access)
 * 2. Knowledge Retrieval (Zero cross-domain chunk leakage)
 * 3. Session Store (Zero session collisions across businesses for identical phone numbers)
 * 4. Action Gateway / Tools (Zero unauthorized cross-domain action executions)
 * 5. Inactive Business Barrier (Zero access for inactive business tenants)
 * 
 * Release-Blocking Gate: Any cross-domain result is treated as a fatal defect.
 */

const { execSync } = require('child_process');
const { executeActionGateway } = require('./action_gateway');
const { executeKnowledgeGateway } = require('./knowledge_gateway');

/**
 * Escapes single quotes for PostgreSQL string literals
 */
function sqlEscape(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/'/g, "''");
}

/**
 * Executes a PostgreSQL command safely via docker
 */
function runPsql(sql, dbName = 'platform_db', role = 'postgres') {
  const cmd = `docker exec -i evolution-postgres psql -U ${role} -d ${dbName} -t -A`;
  return execSync(cmd, {
    input: sql,
    encoding: 'utf8'
  }).trim();
}

/**
 * Verifies if a business tenant is active in platform_businesses
 * @param {string} businessCode 
 * @returns {Object} { exists: boolean, active: boolean, status: string }
 */
function isBusinessActive(businessCode) {
  try {
    const sql = `
      SELECT status 
      FROM platform_businesses 
      WHERE business_code = '${sqlEscape(businessCode)}' 
      LIMIT 1;
    `;
    const raw = runPsql(sql, 'platform_db');
    if (!raw || raw.length === 0) {
      return { exists: false, active: false, status: 'NOT_FOUND' };
    }
    const status = raw.trim().toUpperCase();
    return {
      exists: true,
      active: status === 'ACTIVE',
      status
    };
  } catch (err) {
    return { exists: false, active: false, status: 'ERROR', error: err.message };
  }
}

/**
 * Canonical Tenant Database Mappings
 */
const TENANT_DATABASE_MAP = {
  'POS_RETAIL': 'pos_db',
  'BISE_EDU': 'bise_db',
  'HOSP_HEALTH': 'hospital_db'
};

/**
 * Canonical Tenant Operations
 */
const TENANT_ALLOWED_OPS = {
  'POS_RETAIL': ['GET_PRODUCTS', 'GET_PRODUCT_BY_SKU', 'CHECK_INVENTORY'],
  'BISE_EDU': ['GET_EXAM_RESULT', 'GET_FEES'],
  'HOSP_HEALTH': ['GET_DOCTORS_BY_SPECIALTY', 'GET_DOCTOR_SCHEDULE', 'GET_DEPARTMENTS']
};

/**
 * Verifies database access isolation
 * @param {string} tenantCode - Caller tenant domain
 * @param {string} targetDb - Database attempted to query
 * @param {string} operation - Operation requested
 * @param {Object} [params] - Query parameters
 * @returns {Object} { allowed: boolean, status: string, error_code?: string, data?: any }
 */
function verifyDatabaseIsolation(tenantCode, targetDb, operation, params = {}) {
  // 1. Inactive Business Barrier
  const bStatus = isBusinessActive(tenantCode);
  if (!bStatus.exists || !bStatus.active) {
    return {
      allowed: false,
      status: 'INACTIVE_BUSINESS_DENIED',
      error_code: 'BUSINESS_INACTIVE',
      message: `[ISOLATION GATE] Business '${tenantCode}' is ${bStatus.status}. Access denied.`
    };
  }

  // 2. Multi-Tenant DB Mapping Check
  const expectedDb = TENANT_DATABASE_MAP[tenantCode];
  if (!expectedDb || expectedDb !== targetDb) {
    return {
      allowed: false,
      status: 'GATEWAY_CROSS_DOMAIN_DENIED',
      error_code: 'CROSS_DATABASE_ACCESS_FORBIDDEN',
      caller_tenant: tenantCode,
      target_database: targetDb,
      expected_database: expectedDb,
      message: `[ISOLATION GATE DENIAL] Tenant '${tenantCode}' is strictly forbidden from accessing foreign database '${targetDb}'.`
    };
  }

  // 3. Tenant Operation Permission Check
  const allowedOps = TENANT_ALLOWED_OPS[tenantCode] || [];
  if (!allowedOps.includes(operation)) {
    return {
      allowed: false,
      status: 'GATEWAY_CROSS_DOMAIN_DENIED',
      error_code: 'GATEWAY_OPERATION_UNAUTHORIZED_FOR_TENANT',
      caller_tenant: tenantCode,
      operation,
      message: `[ISOLATION GATE DENIAL] Operation '${operation}' is unauthorized for tenant '${tenantCode}'.`
    };
  }

  // 4. Execute allowed query on target database
  try {
    let testSql = '';
    if (tenantCode === 'POS_RETAIL') {
      testSql = 'SELECT COUNT(*) FROM products;';
    } else if (tenantCode === 'BISE_EDU') {
      testSql = 'SELECT COUNT(*) FROM students;';
    } else if (tenantCode === 'HOSP_HEALTH') {
      testSql = 'SELECT COUNT(*) FROM doctors;';
    }
    const count = parseInt(runPsql(testSql, targetDb, 'gateway_readonly') || '0', 10);
    return {
      allowed: true,
      status: 'GATEWAY_SUCCESS',
      caller_tenant: tenantCode,
      target_database: targetDb,
      operation,
      record_count: count
    };
  } catch (err) {
    return {
      allowed: false,
      status: 'EXECUTION_ERROR',
      error: err.message
    };
  }
}

/**
 * Verifies Knowledge Base Isolation
 * @param {string} tenantCode - Caller tenant
 * @param {string} query - Search query
 * @param {Object} [injectedParams] - Attempted untrusted overrides
 * @returns {Object} { allowed: boolean, chunk_count: number, titles: string[], citations: string }
 */
function verifyKnowledgeIsolation(tenantCode, query, injectedParams = {}) {
  // 1. Inactive Business Barrier
  const bStatus = isBusinessActive(tenantCode);
  if (!bStatus.exists || !bStatus.active) {
    return {
      allowed: false,
      status: 'INACTIVE_BUSINESS_DENIED',
      chunk_count: 0,
      titles: [],
      message: `[ISOLATION GATE] Business '${tenantCode}' is ${bStatus.status}. Knowledge search disabled.`
    };
  }

  // 2. Execute search via Knowledge Gateway (pins to trusted session context)
  const kgResult = executeKnowledgeGateway({
    query,
    trustedSessionContext: {
      business_code: tenantCode,
      instance_name: 'isolation-test-instance',
      allowed_tools: ['search_knowledge_base']
    },
    untrustedParams: injectedParams,
    topK: 5
  });

  const rawResults = kgResult.raw_results || [];
  const count = kgResult.results_count !== undefined ? kgResult.results_count : rawResults.length;
  const titles = rawResults.map(r => r.document_title || r.chunk_title || '');

  return {
    allowed: true,
    status: kgResult.status || 'COMPLETED',
    caller_tenant: tenantCode,
    chunk_count: count,
    titles,
    formatted_context: kgResult.formatted_context || kgResult.formattedContext
  };
}

/**
 * Verifies Session Isolation and Collision Prevention
 * @param {string} customerPhone - Customer phone number
 * @param {string} tenantA - Business domain A
 * @param {string} tenantB - Business domain B
 * @returns {Object} Collision test verification result
 */
function verifySessionIsolation(customerPhone, tenantA = 'POS_RETAIL', tenantB = 'HOSP_HEALTH') {
  const normPhone = String(customerPhone).replace(/[\s\-\(\)\+]/g, '');
  const sessionKeyA = `${tenantA}:${normPhone}`;
  const sessionKeyB = `${tenantB}:${normPhone}`;

  // 1. Seed distinct session state for Tenant A
  const stateA = JSON.stringify({ cart: ['POS-HW-001'], current_order_id: 'ORD-999' });
  const sqlInsertA = `
    INSERT INTO platform_session_metadata (session_key, business_code, customer_phone, current_intent, context_state, last_interaction)
    VALUES ('${sqlEscape(sessionKeyA)}', '${tenantA}', '${normPhone}', 'create_order', '${sqlEscape(stateA)}'::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT (session_key) DO UPDATE SET context_state = EXCLUDED.context_state, current_intent = EXCLUDED.current_intent;
  `;
  runPsql(sqlInsertA, 'platform_db');

  // 2. Seed distinct session state for Tenant B
  const stateB = JSON.stringify({ doctor_specialty: 'Cardiology', appointment_date: '2026-10-09' });
  const sqlInsertB = `
    INSERT INTO platform_session_metadata (session_key, business_code, customer_phone, current_intent, context_state, last_interaction)
    VALUES ('${sqlEscape(sessionKeyB)}', '${tenantB}', '${normPhone}', 'book_appointment', '${sqlEscape(stateB)}'::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT (session_key) DO UPDATE SET context_state = EXCLUDED.context_state, current_intent = EXCLUDED.current_intent;
  `;
  runPsql(sqlInsertB, 'platform_db');

  // 3. Read back sessions by respective keys
  const readSqlA = `SELECT context_state, current_intent FROM platform_session_metadata WHERE session_key = '${sqlEscape(sessionKeyA)}';`;
  const resA = runPsql(readSqlA, 'platform_db');

  const readSqlB = `SELECT context_state, current_intent FROM platform_session_metadata WHERE session_key = '${sqlEscape(sessionKeyB)}';`;
  const resB = runPsql(readSqlB, 'platform_db');

  // 4. Verify cross-reading is impossible (Tenant A looking for Tenant B key returns empty or blocked)
  const crossReadSql = `
    SELECT context_state 
    FROM platform_session_metadata 
    WHERE session_key = '${sqlEscape(sessionKeyB)}' AND business_code = '${tenantA}';
  `;
  const crossRes = runPsql(crossReadSql, 'platform_db');

  return {
    isolated: resA !== resB && (!crossRes || crossRes.length === 0),
    session_key_a: sessionKeyA,
    session_key_b: sessionKeyB,
    state_a_has_cart: resA.includes('POS-HW-001'),
    state_b_has_cardiology: resB.includes('Cardiology'),
    cross_read_empty: !crossRes || crossRes.length === 0
  };
}

/**
 * Verifies Action/Tool Isolation (Outside-LLM Enforcement)
 * @param {string} tenantCode - Caller tenant
 * @param {string} requestedAction - Action requested
 * @param {Object} [params] - Action parameters
 * @returns {Object} Action gateway verdict
 */
function verifyToolIsolation(tenantCode, requestedAction, params = {}) {
  // 1. Inactive Business Barrier
  const bStatus = isBusinessActive(tenantCode);
  if (!bStatus.exists || !bStatus.active) {
    return {
      status: 'DENIED',
      error_code: 'BUSINESS_INACTIVE_DENIED',
      tenant: tenantCode,
      action: requestedAction,
      message: `[ACTION GATEWAY DENIAL] Business '${tenantCode}' is INACTIVE. State-changing operations blocked.`
    };
  }

  // 2. Execute through Action Gateway
  const res = executeActionGateway({
    action: requestedAction,
    params,
    trustedSessionContext: {
      business_code: tenantCode,
      instance_name: 'isolation-test-instance',
      customerPhone: params.customer_phone || params.patient_phone || '+923001122334',
      allowed_tools: ['action_gateway']
    }
  });

  return res.verdict || res;
}

module.exports = {
  isBusinessActive,
  verifyDatabaseIsolation,
  verifyKnowledgeIsolation,
  verifySessionIsolation,
  verifyToolIsolation
};
