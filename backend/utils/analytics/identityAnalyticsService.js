/**
 * identityAnalyticsService.js — Phase 8 identity metrics for dashboards.
 * School-scoped + a platform rollup for super admin. Reuses identityService
 * health stats; adds verification + reissue counts.
 */
const RfidCard = require('../../models/RfidCard');
const RfidCardHistory = require('../../models/RfidCardHistory');
const StudentIdentity = require('../../models/StudentIdentity');
const identityService = require('../identityService');

async function identityStats({ schoolId }) {
  const [health, verifications, reissued] = await Promise.all([
    identityService.healthStats({ schoolId }),
    StudentIdentity.aggregate([{ $match: { schoolId } }, { $group: { _id: null, v: { $sum: '$verificationCount' } } }]),
    RfidCardHistory.countDocuments({ schoolId, action: 'reissued' }),
  ]);
  return {
    activeRfidStudents: health.counts.active,
    utilizationRatePct: health.utilizationRatePct,
    lostRfidCount: health.counts.lost,
    reissuedRfidCount: reissued,
    qrVerificationCount: verifications[0]?.v || 0,
    health,
  };
}

async function platformIdentityStats() {
  const [byStatus, verifications] = await Promise.all([
    RfidCard.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    StudentIdentity.aggregate([{ $group: { _id: null, v: { $sum: '$verificationCount' } } }]),
  ]);
  const by = Object.fromEntries(byStatus.map((r) => [r._id, r.count]));
  return {
    totalRfids: byStatus.reduce((s, r) => s + r.count, 0),
    activeRfids: by.active || 0,
    replacedRfids: by.replaced || 0,
    lostRfids: by.lost || 0,
    verificationRequests: verifications[0]?.v || 0,
  };
}

module.exports = { identityStats, platformIdentityStats };
