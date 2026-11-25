import logging
import uuid
from sqlalchemy import text
from app.core.database import engine

logger = logging.getLogger(__name__)

INIT_SQL = """
-- Extensions (safe when executed by non-superuser runtime role)
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    CREATE EXTENSION IF NOT EXISTS "btree_gist";
EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN NULL;
END $$;

-- 1. Business Templates Catalog
CREATE TABLE IF NOT EXISTS business_templates (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    industry_category VARCHAR(50) NOT NULL,
    description TEXT,
    default_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    allowed_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

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

-- 2. Platform Tenants
CREATE TABLE IF NOT EXISTS platform_tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    business_template_id VARCHAR(50) NOT NULL REFERENCES business_templates(id),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'TRIAL', 'SUSPENDED', 'CANCELLED')),
    timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Karachi',
    currency VARCHAR(10) NOT NULL DEFAULT 'PKR',
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed Primary Tenants
INSERT INTO platform_tenants (id, slug, name, business_template_id, status, timezone, currency, settings)
VALUES
(
    '11111111-1111-1111-1111-111111111111',
    'alpha-clinic',
    'Alpha Heart & Medical Centre',
    'CLINIC_OPD',
    'ACTIVE',
    'Asia/Karachi',
    'PKR',
    '{"bot_name": "Dr. Shifa", "welcome_message": "Assalam-o-Alaikum! Welcome to Alpha Heart & Medical Centre Lahore.", "address": "Plot 45-B, Main Boulevard, Gulberg III, Lahore", "phone": "042-35780000"}'::jsonb
),
(
    '33333333-3333-3333-3333-333333333333',
    'city-dental',
    'City Dental & Orthodontic Care',
    'CLINIC_OPD',
    'ACTIVE',
    'Asia/Karachi',
    'PKR',
    '{"bot_name": "Danto-Bot", "welcome_message": "Assalam-o-Alaikum! Welcome to City Dental Care Karachi.", "address": "Suite 4, Block 5, Clifton, Karachi", "phone": "021-35870000"}'::jsonb
),
(
    '44444444-4444-4444-4444-444444444444',
    'noor-pediatrics',
    'Noor Children & Pediatric Hospital',
    'CLINIC_OPD',
    'ACTIVE',
    'Asia/Karachi',
    'PKR',
    '{"bot_name": "Noor Chacha", "welcome_message": "Khushamdeed! Noor Children Hospital Islamabad mein aapka khair-maqdam hai.", "address": "Fazl-e-Haq Road, Blue Area, Islamabad", "phone": "051-2800000"}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    settings = EXCLUDED.settings,
    updated_at = NOW();

-- 3. Platform Users & Memberships
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

-- 4. Channel Connections
CREATE TABLE IF NOT EXISTS channel_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
    channel_type VARCHAR(30) NOT NULL CHECK (channel_type IN ('META_CLOUD_API', 'EVOLUTION_GO', 'WEB_CHAT')),
    phone_number_id VARCHAR(100) NOT NULL,
    display_phone_number VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'CONNECTED' CHECK (status IN ('CONNECTED', 'DISCONNECTED', 'PENDING_ONBOARDING')),
    webhook_secret_hash VARCHAR(255),
    credentials_encrypted JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_channel_phone UNIQUE (channel_type, phone_number_id)
);

-- Seed Default Evolution Connection
INSERT INTO channel_connections (id, tenant_id, channel_type, phone_number_id, display_phone_number, status)
VALUES
('cccccccc-1111-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'EVOLUTION_GO', 'alpha-clinic', '+923127118485', 'CONNECTED')
ON CONFLICT (channel_type, phone_number_id) DO UPDATE SET
    display_phone_number = EXCLUDED.display_phone_number,
    status = 'CONNECTED';

-- 5. Platform Contacts
CREATE TABLE IF NOT EXISTS platform_contacts (
    id UUID DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
    customer_phone VARCHAR(50) NOT NULL,
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

-- 6. Tenant Conversations & Messages
CREATE TABLE IF NOT EXISTS tenant_conversations (
    id UUID DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL,
    channel_connection_id UUID NOT NULL REFERENCES channel_connections(id),
    session_key VARCHAR(255) NOT NULL,
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

-- 7. Clinic Specific Tables (Phase 4)
CREATE TABLE IF NOT EXISTS clinic_doctors (
    tenant_id UUID NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    specialty VARCHAR(100) NOT NULL,
    qualification VARCHAR(100),
    fee_pkr NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    room_number VARCHAR(30),
    is_active BOOLEAN DEFAULT TRUE,
    is_on_break BOOLEAN DEFAULT FALSE,
    break_reason VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_clinic_doctors_specialty ON clinic_doctors(tenant_id, specialty);

CREATE TABLE IF NOT EXISTS clinic_doctor_schedules (
    tenant_id UUID NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    doctor_id UUID NOT NULL,
    day_of_week VARCHAR(20) NOT NULL CHECK (day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    slot_duration_minutes INT NOT NULL DEFAULT 15,
    max_patients_per_session INT NOT NULL DEFAULT 30,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT fk_clinic_schedule_doctor FOREIGN KEY (tenant_id, doctor_id) REFERENCES clinic_doctors(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS clinic_appointments (
    tenant_id UUID NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    appointment_number VARCHAR(50) NOT NULL,
    contact_id UUID NOT NULL,
    doctor_id UUID NOT NULL,
    appointment_date DATE NOT NULL,
    slot_time TIME NOT NULL,
    symptoms TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'BOOKED' CHECK (status IN ('BOOKED', 'CONFIRMED', 'CHECKED_IN', 'CALLED', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
    queue_token VARCHAR(30) NOT NULL,
    cancellation_reason TEXT,
    notes TEXT,
    reminder_24h_sent BOOLEAN DEFAULT FALSE,
    reminder_24h_sent_at TIMESTAMPTZ,
    reminder_2h_sent BOOLEAN DEFAULT FALSE,
    reminder_2h_sent_at TIMESTAMPTZ,
    consultation_started_at TIMESTAMPTZ,
    consultation_ended_at TIMESTAMPTZ,
    consultation_duration_seconds INT,
    follow_up_task VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT uq_tenant_appointment_num UNIQUE (tenant_id, appointment_number),
    CONSTRAINT fk_clinic_appointment_contact FOREIGN KEY (tenant_id, contact_id) REFERENCES platform_contacts(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_clinic_appointment_doctor FOREIGN KEY (tenant_id, doctor_id) REFERENCES clinic_doctors(tenant_id, id) ON DELETE RESTRICT
);

-- Migrations for existing database
ALTER TABLE clinic_doctors ADD COLUMN IF NOT EXISTS is_on_break BOOLEAN DEFAULT FALSE;
ALTER TABLE clinic_doctors ADD COLUMN IF NOT EXISTS break_reason VARCHAR(255);

ALTER TABLE clinic_appointments ADD COLUMN IF NOT EXISTS reminder_24h_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE clinic_appointments ADD COLUMN IF NOT EXISTS reminder_24h_sent_at TIMESTAMPTZ;
ALTER TABLE clinic_appointments ADD COLUMN IF NOT EXISTS reminder_2h_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE clinic_appointments ADD COLUMN IF NOT EXISTS reminder_2h_sent_at TIMESTAMPTZ;
ALTER TABLE clinic_appointments ADD COLUMN IF NOT EXISTS consultation_started_at TIMESTAMPTZ;
ALTER TABLE clinic_appointments ADD COLUMN IF NOT EXISTS consultation_ended_at TIMESTAMPTZ;
ALTER TABLE clinic_appointments ADD COLUMN IF NOT EXISTS consultation_duration_seconds INT;
ALTER TABLE clinic_appointments ADD COLUMN IF NOT EXISTS follow_up_task VARCHAR(255);

DO $$
BEGIN
    ALTER TABLE clinic_appointments DROP CONSTRAINT IF EXISTS clinic_appointments_status_check;
    ALTER TABLE clinic_appointments ADD CONSTRAINT clinic_appointments_status_check CHECK (status IN ('BOOKED', 'CONFIRMED', 'CHECKED_IN', 'CALLED', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED', 'NO_SHOW'));
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_clinic_appointments_lookup ON clinic_appointments(tenant_id, doctor_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_clinic_appointments_token ON clinic_appointments(tenant_id, queue_token);
CREATE INDEX IF NOT EXISTS idx_clinic_appointments_contact ON clinic_appointments(tenant_id, contact_id);

CREATE TABLE IF NOT EXISTS clinic_live_queues (
    tenant_id UUID NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    doctor_id UUID NOT NULL,
    queue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    current_serving_token VARCHAR(30),
    current_serving_appointment_id UUID,
    total_booked INT DEFAULT 0,
    total_checked_in INT DEFAULT 0,
    total_completed INT DEFAULT 0,
    estimated_wait_minutes_per_patient INT DEFAULT 15,
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'CLOSED')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT uq_tenant_doctor_queue_date UNIQUE (tenant_id, doctor_id, queue_date),
    CONSTRAINT fk_clinic_queue_doctor FOREIGN KEY (tenant_id, doctor_id) REFERENCES clinic_doctors(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_clinic_live_queues_lookup ON clinic_live_queues(tenant_id, doctor_id, queue_date);

-- 8. Subscription & Billing Tables (Phase 6)
CREATE TABLE IF NOT EXISTS subscription_plans (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    price_monthly_pkr NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    included_ai_tokens INT NOT NULL DEFAULT 50000,
    included_whatsapp_conversations INT NOT NULL DEFAULT 200,
    overage_per_token_pkr NUMERIC(10, 4) NOT NULL DEFAULT 0.002,
    overage_per_conversation_pkr NUMERIC(10, 2) NOT NULL DEFAULT 3.00,
    features JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO subscription_plans (id, name, price_monthly_pkr, included_ai_tokens, included_whatsapp_conversations, overage_per_token_pkr, overage_per_conversation_pkr) VALUES
('STARTER', 'Starter Tier', 5000.00, 100000, 500, 0.002, 3.00),
('PROFESSIONAL', 'Professional Tier', 15000.00, 500000, 2500, 0.0015, 2.50),
('ENTERPRISE', 'Enterprise / Hospital Tier', 45000.00, 2000000, 10000, 0.001, 2.00)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    price_monthly_pkr = EXCLUDED.price_monthly_pkr,
    included_ai_tokens = EXCLUDED.included_ai_tokens;

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
    plan_id VARCHAR(50) NOT NULL REFERENCES subscription_plans(id),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'TRIAL', 'PAST_DUE', 'CANCELLED')),
    current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    current_period_end TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_tenant_subscription UNIQUE (tenant_id)
);

INSERT INTO tenant_subscriptions (tenant_id, plan_id, status)
VALUES
('11111111-1111-1111-1111-111111111111', 'PROFESSIONAL', 'ACTIVE'),
('33333333-3333-3333-3333-333333333333', 'STARTER', 'ACTIVE'),
('44444444-4444-4444-4444-444444444444', 'ENTERPRISE', 'ACTIVE')
ON CONFLICT (tenant_id) DO UPDATE SET
    plan_id = EXCLUDED.plan_id,
    status = EXCLUDED.status;

CREATE TABLE IF NOT EXISTS tenant_usage_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
    metric_type VARCHAR(50) NOT NULL CHECK (metric_type IN ('AI_TOKENS', 'WHATSAPP_INBOUND', 'WHATSAPP_OUTBOUND', 'STORAGE_MB', 'API_CALLS')),
    quantity INT NOT NULL DEFAULT 1,
    period_date DATE NOT NULL DEFAULT CURRENT_DATE,
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES platform_tenants(id) ON DELETE CASCADE,
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    billing_period_start DATE NOT NULL,
    billing_period_end DATE NOT NULL,
    base_amount_pkr NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    overage_amount_pkr NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    total_amount_pkr NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    status VARCHAR(20) NOT NULL DEFAULT 'UNPAID' CHECK (status IN ('DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'VOID')),
    paid_at TIMESTAMPTZ,
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Seed Doctors for Alpha Clinic (11111111-1111-1111-1111-111111111111)
SET LOCAL app.current_tenant_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO clinic_doctors (tenant_id, id, name, specialty, qualification, fee_pkr, room_number)
VALUES
('11111111-1111-1111-1111-111111111111', 'dddddddd-1111-0000-0000-000000000001', 'Dr. Tariq Mahmood', 'Cardiology', 'MBBS, FCPS (Cardiology)', 2500.00, 'Room 101'),
('11111111-1111-1111-1111-111111111111', 'dddddddd-1111-0000-0000-000000000002', 'Dr. Ayesha Malik', 'General Medicine', 'MBBS, MRCP', 1800.00, 'Room 102'),
('11111111-1111-1111-1111-111111111111', 'dddddddd-1111-0000-0000-000000000003', 'Dr. Bilal Asghar', 'Pediatrics', 'MBBS, FCPS (Pediatrics)', 2000.00, 'Room 103')
ON CONFLICT (tenant_id, id) DO UPDATE SET
    name = EXCLUDED.name,
    specialty = EXCLUDED.specialty,
    fee_pkr = EXCLUDED.fee_pkr,
    room_number = EXCLUDED.room_number,
    updated_at = NOW();

-- Seed Doctor Schedules
INSERT INTO clinic_doctor_schedules (tenant_id, id, doctor_id, day_of_week, start_time, end_time, slot_duration_minutes, max_patients_per_session)
VALUES
('11111111-1111-1111-1111-111111111111', 'cccccccc-1111-0000-0000-000000000001', 'dddddddd-1111-0000-0000-000000000001', 'Monday', '10:00:00', '14:00:00', 15, 25),
('11111111-1111-1111-1111-111111111111', 'cccccccc-1111-0000-0000-000000000002', 'dddddddd-1111-0000-0000-000000000001', 'Tuesday', '10:00:00', '14:00:00', 15, 25),
('11111111-1111-1111-1111-111111111111', 'cccccccc-1111-0000-0000-000000000003', 'dddddddd-1111-0000-0000-000000000001', 'Wednesday', '10:00:00', '14:00:00', 15, 25),
('11111111-1111-1111-1111-111111111111', 'cccccccc-1111-0000-0000-000000000004', 'dddddddd-1111-0000-0000-000000000001', 'Thursday', '10:00:00', '14:00:00', 15, 25),
('11111111-1111-1111-1111-111111111111', 'cccccccc-1111-0000-0000-000000000005', 'dddddddd-1111-0000-0000-000000000001', 'Friday', '10:00:00', '14:00:00', 15, 25),
('11111111-1111-1111-1111-111111111111', 'cccccccc-1111-0000-0000-000000000006', 'dddddddd-1111-0000-0000-000000000002', 'Monday', '16:00:00', '20:00:00', 15, 30),
('11111111-1111-1111-1111-111111111111', 'cccccccc-1111-0000-0000-000000000007', 'dddddddd-1111-0000-0000-000000000002', 'Wednesday', '16:00:00', '20:00:00', 15, 30),
('11111111-1111-1111-1111-111111111111', 'cccccccc-1111-0000-0000-000000000008', 'dddddddd-1111-0000-0000-000000000002', 'Friday', '16:00:00', '20:00:00', 15, 30),
('11111111-1111-1111-1111-111111111111', 'cccccccc-1111-0000-0000-000000000009', 'dddddddd-1111-0000-0000-000000000003', 'Monday', '18:00:00', '21:00:00', 15, 20)
ON CONFLICT (tenant_id, id) DO UPDATE SET
    day_of_week = EXCLUDED.day_of_week,
    start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time,
    updated_at = NOW();

-- Seed Initial Live Queue for Dr. Tariq today
INSERT INTO clinic_live_queues (tenant_id, id, doctor_id, queue_date, current_serving_token, total_booked, total_checked_in, total_completed, status)
VALUES
('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-1111-0000-0000-000000000001', 'dddddddd-1111-0000-0000-000000000001', CURRENT_DATE, 'T-01', 5, 3, 1, 'ACTIVE')
ON CONFLICT (tenant_id, doctor_id, queue_date) DO UPDATE SET
    current_serving_token = EXCLUDED.current_serving_token,
    status = EXCLUDED.status,
    updated_at = NOW();

RESET app.current_tenant_id;

-- 9b. Knowledge Base Documents & pgvector Chunks
CREATE TABLE IF NOT EXISTS knowledge_documents (
    id BIGSERIAL PRIMARY KEY,
    business_code VARCHAR(64) NOT NULL,
    namespace VARCHAR(64) NOT NULL DEFAULT 'default',
    source VARCHAR(255),
    title VARCHAR(255) NOT NULL,
    doc_type VARCHAR(64) DEFAULT 'POLICY',
    version VARCHAR(32) DEFAULT '1.0',
    status VARCHAR(32) DEFAULT 'ACTIVE',
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id BIGSERIAL PRIMARY KEY,
    document_id BIGINT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    business_code VARCHAR(64) NOT NULL,
    chunk_index INT NOT NULL DEFAULT 0,
    chunk_title VARCHAR(255),
    chunk_text TEXT NOT NULL,
    token_count INT DEFAULT 0,
    embedding vector(384),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Table Privileges & Row-Level Security (RLS) Enforcement (safe if already applied by postgres superuser)
DO $$
DECLARE
    tbl TEXT;
    rls_tables TEXT[] := ARRAY[
        'platform_contacts',
        'tenant_conversations',
        'tenant_messages',
        'tenant_outbox_messages',
        'clinic_doctors',
        'clinic_doctor_schedules',
        'clinic_appointments',
        'clinic_live_queues'
    ];
BEGIN
    FOREACH tbl IN ARRAY rls_tables LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%I ON %I', tbl, tbl);
        EXECUTE format(
            'CREATE POLICY tenant_isolation_%I ON %I FOR ALL USING (tenant_id = (NULLIF(current_setting(''app.current_tenant_id'', true), ''''))::uuid) WITH CHECK (tenant_id = (NULLIF(current_setting(''app.current_tenant_id'', true), ''''))::uuid)',
            tbl, tbl
        );
    END LOOP;
EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    GRANT USAGE ON SCHEMA public TO bizflow_runtime;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO bizflow_runtime;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO bizflow_runtime;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO bizflow_runtime;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO bizflow_runtime;
EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN NULL;
END $$;
"""

def bootstrap_database():
    """Executes database schema setup and initial seeds on application startup."""
    try:
        logger.info("Verifying and bootstrapping platform_db database schema and seeds...")
        with engine.begin() as conn:
            conn.execute(text(INIT_SQL))
            from app.services.ai.embedding_utils import sync_knowledge_base_embeddings
            kb_stats = sync_knowledge_base_embeddings(conn)
            logger.info(f"Knowledge base pgvector sync complete: {kb_stats}")
        logger.info("Database schema and seeds successfully verified and bootstrapped!")
    except Exception as e:
        logger.error(f"Error bootstrapping database schema: {e}", exc_info=True)
