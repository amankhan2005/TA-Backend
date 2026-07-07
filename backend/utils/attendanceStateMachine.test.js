/**
 * attendanceStateMachine.test.js — Exhaustive tests for the ONE module in
 * this entire ERP build flagged as highest-severity risk (R-2). Run with:
 *   node utils/attendanceStateMachine.test.js
 *
 * No test framework dependency (this project has none installed) —
 * intentionally plain assert-based so it can run in any environment,
 * including CI, with zero setup.
 */

const assert = require('assert');
const { resolveScanOutcome, computeIsLate } = require('./attendanceStateMachine');

const DEFAULT_SETTINGS = {
  schoolStartTime: '08:00',
  minPunchOutDurationMinutes: 240, // 4 hours
  duplicateScanWindowMinutes: 5,
  lateThresholdMinutes: 15,
};

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
  }
}

function at(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date('2026-07-02T00:00:00');
  d.setHours(h, m, 0, 0);
  return d;
}

console.log('\n── resolveScanOutcome ──────────────────────────────────────\n');

test('1. First scan of the day → punch_in', () => {
  const result = resolveScanOutcome({ existingRecord: null, settings: DEFAULT_SETTINGS, scanTime: at('08:05') });
  assert.strictEqual(result.outcome, 'punch_in');
  assert.strictEqual(result.recordPatch.status, 'punched_in');
  assert.strictEqual(result.recordPatch.isLocked, false);
  assert.deepStrictEqual(result.recordPatch.punchInAt, at('08:05'));
});

test('2. First scan on-time (exactly at threshold boundary) is NOT late', () => {
  // start 08:00 + 15min threshold = 08:15 boundary; scan AT 08:15 is not "later than" boundary
  const result = resolveScanOutcome({ existingRecord: null, settings: DEFAULT_SETTINGS, scanTime: at('08:15') });
  assert.strictEqual(result.outcome, 'punch_in');
  assert.strictEqual(result.isLate, false);
});

test('3. First scan one minute past threshold IS late', () => {
  const result = resolveScanOutcome({ existingRecord: null, settings: DEFAULT_SETTINGS, scanTime: at('08:16') });
  assert.strictEqual(result.isLate, true);
});

test('4. First scan well before start time is not late', () => {
  const result = resolveScanOutcome({ existingRecord: null, settings: DEFAULT_SETTINGS, scanTime: at('07:30') });
  assert.strictEqual(result.isLate, false);
});

test('5. Second scan 2 minutes after punch-in (within 5-min dup window) → ignored_duplicate', () => {
  const existingRecord = { punchInAt: at('08:05'), punchOutAt: null, isLocked: false };
  const result = resolveScanOutcome({ existingRecord, settings: DEFAULT_SETTINGS, scanTime: at('08:07') });
  assert.strictEqual(result.outcome, 'ignored_duplicate');
  assert.strictEqual(result.recordPatch, null);
});

test('6. Scan exactly at the 5-minute dup boundary → NOT a duplicate (falls through to before-min-duration check)', () => {
  const existingRecord = { punchInAt: at('08:05'), punchOutAt: null, isLocked: false };
  const result = resolveScanOutcome({ existingRecord, settings: DEFAULT_SETTINGS, scanTime: at('08:10') });
  assert.strictEqual(result.outcome, 'ignored_before_min_duration');
});

test('7. Scan 30 minutes after punch-in, min duration 240min → ignored_before_min_duration', () => {
  const existingRecord = { punchInAt: at('08:05'), punchOutAt: null, isLocked: false };
  const result = resolveScanOutcome({ existingRecord, settings: DEFAULT_SETTINGS, scanTime: at('08:35') });
  assert.strictEqual(result.outcome, 'ignored_before_min_duration');
  assert.strictEqual(result.recordPatch, null);
});

test('8. Scan exactly at the 240-minute boundary → punch_out (>= duration counts as eligible)', () => {
  const existingRecord = { punchInAt: at('08:05'), punchOutAt: null, isLocked: false };
  const result = resolveScanOutcome({ existingRecord, settings: DEFAULT_SETTINGS, scanTime: at('12:05') });
  assert.strictEqual(result.outcome, 'punch_out');
  assert.strictEqual(result.recordPatch.status, 'punched_out');
  assert.strictEqual(result.recordPatch.isLocked, true);
});

test('9. Scan well after the minimum duration → punch_out', () => {
  const existingRecord = { punchInAt: at('08:05'), punchOutAt: null, isLocked: false };
  const result = resolveScanOutcome({ existingRecord, settings: DEFAULT_SETTINGS, scanTime: at('15:00') });
  assert.strictEqual(result.outcome, 'punch_out');
});

test('10. Any scan after punch-out (locked) → ignored_locked, no matter how much later', () => {
  const existingRecord = { punchInAt: at('08:05'), punchOutAt: at('12:05'), isLocked: true };
  const soon = resolveScanOutcome({ existingRecord, settings: DEFAULT_SETTINGS, scanTime: at('12:06') });
  const muchLater = resolveScanOutcome({ existingRecord, settings: DEFAULT_SETTINGS, scanTime: at('16:00') });
  assert.strictEqual(soon.outcome, 'ignored_locked');
  assert.strictEqual(muchLater.outcome, 'ignored_locked');
  assert.strictEqual(soon.recordPatch, null);
});

test('11. Locked state takes priority even if isLocked is true but punchOutAt somehow missing (defensive)', () => {
  const existingRecord = { punchInAt: at('08:05'), punchOutAt: null, isLocked: true };
  const result = resolveScanOutcome({ existingRecord, settings: DEFAULT_SETTINGS, scanTime: at('09:00') });
  assert.strictEqual(result.outcome, 'ignored_locked');
});

test('12. Custom minimum duration (60 min, e.g. "1 Hour" admin setting) — scan at 61min → punch_out', () => {
  const settings = { ...DEFAULT_SETTINGS, minPunchOutDurationMinutes: 60 };
  const existingRecord = { punchInAt: at('08:00'), punchOutAt: null, isLocked: false };
  const result = resolveScanOutcome({ existingRecord, settings, scanTime: at('09:01') });
  assert.strictEqual(result.outcome, 'punch_out');
});

test('13. Custom minimum duration (60 min) — scan at 59min → ignored_before_min_duration', () => {
  const settings = { ...DEFAULT_SETTINGS, minPunchOutDurationMinutes: 60 };
  const existingRecord = { punchInAt: at('08:00'), punchOutAt: null, isLocked: false };
  const result = resolveScanOutcome({ existingRecord, settings, scanTime: at('08:59') });
  assert.strictEqual(result.outcome, 'ignored_before_min_duration');
});

test('14. Custom duplicate window (e.g. 2 minutes instead of default 5)', () => {
  const settings = { ...DEFAULT_SETTINGS, duplicateScanWindowMinutes: 2 };
  const existingRecord = { punchInAt: at('08:00'), punchOutAt: null, isLocked: false };
  const withinCustomWindow = resolveScanOutcome({ existingRecord, settings, scanTime: at('08:01') });
  const outsideCustomWindow = resolveScanOutcome({ existingRecord, settings, scanTime: at('08:03') });
  assert.strictEqual(withinCustomWindow.outcome, 'ignored_duplicate');
  assert.strictEqual(outsideCustomWindow.outcome, 'ignored_before_min_duration');
});

test('15. Clock-skew defense: scan timestamp before recorded punch-in never causes a state change', () => {
  const existingRecord = { punchInAt: at('08:10'), punchOutAt: null, isLocked: false };
  const result = resolveScanOutcome({ existingRecord, settings: DEFAULT_SETTINGS, scanTime: at('08:05') });
  assert.strictEqual(result.outcome, 'ignored_duplicate');
  assert.strictEqual(result.recordPatch, null);
});

test('16. Missing settings falls back to sane defaults (240min duration, 5min dup window) without throwing', () => {
  const result = resolveScanOutcome({ existingRecord: null, settings: undefined, scanTime: at('08:00') });
  assert.strictEqual(result.outcome, 'punch_in');
});

test('17. Invalid scanTime throws immediately rather than silently corrupting a record', () => {
  assert.throws(() => resolveScanOutcome({ existingRecord: null, settings: DEFAULT_SETTINGS, scanTime: 'not-a-date' }), TypeError);
  assert.throws(() => resolveScanOutcome({ existingRecord: null, settings: DEFAULT_SETTINGS, scanTime: new Date('invalid') }), TypeError);
});

test('18. Full realistic day sequence: punch-in, 2 duplicate scans, 1 too-early scan, then punch-out, then 2 locked scans', () => {
  let record = null;
  const settings = { ...DEFAULT_SETTINGS, minPunchOutDurationMinutes: 240 };

  // Punch in at 08:00
  let r = resolveScanOutcome({ existingRecord: record, settings, scanTime: at('08:00') });
  assert.strictEqual(r.outcome, 'punch_in');
  record = { punchInAt: at('08:00'), punchOutAt: null, isLocked: false };

  // Accidental double-tap at 08:01 → duplicate
  r = resolveScanOutcome({ existingRecord: record, settings, scanTime: at('08:01') });
  assert.strictEqual(r.outcome, 'ignored_duplicate');

  // Another duplicate at 08:04
  r = resolveScanOutcome({ existingRecord: record, settings, scanTime: at('08:04') });
  assert.strictEqual(r.outcome, 'ignored_duplicate');

  // Kid walks past reader at lunch, 11:00 (still before 12:00 min-duration boundary)
  r = resolveScanOutcome({ existingRecord: record, settings, scanTime: at('11:00') });
  assert.strictEqual(r.outcome, 'ignored_before_min_duration');

  // Real punch-out at 12:30
  r = resolveScanOutcome({ existingRecord: record, settings, scanTime: at('12:30') });
  assert.strictEqual(r.outcome, 'punch_out');
  record = { punchInAt: at('08:00'), punchOutAt: at('12:30'), isLocked: true };

  // Scans after punch-out are all locked
  r = resolveScanOutcome({ existingRecord: record, settings, scanTime: at('12:31') });
  assert.strictEqual(r.outcome, 'ignored_locked');
  r = resolveScanOutcome({ existingRecord: record, settings, scanTime: at('16:00') });
  assert.strictEqual(r.outcome, 'ignored_locked');
});

console.log('\n── computeIsLate ────────────────────────────────────────────\n');

test('19. computeIsLate returns false when no schoolStartTime configured', () => {
  assert.strictEqual(computeIsLate(at('09:00'), {}), false);
});

test('20. computeIsLate respects a custom lateThresholdMinutes', () => {
  const settings = { schoolStartTime: '08:00', lateThresholdMinutes: 30 };
  assert.strictEqual(computeIsLate(at('08:29'), settings), false);
  assert.strictEqual(computeIsLate(at('08:31'), settings), true);
});

console.log(`\n──────────────────────────────────────────────────────────────`);
console.log(`RESULT: ${passed} passed, ${failed} failed (of ${passed + failed} total)`);
console.log(`──────────────────────────────────────────────────────────────\n`);

if (failed > 0) process.exit(1);
