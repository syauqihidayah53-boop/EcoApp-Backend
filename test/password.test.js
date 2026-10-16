const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../lib/password');

test('password yang didaftarkan bisa diverifikasi tanpa menyimpan teks aslinya', async () => {
    const stored = await hashPassword('rahasia123');
    assert.notEqual(stored, 'rahasia123');
    assert.equal(await verifyPassword('rahasia123', stored), true);
    assert.equal(await verifyPassword('lainnya', stored), false);
    assert.equal(await verifyPassword('rahasia123', 'teks-biasa'), false);
});
