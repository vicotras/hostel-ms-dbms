const express = require("express");
const cors = require("cors");
const crypto = require("node:crypto");
const { getConnection } = require("./db");
const { hashPassword, verifyPassword } = require("./auth-utils");

const app = express();

app.use(cors());
app.use(express.json());

const SESSION_COOKIE = "hostel_session";
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();

function getSessionToken(req) {
    const cookie = (req.headers.cookie || "").split(";").map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`));
    return cookie ? cookie.slice(SESSION_COOKIE.length + 1) : null;
}

function requireAuth(req, res, next) {
    const token = getSessionToken(req);
    const session = token && sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
        if (token) sessions.delete(token);
        return res.status(401).json({ error: "Please sign in to continue." });
    }
    session.expiresAt = Date.now() + SESSION_LIFETIME_MS;
    req.user = session.user;
    next();
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: "Your account does not have permission for this action." });
        next();
    };
}

function requireStudentAccount(req, res, next) {
    if (!req.user || req.user.role !== "STUDENT") return res.status(403).json({ error: "This page is for student accounts." });
    if (!Number.isInteger(Number(req.user.studentId)) || Number(req.user.studentId) < 1) return res.status(403).json({ error: "This student login is not linked to a student record." });
    next();
}

app.post("/api/auth/login", async (req, res) => {
    let connection;
    const username = String(req.body?.username ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    if (!/^[a-z0-9._-]{3,50}$/.test(username) || !password || password.length > 256) {
        return res.status(401).json({ error: "Username or password is incorrect." });
    }
    try {
        connection = await getConnection();
        const result = await connection.execute(`
            SELECT account_id, username, password_salt, password_hash, role, student_id, must_change_password
            FROM app_account
            WHERE username = :username AND is_active = 'Y'
        `, { username });
        const account = result.rows[0];
        if (!account || !(await verifyPassword(password, account[2], account[3]))) {
            return res.status(401).json({ error: "Username or password is incorrect." });
        }
        const token = crypto.randomBytes(32).toString("hex");
        const user = { id: account[0], username: account[1], role: account[4], studentId: account[5], mustChangePassword: account[6] === "Y" };
        sessions.set(token, { user, expiresAt: Date.now() + SESSION_LIFETIME_MS });
        for (const [existingToken, session] of sessions) if (session.expiresAt <= Date.now()) sessions.delete(existingToken);
        const secure = req.secure ? "; Secure" : "";
        res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_LIFETIME_MS / 1000}${secure}`);
        res.json({ user });
    } catch (error) {
        console.error("LOGIN ERROR:", error);
        if (error.errorNum === 942) return res.status(503).json({ error: "The account table is not set up yet. Run sql/app_account.sql first." });
        res.status(500).json({ error: "Unable to sign in right now." });
    } finally {
        if (connection) await connection.close();
    }
});

app.post("/api/auth/change-password", requireAuth, async (req, res) => {
    const currentPassword = String(req.body?.current_password ?? "");
    const newPassword = String(req.body?.new_password ?? "");
    if (newPassword.length < 12 || newPassword.length > 256) return res.status(400).json({ error: "Choose a password between 12 and 256 characters." });
    if (newPassword === currentPassword) return res.status(400).json({ error: "Choose a new password different from the initial password." });

    let connection;
    try {
        connection = await getConnection();
        const accountResult = await connection.execute(`
            SELECT password_salt, password_hash
            FROM app_account
            WHERE account_id = :account_id AND is_active = 'Y'
        `, { account_id: req.user.id });
        if (!accountResult.rows.length || !(await verifyPassword(currentPassword, accountResult.rows[0][0], accountResult.rows[0][1]))) {
            return res.status(401).json({ error: "Current password is incorrect." });
        }
        const { salt, hash } = await hashPassword(newPassword);
        await connection.execute(`
            UPDATE app_account
            SET password_salt = :password_salt,
                password_hash = :password_hash,
                must_change_password = 'N'
            WHERE account_id = :account_id
        `, { password_salt: salt, password_hash: hash, account_id: req.user.id }, { autoCommit: true });
        const token = getSessionToken(req);
        if (token && sessions.has(token)) sessions.get(token).user.mustChangePassword = false;
        res.json({ message: "Password updated. Welcome to your portal." });
    } catch (error) {
        console.error("CHANGE PASSWORD ERROR:", error);
        res.status(500).json({ error: "Could not update the password." });
    } finally {
        if (connection) await connection.close();
    }
});

app.get("/api/auth/me", requireAuth, (req, res) => res.json({ user: req.user }));

app.post("/api/auth/logout", requireAuth, (req, res) => {
    const token = getSessionToken(req);
    if (token) sessions.delete(token);
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.json({ message: "Signed out." });
});

// All application APIs require a signed-in account.
app.use("/api", requireAuth);
app.use("/api", (req, res, next) => {
    if (req.user.mustChangePassword && req.path !== "/auth/change-password") return res.status(403).json({ error: "Change your initial password before using the portal." });
    const isStudentRoute = req.path.startsWith("/student/");
    if (req.user.role === "STUDENT" && !isStudentRoute) return res.status(403).json({ error: "Students can only access their own portal." });
    if (req.user.role !== "STUDENT" && isStudentRoute) return res.status(403).json({ error: "This endpoint is for student accounts." });
    next();
});

// Keep only the login screen public; static pages are protected like the APIs.
app.use((req, res, next) => {
    if (req.path === "/login.html") return next();
    if (req.path.startsWith("/api/")) return next();
    const token = getSessionToken(req);
    const session = token && sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) return res.redirect("/login.html");
    session.expiresAt = Date.now() + SESSION_LIFETIME_MS;
    req.user = session.user;
    if (req.user.mustChangePassword && !["/change-password.html", "/auth.js", "/sidebar.css"].includes(req.path)) return res.redirect("/change-password.html");
    if (!req.user.mustChangePassword && req.path === "/change-password.html") return res.redirect("/");
    if (req.user.role === "STUDENT" && !["/student-portal.html", "/change-password.html", "/auth.js", "/sidebar.css"].includes(req.path)) return res.redirect("/student-portal.html");
    if (req.user.role !== "STUDENT" && req.path === "/student-portal.html") return res.redirect("/");
    next();
});


// ==========================================
// HOME PAGE
// ==========================================

app.get("/", (req, res) => {
    if (req.user?.role === "STUDENT") return res.redirect("/student-portal.html");
    res.sendFile(__dirname + "/public/index.html");
});

app.use(express.static("public"));


// ==========================================
// STUDENTS
// ==========================================

// GET ALL STUDENTS
app.get("/api/students", async (req, res) => {

    let connection;

    try {

        connection = await getConnection();

        const result = await connection.execute(`
            SELECT student_id,
                   registration_no,
                   student_name,
                   gender,
                   phone,
                   email,
                   department,
                   year_of_study
            FROM student
            ORDER BY student_id
        `);

        res.json(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Failed to fetch students"
        });

    } finally {

        if (connection) {
            await connection.close();
        }

    }

});


// ADD STUDENT
app.post("/api/students", async (req, res) => {

    let connection;

    try {

        const {
            registration_no,
            student_name,
            gender,
            phone,
            email,
            department,
            year_of_study
        } = req.body;

        if (
            !registration_no ||
            !student_name ||
            !gender ||
            !phone ||
            !email ||
            !department ||
            !year_of_study
        ) {

            return res.status(400).json({
                error: "All fields are required"
            });

        }

        connection = await getConnection();

        const idResult = await connection.execute(`
            SELECT NVL(MAX(student_id), 0) + 1
            FROM student
        `);

        const studentId = idResult.rows[0][0];

        await connection.execute(
            `
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
            VALUES (
                :student_id,
                :registration_no,
                :student_name,
                :gender,
                :phone,
                :email,
                :department,
                :year_of_study
            )
            `,
            {
                student_id: studentId,
                registration_no,
                student_name,
                gender,
                phone,
                email,
                department,
                year_of_study: Number(year_of_study)
            },
            {
                autoCommit: true
            }
        );

        res.status(201).json({
            message: "Student added successfully",
            student_id: studentId
        });

    } catch (error) {

        console.error("ADD STUDENT ERROR:", error);

        if (error.errorNum === 1) {

            return res.status(409).json({
                error: "Registration number, phone, or email already exists"
            });

        }

        res.status(500).json({
            error: "Failed to add student"
        });

    } finally {

        if (connection) {
            await connection.close();
        }

    }

});


// UPDATE STUDENT
app.put("/api/students/:id", async (req, res) => {

    let connection;

    try {

        const studentId = Number(req.params.id);

        const {
            registration_no,
            student_name,
            gender,
            phone,
            email,
            department,
            year_of_study
        } = req.body;

        if (
            !registration_no ||
            !student_name ||
            !gender ||
            !phone ||
            !email ||
            !department ||
            !year_of_study
        ) {

            return res.status(400).json({
                error: "All fields are required"
            });

        }

        connection = await getConnection();

        const result = await connection.execute(
            `
            UPDATE student
            SET registration_no = :registration_no,
                student_name = :student_name,
                gender = :gender,
                phone = :phone,
                email = :email,
                department = :department,
                year_of_study = :year_of_study
            WHERE student_id = :student_id
            `,
            {
                registration_no,
                student_name,
                gender,
                phone,
                email,
                department,
                year_of_study: Number(year_of_study),
                student_id: studentId
            },
            {
                autoCommit: true
            }
        );

        if (result.rowsAffected === 0) {

            return res.status(404).json({
                error: "Student not found"
            });

        }

        res.json({
            message: "Student updated successfully"
        });

    } catch (error) {

        console.error("UPDATE STUDENT ERROR:", error);

        if (error.errorNum === 1) {

            return res.status(409).json({
                error: "Registration number, phone, or email already exists"
            });

        }

        res.status(500).json({
            error: "Failed to update student"
        });

    } finally {

        if (connection) {
            await connection.close();
        }

    }

});


// DELETE STUDENT
app.delete("/api/students/:id", requireRole("ADMIN"), async (req, res) => {

    let connection;

    try {

        const studentId = Number(req.params.id);

        connection = await getConnection();

        await connection.execute(
            `
            DELETE FROM student
            WHERE student_id = :student_id
            `,
            {
                student_id: studentId
            },
            {
                autoCommit: true
            }
        );

        res.json({
            message: "Student deleted successfully"
        });

    } catch (error) {

        console.error("DELETE STUDENT ERROR:", error);

        if (error.errorNum === 2292) {

            return res.status(409).json({
                error: "Cannot delete this student because related records exist."
            });

        }

        res.status(500).json({
            error: "Failed to delete student"
        });

    } finally {

        if (connection) {
            await connection.close();
        }

    }

});


// ==========================================
// VISITOR LOG
// ==========================================

function validateVisitorPayload(body) {
    const studentId = Number(body.student_id);
    const visitorName = String(body.visitor_name ?? "").trim();
    const relationship = String(body.relationship ?? "").trim();
    const phone = String(body.phone ?? "").trim();
    const visitDate = String(body.visit_date ?? "");
    const inTime = String(body.in_time ?? "").trim();
    const outTime = String(body.out_time ?? "").trim();
    const purpose = String(body.purpose ?? "").trim();
    if (!Number.isInteger(studentId) || studentId < 1) return { error: "Select a student." };
    if (!visitorName || visitorName.length > 100) return { error: "Visitor name is required and must be 100 characters or fewer." };
    if (relationship.length > 30) return { error: "Relationship must be 30 characters or fewer." };
    if (phone.length > 15) return { error: "Phone must be 15 characters or fewer." };
    if (!isValidDateOnly(visitDate)) return { error: "Enter a valid visit date." };
    if (inTime.length > 10 || outTime.length > 10) return { error: "Visit times must be 10 characters or fewer." };
    if (purpose.length > 200) return { error: "Purpose must be 200 characters or fewer." };
    return { values: { student_id: studentId, visitor_name: visitorName, relationship: relationship || null, phone: phone || null, visit_date: visitDate, in_time: inTime || null, out_time: outTime || null, purpose: purpose || null } };
}

app.get("/api/visitors", async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(`
            SELECT v.visitor_id, v.student_id, s.registration_no, s.student_name,
                   v.visitor_name, v.relationship, v.phone, TO_CHAR(v.visit_date, 'YYYY-MM-DD'),
                   v.in_time, v.out_time, v.purpose
            FROM visitor v
            JOIN student s ON s.student_id = v.student_id
            ORDER BY v.visit_date DESC, v.visitor_id DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error("GET VISITORS ERROR:", error);
        res.status(500).json({ error: "Failed to fetch visitor log" });
    } finally {
        if (connection) await connection.close();
    }
});

app.post("/api/visitors", async (req, res) => {
    let connection;
    const validated = validateVisitorPayload(req.body);
    if (validated.error) return res.status(400).json({ error: validated.error });
    try {
        connection = await getConnection();
        const idResult = await connection.execute("SELECT NVL(MAX(visitor_id), 0) + 1 FROM visitor");
        const visitorId = idResult.rows[0][0];
        await connection.execute(`
            INSERT INTO visitor (visitor_id, student_id, visitor_name, relationship, phone, visit_date, in_time, out_time, purpose)
            VALUES (:visitor_id, :student_id, :visitor_name, :relationship, :phone,
                    TO_DATE(:visit_date, 'YYYY-MM-DD'), :in_time, :out_time, :purpose)
        `, { visitor_id: visitorId, ...validated.values }, { autoCommit: true });
        res.status(201).json({ message: "Visitor entry added successfully", visitor_id: visitorId });
    } catch (error) {
        console.error("ADD VISITOR ERROR:", error);
        if (error.errorNum === 2291) return res.status(400).json({ error: "Selected student does not exist." });
        res.status(500).json({ error: "Failed to add visitor entry" });
    } finally {
        if (connection) await connection.close();
    }
});

app.put("/api/visitors/:id", async (req, res) => {
    let connection;
    const visitorId = Number(req.params.id);
    if (!Number.isInteger(visitorId) || visitorId < 1) return res.status(400).json({ error: "Invalid visitor ID." });
    const validated = validateVisitorPayload(req.body);
    if (validated.error) return res.status(400).json({ error: validated.error });
    try {
        connection = await getConnection();
        const result = await connection.execute(`
            UPDATE visitor
            SET student_id = :student_id, visitor_name = :visitor_name, relationship = :relationship,
                phone = :phone, visit_date = TO_DATE(:visit_date, 'YYYY-MM-DD'),
                in_time = :in_time, out_time = :out_time, purpose = :purpose
            WHERE visitor_id = :visitor_id
        `, { ...validated.values, visitor_id: visitorId }, { autoCommit: true });
        if (result.rowsAffected === 0) return res.status(404).json({ error: "Visitor entry not found." });
        res.json({ message: "Visitor entry updated successfully" });
    } catch (error) {
        console.error("UPDATE VISITOR ERROR:", error);
        if (error.errorNum === 2291) return res.status(400).json({ error: "Selected student does not exist." });
        res.status(500).json({ error: "Failed to update visitor entry" });
    } finally {
        if (connection) await connection.close();
    }
});

app.delete("/api/visitors/:id", requireRole("ADMIN"), async (req, res) => {
    let connection;
    const visitorId = Number(req.params.id);
    if (!Number.isInteger(visitorId) || visitorId < 1) return res.status(400).json({ error: "Invalid visitor ID." });
    try {
        connection = await getConnection();
        const result = await connection.execute("DELETE FROM visitor WHERE visitor_id = :visitor_id", { visitor_id: visitorId }, { autoCommit: true });
        if (result.rowsAffected === 0) return res.status(404).json({ error: "Visitor entry not found." });
        res.json({ message: "Visitor entry deleted successfully" });
    } catch (error) {
        console.error("DELETE VISITOR ERROR:", error);
        res.status(500).json({ error: "Failed to delete visitor entry" });
    } finally {
        if (connection) await connection.close();
    }
});


// ==========================================
// LEAVE REQUESTS
// ==========================================

const LEAVE_STATUSES = new Set(["PENDING", "APPROVED", "REJECTED"]);

app.get("/api/leave-requests", async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(`
            SELECT l.leave_id, l.student_id, s.registration_no, s.student_name, s.phone,
                   TO_CHAR(l.from_date, 'YYYY-MM-DD'), TO_CHAR(l.to_date, 'YYYY-MM-DD'),
                   l.reason, l.status, TO_CHAR(l.applied_date, 'YYYY-MM-DD HH24:MI'), l.remarks
            FROM leave_request l
            JOIN student s ON s.student_id = l.student_id
            ORDER BY CASE l.status WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END,
                     l.applied_date DESC, l.leave_id DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error("GET LEAVE REQUESTS ERROR:", error);
        res.status(500).json({ error: "Failed to fetch leave requests" });
    } finally {
        if (connection) await connection.close();
    }
});

app.put("/api/leave-requests/:id", async (req, res) => {
    let connection;
    const leaveId = Number(req.params.id);
    const status = String(req.body.status ?? "").trim().toUpperCase();
    const remarks = String(req.body.remarks ?? "").trim();
    if (!Number.isInteger(leaveId) || leaveId < 1) return res.status(400).json({ error: "Invalid leave request ID." });
    if (!LEAVE_STATUSES.has(status)) return res.status(400).json({ error: "Choose Pending, Approved, or Rejected." });
    if (remarks.length > 500) return res.status(400).json({ error: "Remarks must be 500 characters or fewer." });
    try {
        connection = await getConnection();
        const result = await connection.execute(`
            UPDATE leave_request
            SET status = :status, remarks = :remarks
            WHERE leave_id = :leave_id
        `, { status, remarks: remarks || null, leave_id: leaveId }, { autoCommit: true });
        if (result.rowsAffected === 0) return res.status(404).json({ error: "Leave request not found." });
        res.json({ message: `Leave request ${status.toLowerCase()} successfully` });
    } catch (error) {
        console.error("UPDATE LEAVE REQUEST ERROR:", error);
        if (error.errorNum === 2290) return res.status(400).json({ error: "Choose a valid leave request status." });
        res.status(500).json({ error: "Failed to update leave request" });
    } finally {
        if (connection) await connection.close();
    }
});


// ==========================================
// COMPLAINTS AGAINST HOSTELLERS
// Kept separate from COMPLAINT, which tracks issues reported by students.
// ==========================================

const REPORTED_COMPLAINT_STATUSES = new Set(["PENDING", "IN PROGRESS", "RESOLVED", "DISMISSED"]);

function validateReportedComplaintPayload(body) {
    const accusedStudentId = Number(body.accused_student_id);
    const complaintType = String(body.complaint_type ?? "").trim();
    const description = String(body.description ?? "").trim();
    const complaintDate = String(body.complaint_date ?? "");
    const reportedBy = String(body.reported_by ?? "").trim();
    const status = String(body.status ?? "").trim().toUpperCase();
    const resolution = String(body.resolution ?? "").trim();
    const resolvedDate = String(body.resolved_date ?? "");
    if (!Number.isInteger(accusedStudentId) || accusedStudentId < 1) return { error: "Select the hosteller the complaint is against." };
    if (!complaintType || complaintType.length > 30) return { error: "Complaint type is required and must be 30 characters or fewer." };
    if (!description || description.length > 500) return { error: "Description is required and must be 500 characters or fewer." };
    if (!isValidDateOnly(complaintDate)) return { error: "Enter a valid complaint date." };
    if (reportedBy.length > 100) return { error: "Reported by must be 100 characters or fewer." };
    if (!REPORTED_COMPLAINT_STATUSES.has(status)) return { error: "Select a valid status." };
    if (resolution.length > 500) return { error: "Resolution must be 500 characters or fewer." };
    if (resolvedDate && !isValidDateOnly(resolvedDate)) return { error: "Enter a valid resolution date." };
    return { values: { accused_student_id: accusedStudentId, complaint_type: complaintType, description, complaint_date: complaintDate, reported_by: reportedBy || null, status, resolution: resolution || null, resolved_date: resolvedDate || null } };
}

app.get("/api/complaint-zones", async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(`
            SELECT s.student_id, s.registration_no, s.student_name, s.department,
                   (SELECT COUNT(*) FROM student_complaint c
                    WHERE c.accused_student_id = s.student_id AND c.status <> 'DISMISSED') AS complaint_count,
                   (SELECT COUNT(*) FROM student_complaint c
                    WHERE c.accused_student_id = s.student_id AND c.status IN ('PENDING', 'IN PROGRESS')) AS active_count,
                   (SELECT TO_CHAR(MAX(c.complaint_date), 'YYYY-MM-DD') FROM student_complaint c
                    WHERE c.accused_student_id = s.student_id AND c.status <> 'DISMISSED') AS latest_complaint_date
            FROM student s
            ORDER BY complaint_count DESC, s.student_name
        `);
        res.json(result.rows);
    } catch (error) {
        console.error("GET COMPLAINT ZONES ERROR:", error);
        if (error.errorNum === 942) return res.status(503).json({ error: "The separate student complaint table has not been created yet. Run sql/student_complaints.sql first." });
        res.status(500).json({ error: "Failed to fetch student complaint counts" });
    } finally {
        if (connection) await connection.close();
    }
});

app.get("/api/student-complaints", async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(`
            SELECT c.complaint_id, c.accused_student_id, s.registration_no, s.student_name,
                   s.department, c.complaint_type, c.description,
                   TO_CHAR(c.complaint_date, 'YYYY-MM-DD'), c.reported_by, c.status,
                   c.resolution, TO_CHAR(c.resolved_date, 'YYYY-MM-DD'), c.reporter_student_id
            FROM student_complaint c
            JOIN student s ON s.student_id = c.accused_student_id
            ORDER BY c.complaint_date DESC, c.complaint_id DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error("GET STUDENT COMPLAINTS ERROR:", error);
        if (error.errorNum === 942) return res.status(503).json({ error: "The separate student complaint table has not been created yet. Run sql/student_complaints.sql first." });
        res.status(500).json({ error: "Failed to fetch complaints against students" });
    } finally {
        if (connection) await connection.close();
    }
});

app.post("/api/student-complaints", async (req, res) => {
    let connection;
    const validated = validateReportedComplaintPayload(req.body);
    if (validated.error) return res.status(400).json({ error: validated.error });
    try {
        connection = await getConnection();
        const idResult = await connection.execute("SELECT NVL(MAX(complaint_id), 0) + 1 FROM student_complaint");
        const complaintId = idResult.rows[0][0];
        await connection.execute(`
            INSERT INTO student_complaint (complaint_id, accused_student_id, complaint_type, description, complaint_date, reported_by, status, resolution, resolved_date)
            VALUES (:complaint_id, :accused_student_id, :complaint_type, :description,
                    TO_DATE(:complaint_date, 'YYYY-MM-DD'), :reported_by, :status, :resolution,
                    CASE WHEN :status = 'RESOLVED' THEN NVL(TO_DATE(:resolved_date, 'YYYY-MM-DD'), SYSDATE) ELSE NULL END)
        `, { complaint_id: complaintId, ...validated.values }, { autoCommit: true });
        res.status(201).json({ message: "Complaint against hosteller added successfully", complaint_id: complaintId });
    } catch (error) {
        console.error("ADD STUDENT COMPLAINT ERROR:", error);
        if (error.errorNum === 2291) return res.status(400).json({ error: "Selected hosteller does not exist." });
        if (error.errorNum === 2290) return res.status(400).json({ error: "Check the complaint status." });
        res.status(500).json({ error: "Failed to add complaint against hosteller" });
    } finally {
        if (connection) await connection.close();
    }
});

app.put("/api/student-complaints/:id", async (req, res) => {
    let connection;
    const complaintId = Number(req.params.id);
    if (!Number.isInteger(complaintId) || complaintId < 1) return res.status(400).json({ error: "Invalid complaint ID." });
    const validated = validateReportedComplaintPayload(req.body);
    if (validated.error) return res.status(400).json({ error: validated.error });
    try {
        connection = await getConnection();
        const result = await connection.execute(`
            UPDATE student_complaint
            SET accused_student_id = :accused_student_id, complaint_type = :complaint_type,
                description = :description, complaint_date = TO_DATE(:complaint_date, 'YYYY-MM-DD'),
                reported_by = :reported_by, status = :status, resolution = :resolution,
                resolved_date = CASE WHEN :status = 'RESOLVED'
                                     THEN COALESCE(TO_DATE(:resolved_date, 'YYYY-MM-DD'), resolved_date, SYSDATE)
                                     ELSE NULL END
            WHERE complaint_id = :complaint_id
        `, { ...validated.values, complaint_id: complaintId }, { autoCommit: true });
        if (result.rowsAffected === 0) return res.status(404).json({ error: "Complaint not found." });
        res.json({ message: "Complaint against hosteller updated successfully" });
    } catch (error) {
        console.error("UPDATE STUDENT COMPLAINT ERROR:", error);
        if (error.errorNum === 2291) return res.status(400).json({ error: "Selected hosteller does not exist." });
        if (error.errorNum === 2290) return res.status(400).json({ error: "Check the complaint status." });
        res.status(500).json({ error: "Failed to update complaint against hosteller" });
    } finally {
        if (connection) await connection.close();
    }
});

app.delete("/api/student-complaints/:id", requireRole("ADMIN"), async (req, res) => {
    let connection;
    const complaintId = Number(req.params.id);
    if (!Number.isInteger(complaintId) || complaintId < 1) return res.status(400).json({ error: "Invalid complaint ID." });
    try {
        connection = await getConnection();
        const result = await connection.execute("DELETE FROM student_complaint WHERE complaint_id = :complaint_id", { complaint_id: complaintId }, { autoCommit: true });
        if (result.rowsAffected === 0) return res.status(404).json({ error: "Complaint not found." });
        res.json({ message: "Complaint against hosteller deleted successfully" });
    } catch (error) {
        console.error("DELETE STUDENT COMPLAINT ERROR:", error);
        res.status(500).json({ error: "Failed to delete complaint against hosteller" });
    } finally {
        if (connection) await connection.close();
    }
});


// ==========================================
// COMPLAINTS (HOSTEL ISSUES REPORTED BY STUDENTS)
// ==========================================

const COMPLAINT_TYPES = new Set(["ELECTRICAL", "PLUMBING", "CLEANING", "INTERNET", "ROOM", "MESS", "OTHER"]);
const COMPLAINT_STATUSES = new Set(["PENDING", "IN PROGRESS", "RESOLVED", "REJECTED"]);

function isValidDateOnly(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateComplaintPayload(body) {
    const studentId = Number(body.student_id);
    const complaintType = String(body.complaint_type ?? "").trim().toUpperCase();
    const description = String(body.description ?? "").trim();
    const complaintDate = String(body.complaint_date ?? "");
    const status = String(body.status ?? "").trim().toUpperCase();
    const resolution = String(body.resolution ?? "").trim();
    const resolvedDate = String(body.resolved_date ?? "");
    if (!Number.isInteger(studentId) || studentId < 1) return { error: "Select a student." };
    if (!COMPLAINT_TYPES.has(complaintType)) return { error: "Select a valid complaint type." };
    if (!description || description.length > 500) return { error: "Description is required and must be 500 characters or fewer." };
    if (!isValidDateOnly(complaintDate)) return { error: "Enter a valid complaint date." };
    if (!COMPLAINT_STATUSES.has(status)) return { error: "Select a valid complaint status." };
    if (resolution.length > 500) return { error: "Resolution must be 500 characters or fewer." };
    if (resolvedDate && !isValidDateOnly(resolvedDate)) return { error: "Enter a valid resolution date." };
    return { values: { student_id: studentId, complaint_type: complaintType, description, complaint_date: complaintDate, status, resolution: resolution || null, resolved_date: resolvedDate || null } };
}

app.get("/api/complaints", async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(`
            SELECT c.complaint_id, c.student_id, s.registration_no, s.student_name,
                   c.complaint_type, c.description, TO_CHAR(c.complaint_date, 'YYYY-MM-DD'),
                   c.status, c.resolution, TO_CHAR(c.resolved_date, 'YYYY-MM-DD')
            FROM complaint c
            JOIN student s ON s.student_id = c.student_id
            ORDER BY c.complaint_date DESC, c.complaint_id DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error("GET COMPLAINTS ERROR:", error);
        res.status(500).json({ error: "Failed to fetch complaints" });
    } finally {
        if (connection) await connection.close();
    }
});

app.post("/api/complaints", async (req, res) => {
    let connection;
    const validated = validateComplaintPayload(req.body);
    if (validated.error) return res.status(400).json({ error: validated.error });
    try {
        connection = await getConnection();
        const idResult = await connection.execute("SELECT NVL(MAX(complaint_id), 0) + 1 FROM complaint");
        const complaintId = idResult.rows[0][0];
        await connection.execute(`
            INSERT INTO complaint (complaint_id, student_id, complaint_type, description, complaint_date, status, resolution, resolved_date)
            VALUES (:complaint_id, :student_id, :complaint_type, :description, TO_DATE(:complaint_date, 'YYYY-MM-DD'), :status, :resolution,
                    CASE WHEN :status = 'RESOLVED' THEN NVL(TO_DATE(:resolved_date, 'YYYY-MM-DD'), SYSDATE) ELSE NULL END)
        `, { complaint_id: complaintId, ...validated.values }, { autoCommit: true });
        res.status(201).json({ message: "Complaint added successfully", complaint_id: complaintId });
    } catch (error) {
        console.error("ADD COMPLAINT ERROR:", error);
        if (error.errorNum === 2291) return res.status(400).json({ error: "Selected student does not exist." });
        if (error.errorNum === 2290) return res.status(400).json({ error: "Check the complaint type and status." });
        res.status(500).json({ error: "Failed to add complaint" });
    } finally {
        if (connection) await connection.close();
    }
});

app.put("/api/complaints/:id", async (req, res) => {
    let connection;
    const complaintId = Number(req.params.id);
    if (!Number.isInteger(complaintId) || complaintId < 1) return res.status(400).json({ error: "Invalid complaint ID." });
    const validated = validateComplaintPayload(req.body);
    if (validated.error) return res.status(400).json({ error: validated.error });
    try {
        connection = await getConnection();
        const result = await connection.execute(`
            UPDATE complaint
            SET student_id = :student_id, complaint_type = :complaint_type, description = :description,
                complaint_date = TO_DATE(:complaint_date, 'YYYY-MM-DD'), status = :status, resolution = :resolution,
                resolved_date = CASE WHEN :status = 'RESOLVED'
                                     THEN COALESCE(TO_DATE(:resolved_date, 'YYYY-MM-DD'), resolved_date, SYSDATE)
                                     ELSE NULL END
            WHERE complaint_id = :complaint_id
        `, { ...validated.values, complaint_id: complaintId }, { autoCommit: true });
        if (result.rowsAffected === 0) return res.status(404).json({ error: "Complaint not found." });
        res.json({ message: "Complaint updated successfully" });
    } catch (error) {
        console.error("UPDATE COMPLAINT ERROR:", error);
        if (error.errorNum === 2291) return res.status(400).json({ error: "Selected student does not exist." });
        if (error.errorNum === 2290) return res.status(400).json({ error: "Check the complaint type and status." });
        res.status(500).json({ error: "Failed to update complaint" });
    } finally {
        if (connection) await connection.close();
    }
});

app.delete("/api/complaints/:id", requireRole("ADMIN"), async (req, res) => {
    let connection;
    const complaintId = Number(req.params.id);
    if (!Number.isInteger(complaintId) || complaintId < 1) return res.status(400).json({ error: "Invalid complaint ID." });
    try {
        connection = await getConnection();
        const result = await connection.execute("DELETE FROM complaint WHERE complaint_id = :complaint_id", { complaint_id: complaintId }, { autoCommit: true });
        if (result.rowsAffected === 0) return res.status(404).json({ error: "Complaint not found." });
        res.json({ message: "Complaint deleted successfully" });
    } catch (error) {
        console.error("DELETE COMPLAINT ERROR:", error);
        res.status(500).json({ error: "Failed to delete complaint" });
    } finally {
        if (connection) await connection.close();
    }
});


// ==========================================
// HOSTELS
// ==========================================

// GET ALL HOSTELS
app.get("/api/hostels", async (req, res) => {

    let connection;

    try {

        connection = await getConnection();

        const result = await connection.execute(`
            SELECT hostel_id,
                   hostel_name,
                   hostel_type,
                   capacity,
                   location
            FROM hostel
            ORDER BY hostel_id
        `);

        res.json(result.rows);

    } catch (error) {

        console.error("GET HOSTELS ERROR:", error);

        res.status(500).json({
            error: "Failed to fetch hostels"
        });

    } finally {

        if (connection) {
            await connection.close();
        }

    }

});

// ADD HOSTEL
app.post("/api/hostels", requireRole("ADMIN"), async (req, res) => {
    let connection;
    try {
        const { hostel_name, hostel_type, capacity, location } = req.body;
        if (!String(hostel_name ?? "").trim() || !["BOYS", "GIRLS"].includes(String(hostel_type ?? "").trim().toUpperCase()) || capacity === undefined || capacity === null || String(capacity).trim() === "") {
            return res.status(400).json({ error: "Hostel name, a valid hostel type, and capacity are required." });
        }
        const name = String(hostel_name).trim();
        const type = String(hostel_type).trim().toUpperCase();
        const hostelLocation = String(location ?? "").trim();
        if (name.length > 50 || hostelLocation.length > 100) return res.status(400).json({ error: "Hostel name must be at most 50 characters and location at most 100 characters." });
        const parsedCapacity = Number(capacity);
        if (!Number.isInteger(parsedCapacity) || parsedCapacity < 1) {
            return res.status(400).json({ error: "Capacity must be a positive whole number" });
        }
        connection = await getConnection();
        const idResult = await connection.execute("SELECT NVL(MAX(hostel_id), 0) + 1 FROM hostel");
        const hostelId = idResult.rows[0][0];
        await connection.execute(
            `INSERT INTO hostel (hostel_id, hostel_name, hostel_type, capacity, location)
             VALUES (:hostel_id, :hostel_name, :hostel_type, :capacity, :location)`,
            { hostel_id: hostelId, hostel_name: name, hostel_type: type, capacity: parsedCapacity, location: hostelLocation || null },
            { autoCommit: true }
        );
        res.status(201).json({ message: "Hostel added successfully", hostel_id: hostelId });
    } catch (error) {
        console.error("ADD HOSTEL ERROR:", error);
        if (error.errorNum === 1) return res.status(409).json({ error: "A hostel with that name already exists." });
        if (error.errorNum === 2290) return res.status(400).json({ error: "Check the hostel type and capacity values." });
        res.status(500).json({ error: "Failed to add hostel" });
    } finally {
        if (connection) await connection.close();
    }
});

// UPDATE HOSTEL
app.put("/api/hostels/:id", requireRole("ADMIN"), async (req, res) => {
    let connection;
    try {
        const hostelId = Number(req.params.id);
        const { hostel_name, hostel_type, capacity, location } = req.body;
        if (!Number.isInteger(hostelId) || hostelId < 1 || !String(hostel_name ?? "").trim() || !["BOYS", "GIRLS"].includes(String(hostel_type ?? "").trim().toUpperCase()) || capacity === undefined || capacity === null || String(capacity).trim() === "") {
            return res.status(400).json({ error: "Hostel name, a valid hostel type, and capacity are required." });
        }
        const name = String(hostel_name).trim();
        const type = String(hostel_type).trim().toUpperCase();
        const hostelLocation = String(location ?? "").trim();
        if (name.length > 50 || hostelLocation.length > 100) return res.status(400).json({ error: "Hostel name must be at most 50 characters and location at most 100 characters." });
        const parsedCapacity = Number(capacity);
        if (!Number.isInteger(parsedCapacity) || parsedCapacity < 1) {
            return res.status(400).json({ error: "Capacity must be a positive whole number" });
        }
        connection = await getConnection();
        const result = await connection.execute(
            `UPDATE hostel SET hostel_name = :hostel_name, hostel_type = :hostel_type,
                               capacity = :capacity, location = :location
             WHERE hostel_id = :hostel_id`,
            { hostel_name: name, hostel_type: type, capacity: parsedCapacity, location: hostelLocation || null, hostel_id: hostelId },
            { autoCommit: true }
        );
        if (result.rowsAffected === 0) return res.status(404).json({ error: "Hostel not found" });
        res.json({ message: "Hostel updated successfully" });
    } catch (error) {
        console.error("UPDATE HOSTEL ERROR:", error);
        if (error.errorNum === 1) return res.status(409).json({ error: "A hostel with that name already exists." });
        if (error.errorNum === 2290) return res.status(400).json({ error: "Check the hostel type and capacity values." });
        res.status(500).json({ error: "Failed to update hostel" });
    } finally {
        if (connection) await connection.close();
    }
});

// DELETE HOSTEL
app.delete("/api/hostels/:id", requireRole("ADMIN"), async (req, res) => {
    let connection;
    try {
        const hostelId = Number(req.params.id);
        if (!Number.isInteger(hostelId) || hostelId < 1) return res.status(400).json({ error: "Invalid hostel ID" });
        connection = await getConnection();
        const result = await connection.execute("DELETE FROM hostel WHERE hostel_id = :hostel_id", { hostel_id: hostelId }, { autoCommit: true });
        if (result.rowsAffected === 0) return res.status(404).json({ error: "Hostel not found" });
        res.json({ message: "Hostel deleted successfully" });
    } catch (error) {
        console.error("DELETE HOSTEL ERROR:", error);
        if (error.errorNum === 2292) return res.status(409).json({ error: "Cannot delete this hostel while it contains rooms." });
        res.status(500).json({ error: "Failed to delete hostel" });
    } finally {
        if (connection) await connection.close();
    }
});


// ==========================================
// ROOMS
// ==========================================

// GET ALL ROOMS
app.get("/api/rooms", async (req, res) => {

    let connection;

    try {

        connection = await getConnection();

        const result = await connection.execute(`
            SELECT
                r.room_id,
                h.hostel_name,
                r.room_number,
                r.room_type,
                r.capacity,
                r.floor_number,
                r.hostel_id
            FROM room r
            JOIN hostel h
                ON r.hostel_id = h.hostel_id
            ORDER BY r.room_id
        `);

        res.json(result.rows);

    } catch (error) {

        console.error("GET ROOMS ERROR:", error);

        res.status(500).json({
            error: "Failed to fetch rooms"
        });

    } finally {

        if (connection) {
            await connection.close();
        }

    }

});


// ADD ROOM
app.post("/api/rooms", requireRole("ADMIN"), async (req, res) => {

    let connection;

    try {

        const {
            hostel_id,
            room_number,
            room_type,
            capacity,
            floor_number
        } = req.body;

        if (
            !hostel_id ||
            !room_number ||
            !room_type ||
            !capacity ||
            floor_number === undefined
        ) {

            return res.status(400).json({
                error: "All fields are required"
            });

        }

        connection = await getConnection();

        const idResult = await connection.execute(`
            SELECT NVL(MAX(room_id), 0) + 1
            FROM room
        `);

        const roomId = idResult.rows[0][0];

        await connection.execute(
            `
            INSERT INTO room (
                room_id,
                hostel_id,
                room_number,
                room_type,
                capacity,
                floor_number
            )
            VALUES (
                :room_id,
                :hostel_id,
                :room_number,
                :room_type,
                :capacity,
                :floor_number
            )
            `,
            {
                room_id: roomId,
                hostel_id: Number(hostel_id),
                room_number,
                room_type,
                capacity: Number(capacity),
                floor_number: Number(floor_number)
            },
            {
                autoCommit: true
            }
        );

        res.status(201).json({
            message: "Room added successfully",
            room_id: roomId
        });

    } catch (error) {

        console.error("ADD ROOM ERROR:", error);

        if (error.errorNum === 1) {

            return res.status(409).json({
                error: "That room number already exists in this hostel."
            });

        }

        if (error.errorNum === 2291) {

            return res.status(400).json({
                error: "Selected hostel does not exist."
            });

        }

        res.status(500).json({
            error: "Failed to add room"
        });

    } finally {

        if (connection) {
            await connection.close();
        }

    }

});


// UPDATE ROOM
app.put("/api/rooms/:id", requireRole("ADMIN"), async (req, res) => {

    let connection;

    try {

        const roomId = Number(req.params.id);

        const {
            hostel_id,
            room_number,
            room_type,
            capacity,
            floor_number
        } = req.body;

        if (
            !hostel_id ||
            !room_number ||
            !room_type ||
            !capacity ||
            floor_number === undefined
        ) {

            return res.status(400).json({
                error: "All fields are required"
            });

        }

        connection = await getConnection();

        const result = await connection.execute(
            `
            UPDATE room
            SET hostel_id = :hostel_id,
                room_number = :room_number,
                room_type = :room_type,
                capacity = :capacity,
                floor_number = :floor_number
            WHERE room_id = :room_id
            `,
            {
                hostel_id: Number(hostel_id),
                room_number,
                room_type,
                capacity: Number(capacity),
                floor_number: Number(floor_number),
                room_id: roomId
            },
            {
                autoCommit: true
            }
        );

        if (result.rowsAffected === 0) {

            return res.status(404).json({
                error: "Room not found"
            });

        }

        res.json({
            message: "Room updated successfully"
        });

    } catch (error) {

        console.error("UPDATE ROOM ERROR:", error);

        if (error.errorNum === 1) {

            return res.status(409).json({
                error: "That room number already exists in this hostel."
            });

        }

        if (error.errorNum === 2291) {

            return res.status(400).json({
                error: "Selected hostel does not exist."
            });

        }

        res.status(500).json({
            error: "Failed to update room"
        });

    } finally {

        if (connection) {
            await connection.close();
        }

    }

});


// DELETE ROOM
app.delete("/api/rooms/:id", requireRole("ADMIN"), async (req, res) => {

    let connection;

    try {

        const roomId = Number(req.params.id);

        connection = await getConnection();

        await connection.execute(
            `
            DELETE FROM room
            WHERE room_id = :room_id
            `,
            {
                room_id: roomId
            },
            {
                autoCommit: true
            }
        );

        res.json({
            message: "Room deleted successfully"
        });

    } catch (error) {

        console.error("DELETE ROOM ERROR:", error);

        if (error.errorNum === 2292) {

            return res.status(409).json({
                error: "Cannot delete this room because it has related allocations."
            });

        }

        res.status(500).json({
            error: "Failed to delete room"
        });

    } finally {

        if (connection) {
            await connection.close();
        }

    }

});


// ==========================================
// ROOM ALLOCATIONS
// ==========================================

app.get("/api/allocations", async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(`
            SELECT a.allocation_id, a.student_id, s.registration_no, s.student_name,
                   r.room_id, h.hostel_name, r.room_number, r.room_type,
                   TO_CHAR(a.allocation_date, 'YYYY-MM-DD'),
                   TO_CHAR(a.vacate_date, 'YYYY-MM-DD'), a.status
            FROM room_allocation a
            JOIN student s ON s.student_id = a.student_id
            JOIN room r ON r.room_id = a.room_id
            JOIN hostel h ON h.hostel_id = r.hostel_id
            ORDER BY CASE a.status WHEN 'ACTIVE' THEN 0 ELSE 1 END,
                     a.allocation_date DESC, a.allocation_id DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error("GET ALLOCATIONS ERROR:", error);
        res.status(500).json({ error: "Failed to fetch room allocations" });
    } finally {
        if (connection) await connection.close();
    }
});

app.get("/api/room-availability", async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(`
            SELECT r.room_id, h.hostel_name, r.room_number, r.room_type, r.capacity,
                   NVL(a.occupied, 0) AS occupied,
                   GREATEST(r.capacity - NVL(a.occupied, 0), 0) AS available,
                   r.floor_number
            FROM room r
            JOIN hostel h ON h.hostel_id = r.hostel_id
            LEFT JOIN (
                SELECT room_id, COUNT(*) AS occupied
                FROM room_allocation
                WHERE status = 'ACTIVE'
                GROUP BY room_id
            ) a ON a.room_id = r.room_id
            ORDER BY h.hostel_name, r.room_number
        `);
        res.json(result.rows);
    } catch (error) {
        console.error("GET ROOM AVAILABILITY ERROR:", error);
        res.status(500).json({ error: "Failed to fetch room availability" });
    } finally {
        if (connection) await connection.close();
    }
});

app.post("/api/allocations", async (req, res) => {
    let connection;
    const studentId = Number(req.body.student_id);
    const roomId = Number(req.body.room_id);
    const allocationDate = String(req.body.allocation_date ?? "");
    if (!Number.isInteger(studentId) || studentId < 1) return res.status(400).json({ error: "Select a student." });
    if (!Number.isInteger(roomId) || roomId < 1) return res.status(400).json({ error: "Select a room." });
    if (!isValidDateOnly(allocationDate)) return res.status(400).json({ error: "Enter a valid allocation date." });
    try {
        connection = await getConnection();
        // Serialize allocation writes to protect both capacity and max+1 ID generation.
        await connection.execute("LOCK TABLE room_allocation IN EXCLUSIVE MODE");
        const student = await connection.execute("SELECT student_id FROM student WHERE student_id = :student_id FOR UPDATE", { student_id: studentId });
        if (student.rows.length === 0) return res.status(404).json({ error: "Student not found." });
        const room = await connection.execute("SELECT capacity FROM room WHERE room_id = :room_id FOR UPDATE", { room_id: roomId });
        if (room.rows.length === 0) return res.status(404).json({ error: "Room not found." });
        const existing = await connection.execute("SELECT COUNT(*) FROM room_allocation WHERE student_id = :student_id AND status = 'ACTIVE'", { student_id: studentId });
        if (existing.rows[0][0] > 0) return res.status(409).json({ error: "This student already has an active room allocation. Vacate it before assigning another room." });
        const occupied = await connection.execute("SELECT COUNT(*) FROM room_allocation WHERE room_id = :room_id AND status = 'ACTIVE'", { room_id: roomId });
        if (occupied.rows[0][0] >= room.rows[0][0]) return res.status(409).json({ error: "This room is full. Choose a room with an available bed." });
        const idResult = await connection.execute("SELECT NVL(MAX(allocation_id), 0) + 1 FROM room_allocation");
        const allocationId = idResult.rows[0][0];
        await connection.execute(`
            INSERT INTO room_allocation (allocation_id, student_id, room_id, allocation_date, status)
            VALUES (:allocation_id, :student_id, :room_id, TO_DATE(:allocation_date, 'YYYY-MM-DD'), 'ACTIVE')
        `, { allocation_id: allocationId, student_id: studentId, room_id: roomId, allocation_date: allocationDate }, { autoCommit: true });
        res.status(201).json({ message: "Student allocated to room successfully", allocation_id: allocationId });
    } catch (error) {
        console.error("ADD ALLOCATION ERROR:", error);
        if (error.errorNum === 2291) return res.status(400).json({ error: "Selected student or room does not exist." });
        if (error.errorNum === 2290) return res.status(400).json({ error: "Check the allocation date and status." });
        res.status(500).json({ error: "Failed to allocate student to room" });
    } finally {
        if (connection) await connection.close();
    }
});

app.put("/api/allocations/:id/vacate", async (req, res) => {
    let connection;
    const allocationId = Number(req.params.id);
    if (!Number.isInteger(allocationId) || allocationId < 1) return res.status(400).json({ error: "Invalid allocation ID." });
    try {
        connection = await getConnection();
        await connection.execute("LOCK TABLE room_allocation IN EXCLUSIVE MODE");
        const allocation = await connection.execute(
            "SELECT status FROM room_allocation WHERE allocation_id = :allocation_id FOR UPDATE",
            { allocation_id: allocationId }
        );
        if (allocation.rows.length === 0) return res.status(404).json({ error: "Allocation not found." });
        if (allocation.rows[0][0] !== "ACTIVE") return res.status(409).json({ error: "This allocation has already been vacated." });
        const futureAllocation = await connection.execute(
            "SELECT COUNT(*) FROM room_allocation WHERE allocation_id = :allocation_id AND allocation_date > TRUNC(SYSDATE)",
            { allocation_id: allocationId }
        );
        if (futureAllocation.rows[0][0] > 0) return res.status(400).json({ error: "This allocation starts in the future and cannot be vacated yet." });
        await connection.execute(`
            UPDATE room_allocation
            SET status = 'VACATED', vacate_date = GREATEST(TRUNC(SYSDATE), allocation_date)
            WHERE allocation_id = :allocation_id
        `, { allocation_id: allocationId }, { autoCommit: true });
        res.json({ message: "Student vacated from room successfully" });
    } catch (error) {
        console.error("VACATE ALLOCATION ERROR:", error);
        if (error.errorNum === 2290) return res.status(400).json({ error: "Vacate date cannot be earlier than allocation date." });
        res.status(500).json({ error: "Failed to vacate room allocation" });
    } finally {
        if (connection) await connection.close();
    }
});


// ==========================================
// DASHBOARD
// ==========================================

app.get("/api/dashboard", async (req, res) => {

    let connection;

    try {

        connection = await getConnection();

        const result = await connection.execute(`
            SELECT
                (SELECT COUNT(*) FROM student) AS total_students,
                (SELECT COUNT(*) FROM room) AS total_rooms,
                (SELECT COUNT(*) FROM hostel) AS total_hostels,
                (SELECT COUNT(*)
                 FROM complaint
                 WHERE status != 'RESOLVED') AS active_complaints
            FROM dual
        `);

        res.json({

            total_students: result.rows[0][0],

            total_rooms: result.rows[0][1],

            total_hostels: result.rows[0][2],

            active_complaints: result.rows[0][3]

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Failed to fetch dashboard statistics"
        });

    } finally {

        if (connection) {
            await connection.close();
        }

    }

});


// ==========================================
// START SERVER
// ==========================================

// Student self-service routes. Every query is bound to the student ID stored in
// the authenticated session; student IDs supplied by the browser are ignored.
app.get("/api/student/me", requireStudentAccount, async (req, res) => {
    let connection;
    const studentId = Number(req.user.studentId);
    try {
        connection = await getConnection();
        const studentResult = await connection.execute(`
            SELECT student_id, registration_no, student_name, gender, phone, email, department, year_of_study
            FROM student
            WHERE student_id = :student_id
        `, { student_id: studentId });
        if (studentResult.rows.length === 0) return res.status(404).json({ error: "Your student record could not be found." });

        const roomResult = await connection.execute(`
            SELECT h.hostel_name, r.room_number, r.room_type, r.floor_number,
                   TO_CHAR(a.allocation_date, 'YYYY-MM-DD')
            FROM room_allocation a
            JOIN room r ON r.room_id = a.room_id
            JOIN hostel h ON h.hostel_id = r.hostel_id
            WHERE a.student_id = :student_id AND a.status = 'ACTIVE'
            ORDER BY a.allocation_date DESC, a.allocation_id DESC
        `, { student_id: studentId });
        const complaints = await connection.execute(`
            SELECT complaint_id, complaint_type, description, TO_CHAR(complaint_date, 'YYYY-MM-DD'),
                   status, resolution, TO_CHAR(resolved_date, 'YYYY-MM-DD')
            FROM complaint
            WHERE student_id = :student_id
            ORDER BY complaint_date DESC, complaint_id DESC
            FETCH FIRST 10 ROWS ONLY
        `, { student_id: studentId });
        const openIssueCount = await connection.execute(`
            SELECT COUNT(*)
            FROM complaint
            WHERE student_id = :student_id AND status NOT IN ('RESOLVED', 'REJECTED')
        `, { student_id: studentId });
        const leaves = await connection.execute(`
            SELECT leave_id, TO_CHAR(from_date, 'YYYY-MM-DD'), TO_CHAR(to_date, 'YYYY-MM-DD'),
                   reason, status, remarks, TO_CHAR(applied_date, 'YYYY-MM-DD HH24:MI')
            FROM leave_request
            WHERE student_id = :student_id
            ORDER BY applied_date DESC, leave_id DESC
            FETCH FIRST 10 ROWS ONLY
        `, { student_id: studentId });
        const visitors = await connection.execute(`
            SELECT visitor_id, visitor_name, relationship, phone, TO_CHAR(visit_date, 'YYYY-MM-DD'),
                   in_time, out_time, purpose
            FROM visitor
            WHERE student_id = :student_id
            ORDER BY visit_date DESC, visitor_id DESC
            FETCH FIRST 10 ROWS ONLY
        `, { student_id: studentId });
        const reports = await connection.execute(`
            SELECT c.complaint_id, s.student_name, s.registration_no, c.complaint_type,
                   c.description, TO_CHAR(c.complaint_date, 'YYYY-MM-DD'), c.status,
                   c.resolution
            FROM student_complaint c
            JOIN student accused ON accused.student_id = c.accused_student_id
            JOIN student s ON s.student_id = c.accused_student_id
            WHERE c.reporter_student_id = :student_id
            ORDER BY c.complaint_date DESC, c.complaint_id DESC
            FETCH FIRST 20 ROWS ONLY
        `, { student_id: studentId });

        res.json({
            student: studentResult.rows[0],
            room: roomResult.rows[0] ?? null,
            openIssueCount: openIssueCount.rows[0][0],
            complaints: complaints.rows,
            leaves: leaves.rows,
            visitors: visitors.rows,
            reportsAgainstHostellers: reports.rows
        });
    } catch (error) {
        console.error("GET STUDENT PORTAL ERROR:", error);
        res.status(500).json({ error: "Could not load your student portal." });
    } finally {
        if (connection) await connection.close();
    }
});

app.get("/api/student/hostellers", requireStudentAccount, async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(`
            SELECT student_id, student_name, registration_no
            FROM student
            WHERE student_id <> :student_id
            ORDER BY student_name
        `, { student_id: Number(req.user.studentId) });
        res.json(result.rows);
    } catch (error) {
        console.error("GET STUDENT HOSTELLERS ERROR:", error);
        res.status(500).json({ error: "Could not load the hosteller list." });
    } finally {
        if (connection) await connection.close();
    }
});

app.post("/api/student/reports-against-hostellers", requireStudentAccount, async (req, res) => {
    const accusedStudentId = Number(req.body?.accused_student_id);
    const complaintType = String(req.body?.complaint_type ?? "").trim().toUpperCase();
    const description = String(req.body?.description ?? "").trim();
    const studentId = Number(req.user.studentId);
    if (!Number.isInteger(accusedStudentId) || accusedStudentId < 1) return res.status(400).json({ error: "Choose the student you are reporting." });
    if (accusedStudentId === studentId) return res.status(400).json({ error: "You cannot submit a report against yourself." });
    if (!complaintType || complaintType.length > 30) return res.status(400).json({ error: "Enter a report type of 1–30 characters." });
    if (!description || description.length > 500) return res.status(400).json({ error: "Describe what happened in 1–500 characters." });

    let connection;
    try {
        connection = await getConnection();
        const reporter = await connection.execute("SELECT student_name FROM student WHERE student_id = :student_id", { student_id: studentId });
        if (!reporter.rows.length) return res.status(404).json({ error: "Your student record could not be found." });
        const accused = await connection.execute("SELECT student_id FROM student WHERE student_id = :student_id", { student_id: accusedStudentId });
        if (!accused.rows.length) return res.status(400).json({ error: "That student could not be found." });
        const idResult = await connection.execute("SELECT NVL(MAX(complaint_id), 0) + 1 FROM student_complaint");
        await connection.execute(`
            INSERT INTO student_complaint
                (complaint_id, accused_student_id, complaint_type, description, complaint_date,
                 reported_by, reporter_student_id, status)
            VALUES (:complaint_id, :accused_student_id, :complaint_type, :description, TRUNC(SYSDATE),
                    :reported_by, :reporter_student_id, 'PENDING')
        `, {
            complaint_id: idResult.rows[0][0], accused_student_id: accusedStudentId,
            complaint_type: complaintType, description, reported_by: reporter.rows[0][0],
            reporter_student_id: studentId
        }, { autoCommit: true });
        res.status(201).json({ message: "Your report was sent to the warden for review." });
    } catch (error) {
        console.error("STUDENT REPORT AGAINST HOSTELLER ERROR:", error);
        if (error.errorNum === 942) return res.status(503).json({ error: "The student report feature needs the SQL migration sql/student_complaints.sql and sql/student_complaint_reporter.sql." });
        res.status(500).json({ error: "Could not submit the report." });
    } finally {
        if (connection) await connection.close();
    }
});

app.post("/api/student/complaints", requireStudentAccount, async (req, res) => {
    const complaintType = String(req.body?.complaint_type ?? "").trim().toUpperCase();
    const description = String(req.body?.description ?? "").trim();
    if (!COMPLAINT_TYPES.has(complaintType)) return res.status(400).json({ error: "Choose a valid issue category." });
    if (!description || description.length > 500) return res.status(400).json({ error: "Describe the issue in 1–500 characters." });

    let connection;
    try {
        connection = await getConnection();
        const idResult = await connection.execute("SELECT NVL(MAX(complaint_id), 0) + 1 FROM complaint");
        await connection.execute(`
            INSERT INTO complaint (complaint_id, student_id, complaint_type, description, complaint_date, status)
            VALUES (:complaint_id, :student_id, :complaint_type, :description, TRUNC(SYSDATE), 'PENDING')
        `, {
            complaint_id: idResult.rows[0][0],
            student_id: Number(req.user.studentId),
            complaint_type: complaintType,
            description
        }, { autoCommit: true });
        res.status(201).json({ message: "Issue sent to the hostel team." });
    } catch (error) {
        console.error("STUDENT ISSUE SUBMISSION ERROR:", error);
        res.status(500).json({ error: "Could not submit the issue." });
    } finally {
        if (connection) await connection.close();
    }
});

app.post("/api/student/leave-requests", requireStudentAccount, async (req, res) => {
    const fromDate = String(req.body?.from_date ?? "");
    const toDate = String(req.body?.to_date ?? "");
    const reason = String(req.body?.reason ?? "").trim();
    if (!isValidDateOnly(fromDate) || !isValidDateOnly(toDate) || fromDate > toDate) return res.status(400).json({ error: "Enter a valid leave date range." });
    if (!reason || reason.length > 500) return res.status(400).json({ error: "Give a reason in 1–500 characters." });

    let connection;
    try {
        connection = await getConnection();
        const idResult = await connection.execute("SELECT NVL(MAX(leave_id), 0) + 1 FROM leave_request");
        await connection.execute(`
            INSERT INTO leave_request (leave_id, student_id, from_date, to_date, reason, status, applied_date)
            VALUES (:leave_id, :student_id, TO_DATE(:from_date, 'YYYY-MM-DD'),
                    TO_DATE(:to_date, 'YYYY-MM-DD'), :reason, 'PENDING', SYSDATE)
        `, {
            leave_id: idResult.rows[0][0],
            student_id: Number(req.user.studentId),
            from_date: fromDate,
            to_date: toDate,
            reason
        }, { autoCommit: true });
        res.status(201).json({ message: "Leave request sent to the warden." });
    } catch (error) {
        console.error("STUDENT LEAVE REQUEST ERROR:", error);
        if (error.errorNum === 2290) return res.status(400).json({ error: "The leave dates or request details were rejected by the database." });
        res.status(500).json({ error: "Could not submit the leave request." });
    } finally {
        if (connection) await connection.close();
    }
});

app.post("/api/student/visitors", requireStudentAccount, async (req, res) => {
    const validated = validateVisitorPayload({ ...req.body, student_id: req.user.studentId });
    if (validated.error) return res.status(400).json({ error: validated.error });

    let connection;
    try {
        connection = await getConnection();
        const idResult = await connection.execute("SELECT NVL(MAX(visitor_id), 0) + 1 FROM visitor");
        await connection.execute(`
            INSERT INTO visitor (visitor_id, student_id, visitor_name, relationship, phone, visit_date, in_time, out_time, purpose)
            VALUES (:visitor_id, :student_id, :visitor_name, :relationship, :phone,
                    TO_DATE(:visit_date, 'YYYY-MM-DD'), :in_time, :out_time, :purpose)
        `, { visitor_id: idResult.rows[0][0], ...validated.values }, { autoCommit: true });
        res.status(201).json({ message: "Visitor details sent to the hostel team." });
    } catch (error) {
        console.error("STUDENT VISITOR SUBMISSION ERROR:", error);
        res.status(500).json({ error: "Could not submit the visitor details." });
    } finally {
        if (connection) await connection.close();
    }
});

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {

    console.log(
        `Server running at http://localhost:${PORT}`
    );

});
