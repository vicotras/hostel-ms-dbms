-- Allocates sample students created by sample_100_students.sql
-- into currently available beds, without exceeding room capacity.
-- Run this after @sql/sample_100_students.sql:
--   @sql/allocate_sample_students_to_rooms.sql

LOCK TABLE room_allocation IN EXCLUSIVE MODE;

INSERT INTO room_allocation (
    allocation_id,
    student_id,
    room_id,
    allocation_date,
    status
)
WITH
sample_students AS (
    SELECT student_id,
           ROW_NUMBER() OVER (ORDER BY student_id) AS slot_number
    FROM student s
    WHERE s.registration_no LIKE '25BCE%'
      AND s.student_name LIKE 'Sample Student %'
      AND NOT EXISTS (
          SELECT 1
          FROM room_allocation existing
          WHERE existing.student_id = s.student_id
            AND existing.status = 'ACTIVE'
      )
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
available_beds AS (
    SELECT ro.room_id,
           ro.hostel_name,
           ro.room_number,
           bn.bed_number
    FROM room_occupancy ro
    JOIN bed_numbers bn ON bn.bed_number <= ro.available_beds
),
ranked_beds AS (
    SELECT room_id,
           ROW_NUMBER() OVER (
               ORDER BY hostel_name, room_number, bed_number
           ) AS slot_number
    FROM available_beds
),
next_allocation_id AS (
    SELECT NVL(MAX(allocation_id), 0) AS max_id
    FROM room_allocation
)
SELECT next_allocation_id.max_id + sample_students.slot_number,
       sample_students.student_id,
       ranked_beds.room_id,
       TRUNC(SYSDATE),
       'ACTIVE'
FROM sample_students
JOIN ranked_beds
    ON ranked_beds.slot_number = sample_students.slot_number
CROSS JOIN next_allocation_id;

COMMIT;

-- Show the sample students that now have an active room.
SELECT s.registration_no,
       s.student_name,
       h.hostel_name,
       r.room_number,
       a.allocation_date,
       a.status
FROM room_allocation a
JOIN student s ON s.student_id = a.student_id
JOIN room r ON r.room_id = a.room_id
JOIN hostel h ON h.hostel_id = r.hostel_id
WHERE s.registration_no LIKE '25BCE%'
  AND s.student_name LIKE 'Sample Student %'
  AND a.status = 'ACTIVE'
ORDER BY h.hostel_name, r.room_number, s.student_id;
