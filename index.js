const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { sql, connectDB } = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Hubungkan ke SQL Server
connectDB();

app.get('/', (req, res) => {
    res.send('🚀 Server API Pilahin / EcoApp Aktif dan Lengkap!');
});

// ====================================================
// 1. REGISTRASI & LOGIN (Mendukung m_pengguna & pengguna)
// ====================================================

// POST Register Akun Baru Pelanggan
app.post('/api/auth/register', async (req, res) => {
    let { nama, nama_usaha, email, password, no_hp, peran, jenis_pelanggan, alamat } = req.body;

    nama = (nama || '').trim();
    email = (email || '').trim().toLowerCase();
    no_hp = (no_hp || '').trim();
    alamat = (alamat || '').trim();
    nama_usaha = nama_usaha && nama_usaha.trim() !== '' ? nama_usaha.trim() : null;

    if (!nama || !email || !password || !alamat) {
        return res.status(400).json({
            status: 'error',
            message: 'Nama, Email, Password, dan Alamat wajib diisi!'
        });
    }

    let jenisPelangganStr = jenis_pelanggan || 'RUMAH_TANGGA';
    if (jenisPelangganStr === 'UMKM') jenisPelangganStr = 'UMKM_KULINER';
    if (jenisPelangganStr === 'PEDAGANG') jenisPelangganStr = 'PEDAGANG_PASAR';

    let peranInt = 1; // 1 = Rumah Tangga, 2 = UMKM Kuliner, 3 = Pedagang Pasar
    if (jenisPelangganStr === 'UMKM_KULINER' || Number(peran) === 2) peranInt = 2;
    if (jenisPelangganStr === 'PEDAGANG_PASAR' || Number(peran) === 3) peranInt = 3;

    try {
        const cekEmail = await sql.query`SELECT id_pengguna FROM m_pengguna WHERE email = ${email}`;
        if (cekEmail.recordset.length > 0) {
            return res.status(400).json({ status: 'error', message: 'Email sudah terdaftar! Silakan gunakan email lain atau Masuk.' });
        }

        const result = await sql.query`
            INSERT INTO m_pengguna (nama, nama_usaha, email, password_hash, no_hp, peran, jenis_pelanggan, id_mitra, alamat, aktif)
            OUTPUT INSERTED.id_pengguna, INSERTED.nama, INSERTED.nama_usaha, INSERTED.email, INSERTED.no_hp, INSERTED.peran, INSERTED.jenis_pelanggan, INSERTED.alamat
            VALUES (
                ${nama},
                ${nama_usaha},
                ${email},
                ${password},
                ${no_hp},
                'PELANGGAN',
                ${jenisPelangganStr},
                NULL,
                ${alamat},
                1
            )
        `;

        return res.status(201).json({
            status: 'success',
            message: 'Registrasi berhasil! Silakan masuk dengan akun Anda.',
            data: result.recordset[0]
        });
    } catch (errFirst) {
        // Fallback otomatis jika database memakai tabel `pengguna` (tanpa m_ dan peran INT 1,2,3)
        try {
            const cekEmailBaru = await sql.query`SELECT id_pengguna FROM pengguna WHERE email = ${email}`;
            if (cekEmailBaru.recordset.length > 0) {
                return res.status(400).json({ status: 'error', message: 'Email sudah terdaftar! Silakan Masuk.' });
            }

            const resultBaru = await sql.query`
                INSERT INTO pengguna (nama, nama_usaha, email, password_hash, no_hp, peran, id_mitra, alamat, aktif, is_deleted)
                OUTPUT INSERTED.id_pengguna, INSERTED.nama, INSERTED.nama_usaha, INSERTED.email, INSERTED.no_hp, INSERTED.peran, INSERTED.alamat
                VALUES (
                    ${nama},
                    ${nama_usaha},
                    ${email},
                    ${password},
                    ${no_hp},
                    ${peranInt},
                    NULL,
                    ${alamat},
                    1,
                    0
                )
            `;

            return res.status(201).json({
                status: 'success',
                message: 'Registrasi berhasil! Silakan masuk dengan akun Anda.',
                data: resultBaru.recordset[0]
            });
        } catch (errSecond) {
            console.error('Error Register SQL:', errFirst.message);
            return res.status(500).json({
                status: 'error',
                message: errFirst.message || errSecond.message
            });
        }
    }
});

// POST Login Pengguna
app.post('/api/auth/login', async (req, res) => {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    try {
        const result = await sql.query`
            SELECT id_pengguna, nama, email, no_hp, peran, jenis_pelanggan, id_mitra, nama_usaha, alamat
            FROM m_pengguna
            WHERE email = ${email} AND password_hash = ${password} AND aktif = 1
        `;
        if (result.recordset.length === 0) {
            return res.status(401).json({ status: 'error', message: 'Email atau password salah!' });
        }
        return res.status(200).json({
            status: 'success',
            message: 'Login berhasil!',
            data: result.recordset[0]
        });
    } catch (errFirst) {
        try {
            const resultBaru = await sql.query`
                SELECT id_pengguna, nama, email, no_hp, peran, id_mitra, nama_usaha, alamat
                FROM pengguna
                WHERE email = ${email} AND password_hash = ${password} AND aktif = 1 AND is_deleted = 0
            `;
            if (resultBaru.recordset.length === 0) {
                return res.status(401).json({ status: 'error', message: 'Email atau password salah!' });
            }
            const user = resultBaru.recordset[0];
            if (Number(user.peran) === 1) user.jenis_pelanggan = 'RUMAH_TANGGA';
            else if (Number(user.peran) === 2) user.jenis_pelanggan = 'UMKM_KULINER';
            else if (Number(user.peran) === 3) user.jenis_pelanggan = 'PEDAGANG_PASAR';

            return res.status(200).json({
                status: 'success',
                message: 'Login berhasil!',
                data: user
            });
        } catch (errSecond) {
            return res.status(500).json({ status: 'error', message: errFirst.message });
        }
    }
});

// ====================================================
// 2. DASHBOARD PENGGUNA (100% DATA REAL DARI SQL SERVER)
// ====================================================

app.get('/api/dashboard/:id_pelanggan', async (req, res) => {
    const { id_pelanggan } = req.params;

    try {
        // Skema m_pengguna / t_setoran
        const userRes = await sql.query`
            SELECT id_pengguna, nama, email, no_hp, peran, jenis_pelanggan, nama_usaha, alamat
            FROM m_pengguna
            WHERE id_pengguna = ${id_pelanggan}
        `;
        const profil = userRes.recordset[0] || null;

        const statPoinMasuk = await sql.query`
            SELECT 
                ISNULL(SUM(
                    FLOOR(ds.berat_diterima_kg * ds.poin_per_kg_snapshot) -
                    FLOOR(FLOOR(ds.berat_diterima_kg * ds.poin_per_kg_snapshot) * ISNULL(p.potongan_persen_disepakati, 0) / 100.0)
                ), 0) AS total_poin_masuk
            FROM t_setoran s
            JOIN t_detail_setoran ds ON s.id_setoran = ds.id_setoran
            LEFT JOIN t_penjemputan p ON s.id_setoran = p.id_setoran
            WHERE s.id_pelanggan = ${id_pelanggan} AND s.status IN ('FINAL', '3')
        `;

        const statPencairan = await sql.query`
            SELECT 
                ISNULL(SUM(CASE WHEN status IN ('DIAJUKAN', 'DIPROSES', 'DIBAYAR', '1', '2', '3') THEN jumlah_poin ELSE 0 END), 0) AS total_poin_keluar,
                ISNULL(SUM(CASE WHEN status IN ('DIAJUKAN', 'DIPROSES', '1', '2') THEN jumlah_poin ELSE 0 END), 0) AS poin_diproses
            FROM t_pencairan_poin
            WHERE id_pelanggan = ${id_pelanggan}
        `;

        const rincianMaterial = await sql.query`
            SELECT 
                ISNULL(SUM(CASE WHEN js.nama_jenis LIKE '%Plastik%' THEN ds.berat_diterima_kg ELSE 0 END), 0) AS plastik_kg,
                ISNULL(SUM(CASE WHEN js.nama_jenis LIKE '%Kardus%' OR js.nama_jenis LIKE '%Kertas%' THEN ds.berat_diterima_kg ELSE 0 END), 0) AS kardus_kg,
                ISNULL(SUM(CASE WHEN js.nama_jenis LIKE '%Kaca%' THEN ds.berat_diterima_kg ELSE 0 END), 0) AS kaca_kg,
                ISNULL(SUM(CASE WHEN js.nama_jenis LIKE '%Logam%' OR js.nama_jenis LIKE '%Kaleng%' OR js.nama_jenis LIKE '%Besi%' THEN ds.berat_diterima_kg ELSE 0 END), 0) AS logam_kg,
                ISNULL(SUM(ds.berat_diterima_kg), 0) AS total_bulan_ini_kg
            FROM t_setoran s
            JOIN t_detail_setoran ds ON s.id_setoran = ds.id_setoran
            JOIN m_jenis_sampah js ON ds.id_jenis_sampah = js.id_jenis_sampah
            WHERE s.id_pelanggan = ${id_pelanggan}
              AND s.status IN ('FINAL', '3')
              AND MONTH(s.dibuat_pada) = MONTH(GETUTCDATE())
              AND YEAR(s.dibuat_pada) = YEAR(GETUTCDATE())
        `;

        const dropPointRes = await sql.query`
            SELECT COUNT(*) AS total_drop_point FROM m_drop_point WHERE aktif = 1
        `;

        const jemputRes = await sql.query`
            SELECT TOP 1
                p.id_penjemputan,
                p.id_setoran,
                p.status,
                p.alamat_jemput,
                sl.mulai_pada,
                sl.selesai_pada,
                petugas.nama AS nama_kurir,
                petugas.no_hp AS no_hp_kurir
            FROM t_penjemputan p
            JOIN t_setoran s ON p.id_setoran = s.id_setoran
            JOIN t_slot_jemput sl ON p.id_slot = sl.id_slot
            LEFT JOIN m_pengguna petugas ON p.id_petugas_mitra = petugas.id_pengguna
            WHERE s.id_pelanggan = ${id_pelanggan}
              AND p.status IN ('DIAJUKAN', 'DIJADWALKAN', 'DALAM_PERJALANAN')
            ORDER BY sl.mulai_pada ASC
        `;

        const poinMasuk = Number(statPoinMasuk.recordset[0]?.total_poin_masuk || 0);
        const poinKeluar = Number(statPencairan.recordset[0]?.total_poin_keluar || 0);
        const poinDiproses = Number(statPencairan.recordset[0]?.poin_diproses || 0);
        const saldoTersedia = Math.max(0, poinMasuk - poinKeluar);
        const mat = rincianMaterial.recordset[0] || {};

        return res.status(200).json({
            status: 'success',
            data: {
                profil,
                saldo_poin_aktif: saldoTersedia,
                nominal_rupiah: saldoTersedia * 10,
                poin_diproses: poinDiproses,
                jumlah_drop_point: Number(dropPointRes.recordset[0]?.total_drop_point || 0),
                total_berat_kg: Number(mat.total_bulan_ini_kg || 0),
                material_kg: {
                    plastik: Number(mat.plastik_kg || 0),
                    kardus: Number(mat.kardus_kg || 0),
                    kaca: Number(mat.kaca_kg || 0),
                    logam: Number(mat.logam_kg || 0)
                },
                jemputan_berikutnya: jemputRes.recordset[0] || null
            }
        });
    } catch (errFirst) {
        // Fallback otomatis untuk skema tabel tanpa awalan m_ dan t_ (kamus data terbaru)
        try {
            const userRes = await sql.query`
                SELECT id_pengguna, nama, email, no_hp, peran, nama_usaha, alamat
                FROM pengguna
                WHERE id_pengguna = ${id_pelanggan} AND is_deleted = 0
            `;
            const profil = userRes.recordset[0] || null;
            if (profil) {
                if (Number(profil.peran) === 1) profil.jenis_pelanggan = 'RUMAH_TANGGA';
                else if (Number(profil.peran) === 2) profil.jenis_pelanggan = 'UMKM_KULINER';
                else if (Number(profil.peran) === 3) profil.jenis_pelanggan = 'PEDAGANG_PASAR';
            }

            const statPoinMasuk = await sql.query`
                SELECT 
                    ISNULL(SUM(
                        FLOOR(ds.berat_diterima_kg * ds.poin_per_kg_snapshot) -
                        FLOOR(FLOOR(ds.berat_diterima_kg * ds.poin_per_kg_snapshot) * ISNULL(p.potongan_persen_disepakati, 0) / 100.0)
                    ), 0) AS total_poin_masuk
                FROM setoran s
                JOIN detail_setoran ds ON s.id_setoran = ds.id_setoran
                LEFT JOIN penjemputan p ON s.id_setoran = p.id_setoran
                WHERE s.id_pengguna = ${id_pelanggan} AND s.status = 3 AND s.aktif = 1
            `;

            const statPencairan = await sql.query`
                SELECT 
                    ISNULL(SUM(CASE WHEN status IN (1, 2, 3) THEN jumlah_poin ELSE 0 END), 0) AS total_poin_keluar,
                    ISNULL(SUM(CASE WHEN status IN (1, 2) THEN jumlah_poin ELSE 0 END), 0) AS poin_diproses
                FROM pencairan_poin
                WHERE id_pengguna = ${id_pelanggan} AND aktif = 1
            `;

            const rincianMaterial = await sql.query`
                SELECT 
                    ISNULL(SUM(CASE WHEN js.nama_jenis LIKE '%Plastik%' THEN ds.berat_diterima_kg ELSE 0 END), 0) AS plastik_kg,
                    ISNULL(SUM(CASE WHEN js.nama_jenis LIKE '%Kardus%' THEN ds.berat_diterima_kg ELSE 0 END), 0) AS kardus_kg,
                    ISNULL(SUM(CASE WHEN js.nama_jenis LIKE '%Kaca%' THEN ds.berat_diterima_kg ELSE 0 END), 0) AS kaca_kg,
                    ISNULL(SUM(CASE WHEN js.nama_jenis LIKE '%Logam%' THEN ds.berat_diterima_kg ELSE 0 END), 0) AS logam_kg,
                    ISNULL(SUM(ds.berat_diterima_kg), 0) AS total_bulan_ini_kg
                FROM setoran s
                JOIN detail_setoran ds ON s.id_setoran = ds.id_setoran
                JOIN jenis_sampah js ON ds.id_jenis_sampah = js.id_jenis_sampah
                WHERE s.id_pengguna = ${id_pelanggan}
                  AND s.status = 3
                  AND MONTH(s.dibuat_pada) = MONTH(GETUTCDATE())
                  AND YEAR(s.dibuat_pada) = YEAR(GETUTCDATE())
            `;

            const dropPointRes = await sql.query`
                SELECT COUNT(*) AS total_drop_point FROM drop_point WHERE aktif = 1 AND is_deleted = 0
            `;

            const jemputRes = await sql.query`
                SELECT TOP 1
                    p.id_penjemputan,
                    p.id_setoran,
                    p.status,
                    p.alamat_jemput,
                    sl.mulai_pada,
                    sl.selesai_pada,
                    petugas.nama AS nama_kurir,
                    petugas.no_hp AS no_hp_kurir
                FROM penjemputan p
                JOIN setoran s ON p.id_setoran = s.id_setoran
                JOIN slot_jemput sl ON p.id_slot = sl.id_slot
                LEFT JOIN pengguna petugas ON p.id_petugas = petugas.id_pengguna
                WHERE s.id_pengguna = ${id_pelanggan}
                  AND p.status IN ('DIAJUKAN', 'DIJADWALKAN', 'DALAM_PERJALANAN')
                ORDER BY sl.mulai_pada ASC
            `;

            const poinMasuk = Number(statPoinMasuk.recordset[0]?.total_poin_masuk || 0);
            const poinKeluar = Number(statPencairan.recordset[0]?.total_poin_keluar || 0);
            const poinDiproses = Number(statPencairan.recordset[0]?.poin_diproses || 0);
            const saldoTersedia = Math.max(0, poinMasuk - poinKeluar);
            const mat = rincianMaterial.recordset[0] || {};

            return res.status(200).json({
                status: 'success',
                data: {
                    profil,
                    saldo_poin_aktif: saldoTersedia,
                    nominal_rupiah: saldoTersedia * 10,
                    poin_diproses: poinDiproses,
                    jumlah_drop_point: Number(dropPointRes.recordset[0]?.total_drop_point || 0),
                    total_berat_kg: Number(mat.total_bulan_ini_kg || 0),
                    material_kg: {
                        plastik: Number(mat.plastik_kg || 0),
                        kardus: Number(mat.kardus_kg || 0),
                        kaca: Number(mat.kaca_kg || 0),
                        logam: Number(mat.logam_kg || 0)
                    },
                    jemputan_berikutnya: jemputRes.recordset[0] || null
                }
            });
        } catch (errSecond) {
            return res.status(500).json({ status: 'error', message: errSecond.message });
        }
    }
});

// PUT Update Kategori Pelanggan dari Kartu "Anda sebagai siapa?" di Dashboard
app.put('/api/pengguna/:id/kategori', async (req, res) => {
    const { id } = req.params;
    const { jenis_pelanggan } = req.body;

    let peranInt = 1;
    if (jenis_pelanggan === 'UMKM_KULINER') peranInt = 2;
    if (jenis_pelanggan === 'PEDAGANG_PASAR') peranInt = 3;

    try {
        await sql.query`
            UPDATE m_pengguna 
            SET jenis_pelanggan = ${jenis_pelanggan}
            WHERE id_pengguna = ${id}
        `;
        return res.status(200).json({ status: 'success', message: 'Kategori profil berhasil diperbarui!' });
    } catch (errFirst) {
        try {
            await sql.query`
                UPDATE pengguna 
                SET peran = ${peranInt}, diubah_oleh = ${id}, diubah_pada = GETUTCDATE()
                WHERE id_pengguna = ${id}
            `;
            return res.status(200).json({ status: 'success', message: 'Kategori profil berhasil diperbarui!' });
        } catch (errSecond) {
            return res.status(500).json({ status: 'error', message: errSecond.message });
        }
    }
});

// ====================================================
// 3. MASTER PENGGUNA, MITRA, DROP POINT, JENIS SAMPAH
// ====================================================

app.get('/api/pengguna', async (req, res) => {
    try {
        const result = await sql.query`SELECT id_pengguna, nama, email, no_hp, peran, jenis_pelanggan, nama_usaha, alamat, aktif FROM m_pengguna`;
        res.status(200).json({ status: 'success', data: result.recordset });
    } catch (err) {
        const resultBaru = await sql.query`SELECT id_pengguna, nama, email, no_hp, peran, nama_usaha, alamat, aktif FROM pengguna WHERE is_deleted = 0`;
        res.status(200).json({ status: 'success', data: resultBaru.recordset });
    }
});

app.get('/api/pengguna/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await sql.query`SELECT id_pengguna, nama, email, no_hp, peran, jenis_pelanggan, nama_usaha, alamat FROM m_pengguna WHERE id_pengguna = ${id}`;
        if (result.recordset.length === 0) return res.status(404).json({ status: 'error', message: 'Pengguna tidak ditemukan' });
        res.status(200).json({ status: 'success', data: result.recordset[0] });
    } catch (err) {
        const resultBaru = await sql.query`SELECT id_pengguna, nama, email, no_hp, peran, nama_usaha, alamat FROM pengguna WHERE id_pengguna = ${id} AND is_deleted = 0`;
        if (resultBaru.recordset.length === 0) return res.status(404).json({ status: 'error', message: 'Pengguna tidak ditemukan' });
        res.status(200).json({ status: 'success', data: resultBaru.recordset[0] });
    }
});

app.get('/api/mitra', async (req, res) => {
    try {
        const result = await sql.query`SELECT * FROM m_mitra WHERE aktif = 1`;
        res.status(200).json({ status: 'success', data: result.recordset });
    } catch (err) {
        const resultBaru = await sql.query`SELECT * FROM mitra WHERE aktif = 1 AND is_deleted = 0`;
        res.status(200).json({ status: 'success', data: resultBaru.recordset });
    }
});

app.get('/api/drop-points', async (req, res) => {
    try {
        const result = await sql.query`SELECT * FROM m_drop_point WHERE aktif = 1`;
        res.status(200).json({ status: 'success', data: result.recordset });
    } catch (err) {
        const resultBaru = await sql.query`SELECT * FROM drop_point WHERE aktif = 1 AND is_deleted = 0`;
        res.status(200).json({ status: 'success', data: resultBaru.recordset });
    }
});

app.get('/api/jenis-sampah', async (req, res) => {
    try {
        const result = await sql.query`SELECT * FROM m_jenis_sampah WHERE aktif = 1`;
        res.status(200).json({ status: 'success', data: result.recordset });
    } catch (err) {
        const resultBaru = await sql.query`SELECT * FROM jenis_sampah WHERE aktif = 1 AND is_deleted = 0`;
        res.status(200).json({ status: 'success', data: resultBaru.recordset });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server Backend berjalan di http://localhost:${PORT}`);
});

// ====================================================
// 4. API CRUD MASTER MITRA (M02 MITRA - SYAUQI)
// ====================================================

// GET Semua Mitra (Mendukung filter & menghitung jumlah petugas terhubung)
app.get('/api/mitra', async (req, res) => {
    try {
        const result = await sql.query`
            SELECT 
                m.id_mitra,
                m.nama_mitra,
                m.nama_penanggung_jawab,
                m.no_hp,
                m.alamat_mitra,
                m.aktif,
                m.dibuat_pada,
                m.diubah_pada,
                (SELECT COUNT(*) FROM m_pengguna p WHERE p.id_mitra = m.id_mitra AND p.aktif = 1) AS jumlah_petugas
            FROM m_mitra m
            ORDER BY m.aktif DESC, m.id_mitra DESC
        `;
        return res.status(200).json({ status: 'success', data: result.recordset });
    } catch (errFirst) {
        try {
            const resultBaru = await sql.query`
                SELECT 
                    m.id_mitra,
                    m.nama_mitra,
                    m.nama_penanggung_jawab,
                    m.no_hp,
                    m.alamat_mitra,
                    m.aktif,
                    m.is_deleted,
                    m.dibuat_pada,
                    m.diubah_pada,
                    (SELECT COUNT(*) FROM pengguna p WHERE p.id_mitra = m.id_mitra AND p.aktif = 1 AND p.is_deleted = 0) AS jumlah_petugas
                FROM mitra m
                WHERE m.is_deleted = 0
                ORDER BY m.aktif DESC, m.id_mitra DESC
            `;
            return res.status(200).json({ status: 'success', data: resultBaru.recordset });
        } catch (errSecond) {
            return res.status(500).json({ status: 'error', message: errSecond.message });
        }
    }
});

// GET Detail 1 Mitra beserta daftar petugasnya
app.get('/api/mitra/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const mitraRes = await sql.query`SELECT * FROM m_mitra WHERE id_mitra = ${id}`;
        if (mitraRes.recordset.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Organisasi mitra tidak ditemukan.' });
        }
        const petugasRes = await sql.query`
            SELECT id_pengguna, nama, email, no_hp, aktif 
            FROM m_pengguna 
            WHERE id_mitra = ${id}
        `;
        return res.status(200).json({
            status: 'success',
            data: { ...mitraRes.recordset[0], daftar_petugas: petugasRes.recordset }
        });
    } catch (errFirst) {
        try {
            const mitraRes = await sql.query`SELECT * FROM mitra WHERE id_mitra = ${id} AND is_deleted = 0`;
            if (mitraRes.recordset.length === 0) {
                return res.status(404).json({ status: 'error', message: 'Organisasi mitra tidak ditemukan.' });
            }
            const petugasRes = await sql.query`
                SELECT id_pengguna, nama, email, no_hp, aktif 
                FROM pengguna 
                WHERE id_mitra = ${id} AND is_deleted = 0
            `;
            return res.status(200).json({
                status: 'success',
                data: { ...mitraRes.recordset[0], daftar_petugas: petugasRes.recordset }
            });
        } catch (errSecond) {
            return res.status(500).json({ status: 'error', message: errSecond.message });
        }
    }
});

// POST Tambah Organisasi Mitra Baru
app.post('/api/mitra', async (req, res) => {
    let { nama_mitra, nama_penanggung_jawab, no_hp, alamat_mitra, dibuat_oleh } = req.body;

    nama_mitra = (nama_mitra || '').trim();
    nama_penanggung_jawab = nama_penanggung_jawab && nama_penanggung_jawab.trim() !== '' ? nama_penanggung_jawab.trim() : null;
    no_hp = no_hp && no_hp.trim() !== '' ? no_hp.trim() : null;
    alamat_mitra = (alamat_mitra || '').trim();
    const idPembuat = dibuat_oleh ? Number(dibuat_oleh) : null;

    if (!nama_mitra || !alamat_mitra) {
        return res.status(400).json({
            status: 'error',
            message: 'Nama Mitra dan Alamat Mitra wajib diisi!'
        });
    }

    try {
        const cekUnik = await sql.query`SELECT id_mitra FROM m_mitra WHERE nama_mitra = ${nama_mitra}`;
        if (cekUnik.recordset.length > 0) {
            return res.status(400).json({ status: 'error', message: 'Nama organisasi mitra sudah terdaftar!' });
        }

        const result = await sql.query`
            INSERT INTO m_mitra (nama_mitra, nama_penanggung_jawab, no_hp, alamat_mitra, aktif)
            OUTPUT INSERTED.*
            VALUES (${nama_mitra}, ${nama_penanggung_jawab}, ${no_hp}, ${alamat_mitra}, 1)
        `;
        return res.status(201).json({
            status: 'success',
            message: 'Organisasi mitra berhasil ditambahkan!',
            data: result.recordset[0]
        });
    } catch (errFirst) {
        try {
            const cekUnikBaru = await sql.query`SELECT id_mitra FROM mitra WHERE nama_mitra = ${nama_mitra} AND is_deleted = 0`;
            if (cekUnikBaru.recordset.length > 0) {
                return res.status(400).json({ status: 'error', message: 'Nama organisasi mitra sudah terdaftar!' });
            }

            const resultBaru = await sql.query`
                INSERT INTO mitra (nama_mitra, nama_penanggung_jawab, no_hp, alamat_mitra, aktif, dibuat_oleh, dibuat_pada, is_deleted)
                OUTPUT INSERTED.*
                VALUES (${nama_mitra}, ${nama_penanggung_jawab}, ${no_hp}, ${alamat_mitra}, 1, ${idPembuat}, GETUTCDATE(), 0)
            `;
            return res.status(201).json({
                status: 'success',
                message: 'Organisasi mitra berhasil ditambahkan!',
                data: resultBaru.recordset[0]
            });
        } catch (errSecond) {
            return res.status(500).json({ status: 'error', message: errFirst.message || errSecond.message });
        }
    }
});

// PUT Ubah Data Kontak / Alamat Organisasi Mitra
app.put('/api/mitra/:id', async (req, res) => {
    const { id } = req.params;
    let { nama_mitra, nama_penanggung_jawab, no_hp, alamat_mitra, aktif, diubah_oleh } = req.body;

    nama_mitra = (nama_mitra || '').trim();
    nama_penanggung_jawab = nama_penanggung_jawab && nama_penanggung_jawab.trim() !== '' ? nama_penanggung_jawab.trim() : null;
    no_hp = no_hp && no_hp.trim() !== '' ? no_hp.trim() : null;
    alamat_mitra = (alamat_mitra || '').trim();
    const statusAktif = aktif !== undefined ? Number(aktif) : 1;
    const idPengubah = diubah_oleh ? Number(diubah_oleh) : null;

    if (!nama_mitra || !alamat_mitra) {
        return res.status(400).json({
            status: 'error',
            message: 'Nama Mitra dan Alamat Mitra wajib diisi!'
        });
    }

    try {
        const cekUnik = await sql.query`
            SELECT id_mitra FROM m_mitra WHERE nama_mitra = ${nama_mitra} AND id_mitra <> ${id}
        `;
        if (cekUnik.recordset.length > 0) {
            return res.status(400).json({ status: 'error', message: 'Nama organisasi mitra sudah dipakai mitra lain!' });
        }

        const result = await sql.query`
            UPDATE m_mitra
            SET nama_mitra = ${nama_mitra},
                nama_penanggung_jawab = ${nama_penanggung_jawab},
                no_hp = ${no_hp},
                alamat_mitra = ${alamat_mitra},
                aktif = ${statusAktif},
                diubah_pada = SYSUTCDATETIME()
            OUTPUT INSERTED.*
            WHERE id_mitra = ${id}
        `;
        return res.status(200).json({
            status: 'success',
            message: 'Data organisasi mitra berhasil diperbarui!',
            data: result.recordset[0]
        });
    } catch (errFirst) {
        try {
            const cekUnikBaru = await sql.query`
                SELECT id_mitra FROM mitra WHERE nama_mitra = ${nama_mitra} AND id_mitra <> ${id} AND is_deleted = 0
            `;
            if (cekUnikBaru.recordset.length > 0) {
                return res.status(400).json({ status: 'error', message: 'Nama organisasi mitra sudah dipakai mitra lain!' });
            }

            const resultBaru = await sql.query`
                UPDATE mitra
                SET nama_mitra = ${nama_mitra},
                    nama_penanggung_jawab = ${nama_penanggung_jawab},
                    no_hp = ${no_hp},
                    alamat_mitra = ${alamat_mitra},
                    aktif = ${statusAktif},
                    diubah_oleh = ${idPengubah},
                    diubah_pada = GETUTCDATE()
                OUTPUT INSERTED.*
                WHERE id_mitra = ${id} AND is_deleted = 0
            `;
            return res.status(200).json({
                status: 'success',
                message: 'Data organisasi mitra berhasil diperbarui!',
                data: resultBaru.recordset[0]
            });
        } catch (errSecond) {
            return res.status(500).json({ status: 'error', message: errFirst.message || errSecond.message });
        }
    }
});

// PATCH Aktifkan / Nonaktifkan Mitra
app.patch('/api/mitra/:id/status', async (req, res) => {
    const { id } = req.params;
    const { aktif, diubah_oleh } = req.body;
    const statusBaru = Number(aktif) === 1 ? 1 : 0;
    const idPengubah = diubah_oleh ? Number(diubah_oleh) : null;

    try {
        await sql.query`
            UPDATE m_mitra 
            SET aktif = ${statusBaru}, diubah_pada = SYSUTCDATETIME()
            WHERE id_mitra = ${id}
        `;
        return res.status(200).json({
            status: 'success',
            message: statusBaru === 1 ? 'Mitra berhasil diaktifkan!' : 'Mitra berhasil dinonaktifkan!'
        });
    } catch (errFirst) {
        try {
            await sql.query`
                UPDATE mitra 
                SET aktif = ${statusBaru}, diubah_oleh = ${idPengubah}, diubah_pada = GETUTCDATE()
                WHERE id_mitra = ${id} AND is_deleted = 0
            `;
            return res.status(200).json({
                status: 'success',
                message: statusBaru === 1 ? 'Mitra berhasil diaktifkan!' : 'Mitra berhasil dinonaktifkan!'
            });
        } catch (errSecond) {
            return res.status(500).json({ status: 'error', message: errSecond.message });
        }
    }
});

// DELETE Soft Delete Mitra (is_deleted = 1 mewajibkan aktif = 0 sesuai Kamus Data)
app.delete('/api/mitra/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await sql.query`
            UPDATE m_mitra SET aktif = 0, diubah_pada = SYSUTCDATETIME() WHERE id_mitra = ${id}
        `;
        return res.status(200).json({
            status: 'success',
            message: 'Organisasi mitra berhasil dinonaktifkan (Soft Delete).'
        });
    } catch (errFirst) {
        try {
            await sql.query`
                UPDATE mitra 
                SET aktif = 0, is_deleted = 1, diubah_pada = GETUTCDATE() 
                WHERE id_mitra = ${id}
            `;
            return res.status(200).json({
                status: 'success',
                message: 'Organisasi mitra berhasil dihapus secara soft-delete (histori transaksi tetap aman).'
            });
        } catch (errSecond) {
            return res.status(500).json({ status: 'error', message: errSecond.message });
        }
    }
});

// GET Ringkasan Real-Time Dashboard Pengelola
app.get('/api/dashboard-pengelola', async (req, res) => {
    try {
        const dpRes = await sql.query`SELECT TOP 1 nama_drop_point FROM m_drop_point WHERE aktif = 1`;
        const menungguVerif = await sql.query`SELECT COUNT(*) AS jml FROM t_setoran WHERE status IN ('DIAJUKAN', '2')`;
        const belumTugas = await sql.query`SELECT COUNT(*) AS jml FROM t_penjemputan WHERE status = 'DIAJUKAN' AND id_petugas_mitra IS NULL`;
        const ajuanCair = await sql.query`SELECT COUNT(*) AS jml, ISNULL(SUM(jumlah_poin * nilai_rupiah_per_poin_snapshot), 0) AS nominal_dipesan FROM t_pencairan_poin WHERE status IN ('DIAJUKAN', 'DIPROSES', '1', '2')`;
        const selisihTitik = await sql.query`SELECT COUNT(*) AS jml FROM t_setoran WHERE status_drop_point IN ('SELISIH', '2')`;

        return res.status(200).json({
            status: 'success',
            data: {
                lokasi_drop_point: dpRes.recordset[0]?.nama_drop_point || 'Drop Point Pasar Blok A',
                menunggu_verifikasi: Number(menungguVerif.recordset[0]?.jml || 0),
                belum_ditugaskan: Number(belumTugas.recordset[0]?.jml || 0),
                pengajuan_pencairan: Number(ajuanCair.recordset[0]?.jml || 0),
                nominal_dipesan: Number(ajuanCair.recordset[0]?.nominal_dipesan || 0),
                selisih_kedatangan: Number(selisihTitik.recordset[0]?.jml || 0)
            }
        });
    } catch (err) {
        return res.status(200).json({ status: 'success', data: null });
    }
});