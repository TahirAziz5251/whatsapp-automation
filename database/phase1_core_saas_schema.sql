-- ==============================================================================
-- BIZFLOW AI — PHASE 1: CORE SAAS FOUNDATION DATABASE SCHEMA
-- Multi-Tenant Schema with Row-Level Security (RLS) & Tenant Isolation
-- Authoritative System of Record: PostgreSQL 18
-- ==============================================================================

\set ON_ERROR_STOP on

-- 1. Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- ------------------------------------------------------------------------------
-- 2. Business Industry Templates Catalog (The 19 Canonical Templates)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_templates (
    id VARCHAR(50) PRIMARY KEY, -- e.g. 'CLINIC_OPD', 'BEAUTY_SALON', 'GROCERY_STORE'
    name VARCHAR(100) NOT NULL,
    industry_category VARCHAR(50) NOT NULL, -- 'HEALTHCARE', 'RETAIL', 'SERVICE', 'EDUCATION'
    description TEXT,
    default_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    allowed_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed Canonical Templates
INSERT INTO business_templates (id, name, industry_category, description, allowed_tools) VALUES
('CLINIC_OPD', 'Clinic & Hospital OPD Queue', 'HEALTHCARE', 'Doctor appointments, live queue tracking, patient check-in', '["get_doctor_schedule", "book_appointment", "cancel_appointment", "get_queue_status", "check_in_patient", "search_knowledge_base"]'::jsonb),
('BEAUTY_SALON', 'Beauty Salon & Barbershop', 'SERVICE', 'Services, stylist schedules, chairs, appointment bookings', '["search_services", "check_availability", "book_appointment", "reschedule_appointment", "cancel_appointment", "search_knowledge_base"]'::jsonb),
('BAKERY_CAKES', 'Bakery & Cake Business', 'RETAIL', 'Custom cakes, sizes, flavors, advance quotations and pickup', '["search_catalog", "request_quote", "create_order", "track_order", "search_knowledge_base"]'::jsonb),
('RESTAURANT_DELIVERY', 'Restaurant & Food Delivery', 'RETAIL', 'Menu, food modifiers, cart, kitchen dispatch, takeaway/delivery', '["view_menu", "create_cart", "update_cart", "create_order", "track_delivery", "search_knowledge_base"]'::jsonb),
('CLOTHING_BOUTIQUE', 'Clothing Boutique', 'RETAIL', 'Apparel catalog, sizes, colors, variants, order tracking', '["search_products", "check_stock", "create_order", "track_order", "search_knowledge_base"]'::jsonb),
('TUITION_COACHING', 'Tuition & Coaching Center', 'EDUCATION', 'Courses, batches, schedules, fee dues, trial classes', '["get_course_info", "book_trial_class", "get_fees", "search_knowledge_base"]'::jsonb),
('MOBILE_REPAIR', 'Mobile Repair Shop', 'SERVICE', 'Diagnostics, estimates, job tickets, parts warranty tracking', '["get_repair_estimate", "create_job_ticket", "get_ticket_status", "search_knowledge_base"]'::jsonb),
('CAR_WASH', 'Car Wash & Detailing', 'SERVICE', 'Vehicle wash packages, bays, slots, check-in, completion alerts', '["select_package", "book_slot", "check_bay_status", "search_knowledge_base"]'::jsonb),
('SOLAR_CLEANING', 'Solar Cleaning Services', 'SERVICE', 'Panel count, roof type, quotation rules, crew dispatch', '["calculate_quote", "book_inspection", "search_knowledge_base"]'::jsonb),
('GYM_TRAINER', 'Gym & Personal Trainer', 'SERVICE', 'Memberships, class schedules, trainer capacity, trial passes', '["get_plans", "book_trial", "freeze_membership", "search_knowledge_base"]'::jsonb),
('REAL_ESTATE', 'Real Estate Agent', 'SERVICE', 'Property listings, viewing appointments, lead qualification', '["search_properties", "qualify_lead", "book_viewing", "search_knowledge_base"]'::jsonb),
('DENTAL_CLINIC', 'Dental Clinic', 'HEALTHCARE', 'Dentists, procedures, consultation booking, reminders', '["get_dental_services", "book_appointment", "cancel_appointment", "search_knowledge_base"]'::jsonb),
('LAUNDRY_DRY_CLEANING', 'Laundry & Dry Cleaning', 'SERVICE', 'Garment types, pickup/dropoff slots, order tracking', '["schedule_pickup", "track_laundry", "get_pricing", "search_knowledge_base"]'::jsonb),
('PLUMBING_ELECTRICIAN', 'Plumbing & Electrician Services', 'SERVICE', 'Urgency triage, technician dispatch, visit slots', '["classify_urgency", "dispatch_technician", "search_knowledge_base"]'::jsonb),
('EVENT_PLANNER', 'Event Planner & Decorator', 'SERVICE', 'Themes, guest counts, milestones, consultations, quotes', '["get_packages", "book_consultation", "search_knowledge_base"]'::jsonb),
('COMPUTER_REPAIR', 'Computer & Laptop Repair', 'SERVICE', 'Diagnostic tickets, quotations, parts, job status', '["estimate_repair", "create_job_ticket", "get_ticket_status", "search_knowledge_base"]'::jsonb),
('VETERINARY_CLINIC', 'Veterinary Clinic & DVM Pet Care', 'HEALTHCARE', 'DVM doctor profiles, pet profiles, appointments, reminders', '["book_vet_appointment", "get_services", "search_knowledge_base"]'::jsonb),
('PRINTING_STATIONERY', 'Printing & Stationery Shop', 'RETAIL', 'Doc uploads, page counts, binding, finishing, pickup', '["calculate_print_cost", "create_order", "search_knowledge_base"]'::jsonb),
('GROCERY_RETAIL', 'Grocery Store & Retail Grocery', 'RETAIL', 'SKUs, barcodes, unit conversions (kg/g/pack), live stock, cart', '["search_grocery", "create_cart", "update_cart", "checkout_order", "substitute_item", "search_knowledge_base"]'::jsonb)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    industry_category = EXCLUDED.industry_category,
    description = EXCLUDED.description,
    allowed_tools = EXCLUDED.allowed_tools,
    updated_at = NOW();

-- ------------------------------------------------------------------------------
-- 3. Platform Tenants (Master Multi-Tenant Registry)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(50) UNIQUE NOT NULL, -- e.g. 'al-shifa-clinic', 'gourmet-bakery'
    name VARCHAR(255) NOT NULL,
    business_template_id VARCHAR(50) NOT NULL REFERENCES business_templates(id),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'TRIAL', 'SUSPENDED', 'CANCELLED')),
    timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Karachi',
    currency VARCHAR(10) NOT NULL DEFAULT 'PKR',
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for tenant lookup
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON platform_tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_template ON platform_tenants(business_template_id);

-- Seed Default Alpha Clinic Tenant
INSERT INTO platform_tenants (id, slug, name, business_template_id, status, timezone, currency, settings)
VALUES (
    '11111111-1111-1111-1111-111111111111',
    'alpha-clinic',
    'Alpha Heart & Medical Centre',
    'CLINIC_OPD',
    'ACTIVE',
    'Asia/Karachi',
    'PKR',
    '{"bot_name": "Dr. Shifa", "welcome_message": "Assalam-o-Alaikum! Welcome to Alpha Heart & Medical Centre Lahore.", "address": "Plot 45-B, Main Boulevard, Gulberg III, Lahore", "phone": "042-35780000"}'::jsonb
) ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    settings = EXCLUDED.settings,
    updated_at = NOW();

-- ------------------------------------------------------------------------------
-- 4. Platform Users & Memberships (RBAC)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    phone VARCHAR(50),
    is_superuser BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
    role VARCHAR(30) NOT NULL CHECK (role IN ('OWNER', 'MANAGER', 'STAFF', 'DOCTOR', 'AGENT')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_tenant_user_membership UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_tenant ON tenant_memberships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON tenant_memberships(user_id);

-- ------------------------------------------------------------------------------
-- 5. WhatsApp & Communication Channel Connections
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS channel_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
    channel_type VARCHAR(30) NOT NULL CHECK (channel_type IN ('META_CLOUD_API', 'EVOLUTION_GO', 'WEB_CHAT')),
    phone_number_id VARCHAR(100) NOT NULL, -- e.g. WABA phone_number_id or Evolution instance name
    display_phone_number VARCHAR(50) NOT NULL, -- E.164 formatted number e.g. '+923046806644'
    status VARCHAR(20) NOT NULL DEFAULT 'CONNECTED' CHECK (status IN ('CONNECTED', 'DISCONNECTED', 'PENDING_ONBOARDING')),
    webhook_secret_hash VARCHAR(255),
    credentials_encrypted JSONB DEFAULT '{}'::jsonb, -- Secure encrypted provider payload
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_channel_phone UNIQUE (channel_type, phone_number_id)
);

CREATE INDEX IF NOT EXISTS idx_channels_tenant ON channel_connections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_channels_phone ON channel_connections(phone_number_id);

-- ------------------------------------------------------------------------------
-- 6. Multi-Tenant Contacts / Customers Directory (Tenant-Isolated)
-- Notice: customer_phone is UNIQUE per tenant, NOT globally!
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_contacts (
    id UUID DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
    customer_phone VARCHAR(50) NOT NULL, -- Clean digits e.g. '923001234567'
    full_name VARCHAR(100),
    push_name VARCHAR(100),
    email VARCHAR(255),
    tags TEXT[] DEFAULT ARRAY[]::TEXT[],
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT uq_tenant_contact_phone UNIQUE (tenant_id, customer_phone)
);

CREATE INDEX IF NOT EXISTS idx_contacts_tenant_phone ON platform_contacts(tenant_id, customer_phone);

-- ------------------------------------------------------------------------------
-- 7. Conversations & Messages (Tenant-Isolated Communication Store)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_conversations (
    id UUID DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL,
    channel_connection_id UUID NOT NULL REFERENCES channel_connections(id),
    session_key VARCHAR(255) NOT NULL, -- e.g. '{tenant_id}:{customer_phone}'
    status VARCHAR(30) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED_FOR_HUMAN', 'CLOSED', 'ARCHIVED')),
    ai_paused BOOLEAN DEFAULT FALSE,
    assigned_user_id UUID REFERENCES platform_users(id),
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, contact_id) REFERENCES platform_contacts(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_tenant_session UNIQUE (tenant_id, session_key)
);

CREATE INDEX IF NOT EXISTS idx_conv_tenant_status ON tenant_conversations(tenant_id, status);

CREATE TABLE IF NOT EXISTS tenant_messages (
    id UUID DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL,
    provider_message_id VARCHAR(150),
    sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('CUSTOMER', 'AI_AGENT', 'HUMAN_STAFF', 'SYSTEM')),
    message_type VARCHAR(20) NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'document', 'audio', 'interactive', 'location')),
    content TEXT NOT NULL,
    media_url TEXT,
    delivery_status VARCHAR(20) DEFAULT 'SENT' CHECK (delivery_status IN ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED')),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, conversation_id) REFERENCES tenant_conversations(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_msg_tenant_conv ON tenant_messages(tenant_id, conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_provider_id ON tenant_messages(tenant_id, provider_message_id);

-- ------------------------------------------------------------------------------
-- 8. Transactional Outbox Pattern (Guaranteed At-Least-Once Outbound Delivery)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_outbox_messages (
    id UUID DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
    channel_connection_id UUID NOT NULL REFERENCES channel_connections(id),
    recipient_phone VARCHAR(50) NOT NULL,
    message_type VARCHAR(30) NOT NULL DEFAULT 'text',
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'DISPATCHED', 'FAILED', 'DEAD_LETTER')),
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 5,
    next_retry_at TIMESTAMPTZ DEFAULT NOW(),
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending ON tenant_outbox_messages(status, next_retry_at) WHERE status IN ('PENDING', 'PROCESSING');

-- ------------------------------------------------------------------------------
-- 9. Tenant Audit Trail
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_audit_events (
    id UUID DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
    actor_type VARCHAR(30) NOT NULL CHECK (actor_type IN ('USER', 'SYSTEM', 'AI_AGENT', 'CUSTOMER')),
    actor_id VARCHAR(100),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(100),
    details JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_audit_tenant_action ON tenant_audit_events(tenant_id, action, created_at DESC);

-- ==============================================================================
-- 10. ROW-LEVEL SECURITY (RLS) POLICIES
-- Strict Isolation: Tenants can NEVER access records belonging to another tenant!
-- ==============================================================================

-- Enable and FORCE RLS on all tenant-scoped tables
ALTER TABLE platform_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_contacts FORCE ROW LEVEL SECURITY;

ALTER TABLE tenant_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_conversations FORCE ROW LEVEL SECURITY;

ALTER TABLE tenant_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_messages FORCE ROW LEVEL SECURITY;

ALTER TABLE tenant_outbox_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_outbox_messages FORCE ROW LEVEL SECURITY;

ALTER TABLE tenant_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_audit_events FORCE ROW LEVEL SECURITY;

-- Dynamic Tenant Context Policy Function
-- RLS Policy reads session variable: app.current_tenant_id
DROP POLICY IF EXISTS tenant_isolation_contacts ON platform_contacts;
CREATE POLICY tenant_isolation_contacts ON platform_contacts
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_conversations ON tenant_conversations;
CREATE POLICY tenant_isolation_conversations ON tenant_conversations
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_messages ON tenant_messages;
CREATE POLICY tenant_isolation_messages ON tenant_messages
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_outbox ON tenant_outbox_messages;
CREATE POLICY tenant_isolation_outbox ON tenant_outbox_messages
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_audit ON tenant_audit_events;
CREATE POLICY tenant_isolation_audit ON tenant_audit_events
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- ------------------------------------------------------------------------------
-- 11. Dedicated Non-Superuser Runtime Role
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bizflow_runtime') THEN
        CREATE ROLE bizflow_runtime LOGIN PASSWORD 'bizflow_secure_runtime_2026' NOBYPASSRLS;
    ELSE
        ALTER ROLE bizflow_runtime NOBYPASSRLS;
    END IF;
END $$;

-- Grant minimal necessary schema privileges
GRANT USAGE ON SCHEMA public TO bizflow_runtime;
GRANT SELECT ON business_templates TO bizflow_runtime;
GRANT SELECT, INSERT, UPDATE ON platform_tenants TO bizflow_runtime;
GRANT SELECT, INSERT, UPDATE ON platform_users TO bizflow_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_memberships TO bizflow_runtime;
GRANT SELECT, INSERT, UPDATE ON channel_connections TO bizflow_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_contacts TO bizflow_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_conversations TO bizflow_runtime;
GRANT SELECT, INSERT, UPDATE ON tenant_messages TO bizflow_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_outbox_messages TO bizflow_runtime;
GRANT SELECT, INSERT ON tenant_audit_events TO bizflow_runtime;
