const express=require('express');
const cors=require('cors');
const jwt=require('jsonwebtoken');
const u=require('./api-utils');
module.exports=function createApp(pool, options={}) {
    const secret=options.secret || process.env.AUTH_TOKEN_SECRET;
    if(!secret || secret.length<32) throw new Error('AUTH_TOKEN_SECRET minimal 32 karakter.');
    const app=express(); app.use(cors()); app.use(express.json({limit:'1500kb'}));
    const requireUser=u.wrap(async(req,res,next)=>{
        const m=/^Bearer (\S+)$/i.exec(req.headers.authorization||'');
        u.check(m,'Silakan masuk terlebih dahulu.',401);
        let claims; try{claims=jwt.verify(m[1],secret,{algorithms:['HS256']});}catch{throw new u.ApiError(401,'Sesi berakhir. Silakan masuk kembali.');}
        const n=Number(claims.sub); u.check(Number.isSafeInteger(n)&&n>0,'Sesi tidak valid.',401);
        const r=await pool.query('SELECT id_pengguna,peran,id_mitra,token_version FROM public.pengguna WHERE id_pengguna=$1 AND aktif=1 AND is_deleted=0',[n]);
        u.check(r.rows[0] && r.rows[0].token_version===claims.ver,'Sesi tidak berlaku atau akun nonaktif.',401);
        req.actor=r.rows[0]; next();
    });
    const admin=(req,res,next)=>req.actor.peran===4?next():next(new u.ApiError(403,'Hanya pengelola yang diizinkan.'));
    const token=row=>jwt.sign({ver:row.token_version},secret,{subject:String(row.id_pengguna),expiresIn:'12h'});
    const ctx={pool,requireUser,admin,token,options};
    app.get('/',(req,res)=>res.send('API EcoApp Supabase aktif'));
    app.get('/api/health',u.wrap(async(req,res)=>{await pool.query('SELECT 1');res.json({status:'success',database:'connected'});}));
    require('../routes/users')(app,ctx);
    require('../routes/masters')(app,ctx);
    require('../routes/transactions')(app,ctx);
    require('../routes/operations')(app,ctx);
    app.use((req,res)=>res.status(404).json({status:'error',message:'Layanan tidak ditemukan.'}));
    app.use(u.errorHandler); return app;
};
