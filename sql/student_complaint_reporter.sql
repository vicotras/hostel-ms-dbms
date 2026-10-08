-- Run once after sql/student_complaints.sql.
-- Links student-submitted reports to the authenticated reporter's student row.

ALTER TABLE student_complaint ADD (
    reporter_student_id NUMBER(10)
);

ALTER TABLE student_complaint ADD CONSTRAINT fk_sc_reporter_student
    FOREIGN KEY (reporter_student_id) REFERENCES student(student_id);

CREATE INDEX idx_sc_reporter_student
    ON student_complaint(reporter_student_id);

COMMIT;
