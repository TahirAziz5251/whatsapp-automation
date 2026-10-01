\set ON_ERROR_STOP on

SET search_path TO public;

SELECT
    current_user,
    current_database(),
    current_schema();

SHOW search_path;


-- ============================================================
-- 1. MASTER RECORD COUNTS
-- ============================================================

SELECT '=== 1. MASTER RECORD COUNTS ===' AS section;

SELECT
    (SELECT COUNT(*) FROM public.platform_businesses) AS businesses,
    (SELECT COUNT(*) FROM public.platform_business_profiles) AS business_profiles,
    (SELECT COUNT(*) FROM public.platform_database_mappings) AS database_mappings,
    (SELECT COUNT(*) FROM public.platform_agent_configs) AS agent_configs,
    (SELECT COUNT(*) FROM public.platform_tool_permissions) AS tool_permissions,
    (SELECT COUNT(*) FROM public.platform_whatsapp_instances) AS whatsapp_instances,
    (SELECT COUNT(*) FROM public.platform_action_approvals) AS action_approvals,
    (SELECT COUNT(*) FROM public.platform_workflow_versions) AS workflow_versions,
    (SELECT COUNT(*) FROM public.knowledge_documents) AS knowledge_documents,
    (SELECT COUNT(*) FROM public.knowledge_chunks) AS knowledge_chunks,
    (SELECT COUNT(*) FROM public.conversations) AS conversations,
    (SELECT COUNT(*) FROM public.conversation_messages) AS conversation_messages,
    (SELECT COUNT(*) FROM public.conversation_summary) AS conversation_summaries,
    (SELECT COUNT(*) FROM public.session_metadata) AS sessions,
    (SELECT COUNT(*) FROM public.platform_audit_metadata) AS audit_records;


-- ============================================================
-- 2. BUSINESS CONFIGURATION INTEGRITY
-- ============================================================

SELECT '=== 2. BUSINESS CONFIGURATION INTEGRITY ===' AS section;

SELECT
    COUNT(*) FILTER (WHERE business_code IS NULL) AS null_business_codes,
    COUNT(*) FILTER (WHERE name IS NULL) AS null_business_names,
    COUNT(*) FILTER (WHERE status IS NULL) AS null_business_status
FROM public.platform_businesses;

SELECT
    COUNT(*) FILTER (WHERE business_code IS NULL) AS profiles_without_business,
    COUNT(*) FILTER (WHERE prompt_version IS NULL) AS profiles_without_prompt_version,
    COUNT(*) FILTER (WHERE is_active IS NULL) AS profiles_without_active_flag
FROM public.platform_business_profiles;


-- ============================================================
-- 3. AGENT & TOOL CONFIGURATION
-- ============================================================

SELECT '=== 3. AGENT & TOOL CONFIGURATION ===' AS section;

SELECT
    COUNT(*) FILTER (WHERE business_code IS NULL) AS agent_configs_without_business,
    COUNT(*) FILTER (WHERE model_provider IS NULL) AS null_model_provider,
    COUNT(*) FILTER (WHERE model_name IS NULL) AS null_model_name
FROM public.platform_agent_configs;

SELECT
    COUNT(*) FILTER (WHERE business_code IS NULL) AS permissions_without_business,
    COUNT(*) FILTER (WHERE tool_name IS NULL) AS null_tool_name,
    COUNT(*) FILTER (WHERE is_allowed IS NULL) AS null_allowed_flag,
    COUNT(*) FILTER (WHERE requires_approval IS NULL) AS null_approval_flag
FROM public.platform_tool_permissions;


-- ============================================================
-- 4. WHATSAPP INSTANCE INTEGRITY
-- ============================================================

SELECT '=== 4. WHATSAPP INSTANCE INTEGRITY ===' AS section;

SELECT
    COUNT(*) AS total_instances,
    COUNT(*) FILTER (WHERE business_code IS NULL) AS instances_without_business,
    COUNT(*) FILTER (
        WHERE instance_token IS NULL
           OR BTRIM(instance_token) = ''
    ) AS missing_instance_tokens,
    COUNT(*) FILTER (WHERE phone_number IS NULL) AS missing_phone_numbers,
    COUNT(*) FILTER (WHERE status IS NULL) AS missing_status
FROM public.platform_whatsapp_instances;


-- ============================================================
-- 5. KNOWLEDGE / PGVECTOR INTEGRITY
-- ============================================================

SELECT '=== 5. KNOWLEDGE BASE / PGVECTOR INTEGRITY ===' AS section;

SELECT
    status,
    COUNT(*) AS document_count
FROM public.knowledge_documents
GROUP BY status
ORDER BY document_count DESC;

SELECT
    COUNT(*) AS total_chunks,
    COUNT(embedding) AS chunks_with_embedding,
    COUNT(*) FILTER (
        WHERE embedding IS NULL
    ) AS chunks_without_embedding,
    COUNT(*) FILTER (
        WHERE token_count IS NULL
    ) AS chunks_without_token_count
FROM public.knowledge_chunks;


-- ============================================================
-- 6. CONVERSATION & MEMORY HEALTH
-- ============================================================

SELECT '=== 6. CONVERSATION & MEMORY HEALTH ===' AS section;

SELECT
    status,
    COUNT(*) AS conversation_count
FROM public.conversations
GROUP BY status
ORDER BY conversation_count DESC;

SELECT
    COUNT(*) AS total_messages,
    COUNT(*) FILTER (WHERE conversation_id IS NULL) AS messages_without_conversation,
    COUNT(*) FILTER (WHERE metadata IS NULL) AS messages_without_metadata,
    COUNT(*) FILTER (WHERE is_anonymized IS TRUE) AS anonymized_messages
FROM public.conversation_messages;

SELECT
    COUNT(*) AS total_sessions,
    COUNT(*) FILTER (WHERE business_code IS NULL) AS sessions_without_business,
    COUNT(*) FILTER (WHERE retention_days IS NULL) AS sessions_without_retention,
    COUNT(*) FILTER (WHERE context_state IS NULL) AS sessions_without_context
FROM public.session_metadata;


-- ============================================================
-- 7. ACTION APPROVAL DISTRIBUTION
-- ============================================================

SELECT '=== 7. ACTION APPROVAL DISTRIBUTION ===' AS section;

SELECT
    status,
    COUNT(*) AS approval_count
FROM public.platform_action_approvals
GROUP BY status
ORDER BY approval_count DESC;


-- ============================================================
-- 8. AUDIT METADATA HEALTH
-- ============================================================

SELECT '=== 8. AUDIT METADATA HEALTH ===' AS section;

SELECT
    COUNT(*) AS total_audit_records,
    COUNT(*) FILTER (WHERE business_code IS NULL) AS audits_without_business,
    COUNT(*) FILTER (WHERE processing_time_ms IS NULL) AS missing_processing_time,
    ROUND(AVG(processing_time_ms)::numeric, 2) AS avg_processing_time_ms,
    MAX(processing_time_ms) AS max_processing_time_ms
FROM public.platform_audit_metadata;


-- ============================================================
-- 9. DATABASE MAPPINGS
-- ============================================================

SELECT '=== 9. DATABASE MAPPINGS ===' AS section;

SELECT
    business_code,
    target_db_name,
    COALESCE(target_schema, 'public') AS target_schema
FROM public.platform_database_mappings
ORDER BY business_code;


-- ============================================================
-- 10. DUPLICATE SANITY CHECKS
-- ============================================================

SELECT '=== 10. DUPLICATE SANITY CHECKS ===' AS section;

SELECT business_code, COUNT(*) AS occurrences
FROM public.platform_businesses
GROUP BY business_code
HAVING COUNT(*) > 1;

SELECT business_code, COUNT(*) AS occurrences
FROM public.platform_database_mappings
GROUP BY business_code
HAVING COUNT(*) > 1;

SELECT business_code, COUNT(*) AS occurrences
FROM public.platform_knowledge_mappings
GROUP BY business_code
HAVING COUNT(*) > 1;

SELECT business_code, COUNT(*) AS occurrences
FROM public.platform_agent_configs
GROUP BY business_code
HAVING COUNT(*) > 1;

SELECT instance_name, COUNT(*) AS occurrences
FROM public.platform_whatsapp_instances
GROUP BY instance_name
HAVING COUNT(*) > 1;

SELECT business_code, tool_name, COUNT(*) AS occurrences
FROM public.platform_tool_permissions
GROUP BY business_code, tool_name
HAVING COUNT(*) > 1;

SELECT document_id, chunk_index, COUNT(*) AS occurrences
FROM public.knowledge_chunks
GROUP BY document_id, chunk_index
HAVING COUNT(*) > 1;


-- ============================================================
-- 11. ROLE PERMISSION AUDIT
-- ============================================================

SELECT '=== 11. PLATFORM ROLE PERMISSION AUDIT ===' AS section;

SELECT
    grantee,
    table_name,
    privilege_type
FROM information_schema.role_table_grants
WHERE grantee = current_user
  AND table_schema = 'public'
ORDER BY table_name, privilege_type;