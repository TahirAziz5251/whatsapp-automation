\set ON_ERROR_STOP on

SET search_path TO public;

SELECT
    current_user,
    current_database(),
    current_schema();

SHOW search_path;


-- ==============================================================================
-- Master Domain Data Profiling Script: hospital_db (Healthcare & OPD Domain)
-- Deep Data Profiling & Integrity Audit Script for Hospital Automation
-- ==============================================================================

SELECT '=== 1. MASTER RECORD COUNTS ===' AS section;
SELECT 
    (SELECT COUNT(*) FROM departments) AS total_departments,
    (SELECT COUNT(*) FROM doctors) AS total_doctors,
    (SELECT COUNT(*) FROM schedules) AS total_schedules,
    (SELECT COUNT(*) FROM patients) AS total_patients,
    (SELECT COUNT(*) FROM appointments) AS total_appointments,
    (SELECT COUNT(*) FROM appointment_history) AS total_history_records,
    (SELECT COUNT(*) FROM leads) AS total_leads,
    (SELECT COUNT(*) FROM chat_history) AS total_chat_records;

SELECT '=== 2. NULL VALUE & DATA INTEGRITY CHECKS ===' AS section;
SELECT 
    (SELECT COUNT(*) FROM doctors WHERE doctor_name IS NULL OR specialty IS NULL) AS null_doctor_details,
    (SELECT COUNT(*) FROM doctors WHERE opd_fee_pkr IS NULL OR opd_fee_pkr <= 0) AS invalid_opd_fees,
    (SELECT COUNT(*) FROM patients WHERE patient_mrn IS NULL OR patient_phone IS NULL) AS null_patient_identifiers,
    (SELECT COUNT(*) FROM appointments WHERE appointment_number IS NULL OR appointment_date IS NULL OR appointment_time IS NULL) AS null_appointment_fields;

SELECT '=== 3. DUPLICATE & CONSTRAINT INTEGRITY CHECKS ===' AS section;
SELECT 
    (SELECT COUNT(*) FROM (SELECT department_name FROM departments GROUP BY department_name HAVING COUNT(*) > 1) d) AS duplicate_department_count,
    (SELECT COUNT(*) FROM (SELECT patient_mrn FROM patients GROUP BY patient_mrn HAVING COUNT(*) > 1) m) AS duplicate_mrn_count,
    (SELECT COUNT(*) FROM (SELECT patient_phone FROM patients GROUP BY patient_phone HAVING COUNT(*) > 1) p) AS duplicate_patient_phone_count,
    (SELECT COUNT(*) FROM (SELECT appointment_number FROM appointments GROUP BY appointment_number HAVING COUNT(*) > 1) a) AS duplicate_appointment_num_count;

SELECT '=== 4. APPOINTMENT STATUS LIFECYCLE DISTRIBUTION ===' AS section;
SELECT status, COUNT(*) AS total_count
FROM appointments
GROUP BY status
ORDER BY total_count DESC;

SELECT '=== 5. DOCTOR SPECIALTY & FEE DISTRIBUTION ===' AS section;
SELECT doc.specialty, COUNT(doc.id) AS doctor_count, AVG(doc.opd_fee_pkr)::NUMERIC(10,2) AS avg_fee_pkr
FROM departments d
LEFT JOIN doctors doc ON d.id = doc.department_id
GROUP BY doc.specialty
ORDER BY doctor_count DESC;

SELECT '=== 6. DATABASE SECURITY & ROLE PERMISSION AUDIT ===' AS section;

SELECT
    grantee,
    table_name,
    privilege_type
FROM information_schema.role_table_grants
WHERE grantee = current_user
  AND table_schema = 'public'
ORDER BY table_name, privilege_type;
