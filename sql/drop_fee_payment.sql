-- Permanently drops FEE_PAYMENT from the schema connected in SQL*Plus.
-- Run only after confirming you are connected to the Hostel Management schema.

SET DEFINE OFF
SET SERVEROUTPUT ON
WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK

DECLARE
    table_count PLS_INTEGER;
BEGIN
    SELECT COUNT(*) INTO table_count
    FROM user_tables
    WHERE table_name = 'FEE_PAYMENT';

    IF table_count = 1 THEN
        EXECUTE IMMEDIATE 'DROP TABLE FEE_PAYMENT PURGE';
        DBMS_OUTPUT.PUT_LINE('FEE_PAYMENT was dropped permanently.');
    ELSE
        DBMS_OUTPUT.PUT_LINE('FEE_PAYMENT does not exist in the connected schema; nothing to drop.');
    END IF;
END;
/
