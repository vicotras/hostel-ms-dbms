-- Add first-login password changes for student accounts using registration numbers.
-- Run this once in SQL*Plus before running provision-student-accounts.js.

SET DEFINE OFF
WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK

ALTER TABLE app_account ADD (
    must_change_password CHAR(1) DEFAULT 'N' NOT NULL
);

ALTER TABLE app_account ADD CONSTRAINT chk_app_account_must_change
    CHECK (must_change_password IN ('Y', 'N'));

UPDATE app_account
SET must_change_password = 'Y'
WHERE role = 'STUDENT';

COMMIT;
PROMPT First-login password change is enabled for existing student accounts.
