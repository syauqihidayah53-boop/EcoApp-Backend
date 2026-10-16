require('dotenv').config({quiet:true});
const fs=require('node:fs');
const path=require('node:path');
const pool=require('../config/supabase-db');
(async()=>{try{await pool.query(fs.readFileSync(path.join(__dirname,'../migrations/001-live-users.sql'),'utf8'));console.log('Migrasi tambahan berhasil.');}catch(e){console.error('Migrasi gagal:',e.code||e.name);process.exitCode=1;}finally{await pool.end();}})();
