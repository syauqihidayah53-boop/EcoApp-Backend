const crypto = require('node:crypto');
class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
const check = (condition, message, status = 400) => { if (!condition) throw new ApiError(status, message); };
function text(value, name, max, required = false) {
    check(value == null || typeof value === 'string', `${name} harus berupa teks.`);
    const v = (value || '').trim();
    check(!required || v.length > 0, `${name} wajib diisi.`);
    check(v.length <= max, `${name} maksimal ${max} karakter.`);
    return v || null;
}
function id(value, name = 'ID') {
    check(typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)), `${name} tidak valid.`);
    const n = Number(value); check(Number.isSafeInteger(n) && n > 0 && n <= 2147483647, `${name} tidak valid.`); return n;
}
function decimal(value, name, max = 999999, places = 3) {
    check(['string', 'number'].includes(typeof value) && new RegExp(`^\\d+(?:\\.\\d{1,${places}})?$`).test(String(value)), `${name} tidak valid.`);
    const n = Number(value); check(Number.isFinite(n) && n >= 0 && n <= max, `${name} di luar batas.`); return String(value);
}
function email(value) { const v = text(value, 'Email', 150, true).toLowerCase(); check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Format email tidak valid.'); return v; }
function password(value) { check(typeof value === 'string' && value.length >= 8 && value.length <= 128 && value.trim(), 'Password harus 8–128 karakter dan tidak boleh hanya spasi.'); return value; }
function phone(value) { const v = text(value, 'Telepon', 20); if (!v) return null; const n = v.replace(/[ ()-]/g, ''); check(/^\+?[0-9]{8,15}$/.test(n), 'Telepon harus 8–15 digit, boleh diawali +.'); return n; }
function fields(body, allowed) { check(body && !Array.isArray(body) && typeof body === 'object', 'Data permintaan tidak valid.'); check(Object.keys(body).every(k => allowed.includes(k)), 'Ada kolom yang tidak boleh diubah.'); }
function photo(value) {
    if (value == null || value === '') return null;
    check(typeof value === 'string', 'Foto tidak valid.');
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    check(m && m[2].length <= 1398104, 'Foto harus JPG, PNG, atau WebP maksimal 1 MB.');
    const b = Buffer.from(m[2], 'base64');
    const valid = m[1] === 'jpeg' ? b.subarray(0,3).equals(Buffer.from([255,216,255])) : m[1] === 'png' ? b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : b.toString('ascii',0,4)==='RIFF' && b.toString('ascii',8,12)==='WEBP';
    check(b.length <= 1048576 && valid, 'Isi berkas foto tidak sesuai format.'); return value;
}
function proof(value) { const v = text(value, 'Tautan bukti', 255, true); let u; try { u = new URL(v); } catch {} check(u && u.protocol === 'https:' && !u.username && !u.password, 'Bukti harus berupa tautan HTTPS.'); return v; }
const categories = { 1:'RUMAH_TANGGA', 2:'UMKM_KULINER', 3:'PEDAGANG_PASAR' };
function publicUser(row) { const { password_hash, token_version, ...user } = row; return { ...user, jenis_pelanggan: categories[user.peran] || null }; }
async function transaction(pool, fn) { const c = await pool.connect(); try { await c.query('BEGIN'); const result=await fn(c); await c.query('COMMIT'); return result; } catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } }
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const ok = (res,data,status=200) => res.status(status).json({status:'success',data});
// Serializes balance changes and account lifecycle transitions across API processes.
const lock = c => c.query('SELECT pg_advisory_xact_lock(74192831)');
async function write(pool,actor,fn) {
    return transaction(pool,async c=>{
        await lock(c);
        const r=await c.query('SELECT token_version FROM public.pengguna WHERE id_pengguna=$1 AND aktif=1 AND is_deleted=0 FOR UPDATE',[actor.id_pengguna]);
        check(r.rows[0]?.token_version===actor.token_version,'Sesi sudah berubah. Masuk kembali.',401);
        return fn(c);
    });
}
function errorHandler(err,req,res,next) {
    const status = err.status || ({23505:409,23503:409,23514:400,23502:400,22001:400,40001:409,'40P01':409}[err.code]) || 500;
    const message = err.status ? err.message : status===409 ? 'Data sudah dipakai atau berubah. Muat ulang dan coba lagi.' : status===400 ? 'Data tidak sesuai aturan database.' : 'Layanan belum dapat memproses permintaan.';
    if(status>=500) console.error('API error code:',err.code || err.name);
    res.status(status).json({status:'error',message});
}
module.exports={ApiError,check,text,id,decimal,email,password,phone,fields,photo,proof,categories,publicUser,transaction,write,wrap,ok,lock,errorHandler,crypto};
