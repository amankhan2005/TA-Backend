/**
 * reportScheduling.test.js — Exhaustive tests for the pure scheduling logic
 * (Phase 4). Run with:  node utils/reportScheduling.test.js
 *
 * No test-framework dependency — plain assert, same style as
 * attendanceStateMachine.test.js, so it runs anywhere with zero setup.
 */

const assert = require('assert');
const {
  isScheduleDueOn, computeReportPeriod, lastDayOfMonth, clampDayOfMonth,
} = require('./reportScheduling');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}`); console.error(`     ${err.message}`); }
}

// Local-midnight date helper (no timezone surprises for date-only logic).
function d(y, m, day) { return new Date(y, m - 1, day); }

console.log('\n── isScheduleDueOn ─────────────────────────────────────────\n');

test('daily fires every day', () => {
  assert.strictEqual(isScheduleDueOn({ frequency: 'daily' }, d(2026, 7, 2)), true);
  assert.strictEqual(isScheduleDueOn({ frequency: 'daily' }, d(2026, 2, 28)), true);
});

test('weekly "Every Sunday" fires only on Sundays', () => {
  const s = { frequency: 'weekly', dayOfWeek: 0 };
  assert.strictEqual(isScheduleDueOn(s, d(2026, 7, 5)), true);  // 2026-07-05 is a Sunday
  assert.strictEqual(isScheduleDueOn(s, d(2026, 7, 6)), false); // Monday
  assert.strictEqual(isScheduleDueOn(s, d(2026, 7, 4)), false); // Saturday
});

test('weekly matches an arbitrary weekday correctly', () => {
  const wed = { frequency: 'weekly', dayOfWeek: 3 };
  assert.strictEqual(isScheduleDueOn(wed, d(2026, 7, 1)), true);  // 2026-07-01 is a Wednesday
  assert.strictEqual(isScheduleDueOn(wed, d(2026, 7, 2)), false);
});

test('monthly "start" fires only on the 1st', () => {
  const s = { frequency: 'monthly', monthlyMode: 'start' };
  assert.strictEqual(isScheduleDueOn(s, d(2026, 7, 1)), true);
  assert.strictEqual(isScheduleDueOn(s, d(2026, 7, 2)), false);
  assert.strictEqual(isScheduleDueOn(s, d(2026, 12, 1)), true);
});

test('monthly "end" fires on the last day — 31-day month', () => {
  const s = { frequency: 'monthly', monthlyMode: 'end' };
  assert.strictEqual(isScheduleDueOn(s, d(2026, 7, 31)), true);
  assert.strictEqual(isScheduleDueOn(s, d(2026, 7, 30)), false);
});

test('monthly "end" fires on the last day — 30-day month', () => {
  const s = { frequency: 'monthly', monthlyMode: 'end' };
  assert.strictEqual(isScheduleDueOn(s, d(2026, 6, 30)), true);
  assert.strictEqual(isScheduleDueOn(s, d(2026, 6, 29)), false);
});

test('LEAP YEAR: monthly "end" fires Feb 29 in a leap year, not Feb 28', () => {
  const s = { frequency: 'monthly', monthlyMode: 'end' };
  assert.strictEqual(isScheduleDueOn(s, d(2024, 2, 29)), true);  // 2024 is a leap year
  assert.strictEqual(isScheduleDueOn(s, d(2024, 2, 28)), false);
});

test('NON-LEAP YEAR: monthly "end" fires Feb 28', () => {
  const s = { frequency: 'monthly', monthlyMode: 'end' };
  assert.strictEqual(isScheduleDueOn(s, d(2025, 2, 28)), true);  // 2025 is not a leap year
  assert.strictEqual(isScheduleDueOn(s, d(2025, 2, 27)), false);
});

test('monthly "day" fires on the exact configured day', () => {
  const s = { frequency: 'monthly', monthlyMode: 'day', dayOfMonth: 15 };
  assert.strictEqual(isScheduleDueOn(s, d(2026, 7, 15)), true);
  assert.strictEqual(isScheduleDueOn(s, d(2026, 7, 14)), false);
});

test('custom day 31 CLAMPS into short months (fires once, on the last day)', () => {
  const s = { frequency: 'custom', dayOfMonth: 31 };
  assert.strictEqual(isScheduleDueOn(s, d(2025, 2, 28)), true);  // Feb 2025: clamps 31→28
  assert.strictEqual(isScheduleDueOn(s, d(2024, 2, 29)), true);  // Feb 2024: clamps 31→29
  assert.strictEqual(isScheduleDueOn(s, d(2026, 4, 30)), true);  // April: clamps 31→30
  assert.strictEqual(isScheduleDueOn(s, d(2026, 7, 31)), true);  // July: exact 31
  assert.strictEqual(isScheduleDueOn(s, d(2026, 7, 30)), false);
});

test('unknown/malformed frequency never fires', () => {
  assert.strictEqual(isScheduleDueOn({ frequency: 'yearly' }, d(2026, 7, 2)), false);
  assert.strictEqual(isScheduleDueOn({}, d(2026, 7, 2)), false);
});

test('invalid date is rejected loudly', () => {
  assert.throws(() => isScheduleDueOn({ frequency: 'daily' }, new Date('nope')), TypeError);
});

console.log('\n── computeReportPeriod ─────────────────────────────────────\n');

test('daily period is exactly yesterday', () => {
  const p = computeReportPeriod({ frequency: 'daily' }, d(2026, 7, 2));
  assert.strictEqual(p.startStr, '2026-07-01');
  assert.strictEqual(p.endStr, '2026-07-01');
});

test('daily period crosses a month boundary correctly', () => {
  const p = computeReportPeriod({ frequency: 'daily' }, d(2026, 8, 1));
  assert.strictEqual(p.startStr, '2026-07-31');
  assert.strictEqual(p.endStr, '2026-07-31');
});

test('weekly period is the trailing 7 days ending yesterday', () => {
  const p = computeReportPeriod({ frequency: 'weekly', dayOfWeek: 0 }, d(2026, 7, 5)); // Sunday
  assert.strictEqual(p.startStr, '2026-06-28');
  assert.strictEqual(p.endStr, '2026-07-04');
});

test('monthly "start" period is the PREVIOUS full month', () => {
  const p = computeReportPeriod({ frequency: 'monthly', monthlyMode: 'start' }, d(2026, 7, 1));
  assert.strictEqual(p.startStr, '2026-06-01');
  assert.strictEqual(p.endStr, '2026-06-30');
  assert.ok(p.label.includes('June 2026'));
});

test('monthly "start" in January reports the PREVIOUS DECEMBER (year rolls back)', () => {
  const p = computeReportPeriod({ frequency: 'monthly', monthlyMode: 'start' }, d(2026, 1, 1));
  assert.strictEqual(p.startStr, '2025-12-01');
  assert.strictEqual(p.endStr, '2025-12-31');
});

test('monthly "end" period is the month that is ENDING (inclusive of the last day)', () => {
  const p = computeReportPeriod({ frequency: 'monthly', monthlyMode: 'end' }, d(2026, 7, 31));
  assert.strictEqual(p.startStr, '2026-07-01');
  assert.strictEqual(p.endStr, '2026-07-31');
  assert.ok(p.label.includes('July 2026'));
});

test('LEAP YEAR: monthly "end" for Feb covers through Feb 29', () => {
  const p = computeReportPeriod({ frequency: 'monthly', monthlyMode: 'end' }, d(2024, 2, 29));
  assert.strictEqual(p.startStr, '2024-02-01');
  assert.strictEqual(p.endStr, '2024-02-29');
});

console.log('\n── helpers ─────────────────────────────────────────────────\n');

test('lastDayOfMonth handles Feb in leap vs non-leap', () => {
  assert.strictEqual(lastDayOfMonth(2024, 1), 29); // Feb 2024
  assert.strictEqual(lastDayOfMonth(2025, 1), 28); // Feb 2025
  assert.strictEqual(lastDayOfMonth(2026, 3), 30); // April
});

test('clampDayOfMonth clamps and floors', () => {
  assert.strictEqual(clampDayOfMonth(31, 2025, 1), 28);
  assert.strictEqual(clampDayOfMonth(15, 2026, 6), 15);
  assert.strictEqual(clampDayOfMonth(0, 2026, 6), 1);
});

console.log(`\n── RESULT: ${passed} passed, ${failed} failed (of ${passed + failed} total) ──\n`);
if (failed > 0) process.exit(1);
