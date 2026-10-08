-- Separate records for complaints made against a hosteller.
-- This does not change the existing COMPLAINT table used for hostel issues.

CREATE TABLE student_complaint (
    complaint_id       NUMBER(8)       CONSTRAINT pk_student_complaint PRIMARY KEY,
    accused_student_id NUMBER(10)      NOT NULL,
    complaint_type     VARCHAR2(30)   NOT NULL,
    description        VARCHAR2(500)  NOT NULL,
    complaint_date     DATE           DEFAULT SYSDATE NOT NULL,
    reported_by        VARCHAR2(100),
    reporter_student_id NUMBER(10),
    status             VARCHAR2(20)   DEFAULT 'PENDING' NOT NULL,
    resolution         VARCHAR2(500),
    resolved_date      DATE,
    CONSTRAINT fk_sc_accused_student
        FOREIGN KEY (accused_student_id) REFERENCES student(student_id),
    CONSTRAINT fk_sc_reporter_student
        FOREIGN KEY (reporter_student_id) REFERENCES student(student_id),
    CONSTRAINT chk_sc_status
        CHECK (status IN ('PENDING', 'IN PROGRESS', 'RESOLVED', 'DISMISSED'))
);

CREATE INDEX idx_sc_accused_student
    ON student_complaint(accused_student_id);

CREATE INDEX idx_sc_reporter_student
    ON student_complaint(reporter_student_id);
