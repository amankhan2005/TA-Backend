/**
 * qrIdentity.js — Secure student QR tokens (Phase 8). Pure crypto, no I/O.
 *
 * Design goals:
 *   • NO sensitive data in the token — payload is only {sid, sc, v}
 *     (student id, school id, version). Name/photo/roll are NEVER encoded.
 *   • Tamper-evident — HMAC-SHA256 over a canonical string with a server secret.
 *     Any change to sid/sc/v invalidates the signature.
 *   • Revocable — a version field lets regeneration invalidate old tokens
 *     (the DB stores the current version; the verifier checks it separately).
 *   • School-scoped — sc is inside the signed payload, so a token can only ever
 *     resolve to its own school; cross-school forgery requires the secret.
 *
 * Token format:  v1.<base64url(payload JSON)>.<base64url(hmac)>
 */

const crypto = require('crypto');

const PREFIX = 'v1';

function secret() {
  const s = process.env.QR_SIGNING_SECRET;
  if (!s) throw new Error('QR_SIGNING_SECRET is not configured. Set a dedicated secret (it must differ from JWT_SECRET).');
  return s;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function canonical({ sid, sc, v }) {
  return `${sc}.${sid}.${v}`;
}

function sign(payload) {
  const h = crypto.createHmac('sha256', secret()).update(canonical(payload)).digest();
  return b64url(h);
}

/**
 * Build a token for a student.
 * @param {{studentId:string, schoolId:string, version:number}} p
 */
function generateToken({ studentId, schoolId, version = 1 }) {
  const payload = { sid: String(studentId), sc: String(schoolId), v: version };
  const sig = sign(payload);
  return `${PREFIX}.${b64url(JSON.stringify(payload))}.${sig}`;
}

/**
 * Verify a token's SIGNATURE (authenticity + integrity). Does NOT check the
 * version against the DB — the caller does that for revocation.
 * @returns {{valid:boolean, payload?:{sid,sc,v}, reason?:string}}
 */
function verifyToken(token) {
  if (typeof token !== 'string') return { valid: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return { valid: false, reason: 'malformed' };

  let payload;
  try { payload = JSON.parse(b64urlDecode(parts[1])); } catch { return { valid: false, reason: 'malformed' }; }
  if (!payload || payload.sid == null || payload.sc == null || payload.v == null) return { valid: false, reason: 'malformed' };

  const expected = sign(payload);
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { valid: false, reason: 'bad_signature' };

  return { valid: true, payload };
}

module.exports = { generateToken, verifyToken, sign, canonical, PREFIX };
