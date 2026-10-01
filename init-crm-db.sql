-- Phase 4 & 5: Multi-Domain PostgreSQL Database Schema (CRM, POS, BISE, Hospital)

-- 1. Shared Leads Table (Relational Lead Management)
CREATE TABLE IF NOT EXISTS leads (
    customer_phone VARCHAR(50) PRIMARY KEY,
    push_name VARCHAR(100),
    city VARCHAR(100) DEFAULT 'Lahore (Default)',
    domain_type VARCHAR(30) DEFAULT 'GENERAL', -- POS, BISE, HOSPITAL
    lead_stage VARCHAR(50) DEFAULT 'NEW_LEAD',
    intent VARCHAR(50) DEFAULT 'GENERAL',
    last_message TEXT,
    ai_reply TEXT,
    booking_status VARCHAR(50) DEFAULT 'NONE',
    booking_date VARCHAR(50),
    booking_time VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Shared Chat History Table (Persistent Multi-Turn Chat Logs)
CREATE TABLE IF NOT EXISTS chat_history (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(50) NOT NULL,
    customer_phone VARCHAR(50) NOT NULL,
    push_name VARCHAR(100),
    sender VARCHAR(20) NOT NULL, -- 'customer' or 'agent'
    message_text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Shared Appointments Table (Calendar & Slot Management)
CREATE TABLE IF NOT EXISTS appointments (
    event_id VARCHAR(100) PRIMARY KEY,
    customer_phone VARCHAR(50) NOT NULL,
    push_name VARCHAR(100),
    booking_date VARCHAR(50) NOT NULL,
    booking_time VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'SCHEDULED',
    summary VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. POS Domain: Products Table
CREATE TABLE IF NOT EXISTS pos_products (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    price_pkr NUMERIC(10, 2) NOT NULL,
    stock_quantity INT DEFAULT 0,
    category VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. BISE Domain: Student Results Table
CREATE TABLE IF NOT EXISTS bise_results (
    id SERIAL PRIMARY KEY,
    roll_number VARCHAR(30) NOT NULL,
    exam_year INT NOT NULL,
    exam_session VARCHAR(20) NOT NULL, -- ANNUAL / SUPPLY
    student_name VARCHAR(100) NOT NULL,
    marks_obtained INT NOT NULL,
    total_marks INT NOT NULL,
    grade VARCHAR(5),
    status VARCHAR(20) NOT NULL, -- PASS / FAIL
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Hospital Domain: Doctors Table
CREATE TABLE IF NOT EXISTS hospital_doctors (
    id SERIAL PRIMARY KEY,
    doctor_name VARCHAR(100) NOT NULL,
    specialty VARCHAR(100) NOT NULL,
    opd_timings VARCHAR(100) NOT NULL,
    fee_pkr NUMERIC(10, 2) NOT NULL,
    available_days VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Hospital Domain: Appointments Table
CREATE TABLE IF NOT EXISTS hospital_appointments (
    id SERIAL PRIMARY KEY,
    patient_phone VARCHAR(50) NOT NULL,
    patient_name VARCHAR(100),
    doctor_id INT REFERENCES hospital_doctors(id),
    appointment_date DATE NOT NULL,
    appointment_time TIME NOT NULL,
    status VARCHAR(30) DEFAULT 'SCHEDULED',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Seed Data for Domains
INSERT INTO pos_products (sku, name, price_pkr, stock_quantity, category)
VALUES 
    ('BOT-SETUP-01', 'WhatsApp AI Bot One-Time Setup', 75000.00, 50, 'Services'),
    ('RAG-HYBRID-01', 'Custom RAG Knowledge Base Integration', 45000.00, 30, 'Services'),
    ('CRM-SYNC-01', 'CRM & Database Automation Pipeline', 40000.00, 40, 'Services')
ON CONFLICT (sku) DO NOTHING;

INSERT INTO bise_results (roll_number, exam_year, exam_session, student_name, marks_obtained, total_marks, grade, status)
VALUES 
    ('102450', 2025, 'ANNUAL', 'Muhammad Ahmad', 945, 1100, 'A+', 'PASS'),
    ('102451', 2025, 'ANNUAL', 'Fatima Zahra', 880, 1100, 'A', 'PASS')
ON CONFLICT DO NOTHING;

INSERT INTO hospital_doctors (doctor_name, specialty, opd_timings, fee_pkr, available_days)
VALUES 
    ('Dr. Tariq Mahmood', 'Cardiology', '09:00 AM - 01:00 PM', 3000.00, 'Monday, Wednesday, Friday'),
    ('Dr. Ayesha Khan', 'Pediatrics', '02:00 PM - 06:00 PM', 2500.00, 'Tuesday, Thursday, Saturday')
ON CONFLICT DO NOTHING;

-- Indices for High Performance
CREATE INDEX IF NOT EXISTS idx_chat_history_session ON chat_history(session_id);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(customer_phone);
CREATE INDEX IF NOT EXISTS idx_bise_roll_year ON bise_results(roll_number, exam_year);
CREATE INDEX IF NOT EXISTS idx_hosp_doctor_spec ON hospital_doctors(specialty);
