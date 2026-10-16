const { randomBytes, pbkdf2: pbkdf2Callback, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');

const pbkdf2 = promisify(pbkdf2Callback);
const iterations = 310000;

async function hashPassword(password) {
    const salt = randomBytes(16);
    const hash = await pbkdf2(password, salt, iterations, 32, 'sha256');
    return `pbkdf2-sha256:${iterations}:${salt.toString('hex')}:${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
    const parts = String(stored || '').split(':');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256' || Number(parts[1]) !== iterations) return false;
    const salt = Buffer.from(parts[2], 'hex');
    const expected = Buffer.from(parts[3], 'hex');
    if (salt.length !== 16 || expected.length !== 32) return false;
    const actual = await pbkdf2(password, salt, iterations, expected.length, 'sha256');
    return timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword };
