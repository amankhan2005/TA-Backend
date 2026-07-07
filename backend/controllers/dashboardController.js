/**
 * dashboardController.js — School Admin dashboard endpoints. Thin: each handler
 * pulls schoolId from the authenticated token (never from the client) and
 * delegates to an analytics service. Tenant isolation is structural — schoolId
 * is always req.user.schoolId.
 */

const dash = require('../utils/analytics/dashboardAnalyticsService');
const attendance = require('../utils/analytics/attendanceAnalyticsService');
const { studentStats } = require('../utils/analytics/studentAnalyticsService');
const { rfidAnalytics } = require('../utils/analytics/rfidAnalyticsService');
const { feeSummary, feeRecovery } = require('../utils/analytics/feeAnalyticsService');
const { notificationStats } = require('../utils/analytics/notificationAnalyticsService');
const { storageStats } = require('../utils/analytics/storageAnalyticsService');
const { schoolTrend } = require('../utils/analytics/trendService');
const { promotionStats } = require('../utils/analytics/promotionAnalyticsService');
const { identityStats } = require('../utils/analytics/identityAnalyticsService');
const { schoolParentStats } = require('../utils/analytics/parentAnalyticsService');
const { dayBounds, weekBounds, monthBounds } = require('../utils/analytics/time');

const wrap = (fn) => async (req, res) => {
  try { res.json({ success: true, ...(await fn(req)) }); }
  catch (err) { res.status(err.code === 'BAD_METRIC' ? 400 : 500).json({ success: false, message: err.message }); }
};

const sid = (req) => req.user.schoolId;

exports.getSummary = wrap(async (req) => ({ summary: await dash.schoolSummary({ schoolId: sid(req) }) }));
exports.getStudents = wrap(async (req) => ({ students: await studentStats({ schoolId: sid(req) }) }));
exports.getRfid = wrap(async (req) => ({ rfid: await rfidAnalytics({ schoolId: sid(req) }) }));
exports.getFees = wrap(async (req) => ({ fees: await feeSummary({ schoolId: sid(req) }) }));
exports.getFeeRecovery = wrap(async (req) => ({ recovery: await feeRecovery({ schoolId: sid(req) }) }));
exports.getNotifications = wrap(async (req) => ({ notifications: await notificationStats({ schoolId: sid(req), from: req.query.from, to: req.query.to }) }));
exports.getStorage = wrap(async (req) => ({ storage: await storageStats({ schoolId: sid(req) }) }));
exports.getPromotions = wrap(async (req) => ({ promotions: await promotionStats({ schoolId: sid(req) }) }));
exports.getIdentity = wrap(async (req) => ({ identity: await identityStats({ schoolId: sid(req) }) }));
exports.getParents = wrap(async (req) => ({ parents: await schoolParentStats({ schoolId: sid(req) }) }));

exports.getHealth = wrap(async (req) => {
  const summary = await dash.schoolSummary({ schoolId: sid(req) });
  return { health: summary.health };
});

exports.getAttendance = wrap(async (req) => {
  const schoolId = sid(req);
  const period = req.query.period || 'daily';
  const b = period === 'monthly' ? monthBounds() : period === 'weekly' ? weekBounds() : dayBounds();
  const startStr = b.startStr || b.str;
  const endStr = b.endStr || b.str;
  const [today, rates, byClass, bySection] = await Promise.all([
    attendance.todaySnapshot({ schoolId }),
    attendance.attendanceRates({ schoolId }),
    attendance.classWise({ schoolId, startStr, endStr, groupBy: 'class' }),
    attendance.classWise({ schoolId, startStr, endStr, groupBy: 'section' }),
  ]);
  return { period, today, rates, byClass, bySection };
});

exports.getTrend = wrap(async (req) => {
  const { metric = 'attendance', granularity = 'daily', count } = req.query;
  const series = await schoolTrend({ schoolId: sid(req), metric, granularity, count: count ? Number(count) : undefined });
  return { metric, granularity, series };
});
