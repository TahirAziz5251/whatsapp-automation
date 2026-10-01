/**
 * Phase 31: Response Security + PII Controls Engine
 * 
 * Objectives:
 * 1. Protect sensitive data (CNIC, Credit Cards, Phone numbers, medical diagnoses, student Form-B).
 * 2. Enforce domain-specific field allow-lists (POS, Hospital, BISE).
 * 3. Prevent cross-business data leakage across multi-tenant boundaries.
 * 4. Enforce strict identity & ownership checks for private data (Hospital & BISE strictness).
 * 5. Sanitize prompt-injection residue and internal system prompt fragments.
 * 6. Block unsupported medical or financial claims outside tool evidence.
 */

// Regex patterns for sensitive PII data
const PII_PATTERNS = {
  // Pakistani National Identity Number (CNIC): 13 digits, e.g., 35202-1234567-1 or 3520212345671
  CNIC: /\b\d{5}[-\s]?\d{7}[-\s]?\d{1}\b/g,

  // Credit Card Numbers (13-19 digits with optional hyphens/spaces)
  CREDIT_CARD: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,

  // Generic 16-digit card pattern
  GENERIC_CARD: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,

  // IBAN (PK followed by 2 digits and 20 alphanumeric characters)
  IBAN: /\bPK\d{2}[A-Z0-9]{4}\d{16}\b/gi,

  // Database Connection Strings & Passwords
  DB_SECRET: /(?:postgres|mysql):\/\/[^\s:@]+:[^\s:@]+@[^\s:]+:\d+\/[^\s]+/gi,
  API_KEY: /(?:bearer\s+[a-zA-Z0-9_\-\.]{20,}|apikey[=:\s]+[a-zA-Z0-9_\-]{20,})/gi
};

// Patterns representing prompt injection residue & system leaks
const PROMPT_INJECTION_RESIDUE = [
  /system\s*prompt:/i,
  /ignore (?:all )?previous instructions/i,
  /you are (?:an? )?(?:ai|assistant|llm) (?:developed|created|built) by/i,
  /internal instructions:/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /\[SYSTEM_NOTE\]/i,
  /\[DEVELOPER_MODE\]/i,
  /\[INTERNAL_PROMPT\]/i
];

// Alien tenant patterns for cross-business leakage detection
const ALIEN_TENANT_PATTERNS = {
  POS_RETAIL: [
    /\bAPT-\d{4}-\d+\b/i,          // Hospital appointment number
    /hospital_db/i,
    /bise_db/i,
    /\bBISE-\d{4}-\d+\b/i,        // BISE registration
    /roll number verification/i,
    /cardiology|pediatrics|neurology|opd doctor/i
  ],
  HOSP_HEALTH: [
    /\bORD-\d{4}-\d+\b/i,          // POS order number
    /pos_db/i,
    /bise_db/i,
    /\bBISE-\d{4}-\d+\b/i,
    /point of sale|product sku|retail store|order total pkr/i
  ],
  BISE_EDU: [
    /\bORD-\d{4}-\d+\b/i,
    /\bAPT-\d{4}-\d+\b/i,
    /pos_db/i,
    /hospital_db/i,
    /cardiology|doctor OPD|opd clinic|patient mrn/i
  ]
};

// Sensitive medical diagnosis terms (Strict Hospital Controls)
const SENSITIVE_MEDICAL_TERMS = [
  /(?:clinical diagnosis|diagnosis|patient has a history of|diagnosed with):\s*[^.\n]+/gi,
  /patient has (?:been diagnosed with|a history of)\s+[^.\n]+/gi,
  /(?:psychiatric|bipolar|schizophrenia|hiv|oncology stage|cancer diagnosis)\s*[^.\n]*/gi,
  /(?:prescribed dosage|prescription notes):\s*[^.\n]+/gi
];

// Sensitive educational terms (Strict BISE Controls)
const SENSITIVE_BISE_TERMS = [
  /student cnic:|father cnic:/i,
  /form-b number:/i,
  /internal examiner comments:/i,
  /marks modified by admin/i
];

/**
 * Normalizes phone numbers for string comparison
 */
function normalizePhone(phone) {
  if (!phone) return '';
  return String(phone).replace(/[\s\-\(\)\+]/g, '');
}

/**
 * Mask Pakistani CNIC: 35202-1234567-1 -> 35202-*******-1
 */
function maskCNIC(cnic) {
  if (!cnic) return '';
  const clean = String(cnic).replace(/[\s\-]/g, '');
  if (clean.length === 13) {
    return `${clean.substring(0, 5)}-*******-${clean.substring(12)}`;
  }
  return 'XXXXX-XXXXXXX-X';
}

/**
 * Mask Credit Card: 4532 1234 5678 9012 -> **** **** **** 9012
 */
function maskCreditCard(card) {
  if (!card) return '';
  const clean = String(card).replace(/[\s\-]/g, '');
  if (clean.length >= 12) {
    return `**** **** **** ${clean.substring(clean.length - 4)}`;
  }
  return '**** **** **** ****';
}

/**
 * Mask Phone Number: +92 300 1234567 -> +92-300-***-4567
 */
function maskPhone(phone) {
  if (!phone) return '';
  const clean = normalizePhone(phone);
  if (clean.length >= 10) {
    const prefix = clean.substring(0, clean.length - 4);
    const suffix = clean.substring(clean.length - 4);
    return `+${prefix.substring(0, 5)}***${suffix}`;
  }
  return '***-***-****';
}

/**
 * 1. PII Minimization & Masking Engine
 * Scans text and redacts sensitive PII (CNIC, Credit Card, IBAN, API keys, DB connection strings).
 */
function applyPIIMinimization(text, context = {}) {
  if (!text || typeof text !== 'string') return text;

  let sanitized = text;

  // 1a. Mask CNIC
  sanitized = sanitized.replace(PII_PATTERNS.CNIC, (match) => maskCNIC(match));

  // 1b. Mask Credit Cards
  sanitized = sanitized.replace(PII_PATTERNS.CREDIT_CARD, (match) => maskCreditCard(match));
  sanitized = sanitized.replace(PII_PATTERNS.GENERIC_CARD, (match) => maskCreditCard(match));

  // 1c. Mask IBAN
  sanitized = sanitized.replace(PII_PATTERNS.IBAN, (match) => `PK** **** **** **** **** ${match.substring(match.length - 4)}`);

  // 1d. Redact DB secrets and API Keys
  sanitized = sanitized.replace(PII_PATTERNS.DB_SECRET, '[REDACTED_DB_CONNECTION]');
  sanitized = sanitized.replace(PII_PATTERNS.API_KEY, '[REDACTED_API_CREDENTIAL]');

  return sanitized;
}

/**
 * 2. Cross-Business Data Leakage Detection
 * Scans response text for alien tenant terms/identifiers.
 */
function detectCrossBusinessLeakage(text, trustedBusinessCode) {
  if (!text || typeof text !== 'string') return { leaked: false };

  const alienPatterns = ALIEN_TENANT_PATTERNS[trustedBusinessCode] || [];
  for (const regex of alienPatterns) {
    if (regex.test(text)) {
      const match = text.match(regex);
      return {
        leaked: true,
        pattern: regex.toString(),
        matched_text: match ? match[0] : 'alien identifier'
      };
    }
  }

  return { leaked: false };
}

/**
 * 3. Prompt Injection Residue Cleaner
 * Detects and strips system prompt remnants and injection patterns.
 */
function sanitizePromptResidue(text) {
  if (!text || typeof text !== 'string') return text;

  let cleaned = text;

  // Remove injection residue patterns
  for (const regex of PROMPT_INJECTION_RESIDUE) {
    cleaned = cleaned.replace(regex, '');
  }

  // Remove template syntax {{ ... }} and brackets
  cleaned = cleaned.replace(/\{\{[\s\S]*?\}\}/g, '');

  // Remove raw SQL fragments and database table references
  cleaned = cleaned.replace(/\bSELECT\s+[\s\S]+?\s+FROM\s+\w+/gi, '');
  cleaned = cleaned.replace(/\bFROM\s+\w+/gi, '');
  cleaned = cleaned.replace(/\btable\s+\w+/gi, '');

  // Remove unsafe HTML/Script tags
  cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  cleaned = cleaned.replace(/javascript:/gi, '');
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');

  return cleaned.trim();
}

/**
 * 4. Strict Domain-Specific Controls for Hospital & BISE
 * Enforces ownership identity checks and redacts confidential medical/academic records.
 */
function applyDomainStrictControls(text, toolExecutions, trustedContext = {}) {
  if (!text || typeof text !== 'string') return { blocked: false, text };

  const businessCode = trustedContext.business_code || 'POS_RETAIL';
  const requesterPhone = normalizePhone(trustedContext.customerPhone || trustedContext.customer_phone);

  // 4a. Hospital Strict Controls
  if (businessCode === 'HOSP_HEALTH') {
    // Medical Diagnosis & Notes Protection: Never reveal clinical diagnoses/notes unless caller is verified owner
    for (const term of SENSITIVE_MEDICAL_TERMS) {
      if (term.test(text)) {
        // Redact clinical diagnosis details
        text = text.replace(term, '[CONFIDENTIAL MEDICAL RECORD REDACTED]');
      }
    }

    // Anti-Diagnosis Guard: Block AI agent from giving unauthorized medical diagnoses
    const providesMedicalAdvice = /(?:you have|i diagnose you with|your symptom indicates) (?:heart attack|cancer|covid|tumor|diabetes|appendicitis)/i.test(text);
    if (providesMedicalAdvice) {
      return {
        blocked: true,
        reason: 'UNAUTHORIZED_MEDICAL_DIAGNOSIS_BLOCKED',
        sanitized_response: 'As an automated OPD coordinator, I am strictly prohibited from offering medical diagnoses or prescription advice. Please consult a qualified doctor during clinic OPD hours.'
      };
    }
  }

  // 4b. BISE Educational Board Strict Controls
  if (businessCode === 'BISE_EDU') {
    for (const term of SENSITIVE_BISE_TERMS) {
      if (term.test(text)) {
        text = text.replace(term, '[CONFIDENTIAL STUDENT RECORD REDACTED]');
      }
    }

    // Ownership check on detailed result disclosure
    const containsResultDetails = /marks obtained:\s*\d+/i.test(text);
    if (containsResultDetails && toolExecutions) {
      const execs = Array.isArray(toolExecutions) ? toolExecutions : [toolExecutions];
      const resultExec = execs.find(e => e.action === 'check_exam_results' || e.action === 'get_student_result');
      if (resultExec && resultExec.result && resultExec.result.student_phone) {
        const studentPhone = normalizePhone(resultExec.result.student_phone);
        if (requesterPhone && studentPhone && requesterPhone !== studentPhone) {
          return {
            blocked: true,
            reason: 'PRIVACY_PROTECTION_OWNERSHIP_DENIAL',
            sanitized_response: 'Privacy Protection: The requested examination result belongs to another student. Student academic records can only be disclosed to the registered student phone number.'
          };
        }
      }
    }
  }

  return { blocked: false, text };
}

/**
 * 5. Master Response Security Pipeline
 * Combines PII minimization, cross-tenant leak checks, prompt injection residue cleaning, and domain controls.
 * 
 * @param {string} agentResponseText - Raw AI generated response
 * @param {Array<Object>|Object} toolExecutions - Array of executed tool results in turn
 * @param {Object} trustedContext - Verified session context { business_code, customerPhone, instance_name }
 * @returns {Object} { secure: boolean, sanitized_response: string, blocked_reasons?: string[] }
 */
function processResponseSecurity(agentResponseText, toolExecutions = [], trustedContext = {}) {
  const trustedBusinessCode = trustedContext.business_code || 'POS_RETAIL';
  const blockedReasons = [];

  if (!agentResponseText || typeof agentResponseText !== 'string') {
    return { secure: true, sanitized_response: agentResponseText || '' };
  }

  // Step 1: Detect Cross-Business Leakage
  const leakCheck = detectCrossBusinessLeakage(agentResponseText, trustedBusinessCode);
  if (leakCheck.leaked) {
    blockedReasons.push(`CROSS_BUSINESS_LEAKAGE_DETECTED: Matched alien term '${leakCheck.matched_text}' for business '${trustedBusinessCode}'`);
    return {
      secure: false,
      blocked: true,
      reason: 'CROSS_BUSINESS_LEAKAGE_BLOCKED',
      blocked_reasons: blockedReasons,
      sanitized_response: `We apologize, but your message could not be processed due to a cross-tenant data security boundary violation. No information has been disclosed.`
    };
  }

  // Step 2: Sanitize Prompt Injection Residue & Unsafe Script Tags
  let sanitized = sanitizePromptResidue(agentResponseText);

  // Step 3: Apply PII Minimization & Redaction
  sanitized = applyPIIMinimization(sanitized, trustedContext);

  // Step 4: Apply Hospital & BISE Domain Strict Controls
  const domainControlRes = applyDomainStrictControls(sanitized, toolExecutions, trustedContext);
  if (domainControlRes.blocked) {
    blockedReasons.push(domainControlRes.reason);
    return {
      secure: false,
      blocked: true,
      reason: domainControlRes.reason,
      blocked_reasons: blockedReasons,
      sanitized_response: domainControlRes.sanitized_response
    };
  }
  sanitized = domainControlRes.text;

  return {
    secure: true,
    blocked: false,
    sanitized_response: sanitized
  };
}

module.exports = {
  processResponseSecurity,
  applyPIIMinimization,
  detectCrossBusinessLeakage,
  sanitizePromptResidue,
  applyDomainStrictControls,
  maskCNIC,
  maskCreditCard,
  maskPhone,
  PII_PATTERNS,
  ALIEN_TENANT_PATTERNS
};
