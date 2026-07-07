/**
 * platformController.js — Super Admin platform endpoints. Reachable only behind
 * protect('superAdmin'); functions return platform-wide aggregates only (no
 * per-school admin data path exists here).
 */
const platform = require('../utils/analytics/platformAnalyticsService');

const wrap = (fn) => async (req, res) => {
  try { res.json({ success: true, ...(await fn(req)) }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getSummary = wrap(async () => ({ platform: await platform.platformDashboard() }));
exports.getRevenue = wrap(async () => ({ revenue: await platform.revenueAnalytics() }));
exports.getSubscriptions = wrap(async () => ({ subscriptions: await platform.subscriptionAnalytics() }));
exports.getUsage = wrap(async () => ({ usage: await platform.usageAnalytics() }));
exports.getRankings = wrap(async (req) => ({ rankings: await platform.schoolRankings({ limit: req.query.limit ? Number(req.query.limit) : 10 }) }));
exports.getStorage = wrap(async () => ({ storage: await platform.storageAnalytics() }));
