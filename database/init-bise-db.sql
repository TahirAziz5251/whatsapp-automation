-- ==============================================================================
-- Master Domain Database Script: bise_db (BISE Educational Board Domain)
-- Single Canonical DDL, Stored Functions & Realistic Production-Ready Seed Data
-- ==============================================================================

-- Optional vector extension (if installed):
-- CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Students (Entities representing enrolled candidates)
CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    registration_number VARCHAR(50) UNIQUE NOT NULL,
    student_name VARCHAR(100) NOT NULL,
    father_name VARCHAR(100) NOT NULL,
    b_form_cnic VARCHAR(20),
    date_of_birth DATE,
    student_phone VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Exams (Official Examination Cycles, e.g. Matric / Intermediate Annual / Supplementary)
CREATE TABLE IF NOT EXISTS exams (
    id SERIAL PRIMARY KEY,
    exam_code VARCHAR(50) UNIQUE NOT NULL,
    title VARCHAR(100) NOT NULL,
    exam_year INT NOT NULL,
    exam_session VARCHAR(20) NOT NULL,
    is_declared BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Results (Official Consolidated Examination Results)
CREATE TABLE IF NOT EXISTS results (
    id SERIAL PRIMARY KEY,
    student_id INT REFERENCES students(id) ON DELETE CASCADE,
    exam_id INT REFERENCES exams(id) ON DELETE CASCADE,
    roll_number VARCHAR(30) NOT NULL,
    marks_obtained INT NOT NULL,
    total_marks INT NOT NULL DEFAULT 1100,
    grade VARCHAR(5) NOT NULL,
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_roll_exam UNIQUE (roll_number, exam_id)
);

-- 4. Result Subject Marks (Subject-Wise Breakdown for Detailed Mark Sheets / DMC)
CREATE TABLE IF NOT EXISTS result_subject_marks (
    id SERIAL PRIMARY KEY,
    result_id INT NOT NULL REFERENCES results(id) ON DELETE CASCADE,
    subject_name VARCHAR(100) NOT NULL,
    obtained_marks INT NOT NULL,
    total_marks INT NOT NULL DEFAULT 100,
    grade VARCHAR(5),
    status VARCHAR(20) DEFAULT 'PASS',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_result_subject UNIQUE (result_id, subject_name)
);

-- 5. Applications (Official Student Service Requests: NOC, Duplicate Marksheet, Rechecking)
CREATE TABLE IF NOT EXISTS applications (
    id SERIAL PRIMARY KEY,
    application_number VARCHAR(50) UNIQUE NOT NULL,
    student_id INT REFERENCES students(id),
    application_type VARCHAR(50) NOT NULL,
    status VARCHAR(30) DEFAULT 'PROCESSING',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Fees (Schedule of Official Board Fees)
CREATE TABLE IF NOT EXISTS fees (
    id SERIAL PRIMARY KEY,
    fee_type VARCHAR(50) UNIQUE NOT NULL,
    amount_pkr NUMERIC(10, 2) NOT NULL,
    description TEXT
);

-- 7. Verification Requests (Third-party Degree / Marksheet Verification)
CREATE TABLE IF NOT EXISTS verification_requests (
    id SERIAL PRIMARY KEY,
    request_ref VARCHAR(50) UNIQUE NOT NULL,
    roll_number VARCHAR(30) NOT NULL,
    applicant_name VARCHAR(100) NOT NULL,
    organization VARCHAR(150),
    verification_status VARCHAR(30) DEFAULT 'PENDING',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Private Domain Leads & Chat History
CREATE TABLE IF NOT EXISTS leads (
    customer_phone VARCHAR(50) PRIMARY KEY,
    push_name VARCHAR(100),
    lead_stage VARCHAR(50) DEFAULT 'STUDENT_INQUIRY',
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

-- Indices for High-Performance & Multi-Factor Identity Lookups
CREATE INDEX IF NOT EXISTS idx_bise_roll ON results(roll_number);
CREATE INDEX IF NOT EXISTS idx_bise_reg ON students(registration_number);
CREATE INDEX IF NOT EXISTS idx_students_cnic ON students(b_form_cnic);
CREATE INDEX IF NOT EXISTS idx_subj_result ON result_subject_marks(result_id);
CREATE INDEX IF NOT EXISTS idx_bise_app ON applications(application_number);

-- ==============================================================================
-- SECURE STORED PROCEDURES (LEAST-PRIVILEGE DEFENSIVE BOUNDARIES)
-- ==============================================================================

-- Stored Function 1: Multi-Factor Student Result Retrieval with PII Masking
DROP FUNCTION IF EXISTS get_verified_student_examination_result(VARCHAR, VARCHAR, INT, VARCHAR);
CREATE OR REPLACE FUNCTION get_verified_student_examination_result(
    p_roll_number VARCHAR,
    p_cnic VARCHAR,
    p_exam_year INT DEFAULT NULL,
    p_exam_session VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    student_name VARCHAR,
    father_name VARCHAR,
    registration_number VARCHAR,
    masked_b_form_cnic TEXT,
    roll_number VARCHAR,
    exam_title VARCHAR,
    exam_year INT,
    exam_session VARCHAR,
    marks_obtained INT,
    total_marks INT,
    grade VARCHAR,
    status VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_clean_cnic VARCHAR;
BEGIN
    -- Normalize incoming CNIC by stripping dashes and spaces
    v_clean_cnic := REGEXP_REPLACE(p_cnic, '[^0-9]', '', 'g');

    RETURN QUERY
    SELECT 
        s.student_name,
        s.father_name,
        s.registration_number,
        CASE 
            WHEN LENGTH(REGEXP_REPLACE(s.b_form_cnic, '[^0-9]', '', 'g')) = 13 THEN
                SUBSTRING(REGEXP_REPLACE(s.b_form_cnic, '[^0-9]', '', 'g') FROM 1 FOR 5) || '-*******-' || SUBSTRING(REGEXP_REPLACE(s.b_form_cnic, '[^0-9]', '', 'g') FROM 13 FOR 1)
            ELSE
                SUBSTRING(s.b_form_cnic, 1, 5) || '-*******-' || SUBSTRING(s.b_form_cnic, 15, 1)
        END AS masked_b_form_cnic,
        r.roll_number,
        e.title AS exam_title,
        e.exam_year,
        e.exam_session,
        r.marks_obtained,
        r.total_marks,
        r.grade,
        r.status
    FROM results r
    JOIN students s ON r.student_id = s.id
    JOIN exams e ON r.exam_id = e.id
    WHERE r.roll_number = p_roll_number
      AND REGEXP_REPLACE(s.b_form_cnic, '[^0-9]', '', 'g') = v_clean_cnic
      AND (p_exam_year IS NULL OR e.exam_year = p_exam_year)
      AND (p_exam_session IS NULL OR e.exam_session ILIKE p_exam_session)
    ORDER BY e.exam_year DESC, e.created_at DESC
    LIMIT 1;
END;
$$;

-- Stored Function 2: Authenticated Subject-Wise Marks Breakdown
DROP FUNCTION IF EXISTS get_verified_student_subject_marks(VARCHAR, VARCHAR);
CREATE OR REPLACE FUNCTION get_verified_student_subject_marks(
    p_roll_number VARCHAR,
    p_cnic VARCHAR
)
RETURNS TABLE (
    subject_name VARCHAR,
    obtained_marks INT,
    total_marks INT,
    grade VARCHAR,
    status VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_clean_cnic VARCHAR;
    v_result_id INT;
BEGIN
    v_clean_cnic := REGEXP_REPLACE(p_cnic, '[^0-9]', '', 'g');
    
    -- Verify Roll Number + CNIC Match before disclosing subject marks
    SELECT r.id INTO v_result_id
    FROM results r
    JOIN students s ON r.student_id = s.id
    WHERE r.roll_number = p_roll_number
      AND REGEXP_REPLACE(s.b_form_cnic, '[^0-9]', '', 'g') = v_clean_cnic
    ORDER BY r.created_at DESC
    LIMIT 1;

    IF v_result_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT 
        sm.subject_name,
        sm.obtained_marks,
        sm.total_marks,
        sm.grade,
        sm.status
    FROM result_subject_marks sm
    WHERE sm.result_id = v_result_id
    ORDER BY sm.id ASC;
END;
$$;

-- ==============================================================================
-- REALISTIC DEVELOPMENT SEED DATA (PRODUCTION-STRUCTURED SAMPLE SET)
-- ==============================================================================

INSERT INTO students (registration_number, student_name, father_name, b_form_cnic, date_of_birth, student_phone)
VALUES 
    ('BISE-2025-101', 'Muhammad Ahmad', 'Tariq Mahmood', '35201-1234567-1', '2008-04-12', '+923001234567'),
    ('BISE-2025-102', 'Fatima Zahra', 'Ali Raza', '35202-9876543-2', '2008-09-20', '+923219876543'),
    ('BISE-2025-103', 'Hamza Tariq', 'Tariq Aziz', '35201-5554321-3', '2007-11-05', '+923127118485'),
    ('BISE-2025-104', 'Ayesha Malik', 'Malik Ihsan', '35202-4443210-4', '2008-02-18', '+923334567890')
ON CONFLICT (registration_number) DO UPDATE
SET b_form_cnic = EXCLUDED.b_form_cnic;

INSERT INTO exams (exam_code, title, exam_year, exam_session, is_declared)
VALUES 
    ('MATRIC-2025-ANNUAL', 'Matriculation Annual Examination 2025', 2025, 'ANNUAL', true),
    ('INTER-2025-ANNUAL', 'Intermediate Annual Examination 2025', 2025, 'ANNUAL', true),
    ('MATRIC-2025-SUPPLY', 'Matriculation Supplementary Examination 2025', 2025, 'SUPPLY', true)
ON CONFLICT (exam_code) DO NOTHING;

INSERT INTO results (student_id, exam_id, roll_number, marks_obtained, total_marks, grade, status)
VALUES 
    ((SELECT id FROM students WHERE registration_number = 'BISE-2025-101' LIMIT 1), (SELECT id FROM exams WHERE exam_code = 'MATRIC-2025-ANNUAL' LIMIT 1), '102450', 945, 1100, 'A+', 'PASS'),
    ((SELECT id FROM students WHERE registration_number = 'BISE-2025-102' LIMIT 1), (SELECT id FROM exams WHERE exam_code = 'MATRIC-2025-ANNUAL' LIMIT 1), '102451', 880, 1100, 'A', 'PASS'),
    ((SELECT id FROM students WHERE registration_number = 'BISE-2025-103' LIMIT 1), (SELECT id FROM exams WHERE exam_code = 'INTER-2025-ANNUAL' LIMIT 1), '204501', 995, 1100, 'A+', 'PASS'),
    ((SELECT id FROM students WHERE registration_number = 'BISE-2025-104' LIMIT 1), (SELECT id FROM exams WHERE exam_code = 'INTER-2025-ANNUAL' LIMIT 1), '204502', 750, 1100, 'B', 'PASS')
ON CONFLICT (roll_number, exam_id) DO UPDATE 
SET marks_obtained = EXCLUDED.marks_obtained, grade = EXCLUDED.grade, status = EXCLUDED.status;

-- Reset sequence to prevent collision
SELECT setval('results_id_seq', (SELECT MAX(id) FROM results));

-- Subject Breakdown for Result 1 (Roll 102450 - Matric 2025 Annual - Total 945/1100)
INSERT INTO result_subject_marks (result_id, subject_name, obtained_marks, total_marks, grade, status)
VALUES
    ((SELECT id FROM results WHERE roll_number = '102450' LIMIT 1), 'English Compulsory', 122, 150, 'A', 'PASS'),
    ((SELECT id FROM results WHERE roll_number = '102450' LIMIT 1), 'Urdu Compulsory', 118, 150, 'A', 'PASS'),
    ((SELECT id FROM results WHERE roll_number = '102450' LIMIT 1), 'Islamiyat', 86, 100, 'A+', 'PASS'),
    ((SELECT id FROM results WHERE roll_number = '102450' LIMIT 1), 'Pakistan Studies', 84, 100, 'A', 'PASS'),
    ((SELECT id FROM results WHERE roll_number = '102450' LIMIT 1), 'Mathematics', 135, 150, 'A+', 'PASS'),
    ((SELECT id FROM results WHERE roll_number = '102450' LIMIT 1), 'Physics', 134, 150, 'A+', 'PASS'),
    ((SELECT id FROM results WHERE roll_number = '102450' LIMIT 1), 'Chemistry', 131, 150, 'A+', 'PASS'),
    ((SELECT id FROM results WHERE roll_number = '102450' LIMIT 1), 'Computer Science', 135, 150, 'A+', 'PASS')
ON CONFLICT (result_id, subject_name) DO UPDATE
SET obtained_marks = EXCLUDED.obtained_marks, total_marks = EXCLUDED.total_marks;

-- Subject Breakdown for Result 2 (Roll 102451 - Matric 2025 Annual - Total 880/1100)
INSERT INTO result_subject_marks (result_id, subject_name, obtained_marks, total_marks, grade, status)
VALUES
    ((SELECT id FROM results WHERE roll_number = '102451' LIMIT 1), 'English Compulsory', 110, 150, 'B', 'PASS'),
    ((SELECT id FROM results WHERE roll_number = '102451' LIMIT 1), 'Urdu Compulsory', 112, 150, 'B', 'PASS'),
    ((SELECT id FROM results WHERE roll_number = '102451' LIMIT 1), 'Islamiyat', 80, 100, 'A', 'PASS'),
    ((SELECT id FROM results WHERE roll_number = '102451' LIMIT 1), 'Pakistan Studies', 78, 100, 'A', 'PASS'),
    ((SELECT id FROM results WHERE roll_number = '102451' LIMIT 1), 'Mathematics', 125, 150, 'A', 'PASS'),
    ((SELECT id FROM results WHERE roll_number = '102451' LIMIT 1), 'Physics', 128, 150, 'A', 'PASS'),
    ((SELECT id FROM results WHERE roll_number = '102451' LIMIT 1), 'Chemistry', 122, 150, 'A', 'PASS'),
    ((SELECT id FROM results WHERE roll_number = '102451' LIMIT 1), 'Biology', 125, 150, 'A', 'PASS')
ON CONFLICT (result_id, subject_name) DO UPDATE
SET obtained_marks = EXCLUDED.obtained_marks, total_marks = EXCLUDED.total_marks;

-- Subject Breakdown for Result 3 (Roll 204501 - Intermediate 2025 Annual - Total 995/1100)
INSERT INTO result_subject_marks (result_id, subject_name, obtained_marks, total_marks, grade, status)
VALUES
    ((SELECT id FROM results WHERE roll_number = '204501' LIMIT 1), 'English', 180, 200, 'A+', 'PASS'),
    ((SELECT id FROM results WHERE roll_number = '204501' LIMIT 1), 'Urdu', 175, 200, 'A', 'PASS'),
    ((SELECT id FROM results WHERE roll_number = '204501' LIMIT 1), 'Islamic Education & Pak Studies', 90, 100, 'A+', 'PASS'),
    ((SELECT id FROM results WHERE roll_number = '204501' LIMIT 1), 'Mathematics', 190, 200, 'A+', 'PASS'),
    ((SELECT id FROM results WHERE roll_number = '204501' LIMIT 1), 'Physics', 180, 200, 'A+', 'PASS'),
    ((SELECT id FROM results WHERE roll_number = '204501' LIMIT 1), 'Chemistry', 180, 200, 'A+', 'PASS')
ON CONFLICT (result_id, subject_name) DO UPDATE
SET obtained_marks = EXCLUDED.obtained_marks, total_marks = EXCLUDED.total_marks;

-- Subject Breakdown for Result 4 (Roll 204502 - Intermediate 2025 Annual - Total 750/1100)
INSERT INTO result_subject_marks (result_id, subject_name, obtained_marks, total_marks, grade, status)
VALUES
    ((SELECT id FROM results WHERE roll_number = '204502' LIMIT 1), 'English', 130, 200, 'B', 'PASS'),
    ((SELECT id FROM results WHERE roll_number = '204502' LIMIT 1), 'Urdu', 135, 200, 'B', 'PASS'),
    ((SELECT id FROM results WHERE roll_number = '204502' LIMIT 1), 'Islamic Education & Pak Studies', 70, 100, 'A', 'PASS'),
    ((SELECT id FROM results WHERE roll_number = '204502' LIMIT 1), 'Mathematics', 140, 200, 'B', 'PASS'),
    ((SELECT id FROM results WHERE roll_number = '204502' LIMIT 1), 'Physics', 135, 200, 'B', 'PASS'),
    ((SELECT id FROM results WHERE roll_number = '204502' LIMIT 1), 'Computer Science', 140, 200, 'B', 'PASS')
ON CONFLICT (result_id, subject_name) DO UPDATE
SET obtained_marks = EXCLUDED.obtained_marks, total_marks = EXCLUDED.total_marks;

INSERT INTO applications (application_number, student_id, application_type, status)
VALUES 
    ('APP-NOC-2026-01', (SELECT id FROM students WHERE registration_number = 'BISE-2025-101' LIMIT 1), 'NOC_MIGRATION', 'APPROVED'),
    ('APP-REC-2026-02', (SELECT id FROM students WHERE registration_number = 'BISE-2025-102' LIMIT 1), 'RECHECKING', 'PROCESSING')
ON CONFLICT (application_number) DO NOTHING;

INSERT INTO fees (fee_type, amount_pkr, description)
VALUES 
    ('ADMISSION_MATRIC', 2500.00, 'Matric Annual Exam Admission Fee'),
    ('NOC_MIGRATION', 1800.00, 'Board Migration NOC Certificate Fee'),
    ('RECHECKING_PER_PAPER', 1200.00, 'Paper Rechecking Fee per Subject'),
    ('DUPLICATE_DEGREE', 3500.00, 'Duplicate Degree Certificate Urgent Fee')
ON CONFLICT (fee_type) DO NOTHING;

-- ==============================================================================
-- DATABASE ROLES & ACCESS CONTROL GOVERNANCE (LEAST-PRIVILEGE SECURITY)
-- ==============================================================================

-- 1. Read-Only Least-Privilege Role for AI Data Gateway
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'gateway_readonly') THEN
        CREATE ROLE gateway_readonly WITH LOGIN PASSWORD 'gateway_secure_readonly_2026' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
END
$$;

GRANT CONNECT ON DATABASE bise_db TO gateway_readonly;
GRANT USAGE ON SCHEMA public TO gateway_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO gateway_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO gateway_readonly;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM gateway_readonly;
REVOKE CREATE ON SCHEMA public FROM gateway_readonly;

-- Grant Execution Privileges on Secure Verification Functions
GRANT EXECUTE ON FUNCTION get_verified_student_examination_result TO gateway_readonly, postgres;
GRANT EXECUTE ON FUNCTION get_verified_student_subject_marks TO gateway_readonly, postgres;

-- 2. State-Changing Write Role for Action Gateway (Audited & Gated Writes)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'gateway_action_writer') THEN
        CREATE ROLE gateway_action_writer WITH LOGIN PASSWORD 'gateway_action_writer_2026' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
END
$$;

GRANT CONNECT ON DATABASE bise_db TO gateway_action_writer;
GRANT USAGE ON SCHEMA public TO gateway_action_writer;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO gateway_action_writer;
GRANT INSERT, UPDATE ON applications, verification_requests, leads TO gateway_action_writer;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gateway_action_writer;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON results, result_subject_marks, students, exams, fees FROM gateway_action_writer;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM gateway_action_writer;
REVOKE CREATE ON SCHEMA public FROM gateway_action_writer;
