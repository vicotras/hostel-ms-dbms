-- Local application accounts for Admin, Warden, and Student sign-in.
-- Oracle SYSTEM credentials remain in the existing local db.js config.

CREATE TABLE app_account (
    account_id     NUMBER(8)      CONSTRAINT pk_app_account PRIMARY KEY,
    username       VARCHAR2(50)   NOT NULL,
    password_salt  VARCHAR2(32)   NOT NULL,
    password_hash  VARCHAR2(128)  NOT NULL,
    role           VARCHAR2(10)   NOT NULL,
    is_active      CHAR(1)        DEFAULT 'Y' NOT NULL,
    student_id     NUMBER(10),
    must_change_password CHAR(1)  DEFAULT 'N' NOT NULL,
    created_at     DATE           DEFAULT SYSDATE NOT NULL,
    CONSTRAINT uq_app_account_username UNIQUE (username),
    CONSTRAINT uq_app_account_student UNIQUE (student_id),
    CONSTRAINT fk_app_account_student FOREIGN KEY (student_id) REFERENCES student(student_id),
    CONSTRAINT chk_app_account_role CHECK (role IN ('ADMIN', 'WARDEN', 'STUDENT')),
    CONSTRAINT chk_app_account_active CHECK (is_active IN ('Y', 'N')),
    CONSTRAINT chk_app_account_must_change CHECK (must_change_password IN ('Y', 'N')),
    CONSTRAINT chk_app_account_student_link CHECK (
        (role = 'STUDENT' AND student_id IS NOT NULL)
        OR (role IN ('ADMIN', 'WARDEN') AND student_id IS NULL)
    )
);
