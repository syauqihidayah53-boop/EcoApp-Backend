const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { sql, connectDB } = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

connectDB();

app.get('/', (req, res) => {
    res.send('🚀 Server API EcoApp Aktif dan Lengkap!');
});

// ==========================================
// 1. AUTENTIKASI & PENGGUNA (m_pengguna)
// ==========================================

// GET Semua Pengguna
app.get('/api/pengguna', async (req, res) => {
    try {
        const result = await sql.query`
            SELECT id_pengguna, nama, email, no_hp, peran, jenis_pelanggan, alamat, aktif 
            FROM m_pengguna
        `;
        res.status(200).json({ status: 'success', data: result.recordset });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// GET Profil Pengguna berdasarkan ID
app.get('/api/pengguna/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await sql.query`
            SELECT id_pengguna, nama, email, no_hp, peran, jenis_pelanggan, nama_usaha, alamat 
            FROM m_pengguna 
            WHERE id_pengguna = ${id}
        `;
        if (result.recordset.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Pengguna tidak ditemukan' });
        }
        res.status(200).json({ status: 'success', data: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// POST Register Akun Baru
app.post('/api/auth/register', async (req, res) => {
    const { nama, email, password, no_hp, jenis_pelanggan, alamat } = req.body;
    try {
        const result = await sql.query`
            INSERT INTO m_pengguna (nama, email, password_hash, no_hp, peran, jenis_pelanggan, alamat, aktif)
            OUTPUT INSERTED.id_pengguna, INSERTED.nama, INSERTED.email, INSERTED.peran
            VALUES (${nama}, ${email}, ${password}, ${no_hp}, 'PELANGGAN', ${jenis_pelanggan || 'RUMAH_TANGGA'}, ${alamat}, 1)
        `;
        res.status(201).json({ status: 'success', message: 'Registrasi berhasil!', data: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// POST Login
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await sql.query`
            SELECT id_pengguna, nama, email, no_hp, peran, jenis_pelanggan, alamat 
            FROM m_pengguna 
            WHERE email = ${email} AND password_hash = ${password} AND aktif = 1
        `;
        if (result.recordset.length === 0) {
            return res.status(401).json({ status: 'error', message: 'Email atau password salah!' });
        }
        res.status(200).json({ status: 'success', message: 'Login berhasil!', data: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// ==========================================
// 2. DROP POINT & PETA (m_drop_point)
// ==========================================

// GET Semua Drop Point
app.get('/api/drop-points', async (req, res) => {
    try {
        const result = await sql.query`SELECT * FROM m_drop_point WHERE aktif = 1`;
        res.status(200).json({ status: 'success', data: result.recordset });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// GET Detail 1 Drop Point
app.get('/api/drop-points/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await sql.query`SELECT * FROM m_drop_point WHERE id_drop_point = ${id}`;
        if (result.recordset.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Drop point tidak ditemukan' });
        }
        res.status(200).json({ status: 'success', data: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// ==========================================
// 3. SETORAN SAMPAH (t_setoran)
// ==========================================

// POST Buat Setoran Baru
app.post('/api/setoran', async (req, res) => {
    const { id_pelanggan, id_drop_point, catatan_serah_terima, id_dibuat_oleh } = req.body;
    const kode_setoran = 'STR-' + Date.now();
    try {
        const result = await sql.query`
            INSERT INTO t_setoran (kode_setoran, id_pelanggan, id_drop_point, status, catatan_serah_terima, dibuat_oleh)
            OUTPUT INSERTED.*
            VALUES (${kode_setoran}, ${id_pelanggan}, ${id_drop_point}, 'MENUNGGU_PENJEMPUTAN', ${catatan_serah_terima}, ${id_dibuat_oleh || id_pelanggan})
        `;
        res.status(201).json({ status: 'success', message: 'Setoran berhasil dibuat!', data: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// GET Riwayat Setoran Pelanggan
app.get('/api/setoran/riwayat/:id_pelanggan', async (req, res) => {
    const { id_pelanggan } = req.params;
    try {
        const result = await sql.query`
            SELECT s.*, dp.nama_drop_point, dp.alamat AS alamat_drop_point
            FROM t_setoran s
            JOIN m_drop_point dp ON s.id_drop_point = dp.id_drop_point
            WHERE s.id_pelanggan = ${id_pelanggan}
            ORDER BY s.id_setoran DESC
        `;
        res.status(200).json({ status: 'success', data: result.recordset });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// PUT Verifikasi Setoran oleh Petugas/Pengelola
app.put('/api/setoran/verifikasi/:id', async (req, res) => {
    const { id } = req.params;
    const { status, total_berat_kg, total_poin, id_diubah_oleh } = req.body;
    try {
        const result = await sql.query`
            UPDATE t_setoran
            SET status = ${status || 'SELESAI'},
                total_berat_kg = ${total_berat_kg || 0},
                total_poin = ${total_poin || 0},
                diubah_oleh = ${id_diubah_oleh || 1},
                diubah_pada = GETDATE()
            OUTPUT INSERTED.*
            WHERE id_setoran = ${id}
        `;
        res.status(200).json({ status: 'success', message: 'Setoran berhasil diverifikasi!', data: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// ==========================================
// 4. PENCAIRAN POIN & REWARDS (t_pencairan_poin)
// ==========================================

// POST Ajukan Pencairan Poin
app.post('/api/pencairan', async (req, res) => {
    const { id_pelanggan, jumlah_poin, jenis_pencairan, tujuan_pencairan, id_dibuat_oleh } = req.body;
    const kode_pencairan = 'PCR-' + Date.now();
    try {
        const result = await sql.query`
            INSERT INTO t_pencairan_poin (kode_pencairan, id_pelanggan, jumlah_poin, jenis_pencairan, tujuan_pencairan, status, dibuat_oleh)
            OUTPUT INSERTED.*
            VALUES (${kode_pencairan}, ${id_pelanggan}, ${jumlah_poin}, ${jenis_pencairan}, ${tujuan_pencairan}, 'DIPROSES', ${id_dibuat_oleh || id_pelanggan})
        `;
        res.status(201).json({ status: 'success', message: 'Pengajuan pencairan poin berhasil!', data: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// GET Riwayat Pencairan Poin Pelanggan
app.get('/api/pencairan/riwayat/:id_pelanggan', async (req, res) => {
    const { id_pelanggan } = req.params;
    try {
        const result = await sql.query`
            SELECT * FROM t_pencairan_poin
            WHERE id_pelanggan = ${id_pelanggan}
            ORDER BY id_pencairan DESC
        `;
        res.status(200).json({ status: 'success', data: result.recordset });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// POST Register Akun Baru (Support nama_usaha)
app.post('/api/auth/register', async (req, res) => {
    const { nama, nama_usaha, email, password, no_hp, jenis_pelanggan, alamat } = req.body;
    try {
        const result = await sql.query`
            INSERT INTO m_pengguna (nama, nama_usaha, email, password_hash, no_hp, peran, jenis_pelanggan, alamat, aktif)
            OUTPUT INSERTED.id_pengguna, INSERTED.nama, INSERTED.email, INSERTED.peran
            VALUES (${nama}, ${nama_usaha || null}, ${email}, ${password}, ${no_hp}, 'PELANGGAN', ${jenis_pelanggan || 'RUMAH_TANGGA'}, ${alamat}, 1)
        `;
        res.status(201).json({ status: 'success', message: 'Registrasi berhasil!', data: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// ==========================================
// 5. JENIS SAMPAH & ESTIMASI KARBON (m_jenis_sampah)
// ==========================================

// GET Semua Jenis Sampah
app.get('/api/jenis-sampah', async (req, res) => {
    try {
        const result = await sql.query`SELECT * FROM m_jenis_sampah WHERE aktif = 1`;
        res.status(200).json({ status: 'success', data: result.recordset });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server Backend berjalan di http://localhost:${PORT}`);
});