// node test.mjs  -- guards the validation, cursor and credential logic. No framework on purpose.
import assert from 'node:assert/strict';
import { stripHtml, validate, encodeCursor, decodeCursor } from './functions/api/comments.js';
import { validateCredentials, timingSafeEqual, hashPassword, readCookie, COOKIE } from './lib/auth.js';

// --- html never survives ---
assert.equal(stripHtml('<script>alert(1)</script>hi'), 'alert(1)hi');
assert.equal(stripHtml('  a <b>b</b>  '), 'a b');
assert.equal(stripHtml('<img src=x onerror=y>'), '');

// --- comment body ---
assert.deepEqual(validate({ body: ' hello ' }), { body: 'hello' });
assert.equal(validate({ body: '   ' }).status, 400);
assert.equal(validate({ body: '<b></b>' }).status, 400);
assert.equal(validate({ body: 'x'.repeat(501) }).status, 400);
assert.equal(validate({ body: 'x'.repeat(500) }).body.length, 500);
assert.equal(validate({ body: 'x', hp: 'bot' }).status, 400);   // honeypot
assert.equal(validate({ body: 'x', hp: '' }).body, 'x');
assert.equal(validate(null).status, 400);
assert.equal(validate({ body: 5 }).status, 400);
// the payload can no longer choose a display name
assert.equal(validate({ name: 'impostor', body: 'x' }).name, undefined);

// --- cursor round trip, including ids containing the separator ---
const row = { created_at: 1700000000000, id: 'a-b_c' };
assert.deepEqual(decodeCursor(encodeCursor(row)), { ts: row.created_at, id: row.id });
assert.equal(decodeCursor(''), null);
assert.equal(decodeCursor('garbage'), null);
assert.equal(decodeCursor('_x'), null);

// --- credentials ---
assert.deepEqual(validateCredentials({ name: ' Mod_Hater ', password: 'hunter22' }), {
  name: 'Mod_Hater', password: 'hunter22', nameLower: 'mod_hater',
});
assert.equal(validateCredentials({ name: 'a', password: 'hunter22' }).status, 400);        // too short
assert.equal(validateCredentials({ name: 'x'.repeat(25), password: 'hunter22' }).status, 400);
assert.equal(validateCredentials({ name: 'has space', password: 'hunter22' }).status, 400);
assert.equal(validateCredentials({ name: '<b>x</b>', password: 'hunter22' }).status, 400);
assert.equal(validateCredentials({ name: 'ok', password: 'short' }).status, 400);
assert.equal(validateCredentials({ name: 'ok', password: 'x'.repeat(201) }).status, 400);
assert.equal(validateCredentials(null).status, 400);

// --- constant time compare still has to be correct ---
assert.equal(timingSafeEqual('abc', 'abc'), true);
assert.equal(timingSafeEqual('abc', 'abd'), false);
assert.equal(timingSafeEqual('abc', 'abcd'), false);
assert.equal(timingSafeEqual('', ''), true);

// --- password hashing is salted and deterministic ---
const h1 = await hashPassword('hunter22', 'saltone');
const h2 = await hashPassword('hunter22', 'saltone');
const h3 = await hashPassword('hunter22', 'salttwo');
const h4 = await hashPassword('hunter23', 'saltone');
assert.equal(h1, h2, 'same password + salt must hash the same');
assert.notEqual(h1, h3, 'different salt must change the hash');
assert.notEqual(h1, h4, 'different password must change the hash');
assert.equal(h1.length, 64);

// --- cookie parsing ---
const req = (c) => ({ headers: { get: () => c } });
assert.equal(readCookie(req('sid=abc123'), COOKIE), 'abc123');
assert.equal(readCookie(req('other=1; sid=abc123; more=2'), COOKIE), 'abc123');
assert.equal(readCookie(req('notsid=abc123'), COOKIE), null);
assert.equal(readCookie(req(''), COOKIE), null);

console.log('ok');
