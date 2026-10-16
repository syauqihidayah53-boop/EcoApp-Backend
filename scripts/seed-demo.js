require('dotenv').config({quiet:true});
const pool=require('../config/supabase-db');
const fs=require('node:fs');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const {hashPassword}=require('../lib/password');
const {transaction}=require('../lib/api-utils');
(async()=>{try{
 const credentials=path.join(__dirname,'../.demo-accounts.local.txt');
 const password=fs.existsSync(credentials)?fs.readFileSync(credentials,'utf8').trim().split('\n').at(-1).trim():randomBytes(18).toString('base64url')+'!';
 if(!fs.existsSync(credentials))fs.writeFileSync(credentials,'Akun uji Supabase (jangan commit)\nrumah@demo.pilahin.local\numkm@demo.pilahin.local\npasar@demo.pilahin.local\npengelola@demo.pilahin.local\nmitra@demo.pilahin.local\nPassword bersama:\n'+password+'\n',{mode:0o600,flag:'wx'});
 const hash=await hashPassword(password);
 await transaction(pool,async c=>{
  await c.query('SELECT pg_advisory_xact_lock(74192831)');
  const m=await c.query("INSERT INTO public.mitra(nama_mitra,alamat_mitra) VALUES('Mitra Uji Pilahin','Alamat pengujian') ON CONFLICT(nama_mitra) DO UPDATE SET nama_mitra=EXCLUDED.nama_mitra RETURNING id_mitra");
  for(const [i,name] of ['rumah','umkm','pasar','pengelola','mitra'].entries()){
   const r=await c.query('INSERT INTO public.pengguna(nama,email,password_hash,peran,alamat,id_mitra,nama_usaha) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash RETURNING id_pengguna',[
    'Akun Uji '+name,name+'@demo.pilahin.local',hash,i+1,'Alamat pengujian',i===4?m.rows[0].id_mitra:null,[1,2].includes(i)?'Usaha Uji '+name:null]);
   console.log(name+': siap');
  }
 });
 console.log('Akun uji siap. Tidak menambahkan poin, kas, atau transaksi fiktif.');
}catch(e){console.error('Seed gagal:',e.code||e.name);process.exitCode=1;}finally{await pool.end();}})();
