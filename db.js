const oracledb = require("oracledb");
const fs = require("node:fs");
const path = require("node:path");

// Load machine-specific Oracle settings from .env when running locally.
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: process.env.DB_CONNECT_STRING || "localhost:1521/FREE"
};

async function getConnection() {
    return await oracledb.getConnection(dbConfig);
}

module.exports = {
    getConnection,
    oracledb
};
