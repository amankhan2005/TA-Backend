/**
 * promotionAnalyticsService.js — Phase 7 promotion metrics for the Phase 6
 * dashboard. Tenant-scoped. Counts non-reversed promotion records in the current
 * academic year by action.
 */
const StudentPromotionRecord = require('../../models/StudentPromotionRecord');
const { yearBounds } = require('./time');

async function promotionStats({ schoolId, ref = new Date() }) {
  const { start, end } = yearBounds(ref);
  const rows = await StudentPromotionRecord.aggregate([
    { $match: { schoolId, promotedAt: { $gte: start, $lte: end }, reversed: false } },
    { $group: { _id: '$action', count: { $sum: 1 } } },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r._id, r.count]));
  return {
    promotionsThisYear: by.promoted || 0,
    retainedStudents: by.retained || 0,
    transfersThisYear: by.transferred || 0,
  };
}

module.exports = { promotionStats };
