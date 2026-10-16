require('dotenv').config({quiet:true});
const fs=require('node:fs');
const path=require('node:path');
const pool=require('../config/supabase-db');
const app=require('../lib/app')(pool);
(async()=>{
 const file=path.join(__dirname,'../.demo-accounts.local.txt');
 if(!fs.existsSync(file))throw new Error('Akun uji belum dibuat. Jalankan node scripts/seed-demo.js.');
 const secret=fs.readFileSync(file,'utf8').trim().split('\n').at(-1).trim();
 const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 try{
  const url='http://127.0.0.1:'+server.address().port+'/api';
  const health=await fetch(url+'/health');if(!health.ok)throw new Error('Health API gagal.');
  for(const [index,name] of ['rumah','umkm','pasar','pengelola','mitra'].entries()){
   const r=await fetch(url+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:name+'@demo.pilahin.local',password:secret})});
   const body=await r.json();if(!r.ok||body.data?.peran!==index+1||!body.token)throw new Error('Login akun '+name+' gagal: '+r.status);
   const profile=await fetch(url+'/profil',{headers:{Authorization:'Bearer '+body.token}});if(!profile.ok)throw new Error('Profil akun '+name+' gagal: '+profile.status);
   console.log(name+': login dan profil OK');
  }
 }finally{await new Promise(resolve=>server.close(resolve));await pool.end();}
})().catch(e=>{console.error('Smoke gagal:',e.message);process.exitCode=1;});
