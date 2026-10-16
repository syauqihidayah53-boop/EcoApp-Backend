const u=require('../lib/api-utils');
const {reserve}=require('./transactions');
const uuid=x=>{u.check(typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x),'Kunci permintaan tidak valid.');return x;};
const integer=x=>u.id(x);
module.exports=function(app,{pool,requireUser,admin,options}){
 const route=(method,path,...handlers)=>app[method](path,requireUser,...handlers);
 route('get','/api/setoran/detail/:id',admin,u.wrap(async(req,res)=>{
  const id=integer(req.params.id),s=(await pool.query('SELECT * FROM public.setoran WHERE id_setoran=$1 AND aktif=1',[id])).rows[0];u.check(s,'Setoran tidak ditemukan.',404);
  const rows=(await pool.query('SELECT * FROM public.detail_setoran WHERE id_setoran=$1 AND aktif=1 ORDER BY id_detail_setoran',[id])).rows;
  u.ok(res,{...s,detailMaterial:rows.map(d=>({...d,beratDiterimaAwal:Number(d.berat_diterima_kg||0),beratMasukFisik:d.berat_masuk_drop_point_kg===null?null:Number(d.berat_masuk_drop_point_kg)}))});
 }));
 route('put','/api/setoran/terima/:id',admin,u.wrap(async(req,res)=>{
  const b=req.body;u.fields(b,['status_terima_drop_point','catatan_serah_terima','detailMaterial']);
  u.check(['SELISIH','DITERIMA'].includes(b.status_terima_drop_point),'Status penerimaan tidak valid.');
  u.check(Array.isArray(b.detailMaterial)&&b.detailMaterial.length>0,'Rincian material wajib diisi.');
  const note=u.text(b.catatan_serah_terima,'Catatan penerimaan',500,b.status_terima_drop_point==='SELISIH');
  const rows=b.detailMaterial.map(d=>({id:integer(d.id_detail_setoran),kg:u.decimal(d.beratMasukFisik,'Berat masuk',999999999,3)}));
  u.check(new Set(rows.map(r=>r.id)).size===rows.length,'Rincian material berulang.');
  const result=await u.write(pool,req.actor,async c=>{
   const id=integer(req.params.id),s=(await c.query('SELECT * FROM public.setoran WHERE id_setoran=$1 AND aktif=1 FOR UPDATE',[id])).rows[0];u.check(s&&[2,3].includes(s.status),'Setoran belum ditimbang atau tidak ada.',409);
   u.check(s.status_drop_point===1||s.status_drop_point===2,'Penerimaan sudah dikunci.',409);
   const old=(await c.query('SELECT * FROM public.detail_setoran WHERE id_setoran=$1 AND aktif=1',[id])).rows;
   u.check(old.length===rows.length&&old.every(d=>rows.some(r=>r.id===d.id_detail_setoran)),'Rincian setoran tidak cocok.',409);
   const diff=old.some(d=>Number(rows.find(r=>r.id===d.id_detail_setoran).kg)!==Number(d.berat_diterima_kg));
   u.check((b.status_terima_drop_point==='SELISIH')===diff,'Status harus sesuai selisih timbang fisik.',409);
   for(const d of rows)await c.query('UPDATE public.detail_setoran SET berat_masuk_drop_point_kg=$1 WHERE id_detail_setoran=$2',[d.kg,d.id]);
   return(await c.query('UPDATE public.setoran SET status_drop_point=$1,catatan_serah_terima=$2,waktu_terima_drop_point=now(),diterima_oleh=$3 WHERE id_setoran=$4 RETURNING *',[diff?2:3,note,req.actor.id_pengguna,id])).rows[0];
  });u.ok(res,result);
 }));
 route('put','/api/setoran/verifikasi/:id',admin,u.wrap(async(req,res)=>{
  const b=req.body;u.fields(b,['diverifikasi_oleh','catatan_verifikasi','detailVerifikasi']);u.check(Array.isArray(b.detailVerifikasi)&&b.detailVerifikasi.length>0,'Rincian verifikasi wajib diisi.');
  const details=b.detailVerifikasi.map(d=>({id:integer(d.id_detail_setoran),accepted:u.decimal(d.berat_diterima_kg,'Berat diterima',999999999,3),rejected:u.decimal(d.berat_ditolak_kg,'Berat ditolak',999999999,3),reason:u.text(d.alasan_penolakan,'Alasan penolakan',255,Number(d.berat_ditolak_kg)>0)}));
  u.check(new Set(details.map(d=>d.id)).size===details.length,'Rincian berulang.');
  const result=await u.write(pool,req.actor,async c=>{
   const id=integer(req.params.id),s=(await c.query('SELECT * FROM public.setoran WHERE id_setoran=$1 AND aktif=1 FOR UPDATE',[id])).rows[0];u.check(s&&s.status===2,'Setoran tidak menunggu verifikasi.',409);
   const old=(await c.query('SELECT * FROM public.detail_setoran WHERE id_setoran=$1 AND aktif=1',[id])).rows;u.check(old.length===details.length&&old.every(d=>details.some(r=>r.id===d.id_detail_setoran)),'Rincian tidak cocok.',409);
   for(const d of details){u.check(Number(d.accepted)+Number(d.rejected)>0,'Berat total harus positif.');await c.query('UPDATE public.detail_setoran SET berat_diterima_kg=$1,berat_ditolak_kg=$2,alasan_penolakan=$3 WHERE id_detail_setoran=$4',[d.accepted,d.rejected,d.reason,d.id]);}
   const final=details.some(d=>Number(d.accepted)>0),note=u.text(b.catatan_verifikasi,'Catatan',500,!final);
   return(await c.query('UPDATE public.setoran SET status=$1,catatan_verifikasi=$2,diverifikasi_oleh=$3,waktu_verifikasi=now() WHERE id_setoran=$4 RETURNING *',[final?3:4,note,req.actor.id_pengguna,id])).rows[0];
  });u.ok(res,result);
 }));
 const saleSql=`SELECT s.*,m.nama_mitra,dp.nama_drop_point,COALESCE((SELECT sum(d.berat_diterima_kg*d.harga_per_kg_snapshot) FROM public.detail_penjualan d WHERE d.id_penjualan=s.id_penjualan AND d.aktif=1),0) AS total_tagihan FROM public.penjualan s JOIN public.mitra m ON m.id_mitra=s.id_mitra JOIN public.drop_point dp ON dp.id_drop_point=s.id_drop_point`;
 route('get','/api/penjualan',u.wrap(async(req,res)=>u.ok(res,(await pool.query(`${saleSql} WHERE s.aktif=1 AND ($1=4 OR ($1=5 AND s.id_mitra=$2)) ORDER BY s.id_penjualan DESC`,[req.actor.peran,req.actor.id_mitra])).rows)));
 route('get','/api/penjualan/belum-lunas',admin,u.wrap(async(req,res)=>u.ok(res,(await pool.query(`${saleSql} WHERE s.aktif=1 AND s.status='DITERIMA' AND NOT EXISTS(SELECT 1 FROM public.mutasi_kas k WHERE k.id_penjualan=s.id_penjualan AND k.aktif=1) ORDER BY s.id_penjualan DESC`)).rows)));
 route('get','/api/penjualan/:id',u.wrap(async(req,res)=>{
  const s=(await pool.query(`${saleSql} WHERE s.id_penjualan=$1 AND s.aktif=1`,[integer(req.params.id)])).rows[0];u.check(s,'Penjualan tidak ditemukan.',404);u.check(req.actor.peran===4||req.actor.peran===5&&req.actor.id_mitra===s.id_mitra,'Tidak memiliki akses.',403);
  s.detail=(await pool.query('SELECT * FROM public.detail_penjualan WHERE id_penjualan=$1 AND aktif=1 ORDER BY id_detail_penjualan',[s.id_penjualan])).rows;u.ok(res,s);
 }));
 route('post','/api/penjualan',admin,u.wrap(async(req,res)=>{
  const b=req.body;u.fields(b,['id_mitra','id_drop_point','detailPenjualan','request_key','catatan']);u.check(Array.isArray(b.detailPenjualan)&&b.detailPenjualan.length>0&&b.detailPenjualan.length<=4,'Isi satu sampai empat material.');
  const rows=b.detailPenjualan.map(d=>({id:integer(d.id_jenis_sampah),kg:u.decimal(d.berat_dikirim_kg,'Berat dikirim',999999999,3),price:u.decimal(d.harga_per_kg_snapshot,'Harga per kg',999999999,2)}));
  u.check(rows.every(d=>Number(d.kg)>0),'Berat harus positif.');u.check(new Set(rows.map(d=>d.id)).size===rows.length,'Material berulang.');
  const mitra=integer(b.id_mitra),dp=integer(b.id_drop_point),key=uuid(b.request_key),note=u.text(b.catatan,'Catatan',500);
  const result=await u.write(pool,req.actor,async c=>{
   const existing=(await c.query('SELECT * FROM public.penjualan WHERE request_key=$1',[key])).rows[0];if(existing){u.check(existing.dibuat_oleh===req.actor.id_pengguna,'Kunci sudah digunakan.',409);return existing;}
   u.check((await c.query('SELECT 1 FROM public.mitra WHERE id_mitra=$1 AND aktif=1 AND is_deleted=0',[mitra])).rows.length,'Mitra tidak aktif.');
   u.check((await c.query('SELECT 1 FROM public.drop_point WHERE id_drop_point=$1 AND aktif=1 AND is_deleted=0',[dp])).rows.length,'Drop point tidak aktif.');
   for(const d of rows){
    u.check((await c.query('SELECT 1 FROM public.jenis_sampah WHERE id_jenis_sampah=$1 AND aktif=1 AND is_deleted=0',[d.id])).rows.length,'Material tidak aktif.');
    const stock=(await c.query(`SELECT COALESCE((SELECT sum(ds.berat_masuk_drop_point_kg) FROM public.detail_setoran ds JOIN public.setoran s ON s.id_setoran=ds.id_setoran WHERE s.id_drop_point=$1 AND s.status=3 AND s.status_drop_point=3 AND s.aktif=1 AND ds.aktif=1 AND ds.id_jenis_sampah=$2),0)-COALESCE((SELECT sum(dj.berat_dikirim_kg) FROM public.detail_penjualan dj JOIN public.penjualan j ON j.id_penjualan=dj.id_penjualan WHERE j.id_drop_point=$1 AND j.status<>'DIBATALKAN' AND j.aktif=1 AND dj.aktif=1 AND dj.id_jenis_sampah=$2),0) AS kg`,[dp,d.id])).rows[0];
    u.check(Number(stock.kg)>=Number(d.kg),'Stok material di drop point tidak cukup.',409);
   }
   const s=(await c.query("INSERT INTO public.penjualan(id_drop_point,id_mitra,tanggal_penjualan,status,catatan,dibuat_oleh,request_key) VALUES($1,$2,current_date,'DRAFT',$3,$4,$5) RETURNING *",[dp,mitra,note,req.actor.id_pengguna,key])).rows[0];
   for(const d of rows)await c.query('INSERT INTO public.detail_penjualan(id_penjualan,id_jenis_sampah,berat_dikirim_kg,harga_per_kg_snapshot,dibuat_oleh) VALUES($1,$2,$3,$4,$5)',[s.id_penjualan,d.id,d.kg,d.price,req.actor.id_pengguna]);return s;
  });u.ok(res,result,201);
 }));
 route('patch','/api/penjualan/:id/kirim',admin,u.wrap(async(req,res)=>{
  const r=await u.write(pool,req.actor,async c=>{const id=integer(req.params.id),x=await c.query("UPDATE public.penjualan SET status='DIKIRIM',waktu_pengiriman=now() WHERE id_penjualan=$1 AND status='DRAFT' RETURNING *",[id]);u.check(x.rows.length,'Penjualan tidak dalam status draft.',409);return x.rows[0];});u.ok(res,r);
 }));
 route('patch','/api/penjualan/:id/batal',admin,u.wrap(async(req,res)=>{
  const r=await u.write(pool,req.actor,async c=>{
   const id=integer(req.params.id);
   const x=await c.query("UPDATE public.penjualan SET status='DIBATALKAN' WHERE id_penjualan=$1 AND status='DRAFT' AND aktif=1 RETURNING *",[id]);
   u.check(x.rows.length,'Hanya draft aktif yang dapat dibatalkan.',409);
   return x.rows[0];
  });u.ok(res,r);
 }));
 route('put','/api/penjualan/konfirmasi/:id',u.wrap(async(req,res)=>{
  u.check(req.actor.peran===5,'Hanya mitra tujuan yang dapat menerima penjualan.',403);const b=req.body;u.fields(b,['detail','catatan']);u.check(Array.isArray(b.detail)&&b.detail.length>0,'Rincian timbang wajib diisi.');
  const rows=b.detail.map(d=>({id:integer(d.id_detail_penjualan),accepted:u.decimal(d.berat_diterima_kg,'Berat diterima',999999999,3),rejected:u.decimal(d.berat_ditolak_kg,'Berat ditolak',999999999,3),reason:u.text(d.alasan_penolakan,'Alasan penolakan',255,Number(d.berat_ditolak_kg)>0),note:u.text(d.catatan_selisih_timbang,'Catatan selisih',255)}));
  const result=await u.write(pool,req.actor,async c=>{
   const id=integer(req.params.id),s=(await c.query('SELECT * FROM public.penjualan WHERE id_penjualan=$1 FOR UPDATE',[id])).rows[0];u.check(s&&s.status==='DIKIRIM','Penjualan belum dikirim.',409);u.check(s.id_mitra===req.actor.id_mitra,'Penjualan untuk mitra lain.',403);
   const old=(await c.query('SELECT * FROM public.detail_penjualan WHERE id_penjualan=$1 AND aktif=1',[id])).rows;u.check(old.length===rows.length&&old.every(d=>rows.some(r=>r.id===d.id_detail_penjualan)),'Rincian tidak cocok.');
   for(const d of rows){const orig=old.find(x=>x.id_detail_penjualan===d.id);u.check(Number(d.accepted)+Number(d.rejected)===Number(orig.berat_dikirim_kg)||d.note,'Selisih berat memerlukan catatan.');await c.query('UPDATE public.detail_penjualan SET berat_diterima_kg=$1,berat_ditolak_kg=$2,alasan_penolakan=$3,catatan_selisih_timbang=$4 WHERE id_detail_penjualan=$5',[d.accepted,d.rejected,d.reason,d.note,d.id]);}
   return(await c.query("UPDATE public.penjualan SET status='DITERIMA',dikonfirmasi_oleh=$1,waktu_terima_mitra=now(),catatan=COALESCE($2,catatan) WHERE id_penjualan=$3 RETURNING *",[req.actor.id_pengguna,u.text(b.catatan,'Catatan',500),id])).rows[0];
  });u.ok(res,result);
 }));
 route('put','/api/penjualan/retur/:id',u.wrap(async(req,res)=>{
  u.fields(req.body,['berat_retur_kembali_kg']);const kg=u.decimal(req.body.berat_retur_kembali_kg,'Berat retur',999999999,3);
  const result=await u.write(pool,req.actor,async c=>{
   const d=(await c.query('SELECT d.*,s.id_mitra,s.status FROM public.detail_penjualan d JOIN public.penjualan s ON s.id_penjualan=d.id_penjualan WHERE d.id_detail_penjualan=$1 FOR UPDATE',[integer(req.params.id)])).rows[0];u.check(d,'Rincian tidak ditemukan.',404);
   u.check(req.actor.peran===4||req.actor.peran===5&&req.actor.id_mitra===d.id_mitra,'Tidak memiliki izin.',403);u.check(['DITERIMA','SELESAI'].includes(d.status),'Penjualan belum diterima.',409);
   u.check(Number(kg)>0&&Number(kg)<=Number(d.berat_ditolak_kg),'Retur harus positif dan tidak melebihi berat ditolak.',409);
   return(await c.query('UPDATE public.detail_penjualan SET berat_retur_kembali_kg=$1,waktu_retur_kembali=now() WHERE id_detail_penjualan=$2 RETURNING *',[kg,d.id_detail_penjualan])).rows[0];
  });u.ok(res,result);
 }));
 route('get','/api/laporan/stok',admin,u.wrap(async(req,res)=>{
  const r=await pool.query(`SELECT dp.id_drop_point,dp.nama_drop_point,j.id_jenis_sampah,j.nama_jenis,
   COALESCE((SELECT sum(ds.berat_masuk_drop_point_kg) FROM public.detail_setoran ds JOIN public.setoran s ON s.id_setoran=ds.id_setoran WHERE s.id_drop_point=dp.id_drop_point AND s.status=3 AND s.status_drop_point=3 AND s.aktif=1 AND ds.aktif=1 AND ds.id_jenis_sampah=j.id_jenis_sampah),0) AS berat_masuk_final_kg,
   COALESCE((SELECT sum(dj.berat_dikirim_kg) FROM public.detail_penjualan dj JOIN public.penjualan p ON p.id_penjualan=dj.id_penjualan WHERE p.id_drop_point=dp.id_drop_point AND p.status<>'DIBATALKAN' AND p.aktif=1 AND dj.aktif=1 AND dj.id_jenis_sampah=j.id_jenis_sampah),0) AS berat_dikirim_kg,
   COALESCE((SELECT sum(dj.berat_retur_kembali_kg) FROM public.detail_penjualan dj JOIN public.penjualan p ON p.id_penjualan=dj.id_penjualan WHERE p.id_drop_point=dp.id_drop_point AND p.status<>'DIBATALKAN' AND p.aktif=1 AND dj.aktif=1 AND dj.id_jenis_sampah=j.id_jenis_sampah),0) AS berat_retur_kembali_kg
   FROM public.drop_point dp CROSS JOIN public.jenis_sampah j WHERE dp.is_deleted=0 AND j.is_deleted=0 ORDER BY dp.id_drop_point,j.id_jenis_sampah`);
  u.ok(res,r.rows.map(row=>({...row,masuk:row.berat_masuk_final_kg,stok_tersedia_kg:Number(row.berat_masuk_final_kg)-Number(row.berat_dikirim_kg)+Number(row.berat_retur_kembali_kg)})));
 }));
 route('get','/api/mutasi-kas',admin,u.wrap(async(req,res)=>u.ok(res,(await pool.query('SELECT * FROM public.mutasi_kas WHERE aktif=1 ORDER BY id_mutasi_kas DESC')).rows)));
 route('get','/api/mutasi-kas/ringkasan',admin,u.wrap(async(req,res)=>{
  const r=(await pool.query(`SELECT COALESCE(sum(jumlah_rupiah),0) AS total_kas,COALESCE(sum(CASE WHEN pos_dana='HASIL_PENJUALAN' THEN round(jumlah_rupiah*persen_cadangan_snapshot/100,2) WHEN pos_dana='CADANGAN_POIN' THEN jumlah_rupiah ELSE 0 END),0) AS cadangan_poin,COALESCE(sum(CASE WHEN pos_dana='HASIL_PENJUALAN' THEN round(jumlah_rupiah*persen_komunitas_snapshot/100,2) WHEN pos_dana='KOMUNITAS' THEN jumlah_rupiah ELSE 0 END),0) AS komunitas,COALESCE(sum(CASE WHEN pos_dana='HASIL_PENJUALAN' THEN jumlah_rupiah-round(jumlah_rupiah*persen_cadangan_snapshot/100,2)-round(jumlah_rupiah*persen_komunitas_snapshot/100,2) WHEN pos_dana='OPERASIONAL' THEN jumlah_rupiah ELSE 0 END),0) AS operasional FROM public.mutasi_kas WHERE aktif=1`)).rows[0];
  const funds=await reserve(pool);u.ok(res,{...r,cadangan_dipesan:funds.dipesan});
 }));
 route('post','/api/mutasi-kas',admin,u.wrap(async(req,res)=>{
  const b=req.body;u.fields(b,['pos_dana','jumlah_rupiah','metode','pihak_terkait','keterangan','bukti','dicatat_oleh','waktu_transaksi','request_key']);
  u.check(['CADANGAN_POIN','KOMUNITAS','OPERASIONAL'].includes(b.pos_dana),'Pos dana tidak valid.');
  const amount=Number(b.jumlah_rupiah);u.check(Number.isFinite(amount)&&amount!==0&&Math.abs(amount)<=999999999,'Nominal tidak valid.');
  u.check(b.pos_dana==='CADANGAN_POIN'?amount>0:b.pos_dana==='KOMUNITAS'?amount<0:true,'Arah dana tidak sesuai pos.');
  const method=b.metode;u.check(['TUNAI','TRANSFER'].includes(method),'Metode tidak valid.');
  const key=uuid(b.request_key),party=u.text(b.pihak_terkait,'Pihak terkait',150,true),note=u.text(b.keterangan,'Keterangan',255,true),proof=u.proof(b.bukti);
  const r=await u.write(pool,req.actor,async c=>{
   const old=(await c.query('SELECT * FROM public.mutasi_kas WHERE request_key=$1',[key])).rows[0];if(old){u.check(old.dibuat_oleh===req.actor.id_pengguna,'Kunci telah digunakan.',409);return old;}
   return(await c.query('INSERT INTO public.mutasi_kas(pos_dana,jumlah_rupiah,metode,pihak_terkait,keterangan,bukti,waktu_transaksi,dibuat_oleh,request_key) VALUES($1,$2,$3,$4,$5,$6,now(),$7,$8) RETURNING *',[b.pos_dana,amount,method,party,note,proof,req.actor.id_pengguna,key])).rows[0];
  });u.ok(res,r,201);
 }));
 route('post','/api/mutasi-kas/penjualan',admin,u.wrap(async(req,res)=>{
  const b=req.body;u.fields(b,['id_penjualan','jumlah_rupiah','metode','bukti','keterangan','dicatat_oleh','waktu_transaksi','pos_dana','persen_cadangan_snapshot','persen_komunitas_snapshot','request_key']);
  const source=options.config||process.env,pc=source.PERSEN_CADANGAN,pk=source.PERSEN_KOMUNITAS;
  u.check(/^\d{1,3}(\.\d{1,2})?$/.test(pc||'')&&/^\d{1,3}(\.\d{1,2})?$/.test(pk||'')&&Number(pc)+Number(pk)<=100,'Pembagian dana belum ditetapkan.',409);
  const method=b.metode;u.check(['TRANSFER','TUNAI'].includes(method),'Metode tidak valid.');
  const proof=u.proof(b.bukti),key=uuid(b.request_key),id=integer(b.id_penjualan);
  const r=await u.write(pool,req.actor,async c=>{
   const old=(await c.query('SELECT * FROM public.mutasi_kas WHERE request_key=$1',[key])).rows[0];if(old){u.check(old.id_penjualan===id,'Kunci sudah dipakai.',409);return old;}
   const sale=(await c.query('SELECT * FROM public.penjualan WHERE id_penjualan=$1 AND status=$2 FOR UPDATE',[id,'DITERIMA'])).rows[0];u.check(sale,'Penjualan belum diterima atau telah dibayar.',409);
   const total=(await c.query('SELECT COALESCE(sum(berat_diterima_kg*harga_per_kg_snapshot),0) AS n FROM public.detail_penjualan WHERE id_penjualan=$1 AND aktif=1',[id])).rows[0].n;
   u.check((await c.query('SELECT $1::numeric=$2::numeric AS ok',[b.jumlah_rupiah,total])).rows[0].ok,'Nominal harus sama dengan hasil timbang mitra.',409);
   const row=(await c.query("INSERT INTO public.mutasi_kas(pos_dana,jumlah_rupiah,id_penjualan,metode,bukti,keterangan,persen_cadangan_snapshot,persen_komunitas_snapshot,waktu_transaksi,dibuat_oleh,request_key) VALUES('HASIL_PENJUALAN',$1,$2,$3,$4,$5,$6,$7,now(),$8,$9) RETURNING *",[total,id,method,proof,u.text(b.keterangan,'Keterangan',255),pc,pk,req.actor.id_pengguna,key])).rows[0];
   await c.query("UPDATE public.penjualan SET status='SELESAI' WHERE id_penjualan=$1",[id]);return row;
  });u.ok(res,r,201);
 }));
};
