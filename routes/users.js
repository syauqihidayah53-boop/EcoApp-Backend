const u=require('../lib/api-utils');
const {hashPassword,verifyPassword}=require('../lib/password');
const columns='id_pengguna,nama,email,no_hp,peran,id_mitra,nama_usaha,alamat,aktif,is_deleted,dibuat_pada,diubah_pada';
async function locked(c,id) {
    const r=await c.query(`SELECT EXISTS(SELECT 1 FROM public.setoran WHERE id_pengguna=$1 OR dibuat_oleh=$1 OR ditimbang_oleh=$1 OR diverifikasi_oleh=$1 OR diterima_oleh=$1)
        OR EXISTS(SELECT 1 FROM public.penjemputan WHERE id_petugas=$1 OR dibuat_oleh=$1)
        OR EXISTS(SELECT 1 FROM public.pencairan_poin WHERE id_pengguna=$1 OR dibuat_oleh=$1 OR diproses_oleh=$1)
        OR EXISTS(SELECT 1 FROM public.penjualan WHERE dibuat_oleh=$1 OR dikonfirmasi_oleh=$1)
        OR EXISTS(SELECT 1 FROM public.mutasi_kas WHERE dibuat_oleh=$1)
        OR EXISTS(SELECT 1 FROM public.slot_jemput WHERE dibuat_oleh=$1)
        OR EXISTS(SELECT 1 FROM public.detail_setoran WHERE dibuat_oleh=$1)
        OR EXISTS(SELECT 1 FROM public.detail_penjualan WHERE dibuat_oleh=$1) AS locked`,[id]);
    return r.rows[0].locked;
}
async function getUser(c,id,forUpdate=false) {
    const r=await c.query(`SELECT * FROM public.pengguna WHERE id_pengguna=$1 ${forUpdate?'FOR UPDATE':''}`,[id]);
    u.check(r.rows[0],'Pengguna tidak ditemukan.',404);return r.rows[0];
}
module.exports=function(app,{pool,requireUser,admin,token}) {
    // Bounded per-process throttling; deployment behind multiple instances needs a shared limiter.
    const attempts=new Map();
    const throttle=(req,res,next)=>{
        const now=Date.now(); for(const[k,v] of attempts)if(v.until<now)attempts.delete(k);
        const key=req.ip; const item=attempts.get(key)||{count:0,until:now+60000};item.count++;attempts.set(key,item);
        if(item.count>30)return next(new u.ApiError(429,'Terlalu banyak percobaan. Coba lagi satu menit.'));next();
    };
    app.post('/api/auth/register',throttle,u.wrap(async(req,res)=>{
        const b=req.body; u.fields(b,['nama','email','password','no_hp','alamat','nama_usaha','jenis_pelanggan','peran']);
        const role=Number(Object.keys(u.categories).find(k=>u.categories[k]===b.jenis_pelanggan));
        u.check(role && (!b.peran||b.peran==='PELANGGAN'),'Kategori atau peran tidak valid.');
        const values=[u.text(b.nama,'Nama',100,true),u.email(b.email),await hashPassword(u.password(b.password)),u.phone(b.no_hp),role,u.text(b.alamat,'Alamat',255,true),role===1?null:u.text(b.nama_usaha,'Nama usaha',150)];
        const r=await pool.query(`INSERT INTO public.pengguna(nama,email,password_hash,no_hp,peran,alamat,nama_usaha) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${columns}`,values);
        u.ok(res,u.publicUser(r.rows[0]),201);
    }));
    app.post('/api/auth/login',throttle,u.wrap(async(req,res)=>{
        const email=u.email(req.body?.email); u.check(typeof req.body?.password==='string'&&req.body.password.length<=128,'Email atau password tidak valid.');
        const r=await pool.query('SELECT * FROM public.pengguna WHERE lower(email)=$1 AND aktif=1 AND is_deleted=0',[email]);
        const user=r.rows[0]; u.check(user&&await verifyPassword(req.body.password,user.password_hash),'Email atau password salah.',401);
        res.json({status:'success',data:u.publicUser(user),token:token(user)});
    }));
    app.post('/api/auth/logout',requireUser,u.wrap(async(req,res)=>{
        await u.write(pool,req.actor,c=>c.query('UPDATE public.pengguna SET token_version=token_version+1 WHERE id_pengguna=$1',[req.actor.id_pengguna]));
        u.ok(res,{logged_out:true});
    }));
    app.get('/api/profil',requireUser,u.wrap(async(req,res)=>u.ok(res,u.publicUser(await getUser(pool,req.actor.id_pengguna)))));
    app.put('/api/profil',requireUser,u.wrap(async(req,res)=>{
        u.fields(req.body,['nama','email','no_hp','alamat','nama_usaha','foto_profil','password_lama','password_baru']);
        const result=await u.write(pool,req.actor,async c=>{
            const p=await getUser(c,req.actor.id_pengguna,true),b=req.body;
            const name=u.text(b.nama??p.nama,'Nama',100,true),mail=u.email(b.email??p.email);
            const credentialChange=mail!==p.email || b.password_baru!==undefined;
            if(credentialChange)u.check(typeof b.password_lama==='string'&&b.password_lama.length<=128&&await verifyPassword(b.password_lama,p.password_hash),'Password saat ini tidak cocok.',403);
            const hash=b.password_baru===undefined?p.password_hash:await hashPassword(u.password(b.password_baru));
            const val=k=>b[k]===undefined?p[k]:b[k];
            const r=await c.query(`UPDATE public.pengguna SET nama=$1,email=$2,no_hp=$3,alamat=$4,nama_usaha=$5,foto_profil=$6,password_hash=$7,
                token_version=token_version+$8,diubah_oleh=$9,diubah_pada=now() WHERE id_pengguna=$9 RETURNING *`,
                [name,mail,u.phone(val('no_hp')),u.text(val('alamat'),'Alamat',255,p.peran<=3),[2,3].includes(p.peran)?u.text(val('nama_usaha'),'Nama usaha',150):null,u.photo(val('foto_profil')),hash,credentialChange?1:0,p.id_pengguna]);
            return r.rows[0];
        });
        res.json({status:'success',data:u.publicUser(result),token:token(result)});
    }));
    app.get('/api/pengguna',requireUser,admin,u.wrap(async(req,res)=>{
        const r=await pool.query(`SELECT ${columns} FROM public.pengguna ORDER BY id_pengguna DESC`);u.ok(res,r.rows);
    }));
    app.get('/api/pengguna/:id',requireUser,u.wrap(async(req,res)=>{
        const id=u.id(req.params.id);u.check(req.actor.peran===4||req.actor.id_pengguna===id,'Akun ini bukan milik Anda.',403);
        const p=await getUser(pool,id);u.ok(res,{...u.publicUser(p),terkunci_transaksi:await locked(pool,id)});
    }));
    app.get('/api/mitra/ringkas',requireUser,admin,u.wrap(async(req,res)=>{
        u.ok(res,(await pool.query('SELECT id_mitra,nama_mitra FROM public.mitra WHERE aktif=1 AND is_deleted=0 ORDER BY nama_mitra')).rows);
    }));
    app.post('/api/pengguna/petugas-mitra',requireUser,admin,u.wrap(async(req,res)=>{
        const b=req.body;u.fields(b,['nama','email','password','no_hp','id_mitra']);
        const values=[u.text(b.nama,'Nama',100,true),u.email(b.email),await hashPassword(u.password(b.password)),u.phone(b.no_hp),u.id(b.id_mitra),req.actor.id_pengguna];
        const r=await u.write(pool,req.actor,async c=>{
            u.check((await c.query('SELECT id_mitra FROM public.mitra WHERE id_mitra=$1 AND aktif=1 AND is_deleted=0 FOR SHARE',[values[4]])).rows.length,'Mitra aktif tidak ditemukan.',400);
            return c.query(`INSERT INTO public.pengguna(nama,email,password_hash,no_hp,id_mitra,dibuat_oleh,peran) VALUES($1,$2,$3,$4,$5,$6,5) RETURNING ${columns}`,values);
        });u.ok(res,r.rows[0],201);
    }));
    app.put('/api/pengguna/:id',requireUser,admin,u.wrap(async(req,res)=>{
        const id=u.id(req.params.id),b=req.body;u.fields(b,['nama','no_hp','alamat','nama_usaha','id_mitra']);
        const result=await u.write(pool,req.actor,async c=>{
            const p=await getUser(c,id,true);u.check(!p.is_deleted,'Pulihkan akun sebelum mengubahnya.',409);
            let mitra=p.id_mitra;
            if(b.id_mitra!==undefined&&b.id_mitra!==mitra){
                u.check(p.peran===5&&!(await locked(c,id)),'Organisasi akun terkunci oleh riwayat transaksi.',409);
                mitra=u.id(b.id_mitra);u.check((await c.query('SELECT 1 FROM public.mitra WHERE id_mitra=$1 AND aktif=1 AND is_deleted=0 FOR SHARE',[mitra])).rows.length,'Mitra tidak aktif.');
            }
            const val=k=>b[k]===undefined?p[k]:b[k];
            return c.query(`UPDATE public.pengguna SET nama=$1,no_hp=$2,alamat=$3,nama_usaha=$4,id_mitra=$5,diubah_oleh=$6,diubah_pada=now() WHERE id_pengguna=$7 RETURNING ${columns}`,
                [u.text(val('nama'),'Nama',100,true),u.phone(val('no_hp')),u.text(val('alamat'),'Alamat',255,p.peran<=3),[2,3].includes(p.peran)?u.text(val('nama_usaha'),'Nama usaha',150):null,mitra,req.actor.id_pengguna,id]);
        });u.ok(res,result.rows[0]);
    }));
    for(const[action,active] of [['nonaktifkan',0],['aktifkan',1]])app.patch(`/api/pengguna/:id/${action}`,requireUser,admin,u.wrap(async(req,res)=>{
        const id=u.id(req.params.id);u.check(id!==req.actor.id_pengguna,'Status akun sendiri tidak dapat diubah di sini.',409);
        const r=await u.write(pool,req.actor,async c=>{
            const p=await getUser(c,id,true);
            if(!active&&p.peran===4)u.check((await c.query('SELECT count(*)::int AS n FROM public.pengguna WHERE peran=4 AND aktif=1 AND is_deleted=0')).rows[0].n>1,'Pengelola aktif terakhir tidak boleh dinonaktifkan.',409);
            if(active&&p.peran===5)u.check((await c.query('SELECT 1 FROM public.mitra WHERE id_mitra=$1 AND aktif=1 AND is_deleted=0',[p.id_mitra])).rows.length,'Organisasi mitra tidak aktif.',409);
            return c.query(`UPDATE public.pengguna SET aktif=$1,is_deleted=0,token_version=token_version+1,diubah_oleh=$2,diubah_pada=now() WHERE id_pengguna=$3 RETURNING ${columns}`,[active,req.actor.id_pengguna,id]);
        });u.ok(res,r.rows[0]);
    }));
    app.delete('/api/pengguna/:id',requireUser,admin,u.wrap(async(req,res)=>{
        const id=u.id(req.params.id);u.check(id!==req.actor.id_pengguna,'Akun sendiri tidak boleh dihapus.',409);
        await u.write(pool,req.actor,async c=>{
            const p=await getUser(c,id,true);u.check(!await locked(c,id),'Akun memiliki transaksi; nonaktifkan untuk mempertahankan riwayat.',409);
            if(p.peran===4&&p.aktif)u.check((await c.query('SELECT count(*)::int AS n FROM public.pengguna WHERE peran=4 AND aktif=1 AND is_deleted=0')).rows[0].n>1,'Pengelola terakhir tidak boleh dihapus.',409);
            // FK also protects references from master audit records.
            await c.query('DELETE FROM public.pengguna WHERE id_pengguna=$1',[id]);
        });u.ok(res,{deleted:true});
    }));
};
