-- Inserts synthetic hostel and warden rows for a fresh demonstration schema.
-- Run after sql/create_hostel_schema.sql and before sql/reset_students_realistic.sql.

SET DEFINE OFF
WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK

INSERT INTO hostel (hostel_id, hostel_name, hostel_type, capacity, location)
VALUES (1, 'B-Block Hostel', 'BOYS', 50, 'North Campus');

INSERT INTO hostel (hostel_id, hostel_name, hostel_type, capacity, location)
VALUES (2, 'C-Block Hostel', 'GIRLS', 50, 'South Campus');

INSERT INTO warden (warden_id, warden_name, phone, email, hostel_id)
VALUES (1, 'Asha Rao', '9000000001', 'warden.b@example.com', 1);

INSERT INTO warden (warden_id, warden_name, phone, email, hostel_id)
VALUES (2, 'Kiran Nair', '9000000002', 'warden.c@example.com', 2);

COMMIT;

SELECT h.hostel_name, w.warden_name, w.phone
FROM hostel h
JOIN warden w ON w.hostel_id = h.hostel_id
ORDER BY h.hostel_name;
