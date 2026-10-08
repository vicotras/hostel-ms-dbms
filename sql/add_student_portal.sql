-- Add linked student sign-in accounts while preserving existing Admin/Warden accounts.
-- Run in SQL*Plus before restarting the Node server:
--   @C:\Users\Admin\hostel-management\sql\add_student_portal.sql

SET DEFINE OFF
WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK

ALTER TABLE app_account ADD (
    student_id NUMBER(10)
);

ALTER TABLE app_account DROP CONSTRAINT chk_app_account_role;

ALTER TABLE app_account ADD CONSTRAINT chk_app_account_role
    CHECK (role IN ('ADMIN', 'WARDEN', 'STUDENT'));

ALTER TABLE app_account ADD CONSTRAINT fk_app_account_student
    FOREIGN KEY (student_id) REFERENCES student(student_id);

ALTER TABLE app_account ADD CONSTRAINT uq_app_account_student
    UNIQUE (student_id);

ALTER TABLE app_account ADD CONSTRAINT chk_app_account_student_link
    CHECK (
        (role = 'STUDENT' AND student_id IS NOT NULL)
        OR (role IN ('ADMIN', 'WARDEN') AND student_id IS NULL)
    );

PROMPT Student portal account support is ready.
SELECT role, COUNT(*) AS account_count
FROM app_account
GROUP BY role
ORDER BY role;

