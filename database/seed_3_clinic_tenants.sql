-- ==============================================================================
-- BIZFLOW AI — MULTI-TENANT TEST SEED: 3 DISTINCT CLINICS ON SHARED CLINIC_OPD
-- Demonstrates: Identical template engine with 100% tenant-isolated identity,
-- doctors, channels, pricing, live queues, knowledge base, and subscriptions.
-- ==============================================================================

-- 1. UPDATE ALPHA CLINIC (Tenant 1: Cardiology & General Medicine - Lahore)
UPDATE platform_tenants
SET name = 'Alpha Heart & Medical Centre',
    settings = '{
        "bot_name": "Dr. Shifa",
        "welcome_message": "Assalam-o-Alaikum! Welcome to Alpha Heart & Medical Centre Lahore. Main appointment booking aur doctor timings mein madad kar sakti hoon.",
        "address": "Plot 45-B, Main Boulevard, Gulberg III, Lahore",
        "phone": "042-35780000",
        "specialty_focus": "Cardiology & Internal Medicine"
    }'::jsonb
WHERE id = '11111111-1111-1111-1111-111111111111';


-- 2. INSERT CITY DENTAL CARE (Tenant 2: Dentistry & Orthodontics - Karachi)
INSERT INTO platform_tenants (id, slug, name, business_template_id, status, timezone, currency, settings)
VALUES (
    '33333333-3333-3333-3333-333333333333',
    'city-dental',
    'City Dental & Orthodontic Care',
    'CLINIC_OPD',
    'ACTIVE',
    'Asia/Karachi',
    'PKR',
    '{
        "bot_name": "Danto-Bot",
        "welcome_message": "Assalam-o-Alaikum! Welcome to City Dental Care Karachi. Aap scaling, braces, ya root canal ki appointment book kar sakte hain.",
        "address": "Suite 4, Block 5, Clifton, Karachi",
        "phone": "021-35870000",
        "specialty_focus": "Dentistry & Orthodontics"
    }'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    settings = EXCLUDED.settings;

-- Channel for City Dental
INSERT INTO channel_connections (id, tenant_id, channel_type, phone_number_id, display_phone_number, status)
VALUES (
    'cccccccc-3333-0000-0000-000000000001',
    '33333333-3333-3333-3333-333333333333',
    'EVOLUTION_GO',
    'dental-assistant',
    '+923001112233',
    'CONNECTED'
)
ON CONFLICT (channel_type, phone_number_id) DO NOTHING;

-- Doctors for City Dental
INSERT INTO clinic_doctors (id, tenant_id, name, specialty, qualification, room_number, fee_pkr, is_active)
VALUES
    ('dddddddd-3333-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Dr. Sarah Zubair', 'Orthodontics', 'BDS, FCPS (Orthodontics)', 'Room D1', 2000.00, TRUE),
    ('dddddddd-3333-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'Dr. Kamran Ali', 'Oral Surgery', 'BDS, MDS (Oral & Maxillofacial)', 'Room D2', 2200.00, TRUE)
ON CONFLICT (tenant_id, id) DO NOTHING;

-- Schedules for City Dental
INSERT INTO clinic_doctor_schedules (id, tenant_id, doctor_id, day_of_week, start_time, end_time, slot_duration_minutes, max_patients_per_session)
VALUES
    ('55555555-3333-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'dddddddd-3333-0000-0000-000000000001', 'Monday', '09:00:00', '14:00:00', 20, 20),
    ('55555555-3333-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'dddddddd-3333-0000-0000-000000000002', 'Monday', '14:00:00', '19:00:00', 15, 25)
ON CONFLICT (tenant_id, id) DO NOTHING;

-- Subscription for City Dental (STARTER)
INSERT INTO tenant_subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end)
VALUES (
    '33333333-3333-3333-3333-333333333333',
    'STARTER',
    'ACTIVE',
    NOW(),
    NOW() + INTERVAL '30 days'
)
ON CONFLICT (tenant_id) DO UPDATE SET plan_id = 'STARTER';


-- 3. INSERT NOOR CHILDREN HOSPITAL (Tenant 3: Pediatrics & Child Health - Islamabad)
INSERT INTO platform_tenants (id, slug, name, business_template_id, status, timezone, currency, settings)
VALUES (
    '44444444-4444-4444-4444-444444444444',
    'noor-pediatrics',
    'Noor Children & Pediatric Hospital',
    'CLINIC_OPD',
    'ACTIVE',
    'Asia/Karachi',
    'PKR',
    '{
        "bot_name": "Noor Chacha",
        "welcome_message": "Khushamdeed! Noor Children Hospital Islamabad mein aapka khair-maqdam hai. Bachon ki vaccination aur pediatric checkups ke liye guidance lein.",
        "address": "Fazl-e-Haq Road, Blue Area, Islamabad",
        "phone": "051-2800000",
        "specialty_focus": "Pediatrics & Child Health"
    }'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    settings = EXCLUDED.settings;

-- Channel for Noor Children Hospital
INSERT INTO channel_connections (id, tenant_id, channel_type, phone_number_id, display_phone_number, status)
VALUES (
    'cccccccc-4444-0000-0000-000000000001',
    '44444444-4444-4444-4444-444444444444',
    'EVOLUTION_GO',
    'pediatric-assistant',
    '+923219988771',
    'CONNECTED'
)
ON CONFLICT (channel_type, phone_number_id) DO NOTHING;

-- Doctors for Noor Children Hospital
INSERT INTO clinic_doctors (id, tenant_id, name, specialty, qualification, room_number, fee_pkr, is_active)
VALUES
    ('dddddddd-4444-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'Dr. Farhan Qureshi', 'Pediatrics', 'MBBS, FCPS (Pediatrics)', 'Room P1', 2500.00, TRUE),
    ('dddddddd-4444-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'Dr. Hina Tahir', 'Child Nutrition', 'MBBS, MSc Clinical Nutrition', 'Room P2', 1800.00, TRUE)
ON CONFLICT (tenant_id, id) DO NOTHING;

-- Schedules for Noor Children Hospital
INSERT INTO clinic_doctor_schedules (id, tenant_id, doctor_id, day_of_week, start_time, end_time, slot_duration_minutes, max_patients_per_session)
VALUES
    ('55555555-4444-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'dddddddd-4444-0000-0000-000000000001', 'Monday', '10:00:00', '16:00:00', 15, 30),
    ('55555555-4444-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'dddddddd-4444-0000-0000-000000000002', 'Monday', '11:00:00', '15:00:00', 20, 20)
ON CONFLICT (tenant_id, id) DO NOTHING;

-- Subscription for Noor Children Hospital (BUSINESS)
INSERT INTO tenant_subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end)
VALUES (
    '44444444-4444-4444-4444-444444444444',
    'BUSINESS',
    'ACTIVE',
    NOW(),
    NOW() + INTERVAL '30 days'
)
ON CONFLICT (tenant_id) DO UPDATE SET plan_id = 'BUSINESS';
