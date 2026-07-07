/**
 * attendanceSummary.test.js — Tests for the pure report-summary logic.
 * Run with:  node utils/attendanceSummary.test.js
 */

const assert = require('assert');
const {
  computeAttendanceSummary, eachDateStr, isSchoolDay, isHoliday, formatDuration,
} = require('./attendanceSummary');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}`); console.error(`     ${err.message}`); }
}

// Build a punch-in(/out) record for a date at given local times.
function rec(dateStr, inH, inM, outH, outM, isLate = false) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const punchInAt = new Date(y, m - 1, d, inH, inM);
  const punchOutAt = outH != null ? new Date(y, m - 1, d, outH, outM) : null;
  return { date: dateStr, punchInAt, punchOutAt, isLate };
}

console.log('\n── eachDateStr ─────────────────────────────────────────────\n');

test('inclusive single day', () => {
  assert.deepStrictEqual(eachDateStr('2026-07-02', '2026-07-02'), ['2026-07-02']);
});

test('crosses month boundary, inclusive both ends', () => {
  assert.deepStrictEqual(eachDateStr('2026-06-29', '2026-07-02'),
    ['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02']);
});

test('LEAP: February 2024 includes the 29th', () => {
  const days = eachDateStr('2024-02-27', '2024-03-01');
  assert.ok(days.includes('2024-02-29'));
  assert.strictEqual(days.length, 4);
});

console.log('\n── isSchoolDay / isHoliday ─────────────────────────────────\n');

test('weekend excluded when in weeklyOffDays', () => {
  // 2026-07-05 is Sunday(0), 2026-07-04 Saturday(6)
  assert.strictEqual(isSchoolDay('2026-07-05', [0, 6], []), false);
  assert.strictEqual(isSchoolDay('2026-07-04', [0, 6], []), false);
  assert.strictEqual(isSchoolDay('2026-07-03', [0, 6], []), true); // Friday
});

test('exact holiday excluded; inactive holiday ignored', () => {
  assert.strictEqual(isHoliday('2026-07-26', [{ date: '2026-07-26', isActive: true }]), true);
  assert.strictEqual(isHoliday('2026-07-26', [{ date: '2026-07-26', isActive: false }]), false);
});

test('recurring holiday matches by MM-DD across years', () => {
  const h = [{ date: '2020-07-26', recurring: true, isActive: true }]; // Liberia Independence Day
  assert.strictEqual(isHoliday('2026-07-26', h), true);
  assert.strictEqual(isHoliday('2026-07-27', h), false);
});

console.log('\n── computeAttendanceSummary ────────────────────────────────\n');

test('all-present week (Mon–Fri), weekends off → 100%', () => {
  const records = [
    rec('2026-07-06', 8, 0, 15, 0), // Mon
    rec('2026-07-07', 8, 0, 15, 0),
    rec('2026-07-08', 8, 0, 15, 0),
    rec('2026-07-09', 8, 0, 15, 0),
    rec('2026-07-10', 8, 0, 15, 0), // Fri
  ];
  const s = computeAttendanceSummary({
    records, periodStart: '2026-07-06', periodEnd: '2026-07-12', weeklyOffDays: [0, 6], holidays: [],
  });
  assert.strictEqual(s.schoolDays, 5);   // Sat+Sun excluded
  assert.strictEqual(s.presentDays, 5);
  assert.strictEqual(s.absentDays, 0);
  assert.strictEqual(s.attendancePercentage, 100);
});

test('two absences in a 5-day school week → 60%', () => {
  const records = [
    rec('2026-07-06', 8, 0, 15, 0),
    rec('2026-07-07', 8, 0, 15, 0),
    rec('2026-07-08', 8, 0, 15, 0),
    // 07-09 and 07-10 absent
  ];
  const s = computeAttendanceSummary({
    records, periodStart: '2026-07-06', periodEnd: '2026-07-12', weeklyOffDays: [0, 6], holidays: [],
  });
  assert.strictEqual(s.schoolDays, 5);
  assert.strictEqual(s.presentDays, 3);
  assert.strictEqual(s.absentDays, 2);
  assert.strictEqual(s.attendancePercentage, 60);
});

test('a holiday inside the week is not counted as absent', () => {
  const records = [
    rec('2026-07-06', 8, 0, 15, 0),
    rec('2026-07-07', 8, 0, 15, 0),
    rec('2026-07-08', 8, 0, 15, 0),
    rec('2026-07-09', 8, 0, 15, 0),
    // 07-10 is a declared holiday; student absent but it must not count against them
  ];
  const s = computeAttendanceSummary({
    records, periodStart: '2026-07-06', periodEnd: '2026-07-12',
    weeklyOffDays: [0, 6], holidays: [{ date: '2026-07-10', isActive: true }],
  });
  assert.strictEqual(s.schoolDays, 4); // Mon-Thu (Fri holiday, Sat/Sun off)
  assert.strictEqual(s.presentDays, 4);
  assert.strictEqual(s.absentDays, 0);
  assert.strictEqual(s.attendancePercentage, 100);
});

test('late arrivals are counted and present at the same time', () => {
  const records = [
    rec('2026-07-06', 8, 30, 15, 0, true),  // late
    rec('2026-07-07', 8, 0, 15, 0, false),
    rec('2026-07-08', 8, 45, 15, 0, true),  // late
  ];
  const s = computeAttendanceSummary({
    records, periodStart: '2026-07-06', periodEnd: '2026-07-08', weeklyOffDays: [0, 6], holidays: [],
  });
  assert.strictEqual(s.presentDays, 3);
  assert.strictEqual(s.lateDays, 2);
  const lateDetail = s.details.find((x) => x.date === '2026-07-06');
  assert.strictEqual(lateDetail.status, 'late');
});

test('details include punch times and duration for present days', () => {
  const s = computeAttendanceSummary({
    records: [rec('2026-07-06', 8, 0, 14, 30)],
    periodStart: '2026-07-06', periodEnd: '2026-07-06', weeklyOffDays: [0, 6], holidays: [],
  });
  const day = s.details[0];
  assert.strictEqual(day.punchIn, '08:00');
  assert.strictEqual(day.punchOut, '14:30');
  assert.strictEqual(day.duration, '6h 30m');
});

test('present-but-no-punchout day still counts present, duration null', () => {
  const s = computeAttendanceSummary({
    records: [rec('2026-07-06', 8, 0, null, null)],
    periodStart: '2026-07-06', periodEnd: '2026-07-06', weeklyOffDays: [0, 6], holidays: [],
  });
  assert.strictEqual(s.presentDays, 1);
  assert.strictEqual(s.details[0].duration, null);
});

test('empty records over a school week → 0% with correct denominator', () => {
  const s = computeAttendanceSummary({
    records: [], periodStart: '2026-07-06', periodEnd: '2026-07-10', weeklyOffDays: [0, 6], holidays: [],
  });
  assert.strictEqual(s.schoolDays, 5);
  assert.strictEqual(s.presentDays, 0);
  assert.strictEqual(s.absentDays, 5);
  assert.strictEqual(s.attendancePercentage, 0);
});

test('punch-in on a weekend is shown but excluded from the percentage', () => {
  const s = computeAttendanceSummary({
    records: [rec('2026-07-05', 9, 0, 12, 0)], // Sunday extra session
    periodStart: '2026-07-05', periodEnd: '2026-07-05', weeklyOffDays: [0, 6], holidays: [],
  });
  assert.strictEqual(s.schoolDays, 0);
  assert.strictEqual(s.attendancePercentage, 0);
  assert.strictEqual(s.details[0].status, 'present_non_school_day');
});

test('formatDuration edge cases', () => {
  const a = new Date(2026, 6, 6, 8, 0);
  assert.strictEqual(formatDuration(a, new Date(2026, 6, 6, 8, 45)), '45m');
  assert.strictEqual(formatDuration(a, a), null);      // zero
  assert.strictEqual(formatDuration(a, null), null);   // missing punch-out
});

console.log(`\n── RESULT: ${passed} passed, ${failed} failed (of ${passed + failed} total) ──\n`);
if (failed > 0) process.exit(1);
