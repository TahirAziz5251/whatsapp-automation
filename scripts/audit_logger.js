/**
 * Phase 32: Audit Logging + Error Handling Engine
 * 
 * Objective:
 * Make every request traceable and failures diagnosable across the entire workflow.
 * 
 * Trace Fields Required:
 * - request_id
 * - business_id
 * - instance
 * - user/session
 * - intent
 * - tool requested
 * - tool executed
 * - execution result
 * - response
 * - latency
 * - error (error_category)
 * - timestamp
 * 
 * Controls:
 * - Secret sanitization (passwords, tokens, credentials, connection strings, PII)
 * - Standardized recoverable vs fatal error paths
 * - Dual logging: Operational stdout logs + PostgreSQL DB persistence (platform_audit_metadata)
 */

const { execSync } = require('child_process');

/**
 * Generates a unique, prefix-timestamped request ID
 * @param {string} [prefix='req'] 
 * @returns {string} e.g. 'req_1727339123456_a7f9'
 */
function generateRequestId(prefix = 'req') {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 6);
  return `${prefix}_${ts}_${rand}`;
}

/**
 * Escapes single quotes for PostgreSQL string literals
 */
function sqlEscape(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/'/g, "''");
}

/**
 * Deeply sanitizes an object, array, or string to redact sensitive data (secrets, tokens, credentials, PII)
 * @param {any} input 
 * @returns {any} Sanitized clone
 */
function sanitizeSecrets(input) {
  if (input === null || input === undefined) return input;

  if (typeof input === 'string') {
    let sanitized = input;
    // Redact connection strings
    sanitized = sanitized.replace(/(postgres|postgresql|mysql|mongodb|redis):\/\/[^\s"']+/gi, '[REDACTED_DB_CONNECTION]');
    // Redact Bearer / API keys
    sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9\-\._~\+\/]+=*/g, 'Bearer [REDACTED_TOKEN]');
    sanitized = sanitized.replace(/(api[_\-]?key|auth[_\-]?token|secret|password)=['"]?[^'"\s&]+['"]?/gi, '$1=[REDACTED]');
    // Redact CNIC numbers (35202-1234567-1 -> 35202-*******-1)
    sanitized = sanitized.replace(/\b(\d{5})-\d{7}-(\d{1})\b/g, '$1-*******-$2');
    // Redact Credit Card numbers
    sanitized = sanitized.replace(/\b(?:\d[ -]*?){13,16}\b/g, (match) => {
      const clean = match.replace(/[\s\-]/g, '');
      if (clean.length >= 13 && clean.length <= 16) {
        return '**** **** **** ' + clean.slice(-4);
      }
      return match;
    });
    // Redact IBAN (e.g. PK36HABB0000112233445566)
    sanitized = sanitized.replace(/\bPK\d{2}[A-Z0-9]{4}[A-Z0-9]{12,16}\b/gi, (match) => {
      return 'PK** **** **** **** **** ' + match.slice(-4);
    });
    return sanitized;
  }

  if (Array.isArray(input)) {
    return input.map(item => sanitizeSecrets(item));
  }

  if (typeof input === 'object') {
    const sanitizedObj = {};
    const SENSITIVE_KEYS = [
      'password', 'pass', 'passwd', 'secret', 'token', 'access_token',
      'api_key', 'apikey', 'bearer', 'authorization', 'auth', 'credentials',
      'db_url', 'connection_string', 'private_key'
    ];

    for (const [key, value] of Object.entries(input)) {
      const lowerKey = key.toLowerCase();
      if (typeof value === 'string' && /(postgres|postgresql|mysql|mongodb|redis):\/\/[^\s"']+/gi.test(value)) {
        sanitizedObj[key] = '[REDACTED_DB_CONNECTION]';
      } else if (SENSITIVE_KEYS.some(sk => lowerKey.includes(sk))) {
        sanitizedObj[key] = '[REDACTED_SECRET]';
      } else {
        sanitizedObj[key] = sanitizeSecrets(value);
      }
    }
    return sanitizedObj;
  }

  return input;
}

/**
 * Classifies error message into standardized error category
 * @param {string|Error} error 
 * @param {string} [code] 
 * @returns {string} Error Category
 */
function classifyErrorCategory(error, code) {
  if (code && typeof code === 'string') return code;
  
  const errMsg = (typeof error === 'string' ? error : error?.message || '').toLowerCase();
  
  if (!errMsg || errMsg === 'none') return 'NONE';
  if (errMsg.includes('pii') || errMsg.includes('cnic') || errMsg.includes('credit card')) return 'PII_VIOLATION';
  if (errMsg.includes('cross-business') || errMsg.includes('tenant') || errMsg.includes('unauthorized_tenant')) return 'CROSS_BUSINESS_LEAK';
  if (errMsg.includes('policy') || errMsg.includes('denied') || errMsg.includes('forbidden')) return 'POLICY_DENIAL';
  if (errMsg.includes('read-only') || errMsg.includes('read_operation') || errMsg.includes('read operation')) return 'READ_OPERATION_REJECTED';
  if (errMsg.includes('approval') || errMsg.includes('pending_approval')) return 'APPROVAL_REQUIRED';
  if (errMsg.includes('validation') || errMsg.includes('missing') || errMsg.includes('invalid')) return 'VALIDATION_ERROR';
  if (errMsg.includes('timeout') || errMsg.includes('etimedout')) return 'TOOL_TIMEOUT';
  if (errMsg.includes('connection') || errMsg.includes('econnrefused') || errMsg.includes('psql: error')) return 'DB_CONNECTION_ERROR';
  
  return 'FATAL_SYSTEM_ERROR';
}

/**
 * Creates a standardized end-to-end request trace object
 * @param {Object} params
 * @returns {Object} RequestTrace
 */
function createRequestTrace({
  request_id,
  business_id,
  instance,
  user_session,
  intent,
  tool_requested,
  tool_executed,
  execution_result,
  response,
  latency_ms,
  error,
  error_category,
  error_details,
  timestamp
}) {
  const reqId = request_id || generateRequestId();
  const startTime = timestamp ? new Date(timestamp).getTime() : Date.now();
  const cat = error_category || classifyErrorCategory(error);

  const rawTrace = {
    request_id: reqId,
    business_id: business_id || 'UNKNOWN',
    instance: instance || 'default_instance',
    user_session: user_session || 'anonymous',
    intent: intent || 'general_query',
    tool_requested: tool_requested || 'NONE',
    tool_executed: tool_executed || 'NONE',
    execution_result: execution_result || (cat === 'NONE' ? 'SUCCESS' : 'ERROR'),
    response: response || '',
    latency_ms: typeof latency_ms === 'number' ? latency_ms : 0,
    error: cat,
    error_category: cat,
    error_details: error_details || null,
    timestamp: new Date(startTime).toISOString()
  };

  return sanitizeSecrets(rawTrace);
}

/**
 * Logs request trace to stdout and persists to platform_audit_metadata DB table
 * @param {Object} trace - Standardized trace object 
 * @returns {Object} Sanitized trace object logged
 */
function logAuditTrace(trace) {
  const sanitizedTrace = sanitizeSecrets(trace);
  
  // 1. Output operational structured JSON log to stdout
  console.log(`[AUDIT_LOG] ${JSON.stringify(sanitizedTrace)}`);

  // 2. Persist to PostgreSQL platform_db.platform_audit_metadata table
  try {
    const reqId = sqlEscape(sanitizedTrace.request_id);
    const bCode = sqlEscape(sanitizedTrace.business_id);
    const inst = sqlEscape(sanitizedTrace.instance);
    const phone = sqlEscape(sanitizedTrace.user_session);
    const intent = sqlEscape(sanitizedTrace.intent);
    const toolReq = sqlEscape(sanitizedTrace.tool_requested);
    const toolExec = sqlEscape(sanitizedTrace.tool_executed);
    const execRes = sqlEscape(sanitizedTrace.execution_result);
    const errCat = sqlEscape(sanitizedTrace.error_category || sanitizedTrace.error);
    const latency = parseInt(sanitizedTrace.latency_ms || 0, 10);
    const inbound = sqlEscape(JSON.stringify({
      request_id: sanitizedTrace.request_id,
      intent: sanitizedTrace.intent,
      tool_requested: sanitizedTrace.tool_requested,
      tool_executed: sanitizedTrace.tool_executed,
      user_session: sanitizedTrace.user_session
    }));
    const outbound = sqlEscape(JSON.stringify({
      execution_result: sanitizedTrace.execution_result,
      response: sanitizedTrace.response,
      error_category: sanitizedTrace.error_category || sanitizedTrace.error,
      error_details: sanitizedTrace.error_details
    }));
    const errDetails = sanitizedTrace.error_details ? `'${sqlEscape(JSON.stringify(sanitizedTrace.error_details))}'` : 'NULL';

    const insertSql = `
      INSERT INTO platform_audit_metadata (
        business_code, instance_name, customer_phone,
        inbound_payload, outbound_payload,
        processing_time_ms, created_at
      ) VALUES (
        '${bCode}', '${inst}', '${phone}',
        '${inbound}'::jsonb, '${outbound}'::jsonb,
        ${latency}, CURRENT_TIMESTAMP
      );
    `;

    try {
      execSync('docker exec -i evolution-postgres psql -U postgres -d platform_db', {
        input: insertSql,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (dockerErr) {
      const psqlPath = 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';
      execSync(
        `"${psqlPath}" -U postgres -h localhost -p 5432 -d platform_db -t -A`,
        {
          input: insertSql,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, PGPASSWORD: 'postgres' }
        }
      );
    }
  } catch (dbErr) {
    // Audit logging must be fail-safe: DB error should be logged to stderr without throwing to pipeline caller
    console.error(`[AUDIT_LOG_DB_ERROR] Failed to persist audit record to platform_db: ${dbErr.message}`);
  }

  return sanitizedTrace;
}

/**
 * Handles error standardized into Recoverable vs Fatal paths
 * @param {Error|string} error 
 * @param {Object} context 
 * @returns {Object} Standardized error response contract
 */
function handleError(error, context = {}) {
  const errMsg = typeof error === 'string' ? error : error?.message || 'Unknown system error';
  const errCategory = classifyErrorCategory(error, context.error_code || context.error_category);
  const reqId = context.request_id || generateRequestId();

  const isFatal = errCategory === 'FATAL_SYSTEM_ERROR' || errCategory === 'DB_CONNECTION_ERROR';

  let userResponse = '';
  if (isFatal) {
    userResponse = `An operational error occurred while processing your request (Ref: ${reqId}). Please try again later or contact support.`;
  } else {
    userResponse = context.user_message || `[RECOVERABLE ERROR] ${errMsg}`;
  }

  const trace = createRequestTrace({
    request_id: reqId,
    business_id: context.business_code || context.business_id || 'UNKNOWN',
    instance: context.instance_name || context.instance || 'default',
    user_session: context.customer_phone || context.user_session || 'anonymous',
    intent: context.intent || 'unknown_intent',
    tool_requested: context.tool_requested || 'NONE',
    tool_executed: context.tool_executed || 'NONE',
    execution_result: isFatal ? 'FATAL_ERROR' : 'REJECTED',
    response: userResponse,
    latency_ms: context.latency_ms || 0,
    error: errCategory,
    error_category: errCategory,
    error_details: {
      message: errMsg,
      stack: isFatal && error?.stack ? error.stack : undefined,
      code: context.error_code
    }
  });

  logAuditTrace(trace);

  return {
    status: isFatal ? 'FATAL_ERROR' : 'RECOVERABLE_ERROR',
    request_id: reqId,
    error_category: errCategory,
    message: userResponse,
    sanitized_trace: trace
  };
}

module.exports = {
  generateRequestId,
  sanitizeSecrets,
  classifyErrorCategory,
  createRequestTrace,
  logAuditTrace,
  handleError
};
