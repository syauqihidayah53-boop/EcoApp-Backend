const express = require('express');
const cors = require('cors');
const { sql, connectDB } = require('./config/db');

const app = express();
app.use(cors());
app.use(express.json());

// Nyalakan koneksi database
connectDB();

// ==========================================
// 1. GET: Daftar Drop Point (Untuk Peta Frontend)
// ==========================================
app.get('/api/drop-points', async (req, res) => {
    try {
        const request = new sql.Request();
        const result = await request.query(`
            SELECT id_drop_point, nama_drop_point, alamat, latitude, longitude, jam_operasional, nama_komunitas 
            FROM m_drop_point WHERE aktif = 1
        `);
        res.status(200).json({ status: "success", message: "Berhasil mengambil data Drop Point EcoApp", data: result.recordset });
    } catch (error) {
        res.status(500).json({ status: "error", message: "Gagal mengambil data dari server EcoApp", data: null });
    }
});

// ==========================================
// 2. POST: Membuat Transaksi Setoran
// ==========================================
app.post('/api/setoran', async (req, res) => {
    try {
        const { id_pelanggan, id_drop_point, catatan_serah_terima, id_dibuat_oleh } = req.body;

        if (!id_pelanggan || !id_drop_point || !id_dibuat_oleh) {
            return res.status(400).json({ status: "error", message: "Data wajib diisi!", data: null });
        }

        const request = new sql.Request();
        request.input('idPel', sql.Int, id_pelanggan);
        request.input('idDP', sql.Int, id_drop_point);
        request.input('catatan', sql.NVarChar, catatan_serah_terima || '');
        request.input('dibuatOleh', sql.Int, id_dibuat_oleh);

        const result = await request.query(`
            INSERT INTO t_setoran (id_pelanggan, id_drop_point, status, status_terima_drop_point, catatan_serah_terima, dibuat_oleh)
            OUTPUT INSERTED.id_setoran, INSERTED.status, INSERTED.dibuat_pada
            VALUES (@idPel, @idDP, 'DRAFT', 'MENUNGGU', @catatan, @dibuatOleh)
        `);

        res.status(201).json({ status: "success", message: "Setoran EcoApp berhasil dibuat!", data: result.recordset[0] });
    } catch (error) {
        res.status(500).json({ status: "error", message: "Terjadi kesalahan sistem EcoApp", data: null });
    }
});

// Jalankan Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 API EcoApp berjalan di http://localhost:${PORT}`);
});