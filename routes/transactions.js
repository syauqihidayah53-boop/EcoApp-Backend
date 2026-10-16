const u=require('../lib/api-utils');
const depositSelect=`SELECT s.*,p.nama AS nama_pengguna,dp.nama_drop_point,j.id_petugas,j.id_slot,j.status AS status_jemput,
    CASE WHEN j.id_penjemputan IS NULL THEN 'ANTAR' ELSE 'JEMPUT' END AS metode,
    COALESCE(j.potongan_persen_disepakati,0) AS potongan_persen,
    COALESCE(d.berat,0) AS total_berat_kg,
    CASE WHEN s.status=3 THEN COALESCE(d.poin,0)-floor(COALESCE(d.poin,0)*COALESCE(j.potongan_persen_disepakati,0)/100) ELSE 0 END AS total_poin
    FROM public.setoran s JOIN public.pengguna p ON p.id_pengguna=s.id_pengguna
    JOIN public.drop_point dp ON dp.id_drop_point=s.id_drop_point
    LEFT JOIN public.penjemputan j ON j.id_setoran=s.id_setoran AND j.aktif=1
    LEFT JOIN LATERAL(SELECT sum(berat_diterima_kg) AS berat,sum(floor(berat_diterima_kg*poin_per_kg_snapshot)) AS poin FROM public.detail_setoran WHERE id_setoran=s.id_setoran AND aktif=1)d ON true`;
const payoutSelect=`SELECT c.*,p.nama AS nama_pengguna,c.jumlah_poin*c.nilai_rupiah_per_poin_snapshot AS nominal_rupiah,k.bukti
    FROM public.pencairan_poin c JOIN public.pengguna p ON p.id_pengguna=c.id_pengguna
    LEFT JOIN public.mutasi_kas k ON k.id_pencairan=c.id_pencairan AND k.aktif=1`;
async function balance(c,id) {
    return (await c.query(`WITH earned AS (SELECT COALESCE(sum(total_poin),0) AS n FROM (${depositSelect} WHERE s.aktif=1 AND s.id_pengguna=$1) deposits),
        paid AS(SELECT COALESCE(sum(jumlah_poin) FILTER(WHERE status=3),0) AS paid,COALESCE(sum(jumlah_poin) FILTER(WHERE status IN(1,2)),0) AS pending FROM public.pencairan_poin WHERE id_pengguna=$1 AND aktif=1)
        SELECT earned.n AS masuk,paid.paid AS dicairkan,paid.pending AS dipesan,earned.n-paid.paid-paid.pending AS tersedia FROM earned,paid`,[id])).rows[0];
}
async function reserve(c) {
    return (await c.query(`SELECT
        COALESCE((SELECT sum(CASE WHEN pos_dana='HASIL_PENJUALAN' THEN round(jumlah_rupiah*persen_cadangan_snapshot/100,2) WHEN pos_dana='CADANGAN_POIN' THEN jumlah_rupiah ELSE 0 END) FROM public.mutasi_kas WHERE aktif=1),0) AS kas,
        COALESCE((SELECT sum(jumlah_poin*nilai_rupiah_per_poin_snapshot) FROM public.pencairan_poin WHERE aktif=1 AND status IN(1,2)),0) AS dipesan`)).rows[0];
}
const customer=a=>[1,2,3].includes(a.peran);
function key(value) { u.check(typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),'Kunci permintaan tidak valid. Muat ulang formulir.'); return value; }
function config(options) {
    const source=options.config||process.env;
    const rate=source.POIN_RUPIAH, minimum=source.MIN_PENCAIRAN_POIN, pickup=source.POTONGAN_JEMPUT_PERSEN;
    const ready=typeof rate==='string'&&/^\d{1,9}(\.\d{1,2})?$/.test(rate)&&Number(rate)>0&&/^\d{1,9}$/.test(minimum||'')&&Number(minimum)>0;
    return {pencairan_tersedia:!!ready,nilai_rupiah_per_poin:ready?rate:null,minimal_poin:ready?Number(minimum):null,
        potongan_jemput_persen:typeof pickup==='string'&&/^\d{1,3}(\.\d{1,2})?$/.test(pickup)&&Number(pickup)<=100?pickup:null};
}
module.exports=function(app,{pool,requireUser,admin,options}) {
    const route=(method,path,...handlers)=>app[method](path,requireUser,...handlers);
    route('get','/api/layanan',u.wrap(async(req,res)=>u.ok(res,config(options))));
    for(const[path,sql] of [
        ['mitra','SELECT * FROM public.mitra WHERE aktif=1 AND is_deleted=0 ORDER BY nama_mitra'],
        ['drop-points','SELECT * FROM public.drop_point WHERE aktif=1 AND is_deleted=0 ORDER BY nama_drop_point'],
        ['jenis-sampah','SELECT * FROM public.jenis_sampah WHERE aktif=1 AND is_deleted=0 ORDER BY id_jenis_sampah'],
        ['slot-jemput',`SELECT s.*,s.kapasitas-(SELECT count(*) FROM public.penjemputan j WHERE j.id_slot=s.id_slot AND j.aktif=1 AND j.status NOT IN('DIBATALKAN','GAGAL')) AS tersisa FROM public.slot_jemput s WHERE s.aktif=1 AND s.mulai_pada>now() ORDER BY s.mulai_pada`]
    ])route('get',`/api/${path}`,u.wrap(async(req,res)=>u.ok(res,(await pool.query(sql)).rows)));
    route('post','/api/slot-jemput',admin,u.wrap(async(req,res)=>{
        const b=req.body;u.fields(b,['mulai_pada','selesai_pada','kapasitas']);
        const start=new Date(b.mulai_pada),end=new Date(b.selesai_pada),capacity=u.id(b.kapasitas,'Kapasitas');
        u.check(Number.isFinite(start.getTime())&&Number.isFinite(end.getTime())&&start>new Date()&&end>start,'Waktu slot harus di masa depan dan selesai setelah mulai.');
        const r=await u.write(pool,req.actor,c=>c.query('INSERT INTO public.slot_jemput(mulai_pada,selesai_pada,kapasitas,dibuat_oleh) VALUES($1,$2,$3,$4) RETURNING *',[start,end,capacity,req.actor.id_pengguna]));u.ok(res,r.rows[0],201);
    }));
    route('patch','/api/slot-jemput/:id/status',admin,u.wrap(async(req,res)=>{
        u.fields(req.body,['aktif']);u.check(req.body.aktif===0||req.body.aktif===1,'Status tidak valid.');
        const r=await u.write(pool,req.actor,async c=>{
            const found=await c.query('SELECT * FROM public.slot_jemput WHERE id_slot=$1 FOR UPDATE',[u.id(req.params.id)]);u.check(found.rows.length,'Slot tidak ditemukan.',404);
            if(req.body.aktif===0)u.check(!(await c.query("SELECT 1 FROM public.penjemputan WHERE id_slot=$1 AND status NOT IN('DIBATALKAN','GAGAL')",[found.rows[0].id_slot])).rows.length,'Slot sedang digunakan.',409);
            return c.query('UPDATE public.slot_jemput SET aktif=$1 WHERE id_slot=$2 RETURNING *',[req.body.aktif,found.rows[0].id_slot]);
        });u.ok(res,r.rows[0]);
    }));
    route('get','/api/dashboard-mitra/:id',u.wrap(async(req,res)=>{
        const id=u.id(req.params.id);u.check(req.actor.peran===4||req.actor.peran===5&&req.actor.id_mitra===id,'Organisasi mitra bukan milik Anda.',403);
        const m=(await pool.query('SELECT * FROM public.mitra WHERE id_mitra=$1 AND is_deleted=0',[id])).rows[0];u.check(m,'Mitra tidak ditemukan.',404);
        const tasks=(await pool.query(`SELECT j.*,s.id_pengguna,p.nama AS nama_pelanggan,s.id_drop_point FROM public.penjemputan j JOIN public.setoran s ON s.id_setoran=j.id_setoran JOIN public.pengguna a ON a.id_pengguna=j.id_petugas JOIN public.pengguna p ON p.id_pengguna=s.id_pengguna WHERE a.id_mitra=$1 AND j.aktif=1 AND j.status NOT IN('DIBATALKAN','GAGAL') ORDER BY j.id_penjemputan DESC`,[id])).rows;
        const sales=(await pool.query(`SELECT count(*)::int AS n,COALESCE(sum(d.berat_diterima_kg),0) AS kg,COALESCE(sum(d.berat_diterima_kg*d.harga_per_kg_snapshot),0) AS amount FROM public.penjualan s JOIN public.detail_penjualan d ON d.id_penjualan=s.id_penjualan AND d.aktif=1 WHERE s.id_mitra=$1 AND s.aktif=1 AND s.status IN('DITERIMA','SELESAI')`,[id])).rows[0];
        const mats=(await pool.query(`SELECT j.nama_jenis,sum(d.berat_diterima_kg) AS kg FROM public.penjualan s JOIN public.detail_penjualan d ON d.id_penjualan=s.id_penjualan AND d.aktif=1 JOIN public.jenis_sampah j ON j.id_jenis_sampah=d.id_jenis_sampah WHERE s.id_mitra=$1 AND s.aktif=1 AND s.status IN('DITERIMA','SELESAI') GROUP BY j.nama_jenis`,[id])).rows;
        u.ok(res,{profil_mitra:m,statistik:{total_pembelian_rp:Number(sales.amount),total_berat_kg:Number(sales.kg),total_transaksi:sales.n,jumlah_tugas_aktif:tasks.filter(t=>['DIAJUKAN','DIJADWALKAN','DALAM_PERJALANAN'].includes(t.status)).length,jumlah_tugas_selesai:tasks.filter(t=>t.status==='SELESAI').length},material_kg:Object.fromEntries(['Plastik','Kardus','Kaca','Logam'].map(n=>[n.toLowerCase(),Number(mats.find(x=>x.nama_jenis===n)?.kg||0)])),tugas_aktif:tasks.filter(t=>t.status!=='SELESAI'),jenis_sampah:(await pool.query('SELECT id_jenis_sampah,nama_jenis,poin_per_kg FROM public.jenis_sampah WHERE aktif=1 AND is_deleted=0')).rows});
    }));
    route('get','/api/setoran',u.wrap(async(req,res)=>{
        u.ok(res,(await pool.query(`${depositSelect} WHERE s.aktif=1 AND ($1=4 OR ($1 IN(1,2,3) AND s.id_pengguna=$2) OR ($1=5 AND j.id_petugas=$2)) ORDER BY s.id_setoran DESC`,[req.actor.peran,req.actor.id_pengguna])).rows);
    }));
    route('get','/api/setoran/riwayat/:id',u.wrap(async(req,res)=>{
        const id=u.id(req.params.id);u.check(req.actor.peran===4||(customer(req.actor)&&req.actor.id_pengguna===id),'Riwayat ini bukan milik Anda.',403);
        u.ok(res,(await pool.query(`${depositSelect} WHERE s.aktif=1 AND s.id_pengguna=$1 ORDER BY s.id_setoran DESC`,[id])).rows);
    }));
    route('get','/api/setoran/:id',u.wrap(async(req,res)=>{
        const r=(await pool.query(`${depositSelect} WHERE s.id_setoran=$1 AND s.aktif=1`,[u.id(req.params.id)])).rows[0];u.check(r,'Setoran tidak ditemukan.',404);
        u.check(req.actor.peran===4||(customer(req.actor)&&r.id_pengguna===req.actor.id_pengguna)||(req.actor.peran===5&&r.id_petugas===req.actor.id_pengguna),'Setoran bukan tanggung jawab Anda.',403);
        r.detail=(await pool.query(`SELECT d.*,j.nama_jenis FROM public.detail_setoran d JOIN public.jenis_sampah j ON j.id_jenis_sampah=d.id_jenis_sampah WHERE d.id_setoran=$1 AND d.aktif=1 ORDER BY d.id_jenis_sampah`,[r.id_setoran])).rows;
        u.ok(res,r);
    }));
    route('post','/api/setoran',u.wrap(async(req,res)=>{
        const b=req.body;u.fields(b,['id_pengguna','id_drop_point','metode','id_slot','alamat_jemput','petunjuk_lokasi','catatan_perkiraan','request_key']);
        const pickup=b.metode==='JEMPUT';u.check(pickup||b.metode==='ANTAR'||b.metode===undefined,'Metode setoran tidak valid.');
        u.check(pickup?customer(req.actor):req.actor.peran===4,pickup?'Penjemputan diajukan pelanggan.':'Antar sendiri dicatat pengelola saat pelanggan datang.',403);
        const owner=pickup?req.actor.id_pengguna:u.id(b.id_pengguna),dp=u.id(b.id_drop_point),requestKey=key(b.request_key),cfg=config(options);
        const result=await u.write(pool,req.actor,async c=>{
            const existing=(await c.query('SELECT * FROM public.setoran WHERE request_key=$1',[requestKey])).rows[0];
            if(existing){u.check(existing.dibuat_oleh===req.actor.id_pengguna,'Kunci permintaan sudah dipakai.',409);return existing;}
            u.check((await c.query('SELECT 1 FROM public.pengguna WHERE id_pengguna=$1 AND peran IN(1,2,3) AND aktif=1 AND is_deleted=0 FOR SHARE',[owner])).rows.length,'Pelanggan aktif tidak ditemukan.');
            u.check((await c.query('SELECT 1 FROM public.drop_point WHERE id_drop_point=$1 AND aktif=1 AND is_deleted=0 FOR SHARE',[dp])).rows.length,'Drop point aktif tidak ditemukan.');
            let slot,address,hint,note;
            if(pickup){
                u.check(cfg.potongan_jemput_persen!==null,'Potongan layanan jemput belum ditetapkan pengelola.',409);
                slot=u.id(b.id_slot);address=u.text(b.alamat_jemput,'Alamat jemput',255,true);hint=u.text(b.petunjuk_lokasi,'Petunjuk lokasi',225,true);note=u.text(b.catatan_perkiraan,'Perkiraan material',500);
                const r=(await c.query('SELECT * FROM public.slot_jemput WHERE id_slot=$1 AND aktif=1 AND mulai_pada>now() FOR UPDATE',[slot])).rows[0];u.check(r,'Slot sudah tidak tersedia.',409);
                const used=(await c.query("SELECT count(*)::int AS n FROM public.penjemputan WHERE id_slot=$1 AND aktif=1 AND status NOT IN('DIBATALKAN','GAGAL')",[slot])).rows[0].n;u.check(used<r.kapasitas,'Slot sudah penuh.',409);
            }
            const r=(await c.query('INSERT INTO public.setoran(id_pengguna,id_drop_point,status,status_drop_point,dibuat_oleh,request_key) VALUES($1,$2,1,1,$3,$4) RETURNING *',[owner,dp,req.actor.id_pengguna,requestKey])).rows[0];
            if(pickup)await c.query(`INSERT INTO public.penjemputan(id_setoran,id_slot,alamat_jemput,petunjuk_lokasi,catatan_perkiraan,potongan_persen_disepakati,status,dibuat_oleh) VALUES($1,$2,$3,$4,$5,$6,'DIAJUKAN',$7)`,[r.id_setoran,slot,address,hint,note,cfg.potongan_jemput_persen,req.actor.id_pengguna]);
            return r;
        });u.ok(res,result,201);
    }));
    route('patch','/api/setoran/:id/batalkan',u.wrap(async(req,res)=>{
        const result=await u.write(pool,req.actor,async c=>{
            const s=(await c.query('SELECT * FROM public.setoran WHERE id_setoran=$1 AND aktif=1 FOR UPDATE',[u.id(req.params.id)])).rows[0];u.check(s,'Setoran tidak ditemukan.',404);
            const j=(await c.query('SELECT * FROM public.penjemputan WHERE id_setoran=$1',[s.id_setoran])).rows[0];
            u.check(req.actor.peran===4||(customer(req.actor)&&s.id_pengguna===req.actor.id_pengguna&&j),'Tidak boleh membatalkan setoran ini.',403);
            if(s.status===5)return s;
            u.check(s.status===1&&(!j||['DIAJUKAN','DIJADWALKAN','GAGAL'].includes(j.status)),'Setoran sudah diproses; pembatalan ditolak.',409);
            await c.query("UPDATE public.penjemputan SET status='DIBATALKAN' WHERE id_setoran=$1",[s.id_setoran]);
            return(await c.query('UPDATE public.setoran SET status=5 WHERE id_setoran=$1 RETURNING *',[s.id_setoran])).rows[0];
        });u.ok(res,result);
    }));
    // Supporting handoff for T01: only assigned partner may submit pickup weighing.
    route('patch','/api/setoran/:id/tugaskan',admin,u.wrap(async(req,res)=>{
        const r=await u.write(pool,req.actor,async c=>{
            const id=u.id(req.params.id),petugas=u.id(req.body?.id_petugas);
            u.check((await c.query('SELECT 1 FROM public.pengguna p JOIN public.mitra m ON m.id_mitra=p.id_mitra WHERE p.id_pengguna=$1 AND p.peran=5 AND p.aktif=1 AND p.is_deleted=0 AND m.aktif=1 AND m.is_deleted=0',[petugas])).rows.length,'Petugas mitra tidak aktif.');
            const r=await c.query(`UPDATE public.penjemputan j SET id_petugas=$1,status='DIJADWALKAN' FROM public.setoran s WHERE s.id_setoran=j.id_setoran AND s.id_setoran=$2 AND s.status=1 AND j.status IN('DIAJUKAN','DIJADWALKAN') RETURNING j.*`,[petugas,id]);u.check(r.rows.length,'Setoran tidak dapat ditugaskan.',409);return r.rows[0];
        });u.ok(res,r);
    }));
    route('put','/api/setoran/:id/timbang',u.wrap(async(req,res)=>{
        const b=req.body;u.fields(b,['foto_bukti','detail']);const bukti=u.proof(b.foto_bukti);
        u.check(Array.isArray(b.detail)&&b.detail.length>0&&b.detail.length<=4,'Isi satu sampai empat jenis material.');
        const details=b.detail.map(d=>{u.fields(d,['id_jenis_sampah','berat_diterima_kg','berat_ditolak_kg','alasan_penolakan']);const accepted=u.decimal(d.berat_diterima_kg,'Berat diterima'),rejected=u.decimal(d.berat_ditolak_kg,'Berat ditolak');u.check(Number(accepted)+Number(rejected)>0,'Berat total harus lebih dari nol.');return {id:u.id(d.id_jenis_sampah),accepted,rejected,reason:u.text(d.alasan_penolakan,'Alasan penolakan',255,Number(rejected)>0)};});
        u.check(new Set(details.map(d=>d.id)).size===details.length,'Jenis material tidak boleh berulang.');
        const r=await u.write(pool,req.actor,async c=>{
            const id=u.id(req.params.id),s=(await c.query('SELECT * FROM public.setoran WHERE id_setoran=$1 AND aktif=1 FOR UPDATE',[id])).rows[0];u.check(s,'Setoran tidak ditemukan.',404);u.check([1,2].includes(s.status),'Hasil timbang sudah dikunci.',409);
            const j=(await c.query('SELECT * FROM public.penjemputan WHERE id_setoran=$1',[id])).rows[0];
            u.check(j?req.actor.peran===5&&j.id_petugas===req.actor.id_pengguna&&['DIJADWALKAN','DALAM_PERJALANAN','SELESAI'].includes(j.status):req.actor.peran===4,'Anda tidak ditugaskan menimbang setoran ini.',403);
            const old=(await c.query('SELECT id_jenis_sampah,poin_per_kg_snapshot FROM public.detail_setoran WHERE id_setoran=$1',[id])).rows;
            // Replace details only while still awaiting finalization; snapshots for existing types are retained.
            const rows=[];for(const d of details){const material=(await c.query('SELECT * FROM public.jenis_sampah WHERE id_jenis_sampah=$1 AND aktif=1 AND is_deleted=0 FOR SHARE',[d.id])).rows[0];u.check(material,'Jenis material tidak aktif.');rows.push({...d,rate:old.find(x=>x.id_jenis_sampah===d.id)?.poin_per_kg_snapshot??material.poin_per_kg});}
            await c.query('DELETE FROM public.detail_setoran WHERE id_setoran=$1',[id]);
            for(const d of rows)await c.query(`INSERT INTO public.detail_setoran(id_setoran,id_jenis_sampah,berat_diterima_kg,berat_ditolak_kg,alasan_penolakan,poin_per_kg_snapshot,dibuat_oleh) VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,d.id,d.accepted,d.rejected,d.reason,d.rate,req.actor.id_pengguna]);
            if(j)await c.query("UPDATE public.penjemputan SET status='SELESAI',waktu_pengambilan=COALESCE(waktu_pengambilan,now()) WHERE id_setoran=$1",[id]);
            return(await c.query('UPDATE public.setoran SET status=2,ditimbang_oleh=$1,waktu_timbang=now(),foto_bukti=$2 WHERE id_setoran=$3 RETURNING *',[req.actor.id_pengguna,bukti,id])).rows[0];
        });u.ok(res,r);
    }));
    route('patch','/api/setoran/:id/verifikasi',admin,u.wrap(async(req,res)=>{
        const approve=req.body?.aksi==='FINAL';u.check(approve||req.body?.aksi==='TOLAK','Aksi verifikasi tidak valid.');const note=u.text(req.body?.catatan,'Catatan verifikasi',500,!approve);
        const r=await u.write(pool,req.actor,async c=>{
            const id=u.id(req.params.id),s=(await c.query('SELECT * FROM public.setoran WHERE id_setoran=$1 AND aktif=1 FOR UPDATE',[id])).rows[0];u.check(s,'Setoran tidak ditemukan.',404);
            if(s.status===(approve?3:4))return s;u.check(s.status===2,'Setoran belum menunggu verifikasi.',409);
            if(approve)u.check(Number((await c.query('SELECT COALESCE(sum(berat_diterima_kg),0) AS n FROM public.detail_setoran WHERE id_setoran=$1 AND aktif=1',[id])).rows[0].n)>0,'Semua material ditolak; gunakan Tolak.',409);
            return(await c.query('UPDATE public.setoran SET status=$1,diverifikasi_oleh=$2,waktu_verifikasi=now(),catatan_verifikasi=$3 WHERE id_setoran=$4 RETURNING *',[approve?3:4,req.actor.id_pengguna,note,id])).rows[0];
        });u.ok(res,r);
    }));
    route('get','/api/pencairan',u.wrap(async(req,res)=>{
        u.check(req.actor.peran===4||customer(req.actor),'Mitra tidak mengakses pencairan.',403);
        u.ok(res,(await pool.query(`${payoutSelect} WHERE c.aktif=1 AND ($1=4 OR c.id_pengguna=$2) ORDER BY c.id_pencairan DESC`,[req.actor.peran,req.actor.id_pengguna])).rows);
    }));
    route('get','/api/pencairan/riwayat/:id',u.wrap(async(req,res)=>{
        const id=u.id(req.params.id);u.check(req.actor.peran===4||(customer(req.actor)&&req.actor.id_pengguna===id),'Riwayat ini bukan milik Anda.',403);
        u.ok(res,(await pool.query(`${payoutSelect} WHERE c.aktif=1 AND c.id_pengguna=$1 ORDER BY c.id_pencairan DESC`,[id])).rows);
    }));
    route('get','/api/pencairan/saldo',u.wrap(async(req,res)=>{
        u.check(customer(req.actor),'Saldo pribadi hanya untuk pelanggan.',403);u.ok(res,{...await balance(pool,req.actor.id_pengguna),...config(options)});
    }));
    route('post','/api/pencairan',u.wrap(async(req,res)=>{
        u.check(customer(req.actor),'Hanya pelanggan dapat mengajukan pencairan.',403);const b=req.body;u.fields(b,['jumlah_poin','nama_bank','nomor_rekening','nama_pemilik_rekening','request_key']);
        const points=u.id(b.jumlah_poin,'Jumlah poin'),bank=u.text(b.nama_bank,'Bank',50,true),number=u.text(b.nomor_rekening,'Nomor rekening',30,true),name=u.text(b.nama_pemilik_rekening,'Pemilik rekening',100,true),requestKey=key(b.request_key);
        u.check(/^\d{5,30}$/.test(number),'Nomor rekening harus 5–30 digit.');
        const r=await u.write(pool,req.actor,async c=>{
            const existing=(await c.query('SELECT * FROM public.pencairan_poin WHERE request_key=$1',[requestKey])).rows[0];if(existing){u.check(existing.id_pengguna===req.actor.id_pengguna,'Kunci permintaan sudah dipakai.',409);return existing;}
            const cfg=config(options);u.check(cfg.pencairan_tersedia,'Nilai konversi dan minimum pencairan belum ditetapkan.',409);u.check(points>=cfg.minimal_poin,'Jumlah poin kurang dari minimum pencairan.');
            const bal=await balance(c,req.actor.id_pengguna);u.check(BigInt(bal.tersedia)>=BigInt(points),'Saldo poin tidak cukup.',409);
            const funds=await reserve(c);const enough=(await c.query('SELECT $1::numeric-$2::numeric >= $3::numeric*$4::numeric AS ok',[funds.kas,funds.dipesan,points,cfg.nilai_rupiah_per_poin])).rows[0].ok;u.check(enough,'Dana cadangan yang tersedia belum mencukupi.',409);
            return(await c.query(`INSERT INTO public.pencairan_poin(id_pengguna,jumlah_poin,nilai_rupiah_per_poin_snapshot,nama_bank,nomor_rekening,nama_pemilik_rekening,status,dibuat_oleh,request_key) VALUES($1,$2,$3,$4,$5,$6,1,$1,$7) RETURNING *`,[req.actor.id_pengguna,points,cfg.nilai_rupiah_per_poin,bank,number,name,requestKey])).rows[0];
        });u.ok(res,r,201);
    }));
    route('patch','/api/pencairan/:id/status',u.wrap(async(req,res)=>{
        const b=req.body;u.fields(b,['aksi','alasan','bukti','konfirmasi_transfer','konfirmasi_belum_transfer']);const status={PROSES:2,BAYAR:3,TOLAK:4,BATAL:5}[b.aksi];u.check(status,'Aksi tidak valid.');
        const r=await u.write(pool,req.actor,async c=>{
            const id=u.id(req.params.id),p=(await c.query('SELECT * FROM public.pencairan_poin WHERE id_pencairan=$1 AND aktif=1 FOR UPDATE',[id])).rows[0];u.check(p,'Pencairan tidak ditemukan.',404);
            const isAdmin=req.actor.peran===4;u.check(isAdmin||(customer(req.actor)&&p.id_pengguna===req.actor.id_pengguna&&status===5),'Tidak memiliki izin.',403);
            if(p.status===status)return p;
            u.check(status===2?p.status===1:status===3?p.status===2:status===5?p.status===1:[1,2].includes(p.status),'Status pencairan tidak dapat diubah dengan aksi ini.',409);
            if(status===4&&p.status===2)u.check(b.konfirmasi_belum_transfer===true,'Pastikan transfer belum dilakukan sebelum menolak.',409);
            const reason=status===4?u.text(b.alasan,'Alasan penolakan',255,true):null;
            if(status===3){
                u.check(b.konfirmasi_transfer===true,'Konfirmasi transfer manual wajib dicentang.');const proof=u.proof(b.bukti);
                const funds=await reserve(c);u.check((await c.query('SELECT $1::numeric >= $2::numeric AS ok',[funds.kas,funds.dipesan])).rows[0].ok,'Saldo cadangan tidak mencukupi seluruh pencairan aktif.',409);
                await c.query(`INSERT INTO public.mutasi_kas(pos_dana,jumlah_rupiah,id_pencairan,metode,bukti,waktu_transaksi,dibuat_oleh) VALUES('CADANGAN_POIN',-($1::numeric*$2::numeric),$3,'TRANSFER',$4,now(),$5)`,[p.jumlah_poin,p.nilai_rupiah_per_poin_snapshot,id,proof,req.actor.id_pengguna]);
            }
            return(await c.query('UPDATE public.pencairan_poin SET status=$1,alasan_penolakan=$2,diproses_oleh=$3,diproses_pada=now() WHERE id_pencairan=$4 RETURNING *',[status,reason,req.actor.id_pengguna,id])).rows[0];
        });u.ok(res,r);
    }));
    route('get','/api/kas/cadangan',admin,u.wrap(async(req,res)=>u.ok(res,await reserve(pool))));
    route('post','/api/kas/cadangan',admin,u.wrap(async(req,res)=>{
        const b=req.body;u.fields(b,['jumlah_rupiah','pihak_terkait','keterangan','bukti','konfirmasi','request_key']);u.check(b.konfirmasi===true,'Konfirmasi penerimaan dana nyata terlebih dahulu.');const requestKey=key(b.request_key);
        const amount=u.decimal(b.jumlah_rupiah,'Dana masuk',999999999,2);u.check(Number(amount)>0,'Dana harus lebih dari nol.');
        const values=[amount,u.text(b.pihak_terkait,'Sumber dana',150,true),u.text(b.keterangan,'Keterangan',255,true),u.proof(b.bukti),req.actor.id_pengguna];
        const r=await u.write(pool,req.actor,async c=>{
            const existing=(await c.query('SELECT * FROM public.mutasi_kas WHERE request_key=$1',[requestKey])).rows[0];
            if(existing){u.check(existing.dibuat_oleh===req.actor.id_pengguna,'Kunci permintaan sudah digunakan.',409);return existing;}
            return(await c.query(`INSERT INTO public.mutasi_kas(pos_dana,jumlah_rupiah,metode,pihak_terkait,keterangan,bukti,waktu_transaksi,dibuat_oleh,request_key) VALUES('CADANGAN_POIN',$1,'TRANSFER',$2,$3,$4,now(),$5,$6) RETURNING *`,[...values,requestKey])).rows[0];
        });u.ok(res,r,201);
    }));
    route('get','/api/dashboard/:id',u.wrap(async(req,res)=>{
        const id=u.id(req.params.id);u.check(req.actor.id_pengguna===id||req.actor.peran===4,'Dashboard ini bukan milik Anda.',403);
        const p=(await pool.query('SELECT * FROM public.pengguna WHERE id_pengguna=$1 AND aktif=1 AND is_deleted=0',[id])).rows[0];u.check(p,'Pengguna tidak ditemukan.',404);
        const bal=await balance(pool,id),cfg=config(options);
        const totals=(await pool.query(`SELECT count(*)::int AS n,COALESCE(sum(total_berat_kg),0) AS kg FROM (${depositSelect} WHERE s.id_pengguna=$1 AND s.aktif=1 AND s.status=3)d`,[id])).rows[0];
        const mats=(await pool.query(`SELECT j.nama_jenis,COALESCE(sum(d.berat_diterima_kg),0) AS kg FROM public.detail_setoran d JOIN public.setoran s ON s.id_setoran=d.id_setoran JOIN public.jenis_sampah j ON j.id_jenis_sampah=d.id_jenis_sampah WHERE s.id_pengguna=$1 AND s.status=3 AND s.aktif=1 AND d.aktif=1 GROUP BY j.nama_jenis`,[id])).rows;
        u.ok(res,{profil:u.publicUser(p),saldo_poin_aktif:Number(bal.tersedia),poin_diproses:Number(bal.dipesan),total_poin_masuk:Number(bal.masuk),total_poin_dicairkan:Number(bal.dicairkan),nominal_rupiah:cfg.pencairan_tersedia?Number(bal.tersedia)*Number(cfg.nilai_rupiah_per_poin):null,total_berat_kg:Number(totals.kg),total_transaksi:totals.n,jumlah_drop_point:(await pool.query('SELECT count(*)::int AS n FROM public.drop_point WHERE aktif=1 AND is_deleted=0')).rows[0].n,material_kg:Object.fromEntries(['Plastik','Kardus','Kaca','Logam'].map(n=>[n.toLowerCase(),Number(mats.find(x=>x.nama_jenis===n)?.kg||0)])),jemputan_berikutnya:null});
    }));
    route('get','/api/ringkasan/pengelola',admin,u.wrap(async(req,res)=>{
        u.ok(res,{cadangan:await reserve(pool),setoran_menunggu:(await pool.query('SELECT count(*)::int AS n FROM public.setoran WHERE aktif=1 AND status=2')).rows[0].n,pencairan_menunggu:(await pool.query('SELECT count(*)::int AS n FROM public.pencairan_poin WHERE aktif=1 AND status IN(1,2)')).rows[0].n,pengguna:(await pool.query('SELECT count(*)::int AS n FROM public.pengguna WHERE aktif=1 AND is_deleted=0')).rows[0].n});
    }));
};
module.exports.balance=balance;
module.exports.reserve=reserve;
