/**
 * historicalPlacement.test.js — Snapshot-with-fallback semantics (Phase 7.1).
 * Run:  node utils/analytics/historicalPlacement.test.js
 *
 * resolvePlacement mirrors the exact $ifNull expression used in the aggregation
 * pipelines, so proving it here proves the analytics grouping semantics.
 */
const assert = require('assert');
const { resolvePlacement, groupKeyExpr } = require('./historicalPlacement');

let passed = 0, failed = 0;
const test = (n, fn) => { try { fn(); passed++; console.log(`  ✅ ${n}`); } catch (e) { failed++; console.log(`  ❌ ${n}\n     ${e.message}`); } };

console.log('\n── resolvePlacement ──\n');

test('promotion: snapshot wins over current', () => {
  // Aman had attendance in Grade 5 (2026); now promoted to Grade 6 (2027).
  const record = { classSnapshot: 'G5', sessionSnapshot: '2026' };
  const student = { class: 'G6', session: '2027' };
  assert.strictEqual(resolvePlacement(record, student, 'class'), 'G5');
  assert.strictEqual(resolvePlacement(record, student, 'session'), '2026');
});

test('transfer: section snapshot preserved', () => {
  const record = { sectionSnapshot: 'A' };
  const student = { section: 'B' }; // transferred A→B later
  assert.strictEqual(resolvePlacement(record, student, 'section'), 'A');
});

test('retention: snapshot equals current (stays consistent)', () => {
  const record = { classSnapshot: 'G5' };
  const student = { class: 'G5' };
  assert.strictEqual(resolvePlacement(record, student, 'class'), 'G5');
});

test('backward-compat: null snapshot falls back to current', () => {
  const record = { classSnapshot: null };
  const student = { class: 'G6' };
  assert.strictEqual(resolvePlacement(record, student, 'class'), 'G6');
});

test('no snapshot key at all → current (old records)', () => {
  assert.strictEqual(resolvePlacement({}, { class: 'G3' }, 'class'), 'G3');
});

test('groupKeyExpr shape matches pipeline usage', () => {
  assert.deepStrictEqual(groupKeyExpr('class'), { $ifNull: ['$classSnapshot', '$st.class'] });
  assert.deepStrictEqual(groupKeyExpr('section', 'st'), { $ifNull: ['$sectionSnapshot', '$st.section'] });
});

console.log('\n── simulated class-wise rollup (the promotion scenario) ──\n');

test('2026 attendance still counts under Grade 5 after promotion to Grade 6', () => {
  // Two attendance records for Aman: one taken in 2026 (snapshot Grade 5),
  // one older legacy record with no snapshot. Aman is now in Grade 6.
  const records = [
    { student: 'aman', classSnapshot: 'G5' }, // created 2026, pre-promotion
    { student: 'aman', classSnapshot: null },  // legacy record, no snapshot
  ];
  const students = { aman: { class: 'G6' } }; // current placement after promotion

  const byClass = {};
  for (const r of records) {
    const key = resolvePlacement(r, students[r.student], 'class');
    byClass[key] = (byClass[key] || 0) + 1;
  }
  assert.strictEqual(byClass.G5, 1, 'snapshot record counts under Grade 5');
  assert.strictEqual(byClass.G6, 1, 'legacy record falls back to current Grade 6');
  // The key guarantee: the 2026 record did NOT move to Grade 6.
  assert.ok(!(byClass.G6 > 1), 'promotion did not rewrite the historical 2026 record');
});

console.log(`\nRESULT: ${passed} passed, ${failed} failed (of ${passed + failed} total)\n`);
process.exit(failed ? 1 : 0);
