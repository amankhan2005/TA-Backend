/** accountLock.test.js — Parent account-lock policy (Phase 9). node utils/accountLock.test.js */
const assert = require('assert');
const lock = require('./accountLock');
let p = 0, f = 0;
const t = (n, fn) => { try { fn(); p++; console.log('  ✅ ' + n); } catch (e) { f++; console.log('  ❌ ' + n + ' -> ' + e.message); } };

t('failures increment', () => { const s = lock.registerFailure({ failedLoginAttempts: 0 }); assert.strictEqual(s.failedLoginAttempts, 1); assert.strictEqual(s.lockUntil, null); });
t('locks at MAX', () => { let s = { failedLoginAttempts: lock.MAX_ATTEMPTS - 1 }; s = lock.registerFailure(s); assert.strictEqual(s.failedLoginAttempts, lock.MAX_ATTEMPTS); assert.ok(s.lockUntil instanceof Date); });
t('isLocked true when lockUntil future', () => assert.strictEqual(lock.isLocked({ lockUntil: new Date(Date.now() + 60000) }), true));
t('isLocked false when past', () => assert.strictEqual(lock.isLocked({ lockUntil: new Date(Date.now() - 60000) }), false));
t('isLocked false when null', () => assert.strictEqual(lock.isLocked({ lockUntil: null }), false));
t('reset clears', () => { const s = lock.reset(); assert.strictEqual(s.failedLoginAttempts, 0); assert.strictEqual(s.lockUntil, null); });

console.log(`\nRESULT: ${p} passed, ${f} failed (of ${p + f} total)\n`);
process.exit(f ? 1 : 0);
