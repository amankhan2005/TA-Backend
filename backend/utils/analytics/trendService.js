/**
 * trendService.js — Reusable trend/time-series APIs (Phase 6, Step 4). Supports
 * daily/weekly/monthly/yearly granularity. All series bucket a per-day grouping
 * into the requested periods in JS, so one code path serves every granularity.
 * School-scoped series require schoolId; these power charts for dashboards,
 * exports, and the parent portal.
 */

const StudentAttendanceRecord = require('../../models/StudentAttendanceRecord');
const FeePayment = require('../../models/FeePayment');
const NotificationLog = require('../../models/NotificationLog');
const GeneratedReport = require('../../models/GeneratedReport');
const Student = require('../../models/Student');
const { trendBuckets, toDateStr } = require('./time');
const attendance = require('./attendanceAnalyticsService');

// Fold a Map<YYYY-MM-DD, number> into the requested buckets (sum of member days).
function fold(dailyMap, buckets) {
  return buckets.map((b) => {
    let value = 0;
    const s = toDateStr(b.start), e = toDateStr(b.end);
    for (const [day, v] of dailyMap) if (day >= s && day <= e) value += v;
    return { period: b.key, value };
  });
}

async function dailyByDateField(Model, match, dateField, startStr, endStr, valueExpr = { $sum: 1 }) {
  const rows = await Model.aggregate([
    { $match: { ...match, [dateField]: { $gte: new Date(startStr), $lte: new Date(endStr + 'T23:59:59.999Z') } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: `$${dateField}` } }, value: valueExpr } },
  ]);
  return new Map(rows.map((r) => [r._id, r.value]));
}

async function studentGrowthTrend({ schoolId, granularity = 'monthly', count = 12, ref = new Date() }) {
  const buckets = trendBuckets(granularity, count, ref);
  const map = await dailyByDateField(Student, { schoolId }, 'createdAt', toDateStr(buckets[0].start), toDateStr(buckets[buckets.length - 1].end));
  const series = fold(map, buckets);
  let running = 0; // cumulative growth
  return series.map((p) => ({ period: p.period, newStudents: p.value, cumulative: (running += p.value) }));
}

async function feeCollectionTrend({ schoolId, granularity = 'monthly', count = 12, ref = new Date() }) {
  const buckets = trendBuckets(granularity, count, ref);
  const startStr = toDateStr(buckets[0].start), endStr = toDateStr(buckets[buckets.length - 1].end);
  const rows = await FeePayment.aggregate([
    { $match: { schoolId, status: 'recorded', paidAt: { $gte: new Date(startStr), $lte: new Date(endStr + 'T23:59:59.999Z') } } },
    { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt' } }, currency: '$currency' }, amt: { $sum: '$amountMinor' } } },
  ]);
  const byCurrency = {};
  for (const r of rows) { (byCurrency[r._id.currency] ||= new Map()).set(r._id.day, r.amt); }
  const out = {};
  for (const cur of Object.keys(byCurrency)) out[cur] = fold(byCurrency[cur], buckets).map((p) => ({ period: p.period, collectedMinor: p.value }));
  return out; // per-currency series
}

async function notificationTrend({ schoolId, granularity = 'daily', count = 14, ref = new Date() }) {
  const buckets = trendBuckets(granularity, count, ref);
  const map = await dailyByDateField(NotificationLog, { schoolId, status: 'sent' }, 'createdAt', toDateStr(buckets[0].start), toDateStr(buckets[buckets.length - 1].end));
  return fold(map, buckets).map((p) => ({ period: p.period, delivered: p.value }));
}

async function reportTrend({ schoolId, granularity = 'monthly', count = 12, ref = new Date() }) {
  const buckets = trendBuckets(granularity, count, ref);
  const map = await dailyByDateField(GeneratedReport, { schoolId, status: { $ne: 'failed' } }, 'generatedAt', toDateStr(buckets[0].start), toDateStr(buckets[buckets.length - 1].end));
  return fold(map, buckets).map((p) => ({ period: p.period, reports: p.value }));
}

// Dispatcher used by the trend endpoint.
async function schoolTrend({ schoolId, metric, granularity = 'daily', count, ref = new Date() }) {
  switch (metric) {
    case 'attendance': return attendance.trend({ schoolId, granularity, count: count || 14, ref });
    case 'fees':
    case 'collection': return feeCollectionTrend({ schoolId, granularity, count: count || 12, ref });
    case 'notifications': return notificationTrend({ schoolId, granularity, count: count || 14, ref });
    case 'reports': return reportTrend({ schoolId, granularity, count: count || 12, ref });
    case 'students': return studentGrowthTrend({ schoolId, granularity, count: count || 12, ref });
    default: throw Object.assign(new Error(`Unknown trend metric "${metric}".`), { code: 'BAD_METRIC' });
  }
}

module.exports = { studentGrowthTrend, feeCollectionTrend, notificationTrend, reportTrend, schoolTrend, fold };
