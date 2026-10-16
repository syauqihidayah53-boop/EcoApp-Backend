const {test}=require('node:test');
const assert=require('node:assert/strict');
const jwt=require('jsonwebtoken');
const createApp=require('../lib/app');
const secret='t01-test-secret-with-at-least-32-characters';
test('T01 menolak aktor palsu dan membatasi riwayat dari token',async()=>{
 const pool={query:async(sql,params)=>{
  if(sql.includes('SELECT id_pengguna,peran,id_mitra,token_version'))return {rows:[{id_pengguna:params[0],peran:params[0]===9?4:1,id_mitra:null,token_version:0}]};
  if(sql.includes('FROM public.setoran s'))return {rows:[{id_setoran:73,total_poin:0}]};
  if(sql.includes('FROM public.pencairan_poin c'))return {rows:[{id_pencairan:81,status:1}]};
  throw Error('Query tidak diharapkan');
 },connect:async()=>{throw Error('Mutasi DB tidak boleh dijalankan oleh kasus negatif ini');}};
 const app=createApp(pool,{secret});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 const auth=id=>({Authorization:'Bearer '+jwt.sign({ver:0},secret,{subject:String(id)})});
 try{
  assert.equal((await fetch(base+'/api/setoran')).status,401);
  const payload={id_pengguna:3,id_drop_point:5,metode:'ANTAR',request_key:'e260432e-b683-4f2c-a050-e16e59a181eb'};
  assert.equal((await fetch(base+'/api/setoran',{method:'POST',headers:{...auth(3),'Content-Type':'application/json'},body:JSON.stringify(payload)})).status,403);
  assert.equal((await fetch(base+'/api/setoran',{method:'POST',headers:{...auth(9),'Content-Type':'application/json'},body:JSON.stringify({...payload,dibuat_oleh:100})})).status,400);
  assert.equal((await fetch(base+'/api/setoran/riwayat/4',{headers:auth(3)})).status,403);
  assert.equal((await fetch(base+'/api/setoran/riwayat/3',{headers:auth(3)})).status,200);
  assert.equal((await fetch(base+'/api/pencairan/riwayat/4',{headers:auth(3)})).status,403);
  assert.equal((await fetch(base+'/api/pencairan/riwayat/3',{headers:auth(3)})).status,200);
 }finally{await new Promise(r=>server.close(r));}
});
