-- ==============================================================================
-- Master Domain Database Script: hospital_db (Healthcare & OPD Domain)
-- Single Canonical DDL & Realistic Development Dummy Data Script
-- ==============================================================================

-- Optional vector extension (if installed):
-- CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Departments
CREATE TABLE IF NOT EXISTS departments (
    id SERIAL PRIMARY KEY,
    department_name VARCHAR(100) UNIQUE NOT NULL,
    location_floor VARCHAR(50) DEFAULT 'Main Building',
    head_doctor VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Doctors
CREATE TABLE IF NOT EXISTS doctors (
    id SERIAL PRIMARY KEY,
    department_id INT REFERENCES departments(id),
    doctor_name VARCHAR(100) NOT NULL,
    specialty VARCHAR(100) NOT NULL,
    opd_fee_pkr NUMERIC(10, 2) NOT NULL,
    qualification VARCHAR(100) DEFAULT 'MBBS, FCPS',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_doctor_department UNIQUE (department_id, doctor_name)
);

-- 3. Schedules
CREATE TABLE IF NOT EXISTS schedules (
    id SERIAL PRIMARY KEY,
    doctor_id INT REFERENCES doctors(id) ON DELETE CASCADE,
    available_days VARCHAR(100) NOT NULL,
    opd_timings VARCHAR(100) NOT NULL,
    max_daily_patients INT DEFAULT 20,
    CONSTRAINT unique_doctor_schedule UNIQUE (doctor_id, available_days)
);

-- 4. Patients
CREATE TABLE IF NOT EXISTS patients (
    id SERIAL PRIMARY KEY,
    patient_mrn VARCHAR(50) UNIQUE NOT NULL,
    patient_name VARCHAR(100) NOT NULL,
    patient_phone VARCHAR(50) UNIQUE NOT NULL,
    gender VARCHAR(10),
    age INT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Appointments
CREATE TABLE IF NOT EXISTS appointments (
    id SERIAL PRIMARY KEY,
    appointment_number VARCHAR(50) UNIQUE NOT NULL,
    patient_id INT REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id INT REFERENCES doctors(id),
    appointment_date DATE NOT NULL,
    appointment_time TIME NOT NULL,
    status VARCHAR(30) DEFAULT 'SCHEDULED',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Appointment History
CREATE TABLE IF NOT EXISTS appointment_history (
    id SERIAL PRIMARY KEY,
    appointment_id INT REFERENCES appointments(id) ON DELETE CASCADE,
    doctor_notes TEXT,
    diagnosis VARCHAR(255),
    follow_up_date DATE,
    logged_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Private Domain Leads & Chat History
CREATE TABLE IF NOT EXISTS leads (
    customer_phone VARCHAR(50) PRIMARY KEY,
    push_name VARCHAR(100),
    lead_stage VARCHAR(50) DEFAULT 'PATIENT_INQUIRY',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_history (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(50) NOT NULL,
    customer_phone VARCHAR(50) NOT NULL,
    sender VARCHAR(20) NOT NULL,
    message_text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- SAFE REALISTIC DEVELOPMENT SEED DATA
INSERT INTO departments (department_name, location_floor, head_doctor)
VALUES 
    ('Cardiology', '1st Floor, Block A', 'Dr. Tariq Mahmood'),
    ('Pediatrics', 'Ground Floor, Block B', 'Dr. Ayesha Khan'),
    ('Neurology', '2nd Floor, Block A', 'Dr. Shahzad Anjum'),
    ('Orthopedics', '3rd Floor, Block C', 'Dr. Salman Farooq')
ON CONFLICT (department_name) DO NOTHING;

INSERT INTO doctors (department_id, doctor_name, specialty, opd_fee_pkr, qualification)
VALUES 
    ((SELECT id FROM departments WHERE department_name = 'Cardiology' LIMIT 1), 'Dr. Tariq Mahmood', 'Cardiology', 3000.00, 'MBBS, FCPS Cardiology'),
    ((SELECT id FROM departments WHERE department_name = 'Pediatrics' LIMIT 1), 'Dr. Ayesha Khan', 'Pediatrics', 2500.00, 'MBBS, FCPS Pediatrics'),
    ((SELECT id FROM departments WHERE department_name = 'Neurology' LIMIT 1), 'Dr. Shahzad Anjum', 'Neurology', 3500.00, 'MBBS, MD Neurology'),
    ((SELECT id FROM departments WHERE department_name = 'Orthopedics' LIMIT 1), 'Dr. Salman Farooq', 'Orthopedics', 3000.00, 'MBBS, MS Orthopedics')
ON CONFLICT (department_id, doctor_name) DO UPDATE 
SET specialty = EXCLUDED.specialty, opd_fee_pkr = EXCLUDED.opd_fee_pkr, qualification = EXCLUDED.qualification;

INSERT INTO schedules (doctor_id, available_days, opd_timings, max_daily_patients)
VALUES 
    ((SELECT id FROM doctors WHERE doctor_name = 'Dr. Tariq Mahmood' LIMIT 1), 'Monday, Wednesday, Friday', '09:00 AM - 01:00 PM', 20),
    ((SELECT id FROM doctors WHERE doctor_name = 'Dr. Ayesha Khan' LIMIT 1), 'Tuesday, Thursday, Saturday', '02:00 PM - 06:00 PM', 25),
    ((SELECT id FROM doctors WHERE doctor_name = 'Dr. Shahzad Anjum' LIMIT 1), 'Monday, Wednesday', '10:00 AM - 02:00 PM', 15),
    ((SELECT id FROM doctors WHERE doctor_name = 'Dr. Salman Farooq' LIMIT 1), 'Daily (Mon-Sat)', '05:00 PM - 08:00 PM', 20)
ON CONFLICT (doctor_id, available_days) DO UPDATE 
SET opd_timings = EXCLUDED.opd_timings, max_daily_patients = EXCLUDED.max_daily_patients;

INSERT INTO patients (patient_mrn, patient_name, patient_phone, gender, age)
VALUES 
    ('MRN-2026-001', 'Zahid Hussain', '+923001234567', 'Male', 45),
    ('MRN-2026-002', 'Sobia Parveen', '+923219876543', 'Female', 32),
    ('MRN-2026-003', 'Kamran Akmal', '+923127118485', 'Male', 28)
ON CONFLICT (patient_mrn) DO NOTHING;

INSERT INTO appointments (appointment_number, patient_id, doctor_id, appointment_date, appointment_time, status)
VALUES 
    ('APT-2026-101', (SELECT id FROM patients WHERE patient_mrn = 'MRN-2026-001' LIMIT 1), (SELECT id FROM doctors WHERE doctor_name = 'Dr. Tariq Mahmood' LIMIT 1), '2026-09-28', '10:00:00', 'SCHEDULED'),
    ('APT-2026-102', (SELECT id FROM patients WHERE patient_mrn = 'MRN-2026-002' LIMIT 1), (SELECT id FROM doctors WHERE doctor_name = 'Dr. Ayesha Khan' LIMIT 1), '2026-09-29', '14:30:00', 'SCHEDULED')
ON CONFLICT (appointment_number) DO NOTHING;

-- Indices
CREATE INDEX IF NOT EXISTS idx_hosp_pat_phone ON patients(patient_phone);
CREATE INDEX IF NOT EXISTS idx_hosp_doc_spec ON doctors(specialty);
CREATE INDEX IF NOT EXISTS idx_hosp_app_date ON appointments(appointment_date);

-- Least-Privilege Role for Secure Structured SQL Reads (Phase 20)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'gateway_readonly') THEN
        CREATE ROLE gateway_readonly WITH LOGIN PASSWORD 'gateway_secure_readonly_2026' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
END
$$;

GRANT CONNECT ON DATABASE hospital_db TO gateway_readonly;
GRANT USAGE ON SCHEMA public TO gateway_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO gateway_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO gateway_readonly;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM gateway_readonly;
REVOKE CREATE ON SCHEMA public FROM gateway_readonly;

-- Least-Privilege Role for State-Changing Action Gateway Writes (Phase 27)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'gateway_action_writer') THEN
        CREATE ROLE gateway_action_writer WITH LOGIN PASSWORD 'gateway_action_writer_2026' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
END
$$;

GRANT CONNECT ON DATABASE hospital_db TO gateway_action_writer;
GRANT USAGE ON SCHEMA public TO gateway_action_writer;
GRANT SELECT, INSERT, UPDATE ON appointments, appointment_history, patients, leads TO gateway_action_writer;
GRANT SELECT ON doctors, departments, schedules TO gateway_action_writer;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gateway_action_writer;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM gateway_action_writer;
REVOKE CREATE ON SCHEMA public FROM gateway_action_writer;

