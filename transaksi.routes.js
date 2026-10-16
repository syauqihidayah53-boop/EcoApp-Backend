// =====================================================================
// API TRANSAKSI PILAHIN (Node.js Express + SQL Server)
// Database: ecoapp_db
// =====================================================================

const express = require('express');
const router = express.Router();
const sql = require('mssql');
const transaksiRoutes = require('./transaksi.routes');

// ---------------------------------------------------------------------
// 1. GET /api/setoran (Antrean Setoran Menunggu Timbang & Verifikasi)
// ---------------------------------------------------------------------
router.get('/setoran', async (req, res) => {
  try {
    const pool = await sql.connect();
    const result = await pool.request().query(`
      SELECT 
        s.id_setoran,
        s.id_pelanggan,
        p.nama AS nama_pelanggan,
        p.no_hp AS kontak_pelanggan,
        s.id_drop_point,
        dp.nama_drop_point,
        s.status,
        s.status_terima_drop_point,
        s.waktu_timbang,
        s.foto_bukti,
        s.catatan_verifikasi,
        s.dibuat_pada,
        ISNULL(pj.potongan_persen_disepakati, 0) AS potongan_persen,
        (SELECT COUNT(*) FROM t_detail_setoran d WHERE d.id_setoran = s.id_setoran) AS total_item,
        (SELECT ISNULL(SUM(d.berat_diterima_kg), 0) FROM t_detail_setoran d WHERE d.id_setoran = s.id_setoran) AS total_berat_kg
      FROM t_setoran s
      INNER JOIN m_pengguna p ON s.id_pelanggan = p.id_pengguna
      INNER JOIN m_drop_point dp ON s.id_drop_point = dp.id_drop_point
      LEFT JOIN t_penjemputan pj ON pj.id_setoran = s.id_setoran
      ORDER BY s.id_setoran DESC
    `);

    res.json({ status: 'success', data: result.recordset });
  } catch (err) {
    console.error('Error GET /api/setoran:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Alias endpoint antrean
router.get('/setoran/antrean', async (req, res) => {
  try {
    const pool = await sql.connect();
    const result = await pool.request().query(`
      SELECT s.*, p.nama AS nama_pelanggan, dp.nama_drop_point,
             ISNULL(pj.potongan_persen_disepakati, 0) AS potongan_persen
      FROM t_setoran s
      JOIN m_pengguna p ON s.id_pelanggan = p.id_pengguna
      JOIN m_drop_point dp ON s.id_drop_point = dp.id_drop_point
      LEFT JOIN t_penjemputan pj ON pj.id_setoran = s.id_setoran
      WHERE s.status IN ('DRAFT', 'DIAJUKAN')
      ORDER BY s.id_setoran DESC
    `);
    res.json({ status: 'success', data: result.recordset });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ---------------------------------------------------------------------
// 2. GET /api/setoran/:id ATAU /api/setoran/detail/:id (Detail Lengkap)
// ---------------------------------------------------------------------
const getDetailSetoranHandler = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const pool = await sql.connect();

    const setoranHeader = await pool.request()
      .input('id_setoran', sql.Int, id)
      .query(`
        SELECT 
          s.*,
          p.nama AS nama_pelanggan,
          p.no_hp AS kontak_pelanggan,
          dp.nama_drop_point,
          ISNULL(pj.potongan_persen_disepakati, 0) AS potongan_persen
        FROM t_setoran s
        JOIN m_pengguna p ON s.id_pelanggan = p.id_pengguna
        JOIN m_drop_point dp ON s.id_drop_point = dp.id_drop_point
        LEFT JOIN t_penjemputan pj ON pj.id_setoran = s.id_setoran
        WHERE s.id_setoran = @id_setoran
      `);

    if (setoranHeader.recordset.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Setoran tidak ditemukan' });
    }

    const details = await pool.request()
      .input('id_setoran', sql.Int, id)
      .query(`
        SELECT 
          d.id_detail_setoran,
          d.id_detail_setoran AS id_detail,
          d.id_jenis_sampah,
          j.nama_jenis,
          d.berat_diterima_kg,
          d.berat_diterima_kg AS beratDiterimaAwal,
          ISNULL(d.berat_masuk_drop_point_kg, d.berat_diterima_kg) AS beratMasukFisik,
          d.berat_ditolak_kg,
          d.alasan_penolakan,
          d.poin_per_kg_snapshot,
          (d.berat_diterima_kg * d.poin_per_kg_snapshot) AS subtotal_poin
        FROM t_detail_setoran d
        JOIN m_jenis_sampah j ON d.id_jenis_sampah = j.id_jenis_sampah
        WHERE d.id_setoran = @id_setoran
      `);

    const data = setoranHeader.recordset[0];
    data.detailMaterial = details.recordset;
    data.details = details.recordset;

    res.json({ status: 'success', data });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

router.get('/setoran/:id', getDetailSetoranHandler);
router.get('/setoran/detail/:id', getDetailSetoranHandler);

// ---------------------------------------------------------------------
// 3. POST /api/setoran/:id/timbang (T02: Simpan Hasil Penimbangan)
// ---------------------------------------------------------------------
router.post('/setoran/:id/timbang', async (req, res) => {
  const pool = await sql.connect();
  const transaction = new sql.Transaction(pool);

  try {
    const idSetoran = parseInt(req.params.id, 10);
    const { foto_bukti, dicatat_oleh, ditimbang_oleh, details } = req.body;
    const petugasId = dicatat_oleh || ditimbang_oleh || 1;

    await transaction.begin();

    // Update Header Setoran jadi DIAJUKAN
    await transaction.request()
      .input('id_setoran', sql.Int, idSetoran)
      .input('foto_bukti', sql.NVarChar(255), foto_bukti || null)
      .input('dicatat_oleh', sql.Int, petugasId)
      .query(`
        UPDATE t_setoran
        SET 
          status = 'DIAJUKAN',
          waktu_timbang = SYSUTCDATETIME(),
          foto_bukti = @foto_bukti,
          dicatat_oleh = @dicatat_oleh
        WHERE id_setoran = @id_setoran
      `);

    // Hapus detail lama jika ada input ulang
    await transaction.request()
      .input('id_setoran', sql.Int, idSetoran)
      .query(`DELETE FROM t_detail_setoran WHERE id_setoran = @id_setoran`);

    // Insert detail penimbangan material
    for (const item of details) {
      const ditolak = Number(item.berat_ditolak_kg || 0);
      const alasan = ditolak > 0 ? (item.alasan_penolakan || 'Kotor / basah / tercampur') : null;

      await transaction.request()
        .input('id_setoran', sql.Int, idSetoran)
        .input('id_jenis_sampah', sql.Int, item.id_jenis_sampah)
        .input('berat_diterima_kg', sql.Decimal(12, 3), item.berat_diterima_kg || 0)
        .input('berat_ditolak_kg', sql.Decimal(12, 3), ditolak)
        .input('alasan_penolakan', sql.NVarChar(255), alasan)
        .input('poin_per_kg_snapshot', sql.Decimal(10, 2), item.poin_per_kg_snapshot || 0)
        .query(`
          INSERT INTO t_detail_setoran 
            (id_setoran, id_jenis_sampah, berat_diterima_kg, berat_ditolak_kg, alasan_penolakan, poin_per_kg_snapshot)
          VALUES 
            (@id_setoran, @id_jenis_sampah, @berat_diterima_kg, @berat_ditolak_kg, @alasan_penolakan, @poin_per_kg_snapshot)
        `);
    }

    await transaction.commit();
    res.json({ status: 'success', message: 'Hasil penimbangan berhasil disimpan dan diajukan ke pengelola' });
  } catch (err) {
    if (transaction) await transaction.rollback();
    console.error('Error POST /api/setoran/:id/timbang:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ---------------------------------------------------------------------
// 4. PUT / PATCH /api/setoran/verifikasi/:id (T02: Pengesahan FINAL / DITOLAK)
// ---------------------------------------------------------------------
const verifikasiSetoranHandler = async (req, res) => {
  const pool = await sql.connect();
  const transaction = new sql.Transaction(pool);

  try {
    const idSetoran = parseInt(req.params.id, 10);
    const { status, diverifikasi_oleh, catatan_verifikasi, detailVerifikasi } = req.body;
    const statusFinal = (status === 4 || String(status).toUpperCase() === 'DITOLAK') ? 'DITOLAK' : 'FINAL';
    const verifikatorId = diverifikasi_oleh || 1;

    await transaction.begin();

    // Jika ada update berat saat verifikasi fisik
    if (Array.isArray(detailVerifikasi) && detailVerifikasi.length > 0) {
      for (const d of detailVerifikasi) {
        if (d.id_detail_setoran) {
          const ditolak = Number(d.berat_ditolak_kg || 0);
          const alasan = ditolak > 0 ? (d.alasan_penolakan || 'Tidak memenuhi kualifikasi') : null;

          await transaction.request()
            .input('id_detail_setoran', sql.Int, d.id_detail_setoran)
            .input('berat_diterima_kg', sql.Decimal(12, 3), d.berat_diterima_kg)
            .input('berat_ditolak_kg', sql.Decimal(12, 3), ditolak)
            .input('alasan_penolakan', sql.NVarChar(255), alasan)
            .query(`
              UPDATE t_detail_setoran
              SET berat_diterima_kg = @berat_diterima_kg,
                  berat_ditolak_kg = @berat_ditolak_kg,
                  alasan_penolakan = @alasan_penolakan
              WHERE id_detail_setoran = @id_detail_setoran
            `);
        }
      }
    }

    // Update Header Setoran menjadi FINAL
    // Sesuai constraint ck_setoran_final: diverifikasi_oleh & waktu_verifikasi wajib NOT NULL saat FINAL
    await transaction.request()
      .input('id_setoran', sql.Int, idSetoran)
      .input('status', sql.VarChar(10), statusFinal)
      .input('diverifikasi_oleh', sql.Int, verifikatorId)
      .input('catatan_verifikasi', sql.NVarChar(500), catatan_verifikasi || 'Verifikasi disahkan pengelola')
      .query(`
        UPDATE t_setoran
        SET 
          status = @status,
          diverifikasi_oleh = @diverifikasi_oleh,
          waktu_verifikasi = SYSUTCDATETIME(),
          catatan_verifikasi = @catatan_verifikasi
        WHERE id_setoran = @id_setoran
      `);

    await transaction.commit();
    res.json({ status: 'success', message: `Setoran #${idSetoran} berhasil diverifikasi dengan status ${statusFinal}` });
  } catch (err) {
    if (transaction) await transaction.rollback();
    console.error('Error Verifikasi:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
};

router.put('/setoran/verifikasi/:id', verifikasiSetoranHandler);
router.patch('/setoran/:id/verifikasi', verifikasiSetoranHandler);

// ---------------------------------------------------------------------
// 5. PUT /api/setoran/terima/:id (Serah Terima Fisik di Titik Drop Point)
// ---------------------------------------------------------------------
router.put('/setoran/terima/:id', async (req, res) => {
  const pool = await sql.connect();
  const transaction = new sql.Transaction(pool);

  try {
    const idSetoran = parseInt(req.params.id, 10);
    const { status_terima_drop_point, catatan_serah_terima, detailMaterial, diterima_oleh } = req.body;
    const statusTerima = status_terima_drop_point === 'SELISIH' ? 'SELISIH' : 'DITERIMA';
    const penerimaId = diterima_oleh || 1;

    await transaction.begin();

    // Sesuai constraint ck_setoran_terima_waktu: waktu_terima_drop_point wajib NOT NULL jika bukan MENUNGGU
    await transaction.request()
      .input('id_setoran', sql.Int, idSetoran)
      .input('status_terima', sql.VarChar(10), statusTerima)
      .input('catatan', sql.NVarChar(500), catatan_serah_terima || null)
      .input('diterima_oleh', sql.Int, penerimaId)
      .query(`
        UPDATE t_setoran
        SET 
          status_terima_drop_point = @status_terima,
          waktu_terima_drop_point = SYSUTCDATETIME(),
          catatan_serah_terima = @catatan,
          diterima_oleh = @diterima_oleh
        WHERE id_setoran = @id_setoran
      `);

    // Catat berat fisik aktual yang masuk ke gudang drop point
    if (Array.isArray(detailMaterial)) {
      for (const item of detailMaterial) {
        if (item.id_detail_setoran && item.beratMasukFisik !== undefined) {
          await transaction.request()
            .input('id_detail_setoran', sql.Int, item.id_detail_setoran)
            .input('berat_masuk', sql.Decimal(12, 3), item.beratMasukFisik)
            .query(`
              UPDATE t_detail_setoran
              SET berat_masuk_drop_point_kg = @berat_masuk
              WHERE id_detail_setoran = @id_detail_setoran
            `);
        }
      }
    }

    await transaction.commit();
    res.json({ status: 'success', message: `Material setoran berhasil diterima dengan status: ${statusTerima}` });
  } catch (err) {
    if (transaction) await transaction.rollback();
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ---------------------------------------------------------------------
// 6. GET /api/mutasi-kas (T08: Riwayat Mutasi Buku Kas)
// ---------------------------------------------------------------------
router.get('/mutasi-kas', async (req, res) => {
  try {
    const pool = await sql.connect();
    const result = await pool.request().query(`
      SELECT 
        k.id_mutasi_kas,
        k.pos_dana,
        k.jumlah_rupiah,
        k.id_penjualan,
        k.id_pencairan,
        k.metode,
        k.pihak_terkait,
        k.bukti,
        k.keterangan,
        k.persen_cadangan_snapshot,
        k.persen_komunitas_snapshot,
        FORMAT(k.waktu_transaksi, 'yyyy-MM-dd HH:mm:ss') AS waktu_transaksi,
        p.nama AS nama_pencatat
      FROM t_mutasi_kas k
      JOIN m_pengguna p ON k.dicatat_oleh = p.id_pengguna
      ORDER BY k.id_mutasi_kas DESC
    `);
    res.json({ status: 'success', data: result.recordset });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ---------------------------------------------------------------------
// 7. GET /api/mutasi-kas/ringkasan (T08: Ringkasan Saldo 3 Pos: 40/10/50)
// ---------------------------------------------------------------------
router.get('/mutasi-kas/ringkasan', async (req, res) => {
  try {
    const pool = await sql.connect();
    const result = await pool.request().query(`
      SELECT 
        ISNULL(SUM(jumlah_rupiah), 0) AS total_kas,
        ISNULL(SUM(CASE 
          WHEN pos_dana = 'CADANGAN_POIN' THEN jumlah_rupiah
          WHEN pos_dana = 'HASIL_PENJUALAN' THEN (jumlah_rupiah * (persen_cadangan_snapshot / 100.0))
          ELSE 0 END), 0) AS cadangan_poin,
        ISNULL(SUM(CASE 
          WHEN pos_dana = 'KOMUNITAS' THEN jumlah_rupiah
          WHEN pos_dana = 'HASIL_PENJUALAN' THEN (jumlah_rupiah * (persen_komunitas_snapshot / 100.0))
          ELSE 0 END), 0) AS komunitas,
        ISNULL(SUM(CASE 
          WHEN pos_dana = 'OPERASIONAL' THEN jumlah_rupiah
          WHEN pos_dana = 'HASIL_PENJUALAN' THEN (jumlah_rupiah * ((100.0 - persen_cadangan_snapshot - persen_komunitas_snapshot) / 100.0))
          ELSE 0 END), 0) AS operasional
      FROM t_mutasi_kas
    `);

    // Hitung total poin yang sedang diajukan pencairan tapi belum dibayar
    const pencairanDipesan = await pool.request().query(`
      SELECT ISNULL(SUM(jumlah_poin * nilai_rupiah_per_poin_snapshot), 0) AS cadangan_dipesan
      FROM t_pencairan_poin
      WHERE status IN ('DIAJUKAN', 'DIPROSES')
    `);

    const summary = result.recordset[0] || { total_kas: 0, cadangan_poin: 0, komunitas: 0, operasional: 0 };
    summary.cadangan_dipesan = pencairanDipesan.recordset[0]?.cadangan_dipesan || 0;

    res.json({ status: 'success', data: summary });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ---------------------------------------------------------------------
// 8. GET /api/penjualan/belum-lunas (Daftar Tagihan Mitra yang Siap Dilunasi)
// ---------------------------------------------------------------------
router.get('/penjualan/belum-lunas', async (req, res) => {
  try {
    const pool = await sql.connect();
    // Total tagihan dihitung dari SUM(berat_dikirim_kg * harga_per_kg_snapshot)
    const result = await pool.request().query(`
      SELECT 
        p.id_penjualan,
        m.nama_mitra,
        FORMAT(p.tanggal_penjualan, 'yyyy-MM-dd') AS tanggal_penjualan,
        ISNULL(SUM(dp.berat_dikirim_kg * dp.harga_per_kg_snapshot), 0) AS total_tagihan,
        p.status,
        0 AS sudah_lunas
      FROM t_penjualan p
      JOIN m_mitra m ON p.id_mitra = m.id_mitra
      LEFT JOIN t_detail_penjualan dp ON p.id_penjualan = dp.id_penjualan
      WHERE p.id_penjualan NOT IN (
        SELECT id_penjualan FROM t_mutasi_kas WHERE id_penjualan IS NOT NULL AND pos_dana = 'HASIL_PENJUALAN'
      )
      GROUP BY p.id_penjualan, m.nama_mitra, p.tanggal_penjualan, p.status
      ORDER BY p.id_penjualan DESC
    `);
    res.json({ status: 'success', data: result.recordset });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ---------------------------------------------------------------------
// 9. POST /api/mutasi-kas/penjualan (Pelunasan Penjualan Alokasi 40/10/50)
// ---------------------------------------------------------------------
router.post('/mutasi-kas/penjualan', async (req, res) => {
  try {
    const { id_penjualan, jumlah_rupiah, metode, bukti, keterangan, dicatat_oleh } = req.body;
    const pool = await sql.connect();

    // Sesuai constraint ck_kas_penerimaan:
    // pos_dana = 'HASIL_PENJUALAN', id_penjualan IS NOT NULL, jumlah_rupiah > 0,
    // persen_cadangan_snapshot = 40.0, persen_komunitas_snapshot = 10.0
    await pool.request()
      .input('pos_dana', sql.VarChar(20), 'HASIL_PENJUALAN')
      .input('jumlah_rupiah', sql.Decimal(18, 2), jumlah_rupiah)
      .input('id_penjualan', sql.Int, id_penjualan)
      .input('metode', sql.VarChar(20), metode || 'TRANSFER')
      .input('bukti', sql.NVarChar(255), bukti || 'https://placehold.co/bukti-transfer')
      .input('keterangan', sql.NVarChar(255), keterangan || `Pelunasan penjualan #PJL-${id_penjualan}`)
      .input('persen_cadangan', sql.Decimal(5, 2), 40.0)
      .input('persen_komunitas', sql.Decimal(5, 2), 10.0)
      .input('dicatat_oleh', sql.Int, dicatat_oleh || 1)
      .query(`
        INSERT INTO t_mutasi_kas
          (pos_dana, jumlah_rupiah, id_penjualan, id_pencairan, metode, pihak_terkait, bukti, keterangan, 
           persen_cadangan_snapshot, persen_komunitas_snapshot, waktu_transaksi, dicatat_oleh)
        VALUES
          (@pos_dana, @jumlah_rupiah, @id_penjualan, NULL, @metode, NULL, @bukti, @keterangan, 
           @persen_cadangan, @persen_komunitas, SYSUTCDATETIME(), @dicatat_oleh)
      `);

    res.json({ status: 'success', message: 'Pelunasan penjualan berhasil dicatat dan dialokasikan 40/10/50' });
  } catch (err) {
    console.error('Error Pelunasan Kas:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ---------------------------------------------------------------------
// 10. POST /api/mutasi-kas (Transaksi Mutasi Masuk/Keluar Umum)
// ---------------------------------------------------------------------
router.post('/mutasi-kas', async (req, res) => {
  try {
    const { pos_dana, jumlah_rupiah, metode, pihak_terkait, bukti, keterangan, dicatat_oleh } = req.body;
    const pool = await sql.connect();

    // Sesuai constraint ck_kas_komunitas:
    // Jika pos_dana = 'KOMUNITAS', jumlah_rupiah wajib negatif dan pihak_terkait wajib diisi
    let nominal = Number(jumlah_rupiah);
    if (pos_dana === 'KOMUNITAS' || pos_dana === 'OPERASIONAL') {
      nominal = -Math.abs(nominal);
    }

    const pihak = (pos_dana === 'KOMUNITAS' && !pihak_terkait) ? 'Komunitas Drop Point' : pihak_terkait;

    await pool.request()
      .input('pos_dana', sql.VarChar(20), pos_dana)
      .input('jumlah_rupiah', sql.Decimal(18, 2), nominal)
      .input('metode', sql.VarChar(20), metode || 'TRANSFER')
      .input('pihak_terkait', sql.NVarChar(150), pihak || null)
      .input('bukti', sql.NVarChar(255), bukti || 'https://placehold.co/bukti')
      .input('keterangan', sql.NVarChar(255), keterangan || null)
      .input('dicatat_oleh', sql.Int, dicatat_oleh || 1)
      .query(`
        INSERT INTO t_mutasi_kas
          (pos_dana, jumlah_rupiah, id_penjualan, id_pencairan, metode, pihak_terkait, bukti, keterangan, 
           persen_cadangan_snapshot, persen_komunitas_snapshot, waktu_transaksi, dicatat_oleh)
        VALUES
          (@pos_dana, @jumlah_rupiah, NULL, NULL, @metode, @pihak_terkait, @bukti, @keterangan, 
           NULL, NULL, SYSUTCDATETIME(), @dicatat_oleh)
      `);

    res.json({ status: 'success', message: 'Transaksi kas berhasil dicatat' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ---------------------------------------------------------------------
// 11. POST /api/penjualan (Penjualan Material ke Mitra Daur Ulang)
// ---------------------------------------------------------------------
router.post('/penjualan', async (req, res) => {
  const pool = await sql.connect();
  const transaction = new sql.Transaction(pool);

  try {
    const { id_mitra, id_drop_point, detailPenjualan, dibuat_oleh, catatan } = req.body;
    const pengelolaId = dibuat_oleh || 1;

    await transaction.begin();

    // Sesuai constraint ck_jual_kirim:
    // status 'DIKIRIM' wajib mengisi waktu_pengiriman NOT NULL
    const headerResult = await transaction.request()
      .input('id_drop_point', sql.Int, id_drop_point || 1)
      .input('id_mitra', sql.Int, id_mitra)
      .input('tanggal_penjualan', sql.Date, new Date())
      .input('status', sql.VarChar(10), 'DIKIRIM')
      .input('catatan', sql.NVarChar(500), catatan || 'Pengiriman material hasil timbangan drop point')
      .input('dibuat_oleh', sql.Int, pengelolaId)
      .query(`
        INSERT INTO t_penjualan 
          (id_drop_point, id_mitra, tanggal_penjualan, waktu_pengiriman, status, catatan, dibuat_oleh, dibuat_pada)
        OUTPUT INSERTED.id_penjualan
        VALUES 
          (@id_drop_point, @id_mitra, @tanggal_penjualan, SYSUTCDATETIME(), @status, @catatan, @dibuat_oleh, SYSUTCDATETIME())
      `);

    const newIdPenjualan = headerResult.recordset[0].id_penjualan;

    // Insert Item Detail Penjualan
    if (Array.isArray(detailPenjualan)) {
      for (const item of detailPenjualan) {
        await transaction.request()
          .input('id_penjualan', sql.Int, newIdPenjualan)
          .input('id_jenis_sampah', sql.Int, item.id_jenis_sampah)
          .input('berat_dikirim_kg', sql.Decimal(12, 3), item.berat_dikirim_kg)
          .input('harga_per_kg_snapshot', sql.Decimal(18, 2), item.harga_per_kg_snapshot)
          .query(`
            INSERT INTO t_detail_penjualan 
              (id_penjualan, id_jenis_sampah, berat_dikirim_kg, harga_per_kg_snapshot)
            VALUES 
              (@id_penjualan, @id_jenis_sampah, @berat_dikirim_kg, @harga_per_kg_snapshot)
          `);
      }
    }

    await transaction.commit();
    res.json({ 
      status: 'success', 
      message: 'Penjualan material berhasil dicatat', 
      id_penjualan: newIdPenjualan 
    });
  } catch (err) {
    if (transaction) await transaction.rollback();
    console.error('Error POST Penjualan:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;