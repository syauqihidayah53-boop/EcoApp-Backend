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
    res.send('🚀 Server API EcoApp (ecoapp_db) Aktif dan Lengkap!');
});

// ====================================================
// 1. AUTENTIKASI, PENGGUNA & MITRA (m_pengguna, m_mitra)
// ====================================================

// GET Semua Pengguna
app.get('/api/pengguna', async (req, res) => {
    try {
        const result = await sql.query`
            SELECT id_pengguna, nama, email, no_hp, peran, jenis_pelanggan, id_mitra, nama_usaha, alamat, aktif, dibuat_pada
            FROM m_pengguna
        `;
        res.status(200).json({ status: 'success', data: result.recordset });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// GET Semua Mitra dari tabel m_mitra
app.get('/api/mitra', async (req, res) => {
    try {
        const result = await sql.query`SELECT * FROM m_mitra WHERE aktif = 1`;
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
            SELECT id_pengguna, nama, email, no_hp, peran, jenis_pelanggan, id_mitra, nama_usaha, alamat 
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

// POST Register Akun Baru (Sesuai constraint ck_pengguna_jenis & ck_pengguna_atribut_peran)
app.post('/api/auth/register', async (req, res) => {
    let { nama, nama_usaha, email, password, no_hp, peran, jenis_pelanggan, id_mitra, alamat } = req.body;

    const peranFinal = peran || 'PELANGGAN';

    // Normalisasi nilai jenis_pelanggan agar 100% lolos CHECK CONSTRAINT ck_pengguna_jenis
    if (jenis_pelanggan === 'UMKM') jenis_pelanggan = 'UMKM_KULINER';
    if (jenis_pelanggan === 'PEDAGANG') jenis_pelanggan = 'PEDAGANG_PASAR';

    const jenisPelangganFinal = peranFinal === 'PELANGGAN' ? (jenis_pelanggan || 'RUMAH_TANGGA') : null;
    const idMitraFinal = peranFinal === 'MITRA' ? (id_mitra || 1) : null;

    try {
        const result = await sql.query`
            INSERT INTO m_pengguna (nama, nama_usaha, email, password_hash, no_hp, peran, jenis_pelanggan, id_mitra, alamat, aktif)
            OUTPUT INSERTED.id_pengguna, INSERTED.nama, INSERTED.email, INSERTED.peran, INSERTED.jenis_pelanggan
            VALUES (
                ${nama}, 
                ${nama_usaha || null}, 
                ${email}, 
                ${password}, 
                ${no_hp}, 
                ${peranFinal}, 
                ${jenisPelangganFinal}, 
                ${idMitraFinal}, 
                ${alamat}, 
                1
            )
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
            SELECT id_pengguna, nama, email, no_hp, peran, jenis_pelanggan, id_mitra, nama_usaha, alamat 
            FROM m_pengguna 
            WHERE email = ${email} AND password_hash = ${password} AND aktif = 1
        `;
        if (result.recordset.length === 0) {
            return res.status(401).json({ status: 'error', message: 'Email atau kata sandi salah!' });
        }
        res.status(200).json({ status: 'success', message: 'Login berhasil!', data: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// PUT Update Profil Pelanggan
app.put('/api/pengguna/:id', async (req, res) => {
    const { id } = req.params;
    let { nama, nama_usaha, no_hp, jenis_pelanggan, alamat } = req.body;
    if (jenis_pelanggan === 'UMKM') jenis_pelanggan = 'UMKM_KULINER';
    if (jenis_pelanggan === 'PEDAGANG') jenis_pelanggan = 'PEDAGANG_PASAR';

    try {
        const result = await sql.query`
            UPDATE m_pengguna
            SET nama = ${nama},
                nama_usaha = ${nama_usaha || null},
                no_hp = ${no_hp},
                jenis_pelanggan = ${jenis_pelanggan || 'RUMAH_TANGGA'},
                alamat = ${alamat},
                diubah_pada = SYSUTCDATETIME()
            OUTPUT INSERTED.id_pengguna, INSERTED.nama, INSERTED.nama_usaha, INSERTED.email, INSERTED.no_hp, INSERTED.jenis_pelanggan, INSERTED.alamat
            WHERE id_pengguna = ${id}
        `;
        res.status(200).json({ status: 'success', message: 'Profil berhasil diperbarui!', data: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// ====================================================
// 2. DROP POINT & JENIS SAMPAH (m_drop_point, m_jenis_sampah)
// ====================================================

app.get('/api/drop-points', async (req, res) => {
    try {
        const result = await sql.query`SELECT * FROM m_drop_point WHERE aktif = 1`;
        res.status(200).json({ status: 'success', data: result.recordset });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.get('/api/jenis-sampah', async (req, res) => {
    try {
        const result = await sql.query`SELECT * FROM m_jenis_sampah WHERE aktif = 1`;
        res.status(200).json({ status: 'success', data: result.recordset });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.get('/api/slot-jemput', async (req, res) => {
    try {
        const result = await sql.query`SELECT * FROM t_slot_jemput WHERE aktif = 1`;
        res.status(200).json({ status: 'success', data: result.recordset });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// ====================================================
// 3. DASHBOARD PELANGGAN (Hitung dari t_detail_setoran & t_pencairan_poin)
// ====================================================

app.get('/api/dashboard/:id_pelanggan', async (req, res) => {
    const { id_pelanggan } = req.params;
    try {
        // Hitung total berat & poin dari t_setoran + t_detail_setoran
        const statSetoran = await sql.query`
            SELECT 
                COUNT(DISTINCT s.id_setoran) AS total_transaksi,
                ISNULL(SUM(ds.berat_diterima_kg), 0) AS total_berat_kg,
                ISNULL(SUM(ds.berat_diterima_kg * ds.poin_per_kg_snapshot), 0) AS total_poin_masuk
            FROM t_setoran s
            LEFT JOIN t_detail_setoran ds ON s.id_setoran = ds.id_setoran
            WHERE s.id_pelanggan = ${id_pelanggan} AND s.status NOT IN ('DITOLAK', 'DIBATALKAN')
        `;

        // Hitung poin yang sudah dicairkan dari t_pencairan_poin
        const statPencairan = await sql.query`
            SELECT ISNULL(SUM(jumlah_poin), 0) AS total_poin_keluar
            FROM t_pencairan_poin
            WHERE id_pelanggan = ${id_pelanggan} AND status NOT IN ('DITOLAK', 'DIBATALKAN')
        `;

        const poinMasuk = Number(statSetoran.recordset[0].total_poin_masuk || 0);
        const poinKeluar = Number(statPencairan.recordset[0].total_poin_keluar || 0);
        const totalBerat = Number(statSetoran.recordset[0].total_berat_kg || 0);

        res.status(200).json({
            status: 'success',
            data: {
                id_pelanggan: Number(id_pelanggan),
                saldo_poin_aktif: poinMasuk - poinKeluar,
                total_poin_masuk: poinMasuk,
                total_poin_dicairkan: poinKeluar,
                total_berat_kg: totalBerat,
                total_transaksi: statSetoran.recordset[0].total_transaksi,
                estimasi_co2_kg: Number((totalBerat * 1.5).toFixed(2))
            }
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// ====================================================
// 4. SETORAN SAMPAH (t_setoran & t_detail_setoran)
// ====================================================

// POST Buat Setoran Baru (Status wajib 'DIAJUKAN' sesuai ck_setoran_status)
app.post('/api/setoran', async (req, res) => {
    const { id_pelanggan, id_drop_point, catatan_serah_terima, id_dibuat_oleh } = req.body;
    try {
        const result = await sql.query`
            INSERT INTO t_setoran (id_pelanggan, id_drop_point, status, status_terima_drop_point, catatan_serah_terima, dibuat_oleh)
            OUTPUT INSERTED.*
            VALUES (${id_pelanggan}, ${id_drop_point}, 'DIAJUKAN', 'MENUNGGU', ${catatan_serah_terima}, ${id_dibuat_oleh || id_pelanggan})
        `;
        res.status(201).json({ status: 'success', message: 'Setoran berhasil diajukan!', data: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// GET Riwayat Setoran Pelanggan
app.get('/api/setoran/riwayat/:id_pelanggan', async (req, res) => {
    const { id_pelanggan } = req.params;
    try {
        const result = await sql.query`
            SELECT 
                s.*, 
                dp.nama_drop_point, 
                dp.alamat AS alamat_drop_point,
                ISNULL((SELECT SUM(berat_diterima_kg) FROM t_detail_setoran WHERE id_setoran = s.id_setoran), 0) AS total_berat_kg,
                ISNULL((SELECT SUM(berat_diterima_kg * poin_per_kg_snapshot) FROM t_detail_setoran WHERE id_setoran = s.id_setoran), 0) AS total_poin
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

// GET Antrean Setoran untuk Mitra / Pengelola
app.get('/api/setoran/antrean', async (req, res) => {
    try {
        const result = await sql.query`
            SELECT 
                s.*, 
                p.nama AS nama_pelanggan, 
                p.no_hp AS no_hp_pelanggan, 
                p.alamat AS alamat_jemput,
                dp.nama_drop_point
            FROM t_setoran s
            JOIN m_pengguna p ON s.id_pelanggan = p.id_pengguna
            JOIN m_drop_point dp ON s.id_drop_point = dp.id_drop_point
            ORDER BY s.id_setoran DESC
        `;
        res.status(200).json({ status: 'success', data: result.recordset });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// ====================================================
// 5. PENCAIRAN POIN (t_pencairan_poin)
// ====================================================

app.post('/api/pencairan', async (req, res) => {
    const { id_pelanggan, jumlah_poin, nilai_rupiah_per_poin_snapshot, nama_bank, nomor_rekening, nama_pemilik_rekening } = req.body;
    try {
        const result = await sql.query`
            INSERT INTO t_pencairan_poin (
                id_pelanggan, jumlah_poin, nilai_rupiah_per_poin_snapshot, 
                nama_bank, nomor_rekening, nama_pemilik_rekening, status
            )
            OUTPUT INSERTED.*
            VALUES (
                ${id_pelanggan}, 
                ${jumlah_poin}, 
                ${nilai_rupiah_per_poin_snapshot || 1}, 
                ${nama_bank || 'E-Wallet / Bank'}, 
                ${nomor_rekening || '-'}, 
                ${nama_pemilik_rekening || 'Pelanggan EcoApp'}, 
                'DIAJUKAN'
            )
        `;
        res.status(201).json({ status: 'success', message: 'Pengajuan pencairan poin berhasil!', data: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

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

app.listen(PORT, () => {
    console.log(`🚀 Server Backend berjalan di http://localhost:${PORT}`);
});