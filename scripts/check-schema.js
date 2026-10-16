require('dotenv').config({quiet:true});
const pool=require('../config/supabase-db');
const names=['pengguna','mitra','drop_point','jenis_sampah','slot_jemput','setoran','penjemputan','pencairan_poin','penjualan','mutasi_kas','detail_setoran','detail_penjualan'];
(async()=>{try{
 const r=await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name=ANY($2)',['public',names]);
 const found=new Set(r.rows.map(x=>x.table_name));
 console.log('Tabel bisnis: '+found.size+'/12');
 const count=await pool.query(`SELECT
 (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1)) AS columns,
 (SELECT count(*)::int FROM pg_constraint co JOIN pg_class cl ON cl.oid=co.conrelid JOIN pg_namespace ns ON ns.oid=cl.relnamespace WHERE ns.nspname='public' AND cl.relname=ANY($1) AND co.contype='f') AS foreign_keys,
 (SELECT count(*)::int FROM pg_class cl JOIN pg_namespace ns ON ns.oid=cl.relnamespace WHERE ns.nspname='public' AND cl.relname=ANY($1) AND cl.relrowsecurity) AS rls_tables`,[names]);
 console.log('Kolom: '+count.rows[0].columns+', FK: '+count.rows[0].foreign_keys+', RLS aktif: '+count.rows[0].rls_tables+'/12');
 if(found.size!==12){console.error('Belum tersedia: '+names.filter(n=>!found.has(n)).join(', '));process.exitCode=1;}
}catch(e){console.error('Pemeriksaan gagal:',e.code||e.name);process.exitCode=1;}finally{await pool.end();}})();
