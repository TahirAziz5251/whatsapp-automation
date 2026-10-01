# Phase 35: Agent Evaluation + Hallucination Testing Specification & Report

## 1. Overview & Objective
Phase 35 establishes a rigorous, automated, and repeatable **Evaluation Benchmark & Hallucination Defense Suite** to measure agent decision quality prior to final end-to-end acceptance. It ensures that model or prompt updates do not degrade routing accuracy, violate tenant isolation, hallucinate facts, or expose ungrounded claims to customers over WhatsApp.

---

## 2. Evaluation Scorecard & Gate Metrics

| Evaluation Dimension | Description / Target | Target Threshold | Actual Accuracy / Rate | Status |
| :--- | :--- | :---: | :---: | :---: |
| **1. Intent Selection** | Accurate intent classification across POS, BISE, and Hospital | $\ge 95\%$ | **100.0%** (7/7) | ✅ **PASSED** |
| **2. Tool Selection** | Selecting correct gateway tools (`check_product_stock`, `submit_service_application`, etc.) | $\ge 95\%$ | **100.0%** (3/3) | ✅ **PASSED** |
| **3. DB vs KB Selection** | Directing real-time relational data to DB and policies/FAQs to KB | $\ge 95\%$ | **100.0%** (6/6) | ✅ **PASSED** |
| **4. Retrieval Relevance** | Returning authoritative, high-similarity chunks for domain queries | $\ge 90\%$ | **100.0%** (2/2) | ✅ **PASSED** |
| **5. Hallucination Resistance**| Zero fabrication of prices, roll marks, doctors, or stock for non-existent entities | **0% (100% grounded)** | **100.0%** (4/4) | ✅ **PASSED** |
| **6. Business Isolation** | Deflecting cross-business inquiries outside the caller's authorized vertical | **0% Leaks** | **100.0%** (3/3) | ✅ **PASSED** |
| **7. Refusal Correctness** | Safe deflection of prompt injections, malicious SQL, and out-of-domain queries | **100%** | **100.0%** (3/3) | ✅ **PASSED** |
| **8. Action Correctness** | Validation of schemas, date constraints, and human approval triggers | $\ge 95\%$ | **100.0%** (3/3) | ✅ **PASSED** |
| **9. Response Quality & PII** | Masking CNIC, stripping template tags (`{{ ... }}`) and raw SQL tokens | **100%** | **100.0%** (2/2) | ✅ **PASSED** |

---

## 3. Evaluation Dataset Structure ([`data/evaluation_dataset.json`](file:///d:/AI-Automation/data/evaluation_dataset.json))

The repeatable benchmark dataset contains 33 curated test probes across all 9 critical evaluation categories:
- **`metadata`**: Includes version, timestamp, target domains (`POS_RETAIL`, `BISE_EDU`, `HOSP_HEALTH`), categories, and explicit threshold definitions.
- **`benchmarks`**: Array of individual evaluation items containing:
  - `id`: Unique benchmark code (`EVAL-INT-001`, `EVAL-HAL-001`, `EVAL-REF-001`, etc.)
  - `category`: Primary evaluation axis
  - `business_code`: Caller's tenant scope
  - `user_query`: Customer utterance
  - `expected`: Grounded factual requirements, expected routing target, expected tool, forbidden tokens, and refusal expectations.

---

## 4. Evaluation Engine Architecture ([`scripts/agent_evaluator.js`](file:///d:/AI-Automation/scripts/agent_evaluator.js))

The evaluation engine tests decisions against active system layers:
1. **Decision Classifier & Router**: `classifyIntentAndRoute(query, businessCode)` determines intent, target gateway, and whether the query must be refused.
2. **Hallucination Probes**:
   - Queries live PostgreSQL databases (`pos_db`, `bise_db`, `hospital_db`) for non-existent entities (fake product SKU, fake roll number `999999999`, fake doctor `Dr. Harry Potter`).
   - Asserts that live DB returns 0 rows.
   - Asserts that generated response explicitly conveys lack of records rather than fabricating values.
   - Enforces zero forbidden hallucination tokens.
3. **Retrieval Relevance Verification**:
   - Invokes `executeKnowledgeGateway({ query, trustedSessionContext })`.
   - Validates that chunks retrieved belong strictly to the tenant's namespace and contain required domain concepts.
4. **Action Correctness & Validation**:
   - Executes `validateActionParams` and `checkActionRequiresApproval`.
   - Verifies constraint failures for invalid inputs (negative order quantities, dates in the past) and approval flags for high-value operations (>50k PKR cancellations).
5. **Response Quality & PII Sanitation**:
   - Runs `processResponseSecurity(rawText, businessCode)`.
   - Verifies CNIC masking (`35201-*******-1`).
   - Verifies automatic stripping of internal template brackets `{{ ... }}` and raw SQL queries.

---

## 5. Maintenance & Repeatability for Future Model/Prompt Changes

To run this evaluation anytime prompts or models are updated:
```bash
node scripts/test_phase35_agent_evaluation.js
```
The test suite prints the per-category accuracy and will fail the build if any of the 9 thresholds fall below the target gate.
