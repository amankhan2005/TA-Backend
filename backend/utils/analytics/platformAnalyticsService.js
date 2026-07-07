/**
 * platformAnalyticsService.js — Super Admin platform-wide analytics. NOT
 * school-scoped by design (super admin sees everything). Only aggregate/derived
 * data crosses schools here; there is no per-school detail leak to school admins
 * (these functions are reachable only behind protect('superAdmin')).
 *
 * HONEST DATA NOTE: the current schema has no subscription-billing ledger
 * (School.status is active/inactive/suspended; there are no trial flags, renewal
 * dates, or payment records for the SaaS itself). So:
 *   • "trial schools", "expired subscriptions", "trial conversions" are NOT
 *     derivable — they are returned as null with `available:false`.
 *   • Revenue is DERIVED as MRR = Σ(active school's plan.price); monthly/
 *     quarterly/annual are projections of that MRR, and the growth trend is
 *     reconstructed from school createdAt cohorts. This is a model, not billed
 *     revenue — labelled as such.
 */

const School = require('../../models/School');
const Student = require('../../models/Student');
const Teacher = require('../../models/Teacher');
const Parent = require('../../models/Parent');
const SubscriptionPlan = require('../../models/SubscriptionPlan');
const RfidCard = require('../../models/RfidCard');
const StudentAttendanceRecord = require('../../models/StudentAttendanceRecord');
const GeneratedReport = require('../../models/GeneratedReport');
const FeeStatement = require('../../models/FeeStatement');
const FeePayment = require('../../models/FeePayment');
const NotificationLog = require('../../models/NotificationLog');
const SchoolStorage = require('../../models/SchoolStorage');
const { monthBounds, trendBuckets, toDateStr } = require('./time');
const { cached } = require('./cache');
const { platformIdentityStats } = require('./identityAnalyticsService');
const { platformParentStats } = require('./parentAnalyticsService');

async function platformSummary() {
  const [total, active, inactive, suspended, students, teachers, parents] = await Promise.all([
    School.countDocuments({}),
    School.countDocuments({ status: 'active' }),
    School.countDocuments({ status: 'inactive' }),
    School.countDocuments({ status: 'suspended' }),
    Student.countDocuments({}),
    Teacher.countDocuments({}),
    Parent.countDocuments({}),
  ]);
  return {
    schools: { total, active, inactive, suspended },
    users: { totalStudents: students, totalTeachers: teachers, totalParents: parents },
  };
}

async function subscriptionAnalytics() {
  const byPlan = await School.aggregate([
    { $group: { _id: '$subscriptionPlan', count: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } } } },
    { $lookup: { from: 'subscriptionplans', localField: '_id', foreignField: '_id', as: 'p' } },
    { $project: { _id: 0, plan: { $ifNull: [{ $arrayElemAt: ['$p.name', 0] }, 'Unknown'] }, count: 1, active: 1 } },
    { $sort: { count: -1 } },
  ]);
  return {
    schoolsByPlan: byPlan,
    activeSubscriptions: byPlan.reduce((s, p) => s + p.active, 0),
    // Not modeled in current schema:
    trialSchools: { value: null, available: false, note: 'No trial lifecycle in schema.' },
    expiredSubscriptions: { value: null, available: false, note: 'No subscription expiry dates in schema.' },
    trialConversions: { value: null, available: false, note: 'No trial/billing history in schema.' },
  };
}

async function revenueAnalytics({ ref = new Date() } = {}) {
  const rows = await School.aggregate([
    { $match: { status: 'active' } },
    { $group: { _id: '$subscriptionPlan', count: { $sum: 1 } } },
    { $lookup: { from: 'subscriptionplans', localField: '_id', foreignField: '_id', as: 'p' } },
    { $project: { _id: 0, plan: { $ifNull: [{ $arrayElemAt: ['$p.name', 0] }, 'Unknown'] }, price: { $ifNull: [{ $arrayElemAt: ['$p.price', 0] }, 0] }, count: 1 } },
  ]);
  const byPlan = rows.map((r) => ({ plan: r.plan, activeSchools: r.count, unitPrice: r.price, revenue: r.count * r.price }));
  const mrr = byPlan.reduce((s, p) => s + p.revenue, 0);

  // Derived growth trend: cumulative active-school MRR by month of creation.
  const planPrice = new Map(rows.map((r) => [r.plan, r.price]));
  const buckets = trendBuckets('monthly', 12, ref);
  const created = await School.aggregate([
    { $match: { status: 'active' } },
    { $lookup: { from: 'subscriptionplans', localField: 'subscriptionPlan', foreignField: '_id', as: 'p' } },
    { $project: { month: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, plan: { $ifNull: [{ $arrayElemAt: ['$p.name', 0] }, 'Unknown' ] }, price: { $ifNull: [{ $arrayElemAt: ['$p.price', 0] }, 0] } } },
    { $group: { _id: '$month', added: { $sum: '$price' } } },
  ]);
  const addedByMonth = new Map(created.map((c) => [c._id, c.added]));
  let running = 0;
  // seed running with everything created before the window
  const windowStart = buckets[0].key;
  for (const c of created) if (c._id < windowStart) running += c.added;
  const growthTrend = buckets.map((b) => { running += addedByMonth.get(b.key) || 0; return { period: b.key, mrr: running }; });

  return {
    basis: 'derived_mrr',
    note: 'Revenue is derived as MRR = Σ(active school plan price). No billing ledger exists; figures are projections, not invoiced revenue.',
    mrr, monthlyRevenue: mrr, quarterlyRevenue: mrr * 3, annualRevenue: mrr * 12,
    revenueByPlan: byPlan, growthTrend,
  };
}

async function usageAnalytics() {
  const [rfidCards, attendanceRecords, reports, statements, receipts, notifications] = await Promise.all([
    RfidCard.countDocuments({}),
    StudentAttendanceRecord.countDocuments({}),
    GeneratedReport.countDocuments({ status: { $ne: 'failed' } }),
    FeeStatement.countDocuments({}),
    FeePayment.countDocuments({ receiptUrl: { $ne: null } }),
    NotificationLog.countDocuments({}),
  ]);
  return {
    totalRfidCards: rfidCards,
    totalAttendanceRecords: attendanceRecords,
    totalReportsGenerated: reports,
    totalNotificationsSent: notifications,
    totalPdfsGenerated: reports + statements + receipts,
  };
}

async function schoolRankings({ limit = 10, ref = new Date() } = {}) {
  const { start } = monthBounds(ref);
  const [largest, growing, collection, storageTop] = await Promise.all([
    Student.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$schoolId', students: { $sum: 1 } } },
      { $sort: { students: -1 } }, { $limit: limit },
    ]),
    Student.aggregate([
      { $match: { status: 'active', createdAt: { $gte: start } } },
      { $group: { _id: '$schoolId', newStudents: { $sum: 1 } } },
      { $sort: { newStudents: -1 } }, { $limit: limit },
    ]),
    FeePayment.aggregate([
      { $match: { status: 'recorded' } },
      { $group: { _id: { schoolId: '$schoolId', currency: '$currency' }, collectedMinor: { $sum: '$amountMinor' } } },
      { $sort: { collectedMinor: -1 } }, { $limit: limit },
      { $project: { _id: 0, schoolId: '$_id.schoolId', currency: '$_id.currency', collectedMinor: 1 } },
    ]),
    SchoolStorage.find({}).sort({ usedBytes: -1 }).limit(limit).select('schoolId usedBytes byCategory'),
  ]);
  return {
    largestSchools: largest.map((s) => ({ schoolId: s._id, activeStudents: s.students })),
    fastestGrowingSchools: growing.map((s) => ({ schoolId: s._id, newStudentsThisMonth: s.newStudents })),
    highestCollectionSchools: collection,
    topStorageConsumers: storageTop,
    // Highest-attendance ranking requires per-school active counts joined to
    // daily presence; provided via the attendance service per school on demand.
    highestAttendanceSchools: { value: null, available: false, note: 'Compute via attendance service per school; omitted from platform rollup to avoid a full cross-school scan.' },
  };
}

async function storageAnalytics({ limit = 10 } = {}) {
  const [agg, top] = await Promise.all([
    SchoolStorage.aggregate([{ $group: { _id: null, totalBytes: { $sum: '$usedBytes' } } }]),
    SchoolStorage.find({}).sort({ usedBytes: -1 }).limit(limit).select('schoolId usedBytes byCategory'),
  ]);
  return { totalPlatformBytes: agg[0]?.totalBytes || 0, topConsumers: top, bySchoolCount: await SchoolStorage.countDocuments({}) };
}

async function platformDashboard() {
  return cached('platform:summary', 120, async () => {
    const [summary, subs, revenue, usage, rankings, storage, identity, parents] = await Promise.all([
      platformSummary(), subscriptionAnalytics(), revenueAnalytics(), usageAnalytics(), schoolRankings(), storageAnalytics(), platformIdentityStats(), platformParentStats(),
    ]);
    return { ...summary, subscriptions: subs, revenue, usage, rankings, storage, identity, parents, generatedAt: new Date().toISOString() };
  });
}

module.exports = { platformSummary, subscriptionAnalytics, revenueAnalytics, usageAnalytics, schoolRankings, storageAnalytics, platformDashboard };
