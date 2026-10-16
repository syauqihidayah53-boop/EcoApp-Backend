require('dotenv').config(process.env.DOTENV_CONFIG_PATH ? {path:process.env.DOTENV_CONFIG_PATH,quiet:true}:{quiet:true});
const pool=require('./config/supabase-db');
const app=require('./lib/app')(pool);
if(require.main===module) pool.query('SELECT token_version FROM public.pengguna LIMIT 0').then(()=>{
    app.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log(`API EcoApp Supabase berjalan di http://localhost:${Number(process.env.PORT||3000)}`));
}).catch(e=>{console.error('Backend belum siap. Periksa koneksi/migrasi. Kode:',e.code||e.name);process.exitCode=1;pool.end();});
module.exports=app;
