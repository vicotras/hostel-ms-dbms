const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const { getConnection } = require("./db");
const { hashPassword } = require("./auth-utils");

function promptHidden(label) {
    return new Promise((resolve, reject) => {
        if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
            reject(new Error("Run this command in an interactive PowerShell or CMD terminal."));
            return;
        }
        let answer = "";
        stdout.write(label);
        stdin.setRawMode(true);
        stdin.resume();
        const finish = value => {
            stdin.removeListener("data", onData);
            stdin.setRawMode(false);
            stdout.write("\r\n");
            resolve(value);
        };
        const onData = chunk => {
            for (const character of chunk.toString("utf8")) {
                if (character === "\u0003") {
                    stdin.removeListener("data", onData);
                    stdin.setRawMode(false);
                    stdout.write("\r\n");
                    reject(new Error("Cancelled."));
                    return;
                }
                if (character === "\r" || character === "\n") return finish(answer);
                if (character === "\u0008" || character === "\u007f") answer = answer.slice(0, -1);
                else if (character >= " ") answer += character;
            }
        };
        stdin.on("data", onData);
    });
}

(async () => {
    const prompts = readline.createInterface({ input: stdin, output: stdout });
    const registrationNo = (await prompts.question("Student registration number: ")).trim().toUpperCase();
    const username = (await prompts.question("Student login username: ")).trim().toLowerCase();
    prompts.close();

    if (!registrationNo || registrationNo.length > 30) throw new Error("Enter a valid student registration number.");
    if (!/^[a-z0-9._-]{3,50}$/.test(username)) throw new Error("Username must be 3–50 characters: letters, numbers, dots, underscores, or hyphens.");

    const password = await promptHidden("Password (12+ characters; input hidden): ");
    const confirmation = await promptHidden("Confirm password: ");
    if (password.length < 12) throw new Error("Password must be at least 12 characters.");
    if (password !== confirmation) throw new Error("Passwords do not match.");

    const { salt, hash } = await hashPassword(password);
    const connection = await getConnection();
    try {
        const studentResult = await connection.execute(`
            SELECT student_id, registration_no, student_name
            FROM student
            WHERE UPPER(registration_no) = :registration_no
        `, { registration_no: registrationNo });
        if (studentResult.rows.length === 0) throw new Error("That registration number was not found in STUDENT.");

        const [studentId, actualRegistration, studentName] = studentResult.rows[0];
        const linkedResult = await connection.execute(
            "SELECT COUNT(*) FROM app_account WHERE student_id = :student_id",
            { student_id: studentId }
        );
        if (linkedResult.rows[0][0] > 0) throw new Error("This student already has a login account.");

        const idResult = await connection.execute("SELECT NVL(MAX(account_id), 0) + 1 FROM app_account");
        await connection.execute(`
            INSERT INTO app_account (account_id, username, password_salt, password_hash, role, is_active, student_id, must_change_password)
            VALUES (:account_id, :username, :password_salt, :password_hash, 'STUDENT', 'Y', :student_id, 'Y')
        `, {
            account_id: idResult.rows[0][0],
            username,
            password_salt: salt,
            password_hash: hash,
            student_id: studentId
        }, { autoCommit: true });
        console.log(`Student login '${username}' created for ${studentName} (${actualRegistration}).`);
        console.log("Give the student their username and password privately; they must change it on first sign-in.");
    } finally {
        await connection.close();
    }
})().catch(error => {
    if (error.errorNum === 1) console.error("That username or student already has an account.");
    else console.error(error.message);
    process.exitCode = 1;
});
