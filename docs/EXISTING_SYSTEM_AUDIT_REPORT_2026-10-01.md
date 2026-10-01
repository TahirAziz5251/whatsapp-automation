# Existing System Audit — 1 October 2026

Audit scope: read-only inspection before remediation. No production component, workflow, database record, instance setting, or service configuration was changed during this audit. Files under docs/current-system-audit contain collected evidence; scripts/current-*-audit.cjs reproduce the read-only checks.

## Decision

The existing implementation does not pass production or WhatsApp end-to-end acceptance. Several named components are placeholders and previous PASS reports include mocks. Current database contents exist, but that does not prove the running chatbot retrieves them. Remediation and real channel verification must precede a PASS decision.

## Verified architecture

WhatsApp → Evolution Go 0.7.2 (port 4000, examples_evolution_network) → both global and instance webhook → n8n 2.19.4 (port 5678, ai-automation_evolution_network, SQLite n8n_data volume) → normalization → hardcoded business/profile routing → process-memory dedup → no-op persistent-memory node → Groq agent → partially simulated tools → HTTP Evolution response.

Native Windows PostgreSQL 18.6 serves platform_db, bise_db, pos_db, hospital_db, evogo_users and evogo_auth on port 5432. The old evolution-postgres pg15 container is stopped (exit 137). Redis is running and answers PONG but the workflow dedup node does not use it. Native platform_db has pgvector 0.8.6.

The supplied JSON has workflow ID Iin5wt0nRAhO7UV9 and 18 nodes. The actual published workflow is Ag4HbAjKlfHH6Xk7, version 6b107da6-73de-4f56-958b-4d5ecaade6ab, with 19 nodes. Only one workflow is active; two inactive copies also exist. The registered POST webhook belongs to the active workflow. Remediation must preserve the live credential references and modify the actual active workflow.

## Component status matrix

| Component | Classification | Evidence / gap |
|---|---|---|
| n8n service and registered webhook | WORKING | Running 2.19.4; HTTP health 200; SQLite and published workflow inspected. Initial transient HTTP/exec timeouts recovered. |
| Local workflow versus deployed workflow | MISCONFIGURED | Different IDs, node IDs, model and options; local Groq credential is a placeholder. |
| Evolution Go service | WORKING | Image 0.7.2; authenticated GET instance/all and instance/status succeed. |
| student-assistant | WORKING | Connected=true and LoggedIn=true verified via live API. End-to-end correctness is separately failing. |
| point-of-sale | PARTIAL | Configured but Connected=false, LoggedIn=false; user confirms disconnected. |
| hospital-assistant | PARTIAL | Configured but Connected=false, LoggedIn=false; user confirms disconnected. |
| Webhook dispatch | MISCONFIGURED | Global URL and student/hospital instance URL are identical. Producer sends both independently. Duplicate execution IDs corroborate this. POS instance URL uses n8n DNS across separate networks. |
| Message identity / dedup | MISCONFIGURED | Real field Info.ID; normalizer reads Info.Id and otherwise generates random ID. Process-global Map is not an atomic shared Redis gate. |
| Docker networks/ports/volumes | PARTIAL | Separate app networks; host routing used. Ports 4000/5678/6379 bind all host interfaces. Named volumes exist. No running reverse proxy or production tier networks. |
| Native PostgreSQL | WORKING | Read-only login succeeds on all four business DBs; exact schema/table counts saved. |
| Old Docker PostgreSQL | NOT REQUIRED YET | Stopped legacy container; native PG is active backend. References to it in live tools are nevertheless incorrect. Do not start it as an audit action. |
| Backend SQL safeguards | PARTIAL | DB timeout policies exist. App-role statement_timeout=60s differs from supplied 15s safeguards; gateway roles have only partial role settings. |
| Redis service | WORKING | PONG; persistent volume and AOF configured. |
| Redis workflow integration | MISSING | Named Redis gate uses only globalThis Maps. |
| Groq credential | PARTIAL | Active real credential reference exists; historical model responses and provider quota errors prove prior authentication. Host models request returned HTTP 200 using the active credential. Container request initially timed out; later DNS resolved api.groq.com and host.docker.internal. |
| Groq model and token budget | MISCONFIGURED | Active qwen/qwen3.8-27b with maxTokensToSample=2048; provider errors show ITPM=7000 and OTPM=1000. Agent maxIterations=10; memory window=10. Earlier gpt-oss-120b also hit TPM=8000. |
| BISE retrieval | MISCONFIGURED | Live tool targets stopped evolution-postgres, suppresses errors and returns seed records. Fees hardcoded. Four real results, eight subject rows and four fees exist in native bise_db. |
| POS/Hospital retrieval | MISCONFIGURED | Active gateway returns hardcoded product/doctor/department arrays instead of live queries. Native pos_db has 7 products/prices/inventory rows; hospital_db has 8 doctors and 8 schedules. |
| Business registry/profile integration | PARTIAL | Platform rows exist, but workflow resolves from hardcoded objects, including an unknown-instance fallback to BISE. Stored instance statuses incorrectly show disconnected instances as CONNECTED. |
| Persistent conversation memory | MISSING | Node sets db_persisted=true without SQL. conversations/messages/summaries/session tables contain zero rows. Window memory is process-local. |
| pgvector infrastructure | WORKING | Extension 0.8.6 installed in platform_db. |
| KB ingestion and retrieval | MISSING | knowledge_documents/chunks each contain zero rows; FAISS port 8000 unavailable; workflow falls back to inline text labelled verified. |
| Google Calendar | PARTIAL | OAuth credential records exist, but live tool does not call Google Calendar; it reports availability and attempts wrong postgres DB writes while suppressing failure. OAuth validity was not tested because the workflow does not use it. |
| CRM integration | MISCONFIGURED | Tool targets default postgres DB with non-working source credential and returns success-like status even when persistence fails; domain leads/chat histories are empty. |
| Action gateway / response validation | MISCONFIGURED | Action node synthesizes confirmations without durable transactions. Response guard labels output VERIFIED without database proof. |
| Logs and audit trail | PARTIAL | n8n and Evolution logs available; 63 platform audit rows exist, but workflow action audit uses process memory. Logs include unregistered webhook history, task-runner connection failures, rate limits and outbound DNS errors. |
| Backups / restore assurance | PARTIAL | Sept 30 SQL dumps and 491,565,056-byte n8n SQLite backup exist. Complete current restore has not been demonstrated. New scoped backup required before changes. |
| Reverse proxy/TLS, Python runner, disconnected dev stack | NOT REQUIRED YET | Not required for local student read-only acceptance. Production compose is a specification, not running evidence. |

## Root causes and evidence

1. **Two executions per inbound message:** executions 3004 and 3005 share the same message ID hash and both reach the agent; no retryOf is set. Runtime configuration plus evolution-go/pkg/events/webhook/webhook_producer.go shows global and instance URLs dispatched independently. There is one active workflow, not two active copies.
2. **Token-limit errors:** execution 3004 requests output above OTPM 1000; 3005 exceeds ITPM 7000. Model context length is not the same as account throughput. Duplicates, output budget, prompt size, memory and agent iteration count all contribute.
3. **False retrieval confidence:** a matching seeded answer can be produced when PostgreSQL access fails. Student result accuracy must therefore be proved with actual successful SQL execution and result comparison, including unknown roll numbers and subject details.
4. **Network issues:** active response executions include DNS failure reaching host.docker.internal. Initial service probes timed out then recovered. Container external Groq GET timed out. Connectivity must be rechecked during implementation; no inferred network repair is counted as verified.
5. **Historical tests overstate success:** scripts/test_phase36_e2e_whatsapp.js marks webhook validation PASS inside a catch block and supplies mockDispatch for business tests. They are not evidence of genuine incoming and outgoing WhatsApp delivery.

## Required remediation sequence

AUDIT → DESIGN → BACKUP → IMPLEMENT → TEST → VERIFY → DOCUMENT → PASS? If any gate fails, repair and repeat verification before advancing.

First scope: student-assistant. Remove duplicate dispatch, fix real message ID extraction and shared atomic dedup; choose a supported Groq model with bounded output and reduced context; eliminate BISE seed fallback and use native PostgreSQL read-only queries; verify unknown/invalid rolls and tenant isolation. Keep broader memory, KB, Calendar and CRM gaps explicit rather than silently claiming completion.

The user will send queries from a second WhatsApp account when the workflow is ready. POS and hospital live tests remain pending reconnection. A synthetic webhook test can verify the application path, but is not a substitute for the user's real incoming WhatsApp test.

## External reference checks

- Groq rate limits: https://console.groq.com/docs/rate-limits — exact account limits must come from actual response headers/errors; organization-wide quotas apply.
- Groq model deprecations: https://console.groq.com/docs/deprecations — Llama 3.3 70B and 3.1 8B were retired from free/developer access on 16 August 2026. Do not select the stale local-export model by default.
- n8n installed CLI source confirms publish:workflow requires a restart to affect an already-running service; use supported API where an existing authorized API key is available, otherwise backed-up CLI import/publish and restart.

Audit gate: current state classified; production acceptance NOT PASS. Any inaccessible or unperformed check is explicitly PARTIAL and is not treated as a verified working dependency.
