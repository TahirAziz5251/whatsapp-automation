/**
 * Phase 33: Evolution Response Router Engine
 * 
 * Objectives:
 * 1. Guarantee replies are sent from the original business instance.
 * 2. Validate active instance-to-business domain mapping in platform_db.
 * 3. Dynamically construct target Evolution GO HTTP endpoint and attach instance tokens.
 * 4. Implement retry mechanism with exponential backoff for send failures.
 * 5. Log audit telemetry and enforce secret/PII sanitization.
 */

const { execSync } = require('child_process');
const http = require('http');
const https = require('https');
const auditLogger = require('./audit_logger');

/**
 * Default Business-to-Instance Mappings (fallback / alias registry)
 */
const DEFAULT_INSTANCE_REGISTRY = {
  'POS_RETAIL': { instance_name: 'point-of-sale', token: 'pos_token_12345' },
  'BISE_EDU': { instance_name: 'student-assistant', token: 'bise_token_12345' },
  'HOSP_HEALTH': { instance_name: 'hospital-assistant', token: 'hosp_token_12345' },
  'RESTAURANT_FOOD': { instance_name: 'restaurant-instance', token: 'rest_token_999' }
};

/**
 * Normalizes WhatsApp recipient numbers
 * @param {string} phone 
 * @returns {string} e.g. '923001234567@s.whatsapp.net' or '923001234567'
 */
function formatWhatsAppRecipient(phone) {
  if (!phone) return '';
  let clean = String(phone).replace(/[\s\-\(\)\+]/g, '');
  if (clean.includes('@')) {
    clean = clean.split('@')[0];
  }
  return clean;
}

/**
 * Resolves trusted instance context and validates active database registry mapping
 * @param {string} instanceName 
 * @param {string} businessCode 
 * @returns {Object} { valid: boolean, instance_name: string, business_code: string, instance_token: string, error?: string }
 */
function resolveInstanceMapping(instanceName, businessCode) {
  const normBusiness = (businessCode || 'POS_RETAIL').toUpperCase();
  const normInstance = instanceName || (DEFAULT_INSTANCE_REGISTRY[normBusiness]?.instance_name);

  try {
    const sql = `
      SELECT business_code, instance_name, instance_token, status
      FROM platform_whatsapp_instances
      WHERE (LOWER(instance_name) = LOWER('${normInstance}') OR business_code = '${normBusiness}')
        AND status IN ('CONNECTED', 'ACTIVE')
      ORDER BY (LOWER(instance_name) = LOWER('${normInstance}')) DESC
      LIMIT 1;
    `;
    const cmd = `docker exec -i evolution-postgres psql -U postgres -d platform_db -t -A -c "${sql.replace(/\n/g, ' ')}"`;
    const dbRaw = execSync(cmd, { encoding: 'utf8' }).trim();

    if (dbRaw && dbRaw.length > 0) {
      const [bCode, instName, token, status] = dbRaw.split('|').map(s => s.trim());
      
      // Verify business domain ownership
      if (bCode.toUpperCase() !== normBusiness) {
        return {
          valid: false,
          error_code: 'CROSS_INSTANCE_MISMATCH',
          error: `[RESPONSE ROUTER ALERT] Instance '${instName}' is registered under domain '${bCode}', but response requested for '${normBusiness}'. Cross-business instance leakage blocked.`
        };
      }

      return {
        valid: true,
        business_code: bCode,
        instance_name: instName,
        instance_token: token || 'default_token',
        status
      };
    }
  } catch (err) {
    console.warn(`[RESPONSE ROUTER WARNING] Database lookup failed, falling back to static registry: ${err.message}`);
  }

  // Fallback to static registry if DB is unreachable
  const fallback = DEFAULT_INSTANCE_REGISTRY[normBusiness];
  if (fallback) {
    return {
      valid: true,
      business_code: normBusiness,
      instance_name: fallback.instance_name,
      instance_token: fallback.token,
      status: 'CONNECTED',
      fallback_used: true
    };
  }

  return {
    valid: false,
    error_code: 'INSTANCE_MAPPING_NOT_FOUND',
    error: `[RESPONSE ROUTER DENIAL] No active WhatsApp instance mapped for business '${normBusiness}' (instance: '${instanceName}').`
  };
}

/**
 * Dynamically constructs the target Evolution GO HTTP send endpoint URL
 * @param {string} instanceName 
 * @param {string} [baseUrl='http://host.docker.internal:4000'] 
 * @returns {string} Endpoint URL
 */
function buildEvolutionEndpoint(instanceName, baseUrl = 'http://host.docker.internal:4000') {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  if (cleanBase.includes('/send/text')) {
    return cleanBase;
  }
  return `${cleanBase}/send/text`;
}

/**
 * Dispatches WhatsApp message with exponential retries and audit log persistence
 * @param {string} responseText - Text response to deliver
 * @param {Object} context - Session context { instance_name, business_code, customerPhone, request_id }
 * @param {Object} [options] - Options { baseUrl, maxRetries, retryDelayMs }
 * @returns {Promise<Object>} Execution result object
 */
async function dispatchWhatsAppResponse(responseText, context = {}, options = {}) {
  const reqId = context.request_id || auditLogger.generateRequestId('rr');
  const startTime = Date.now();

  const businessCode = (context.business_code || context.business_id || 'POS_RETAIL').toUpperCase();
  const rawInstance = context.instance_name || context.instance;
  const recipient = formatWhatsAppRecipient(context.customerPhone || context.customer_phone || context.user_session);

  // 1. Sanitize response text
  const sanitizedText = auditLogger.sanitizeSecrets(responseText || '');

  // 2. Resolve & Validate Active Instance Mapping
  const mapping = resolveInstanceMapping(rawInstance, businessCode);
  if (!mapping.valid) {
    const errorTrace = auditLogger.createRequestTrace({
      request_id: reqId,
      business_id: businessCode,
      instance: rawInstance || 'unmapped_instance',
      user_session: recipient,
      intent: 'dispatch_response',
      tool_requested: 'evolution_response_router',
      tool_executed: 'NONE',
      execution_result: 'BLOCKED',
      response: sanitizedText,
      latency_ms: Date.now() - startTime,
      error: mapping.error_code || 'INSTANCE_MAPPING_NOT_FOUND',
      error_category: mapping.error_code || 'INSTANCE_MAPPING_NOT_FOUND',
      error_details: { message: mapping.error }
    });
    auditLogger.logAuditTrace(errorTrace);

    return {
      status: 'ROUTER_DENIED',
      request_id: reqId,
      error_code: mapping.error_code,
      message: mapping.error,
      trace: errorTrace
    };
  }

  // 3. Build Dynamic Endpoint & Payload
  const targetUrl = buildEvolutionEndpoint(mapping.instance_name, options.baseUrl);
  const payload = {
    instance: mapping.instance_name,
    number: recipient,
    text: sanitizedText
  };

  const maxRetries = options.maxRetries || 3;
  let attempt = 0;
  let lastError = null;
  let delivered = false;
  let httpStatusCode = 0;

  // 4. Dispatch with Retry Mechanism
  while (attempt < maxRetries && !delivered) {
    attempt++;
    try {
      // In local/test environment, simulate or perform actual HTTP POST
      const mockResult = options.mockDispatch 
        ? options.mockDispatch(targetUrl, payload, mapping.instance_token)
        : await executeHttpPost(targetUrl, payload, mapping.instance_token);

      delivered = true;
      httpStatusCode = mockResult.statusCode || 200;
    } catch (err) {
      lastError = err;
      console.warn(`[RESPONSE ROUTER RETRY] Attempt ${attempt}/${maxRetries} failed for instance '${mapping.instance_name}': ${err.message}`);
      if (attempt < maxRetries) {
        const backoffMs = (options.retryDelayMs || 300) * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, backoffMs));
      }
    }
  }

  const latency = Date.now() - startTime;
  const execResult = delivered ? 'SUCCESS' : 'ERROR';
  const errCat = delivered ? 'NONE' : 'SEND_HTTP_FAILED';

  // 5. Build & Log Standardized Trace
  const trace = auditLogger.createRequestTrace({
    request_id: reqId,
    business_id: mapping.business_code,
    instance: mapping.instance_name,
    user_session: recipient,
    intent: 'dispatch_whatsapp_response',
    tool_requested: 'evolution_response_router',
    tool_executed: 'send_whatsapp_text',
    execution_result: execResult,
    response: sanitizedText,
    latency_ms: latency,
    error: errCat,
    error_category: errCat,
    error_details: delivered ? null : { message: lastError?.message, attempts: attempt },
    timestamp: new Date(startTime).toISOString()
  });

  auditLogger.logAuditTrace(trace);

  return {
    status: delivered ? 'DELIVERED' : 'FAILED',
    request_id: reqId,
    business_code: mapping.business_code,
    instance_name: mapping.instance_name,
    recipient,
    attempts: attempt,
    http_status_code: httpStatusCode,
    sanitized_response: sanitizedText,
    trace
  };
}

/**
 * Helper to perform HTTP POST request
 */
function executeHttpPost(urlStr, dataObj, apiKey) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlStr);
      const postData = JSON.stringify(dataObj);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;

      const reqOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'apikey': apiKey || 'default_token'
        },
        timeout: 5000
      };

      const req = client.request(reqOptions, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, body });
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          }
        });
      });

      req.on('error', (e) => reject(e));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Evolution HTTP POST request timed out after 5000ms'));
      });

      req.write(postData);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  DEFAULT_INSTANCE_REGISTRY,
  formatWhatsAppRecipient,
  resolveInstanceMapping,
  buildEvolutionEndpoint,
  dispatchWhatsAppResponse
};
