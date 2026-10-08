-- Adds 100 synthetic student rows to the STUDENT table.
-- Run this once from the project folder in SQL*Plus:
--   @sql/sample_100_students.sql

INSERT INTO student (
    student_id,
    registration_no,
    student_name,
    gender,
    phone,
    email,
    department,
    year_of_study
)
SELECT
    (SELECT NVL(MAX(student_id), 0) FROM student) + LEVEL,
    '25BCE' || TO_CHAR(1000 + LEVEL),
    'Sample Student ' || TO_CHAR(LEVEL, 'FM000'),
    CASE WHEN MOD(LEVEL, 2) = 0 THEN 'FEMALE' ELSE 'MALE' END,
    '98' || LPAD(TO_CHAR(LEVEL), 8, '0'),
    'sample' || TO_CHAR(LEVEL, 'FM000') || '@example.com',
    'Computer Science',
    MOD(LEVEL - 1, 5) + 1
FROM dual
CONNECT BY LEVEL <= 100;

COMMIT;

SELECT COUNT(*) AS total_students FROM student;
