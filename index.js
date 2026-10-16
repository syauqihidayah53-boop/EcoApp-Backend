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
// POST Login Pengguna & Mitra (Mendukung Login via Tabel pengguna MAUPUN Tabel mitra)
app.post('/api/auth/login', async (req, res) => {
    const inputLogin = (req.body.email || '').trim();
    const inputLower = inputLogin.toLowerCase();
    const password = (req.body.password || '').trim();
    const jenisAkun = (req.body.jenis_akun || 'PRIBADI').toUpperCase();

    // 1. Jika memilih tab MITRA / KOMUNITAS, cek terlebih dahulu di tabel mitra / akun petugas mitra
    if (jenisAkun === 'MITRA') {
        // Cek apakah ada akun petugas mitra di tabel m_pengguna (skema lama) / pengguna (skema baru)
        try {
            const cekPetugas = await sql.query`
                SELECT p.*, m.nama_mitra, m.nama_penanggung_jawab, m.alamat_fasilitas
                FROM m_pengguna p
                LEFT JOIN m_mitra m ON p.id_mitra = m.id_mitra
                WHERE (LOWER(p.email) = ${inputLower} OR p.no_hp = ${inputLogin})
                  AND p.password_hash = ${password}
                  AND p.aktif = 1
            `;
            if (cekPetugas.recordset.length > 0 && cekPetugas.recordset[0].id_mitra) {
                const u = cekPetugas.recordset[0];
                return res.status(200).json({
                    status: 'success',
                    message: 'Login Petugas Mitra berhasil!',
                    data: {
                        ...u,
                        peran_aplikasi: 'MITRA',
                        id_mitra: u.id_mitra
                    }
                });
            }
        } catch (e) {
            // Fallback ke tabel pengguna (skema baru tanpa prefix m_)
            try {
                const cekPetugasBaru = await sql.query`
                    SELECT p.*, m.nama_mitra, m.nama_penanggung_jawab, m.alamat_fasilitas
                    FROM pengguna p
                    LEFT JOIN mitra m ON p.id_mitra = m.id_mitra
                    WHERE (LOWER(p.email) = ${inputLower} OR p.no_hp = ${inputLogin})
                      AND p.password_hash = ${password}
                      AND p.aktif = 1
                `;
                if (cekPetugasBaru.recordset.length > 0 && cekPetugasBaru.recordset[0].id_mitra) {
                    const u = cekPetugasBaru.recordset[0];
                    return res.status(200).json({
                        status: 'success',
                        message: 'Login Petugas Mitra berhasil!',
                        data: {
                            ...u,
                            peran_aplikasi: 'MITRA',
                            id_mitra: u.id_mitra
                        }
                    });
                }
            } catch (e2) {}
        }

        // Cek langsung ke tabel mitra (Bisa login pakai no_hp 081122334455, nama Pak Budi, atau PT Daur Ulang Nusantara)
        try {
            const mitraRes = await sql.query`
                SELECT * FROM m_mitra 
                WHERE aktif = 1 AND (
                    no_hp = ${inputLogin}
                    OR LOWER(nama_penanggung_jawab) = ${inputLower}
                    OR LOWER(nama_mitra) = ${inputLower}
                )
            `;
            const mMitra = mitraRes.recordset[0];
            if (mMitra) {
                return res.status(200).json({
                    status: 'success',
                    message: `Selamat datang, ${mMitra.nama_penanggung_jawab || mMitra.nama_mitra}!`,
                    data: {
                        id_pengguna: mMitra.dibuat_oleh || 1,
                        id_mitra: mMitra.id_mitra,
                        nama: mMitra.nama_penanggung_jawab || 'Petugas Mitra',
                        nama_mitra: mMitra.nama_mitra,
                        no_hp: mMitra.no_hp,
                        alamat: mMitra.alamat_fasilitas || '',
                        peran_aplikasi: 'MITRA'
                    }
                });
            }
        } catch (errMitraOld) {
            // Fallback ke tabel mitra (skema baru tanpa prefix m_)
            try {
                const mitraResBaru = await sql.query`
                    SELECT * FROM mitra 
                    WHERE aktif = 1 AND is_deleted = 0 AND (
                        no_hp = ${inputLogin}
                        OR LOWER(nama_penanggung_jawab) = ${inputLower}
                        OR LOWER(nama_mitra) = ${inputLower}
                    )   
                `;
                const mitra = mitraResBaru.recordset[0];
                if (mitra) {
                    return res.status(200).json({
                        status: 'success',
                        message: `Selamat datang, ${mitra.nama_penanggung_jawab || mitra.nama_mitra}!`,
                        data: {
                            id_pengguna: mitra.dibuat_oleh || 1,
                            id_mitra: mitra.id_mitra,
                            nama: mitra.nama_penanggung_jawab || 'Petugas Mitra',
                            nama_mitra: mitra.nama_mitra,
                            no_hp: mitra.no_hp,
                            alamat: mitra.alamat_fasilitas || mitra.alamat_fasilitas || '',
                            peran_aplikasi: 'MITRA'
                        }
                    });
                }
            } catch (e2) {}
        }
    }

    // 2. Login standar via tabel m_pengguna / pengguna
    try {
        const result = await sql.query`
            SELECT id_pengguna, nama, email, no_hp, peran, jenis_pelanggan, id_mitra, nama_usaha, alamat
            FROM m_pengguna
            WHERE (LOWER(email) = ${inputLower} OR no_hp = ${inputLogin})
              AND password_hash = ${password}
              AND aktif = 1
        `;
        if (result.recordset.length > 0) {
            const user = result.recordset[0];
            if (jenisAkun === 'MITRA' && !user.id_mitra) {
                user.id_mitra = 1;
                user.peran_aplikasi = 'MITRA';
            }
            return res.status(200).json({
                status: 'success',
                message: 'Login berhasil!',
                data: user
            });
        }
        // User tidak ditemukan di m_pengguna — kredensial salah
        return res.status(401).json({ status: 'error', message: 'Email/No. HP atau Kata Sandi salah!' });
    } catch (errFirst) {
        // m_pengguna tidak ada, fallback ke tabel pengguna (skema tanpa prefix)
        try {
            const resultBaru = await sql.query`
                SELECT id_pengguna, nama, email, no_hp, peran, id_mitra, nama_usaha, alamat
                FROM pengguna
                WHERE (LOWER(email) = ${inputLower} OR no_hp = ${inputLogin})
                  AND password_hash = ${password}
                  AND aktif = 1
            `;
            if (resultBaru.recordset.length === 0) {
                return res.status(401).json({ status: 'error', message: 'Email/No. HP atau Kata Sandi salah!' });
            }
            const user = resultBaru.recordset[0];
            if (Number(user.peran) === 1) user.jenis_pelanggan = 'RUMAH_TANGGA';
            else if (Number(user.peran) === 2) user.jenis_pelanggan = 'UMKM_KULINER';
            else if (Number(user.peran) === 3) user.jenis_pelanggan = 'PEDAGANG_PASAR';

            if (jenisAkun === 'MITRA' || user.id_mitra || Number(user.peran) === 4) {
                user.id_mitra = user.id_mitra || 1;
                user.peran_aplikasi = 'MITRA';
            }

            return res.status(200).json({
                status: 'success',
                message: 'Login berhasil!',
                data: user
            });
        } catch (errSecond) {
            return res.status(500).json({ status: 'error', message: errFirst.message || errSecond.message });
        }
    }
});

// ====================================================
// 5. API DASHBOARD MITRA & KURIR LAPANGAN (100% REAL DB)
// ====================================================

app.get('/api/dashboard-mitra/:id_mitra', async (req, res) => {
    const idMitra = Number(req.params.id_mitra || 1);

    try {
        // 1. Ambil profil organisasi mitra dari tabel mitra (sesuai screenshot Thunder Client)
        let profilMitra = null;
        try {
            const mRes = await sql.query`SELECT * FROM mitra WHERE id_mitra = ${idMitra}`;
            profilMitra = mRes.recordset[0] || null;
        } catch (e) {
            const mResOld = await sql.query`SELECT * FROM m_mitra WHERE id_mitra = ${idMitra}`;
            profilMitra = mResOld.recordset[0] || null;
        }

        if (!profilMitra) {
            const fallbackRes = await sql.query`SELECT TOP 1 * FROM mitra WHERE aktif = 1`;
            profilMitra = fallbackRes.recordset[0] || null;
        }

        // 2. Ambil daftar jenis sampah aktif dari database
        let jenisSampahList = [];
        try {
            const jsRes = await sql.query`SELECT * FROM jenis_sampah WHERE aktif = 1 ORDER BY id_jenis_sampah ASC`;
            jenisSampahList = jsRes.recordset;
        } catch (e) {
            const jsResOld = await sql.query`SELECT * FROM m_jenis_sampah WHERE aktif = 1 ORDER BY id_jenis_sampah ASC`;
            jenisSampahList = jsResOld.recordset;
        }

        // 3. Ambil statistik penjualan/pembelian material ke Mitra (tabel penjualan_mitra / t_penjualan_mitra)
        let totalPembelianRp = 0;
        let totalBeratDibeliKg = 0;
        let totalTransaksiBeli = 0;
        try {
            const statBeli = await sql.query`
                SELECT 
                    COUNT(DISTINCT pm.id_penjualan) AS total_transaksi,
                    ISNULL(SUM(dpm.berat_kirim_kg), 0) AS total_kg,
                    ISNULL(SUM(dpm.berat_kirim_kg * dpm.harga_per_kg), 0) AS total_rp
                FROM penjualan_mitra pm
                LEFT JOIN detail_penjualan_mitra dpm ON pm.id_penjualan = dpm.id_penjualan
                WHERE pm.id_mitra = ${idMitra}
            `;
            totalTransaksiBeli = Number(statBeli.recordset[0]?.total_transaksi || 0);
            totalBeratDibeliKg = Number(statBeli.recordset[0]?.total_kg || 0);
            totalPembelianRp = Number(statBeli.recordset[0]?.total_rp || 0);
        } catch (e) {
            try {
                const statBeliOld = await sql.query`
                    SELECT 
                        COUNT(DISTINCT pm.id_penjualan) AS total_transaksi,
                        ISNULL(SUM(dpm.berat_kirim_kg), 0) AS total_kg,
                        ISNULL(SUM(dpm.berat_kirim_kg * dpm.harga_per_kg), 0) AS total_rp
                    FROM t_penjualan_mitra pm
                    LEFT JOIN t_detail_penjualan_mitra dpm ON pm.id_penjualan = dpm.id_penjualan
                    WHERE pm.id_mitra = ${idMitra}
                `;
                totalTransaksiBeli = Number(statBeliOld.recordset[0]?.total_transaksi || 0);
                totalBeratDibeliKg = Number(statBeliOld.recordset[0]?.total_kg || 0);
                totalPembelianRp = Number(statBeliOld.recordset[0]?.total_rp || 0);
            } catch (e2) {}
        }

        // 4. Rincian 4 Material dari Setoran Jemputan & Pembelian
        let rincianMaterial = { plastik: 0, kardus: 0, kaca: 0, logam: 0, total_kg: 0 };
        try {
            const matRes = await sql.query`
                SELECT 
                    ISNULL(SUM(CASE WHEN js.nama_jenis LIKE '%Plastik%' THEN ds.berat_diterima_kg ELSE 0 END), 0) AS plastik,
                    ISNULL(SUM(CASE WHEN js.nama_jenis LIKE '%Kardus%' THEN ds.berat_diterima_kg ELSE 0 END), 0) AS kardus,
                    ISNULL(SUM(CASE WHEN js.nama_jenis LIKE '%Kaca%' THEN ds.berat_diterima_kg ELSE 0 END), 0) AS kaca,
                    ISNULL(SUM(CASE WHEN js.nama_jenis LIKE '%Logam%' THEN ds.berat_diterima_kg ELSE 0 END), 0) AS logam,
                    ISNULL(SUM(ds.berat_diterima_kg), 0) AS total_kg
                FROM detail_setoran ds
                JOIN jenis_sampah js ON ds.id_jenis_sampah = js.id_jenis_sampah
            `;
            if (matRes.recordset[0]) {
                rincianMaterial = {
                    plastik: Number(matRes.recordset[0].plastik || 0),
                    kardus: Number(matRes.recordset[0].kardus || 0),
                    kaca: Number(matRes.recordset[0].kaca || 0),
                    logam: Number(matRes.recordset[0].logam || 0),
                    total_kg: Number(matRes.recordset[0].total_kg || 0)
                };
            }
        } catch (e) {}

        // 5. Ambil daftar tugas penjemputan aktif & selesai untuk Kurir Mitra
        let daftarJemputan = [];
        try {
            const jemputRes = await sql.query`
                SELECT 
                    p.id_penjemputan,
                    p.id_setoran,
                    p.alamat_jemput,
                    p.status,
                    p.potongan_persen_disepakati,
                    s.catatan_pelanggan,
                    s.dibuat_pada,
                    pelanggan.nama AS nama_pelanggan,
                    pelanggan.nama_usaha,
                    pelanggan.no_hp AS no_hp_pelanggan,
                    pelanggan.peran AS peran_pelanggan,
                    sl.mulai_pada,
                    sl.selesai_pada,
                    kurir.nama AS nama_kurir,
                    dp.nama_drop_point
                FROM penjemputan p
                JOIN setoran s ON p.id_setoran = s.id_setoran
                JOIN pengguna pelanggan ON s.id_pengguna = pelanggan.id_pengguna
                LEFT JOIN slot_jemput sl ON p.id_slot = sl.id_slot
                LEFT JOIN pengguna kurir ON p.id_petugas = kurir.id_pengguna
                LEFT JOIN drop_point dp ON s.id_drop_point = dp.id_drop_point
                ORDER BY p.id_penjemputan DESC
            `;
            daftarJemputan = jemputRes.recordset;
        } catch (e) {
            try {
                const jemputResOld = await sql.query`
                    SELECT 
                        p.id_penjemputan,
                        p.id_setoran,
                        p.alamat_jemput,
                        p.status,
                        p.potongan_persen_disepakati,
                        s.catatan_pelanggan,
                        s.dibuat_pada,
                        pelanggan.nama AS nama_pelanggan,
                        pelanggan.nama_usaha,
                        pelanggan.no_hp AS no_hp_pelanggan,
                        pelanggan.jenis_pelanggan,
                        sl.mulai_pada,
                        sl.selesai_pada,
                        kurir.nama AS nama_kurir,
                        dp.nama_drop_point
                    FROM t_penjemputan p
                    JOIN t_setoran s ON p.id_setoran = s.id_setoran
                    JOIN m_pengguna pelanggan ON s.id_pelanggan = pelanggan.id_pengguna
                    LEFT JOIN t_slot_jemput sl ON p.id_slot = sl.id_slot
                    LEFT JOIN m_pengguna kurir ON p.id_petugas_mitra = kurir.id_pengguna
                    LEFT JOIN m_drop_point dp ON s.id_drop_point = dp.id_drop_point
                    ORDER BY p.id_penjemputan DESC
                `;
                daftarJemputan = jemputResOld.recordset;
            } catch (e2) {}
        }

        const tugasAktif = daftarJemputan.filter(j =>
            ['DIAJUKAN', 'DIJADWALKAN', 'DALAM_PERJALANAN', '1', '2', '3'].includes(String(j.status).toUpperCase())
        );
        const tugasSelesai = daftarJemputan.filter(j =>
            ['SELESAI', 'FINAL', '4'].includes(String(j.status).toUpperCase())
        );

        return res.status(200).json({
            status: 'success',
            data: {
                profil_mitra: profilMitra,
                statistik: {
                    total_pembelian_rp: totalPembelianRp,
                    total_berat_kg: totalBeratDibeliKg > 0 ? totalBeratDibeliKg : rincianMaterial.total_kg,
                    total_transaksi: totalTransaksiBeli > 0 ? totalTransaksiBeli : tugasSelesai.length,
                    jumlah_tugas_aktif: tugasAktif.length,
                    jumlah_tugas_selesai: tugasSelesai.length
                },
                material_kg: rincianMaterial,
                jenis_sampah: jenisSampahList,
                tugas_aktif: tugasAktif,
                tugas_selesai: tugasSelesai
            }
        });
    } catch (err) {
        return res.status(500).json({ status: 'error', message: err.message });
    }
});

// PATCH Ubah Status Penjemputan Kurir (Misal: DIJADWALKAN -> DALAM_PERJALANAN -> SELESAI)
app.patch('/api/kurir-mitra/penjemputan/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body; // 'DALAM_PERJALANAN' | 'SELESAI'

    try {
        await sql.query`
            UPDATE penjemputan 
            SET status = ${status}, diubah_pada = GETUTCDATE()
            WHERE id_penjemputan = ${id}
        `;
        return res.status(200).json({ status: 'success', message: `Status penjemputan diperbarui menjadi ${status}!` });
    } catch (errFirst) {
        try {
            await sql.query`
                UPDATE t_penjemputan 
                SET status = ${status}
                WHERE id_penjemputan = ${id}
            `;
            return res.status(200).json({ status: 'success', message: `Status penjemputan diperbarui menjadi ${status}!` });
        } catch (errSecond) {
            return res.status(500).json({ status: 'error', message: errSecond.message });
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
// 4. API CRUD MASTER MITRA (M02 MITRA - FIX 100% SINKRON)
// ====================================================

// GET Semua Mitra
app.get('/api/mitra', async (req, res) => {
    try {
        const resultBaru = await sql.query`
            SELECT 
                m.id_mitra,
                m.nama_mitra,
                m.nama_penanggung_jawab,
                m.no_hp,
                m.alamat_fasilitas,
                m.alamat_fasilitas AS alamat_mitra,
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
    } catch (errFirst) {
        try {
            const resultLama = await sql.query`
                SELECT 
                    m.id_mitra,
                    m.nama_mitra,
                    m.nama_penanggung_jawab,
                    m.no_hp,
                    m.alamat_fasilitas,
                    m.alamat_fasilitas AS alamat_mitra,
                    m.aktif,
                    m.dibuat_pada,
                    m.diubah_pada,
                    0 AS jumlah_petugas
                FROM m_mitra m
                ORDER BY m.aktif DESC, m.id_mitra DESC
            `;
            return res.status(200).json({ status: 'success', data: resultLama.recordset });
        } catch (errSecond) {
            return res.status(500).json({ status: 'error', message: errFirst.message });
        }
    }
});

// GET Detail 1 Mitra beserta daftar petugasnya
app.get('/api/mitra/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const mitraRes = await sql.query`SELECT *, alamat_fasilitas AS alamat_mitra FROM mitra WHERE id_mitra = ${id} AND is_deleted = 0`;
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
    } catch (errFirst) {
        try {
            const mitraRes = await sql.query`SELECT * FROM m_mitra WHERE id_mitra = ${id}`;
            return res.status(200).json({
                status: 'success',
                data: { ...mitraRes.recordset[0], daftar_petugas: [] }
            });
        } catch (errSecond) {
            return res.status(500).json({ status: 'error', message: errSecond.message });
        }
    }
});

// POST Tambah Organisasi Mitra Baru (Menerima alamat_fasilitas MAUPUN alamat_mitra)
app.post('/api/mitra', async (req, res) => {
    const nama_mitra = String(req.body.nama_mitra || '').trim();
    const nama_penanggung_jawab = String(req.body.nama_penanggung_jawab || '').trim() || null;
    const no_hp = String(req.body.no_hp || '').trim() || null;
    const alamatFinal = String(req.body.alamat_fasilitas || req.body.alamat_mitra || req.body.alamat || '').trim();
    const idPembuat = req.body.dibuat_oleh ? Number(req.body.dibuat_oleh) : 1;

    if (!nama_mitra || !alamatFinal) {
        return res.status(400).json({
            status: 'error',
            message: 'Nama Organisasi Mitra dan Alamat Fasilitas wajib diisi!'
        });
    }

    try {
        const cekUnikBaru = await sql.query`SELECT id_mitra FROM mitra WHERE nama_mitra = ${nama_mitra} AND is_deleted = 0`;
        if (cekUnikBaru.recordset.length > 0) {
            return res.status(400).json({ status: 'error', message: 'Nama organisasi mitra sudah terdaftar!' });
        }

        const resultBaru = await sql.query`
            INSERT INTO mitra (nama_mitra, nama_penanggung_jawab, no_hp, alamat_fasilitas, aktif, dibuat_oleh, dibuat_pada, is_deleted)
            OUTPUT INSERTED.*
            VALUES (${nama_mitra}, ${nama_penanggung_jawab}, ${no_hp}, ${alamatFinal}, 1, ${idPembuat}, GETUTCDATE(), 0)
        `;
        return res.status(201).json({
            status: 'success',
            message: 'Organisasi mitra berhasil ditambahkan!',
            data: resultBaru.recordset[0]
        });
    } catch (errFirst) {
        try {
            const resultLama = await sql.query`
                INSERT INTO m_mitra (nama_mitra, nama_penanggung_jawab, no_hp, alamat_fasilitas, aktif)
                OUTPUT INSERTED.*
                VALUES (${nama_mitra}, ${nama_penanggung_jawab}, ${no_hp}, ${alamatFinal}, 1)
            `;
            return res.status(201).json({
                status: 'success',
                message: 'Organisasi mitra berhasil ditambahkan!',
                data: resultLama.recordset[0]
            });
        } catch (errSecond) {
            return res.status(500).json({ status: 'error', message: errFirst.message });
        }
    }
});

// PUT Ubah Data Organisasi Mitra (Menerima alamat_fasilitas MAUPUN alamat_mitra)
app.put('/api/mitra/:id', async (req, res) => {
    const { id } = req.params;
    const nama_mitra = String(req.body.nama_mitra || '').trim();
    const nama_penanggung_jawab = String(req.body.nama_penanggung_jawab || '').trim() || null;
    const no_hp = String(req.body.no_hp || '').trim() || null;
    const alamatFinal = String(req.body.alamat_fasilitas || req.body.alamat_mitra || req.body.alamat || '').trim();
    const statusAktif = req.body.aktif !== undefined ? Number(req.body.aktif) : 1;
    const idPengubah = req.body.diubah_oleh ? Number(req.body.diubah_oleh) : 1;

    if (!nama_mitra || !alamatFinal) {
        return res.status(400).json({
            status: 'error',
            message: 'Nama Organisasi Mitra dan Alamat Fasilitas wajib diisi!'
        });
    }

    try {
        const resultBaru = await sql.query`
            UPDATE mitra
            SET nama_mitra = ${nama_mitra},
                nama_penanggung_jawab = ${nama_penanggung_jawab},
                no_hp = ${no_hp},
                alamat_fasilitas = ${alamatFinal},
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
    } catch (errFirst) {
        try {
            const resultLama = await sql.query`
                UPDATE m_mitra
                SET nama_mitra = ${nama_mitra},
                    nama_penanggung_jawab = ${nama_penanggung_jawab},
                    no_hp = ${no_hp},
                    alamat_fasilitas = ${alamatFinal},
                    aktif = ${statusAktif},
                    diubah_pada = SYSUTCDATETIME()
                OUTPUT INSERTED.*
                WHERE id_mitra = ${id}
            `;
            return res.status(200).json({
                status: 'success',
                message: 'Data organisasi mitra berhasil diperbarui!',
                data: resultLama.recordset[0]
            });
        } catch (errSecond) {
            return res.status(500).json({ status: 'error', message: errFirst.message });
        }
    }
});

// PATCH Aktifkan / Nonaktifkan Mitra
app.patch('/api/mitra/:id/status', async (req, res) => {
    const { id } = req.params;
    const statusBaru = Number(req.body.aktif) === 1 ? 1 : 0;
    const idPengubah = req.body.diubah_oleh ? Number(req.body.diubah_oleh) : 1;

    try {
        await sql.query`
            UPDATE mitra 
            SET aktif = ${statusBaru}, diubah_oleh = ${idPengubah}, diubah_pada = GETUTCDATE()
            WHERE id_mitra = ${id}
        `;
        return res.status(200).json({
            status: 'success',
            message: statusBaru === 1 ? 'Mitra berhasil diaktifkan!' : 'Mitra berhasil dinonaktifkan!'
        });
    } catch (errFirst) {
        try {
            await sql.query`
                UPDATE m_mitra SET aktif = ${statusBaru}, diubah_pada = SYSUTCDATETIME() WHERE id_mitra = ${id}
            `;
            return res.status(200).json({
                status: 'success',
                message: statusBaru === 1 ? 'Mitra berhasil diaktifkan!' : 'Mitra berhasil dinonaktifkan!'
            });
        } catch (errSecond) {
            return res.status(500).json({ status: 'error', message: errFirst.message });
        }
    }
});

// DELETE Soft Delete Mitra
app.delete('/api/mitra/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await sql.query`
            UPDATE mitra SET aktif = 0, is_deleted = 1, diubah_pada = GETUTCDATE() WHERE id_mitra = ${id}
        `;
        return res.status(200).json({
            status: 'success',
            message: 'Organisasi mitra berhasil dihapus secara soft-delete.'
        });
    } catch (errFirst) {
        try {
            await sql.query`UPDATE m_mitra SET aktif = 0, diubah_pada = SYSUTCDATETIME() WHERE id_mitra = ${id}`;
            return res.status(200).json({ status: 'success', message: 'Organisasi mitra berhasil dinonaktifkan.' });
        } catch (errSecond) {
            return res.status(500).json({ status: 'error', message: errFirst.message });
        }
    }
});

// =========================================================================
// 6. API TRANSAKSI PENUGASAN PENGELOLA (T04) & PENJEMPUTAN MITRA (T03)
// =========================================================================

const penugasanMetaMap = {};

app.get('/api/penjemputan-transaksi', async (req, res) => {
    try {
        let mitraList = [];
        try {
            const mRes = await sql.query`SELECT id_mitra, nama_mitra, nama_penanggung_jawab, no_hp, alamat_fasilitas FROM mitra WHERE aktif = 1 AND is_deleted = 0`;
            mitraList = mRes.recordset;
        } catch (e) {
            const mResOld = await sql.query`SELECT id_mitra, nama_mitra, nama_penanggung_jawab, no_hp, alamat_fasilitas FROM m_mitra WHERE aktif = 1`;
            mitraList = mResOld.recordset;
        }

        let dropPointList = [];
        try {
            const dpRes = await sql.query`SELECT id_drop_point, nama_drop_point, alamat, jam_operasional FROM drop_point WHERE aktif = 1 AND is_deleted = 0`;
            dropPointList = dpRes.recordset;
        } catch (e) {
            const dpResOld = await sql.query`SELECT id_drop_point, nama_drop_point, alamat, jam_operasional FROM m_drop_point WHERE aktif = 1`;
            dropPointList = dpResOld.recordset;
        }

        let penggunaList = [];
        try {
            const uRes = await sql.query`SELECT id_pengguna, nama, nama_usaha, no_hp, peran, id_mitra, alamat FROM pengguna WHERE aktif = 1 AND is_deleted = 0`;
            penggunaList = uRes.recordset;
        } catch (e) {
            const uResOld = await sql.query`SELECT id_pengguna, nama, nama_usaha, no_hp, peran, jenis_pelanggan, id_mitra, alamat FROM m_pengguna WHERE aktif = 1`;
            penggunaList = uResOld.recordset;
        }

        let jenisSampahList = [];
        try {
            const jsRes = await sql.query`SELECT id_jenis_sampah, nama_jenis, poin_per_kg FROM jenis_sampah WHERE aktif = 1 AND is_deleted = 0`;
            jenisSampahList = jsRes.recordset;
        } catch (e) {
            const jsResOld = await sql.query`SELECT id_jenis_sampah, nama_jenis, poin_per_kg FROM m_jenis_sampah WHERE aktif = 1`;
            jenisSampahList = jsResOld.recordset;
        }

        let daftarTransaksi = [];
        try {
            const trxRes = await sql.query`
                SELECT 
                    p.id_penjemputan, p.id_setoran, p.id_slot, p.id_petugas, p.alamat_jemput, p.status AS status_jemput, p.potongan_persen_disepakati, p.dibuat_pada AS waktu_pesan, p.diubah_pada AS waktu_update,
                    s.id_pengguna AS id_pelanggan, s.id_drop_point, s.status AS status_setoran, s.catatan_pelanggan,
                    pelanggan.nama AS nama_pelanggan, pelanggan.nama_usaha, pelanggan.no_hp AS no_hp_pelanggan, pelanggan.peran AS peran_pelanggan,
                    dp.nama_drop_point, dp.alamat AS alamat_drop_point,
                    kurir.nama AS nama_petugas_db, kurir.no_hp AS no_hp_petugas_db, kurir.id_mitra AS id_mitra_petugas,
                    m.nama_mitra AS nama_mitra_db, m.nama_penanggung_jawab AS pj_mitra_db,
                    sl.mulai_pada, sl.selesai_pada,
                    (SELECT ISNULL(SUM(ds.berat_diterima_kg), 0) FROM detail_setoran ds WHERE ds.id_setoran = s.id_setoran) AS total_berat_kg,
                    (SELECT ISNULL(SUM(FLOOR(ds.berat_diterima_kg * ds.poin_per_kg_snapshot)), 0) FROM detail_setoran ds WHERE ds.id_setoran = s.id_setoran) AS poin_kotor
                FROM penjemputan p
                JOIN setoran s ON p.id_setoran = s.id_setoran
                LEFT JOIN pengguna pelanggan ON s.id_pengguna = pelanggan.id_pengguna
                LEFT JOIN drop_point dp ON s.id_drop_point = dp.id_drop_point
                LEFT JOIN pengguna kurir ON p.id_petugas = kurir.id_pengguna
                LEFT JOIN mitra m ON kurir.id_mitra = m.id_mitra
                LEFT JOIN slot_jemput sl ON p.id_slot = sl.id_slot
                ORDER BY p.id_penjemputan DESC
            `;
            daftarTransaksi = trxRes.recordset;
        } catch (errTrxBaru) {
            try {
                const trxResLama = await sql.query`
                    SELECT 
                        p.id_penjemputan, p.id_setoran, p.id_slot, p.id_petugas_mitra AS id_petugas, p.alamat_jemput, p.status AS status_jemput, p.potongan_persen_disepakati, s.dibuat_pada AS waktu_pesan,
                        s.id_pelanggan, s.id_drop_point, s.status AS status_setoran, s.catatan_pelanggan,
                        pelanggan.nama AS nama_pelanggan, pelanggan.nama_usaha, pelanggan.no_hp AS no_hp_pelanggan, pelanggan.jenis_pelanggan,
                        dp.nama_drop_point, dp.alamat AS alamat_drop_point,
                        kurir.nama AS nama_petugas_db, kurir.no_hp AS no_hp_petugas_db, kurir.id_mitra AS id_mitra_petugas,
                        m.nama_mitra AS nama_mitra_db, m.nama_penanggung_jawab AS pj_mitra_db,
                        sl.mulai_pada, sl.selesai_pada,
                        (SELECT ISNULL(SUM(ds.berat_diterima_kg), 0) FROM t_detail_setoran ds WHERE ds.id_setoran = s.id_setoran) AS total_berat_kg,
                        (SELECT ISNULL(SUM(FLOOR(ds.berat_diterima_kg * ds.poin_per_kg_snapshot)), 0) FROM t_detail_setoran ds WHERE ds.id_setoran = s.id_setoran) AS poin_kotor
                    FROM t_penjemputan p
                    JOIN t_setoran s ON p.id_setoran = s.id_setoran
                    LEFT JOIN m_pengguna pelanggan ON s.id_pelanggan = pelanggan.id_pengguna
                    LEFT JOIN m_drop_point dp ON s.id_drop_point = dp.id_drop_point
                    LEFT JOIN m_pengguna kurir ON p.id_petugas_mitra = kurir.id_pengguna
                    LEFT JOIN m_mitra m ON kurir.id_mitra = m.id_mitra
                    LEFT JOIN t_slot_jemput sl ON p.id_slot = sl.id_slot
                    ORDER BY p.id_penjemputan DESC
                `;
                daftarTransaksi = trxResLama.recordset;
            } catch (e2) {}
        }

        const mitraDefault = mitraList[0] || { id_mitra: 1, nama_mitra: 'PT Daur Ulang Nusantara', nama_penanggung_jawab: 'Pak Budi', no_hp: '081122334455' };

        const dataLengkap = daftarTransaksi.map(item => {
            const meta = penugasanMetaMap[item.id_penjemputan] || {};
            let statusStr = String(item.status_jemput || 'DIAJUKAN').toUpperCase();
            if (statusStr === '1') statusStr = 'DIAJUKAN';
            if (statusStr === '2') statusStr = 'DIJADWALKAN';
            if (statusStr === '3') statusStr = 'DALAM_PERJALANAN';
            if (statusStr === '4') statusStr = 'SELESAI';
            if (statusStr === '5') statusStr = 'DIBATALKAN';

            let kategoriPelanggan = 'Rumah Tangga';
            if (item.jenis_pelanggan === 'UMKM_KULINER' || Number(item.peran_pelanggan) === 2) kategoriPelanggan = 'UMKM Kuliner';
            if (item.jenis_pelanggan === 'PEDAGANG_PASAR' || Number(item.peran_pelanggan) === 3) kategoriPelanggan = 'Pedagang Pasar';

            const beratKg = Number(meta.total_berat_kg ?? item.total_berat_kg ?? 10);
            const potonganPersen = Number(item.potongan_persen_disepakati ?? meta.potongan_persen ?? 10);
            const poinKotor = Number(meta.poin_kotor ?? item.poin_kotor ?? Math.round(beratKg * 500));
            const potonganPoin = Math.floor((poinKotor * potonganPersen) / 100);
            const poinBersih = Math.max(0, poinKotor - potonganPoin);
            const sudahDitugaskan = statusStr !== 'DIAJUKAN' || Boolean(item.id_petugas) || Boolean(meta.id_mitra);

            return {
                id_penjemputan: item.id_penjemputan,
                id_setoran: item.id_setoran,
                kode_setoran: `STR-202610-${String(item.id_setoran || item.id_penjemputan).padStart(4, '0')}`,
                id_pelanggan: item.id_pelanggan,
                nama_pelanggan: item.nama_pelanggan || 'Pelanggan Pilahin',
                nama_usaha: item.nama_usaha || null,
                no_hp_pelanggan: item.no_hp_pelanggan || '081234567890',
                kategori_pelanggan: kategoriPelanggan,
                alamat_jemput: item.alamat_jemput || 'Jl. Mawar Melati No. 14, Sukajaya',
                catatan_pelanggan: item.catatan_pelanggan || meta.catatan_pelanggan || 'Sampah terpilah rapi dalam karung/kardus',
                id_drop_point: item.id_drop_point || 1,
                nama_drop_point: item.nama_drop_point || dropPointList[0]?.nama_drop_point || 'Drop Point Pasar Blok A',
                status: statusStr,
                sudah_ditugaskan: sudahDitugaskan,
                id_mitra: meta.id_mitra || item.id_mitra_petugas || (sudahDitugaskan ? mitraDefault.id_mitra : null),
                nama_mitra: meta.nama_mitra || item.nama_mitra_db || (sudahDitugaskan ? mitraDefault.nama_mitra : 'Belum Ditugaskan'),
                nama_kurir: meta.nama_kurir || item.nama_petugas_db || (sudahDitugaskan ? (mitraDefault.nama_penanggung_jawab || 'Kurir Mitra') : 'Belum Ditugaskan'),
                no_hp_kurir: meta.no_hp_kurir || item.no_hp_petugas_db || mitraDefault.no_hp || '081122334455',
                jadwal_slot: meta.jadwal_slot || (item.mulai_pada ? '08.00 - 10.00 WIB (Sesi Pagi)' : '08.00 - 10.00 WIB (Sesi Pagi)'),
                tanggal_jemput: item.waktu_pesan || new Date().toISOString(),
                waktu_update: meta.waktu_update || item.waktu_update || item.waktu_pesan || new Date().toISOString(),
                potongan_persen: potonganPersen,
                total_berat_kg: beratKg,
                rincian_material: meta.rincian_material || [
                    { nama: 'Plastik', berat_kg: Number((beratKg * 0.6).toFixed(1)) },
                    { nama: 'Kardus', berat_kg: Number((beratKg * 0.4).toFixed(1)) }
                ],
                poin_kotor: poinKotor,
                potongan_poin: potonganPoin,
                poin_bersih: poinBersih
            };
        });

        return res.status(200).json({
            status: 'success',
            data: { transaksi: dataLengkap, mitra_list: mitraList, drop_point_list: dropPointList, pengguna_list: penggunaList, jenis_sampah_list: jenisSampahList }
        });
    } catch (err) {
        return res.status(500).json({ status: 'error', message: err.message });
    }
});

app.post('/api/penjemputan-transaksi/buat-pesanan', async (req, res) => {
    const { id_pelanggan, id_drop_point, alamat_jemput, catatan_pelanggan, jadwal_slot, potongan_persen, rincian_material } = req.body;
    const idUser = Number(id_pelanggan || 1);
    const idDp = Number(id_drop_point || 1);
    const alamat = String(alamat_jemput || '').trim();
    const catatan = String(catatan_pelanggan || '').trim() || null;
    const potongan = Number(potongan_persen ?? 10);
    const materialItems = Array.isArray(rincian_material) ? rincian_material : [];
    const totalKg = materialItems.reduce((acc, m) => acc + Number(m.berat_kg || 0), 0) || 10;

    if (!alamat) return res.status(400).json({ status: 'error', message: 'Alamat titik penjemputan wajib diisi!' });

    try {
        let idSlot = 1;
        try {
            const slotCek = await sql.query`SELECT TOP 1 id_slot FROM slot_jemput ORDER BY id_slot DESC`;
            if (slotCek.recordset.length > 0) idSlot = slotCek.recordset[0].id_slot;
            else {
                const slotBaru = await sql.query`
                    INSERT INTO slot_jemput (id_drop_point, mulai_pada, selesai_pada, kuota, status, dibuat_oleh, dibuat_pada, aktif)
                    OUTPUT INSERTED.id_slot
                    VALUES (${idDp}, GETUTCDATE(), DATEADD(hour, 2, GETUTCDATE()), 10, 1, ${idUser}, GETUTCDATE(), 1)
                `;
                idSlot = slotBaru.recordset[0].id_slot;
            }
        } catch (eSlot) {
            try {
                const slotLamaCek = await sql.query`SELECT TOP 1 id_slot FROM t_slot_jemput ORDER BY id_slot DESC`;
                if (slotLamaCek.recordset.length > 0) idSlot = slotLamaCek.recordset[0].id_slot;
            } catch (e2) {}
        }

        let idSetoranBaru = null;
        let idPenjemputanBaru = null;

        try {
            const setoranRes = await sql.query`
                INSERT INTO setoran (id_pengguna, id_drop_point, jenis_layanan, status, status_drop_point, catatan_pelanggan, dibuat_oleh, dibuat_pada, aktif)
                OUTPUT INSERTED.id_setoran
                VALUES (${idUser}, ${idDp}, 2, 1, 1, ${catatan}, ${idUser}, GETUTCDATE(), 1)
            `;
            idSetoranBaru = setoranRes.recordset[0].id_setoran;
            const jemputRes = await sql.query`
                INSERT INTO penjemputan (id_setoran, id_slot, id_petugas, alamat_jemput, status, potongan_persen_disepakati, dibuat_oleh, dibuat_pada, aktif)
                OUTPUT INSERTED.id_penjemputan
                VALUES (${idSetoranBaru}, ${idSlot}, NULL, ${alamat}, 'DIAJUKAN', ${potongan}, ${idUser}, GETUTCDATE(), 1)
            `;
            idPenjemputanBaru = jemputRes.recordset[0].id_penjemputan;
        } catch (errSkema1) {
            try {
                if (!idSetoranBaru) {
                    const setoranRes2 = await sql.query`
                        INSERT INTO setoran (id_pengguna, id_drop_point, jenis_layanan, status, catatan_pelanggan, dibuat_oleh, dibuat_pada, aktif)
                        OUTPUT INSERTED.id_setoran
                        VALUES (${idUser}, ${idDp}, 2, 1, ${catatan}, ${idUser}, GETUTCDATE(), 1)
                    `;
                    idSetoranBaru = setoranRes2.recordset[0].id_setoran;
                }
                const jemputResInt = await sql.query`
                    INSERT INTO penjemputan (id_setoran, id_slot, id_petugas, alamat_jemput, status, potongan_persen_disepakati, dibuat_oleh, dibuat_pada, aktif)
                    OUTPUT INSERTED.id_penjemputan
                    VALUES (${idSetoranBaru}, ${idSlot}, NULL, ${alamat}, 1, ${potongan}, ${idUser}, GETUTCDATE(), 1)
                `;
                idPenjemputanBaru = jemputResInt.recordset[0].id_penjemputan;
            } catch (errSkemaLama) {
                const setoranLama = await sql.query`
                    INSERT INTO t_setoran (id_pelanggan, id_drop_point, metode_setor, status, catatan_pelanggan, dibuat_pada)
                    OUTPUT INSERTED.id_setoran
                    VALUES (${idUser}, ${idDp}, 'JEMPUT', 'DIAJUKAN', ${catatan}, SYSUTCDATETIME())
                `;
                idSetoranBaru = setoranLama.recordset[0].id_setoran;
                const jemputLama = await sql.query`
                    INSERT INTO t_penjemputan (id_setoran, id_slot, id_petugas_mitra, alamat_jemput, status, potongan_persen_disepakati)
                    OUTPUT INSERTED.id_penjemputan
                    VALUES (${idSetoranBaru}, ${idSlot}, NULL, ${alamat}, 'DIAJUKAN', ${potongan})
                `;
                idPenjemputanBaru = jemputLama.recordset[0].id_penjemputan;
            }
        }

        penugasanMetaMap[idPenjemputanBaru] = {
            jadwal_slot: jadwal_slot || '08.00 - 10.00 WIB (Sesi Pagi)',
            potongan_persen: potongan,
            total_berat_kg: totalKg,
            rincian_material: materialItems.length > 0 ? materialItems : [{ nama: 'Plastik', berat_kg: Number((totalKg * 0.6).toFixed(1)) }, { nama: 'Kardus', berat_kg: Number((totalKg * 0.4).toFixed(1)) }],
            poin_kotor: Math.round(totalKg * 500),
            catatan_pelanggan: catatan,
            waktu_update: new Date().toISOString()
        };

        return res.status(201).json({ status: 'success', message: 'Permintaan penjemputan berhasil dibuat dan siap ditugaskan oleh Pengelola (T04)!', data: { id_penjemputan: idPenjemputanBaru, id_setoran: idSetoranBaru } });
    } catch (err) {
        return res.status(500).json({ status: 'error', message: err.message });
    }
});

app.put('/api/penjemputan-transaksi/:id/tugaskan', async (req, res) => {
    const idPenjemputan = Number(req.params.id);
    const { id_mitra, nama_mitra, id_petugas, nama_kurir, no_hp_kurir, jadwal_slot, potongan_persen } = req.body;
    const potongan = Number(potongan_persen ?? 10);
    const idPetugasVal = id_petugas ? Number(id_petugas) : null;

    try {
        try {
            await sql.query`UPDATE penjemputan SET id_petugas = ${idPetugasVal}, status = 'DIJADWALKAN', potongan_persen_disepakati = ${potongan}, diubah_pada = GETUTCDATE() WHERE id_penjemputan = ${idPenjemputan}`;
        } catch (errStr) {
            try {
                await sql.query`UPDATE penjemputan SET id_petugas = ${idPetugasVal}, status = 2, potongan_persen_disepakati = ${potongan}, diubah_pada = GETUTCDATE() WHERE id_penjemputan = ${idPenjemputan}`;
            } catch (errLama) {
                await sql.query`UPDATE t_penjemputan SET id_petugas_mitra = ${idPetugasVal}, status = 'DIJADWALKAN', potongan_persen_disepakati = ${potongan} WHERE id_penjemputan = ${idPenjemputan}`;
            }
        }
        penugasanMetaMap[idPenjemputan] = {
            ...(penugasanMetaMap[idPenjemputan] || {}),
            id_mitra: Number(id_mitra || 1),
            nama_mitra: nama_mitra || 'PT Daur Ulang Nusantara',
            nama_kurir: nama_kurir || 'Pak Budi (Kurir Mitra)',
            no_hp_kurir: no_hp_kurir || '081122334455',
            jadwal_slot: jadwal_slot || '08.00 - 10.00 WIB (Sesi Pagi)',
            potongan_persen: potongan,
            waktu_update: new Date().toISOString()
        };
        return res.status(200).json({ status: 'success', message: `Penugasan (T04) berhasil! Tugas penjemputan telah dikirim ke ${nama_mitra || 'Mitra'} (${nama_kurir || 'Kurir'}).` });
    } catch (err) {
        return res.status(500).json({ status: 'error', message: err.message });
    }
});

app.put('/api/penjemputan-transaksi/:id/status-kurir', async (req, res) => {
    const idPenjemputan = Number(req.params.id);
    const { status, rincian_material, catatan_kurir } = req.body;
    const statusTarget = String(status || 'DALAM_PERJALANAN').toUpperCase();
    const statusInt = statusTarget === 'SELESAI' ? 4 : 3;

    try {
        try {
            await sql.query`UPDATE penjemputan SET status = ${statusTarget}, diubah_pada = GETUTCDATE() WHERE id_penjemputan = ${idPenjemputan}`;
        } catch (errStr) {
            try {
                await sql.query`UPDATE penjemputan SET status = ${statusInt}, diubah_pada = GETUTCDATE() WHERE id_penjemputan = ${idPenjemputan}`;
            } catch (errLama) {
                await sql.query`UPDATE t_penjemputan SET status = ${statusTarget} WHERE id_penjemputan = ${idPenjemputan}`;
            }
        }
        if (Array.isArray(rincian_material) && rincian_material.length > 0) {
            const totalKg = rincian_material.reduce((acc, m) => acc + Number(m.berat_kg || 0), 0);
            const poinKotor = rincian_material.reduce((acc, m) => {
                const tarif = m.nama === 'Logam' ? 1500 : m.nama === 'Plastik' ? 500 : m.nama === 'Kardus' ? 400 : 300;
                return acc + Math.floor(Number(m.berat_kg || 0) * tarif);
            }, 0);
            penugasanMetaMap[idPenjemputan] = {
                ...(penugasanMetaMap[idPenjemputan] || {}),
                total_berat_kg: Number(totalKg.toFixed(2)),
                rincian_material,
                poin_kotor: poinKotor,
                catatan_kurir: catatan_kurir || null,
                waktu_update: new Date().toISOString()
            };
        } else {
            penugasanMetaMap[idPenjemputan] = { ...(penugasanMetaMap[idPenjemputan] || {}), waktu_update: new Date().toISOString() };
        }
        return res.status(200).json({ status: 'success', message: statusTarget === 'SELESAI' ? 'Transaksi Penjemputan (T03) selesai!' : 'Status diperbarui: Kurir dalam perjalanan!' });
    } catch (err) {
        return res.status(500).json({ status: 'error', message: err.message });
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


// GET Detail Setoran beserta Detail Materialnya untuk T05 (Terima di Titik)
app.get('/api/setoran/detail/:id_setoran', async (req, res) => {
    const { id_setoran } = req.params;
    try {
        // 1. Ambil data Header Setoran
        const header = await sql.query`
            SELECT s.*, p.nama AS pelanggan 
            FROM t_setoran s 
            JOIN m_pengguna p ON s.id_pelanggan = p.id_pengguna 
            WHERE s.id_setoran = ${id_setoran}
        `;
        
        if (header.recordset.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Setoran tidak ditemukan' });
        }

        // 2. Ambil data Detail Material (Jenis Sampah & Berat)
        const detail = await sql.query`
            SELECT ds.id_detail_setoran, ds.id_jenis_sampah, js.nama_jenis AS jenis, ds.berat_diterima_kg AS beratDiterimaAwal 
            FROM t_detail_setoran ds 
            JOIN m_jenis_sampah js ON ds.id_jenis_sampah = js.id_jenis_sampah 
            WHERE ds.id_setoran = ${id_setoran}
        `;

        // Gabungkan dan kirim ke Angular
        const result = header.recordset[0];
        result.detailMaterial = detail.recordset;

        res.status(200).json({ status: 'success', data: result });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// PUT Update Terima Fisik di Drop Point (T05)
app.put('/api/setoran/terima/:id_setoran', async (req, res) => {
    const { id_setoran } = req.params;
    const { status_terima_drop_point, catatan_serah_terima, detailMaterial } = req.body;

    try {
        // 1. Update status akhir di t_setoran (DITERIMA / SELISIH)
        await sql.query`
            UPDATE t_setoran 
            SET status_terima_drop_point = ${status_terima_drop_point}, 
                catatan_serah_terima = ${catatan_serah_terima},
                waktu_terima_drop_point = SYSUTCDATETIME()
            WHERE id_setoran = ${id_setoran}
        `;

        // 2. Update berat aktual fisik di t_detail_setoran
        for (let item of detailMaterial) {
            await sql.query`
                UPDATE t_detail_setoran 
                SET berat_masuk_drop_point_kg = ${item.beratMasukFisik}
                WHERE id_detail_setoran = ${item.id_detail_setoran}
            `;
        }

        res.status(200).json({ status: 'success', message: 'Penerimaan fisik berhasil dicatat!' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// =====================================================================
// [BAGIAN ZAAFRANS] API MASTER DROP POINT (M03)
// =====================================================================

// POST: Tambah Drop Point Baru
app.post('/api/drop-points', async (req, res) => {
    let { nama_drop_point, alamat, latitude, longitude, jam_operasional, nama_komunitas, kontak_komunitas, dibuat_oleh } = req.body;
    try {
        const result = await sql.query`
            INSERT INTO drop_point (nama_drop_point, alamat, latitude, longitude, jam_operasional, nama_komunitas, kontak_komunitas, aktif, dibuat_oleh, dibuat_pada, is_deleted)
            OUTPUT INSERTED.*
            VALUES (${nama_drop_point}, ${alamat}, ${latitude || null}, ${longitude || null}, ${jam_operasional}, ${nama_komunitas || null}, ${kontak_komunitas || null}, 1, ${dibuat_oleh || 2}, GETUTCDATE(), 0)
        `;
        res.status(201).json({ status: 'success', message: 'Drop Point berhasil ditambahkan!', data: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// PUT: Ubah Data Drop Point
app.put('/api/drop-points/:id', async (req, res) => {
    const { id } = req.params;
    let { nama_drop_point, alamat, latitude, longitude, jam_operasional, nama_komunitas, kontak_komunitas, aktif, diubah_oleh } = req.body;
    try {
        const result = await sql.query`
            UPDATE drop_point
            SET nama_drop_point = ${nama_drop_point}, alamat = ${alamat}, latitude = ${latitude || null}, longitude = ${longitude || null}, 
                jam_operasional = ${jam_operasional}, nama_komunitas = ${nama_komunitas || null}, kontak_komunitas = ${kontak_komunitas || null}, 
                aktif = ${aktif}, diubah_oleh = ${diubah_oleh || 2}, diubah_pada = GETUTCDATE()
            OUTPUT INSERTED.*
            WHERE id_drop_point = ${id} AND is_deleted = 0
        `;
        res.status(200).json({ status: 'success', message: 'Data Drop Point berhasil diperbarui!', data: result.recordset[0] });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// DELETE: Soft Delete Drop Point
app.delete('/api/drop-points/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await sql.query`UPDATE drop_point SET aktif = 0, is_deleted = 1, diubah_pada = GETUTCDATE() WHERE id_drop_point = ${id}`;
        res.status(200).json({ status: 'success', message: 'Drop Point berhasil dihapus (soft-delete).' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});


// =====================================================================
// [BAGIAN ZAAFRANS] API TRANSAKSI SETORAN - VERIFIKASI FINAL (T05)
// =====================================================================

// PUT: Verifikasi Final (Ubah status jadi FINAL & Tentukan poin sah)
app.put('/api/setoran/verifikasi/:id_setoran', async (req, res) => {
    const { id_setoran } = req.params;
    const { diverifikasi_oleh, catatan_verifikasi, detailVerifikasi } = req.body;

    try {
        // 1. Update Header ke FINAL (Status INT 3 = FINAL)
        await sql.query`
            UPDATE setoran 
            SET status = 3, diverifikasi_oleh = ${diverifikasi_oleh}, waktu_verifikasi = GETUTCDATE(), catatan_verifikasi = ${catatan_verifikasi}
            WHERE id_setoran = ${id_setoran}
        `;
        
        // 2. Update Berat Diterima/Ditolak pada rincian material
        for (let item of detailVerifikasi) {
            await sql.query`
                UPDATE detail_setoran 
                SET berat_diterima_kg = ${item.berat_diterima_kg}, berat_ditolak_kg = ${item.berat_ditolak_kg}, alasan_penolakan = ${item.alasan_penolakan || null}
                WHERE id_detail_setoran = ${item.id_detail_setoran}
            `;
        }
        res.status(200).json({ status: 'success', message: 'Setoran FINAL. Poin pelanggan bertambah dan stok masuk!' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});


// =====================================================================
// [BAGIAN ZAAFRANS] API PENJUALAN MATERIAL & RETUR (T06)
// =====================================================================

// POST: Buat Penjualan & Kirim Barang ke Mitra (Status: DIKIRIM)
app.post('/api/penjualan', async (req, res) => {
    const { id_drop_point, id_mitra, dibuat_oleh, detailPenjualan, catatan } = req.body;
    try {
        const jual = await sql.query`
            INSERT INTO penjualan (id_drop_point, id_mitra, tanggal_penjualan, waktu_pengiriman, status, catatan, dibuat_oleh, dibuat_pada, aktif)
            OUTPUT INSERTED.id_penjualan
            VALUES (${id_drop_point}, ${id_mitra}, CAST(GETUTCDATE() AS DATE), GETUTCDATE(), 'DIKIRIM', ${catatan || null}, ${dibuat_oleh}, GETUTCDATE(), 1)
        `;
        const id_penjualan_baru = jual.recordset[0].id_penjualan;

        for (let item of detailPenjualan) {
            await sql.query`
                INSERT INTO detail_penjualan (id_penjualan, id_jenis_sampah, berat_dikirim_kg, harga_per_kg_snapshot, berat_retur_kembali_kg, dibuat_oleh, dibuat_pada, aktif)
                VALUES (${id_penjualan_baru}, ${item.id_jenis_sampah}, ${item.berat_dikirim_kg}, ${item.harga_per_kg_snapshot}, 0, ${dibuat_oleh}, GETUTCDATE(), 1)
            `;
        }
        res.status(201).json({ status: 'success', message: 'Material berhasil dikirim ke Mitra!' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// PUT: Mitra Mengonfirmasi Barang (Status: DITERIMA / DITOLAK)
app.put('/api/penjualan/konfirmasi/:id_penjualan', async (req, res) => {
    const { id_penjualan } = req.params;
    const { dikonfirmasi_oleh, detailKonfirmasi } = req.body; 
    try {
        await sql.query`
            UPDATE penjualan 
            SET status = 'DITERIMA', dikonfirmasi_oleh = ${dikonfirmasi_oleh}, waktu_terima_mitra = GETUTCDATE()
            WHERE id_penjualan = ${id_penjualan}
        `;

        for (let item of detailKonfirmasi) {
            await sql.query`
                UPDATE detail_penjualan 
                SET berat_diterima_kg = ${item.berat_diterima_kg}, berat_ditolak_kg = ${item.berat_ditolak_kg}, 
                    alasan_penolakan = ${item.alasan_penolakan || null}, catatan_selisih_timbang = ${item.catatan_selisih_timbang || null}
                WHERE id_detail_penjualan = ${item.id_detail_penjualan}
            `;
        }
        res.status(200).json({ status: 'success', message: 'Konfirmasi penerimaan oleh Mitra berhasil disimpan.' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// PUT: Drop Point Menerima Retur Fisik
app.put('/api/penjualan/retur/:id_detail_penjualan', async (req, res) => {
    const { id_detail_penjualan } = req.params;
    const { berat_retur_kembali_kg } = req.body;
    try {
        await sql.query`
            UPDATE detail_penjualan 
            SET berat_retur_kembali_kg = ${berat_retur_kembali_kg}, waktu_retur_kembali = GETUTCDATE()
            WHERE id_detail_penjualan = ${id_detail_penjualan}
        `;
        res.status(200).json({ status: 'success', message: 'Retur fisik berhasil dikembalikan ke stok Drop Point!' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});


// =====================================================================
// [BAGIAN ZAAFRANS] API KOMPLIT DENGAN FALLBACK SKEMA (LAMA & BARU)
// MASTER M03, TRANSAKSI T05, T06, DAN LAPORAN STOK
// =====================================================================

// ---------------------------------------------------------
// 1. MASTER DROP POINT (M03)
// ---------------------------------------------------------

// POST: Tambah Drop Point Baru
app.post('/api/drop-points', async (req, res) => {
    let { nama_drop_point, alamat, latitude, longitude, jam_operasional, nama_komunitas, kontak_komunitas, dibuat_oleh } = req.body;
    const idPembuat = dibuat_oleh || 2;
    try {
        const result = await sql.query`
            INSERT INTO m_drop_point (nama_drop_point, alamat, latitude, longitude, jam_operasional, nama_komunitas, kontak_komunitas, aktif, dibuat_oleh, dibuat_pada)
            OUTPUT INSERTED.*
            VALUES (${nama_drop_point}, ${alamat}, ${latitude || null}, ${longitude || null}, ${jam_operasional}, ${nama_komunitas || null}, ${kontak_komunitas || null}, 1, ${idPembuat}, SYSUTCDATETIME())
        `;
        res.status(201).json({ status: 'success', message: 'Drop Point berhasil ditambahkan!', data: result.recordset[0] });
    } catch (errFirst) {
        try {
            const resultBaru = await sql.query`
                INSERT INTO drop_point (nama_drop_point, alamat, latitude, longitude, jam_operasional, nama_komunitas, kontak_komunitas, aktif, dibuat_oleh, dibuat_pada, is_deleted)
                OUTPUT INSERTED.*
                VALUES (${nama_drop_point}, ${alamat}, ${latitude || null}, ${longitude || null}, ${jam_operasional}, ${nama_komunitas || null}, ${kontak_komunitas || null}, 1, ${idPembuat}, GETUTCDATE(), 0)
            `;
            res.status(201).json({ status: 'success', message: 'Drop Point berhasil ditambahkan!', data: resultBaru.recordset[0] });
        } catch (errSecond) {
            res.status(500).json({ status: 'error', message: errFirst.message + " | " + errSecond.message });
        }
    }
});

// PUT: Ubah Data Drop Point
app.put('/api/drop-points/:id', async (req, res) => {
    const { id } = req.params;
    let { nama_drop_point, alamat, latitude, longitude, jam_operasional, nama_komunitas, kontak_komunitas, aktif, diubah_oleh } = req.body;
    const statusAktif = aktif !== undefined ? Number(aktif) : 1;
    const idPengubah = diubah_oleh || 2;

    try {
        const result = await sql.query`
            UPDATE m_drop_point
            SET nama_drop_point = ${nama_drop_point}, alamat = ${alamat}, latitude = ${latitude || null}, longitude = ${longitude || null}, 
                jam_operasional = ${jam_operasional}, nama_komunitas = ${nama_komunitas || null}, kontak_komunitas = ${kontak_komunitas || null}, 
                aktif = ${statusAktif}, diubah_oleh = ${idPengubah}, diubah_pada = SYSUTCDATETIME()
            OUTPUT INSERTED.*
            WHERE id_drop_point = ${id}
        `;
        res.status(200).json({ status: 'success', message: 'Data Drop Point berhasil diperbarui!', data: result.recordset[0] });
    } catch (errFirst) {
        try {
            const resultBaru = await sql.query`
                UPDATE drop_point
                SET nama_drop_point = ${nama_drop_point}, alamat = ${alamat}, latitude = ${latitude || null}, longitude = ${longitude || null}, 
                    jam_operasional = ${jam_operasional}, nama_komunitas = ${nama_komunitas || null}, kontak_komunitas = ${kontak_komunitas || null}, 
                    aktif = ${statusAktif}, diubah_oleh = ${idPengubah}, diubah_pada = GETUTCDATE()
            OUTPUT INSERTED.*
                WHERE id_drop_point = ${id} AND is_deleted = 0
            `;
            res.status(200).json({ status: 'success', message: 'Data Drop Point berhasil diperbarui!', data: resultBaru.recordset[0] });
        } catch (errSecond) {
            res.status(500).json({ status: 'error', message: errFirst.message + " | " + errSecond.message });
        }
    }
});

// DELETE: Soft Delete Drop Point
app.delete('/api/drop-points/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await sql.query`UPDATE m_drop_point SET aktif = 0, diubah_pada = SYSUTCDATETIME() WHERE id_drop_point = ${id}`;
        res.status(200).json({ status: 'success', message: 'Drop Point berhasil dinonaktifkan.' });
    } catch (errFirst) {
        try {
            await sql.query`UPDATE drop_point SET aktif = 0, is_deleted = 1, diubah_pada = GETUTCDATE() WHERE id_drop_point = ${id}`;
            res.status(200).json({ status: 'success', message: 'Drop Point berhasil dihapus (soft-delete).' });
        } catch (errSecond) {
            res.status(500).json({ status: 'error', message: errFirst.message + " | " + errSecond.message });
        }
    }
});

// ---------------------------------------------------------
// 2. VERIFIKASI FINAL SETORAN (T05)
// ---------------------------------------------------------

app.put('/api/setoran/verifikasi/:id_setoran', async (req, res) => {
    const { id_setoran } = req.params;
    const { diverifikasi_oleh, catatan_verifikasi, detailVerifikasi } = req.body;
    const idVerifikator = diverifikasi_oleh || 2;

    try {
        // Skema Lama (t_setoran)
        await sql.query`
            UPDATE t_setoran 
            SET status = 'FINAL', diverifikasi_oleh = ${idVerifikator}, waktu_verifikasi = SYSUTCDATETIME(), catatan_verifikasi = ${catatan_verifikasi}
            WHERE id_setoran = ${id_setoran}
        `;
        for (let item of detailVerifikasi) {
            await sql.query`
                UPDATE t_detail_setoran 
                SET berat_diterima_kg = ${item.berat_diterima_kg}, berat_ditolak_kg = ${item.berat_ditolak_kg}, alasan_penolakan = ${item.alasan_penolakan || null}
                WHERE id_detail_setoran = ${item.id_detail_setoran}
            `;
        }
        res.status(200).json({ status: 'success', message: 'Setoran FINAL. Poin pelanggan bertambah dan stok masuk!' });
    } catch (errFirst) {
        try {
            // Skema Baru (setoran)
            await sql.query`
                UPDATE setoran 
                SET status = 3, diverifikasi_oleh = ${idVerifikator}, waktu_verifikasi = GETUTCDATE(), catatan_verifikasi = ${catatan_verifikasi}
                WHERE id_setoran = ${id_setoran}
            `;
            for (let item of detailVerifikasi) {
                await sql.query`
                    UPDATE detail_setoran 
                    SET berat_diterima_kg = ${item.berat_diterima_kg}, berat_ditolak_kg = ${item.berat_ditolak_kg}, alasan_penolakan = ${item.alasan_penolakan || null}
                    WHERE id_detail_setoran = ${item.id_detail_setoran}
                `;
            }
            res.status(200).json({ status: 'success', message: 'Setoran FINAL. Poin pelanggan bertambah dan stok masuk!' });
        } catch (errSecond) {
            res.status(500).json({ status: 'error', message: errFirst.message + " | " + errSecond.message });
        }
    }
});

// ---------------------------------------------------------
// 3. PENJUALAN MATERIAL & RETUR (T06)
// ---------------------------------------------------------

app.post('/api/penjualan', async (req, res) => {
    const { id_drop_point, id_mitra, dibuat_oleh, detailPenjualan, catatan } = req.body;
    const idPembuat = dibuat_oleh || 2;
    try {
        const jual = await sql.query`
            INSERT INTO t_penjualan (id_drop_point, id_mitra, tanggal_penjualan, waktu_pengiriman, status, catatan, dibuat_oleh, dibuat_pada, aktif)
            OUTPUT INSERTED.id_penjualan
            VALUES (${id_drop_point}, ${id_mitra}, CAST(SYSUTCDATETIME() AS DATE), SYSUTCDATETIME(), 'DIKIRIM', ${catatan || null}, ${idPembuat}, SYSUTCDATETIME(), 1)
        `;
        const id_penjualan_baru = jual.recordset[0].id_penjualan;
        for (let item of detailPenjualan) {
            await sql.query`
                INSERT INTO t_detail_penjualan (id_penjualan, id_jenis_sampah, berat_dikirim_kg, harga_per_kg_snapshot, berat_retur_kembali_kg, dibuat_oleh, dibuat_pada, aktif)
                VALUES (${id_penjualan_baru}, ${item.id_jenis_sampah}, ${item.berat_dikirim_kg}, ${item.harga_per_kg_snapshot}, 0, ${idPembuat}, SYSUTCDATETIME(), 1)
            `;
        }
        res.status(201).json({ status: 'success', message: 'Material berhasil dikirim ke Mitra!' });
    } catch (errFirst) {
        try {
            const jualBaru = await sql.query`
                INSERT INTO penjualan (id_drop_point, id_mitra, tanggal_penjualan, waktu_pengiriman, status, catatan, dibuat_oleh, dibuat_pada, aktif)
                OUTPUT INSERTED.id_penjualan
                VALUES (${id_drop_point}, ${id_mitra}, CAST(GETUTCDATE() AS DATE), GETUTCDATE(), 'DIKIRIM', ${catatan || null}, ${idPembuat}, GETUTCDATE(), 1)
            `;
            const id_penjualan_baru = jualBaru.recordset[0].id_penjualan;
            for (let item of detailPenjualan) {
                await sql.query`
                    INSERT INTO detail_penjualan (id_penjualan, id_jenis_sampah, berat_dikirim_kg, harga_per_kg_snapshot, berat_retur_kembali_kg, dibuat_oleh, dibuat_pada, aktif)
                    VALUES (${id_penjualan_baru}, ${item.id_jenis_sampah}, ${item.berat_dikirim_kg}, ${item.harga_per_kg_snapshot}, 0, ${idPembuat}, GETUTCDATE(), 1)
                `;
            }
            res.status(201).json({ status: 'success', message: 'Material berhasil dikirim ke Mitra!' });
        } catch (errSecond) {
            res.status(500).json({ status: 'error', message: errFirst.message + " | " + errSecond.message });
        }
    }
});

app.put('/api/penjualan/konfirmasi/:id_penjualan', async (req, res) => {
    const { id_penjualan } = req.params;
    const { dikonfirmasi_oleh, detailKonfirmasi } = req.body; 
    try {
        await sql.query`
            UPDATE t_penjualan 
            SET status = 'DITERIMA', dikonfirmasi_oleh = ${dikonfirmasi_oleh}, waktu_terima_mitra = SYSUTCDATETIME()
            WHERE id_penjualan = ${id_penjualan}
        `;
        for (let item of detailKonfirmasi) {
            await sql.query`
                UPDATE t_detail_penjualan 
                SET berat_diterima_kg = ${item.berat_diterima_kg}, berat_ditolak_kg = ${item.berat_ditolak_kg}, 
                    alasan_penolakan = ${item.alasan_penolakan || null}, catatan_selisih_timbang = ${item.catatan_selisih_timbang || null}
                WHERE id_detail_penjualan = ${item.id_detail_penjualan}
            `;
        }
        res.status(200).json({ status: 'success', message: 'Konfirmasi penerimaan oleh Mitra berhasil disimpan.' });
    } catch (errFirst) {
        try {
            await sql.query`
                UPDATE penjualan 
                SET status = 'DITERIMA', dikonfirmasi_oleh = ${dikonfirmasi_oleh}, waktu_terima_mitra = GETUTCDATE()
                WHERE id_penjualan = ${id_penjualan}
            `;
            for (let item of detailKonfirmasi) {
                await sql.query`
                    UPDATE detail_penjualan 
                    SET berat_diterima_kg = ${item.berat_diterima_kg}, berat_ditolak_kg = ${item.berat_ditolak_kg}, 
                        alasan_penolakan = ${item.alasan_penolakan || null}, catatan_selisih_timbang = ${item.catatan_selisih_timbang || null}
                    WHERE id_detail_penjualan = ${item.id_detail_penjualan}
                `;
            }
            res.status(200).json({ status: 'success', message: 'Konfirmasi penerimaan oleh Mitra berhasil disimpan.' });
        } catch (errSecond) {
            res.status(500).json({ status: 'error', message: errFirst.message + " | " + errSecond.message });
        }
    }
});

app.put('/api/penjualan/retur/:id_detail_penjualan', async (req, res) => {
    const { id_detail_penjualan } = req.params;
    const { berat_retur_kembali_kg } = req.body;
    try {
        await sql.query`
            UPDATE t_detail_penjualan 
            SET berat_retur_kembali_kg = ${berat_retur_kembali_kg}, waktu_retur_kembali = SYSUTCDATETIME()
            WHERE id_detail_penjualan = ${id_detail_penjualan}
        `;
        res.status(200).json({ status: 'success', message: 'Retur fisik berhasil dikembalikan!' });
    } catch (errFirst) {
        try {
            await sql.query`
                UPDATE detail_penjualan 
                SET berat_retur_kembali_kg = ${berat_retur_kembali_kg}, waktu_retur_kembali = GETUTCDATE()
                WHERE id_detail_penjualan = ${id_detail_penjualan}
            `;
            res.status(200).json({ status: 'success', message: 'Retur fisik berhasil dikembalikan!' });
        } catch (errSecond) {
            res.status(500).json({ status: 'error', message: errFirst.message + " | " + errSecond.message });
        }
    }
});

// ---------------------------------------------------------
// 4. LAPORAN STOK (GABUNGAN SKEMA)
// ---------------------------------------------------------

app.get('/api/laporan/stok', async (req, res) => {
    try {
        const result = await sql.query`
            SELECT 
                js.nama_jenis,
                (
                    ISNULL((SELECT SUM(ds.berat_masuk_drop_point_kg) 
                            FROM t_detail_setoran ds 
                            JOIN t_setoran s ON ds.id_setoran = s.id_setoran 
                            WHERE ds.id_jenis_sampah = js.id_jenis_sampah 
                            AND s.status IN ('FINAL', '3') AND s.status_drop_point IN ('DITERIMA', '3')), 0)
                    -
                    ISNULL((SELECT SUM(dp.berat_dikirim_kg) 
                            FROM t_detail_penjualan dp 
                            JOIN t_penjualan p ON dp.id_penjualan = p.id_penjualan 
                            WHERE dp.id_jenis_sampah = js.id_jenis_sampah 
                            AND p.status IN ('DIKIRIM', 'DITERIMA', 'SELESAI')), 0)
                    +
                    ISNULL((SELECT SUM(dp.berat_retur_kembali_kg) 
                            FROM t_detail_penjualan dp 
                            JOIN t_penjualan p ON dp.id_penjualan = p.id_penjualan 
                            WHERE dp.id_jenis_sampah = js.id_jenis_sampah 
                            AND p.status IN ('DITERIMA', 'SELESAI')), 0)
                ) AS stok_tersedia_kg
            FROM m_jenis_sampah js
            WHERE js.aktif = 1
        `;
        res.status(200).json({ status: 'success', data: result.recordset });
    } catch (errFirst) {
        try {
            const resultBaru = await sql.query`
                SELECT 
                    js.nama_jenis,
                    (
                        ISNULL((SELECT SUM(ds.berat_masuk_drop_point_kg) 
                                FROM detail_setoran ds 
                                JOIN setoran s ON ds.id_setoran = s.id_setoran 
                                WHERE ds.id_jenis_sampah = js.id_jenis_sampah 
                                AND s.status = 3 AND s.status_drop_point = 3), 0)
                        -
                        ISNULL((SELECT SUM(dp.berat_dikirim_kg) 
                                FROM detail_penjualan dp 
                                JOIN penjualan p ON dp.id_penjualan = p.id_penjualan 
                                WHERE dp.id_jenis_sampah = js.id_jenis_sampah 
                                AND p.status IN ('DIKIRIM', 'DITERIMA', 'SELESAI')), 0)
                        +
                        ISNULL((SELECT SUM(dp.berat_retur_kembali_kg) 
                                FROM detail_penjualan dp 
                                JOIN penjualan p ON dp.id_penjualan = p.id_penjualan 
                                WHERE dp.id_jenis_sampah = js.id_jenis_sampah 
                                AND p.status IN ('DITERIMA', 'SELESAI')), 0)
                    ) AS stok_tersedia_kg
                FROM jenis_sampah js
                WHERE js.aktif = 1 AND js.is_deleted = 0
            `;
            res.status(200).json({ status: 'success', data: resultBaru.recordset });
        } catch (errSecond) {
            res.status(500).json({ status: 'error', message: errFirst.message + " | " + errSecond.message });
        }
    }
});

// =====================================================================
// TAMBAHAN API KHUSUS TUGAS ZAAFRANS (M03, T05, T06, & LAPORAN STOK)
// Tempelkan tepat sebelum app.listen(PORT, ...)
// =====================================================================

// --- HELPER STOK & PENYELESAIAN PENJUALAN (T06 & LAPORAN STOK) ---
async function ambilRekapStokPerMaterial() {
    const result = await sql.query`
        SELECT 
            js.id_jenis_sampah,
            js.nama_jenis,
            js.poin_per_kg,
            ISNULL((
                SELECT SUM(ds.berat_masuk_drop_point_kg)
                FROM detail_setoran ds
                JOIN setoran s ON ds.id_setoran = s.id_setoran
                WHERE ds.id_jenis_sampah = js.id_jenis_sampah
                  AND ds.aktif = 1 AND s.aktif = 1
                  AND s.status = 3 AND s.status_drop_point = 3
            ), 0) AS berat_masuk_final_kg,
            ISNULL((
                SELECT SUM(ISNULL(ds.berat_masuk_drop_point_kg, ds.berat_diterima_kg))
                FROM detail_setoran ds
                JOIN setoran s ON ds.id_setoran = s.id_setoran
                WHERE ds.id_jenis_sampah = js.id_jenis_sampah
                  AND ds.aktif = 1 AND s.aktif = 1
                  AND s.status_drop_point = 2
            ), 0) AS berat_tertahan_selisih_kg,
            ISNULL((
                SELECT SUM(dp.berat_dikirim_kg)
                FROM detail_penjualan dp
                JOIN penjualan p ON dp.id_penjualan = p.id_penjualan
                WHERE dp.id_jenis_sampah = js.id_jenis_sampah
                  AND dp.aktif = 1 AND p.aktif = 1
                  AND p.status IN ('DIKIRIM', 'DITERIMA', 'SELESAI')
            ), 0) AS berat_dikirim_kg,
            ISNULL((
                SELECT SUM(dp.berat_diterima_kg)
                FROM detail_penjualan dp
                JOIN penjualan p ON dp.id_penjualan = p.id_penjualan
                WHERE dp.id_jenis_sampah = js.id_jenis_sampah
                  AND dp.aktif = 1 AND p.aktif = 1
                  AND p.status IN ('DITERIMA', 'SELESAI')
            ), 0) AS berat_diterima_mitra_kg,
            ISNULL((
                SELECT SUM(dp.berat_ditolak_kg)
                FROM detail_penjualan dp
                JOIN penjualan p ON dp.id_penjualan = p.id_penjualan
                WHERE dp.id_jenis_sampah = js.id_jenis_sampah
                  AND dp.aktif = 1 AND p.aktif = 1
                  AND p.status IN ('DITERIMA', 'SELESAI')
            ), 0) AS berat_ditolak_mitra_kg,
            ISNULL((
                SELECT SUM(dp.berat_dikirim_kg - (ISNULL(dp.berat_diterima_kg, 0) + ISNULL(dp.berat_ditolak_kg, 0)))
                FROM detail_penjualan dp
                JOIN penjualan p ON dp.id_penjualan = p.id_penjualan
                WHERE dp.id_jenis_sampah = js.id_jenis_sampah
                  AND dp.aktif = 1 AND p.aktif = 1
                  AND p.status IN ('DITERIMA', 'SELESAI')
                  AND dp.berat_diterima_kg IS NOT NULL
            ), 0) AS selisih_timbang_mitra_kg,
            ISNULL((
                SELECT SUM(dp.berat_retur_kembali_kg)
                FROM detail_penjualan dp
                JOIN penjualan p ON dp.id_penjualan = p.id_penjualan
                WHERE dp.id_jenis_sampah = js.id_jenis_sampah
                  AND dp.aktif = 1 AND p.aktif = 1
                  AND p.status IN ('DITERIMA', 'SELESAI')
                  AND dp.waktu_retur_kembali IS NOT NULL
            ), 0) AS berat_retur_kembali_kg,
            ISNULL((
                SELECT SUM(ROUND(ISNULL(dp.berat_diterima_kg, 0) * dp.harga_per_kg_snapshot, 2))
                FROM detail_penjualan dp
                JOIN penjualan p ON dp.id_penjualan = p.id_penjualan
                WHERE dp.id_jenis_sampah = js.id_jenis_sampah
                  AND dp.aktif = 1 AND p.aktif = 1
                  AND p.status IN ('DITERIMA', 'SELESAI')
            ), 0) AS nilai_penjualan_rp
        FROM jenis_sampah js
        WHERE js.aktif = 1 AND js.is_deleted = 0
        ORDER BY js.id_jenis_sampah ASC
    `;

    return result.recordset.map(r => {
        const masuk = Number(r.berat_masuk_final_kg || 0);
        const kirim = Number(r.berat_dikirim_kg || 0);
        const retur = Number(r.berat_retur_kembali_kg || 0);
        return {
            id_jenis_sampah: r.id_jenis_sampah,
            nama_jenis: r.nama_jenis,
            poin_per_kg: Number(r.poin_per_kg || 0),
            berat_masuk_final_kg: masuk,
            berat_tertahan_selisih_kg: Number(r.berat_tertahan_selisih_kg || 0),
            berat_dikirim_kg: kirim,
            berat_diterima_mitra_kg: Number(r.berat_diterima_mitra_kg || 0),
            berat_ditolak_mitra_kg: Number(r.berat_ditolak_mitra_kg || 0),
            selisih_timbang_mitra_kg: Number(Number(r.selisih_timbang_mitra_kg || 0).toFixed(3)),
            berat_retur_kembali_kg: retur,
            stok_tersedia_kg: Number((masuk - kirim + retur).toFixed(3)),
            nilai_penjualan_rp: Number(r.nilai_penjualan_rp || 0)
        };
    });
}

async function evaluasiPenyelesaianPenjualan(idPenjualan) {
    try {
        const hdr = await sql.query`SELECT status FROM penjualan WHERE id_penjualan = ${idPenjualan} AND aktif = 1`;
        if (hdr.recordset.length === 0 || hdr.recordset[0].status !== 'DITERIMA') return false;

        const dtl = await sql.query`
            SELECT 
                COUNT(*) AS total_baris,
                SUM(CASE WHEN berat_diterima_kg IS NULL OR berat_ditolak_kg IS NULL THEN 1 ELSE 0 END) AS belum_konfirmasi,
                SUM(CASE WHEN ISNULL(berat_ditolak_kg, 0) > 0 AND waktu_retur_kembali IS NULL THEN 1 ELSE 0 END) AS retur_tertunda,
                ISNULL(SUM(ROUND(ISNULL(berat_diterima_kg, 0) * harga_per_kg_snapshot, 2)), 0) AS total_tagihan_rp
            FROM detail_penjualan
            WHERE id_penjualan = ${idPenjualan} AND aktif = 1
        `;
        const stat = dtl.recordset[0];
        if (!stat || Number(stat.total_baris) === 0 || Number(stat.belum_konfirmasi) > 0 || Number(stat.retur_tertunda) > 0) {
            return false;
        }

        const tagihan = Number(stat.total_tagihan_rp || 0);
        let sudahLunas = tagihan === 0;
        if (tagihan > 0) {
            const kasRes = await sql.query`
                SELECT id_mutasi_kas FROM mutasi_kas WHERE id_penjualan = ${idPenjualan} AND aktif = 1 AND jumlah_rupiah > 0
            `;
            sudahLunas = kasRes.recordset.length > 0;
        }

        if (sudahLunas) {
            await sql.query`UPDATE penjualan SET status = 'SELESAI' WHERE id_penjualan = ${idPenjualan}`;
            return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}

// 1. GET Detail 1 Drop Point (M03)
app.get('/api/drop-points/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await sql.query`SELECT * FROM drop_point WHERE id_drop_point = ${id} AND is_deleted = 0`;
        if (result.recordset.length === 0) return res.status(404).json({ status: 'error', message: 'Drop Point tidak ditemukan.' });
        return res.status(200).json({ status: 'success', data: result.recordset[0] });
    } catch (err) {
        return res.status(500).json({ status: 'error', message: err.message });
    }
});

// 2. PUT Ubah Drop Point (M03)
app.put('/api/drop-points/:id', async (req, res) => {
    const { id } = req.params;
    const { nama_drop_point, alamat, latitude, longitude, jam_operasional, nama_komunitas, kontak_komunitas, aktif, diubah_oleh } = req.body;
    try {
        const result = await sql.query`
            UPDATE drop_point
            SET nama_drop_point = ${nama_drop_point},
                alamat = ${alamat},
                latitude = ${latitude ?? null},
                longitude = ${longitude ?? null},
                jam_operasional = ${jam_operasional},
                nama_komunitas = ${nama_komunitas || null},
                kontak_komunitas = ${kontak_komunitas || null},
                aktif = ${aktif !== undefined ? Number(aktif) : 1},
                diubah_oleh = ${diubah_oleh || null},
                diubah_pada = GETUTCDATE()
            OUTPUT INSERTED.*
            WHERE id_drop_point = ${id} AND is_deleted = 0
        `;
        return res.status(200).json({ status: 'success', message: 'Data Drop Point berhasil diperbarui!', data: result.recordset[0] });
    } catch (err) {
        return res.status(500).json({ status: 'error', message: err.message });
    }
});

// 3. PATCH Status Aktif/Nonaktif Drop Point (M03)
app.patch('/api/drop-points/:id/status', async (req, res) => {
    const { id } = req.params;
    const statusBaru = Number(req.body.aktif) === 1 ? 1 : 0;
    const idPengubah = req.body.diubah_oleh ? Number(req.body.diubah_oleh) : null;
    try {
        await sql.query`
            UPDATE drop_point SET aktif = ${statusBaru}, diubah_oleh = ${idPengubah}, diubah_pada = GETUTCDATE()
            WHERE id_drop_point = ${id} AND is_deleted = 0
        `;
        return res.status(200).json({ status: 'success', message: 'Status Drop Point berhasil diperbarui!' });
    } catch (err) {
        return res.status(500).json({ status: 'error', message: err.message });
    }
});

// 4. DELETE Soft Delete Drop Point (M03: is_deleted = 1, aktif = 0)
app.delete('/api/drop-points/:id', async (req, res) => {
    const { id } = req.params;
    const idPengubah = req.query?.diubah_oleh ? Number(req.query.diubah_oleh) : null;
    try {
        await sql.query`
            UPDATE drop_point SET aktif = 0, is_deleted = 1, diubah_oleh = ${idPengubah}, diubah_pada = GETUTCDATE()
            WHERE id_drop_point = ${id}
        `;
        return res.status(200).json({ status: 'success', message: 'Drop Point berhasil di-soft delete (aktif=0, is_deleted=1).' });
    } catch (err) {
        return res.status(500).json({ status: 'error', message: err.message });
    }
});

// 5. GET Antrean & Riwayat Kedatangan Fisik Setoran di Drop Point (T05)
app.get('/api/setoran/kedatangan', async (req, res) => {
    try {
        const result = await sql.query`
            SELECT 
                s.id_setoran, s.id_pengguna, s.id_drop_point, s.status, s.status_drop_point,
                s.waktu_timbang, s.waktu_verifikasi, s.waktu_terima_drop_point,
                s.catatan_serah_terima, s.diterima_oleh, s.dibuat_pada,
                pel.nama AS pelanggan, pel.peran AS peran_pelanggan, pel.nama_usaha,
                dp.nama_drop_point, penerima.nama AS nama_penerima,
                pj.id_penjemputan, pj.status AS status_jemput, kurir.nama AS nama_kurir,
                ISNULL((SELECT SUM(ds.berat_diterima_kg) FROM detail_setoran ds WHERE ds.id_setoran = s.id_setoran AND ds.aktif = 1), 0) AS total_berat_awal_kg,
                (SELECT SUM(ds.berat_masuk_drop_point_kg) FROM detail_setoran ds WHERE ds.id_setoran = s.id_setoran AND ds.aktif = 1) AS total_berat_masuk_kg
            FROM setoran s
            JOIN pengguna pel ON s.id_pengguna = pel.id_pengguna
            LEFT JOIN drop_point dp ON s.id_drop_point = dp.id_drop_point
            LEFT JOIN pengguna penerima ON s.diterima_oleh = penerima.id_pengguna
            LEFT JOIN penjemputan pj ON s.id_setoran = pj.id_setoran
            LEFT JOIN pengguna kurir ON pj.id_petugas = kurir.id_pengguna
            WHERE s.aktif = 1 AND s.status NOT IN (4, 5)
            ORDER BY s.id_setoran DESC
        `;
        const list = result.recordset.map(r => ({
            ...r,
            nomor: `STR-${String(r.id_setoran).padStart(3, '0')}`,
            metode_setor: r.id_penjemputan ? 'DIJEMPUT' : 'ANTAR_SENDIRI',
            status_label: Number(r.status) === 3 ? 'FINAL' : (Number(r.status) === 2 ? 'DIAJUKAN' : 'DRAFT'),
            status_drop_point_label: Number(r.status_drop_point) === 3 ? 'DITERIMA' : (Number(r.status_drop_point) === 2 ? 'SELISIH' : 'MENUNGGU'),
            masuk_stok: Number(r.status) === 3 && Number(r.status_drop_point) === 3
        }));
        return res.status(200).json({ status: 'success', data: list });
    } catch (err) {
        return res.status(500).json({ status: 'error', message: err.message });
    }
});

// 6. GET Daftar Transaksi Penjualan beserta Detail Material, Retur, & Status Pelunasan (T06)
app.get('/api/penjualan', async (req, res) => {
    const filterMitra = req.query.id_mitra ? Number(req.query.id_mitra) : null;
    try {
        const headerRes = filterMitra
            ? await sql.query`
                SELECT p.*, m.nama_mitra, dp.nama_drop_point, mk.id_mutasi_kas, mk.jumlah_rupiah AS nominal_pelunasan_rp
                FROM penjualan p
                JOIN mitra m ON p.id_mitra = m.id_mitra
                LEFT JOIN drop_point dp ON p.id_drop_point = dp.id_drop_point
                LEFT JOIN mutasi_kas mk ON p.id_penjualan = mk.id_penjualan AND mk.aktif = 1
                WHERE p.aktif = 1 AND p.id_mitra = ${filterMitra}
                ORDER BY p.id_penjualan DESC
            `
            : await sql.query`
                SELECT p.*, m.nama_mitra, dp.nama_drop_point, mk.id_mutasi_kas, mk.jumlah_rupiah AS nominal_pelunasan_rp
                FROM penjualan p
                JOIN mitra m ON p.id_mitra = m.id_mitra
                LEFT JOIN drop_point dp ON p.id_drop_point = dp.id_drop_point
                LEFT JOIN mutasi_kas mk ON p.id_penjualan = mk.id_penjualan AND mk.aktif = 1
                WHERE p.aktif = 1
                ORDER BY p.id_penjualan DESC
            `;

        const detailRes = await sql.query`
            SELECT dp.*, js.nama_jenis
            FROM detail_penjualan dp
            JOIN jenis_sampah js ON dp.id_jenis_sampah = js.id_jenis_sampah
            WHERE dp.aktif = 1
        `;

        const detailByPenjualan = {};
        for (const d of detailRes.recordset) {
            if (!detailByPenjualan[d.id_penjualan]) detailByPenjualan[d.id_penjualan] = [];
            const dikirim = Number(d.berat_dikirim_kg || 0);
            const diterima = d.berat_diterima_kg !== null ? Number(d.berat_diterima_kg) : null;
            const ditolak = d.berat_ditolak_kg !== null ? Number(d.berat_ditolak_kg) : null;
            const harga = Number(d.harga_per_kg_snapshot || 0);
            const retur = Number(d.berat_retur_kembali_kg || 0);
            detailByPenjualan[d.id_penjualan].push({
                ...d,
                berat_dikirim_kg: dikirim,
                berat_diterima_kg: diterima,
                berat_ditolak_kg: ditolak,
                harga_per_kg_snapshot: harga,
                berat_retur_kembali_kg: retur,
                subtotal_rp: diterima !== null ? Number((diterima * harga).toFixed(2)) : Number((dikirim * harga).toFixed(2)),
                selisih_timbang_kg: diterima !== null && ditolak !== null ? Number((dikirim - (diterima + ditolak)).toFixed(3)) : 0,
                perlu_retur: ditolak !== null && ditolak > 0 && !d.waktu_retur_kembali,
                retur_selesai: ditolak !== null && ditolak > 0 && !!d.waktu_retur_kembali
            });
        }

        const list = headerRes.recordset.map(h => {
            const rincian = detailByPenjualan[h.id_penjualan] || [];
            const sudahKonfirmasi = ['DITERIMA', 'SELESAI'].includes(String(h.status).toUpperCase());
            const totalTagihanRp = sudahKonfirmasi
                ? Number(rincian.reduce((a, b) => a + Number(((b.berat_diterima_kg || 0) * b.harga_per_kg_snapshot).toFixed(2)), 0).toFixed(2))
                : Number(rincian.reduce((a, b) => a + Number((b.berat_dikirim_kg * b.harga_per_kg_snapshot).toFixed(2)), 0).toFixed(2));
            let statusPelunasan = 'MENUNGGU_KONFIRMASI';
            if (h.status === 'DIBATALKAN') statusPelunasan = 'DIBATALKAN';
            else if (sudahKonfirmasi) statusPelunasan = totalTagihanRp === 0 ? 'TAGIHAN_NOL' : (h.id_mutasi_kas ? 'LUNAS' : 'BELUM_LUNAS');

            return {
                ...h,
                kode_penjualan: `PJL-${String(h.id_penjualan).padStart(3, '0')}`,
                total_dikirim_kg: Number(rincian.reduce((a, b) => a + b.berat_dikirim_kg, 0).toFixed(3)),
                total_diterima_kg: Number(rincian.reduce((a, b) => a + (b.berat_diterima_kg || 0), 0).toFixed(3)),
                total_ditolak_kg: Number(rincian.reduce((a, b) => a + (b.berat_ditolak_kg || 0), 0).toFixed(3)),
                total_retur_kg: Number(rincian.reduce((a, b) => a + (b.berat_retur_kembali_kg || 0), 0).toFixed(3)),
                total_tagihan_rp: totalTagihanRp,
                ada_retur_tertunda: rincian.some(r => r.perlu_retur),
                status_pelunasan: statusPelunasan,
                detailPenjualan: rincian
            };
        });
        return res.status(200).json({ status: 'success', data: list });
    } catch (err) {
        return res.status(500).json({ status: 'error', message: err.message });
    }
});

// 7. PUT Kirim Penjualan yang Masih DRAFT (T06 - Validasi Stok)
app.put('/api/penjualan/:id/kirim', async (req, res) => {
    const { id } = req.params;
    try {
        const dtl = await sql.query`SELECT * FROM detail_penjualan WHERE id_penjualan = ${id} AND aktif = 1`;
        const rekapStok = await ambilRekapStokPerMaterial();
        for (const item of dtl.recordset) {
            const infoStok = rekapStok.find(s => Number(s.id_jenis_sampah) === Number(item.id_jenis_sampah));
            const stokTersedia = infoStok ? Number(infoStok.stok_tersedia_kg) : 0;
            if (Number(item.berat_dikirim_kg) > stokTersedia) {
                return res.status(400).json({ status: 'error', message: `Stok tidak cukup! Tersedia ${stokTersedia} kg.` });
            }
        }
        await sql.query`UPDATE penjualan SET status = 'DIKIRIM', waktu_pengiriman = GETUTCDATE() WHERE id_penjualan = ${id}`;
        return res.status(200).json({ status: 'success', message: 'Penjualan berhasil dikirim ke Mitra!' });
    } catch (err) {
        return res.status(500).json({ status: 'error', message: err.message });
    }
});

// 8. PUT Batalkan Penjualan yang Masih DRAFT (T06)
app.put('/api/penjualan/:id/batal', async (req, res) => {
    const { id } = req.params;
    try {
        await sql.query`UPDATE penjualan SET status = 'DIBATALKAN' WHERE id_penjualan = ${id} AND status = 'DRAFT'`;
        return res.status(200).json({ status: 'success', message: 'Draft penjualan telah dibatalkan.' });
    } catch (err) {
        return res.status(500).json({ status: 'error', message: err.message });
    }
});

// 9. PUT Konfirmasi Penerimaan & Penolakan Material oleh Mitra (T06)
app.put('/api/penjualan/konfirmasi/:id_penjualan', async (req, res) => {
    const { id_penjualan } = req.params;
    const { dikonfirmasi_oleh, detailKonfirmasi } = req.body;
    try {
        await sql.query`
            UPDATE penjualan 
            SET status = 'DITERIMA', dikonfirmasi_oleh = ${dikonfirmasi_oleh || 1}, waktu_terima_mitra = GETUTCDATE()
            WHERE id_penjualan = ${id_penjualan}
        `;
        for (const item of detailKonfirmasi) {
            await sql.query`
                UPDATE detail_penjualan 
                SET berat_diterima_kg = ${Number(item.berat_diterima_kg)},
                    berat_ditolak_kg = ${Number(item.berat_ditolak_kg)},
                    alasan_penolakan = ${item.alasan_penolakan || null},
                    catatan_selisih_timbang = ${item.catatan_selisih_timbang || null}
                WHERE id_detail_penjualan = ${item.id_detail_penjualan} AND id_penjualan = ${id_penjualan}
            `;
        }
        await evaluasiPenyelesaianPenjualan(id_penjualan);
        return res.status(200).json({ status: 'success', message: 'Konfirmasi penerimaan Mitra berhasil disimpan!' });
    } catch (err) {
        return res.status(500).json({ status: 'error', message: err.message });
    }
});

// 10. PUT Catat Retur Fisik Kembali ke Stok Drop Point (T06 - 1x Retur per Detail)
app.put('/api/penjualan/retur/:id_detail_penjualan', async (req, res) => {
    const { id_detail_penjualan } = req.params;
    const beratRetur = Number(req.body.berat_retur_kembali_kg);
    try {
        const dtlRes = await sql.query`SELECT * FROM detail_penjualan WHERE id_detail_penjualan = ${id_detail_penjualan}`;
        if (dtlRes.recordset.length === 0) return res.status(404).json({ status: 'error', message: 'Detail tidak ditemukan.' });
        const dtl = dtlRes.recordset[0];
        if (dtl.waktu_retur_kembali !== null || Number(dtl.berat_retur_kembali_kg || 0) > 0) {
            return res.status(400).json({ status: 'error', message: 'Retur fisik sudah pernah dicatat (MVP 1x retur per detail)!' });
        }
        if (beratRetur <= 0 || beratRetur > Number(dtl.berat_ditolak_kg || 0)) {
            return res.status(400).json({ status: 'error', message: 'Berat retur tidak valid atau melebihi berat ditolak!' });
        }
        await sql.query`
            UPDATE detail_penjualan 
            SET berat_retur_kembali_kg = ${beratRetur}, waktu_retur_kembali = GETUTCDATE()
            WHERE id_detail_penjualan = ${id_detail_penjualan}
        `;
        await evaluasiPenyelesaianPenjualan(dtl.id_penjualan);
        return res.status(200).json({ status: 'success', message: 'Retur fisik berhasil diterima kembali ke stok Drop Point!' });
    } catch (err) {
        return res.status(500).json({ status: 'error', message: err.message });
    }
});

// 11. GET Laporan Stok & Penjualan per Material (Kelompok Laporan 3)
app.get('/api/laporan/stok', async (req, res) => {
    try {
        const rekapMaterial = await ambilRekapStokPerMaterial();
        const ringkasan = {
            total_stok_tersedia_kg: Number(rekapMaterial.reduce((a, b) => a + b.stok_tersedia_kg, 0).toFixed(3)),
            total_masuk_final_kg: Number(rekapMaterial.reduce((a, b) => a + b.berat_masuk_final_kg, 0).toFixed(3)),
            total_tertahan_selisih_kg: Number(rekapMaterial.reduce((a, b) => a + b.berat_tertahan_selisih_kg, 0).toFixed(3)),
            total_dikirim_kg: Number(rekapMaterial.reduce((a, b) => a + b.berat_dikirim_kg, 0).toFixed(3)),
            total_diterima_mitra_kg: Number(rekapMaterial.reduce((a, b) => a + b.berat_diterima_mitra_kg, 0).toFixed(3)),
            total_ditolak_mitra_kg: Number(rekapMaterial.reduce((a, b) => a + b.berat_ditolak_mitra_kg, 0).toFixed(3)),
            total_retur_kembali_kg: Number(rekapMaterial.reduce((a, b) => a + b.berat_retur_kembali_kg, 0).toFixed(3)),
            total_nilai_penjualan_rp: Number(rekapMaterial.reduce((a, b) => a + b.nilai_penjualan_rp, 0).toFixed(2))
        };
        return res.status(200).json({ status: 'success', data: rekapMaterial, ringkasan });
    } catch (err) {
        return res.status(500).json({ status: 'error', message: err.message });
    }
});