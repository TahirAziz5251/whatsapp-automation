-- ==============================================================================
-- BIZFLOW AI — PHASE 6: SUBSCRIPTION PLANS, TENANT BILLING & USAGE METERING
-- Target Database: platform_db
-- Applied by: postgres (DB Admin)
-- Runtime Role: bizflow_runtime (NOBYPASSRLS)
-- ==============================================================================

-- 1. PLATFORM SUBSCRIPTION PLANS (Global Catalog)
CREATE TABLE IF NOT EXISTS platform_subscription_plans (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    monthly_price_pkr NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    max_whatsapp_messages INTEGER NOT NULL DEFAULT 1000,
    max_ai_tokens INTEGER NOT NULL DEFAULT 100000,
    max_staff_seats INTEGER NOT NULL DEFAULT 3,
    max_doctors INTEGER NOT NULL DEFAULT 2,
    features JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed Standard SaaS Plans
INSERT INTO platform_subscription_plans (id, name, monthly_price_pkr, max_whatsapp_messages, max_ai_tokens, max_staff_seats, max_doctors, features)
VALUES 
    ('TRIAL', '14-Day Free Pilot', 0.00, 250, 30000, 2, 1, '{"priority_support": false, "sla": "standard", "custom_prompts": true}'::jsonb),
    ('STARTER', 'Starter Business', 5000.00, 1500, 150000, 3, 2, '{"priority_support": false, "sla": "standard", "custom_prompts": true}'::jsonb),
    ('PROFESSIONAL', 'Professional Clinic & Retail', 12000.00, 5000, 500000, 10, 5, '{"priority_support": true, "sla": "99.9%", "custom_prompts": true, "delay_broadcast": true}'::jsonb),
    ('BUSINESS', 'Scale Business & Multi-branch', 25000.00, 15000, 1500000, 25, 15, '{"priority_support": true, "sla": "99.9%", "custom_prompts": true, "delay_broadcast": true, "multi_branch": true}'::jsonb),
    ('ENTERPRISE', 'Hospital & Enterprise Chain', 60000.00, 50000, 5000000, 100, 50, '{"priority_support": true, "sla": "99.95%", "custom_prompts": true, "delay_broadcast": true, "multi_branch": true, "dedicated_instance": true}'::jsonb)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    monthly_price_pkr = EXCLUDED.monthly_price_pkr,
    max_whatsapp_messages = EXCLUDED.max_whatsapp_messages,
    max_ai_tokens = EXCLUDED.max_ai_tokens,
    max_staff_seats = EXCLUDED.max_staff_seats,
    max_doctors = EXCLUDED.max_doctors,
    features = EXCLUDED.features;

GRANT SELECT ON platform_subscription_plans TO bizflow_runtime;


-- 2. TENANT SUBSCRIPTIONS (Tenant Active Entitlement)
CREATE TABLE IF NOT EXISTS tenant_subscriptions (
    tenant_id UUID PRIMARY KEY REFERENCES platform_tenants(id) ON DELETE CASCADE,
    plan_id VARCHAR(50) NOT NULL REFERENCES platform_subscription_plans(id),
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, PAST_DUE, CANCELLED, EXPIRED
    current_period_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    current_period_end TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
    auto_renew BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE tenant_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_subscriptions_isolation_policy ON tenant_subscriptions;
CREATE POLICY tenant_subscriptions_isolation_policy ON tenant_subscriptions
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_subscriptions TO bizflow_runtime;


-- 3. TENANT USAGE RECORDS (Granular Audit & Real-Time Metering)
CREATE TABLE IF NOT EXISTS tenant_usage_records (
    tenant_id UUID NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_name VARCHAR(50) NOT NULL, -- 'WHATSAPP_INBOUND', 'WHATSAPP_OUTBOUND', 'AI_TOKENS', 'BOOKING_CREATED'
    quantity INTEGER NOT NULL DEFAULT 1,
    period_month VARCHAR(7) NOT NULL, -- e.g. '2026-11'
    metadata JSONB DEFAULT '{}'::jsonb,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_usage_lookup 
ON tenant_usage_records(tenant_id, period_month, metric_name);

ALTER TABLE tenant_usage_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_usage_records_isolation_policy ON tenant_usage_records;
CREATE POLICY tenant_usage_records_isolation_policy ON tenant_usage_records
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_usage_records TO bizflow_runtime;


-- 4. CLINIC APPOINTMENTS ENHANCEMENT (Reminder Dispatch Tracking)
ALTER TABLE clinic_appointments 
ADD COLUMN IF NOT EXISTS reminder_24h_sent BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS reminder_24h_sent_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS reminder_2h_sent BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS reminder_2h_sent_at TIMESTAMP WITH TIME ZONE;


-- 5. SEED SUBSCRIPTIONS FOR EXISTING PILOT TENANTS
-- Alpha Clinic -> PROFESSIONAL (5,000 msgs, 500k tokens)
-- Beta Bakery -> STARTER (1,500 msgs, 150k tokens)
INSERT INTO tenant_subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'PROFESSIONAL', 'ACTIVE', NOW(), NOW() + INTERVAL '30 days'),
    ('22222222-2222-2222-2222-222222222222', 'STARTER', 'ACTIVE', NOW(), NOW() + INTERVAL '30 days')
ON CONFLICT (tenant_id) DO UPDATE SET
    plan_id = EXCLUDED.plan_id,
    status = EXCLUDED.status,
    updated_at = NOW();
