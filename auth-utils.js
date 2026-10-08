const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);

async function hashPassword(password, salt = crypto.randomBytes(16)) {
    const hash = await scrypt(password, salt, 64);
    return { salt: salt.toString("hex"), hash: hash.toString("hex") };
}

async function verifyPassword(password, saltHex, expectedHashHex) {
    try {
        const salt = Buffer.from(saltHex, "hex");
        const expected = Buffer.from(expectedHashHex, "hex");
        if (salt.length !== 16 || expected.length !== 64) return false;
        const actual = await scrypt(password, salt, expected.length);
        return crypto.timingSafeEqual(actual, expected);
    } catch {
        return false;
    }
}

module.exports = { hashPassword, verifyPassword };
