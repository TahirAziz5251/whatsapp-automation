\set ON_ERROR_STOP on

SET search_path TO public;

SELECT
    current_user,
    current_database(),
    current_schema();

SHOW search_path;




-- ==============================================================================
-- Master Control-Plane Database Initialization Script: platform_db
-- Single Canonical DDL & Metadata Seed Script
-- ==============================================================================

-- 1. Businesses Directory (Master Tenant List)
CREATE TABLE IF NOT EXISTS platform_businesses (
    id SERIAL PRIMARY KEY,
    business_code VARCHAR(50) UNIQUE NOT NULL, -- e.g. 'POS_RETAIL', 'BISE_EDU', 'HOSP_HEALTH'
    name VARCHAR(255) NOT NULL,
    industry_type VARCHAR(50) NOT NULL, -- RETAIL, EDUCATION, HEALTHCARE
    status VARCHAR(20) DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. WhatsApp Instances Registry (1 Instance = 1 Business)
CREATE TABLE IF NOT EXISTS platform_whatsapp_instances (
    id SERIAL PRIMARY KEY,
    business_code VARCHAR(50) REFERENCES platform_businesses(business_code) ON DELETE CASCADE,
    instance_name VARCHAR(100) UNIQUE NOT NULL, -- Evolution Instance Name
    instance_token VARCHAR(255) NOT NULL,
    phone_number VARCHAR(50),
    status VARCHAR(20) DEFAULT 'CONNECTED',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Business Profiles & Versioned Prompts
CREATE TABLE IF NOT EXISTS platform_business_profiles (
    id SERIAL PRIMARY KEY,
    business_code VARCHAR(50) REFERENCES platform_businesses(business_code) ON DELETE CASCADE,
    prompt_version VARCHAR(20) DEFAULT 'v1.0',
    role_description TEXT NOT NULL,
    allowed_scope TEXT NOT NULL,
    response_style VARCHAR(100) DEFAULT 'Professional and Courteous',
    behavior_rules JSONB DEFAULT '[]'::jsonb,
    system_prompt TEXT NOT NULL,
    default_language VARCHAR(10) DEFAULT 'en',
    timezone VARCHAR(50) DEFAULT 'Asia/Karachi',
    currency VARCHAR(10) DEFAULT 'PKR',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_business_prompt_version UNIQUE (business_code, prompt_version)
);

-- 4. Database Mappings (Control-Plane ➔ Isolated Private Domain DBs)
CREATE TABLE IF NOT EXISTS platform_database_mappings (
    id SERIAL PRIMARY KEY,
    business_code VARCHAR(50) REFERENCES platform_businesses(business_code) ON DELETE CASCADE,
    target_db_name VARCHAR(100) NOT NULL, -- 'pos_db', 'bise_db', 'hospital_db'
    target_schema VARCHAR(100) DEFAULT 'public',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Knowledge Mappings (RAG Namespaces)
CREATE TABLE IF NOT EXISTS platform_knowledge_mappings (
    id SERIAL PRIMARY KEY,
    business_code VARCHAR(50) REFERENCES platform_businesses(business_code) ON DELETE CASCADE,
    faiss_index_namespace VARCHAR(100) NOT NULL,
    similarity_threshold NUMERIC(3, 2) DEFAULT 0.75,
    top_k INT DEFAULT 3,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Tool Permissions Matrix & Policy Gate
CREATE TABLE IF NOT EXISTS platform_tool_permissions (
    id SERIAL PRIMARY KEY,
    business_code VARCHAR(50) REFERENCES platform_businesses(business_code) ON DELETE CASCADE,
    tool_name VARCHAR(100) NOT NULL,
    action_type VARCHAR(20) DEFAULT 'READ', -- 'READ', 'WRITE', 'ADMIN'
    min_identity_level VARCHAR(20) DEFAULT 'ANONYMOUS', -- 'ANONYMOUS', 'VERIFIED_USER', 'STAFF', 'ADMIN'
    requires_approval BOOLEAN DEFAULT FALSE,
    is_allowed BOOLEAN DEFAULT TRUE,
    access_level VARCHAR(30) DEFAULT 'FULL',
    resource_target VARCHAR(100) DEFAULT 'general',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_business_tool UNIQUE (business_code, tool_name)
);

-- 7. Agent Model Configurations
CREATE TABLE IF NOT EXISTS platform_agent_configs (
    id SERIAL PRIMARY KEY,
    business_code VARCHAR(50) REFERENCES platform_businesses(business_code) ON DELETE CASCADE,
    model_provider VARCHAR(50) DEFAULT 'Groq',
    model_name VARCHAR(100) DEFAULT 'llama-3.3-70b-versatile',
    temperature NUMERIC(3, 2) DEFAULT 0.3,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Persistent Session Metadata (Business-Aware Sessions & State Persistence)
CREATE TABLE IF NOT EXISTS session_metadata (
    session_key VARCHAR(255) PRIMARY KEY, -- e.g. 'POS_RETAIL:pos-instance:923001234567'
    business_code VARCHAR(50) REFERENCES platform_businesses(business_code) ON DELETE CASCADE,
    user_id VARCHAR(50) NOT NULL,
    customer_phone VARCHAR(50),
    current_intent VARCHAR(100) DEFAULT 'GENERAL',
    context_state JSONB DEFAULT '{}'::jsonb,
    retention_days INT DEFAULT 90,
    last_sync_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- View for Backward Compatibility
CREATE OR REPLACE VIEW platform_session_metadata AS SELECT * FROM session_metadata;

-- 9. Workflow Versions
CREATE TABLE IF NOT EXISTS platform_workflow_versions (
    id SERIAL PRIMARY KEY,
    version_tag VARCHAR(50) NOT NULL,
    n8n_workflow_id VARCHAR(100) NOT NULL,
    deployed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 10. Audit Metadata
CREATE TABLE IF NOT EXISTS platform_audit_metadata (
    id SERIAL PRIMARY KEY,
    business_code VARCHAR(50) REFERENCES platform_businesses(business_code) ON DELETE CASCADE,
    instance_name VARCHAR(100) NOT NULL,
    customer_phone VARCHAR(50) NOT NULL,
    inbound_payload JSONB,
    outbound_payload JSONB,
    processing_time_ms INT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 11. Conversations Master Directory
CREATE TABLE IF NOT EXISTS conversations (
    conversation_id VARCHAR(255) PRIMARY KEY,
    session_key VARCHAR(255) NOT NULL,
    business_code VARCHAR(50) REFERENCES platform_businesses(business_code) ON DELETE CASCADE,
    instance_name VARCHAR(100) NOT NULL,
    user_id VARCHAR(50) NOT NULL,
    customer_phone VARCHAR(50) NOT NULL,
    push_name VARCHAR(100),
    status VARCHAR(30) DEFAULT 'ACTIVE',
    message_count INT DEFAULT 1,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_active_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP WITH TIME ZONE
);

-- 12. Durable Conversation Messages Archive
CREATE TABLE IF NOT EXISTS conversation_messages (
    id BIGSERIAL PRIMARY KEY,
    conversation_id VARCHAR(255) REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    message_id VARCHAR(100) NOT NULL,
    sender_type VARCHAR(20) NOT NULL,
    sender_phone VARCHAR(50),
    message_text TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    is_anonymized BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 13. Conversation Summary Table
CREATE TABLE IF NOT EXISTS conversation_summary (
    id SERIAL PRIMARY KEY,
    conversation_id VARCHAR(255) REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    summary_text TEXT NOT NULL,
    key_intents JSONB DEFAULT '[]'::jsonb,
    action_items JSONB DEFAULT '[]'::jsonb,
    sentiment VARCHAR(30) DEFAULT 'NEUTRAL',
    last_message_id VARCHAR(100),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 14. Canonical Multi-Tenant Knowledge Base & Isolation Schema (Phase 22)
CREATE EXTENSION IF NOT EXISTS vector;

-- Master Document Catalog with Business Scope
CREATE TABLE IF NOT EXISTS knowledge_documents (
    id BIGSERIAL PRIMARY KEY,
    business_code VARCHAR(50) NOT NULL REFERENCES platform_businesses(business_code) ON DELETE CASCADE,
    namespace VARCHAR(100) NOT NULL DEFAULT 'default',
    source VARCHAR(100) NOT NULL DEFAULT 'manual', -- 'manual', 'catalog', 'faq', 'policy_doc'
    title VARCHAR(255) NOT NULL,
    doc_type VARCHAR(50) NOT NULL DEFAULT 'FAQ', -- 'FAQ', 'POLICY', 'SPECIFICATION', 'GUIDELINE'
    version VARCHAR(20) NOT NULL DEFAULT 'v1.0',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'ARCHIVED', 'DRAFT'
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_kdoc_business_title_version UNIQUE (business_code, title, version)
);

-- Chunked Vector Embeddings with Hard Multi-Tenant Isolation
CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id BIGSERIAL PRIMARY KEY,
    document_id BIGINT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    business_code VARCHAR(50) NOT NULL REFERENCES platform_businesses(business_code) ON DELETE CASCADE,
    chunk_index INT NOT NULL DEFAULT 0,
    chunk_title VARCHAR(255),
    chunk_text TEXT NOT NULL,
    token_count INT DEFAULT 0,
    embedding vector(384),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_kchunk_doc_index UNIQUE (document_id, chunk_index)
);

-- Retrieval & Boundary Isolation Indexes
CREATE INDEX IF NOT EXISTS idx_kdoc_bcode_status ON knowledge_documents(business_code, status);
CREATE INDEX IF NOT EXISTS idx_kdoc_namespace ON knowledge_documents(namespace);
CREATE INDEX IF NOT EXISTS idx_kchunk_doc ON knowledge_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_kchunk_bcode ON knowledge_chunks(business_code);
CREATE INDEX IF NOT EXISTS idx_kchunk_embedding_hnsw ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_kchunk_fts ON knowledge_chunks USING gin (to_tsvector('english', chunk_text));
CREATE INDEX IF NOT EXISTS idx_kchunk_fts_combined ON knowledge_chunks USING gin (to_tsvector('english', COALESCE(chunk_title, '') || ' ' || chunk_text));



-- SEED CONTROL-PLANE METADATA FOR INITIAL 3 VERTICALS
INSERT INTO platform_businesses (business_code, name, industry_type)
VALUES 
    ('POS_RETAIL', 'GlimsTech POS Retail Automation', 'RETAIL'),
    ('BISE_EDU', 'BISE Educational Board System', 'EDUCATION'),
    ('HOSP_HEALTH', 'City Healthcare & Hospital System', 'HEALTHCARE')
ON CONFLICT (business_code) DO NOTHING;

INSERT INTO platform_whatsapp_instances (business_code, instance_name, instance_token)
VALUES 
    ('POS_RETAIL', 'pos-instance', 'pos_token_12345'),
    ('BISE_EDU', 'bise-instance', 'bise_token_12345'),
    ('HOSP_HEALTH', 'hospital-instance', 'hosp_token_12345')
ON CONFLICT (instance_name) DO NOTHING;

INSERT INTO platform_business_profiles (business_code, prompt_version, role_description, allowed_scope, response_style, behavior_rules, system_prompt, default_language, timezone, currency, is_active)
VALUES 
    (
        'POS_RETAIL', 
        'v1.0',
        'Senior Retail POS & Hardware Automation Advisor',
        'Retail POS billing software, thermal receipt printers, barcode scanners, cash drawers, stock management, PKR price quotations, and demo bookings.',
        'Consultative, energetic, commercial, dynamic with retail emojis.',
        '["Always quote prices in PKR", "Recommend hardware bundles for new retail setups", "Encourage booking a software demo"]'::jsonb,
        'You represent GlimsTech POS Retail Automation. Provide expert guidance on retail POS hardware, software bundles, and inventory setups. Quote prices in PKR and guide qualified leads to schedule a demo.',
        'en', 
        'Asia/Karachi', 
        'PKR',
        true
    ),
    (
        'BISE_EDU', 
        'v1.0',
        'Official Academic Examination Controller & Student Helpdesk Assistant',
        'Matric & Intermediate annual and supplementary examination results, roll number verification, examination date sheets, migration certificates, and board policies.',
        'Formal, authoritative, clear, and reassuring with academic emojis.',
        '["Require 6-digit roll number for result lookup", "Never speculate marks or grades", "Advise visiting board office for duplicate certificates"]'::jsonb,
        'You represent BISE Educational Board System. Help students check exam results by Roll Number and view exam date sheets. Maintain academic rigor, accuracy, and official board tone.',
        'en', 
        'Asia/Karachi', 
        'PKR',
        true
    ),
    (
        'HOSP_HEALTH', 
        'v1.0',
        'Hospital Patient Care & Clinical OPD Appointment Coordinator',
        'Doctor directories by clinical specialty, OPD clinic timings, consultation fee inquiries in PKR, and clinical appointment bookings.',
        'Empathetic, polite, cautious, patient-centric with healthcare emojis.',
        '["STRICT: NEVER provide medical diagnosis, clinical advice, or prescribe medicine", "Direct emergencies immediately to 24/7 Emergency Wing", "Confirm doctor availability before appointment reservation"]'::jsonb,
        'You represent City Healthcare & Hospital System. Assist patients with OPD doctor directory lookup, clinical schedules, consultation fees in PKR, and booking appointments. STRICTLY NEVER PROVIDE MEDICAL DIAGNOSIS OR DRUG PRESCRIPTIONS.',
        'en', 
        'Asia/Karachi', 
        'PKR',
        true
    )
ON CONFLICT (business_code, prompt_version) DO UPDATE SET
    role_description = EXCLUDED.role_description,
    allowed_scope = EXCLUDED.allowed_scope,
    response_style = EXCLUDED.response_style,
    behavior_rules = EXCLUDED.behavior_rules,
    system_prompt = EXCLUDED.system_prompt,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_database_mappings (business_code, target_db_name, target_schema)
VALUES 
    ('POS_RETAIL', 'pos_db', 'public'),
    ('BISE_EDU', 'bise_db', 'public'),
    ('HOSP_HEALTH', 'hospital_db', 'public')
ON CONFLICT DO NOTHING;

INSERT INTO platform_knowledge_mappings (business_code, faiss_index_namespace, similarity_threshold, top_k)
VALUES 
    ('POS_RETAIL', 'pos_collection', 0.75, 3),
    ('BISE_EDU', 'bise_collection', 0.80, 3),
    ('HOSP_HEALTH', 'hosp_collection', 0.75, 3)
ON CONFLICT DO NOTHING;

INSERT INTO platform_tool_permissions (business_code, tool_name, action_type, min_identity_level, requires_approval, is_allowed, access_level, resource_target)
VALUES 
    -- POS RETAIL: KB (Read), CRM (Write), Data Gateway (Read pos_db), Structured SQL Tools (get_product, check_inventory, get_price)
    ('POS_RETAIL', 'search_knowledge_base', 'READ', 'ANONYMOUS', false, true, 'FULL', 'postgres:platform_db.knowledge_chunks'),
    ('POS_RETAIL', 'sync_crm', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'postgres:leads'),
    ('POS_RETAIL', 'query_business_data', 'READ', 'ANONYMOUS', false, true, 'FULL', 'postgres:pos_db'),
    ('POS_RETAIL', 'get_product', 'READ', 'ANONYMOUS', false, true, 'FULL', 'postgres:pos_db.products'),
    ('POS_RETAIL', 'check_inventory', 'READ', 'ANONYMOUS', false, true, 'FULL', 'postgres:pos_db.inventory'),
    ('POS_RETAIL', 'get_price', 'READ', 'ANONYMOUS', false, true, 'FULL', 'postgres:pos_db.prices'),
    ('POS_RETAIL', 'manage_calendar', 'WRITE', 'STAFF', true, false, 'DENIED', 'calendar:events'),
    ('POS_RETAIL', 'check_exam_results', 'READ', 'STAFF', true, false, 'DENIED', 'bise:results'),
    ('POS_RETAIL', 'get_student_result', 'READ', 'STAFF', true, false, 'DENIED', 'postgres:bise_db.results'),
    ('POS_RETAIL', 'get_doctor_schedule', 'READ', 'STAFF', true, false, 'DENIED', 'postgres:hospital_db.schedules'),

    -- BISE EDUCATION: KB (Read), Results (Read), Data Gateway (Read bise_db), Structured SQL Tools (get_student_result, get_fees)
    ('BISE_EDU', 'search_knowledge_base', 'READ', 'ANONYMOUS', false, true, 'FULL', 'postgres:platform_db.knowledge_chunks'),
    ('BISE_EDU', 'check_exam_results', 'READ', 'ANONYMOUS', false, true, 'FULL', 'postgres:bise_results'),
    ('BISE_EDU', 'query_business_data', 'READ', 'ANONYMOUS', false, true, 'FULL', 'postgres:bise_db'),
    ('BISE_EDU', 'get_student_result', 'READ', 'ANONYMOUS', false, true, 'FULL', 'postgres:bise_db.results'),
    ('BISE_EDU', 'get_fees', 'READ', 'ANONYMOUS', false, true, 'FULL', 'postgres:bise_db.fees'),
    ('BISE_EDU', 'sync_crm', 'WRITE', 'STAFF', true, false, 'DENIED', 'postgres:leads'),
    ('BISE_EDU', 'manage_calendar', 'WRITE', 'STAFF', true, false, 'DENIED', 'calendar:events'),
    ('BISE_EDU', 'get_product', 'READ', 'STAFF', true, false, 'DENIED', 'postgres:pos_db.products'),
    ('BISE_EDU', 'check_inventory', 'READ', 'STAFF', true, false, 'DENIED', 'postgres:pos_db.inventory'),
    ('BISE_EDU', 'get_price', 'READ', 'STAFF', true, false, 'DENIED', 'postgres:pos_db.prices'),
    ('BISE_EDU', 'get_doctor_schedule', 'READ', 'STAFF', true, false, 'DENIED', 'postgres:hospital_db.schedules'),

    -- HOSPITAL HEALTHCARE: KB (Read), Calendar (Write), Data Gateway (Read hospital_db), Structured SQL Tools (get_doctor_schedule, get_doctors_by_specialty, get_departments)
    ('HOSP_HEALTH', 'search_knowledge_base', 'READ', 'ANONYMOUS', false, true, 'FULL', 'postgres:platform_db.knowledge_chunks'),
    ('HOSP_HEALTH', 'manage_calendar', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'postgres:hospital_appointments'),
    ('HOSP_HEALTH', 'query_business_data', 'READ', 'ANONYMOUS', false, true, 'FULL', 'postgres:hospital_db'),
    ('HOSP_HEALTH', 'get_doctor_schedule', 'READ', 'ANONYMOUS', false, true, 'FULL', 'postgres:hospital_db.schedules'),
    ('HOSP_HEALTH', 'get_doctors_by_specialty', 'READ', 'ANONYMOUS', false, true, 'FULL', 'postgres:hospital_db.doctors'),
    ('HOSP_HEALTH', 'get_departments', 'READ', 'ANONYMOUS', false, true, 'FULL', 'postgres:hospital_db.departments'),
    ('HOSP_HEALTH', 'sync_crm', 'WRITE', 'STAFF', true, false, 'DENIED', 'postgres:leads'),
    ('HOSP_HEALTH', 'check_exam_results', 'READ', 'STAFF', true, false, 'DENIED', 'bise:results'),
    ('HOSP_HEALTH', 'get_product', 'READ', 'STAFF', true, false, 'DENIED', 'postgres:pos_db.products'),
    ('HOSP_HEALTH', 'check_inventory', 'READ', 'STAFF', true, false, 'DENIED', 'postgres:pos_db.inventory'),
    ('HOSP_HEALTH', 'get_price', 'READ', 'STAFF', true, false, 'DENIED', 'postgres:pos_db.prices'),
    ('HOSP_HEALTH', 'get_student_result', 'READ', 'STAFF', true, false, 'DENIED', 'postgres:bise_db.results')
ON CONFLICT (business_code, tool_name) DO UPDATE SET
    action_type = EXCLUDED.action_type,
    min_identity_level = EXCLUDED.min_identity_level,
    requires_approval = EXCLUDED.requires_approval,
    is_allowed = EXCLUDED.is_allowed,
    access_level = EXCLUDED.access_level,
    resource_target = EXCLUDED.resource_target;

INSERT INTO platform_agent_configs (business_code, model_provider, model_name, temperature)
VALUES 
    ('POS_RETAIL', 'Groq', 'llama-3.3-70b-versatile', 0.3),
    ('BISE_EDU', 'Groq', 'llama-3.3-70b-versatile', 0.2),
    ('HOSP_HEALTH', 'Groq', 'llama-3.3-70b-versatile', 0.2)
ON CONFLICT DO NOTHING;

-- Indices for High Performance Control-Plane Lookups
CREATE INDEX IF NOT EXISTS idx_pw_instance_name ON platform_whatsapp_instances(instance_name);
CREATE INDEX IF NOT EXISTS idx_pdm_bcode ON platform_database_mappings(business_code);
CREATE INDEX IF NOT EXISTS idx_ptp_bcode_tool ON platform_tool_permissions(business_code, tool_name);
CREATE INDEX IF NOT EXISTS idx_psm_phone ON session_metadata(customer_phone);
CREATE INDEX IF NOT EXISTS idx_pam_bcode_created ON platform_audit_metadata(business_code, created_at);

-- Least-Privilege Role for Secure Structured SQL Reads (Phase 20)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'gateway_readonly') THEN
        CREATE ROLE gateway_readonly WITH LOGIN PASSWORD 'gateway_secure_readonly_2026' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
END
$$;

GRANT CONNECT ON DATABASE platform_db TO gateway_readonly;
GRANT USAGE ON SCHEMA public TO gateway_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO gateway_readonly;
GRANT SELECT ON knowledge_documents, knowledge_chunks TO gateway_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO gateway_readonly;
GRANT INSERT, SELECT ON platform_audit_metadata TO gateway_readonly;
GRANT USAGE, SELECT ON SEQUENCE platform_audit_metadata_id_seq TO gateway_readonly;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM gateway_readonly;
REVOKE CREATE ON SCHEMA public FROM gateway_readonly;

-- Least-Privilege Role for State-Changing Action Gateway Writes (Phase 27)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'gateway_action_writer') THEN
        CREATE ROLE gateway_action_writer WITH LOGIN PASSWORD 'gateway_action_writer_2026' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
END
$$;

-- 14. Action Approval Requests (Phase 29 Human Approval Controls)
CREATE TABLE IF NOT EXISTS platform_action_approvals (
    id SERIAL PRIMARY KEY,
    approval_token VARCHAR(64) UNIQUE NOT NULL,
    business_code VARCHAR(50) NOT NULL REFERENCES platform_businesses(business_code),
    action VARCHAR(100) NOT NULL,
    requester_phone VARCHAR(50) NOT NULL,
    requester_name VARCHAR(100),
    action_payload JSONB NOT NULL,
    status VARCHAR(30) DEFAULT 'PENDING_APPROVAL',
    reason TEXT,
    approver_id VARCHAR(100),
    approver_notes TEXT,
    approved_at TIMESTAMP WITH TIME ZONE,
    executed_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours'),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_paa_token ON platform_action_approvals(approval_token);
CREATE INDEX IF NOT EXISTS idx_paa_status ON platform_action_approvals(status);
CREATE INDEX IF NOT EXISTS idx_paa_bcode ON platform_action_approvals(business_code);

GRANT CONNECT ON DATABASE platform_db TO gateway_action_writer;
GRANT USAGE ON SCHEMA public TO gateway_action_writer;
GRANT INSERT, SELECT ON platform_audit_metadata TO gateway_action_writer;
GRANT USAGE, SELECT ON SEQUENCE platform_audit_metadata_id_seq TO gateway_action_writer;
GRANT SELECT, INSERT, UPDATE ON platform_action_approvals TO gateway_action_writer;
GRANT USAGE, SELECT ON SEQUENCE platform_action_approvals_id_seq TO gateway_action_writer;
GRANT SELECT ON platform_tool_permissions, platform_businesses TO gateway_action_writer;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM gateway_action_writer;
REVOKE CREATE ON SCHEMA public FROM gateway_action_writer;

-- Seed Action Gateway Tool Permissions (Phase 27 & 29)
INSERT INTO platform_tool_permissions (business_code, tool_name, action_type, min_identity_level, requires_approval, is_allowed, access_level, resource_target)
VALUES 
    -- POS RETAIL Action Permissions
    ('POS_RETAIL', 'action_gateway', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'gateway:actions'),
    ('POS_RETAIL', 'create_order', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'postgres:pos_db.orders'),
    ('POS_RETAIL', 'update_order', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'postgres:pos_db.orders'),
    ('POS_RETAIL', 'cancel_order', 'WRITE', 'ANONYMOUS', true, true, 'FULL', 'postgres:pos_db.orders'),
    ('POS_RETAIL', 'record_payment', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'postgres:pos_db.payments'),
    ('POS_RETAIL', 'sync_crm', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'postgres:pos_db.leads'),
    ('POS_RETAIL', 'approve_action', 'WRITE', 'SUPERVISOR', false, true, 'FULL', 'gateway:approval'),
    ('POS_RETAIL', 'reject_action', 'WRITE', 'SUPERVISOR', false, true, 'FULL', 'gateway:approval'),
    ('POS_RETAIL', 'execute_approved_action', 'WRITE', 'SUPERVISOR', false, true, 'FULL', 'gateway:approval'),

    -- BISE EDUCATION Action Permissions (Immutable results, no orders or clinical appointments)
    ('BISE_EDU', 'action_gateway', 'WRITE', 'ANONYMOUS', false, true, 'SCOPED', 'gateway:actions'),
    ('BISE_EDU', 'submit_verification_request', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'postgres:bise_db.verification_requests'),
    ('BISE_EDU', 'submit_service_application', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'postgres:bise_db.applications'),
    ('BISE_EDU', 'track_service_application', 'READ', 'ANONYMOUS', false, true, 'FULL', 'postgres:bise_db.applications'),
    ('BISE_EDU', 'approve_action', 'WRITE', 'SUPERVISOR', false, true, 'FULL', 'gateway:approval'),
    ('BISE_EDU', 'reject_action', 'WRITE', 'SUPERVISOR', false, true, 'FULL', 'gateway:approval'),
    ('BISE_EDU', 'execute_approved_action', 'WRITE', 'SUPERVISOR', false, true, 'FULL', 'gateway:approval'),

    -- HOSPITAL HEALTHCARE Action Permissions
    ('HOSP_HEALTH', 'action_gateway', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'gateway:actions'),
    ('HOSP_HEALTH', 'create_appointment', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'postgres:hospital_db.appointments'),
    ('HOSP_HEALTH', 'book_appointment', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'postgres:hospital_db.appointments'),
    ('HOSP_HEALTH', 'reschedule_appointment', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'postgres:hospital_db.appointments'),
    ('HOSP_HEALTH', 'cancel_appointment', 'WRITE', 'ANONYMOUS', true, true, 'FULL', 'postgres:hospital_db.appointments'),
    ('HOSP_HEALTH', 'manage_calendar', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'calendar:google'),
    ('HOSP_HEALTH', 'approve_action', 'WRITE', 'SUPERVISOR', false, true, 'FULL', 'gateway:approval'),
    ('HOSP_HEALTH', 'reject_action', 'WRITE', 'SUPERVISOR', false, true, 'FULL', 'gateway:approval'),
    ('HOSP_HEALTH', 'execute_approved_action', 'WRITE', 'SUPERVISOR', false, true, 'FULL', 'gateway:approval')
ON CONFLICT (business_code, tool_name) DO UPDATE SET
    action_type = EXCLUDED.action_type,
    min_identity_level = EXCLUDED.min_identity_level,
    requires_approval = EXCLUDED.requires_approval,
    is_allowed = EXCLUDED.is_allowed,
    access_level = EXCLUDED.access_level,
    resource_target = EXCLUDED.resource_target;



