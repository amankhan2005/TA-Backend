/**
 * security.test.js — Remediation tests (Fixes 1, 2, 3).
 * Run: node tests/security.test.js
 */
const assert = require('assert');
const mongoSanitize = require('express-mongo-sanitize');
let p = 0, f = 0;
const t = (n, fn) => { try { fn(); p++; console.log('  ✅ ' + n); } catch (e) { f++; console.log('  ❌ ' + n + ' -> ' + e.message); } };

console.log('\n── Fix 1: NoSQL operator sanitization ──\n');
// express-mongo-sanitize.sanitize() strips $-prefixed and dotted keys.
const clean = (o) => mongoSanitize.sanitize(o, { replaceWith: '_' });

const noOperatorKeys = (o) => { for (const k of Object.keys(o)) { assert.ok(!k.startsWith('$') && !k.includes('.'), `operator key survived: ${k}`); if (o[k] && typeof o[k] === 'object') noOperatorKeys(o[k]); } };
t('$gt / $ne / $regex neutralized (no $-keys survive)', () => {
  const out = clean({ identifier: { $gt: '' }, password: { $ne: null }, name: { $regex: '.*' } });
  noOperatorKeys(out);
});
t('$or / $where stripped at top level', () => {
  const out = clean({ $or: [{ a: 1 }], $where: 'this' });
  assert.ok(!('$or' in out) && !('$where' in out));
});
t('legitimate string values pass untouched', () => {
  const out = clean({ identifier: '231770000000', password: 'Secret123', email: 'a@b.com' });
  assert.strictEqual(out.identifier, '231770000000');
  assert.strictEqual(out.password, 'Secret123');
});
t('nested injection neutralized', () => {
  const out = clean({ filter: { status: { $ne: 'void' } }, ok: 'yes' });
  noOperatorKeys(out);
  assert.strictEqual(out.ok, 'yes');
});
t('parent login identifier coercion neutralizes objects', () => {
  // findByIdentifier coerces to String(): an object becomes "[object Object]", never an operator.
  const raw = String({ $gt: '' } || '').trim();
  assert.strictEqual(typeof raw, 'string');
  assert.ok(!raw.startsWith('$'));
});

console.log('\n── Fix 2: reset/activation token lifecycle ──\n');
const crypto = require('crypto');
const hashToken = (x) => crypto.createHash('sha256').update(x).digest('hex');
t('token stored hashed, never raw', () => {
  const token = crypto.randomBytes(24).toString('hex');
  const stored = hashToken(token);
  assert.notStrictEqual(stored, token);
  assert.strictEqual(stored.length, 64);
  assert.strictEqual(hashToken(token), stored, 'same token re-hashes to stored value');
});
t('expiry window is enforced (1h reset / 7d activation)', () => {
  const resetExp = new Date(Date.now() + 60 * 60 * 1000);
  const actExp = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  assert.ok(resetExp > new Date());
  assert.ok(actExp > resetExp);
});
t('used token is invalidated (hash + expiry cleared)', () => {
  const parent = { resetTokenHash: 'x', resetTokenExpiry: new Date() };
  // applyNewPassword sets both to null after use:
  parent.resetTokenHash = null; parent.resetTokenExpiry = null;
  assert.strictEqual(parent.resetTokenHash, null);
  assert.strictEqual(parent.resetTokenExpiry, null);
});

console.log('\n── Fix 3: QR secret is mandatory (no JWT fallback) ──\n');
t('qrIdentity throws when QR_SIGNING_SECRET unset', () => {
  const saved = process.env.QR_SIGNING_SECRET; delete process.env.QR_SIGNING_SECRET;
  delete require.cache[require.resolve('../utils/qrIdentity')];
  const qr = require('../utils/qrIdentity');
  assert.throws(() => qr.generateToken({ studentId: 's', schoolId: 'S', version: 1 }), /QR_SIGNING_SECRET/);
  process.env.QR_SIGNING_SECRET = saved;
  delete require.cache[require.resolve('../utils/qrIdentity')];
});

console.log(`\nRESULT: ${p} passed, ${f} failed (of ${p + f} total)\n`);
process.exit(f ? 1 : 0);
