-- ==============================================================================
-- BIZFLOW AI — PHASE 4: PILOT VERTICAL CLINIC & HOSPITAL OPD DATABASE SCHEMA
-- Multi-Tenant Schema with Forced Row-Level Security (RLS) & Composite Foreign Keys
-- Authoritative System of Record: PostgreSQL 18 (platform_db)
-- ==============================================================================

\set ON_ERROR_STOP on

-- 1. Clinic Doctors Table
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

-- 2. Clinic Doctor Schedules Table
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

CREATE INDEX IF NOT EXISTS idx_clinic_schedules_lookup ON clinic_doctor_schedules(tenant_id, doctor_id, day_of_week);

-- 3. Clinic Appointments Table
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
    reminder_30m_sent BOOLEAN DEFAULT FALSE,
    reminder_30m_sent_at TIMESTAMPTZ,
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

CREATE INDEX IF NOT EXISTS idx_clinic_appointments_lookup ON clinic_appointments(tenant_id, doctor_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_clinic_appointments_token ON clinic_appointments(tenant_id, queue_token);
CREATE INDEX IF NOT EXISTS idx_clinic_appointments_contact ON clinic_appointments(tenant_id, contact_id);

-- 4. Clinic Live Queues Table (Real-time OPD Tracker)
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
    CONSTRAINT fk_clinic_queue_doctor FOREIGN KEY (tenant_id, doctor_id) REFERENCES clinic_doctors(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_clinic_queue_appointment FOREIGN KEY (tenant_id, current_serving_appointment_id) REFERENCES clinic_appointments(tenant_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_clinic_live_queues_lookup ON clinic_live_queues(tenant_id, doctor_id, queue_date);

-- ------------------------------------------------------------------------------
-- 5. Row-Level Security (RLS) Enforcement
-- ------------------------------------------------------------------------------
ALTER TABLE clinic_doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_doctors FORCE ROW LEVEL SECURITY;

ALTER TABLE clinic_doctor_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_doctor_schedules FORCE ROW LEVEL SECURITY;

ALTER TABLE clinic_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_appointments FORCE ROW LEVEL SECURITY;

ALTER TABLE clinic_live_queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_live_queues FORCE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS tenant_isolation_clinic_doctors ON clinic_doctors;
DROP POLICY IF EXISTS tenant_isolation_clinic_schedules ON clinic_doctor_schedules;
DROP POLICY IF EXISTS tenant_isolation_clinic_appointments ON clinic_appointments;
DROP POLICY IF EXISTS tenant_isolation_clinic_queues ON clinic_live_queues;

-- Create Forced Policies
CREATE POLICY tenant_isolation_clinic_doctors ON clinic_doctors
    FOR ALL
    USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid)
    WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

CREATE POLICY tenant_isolation_clinic_schedules ON clinic_doctor_schedules
    FOR ALL
    USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid)
    WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

CREATE POLICY tenant_isolation_clinic_appointments ON clinic_appointments
    FOR ALL
    USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid)
    WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

CREATE POLICY tenant_isolation_clinic_queues ON clinic_live_queues
    FOR ALL
    USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid)
    WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

-- ------------------------------------------------------------------------------
-- 6. Permissions Grant for bizflow_runtime Least-Privilege Role
-- ------------------------------------------------------------------------------
GRANT ALL PRIVILEGES ON TABLE clinic_doctors TO bizflow_runtime;
GRANT ALL PRIVILEGES ON TABLE clinic_doctor_schedules TO bizflow_runtime;
GRANT ALL PRIVILEGES ON TABLE clinic_appointments TO bizflow_runtime;
GRANT ALL PRIVILEGES ON TABLE clinic_live_queues TO bizflow_runtime;

-- ------------------------------------------------------------------------------
-- 7. Seed Initial Doctor Roster for Alpha Clinic (11111111-1111-1111-1111-111111111111)
-- ------------------------------------------------------------------------------
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
) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, settings = EXCLUDED.settings;

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
-- Dr. Tariq: Mon-Fri 10:00 - 14:00
('11111111-1111-1111-1111-111111111111', 'cccccccc-1111-0000-0000-000000000001', 'dddddddd-1111-0000-0000-000000000001', 'Monday', '10:00:00', '14:00:00', 15, 25),
('11111111-1111-1111-1111-111111111111', 'cccccccc-1111-0000-0000-000000000002', 'dddddddd-1111-0000-0000-000000000001', 'Tuesday', '10:00:00', '14:00:00', 15, 25),
('11111111-1111-1111-1111-111111111111', 'cccccccc-1111-0000-0000-000000000003', 'dddddddd-1111-0000-0000-000000000001', 'Wednesday', '10:00:00', '14:00:00', 15, 25),
('11111111-1111-1111-1111-111111111111', 'cccccccc-1111-0000-0000-000000000004', 'dddddddd-1111-0000-0000-000000000001', 'Thursday', '10:00:00', '14:00:00', 15, 25),
('11111111-1111-1111-1111-111111111111', 'cccccccc-1111-0000-0000-000000000005', 'dddddddd-1111-0000-0000-000000000001', 'Friday', '10:00:00', '14:00:00', 15, 25),

-- Dr. Ayesha: Mon-Sat 16:00 - 20:00
('11111111-1111-1111-1111-111111111111', 'cccccccc-1111-0000-0000-000000000006', 'dddddddd-1111-0000-0000-000000000002', 'Monday', '16:00:00', '20:00:00', 15, 30),
('11111111-1111-1111-1111-111111111111', 'cccccccc-1111-0000-0000-000000000007', 'dddddddd-1111-0000-0000-000000000002', 'Wednesday', '16:00:00', '20:00:00', 15, 30),
('11111111-1111-1111-1111-111111111111', 'cccccccc-1111-0000-0000-000000000008', 'dddddddd-1111-0000-0000-000000000002', 'Friday', '16:00:00', '20:00:00', 15, 30),

-- Dr. Bilal: Mon, Wed, Fri 18:00 - 21:00
('11111111-1111-1111-1111-111111111111', 'cccccccc-1111-0000-0000-000000000009', 'dddddddd-1111-0000-0000-000000000003', 'Monday', '18:00:00', '21:00:00', 15, 20)
ON CONFLICT (tenant_id, id) DO UPDATE SET
    day_of_week = EXCLUDED.day_of_week,
    start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time,
    updated_at = NOW();

-- Seed Initial Live Queue Tracker for Dr. Tariq today
INSERT INTO clinic_live_queues (tenant_id, id, doctor_id, queue_date, current_serving_token, total_booked, total_checked_in, total_completed, status)
VALUES
('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-1111-0000-0000-000000000001', 'dddddddd-1111-0000-0000-000000000001', CURRENT_DATE, 'T-01', 5, 3, 1, 'ACTIVE')
ON CONFLICT (tenant_id, doctor_id, queue_date) DO UPDATE SET
    current_serving_token = EXCLUDED.current_serving_token,
    status = EXCLUDED.status,
    updated_at = NOW();
