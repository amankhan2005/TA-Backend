/**
 * promotionEngine.test.js — Pure preview/validation (no DB).
 * Run:  node utils/promotionEngine.test.js
 */
const assert = require('assert');
const { buildPreview } = require('./promotionEngine');

let passed = 0, failed = 0;
const test = (n, fn) => { try { fn(); passed++; console.log(`  ✅ ${n}`); } catch (e) { failed++; console.log(`  ❌ ${n}\n     ${e.message}`); } };

const S = (id, over = {}) => ({ _id: id, studentId: 'STU-' + id, name: 'S' + id, class: 'C1', section: 'SEC1', session: 'SESS1', status: 'active', ...over });
const dest = { session: 'SESS2', class: 'C2', section: 'SEC2' };

console.log('\n── categorization ──\n');

test('all active promote', () => {
  const p = buildPreview({ students: [S(1), S(2)], destination: dest, mode: 'class' });
  assert.strictEqual(p.counts.toPromote, 2);
  assert.strictEqual(p.counts.toRetain, 0);
  assert.ok(p.executable);
});

test('retained set → toRetain', () => {
  const p = buildPreview({ students: [S(1), S(2), S(3)], destination: dest, retainedSet: new Set(['2']), mode: 'class' });
  assert.strictEqual(p.counts.toPromote, 2);
  assert.strictEqual(p.counts.toRetain, 1);
  assert.strictEqual(p.toRetain[0].id, '2');
});

test('inactive excluded (not promoted)', () => {
  const p = buildPreview({ students: [S(1), S(2, { status: 'inactive' })], destination: dest, mode: 'class' });
  assert.strictEqual(p.counts.toPromote, 1);
  assert.strictEqual(p.counts.inactive, 1);
});

test('missing placement → missingData', () => {
  const p = buildPreview({ students: [S(1), S(2, { section: null })], destination: dest, mode: 'class' });
  assert.strictEqual(p.counts.missingData, 1);
  assert.strictEqual(p.counts.toPromote, 1);
});

test('outstanding fees flagged as issue but still promotable', () => {
  const p = buildPreview({ students: [S(1)], destination: dest, outstandingMap: new Map([['1', 5000]]), mode: 'class' });
  assert.strictEqual(p.counts.toPromote, 1);
  assert.strictEqual(p.counts.withIssues, 1);
  assert.match(p.withIssues[0].issues[0], /Outstanding fees/);
});

test('source class mismatch flagged', () => {
  const p = buildPreview({ students: [S(1, { class: 'CX' })], source: { class: 'C1' }, destination: dest, mode: 'class' });
  assert.strictEqual(p.counts.withIssues, 1);
  assert.match(p.withIssues[0].issues.join(' '), /source class/);
});

test('empty / all-retained executable flag', () => {
  const none = buildPreview({ students: [S(1, { status: 'inactive' })], destination: dest, mode: 'class' });
  assert.strictEqual(none.executable, false); // nothing to move
  const retain = buildPreview({ students: [S(1)], destination: dest, retainedSet: new Set(['1']), mode: 'retention' });
  assert.strictEqual(retain.executable, true); // retention counts as executable
});

test('destination required (except retention)', () => {
  assert.throws(() => buildPreview({ students: [S(1)], destination: {}, mode: 'class' }));
  assert.doesNotThrow(() => buildPreview({ students: [S(1)], destination: {}, retainedSet: new Set(['1']), mode: 'retention' }));
});

console.log(`\nRESULT: ${passed} passed, ${failed} failed (of ${passed + failed} total)\n`);
process.exit(failed ? 1 : 0);
