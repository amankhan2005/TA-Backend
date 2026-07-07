/** qrIdentity.test.js — QR token security (Phase 8). Run: QR_SIGNING_SECRET=x node utils/qrIdentity.test.js */
const assert = require('assert');
process.env.QR_SIGNING_SECRET = process.env.QR_SIGNING_SECRET || 'test-secret-123';
const qr = require('./qrIdentity');
let p = 0, f = 0;
const t = (n, fn) => { try { fn(); p++; console.log('  ✅ ' + n); } catch (e) { f++; console.log('  ❌ ' + n + ' -> ' + e.message); } };

const b64url = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const tok = qr.generateToken({ studentId: 'stu1', schoolId: 'S1', version: 1 });

t('round-trip verifies', () => { const r = qr.verifyToken(tok); assert.ok(r.valid); assert.strictEqual(r.payload.sid, 'stu1'); assert.strictEqual(r.payload.sc, 'S1'); });
t('no PII in payload', () => { const pl = JSON.parse(Buffer.from(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()); assert.deepStrictEqual(Object.keys(pl).sort(), ['sc', 'sid', 'v']); });
t('tampered sid → bad_signature', () => { const p = tok.split('.'); const r = qr.verifyToken(p[0] + '.' + b64url(JSON.stringify({ sid: 'HACK', sc: 'S1', v: 1 })) + '.' + p[2]); assert.strictEqual(r.valid, false); assert.strictEqual(r.reason, 'bad_signature'); });
t('cross-school (change sc) → invalid', () => { const p = tok.split('.'); const r = qr.verifyToken(p[0] + '.' + b64url(JSON.stringify({ sid: 'stu1', sc: 'S2', v: 1 })) + '.' + p[2]); assert.strictEqual(r.valid, false); });
t('version bump → new signature, still valid', () => { const v2 = qr.generateToken({ studentId: 'stu1', schoolId: 'S1', version: 2 }); assert.notStrictEqual(tok, v2); assert.strictEqual(qr.verifyToken(v2).payload.v, 2); });
t('different secret → bad_signature', () => { process.env.QR_SIGNING_SECRET = 'other'; const r = qr.verifyToken(tok); process.env.QR_SIGNING_SECRET = 'test-secret-123'; assert.strictEqual(r.valid, false); });
t('malformed rejected', () => { ['', 'abc', 'v1.only', null, 123].forEach((x) => assert.strictEqual(qr.verifyToken(x).valid, false)); });
t('wrong prefix rejected', () => { const p = tok.split('.'); assert.strictEqual(qr.verifyToken('v9.' + p[1] + '.' + p[2]).valid, false); });

console.log(`\nRESULT: ${p} passed, ${f} failed (of ${p + f} total)\n`);
process.exit(f ? 1 : 0);
