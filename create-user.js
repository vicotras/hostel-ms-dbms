const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const { getConnection } = require("./db");
const { hashPassword } = require("./auth-utils");

function promptHidden(label) {
    return new Promise((resolve, reject) => {
        if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
            reject(new Error("Run this command in an interactive CMD or PowerShell terminal."));
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
    const username = (await prompts.question("Username: ")).trim().toLowerCase();
    const role = (await prompts.question("Role (ADMIN/WARDEN): ")).trim().toUpperCase();
    prompts.close();

    if (!/^[a-z0-9._-]{3,50}$/.test(username)) throw new Error("Username must be 3–50 characters: letters, numbers, dots, underscores, or hyphens.");
    if (!new Set(["ADMIN", "WARDEN"]).has(role)) throw new Error("Role must be ADMIN or WARDEN.");

    const password = await promptHidden("Password (12+ characters; input hidden): ");
    const confirmation = await promptHidden("Confirm password: ");
    if (password.length < 12) throw new Error("Password must be at least 12 characters.");
    if (password !== confirmation) throw new Error("Passwords do not match.");

    const { salt, hash } = await hashPassword(password);
    const connection = await getConnection();
    try {
        const nextId = await connection.execute("SELECT NVL(MAX(account_id), 0) + 1 FROM app_account");
        await connection.execute(`
            INSERT INTO app_account (account_id, username, password_salt, password_hash, role, is_active)
            VALUES (:account_id, :username, :password_salt, :password_hash, :role, 'Y')
        `, { account_id: nextId.rows[0][0], username, password_salt: salt, password_hash: hash, role }, { autoCommit: true });
        console.log(`${role} account '${username}' created.`);
    } finally {
        await connection.close();
    }
})().catch(error => {
    if (error.errorNum === 1) console.error("That username already exists.");
    else console.error(error.message);
    process.exitCode = 1;
});
