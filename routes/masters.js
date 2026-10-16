const u=require('../lib/api-utils');
const names={mitra:'mitra','drop-points':'drop_point','jenis-sampah':'jenis_sampah'};
const keys={mitra:'id_mitra','drop-points':'id_drop_point','jenis-sampah':'id_jenis_sampah'};
function flag(v){u.check(v===0||v===1,'Status harus 0 atau 1.');return v;}
function coords(b,old={}){
 const lat=b.latitude===undefined?old.latitude:b.latitude,lon=b.longitude===undefined?old.longitude:b.longitude;
 u.check((lat==null)===(lon==null),'Latitude dan longitude harus diisi bersama.');
 if(lat==null)return [null,null];
 const a=Number(lat),z=Number(lon);u.check(Number.isFinite(a)&&Number.isFinite(z)&&a>=-90&&a<=90&&z>=-180&&z<=180,'Koordinat di luar jangkauan.');return [a,z];
}
module.exports=function(app,{pool,requireUser,admin}){
 for(const [path,table] of Object.entries(names)){
  const pk=keys[path];
  app.get(`/api/${path}`,requireUser,u.wrap(async(req,res)=>{
   const sql=`SELECT * FROM public.${table} WHERE is_deleted=0 ${req.actor.peran===4?'':'AND aktif=1'} ORDER BY ${pk} DESC`;
   const rows=(await pool.query(sql)).rows;
   if(path==='mitra'&&req.actor.peran===4){
    const counts=(await pool.query('SELECT id_mitra,count(*)::int AS jumlah_petugas FROM public.pengguna WHERE peran=5 AND is_deleted=0 GROUP BY id_mitra')).rows;
    for(const row of rows)row.jumlah_petugas=counts.find(c=>c.id_mitra===row.id_mitra)?.jumlah_petugas||0;
   }
   u.ok(res,rows);
  }));
  app.get(`/api/${path}/:id`,requireUser,u.wrap(async(req,res)=>{
   const r=(await pool.query(`SELECT * FROM public.${table} WHERE ${pk}=$1 AND is_deleted=0`,[u.id(req.params.id)])).rows[0];
   u.check(r,'Data tidak ditemukan.',404);u.check(req.actor.peran===4||r.aktif===1,'Data tidak tersedia.',403);
   if(path==='mitra'&&req.actor.peran===4){
    r.daftar_petugas=(await pool.query('SELECT id_pengguna,nama,email,no_hp,aktif FROM public.pengguna WHERE id_mitra=$1 AND peran=5 AND is_deleted=0 ORDER BY nama',[r.id_mitra])).rows;
    r.jumlah_petugas=r.daftar_petugas.length;
   }
   u.ok(res,r);
  }));
  app.post(`/api/${path}`,requireUser,admin,u.wrap(async(req,res)=>{
   const b=req.body, actor=req.actor.id_pengguna;
   let sql,values;
   if(path==='mitra'){
    u.fields(b,['nama_mitra','nama_penanggung_jawab','no_hp','alamat_mitra','dibuat_oleh']);
    sql=`INSERT INTO public.mitra(nama_mitra,nama_penanggung_jawab,no_hp,alamat_mitra,dibuat_oleh) VALUES($1,$2,$3,$4,$5) RETURNING *`;
    values=[u.text(b.nama_mitra,'Nama mitra',150,true),u.text(b.nama_penanggung_jawab,'Penanggung jawab',100),u.phone(b.no_hp),u.text(b.alamat_mitra,'Alamat mitra',255,true),actor];
   }else if(path==='drop-points'){
    u.fields(b,['nama_drop_point','alamat','latitude','longitude','jam_operasional','nama_komunitas','kontak_komunitas','dibuat_oleh']);
    const [lat,lon]=coords(b);
    sql=`INSERT INTO public.drop_point(nama_drop_point,alamat,latitude,longitude,jam_operasional,nama_komunitas,kontak_komunitas,dibuat_oleh) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`;
    values=[u.text(b.nama_drop_point,'Nama drop point',100,true),u.text(b.alamat,'Alamat',255,true),lat,lon,u.text(b.jam_operasional,'Jam operasional',200,true),u.text(b.nama_komunitas,'Komunitas',20),u.phone(b.kontak_komunitas),actor];
   }else{
    u.fields(b,['nama_jenis','ketentuan','poin_per_kg','estimasi_hemat_co2_per_kg','dibuat_oleh']);
    const name=u.text(b.nama_jenis,'Jenis sampah',50,true);u.check(['Plastik','Kardus','Kaca','Logam'].includes(name),'Hanya empat jenis resmi yang tersedia.');
    sql=`INSERT INTO public.jenis_sampah(nama_jenis,ketentuan,poin_per_kg,dibuat_oleh) VALUES($1,$2,$3,$4) RETURNING *`;
    values=[name,u.text(b.ketentuan,'Ketentuan',500,true),u.decimal(b.poin_per_kg,'Poin per kg',99999999,2),actor];
   }
   const r=await u.write(pool,req.actor,c=>c.query(sql,values));u.ok(res,r.rows[0],201);
  }));
  app.put(`/api/${path}/:id`,requireUser,admin,u.wrap(async(req,res)=>{
   const b=req.body,id=u.id(req.params.id),actor=req.actor.id_pengguna;
   const result=await u.write(pool,req.actor,async c=>{
    const old=(await c.query(`SELECT * FROM public.${table} WHERE ${pk}=$1 AND is_deleted=0 FOR UPDATE`,[id])).rows[0];u.check(old,'Data tidak ditemukan.',404);
    const v=k=>b[k]===undefined?old[k]:b[k];let sql,values;
    if(path==='mitra'){
     u.fields(b,['nama_mitra','nama_penanggung_jawab','no_hp','alamat_mitra','aktif','diubah_oleh']);
     sql=`UPDATE public.mitra SET nama_mitra=$1,nama_penanggung_jawab=$2,no_hp=$3,alamat_mitra=$4,aktif=$5,diubah_oleh=$6,diubah_pada=now() WHERE id_mitra=$7 RETURNING *`;
     values=[u.text(v('nama_mitra'),'Nama mitra',150,true),u.text(v('nama_penanggung_jawab'),'Penanggung jawab',100),u.phone(v('no_hp')),u.text(v('alamat_mitra'),'Alamat mitra',255,true),flag(v('aktif')),actor,id];
    }else if(path==='drop-points'){
     u.fields(b,['nama_drop_point','alamat','latitude','longitude','jam_operasional','nama_komunitas','kontak_komunitas','aktif','diubah_oleh']);
     const [lat,lon]=coords(b,old);
     sql=`UPDATE public.drop_point SET nama_drop_point=$1,alamat=$2,latitude=$3,longitude=$4,jam_operasional=$5,nama_komunitas=$6,kontak_komunitas=$7,aktif=$8,diubah_oleh=$9,diubah_pada=now() WHERE id_drop_point=$10 RETURNING *`;
     values=[u.text(v('nama_drop_point'),'Nama drop point',100,true),u.text(v('alamat'),'Alamat',255,true),lat,lon,u.text(v('jam_operasional'),'Jam operasional',200,true),u.text(v('nama_komunitas'),'Komunitas',20),u.phone(v('kontak_komunitas')),flag(v('aktif')),actor,id];
    }else{
     u.fields(b,['nama_jenis','ketentuan','poin_per_kg','estimasi_hemat_co2_per_kg','aktif','diubah_oleh']);
     const name=u.text(v('nama_jenis'),'Jenis sampah',50,true);u.check(['Plastik','Kardus','Kaca','Logam'].includes(name),'Hanya empat jenis resmi yang tersedia.');
     sql=`UPDATE public.jenis_sampah SET nama_jenis=$1,ketentuan=$2,poin_per_kg=$3,aktif=$4,diubah_oleh=$5,diubah_pada=now() WHERE id_jenis_sampah=$6 RETURNING *`;
     values=[name,u.text(v('ketentuan'),'Ketentuan',500,true),u.decimal(v('poin_per_kg'),'Poin per kg',99999999,2),flag(v('aktif')),actor,id];
    }
    return(await c.query(sql,values)).rows[0];
   });u.ok(res,result);
  }));
  app.patch(`/api/${path}/:id/status`,requireUser,admin,u.wrap(async(req,res)=>{
   u.fields(req.body,['aktif','diubah_oleh']);const active=flag(req.body.aktif),id=u.id(req.params.id);
   const result=await u.write(pool,req.actor,async c=>{
    const r=await c.query(`UPDATE public.${table} SET aktif=$1,diubah_oleh=$2,diubah_pada=now() WHERE ${pk}=$3 AND is_deleted=0 RETURNING *`,[active,req.actor.id_pengguna,id]);u.check(r.rows.length,'Data tidak ditemukan.',404);return r.rows[0];
   });u.ok(res,result);
  }));
  app.delete(`/api/${path}/:id`,requireUser,admin,u.wrap(async(req,res)=>{
   const result=await u.write(pool,req.actor,async c=>{
    const r=await c.query(`UPDATE public.${table} SET aktif=0,is_deleted=1,diubah_oleh=$1,diubah_pada=now() WHERE ${pk}=$2 AND is_deleted=0 RETURNING ${pk}`,[req.actor.id_pengguna,u.id(req.params.id)]);
    u.check(r.rows.length,'Data tidak ditemukan.',404);return r.rows[0];
   });u.ok(res,result);
  }));
 }
};
