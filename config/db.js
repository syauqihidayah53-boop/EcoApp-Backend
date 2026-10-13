const sql = require('mssql');
require('dotenv').config();

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    options: {
        encrypt: false, 
        trustServerCertificate: true
    }
};

async function connectDB() {
    try {
        await sql.connect(dbConfig);
        console.log("✅ Berhasil terhubung ke SQL Server EcoApp!");
    } catch (error) {
        console.error("❌ Gagal terhubung ke database:", error);
    }
}

module.exports = { sql, connectDB };