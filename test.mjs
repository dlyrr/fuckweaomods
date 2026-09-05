// node test.mjs  -- guards the validation + cursor logic. No framework on purpose.
import assert from 'node:assert/strict';
import { stripHtml, validate, encodeCursor, decodeCursor } from './functions/api/comments.js';

// html never survives
assert.equal(stripHtml('<script>alert(1)</script>hi'), 'alert(1)hi');
assert.equal(stripHtml('  a <b>b</b>  '), 'a b');
assert.equal(stripHtml('<img src=x onerror=y>'), '');

// happy path
assert.deepEqual(validate({ name: ' me ', body: ' hello ' }), { name: 'me', body: 'hello' });

// blank name falls back, blank body is rejected
assert.equal(validate({ name: '', body: 'x' }).name, 'anon');
assert.equal(validate({ name: 'a', body: '   ' }).status, 400);
assert.equal(validate({ name: 'a', body: '<b></b>' }).status, 400);

// length caps
assert.equal(validate({ name: 'x'.repeat(25), body: 'x' }).status, 400);
assert.equal(validate({ name: 'x'.repeat(24), body: 'x' }).name.length, 24);
assert.equal(validate({ body: 'x'.repeat(501) }).status, 400);
assert.equal(validate({ body: 'x'.repeat(500) }).body.length, 500);

// honeypot
assert.equal(validate({ body: 'x', hp: 'bot' }).status, 400);
assert.equal(validate({ body: 'x', hp: '' }).body, 'x');

// junk input
assert.equal(validate(null).status, 400);
assert.equal(validate({ name: 5, body: 5 }).status, 400);

// cursor round trip, including ids that contain the separator char
const row = { created_at: 1700000000000, id: 'a-b_c' };
assert.deepEqual(decodeCursor(encodeCursor(row)), { ts: row.created_at, id: row.id });
assert.equal(decodeCursor(''), null);
assert.equal(decodeCursor('garbage'), null);
assert.equal(decodeCursor('_x'), null);

console.log('ok');
