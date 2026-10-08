const { getConnection } = require("./db");
const { hashPassword } = require("./auth-utils");

(async () => {
    const connection = await getConnection();
    try {
        await connection.execute("LOCK TABLE app_account IN EXCLUSIVE MODE");
        const studentsResult = await connection.execute(`
            SELECT student_id, registration_no
            FROM student
            ORDER BY student_id
        `);
        const accountsResult = await connection.execute(`
            SELECT account_id, username, role, student_id, is_active, must_change_password
            FROM app_account
        `);

        const students = studentsResult.rows;
        const accounts = accountsResult.rows;
        const accountsByStudent = new Map(accounts.filter(row => row[3] !== null).map(row => [Number(row[3]), row]));
        const accountIdByUsername = new Map(accounts.map(row => [String(row[1]).toLowerCase(), row]));
        const targetUsernames = new Set();

        for (const [studentId, registrationNoValue] of students) {
            const registrationNo = String(registrationNoValue).trim();
            const username = registrationNo.toLowerCase();
            if (!/^[a-z0-9._-]{3,50}$/.test(username)) throw new Error(`Registration number for student ID ${studentId} cannot be used as a login username.`);
            if (targetUsernames.has(username)) throw new Error(`Duplicate student registration number: ${registrationNo}.`);
            targetUsernames.add(username);

            const usernameOwner = accountIdByUsername.get(username);
            if (usernameOwner && Number(usernameOwner[3]) !== Number(studentId)) {
                throw new Error(`Username '${username}' is already used by another account. No accounts were changed.`);
            }
        }

        let nextAccountId = Math.max(0, ...accounts.map(row => Number(row[0]) || 0)) + 1;
        let created = 0;
        let initialized = 0;
        let alreadySetUp = 0;

        for (const [studentIdValue, registrationNoValue] of students) {
            const studentId = Number(studentIdValue);
            const registrationNo = String(registrationNoValue).trim();
            const username = registrationNo.toLowerCase();
            const existing = accountsByStudent.get(studentId);

            // Do not overwrite passwords students have already changed.
            if (existing && existing[5] === "N" && existing[4] === "Y") {
                alreadySetUp++;
                continue;
            }

            const { salt, hash } = await hashPassword(registrationNo);
            if (existing) {
                await connection.execute(`
                    UPDATE app_account
                    SET username = :username,
                        password_salt = :password_salt,
                        password_hash = :password_hash,
                        role = 'STUDENT',
                        is_active = 'Y',
                        must_change_password = 'Y'
                    WHERE account_id = :account_id
                `, {
                    username,
                    password_salt: salt,
                    password_hash: hash,
                    account_id: existing[0]
                });
                initialized++;
            } else {
                await connection.execute(`
                    INSERT INTO app_account (
                        account_id, username, password_salt, password_hash,
                        role, is_active, student_id, must_change_password
                    ) VALUES (
                        :account_id, :username, :password_salt, :password_hash,
                        'STUDENT', 'Y', :student_id, 'Y'
                    )
                `, {
                    account_id: nextAccountId++,
                    username,
                    password_salt: salt,
                    password_hash: hash,
                    student_id: studentId
                });
                created++;
            }
        }

        await connection.commit();
        console.log(`Student accounts ready: ${created} created, ${initialized} initialized, ${alreadySetUp} already set up.`);
        console.log("For students needing first login: username and initial password are both their registration number.");
        console.log("They will be asked to change the initial password before accessing the portal.");
    } catch (error) {
        try { await connection.rollback(); } catch {}
        if (error.errorNum === 1) console.error("A username or student account already exists; no batch changes were committed.");
        else console.error(error.message);
        process.exitCode = 1;
    } finally {
        await connection.close();
    }
})();
