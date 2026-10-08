-- RESETS STUDENT-LINKED DATA and replaces it with 100 synthetic students.
-- Existing hostels, rooms, wardens, and Admin/Warden logins are preserved.
-- Student logins are removed because their linked student records are replaced.
-- New 4-bed rooms are added only if needed to give all 100 students a bed.
-- Run from SQL*Plus with:
--   @C:\Users\Admin\hostel-management\sql\reset_students_realistic.sql
-- This script makes permanent changes when it reaches COMMIT.

SET DEFINE OFF
WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK

PROMPT Checking that the two existing hostels are available...

DECLARE
    b_hostel_count PLS_INTEGER;
    c_hostel_count PLS_INTEGER;
BEGIN
    SELECT COUNT(*) INTO b_hostel_count
    FROM hostel
    WHERE hostel_name = 'B-Block Hostel';

    SELECT COUNT(*) INTO c_hostel_count
    FROM hostel
    WHERE hostel_name = 'C-Block Hostel';

    IF b_hostel_count <> 1 OR c_hostel_count <> 1 THEN
        RAISE_APPLICATION_ERROR(
            -20001,
            'Expected exactly one B-Block Hostel and one C-Block Hostel. No data was reset.'
        );
    END IF;
END;
/

LOCK TABLE room_allocation IN EXCLUSIVE MODE;

PROMPT Removing student-linked records...

DELETE FROM visitor;
DELETE FROM leave_request;
DELETE FROM complaint;
DELETE FROM student_complaint;
DELETE FROM room_allocation;
DELETE FROM app_account WHERE role = 'STUDENT';
DELETE FROM student;

PROMPT Adding only enough third-floor rooms to reach 100 beds...

INSERT INTO room (
    room_id,
    hostel_id,
    room_number,
    room_type,
    capacity,
    floor_number
)
WITH
capacity_target AS (
    SELECT CEIL(GREATEST(100 - NVL(SUM(capacity), 0), 0) / 4) AS rooms_to_add
    FROM room
),
room_numbers AS (
    SELECT LEVEL AS room_seq
    FROM capacity_target
    CONNECT BY LEVEL <= capacity_target.rooms_to_add
),
room_split AS (
    SELECT rooms_to_add, CEIL(rooms_to_add / 2) AS b_room_count
    FROM capacity_target
),
hostel_ids AS (
    SELECT MAX(CASE WHEN hostel_name = 'B-Block Hostel' THEN hostel_id END) AS b_hostel_id,
           MAX(CASE WHEN hostel_name = 'C-Block Hostel' THEN hostel_id END) AS c_hostel_id
    FROM hostel
),
room_id_base AS (
    SELECT NVL(MAX(room_id), 0) AS max_room_id
    FROM room
),
room_number_bases AS (
    SELECT NVL(MAX(CASE WHEN hostel_id = b_hostel_id AND room_number LIKE 'B3__'
                        THEN TO_NUMBER(SUBSTR(room_number, 3, 2)) END), 0) AS b_suffix,
           NVL(MAX(CASE WHEN hostel_id = c_hostel_id AND room_number LIKE 'C3__'
                        THEN TO_NUMBER(SUBSTR(room_number, 3, 2)) END), 0) AS c_suffix
    FROM room
    CROSS JOIN hostel_ids
)
SELECT room_id_base.max_room_id + room_numbers.room_seq,
       CASE WHEN room_numbers.room_seq <= room_split.b_room_count
            THEN hostel_ids.b_hostel_id ELSE hostel_ids.c_hostel_id END,
       CASE WHEN room_numbers.room_seq <= room_split.b_room_count
            THEN 'B3' || LPAD(TO_CHAR(room_number_bases.b_suffix + room_numbers.room_seq), 2, '0')
            ELSE 'C3' || LPAD(TO_CHAR(room_number_bases.c_suffix + room_numbers.room_seq - room_split.b_room_count), 2, '0')
       END,
       CASE WHEN MOD(room_numbers.room_seq, 2) = 0 THEN 'AC' ELSE 'NON-AC' END,
       4,
       3
FROM room_numbers
CROSS JOIN room_split
CROSS JOIN hostel_ids
CROSS JOIN room_id_base
CROSS JOIN room_number_bases;

PROMPT Creating 100 realistic synthetic student records...

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
WITH
first_names AS (
    SELECT 1 AS name_order, 'Arjun' AS first_name, 'MALE' AS gender FROM dual UNION ALL
    SELECT 2, 'Aarav', 'MALE' FROM dual UNION ALL
    SELECT 3, 'Rohan', 'MALE' FROM dual UNION ALL
    SELECT 4, 'Karthik', 'MALE' FROM dual UNION ALL
    SELECT 5, 'Aditya', 'MALE' FROM dual UNION ALL
    SELECT 6, 'Rahul', 'MALE' FROM dual UNION ALL
    SELECT 7, 'Vikram', 'MALE' FROM dual UNION ALL
    SELECT 8, 'Nikhil', 'MALE' FROM dual UNION ALL
    SELECT 9, 'Sandeep', 'MALE' FROM dual UNION ALL
    SELECT 10, 'Ishaan', 'MALE' FROM dual UNION ALL
    SELECT 11, 'Ananya', 'FEMALE' FROM dual UNION ALL
    SELECT 12, 'Priya', 'FEMALE' FROM dual UNION ALL
    SELECT 13, 'Sneha', 'FEMALE' FROM dual UNION ALL
    SELECT 14, 'Aditi', 'FEMALE' FROM dual UNION ALL
    SELECT 15, 'Kavya', 'FEMALE' FROM dual UNION ALL
    SELECT 16, 'Meera', 'FEMALE' FROM dual UNION ALL
    SELECT 17, 'Divya', 'FEMALE' FROM dual UNION ALL
    SELECT 18, 'Nisha', 'FEMALE' FROM dual UNION ALL
    SELECT 19, 'Tanvi', 'FEMALE' FROM dual UNION ALL
    SELECT 20, 'Keerthi', 'FEMALE' FROM dual
),
surnames AS (
    SELECT 1 AS surname_order, 'Nair' AS surname FROM dual UNION ALL
    SELECT 2, 'Sharma' FROM dual UNION ALL
    SELECT 3, 'Reddy' FROM dual UNION ALL
    SELECT 4, 'Iyer' FROM dual UNION ALL
    SELECT 5, 'Menon' FROM dual
),
departments AS (
    SELECT 1 AS department_order, 'Computer Science' AS department FROM dual UNION ALL
    SELECT 2, 'Information Technology' FROM dual UNION ALL
    SELECT 3, 'Electronics and Communication' FROM dual UNION ALL
    SELECT 4, 'Electrical Engineering' FROM dual UNION ALL
    SELECT 5, 'Mechanical Engineering' FROM dual UNION ALL
    SELECT 6, 'Civil Engineering' FROM dual UNION ALL
    SELECT 7, 'Biotechnology' FROM dual UNION ALL
    SELECT 8, 'Data Science' FROM dual UNION ALL
    SELECT 9, 'Business Administration' FROM dual UNION ALL
    SELECT 10, 'Architecture' FROM dual
),
student_seed AS (
    SELECT ROW_NUMBER() OVER (ORDER BY first_names.name_order, surnames.surname_order) AS seq,
           first_names.first_name,
           surnames.surname,
           first_names.gender
    FROM first_names
    CROSS JOIN surnames
)
SELECT (SELECT NVL(MAX(student_id), 0) FROM student) + student_seed.seq,
       '26BCE' || TO_CHAR(1000 + student_seed.seq),
       student_seed.first_name || ' ' || student_seed.surname,
       student_seed.gender,
       '98' || LPAD(TO_CHAR(60000000 + student_seed.seq), 8, '0'),
       LOWER(student_seed.first_name || '.' || student_seed.surname ||
             TO_CHAR(student_seed.seq, 'FM000') || '@example.com'),
       departments.department,
       MOD(student_seed.seq - 1, 5) + 1
FROM student_seed
JOIN departments
    ON departments.department_order = MOD(student_seed.seq - 1, 10) + 1;

PROMPT Assigning each student to an available bed...

INSERT INTO room_allocation (
    allocation_id,
    student_id,
    room_id,
    allocation_date,
    status
)
WITH
ranked_students AS (
    SELECT student_id,
           ROW_NUMBER() OVER (ORDER BY student_id) AS bed_seq
    FROM student
),
room_occupancy AS (
    SELECT r.room_id,
           r.room_number,
           h.hostel_name,
           r.capacity - COUNT(a.allocation_id) AS available_beds
    FROM room r
    JOIN hostel h ON h.hostel_id = r.hostel_id
    LEFT JOIN room_allocation a
        ON a.room_id = r.room_id
       AND a.status = 'ACTIVE'
    GROUP BY r.room_id, r.room_number, h.hostel_name, r.capacity
),
bed_numbers AS (
    SELECT LEVEL AS bed_number
    FROM dual
    CONNECT BY LEVEL <= 4
),
ranked_beds AS (
    SELECT room_occupancy.room_id,
           ROW_NUMBER() OVER (
               ORDER BY room_occupancy.hostel_name,
                        room_occupancy.room_number,
                        bed_numbers.bed_number
           ) AS bed_seq
    FROM room_occupancy
    JOIN bed_numbers
        ON bed_numbers.bed_number <= room_occupancy.available_beds
),
allocation_id_base AS (
    SELECT NVL(MAX(allocation_id), 0) AS max_allocation_id
    FROM room_allocation
)
SELECT allocation_id_base.max_allocation_id + ranked_students.bed_seq,
       ranked_students.student_id,
       ranked_beds.room_id,
       TRUNC(SYSDATE),
       'ACTIVE'
FROM ranked_students
JOIN ranked_beds ON ranked_beds.bed_seq = ranked_students.bed_seq
CROSS JOIN allocation_id_base;

COMMIT;

PROMPT Reset complete. Expected: 100 students and 100 active room allocations.
SELECT COUNT(*) AS student_count FROM student;
SELECT COUNT(*) AS active_allocation_count
FROM room_allocation
WHERE status = 'ACTIVE';

SELECT h.hostel_name,
       r.room_number,
       r.room_type,
       r.capacity,
       COUNT(a.allocation_id) AS residents
FROM room r
JOIN hostel h ON h.hostel_id = r.hostel_id
LEFT JOIN room_allocation a
    ON a.room_id = r.room_id
   AND a.status = 'ACTIVE'
GROUP BY h.hostel_name, r.room_number, r.room_type, r.capacity
HAVING COUNT(a.allocation_id) > 0
ORDER BY h.hostel_name, r.room_number;
