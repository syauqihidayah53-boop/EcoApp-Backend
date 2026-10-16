const { Pool } = require('pg');
const fs = require('node:fs');

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL belum diatur di .env backend');
}

const caPath = process.env.SUPABASE_DB_CA_CERT_PATH;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: caPath
        ? { ca: fs.readFileSync(caPath, 'utf8'), rejectUnauthorized: true }
        : { rejectUnauthorized: false },
    max: 5,
    connectionTimeoutMillis: 10000,
});

pool.on('error', (error) => {
    console.error('Koneksi PostgreSQL idle terputus:', error.message);
});

module.exports = pool;
