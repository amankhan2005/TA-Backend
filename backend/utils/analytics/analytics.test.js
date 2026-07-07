/**
 * analytics.test.js — Pure Phase 6 analytics logic (no DB).
 * Run:  node utils/analytics/analytics.test.js
 */
const assert = require('assert');
const health = require('./healthScore');
const time = require('./time');
const { fold } = require('./trendService');
const { computeHealth } = require('./dashboardAnalyticsService');

let passed = 0, failed = 0;
const test = (n, fn) => { try { fn(); passed++; console.log(`  ✅ ${n}`); } catch (e) { failed++; console.log(`  ❌ ${n}`); console.log(`     ${e.message}`); } };

console.log('\n── healthScore ──\n');
test('attendance drags on late rate', () => assert.strictEqual(health.attendanceHealth({ attendancePercentage: 90, latePct: 10 }), 85));
test('attendance clamps to 0', () => assert.strictEqual(health.attendanceHealth({ attendancePercentage: 5, latePct: 100 }), 0));
test('fee health', () => assert.strictEqual(health.feeHealth({ collectionRatePct: 80, overdueRatePct: 25 }), 68));
test('notification health = success rate', () => assert.strictEqual(health.notificationHealth({ successRatePct: 95 }), 95));
test('overall weights + renormalizes when fee null', () => {
  // only attendance(80) + notification(90): weights 0.4 & 0.25 → renorm to 0.615/0.385
  const s = health.overallHealth({ attendance: 80, fee: null, notification: 90 });
  assert.strictEqual(s, Math.round(80 * (0.4 / 0.65) + 90 * (0.25 / 0.65)));
});
test('overall null when no components', () => assert.strictEqual(health.overallHealth({}), null));
test('labels', () => {
  assert.strictEqual(health.label(90), 'Excellent');
  assert.strictEqual(health.label(75), 'Good');
  assert.strictEqual(health.label(55), 'Average');
  assert.strictEqual(health.label(40), 'Needs Attention');
  assert.strictEqual(health.label(null), 'Unknown');
});

console.log('\n── time bounds & buckets ──\n');
test('dayBounds str', () => assert.strictEqual(time.dayBounds(new Date('2026-07-03T15:00:00Z')).str, '2026-07-03'));
test('monthBounds spans full month', () => {
  const m = time.monthBounds(new Date('2026-02-15T00:00:00Z'));
  assert.strictEqual(m.startStr, '2026-02-01'); assert.strictEqual(m.endStr, '2026-02-28');
});
test('monthBounds leap Feb', () => assert.strictEqual(time.monthBounds(new Date('2024-02-10T00:00:00Z')).endStr, '2024-02-29'));
test('daily trend buckets: count + ascending keys', () => {
  const b = time.trendBuckets('daily', 7, new Date('2026-07-03T00:00:00Z'));
  assert.strictEqual(b.length, 7);
  assert.strictEqual(b[0].key, '2026-06-27'); assert.strictEqual(b[6].key, '2026-07-03');
});
test('monthly buckets keyed YYYY-MM', () => {
  const b = time.trendBuckets('monthly', 3, new Date('2026-07-15T00:00:00Z'));
  assert.deepStrictEqual(b.map((x) => x.key), ['2026-05', '2026-06', '2026-07']);
});
test('yearly buckets keyed YYYY', () => {
  const b = time.trendBuckets('yearly', 2, new Date('2026-07-15T00:00:00Z'));
  assert.deepStrictEqual(b.map((x) => x.key), ['2025', '2026']);
});

console.log('\n── fold (daily → buckets) ──\n');
test('fold sums member days into buckets', () => {
  const buckets = time.trendBuckets('monthly', 2, new Date('2026-07-15T00:00:00Z')); // Jun, Jul
  const daily = new Map([['2026-06-10', 5], ['2026-06-20', 3], ['2026-07-01', 7]]);
  const s = fold(daily, buckets);
  assert.deepStrictEqual(s, [{ period: '2026-06', value: 8 }, { period: '2026-07', value: 7 }]);
});

console.log('\n── computeHealth composition (multi-currency ratio) ──\n');
test('composes attendance+fee+notification into overall+label', () => {
  const h = computeHealth({
    rates: { month: 90 },
    today: { presentToday: 100, lateToday: 10 },
    fees: {
      collectionTotal: { USD: { totalMinor: 80000 }, INR: { totalMinor: 0 } },
      pendingAndOverdue: { USD: { outstandingMinor: 20000, overdueMinor: 5000 } },
    },
    notif: { totalSent: 100, deliverySuccessRatePct: 95 },
  });
  assert.strictEqual(h.attendance, 85);
  assert.strictEqual(h.fee, 68);
  assert.strictEqual(h.notification, 95);
  assert.strictEqual(h.overall, Math.round(85 * 0.4 + 68 * 0.35 + 95 * 0.25)); // 82
  assert.strictEqual(h.label, 'Good');
});
test('fee null when school has no fees yet', () => {
  const h = computeHealth({ rates: { month: 100 }, today: { presentToday: 10, lateToday: 0 }, fees: { collectionTotal: {}, pendingAndOverdue: {} }, notif: { totalSent: 0, deliverySuccessRatePct: 0 } });
  assert.strictEqual(h.fee, null); assert.strictEqual(h.notification, null); assert.strictEqual(h.attendance, 100);
  assert.strictEqual(h.overall, 100); assert.strictEqual(h.label, 'Excellent');
});

console.log(`\nRESULT: ${passed} passed, ${failed} failed (of ${passed + failed} total)\n`);
process.exit(failed ? 1 : 0);
