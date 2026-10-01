# Phase 33: Evolution Response Router Specification

## Overview & Objective
Phase 33 establishes a centralized, business-aware **Evolution Response Router** to guarantee that outgoing WhatsApp messages ALWAYS originate from the exact configured Evolution GO instance corresponding to the business domain. It prevents cross-domain instance leakage, validates active instance-to-business registry mappings in PostgreSQL, dynamically addresses Evolution GO send endpoints with instance API keys, and executes automated retries with exponential backoff for transient delivery failures.

---

## Configured WhatsApp Instance Mapping (User Selection)

The system maps the following exact live Evolution GO WhatsApp instance names to their respective business domains in `platform_db.platform_whatsapp_instances`:

| Business Domain (`business_code`) | Domain Description | Configured WhatsApp Instance Name (`instance_name`) | Status | Token Alias |
| :--- | :--- | :--- | :---: | :--- |
| **`POS_RETAIL`** | GlimsTech POS Retail & Products | `point-of-sale` | `CONNECTED` | `pos_token_12345` |
| **`BISE_EDU`** | BISE Board Educational System | `Bise-bwp` | `CONNECTED` | `bise_token_12345` |
| **`HOSP_HEALTH`** | City Hospital & OPD System | `hospital-assistant` | `CONNECTED` | `hosp_token_12345` |

*(Note: Legacy alias names `pos-instance`, `bise-instance`, `hospital-instance` remain supported for backward compatibility).*

---

## Architecture & Flow

```
[Inbound Message Webhook]
        │
        ▼
[Message Normalizer] ─── (Attaches trusted business_code & instance_name)
        │
        ▼
[AI Agent / Gateways / Validator]
        │
        ▼
[Evolution Response Router (Phase 33)]
   ├─► 1. Sanitize secrets/PII
   ├─► 2. Resolve & validate active instance mapping in platform_db
   ├─► 3. Block cross-domain instance leakage (CROSS_INSTANCE_MISMATCH)
   ├─► 4. Dynamically construct http://host.docker.internal:4000/send/text
   ├─► 5. Execute HTTP POST with instance apikey token
   ├─► 6. Exponential backoff retry (up to 3 retries on network/HTTP 5xx errors)
   └─► 7. Persist 12-field trace to platform_audit_metadata
```

---

## Response Router Engine Interface ([`scripts/response_router.js`](file:///d:/AI-Automation/scripts/response_router.js))

### Core Functions

```js
const {
  resolveInstanceMapping,
  buildEvolutionEndpoint,
  formatWhatsAppRecipient,
  dispatchWhatsAppResponse
} = require('./response_router');
```

1. **`resolveInstanceMapping(instanceName, businessCode)`**:
   Validates mapping against `platform_db.platform_whatsapp_instances`. Rejects cross-business instance mismatches (`CROSS_INSTANCE_MISMATCH`).

2. **`buildEvolutionEndpoint(instanceName, baseUrl)`**:
   Constructs standard Evolution GO HTTP send URL (`http://host.docker.internal:4000/send/text`).

3. **`dispatchWhatsAppResponse(responseText, context, options)`**:
   - Sanitizes text content via `audit_logger.sanitizeSecrets`.
   - Validates active instance mapping.
   - Dispatches HTTP request with `apikey` header.
   - Retries up to 3 times on transient failure with backoff delay.
   - Logs complete audit trace to stdout and `platform_db.platform_audit_metadata`.

---

## Verification Results

- **Phase 33 Automated Test Suite:** [`scripts/test_phase33_response_router.js`](file:///d:/AI-Automation/scripts/test_phase33_response_router.js) — **25 / 25 Assertions Passed**
- **Master Test Runner:** [`scripts/run_all_phase_tests.js`](file:///d:/AI-Automation/scripts/run_all_phase_tests.js) — **19 / 19 Test Suites Passed (100%)**
