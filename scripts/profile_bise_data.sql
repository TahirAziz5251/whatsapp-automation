\set ON_ERROR_STOP on

SET search_path TO public;

-- ============================================================
-- SAFE DATA PROFILING QUERIES FOR BISE_DB
-- Counts, aggregations, integrity checks and masked samples only.
-- NO RAW STUDENT PII EXPOSURE.
-- ============================================================

SELECT
    current_user,
    current_database(),
    current_schema();

SHOW search_path;


-- ============================================================
-- 1. RECORD COUNTS
-- ============================================================

SELECT '=== 1. RECORD COUNTS ===' AS section;

SELECT
    (SELECT COUNT(*) FROM public.students)
        AS total_students,

    (SELECT COUNT(*) FROM public.exams)
        AS total_exams,

    (SELECT COUNT(*) FROM public.results)
        AS total_results,

    (SELECT COUNT(*) FROM public.result_subject_marks)
        AS total_subject_marks,

    (SELECT COUNT(*) FROM public.applications)
        AS total_applications,

    (SELECT COUNT(*) FROM public.fees)
        AS total_fee_records,

    (SELECT COUNT(*) FROM public.verification_requests)
        AS total_verification_requests,

    (SELECT COUNT(*) FROM public.leads)
        AS total_leads,

    (SELECT COUNT(*) FROM public.chat_history)
        AS total_chat_history;


-- ============================================================
-- 2. NULL VALUE & DATA INTEGRITY CHECKS
-- ============================================================

SELECT '=== 2. NULL VALUE COUNTS ===' AS section;

SELECT
    COUNT(*) FILTER (
        WHERE roll_number IS NULL
    ) AS null_roll_numbers,

    COUNT(*) FILTER (
        WHERE student_id IS NULL
    ) AS null_student_ids,

    COUNT(*) FILTER (
        WHERE exam_id IS NULL
    ) AS null_exam_ids,

    COUNT(*) FILTER (
        WHERE marks_obtained IS NULL
    ) AS null_marks

FROM public.results;


SELECT
    COUNT(*) FILTER (
        WHERE b_form_cnic IS NULL
    ) AS null_b_form_cnic,

    COUNT(*) FILTER (
        WHERE student_name IS NULL
    ) AS null_student_name,

    COUNT(*) FILTER (
        WHERE registration_number IS NULL
    ) AS null_registration_number

FROM public.students;


-- ============================================================
-- 3. DUPLICATE & AMBIGUITY CHECKS
-- ============================================================

SELECT '=== 3. DUPLICATE COUNTS & AMBIGUITY CHECKS ==='
AS section;


-- Same roll number appearing in more than one result record
SELECT
    roll_number,
    COUNT(*) AS occurrences_across_exams
FROM public.results
WHERE roll_number IS NOT NULL
GROUP BY roll_number
HAVING COUNT(*) > 1
ORDER BY occurrences_across_exams DESC;


-- Duplicate roll number within the same examination
SELECT
    exam_id,
    roll_number,
    COUNT(*) AS duplicates_within_exam
FROM public.results
WHERE roll_number IS NOT NULL
GROUP BY exam_id, roll_number
HAVING COUNT(*) > 1
ORDER BY duplicates_within_exam DESC;


-- Same B-Form/CNIC assigned to multiple student records
-- CNIC itself is NOT displayed.
SELECT
    COUNT(*) AS duplicate_cnic_groups
FROM (
    SELECT b_form_cnic
    FROM public.students
    WHERE b_form_cnic IS NOT NULL
    GROUP BY b_form_cnic
    HAVING COUNT(*) > 1
) duplicate_cnics;


-- Duplicate student names
-- Raw names are NOT displayed.
SELECT
    COUNT(*) AS duplicate_name_groups
FROM (
    SELECT student_name
    FROM public.students
    WHERE student_name IS NOT NULL
    GROUP BY student_name
    HAVING COUNT(*) > 1
) duplicate_names;


-- ============================================================
-- 4. EXAM SESSION DISTRIBUTION
-- ============================================================

SELECT '=== 4. EXAM SESSION DISTRIBUTION ==='
AS section;

SELECT
    e.exam_code,
    e.title,
    e.exam_year,
    e.exam_session,
    COUNT(r.id) AS student_result_count

FROM public.exams e

LEFT JOIN public.results r
    ON e.id = r.exam_id

GROUP BY
    e.id,
    e.exam_code,
    e.title,
    e.exam_year,
    e.exam_session

ORDER BY
    e.exam_year DESC,
    e.exam_session;


-- ============================================================
-- 5. STUDENTS WITH MULTIPLE EXAMINATIONS
-- ============================================================

SELECT '=== 5. STUDENTS WITH MULTIPLE EXAMINATIONS ==='
AS section;

SELECT
    s.id AS student_id,

    CASE
        WHEN s.student_name IS NULL THEN NULL
        ELSE LEFT(s.student_name, 3) || '***'
    END AS masked_name,

    CASE
        WHEN s.b_form_cnic IS NULL THEN NULL
        ELSE LEFT(s.b_form_cnic, 5) || '********'
    END AS masked_cnic,

    COUNT(r.id) AS total_exams_taken

FROM public.students s

JOIN public.results r
    ON s.id = r.student_id

GROUP BY
    s.id,
    s.student_name,
    s.b_form_cnic

HAVING COUNT(r.id) > 1

ORDER BY total_exams_taken DESC;


-- ============================================================
-- 6. MASKED SAMPLE VERIFICATION
-- ============================================================

SELECT '=== 6. MASKED SAMPLE VERIFICATION ==='
AS section;

SELECT
    CASE
        WHEN s.student_name IS NULL THEN NULL
        ELSE LEFT(s.student_name, 2) || '***'
    END AS masked_student_name,

    CASE
        WHEN s.b_form_cnic IS NULL THEN NULL
        ELSE LEFT(s.b_form_cnic, 5) || '********'
    END AS masked_b_form_cnic,

    r.roll_number,
    e.exam_code,
    r.grade,
    r.status

FROM public.results r

JOIN public.students s
    ON r.student_id = s.id

JOIN public.exams e
    ON r.exam_id = e.id

ORDER BY r.id

LIMIT 5;