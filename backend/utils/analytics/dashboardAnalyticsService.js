/**
 * dashboardAnalyticsService.js — Composes the School Admin dashboard from the
 * per-domain services and computes the health scores. Tenant-scoped: every
 * downstream service is called with the caller's schoolId, so there is no path
 * to another school's data.
 */

const { studentStats } = require('./studentAnalyticsService');
const attendance = require('./attendanceAnalyticsService');
const { rfidAnalytics } = require('./rfidAnalyticsService');
const { feeSummary } = require('./feeAnalyticsService');
const { notificationStats } = require('./notificationAnalyticsService');
const { storageStats } = require('./storageAnalyticsService');
const { promotionStats } = require('./promotionAnalyticsService');
const { identityStats } = require('./identityAnalyticsService');
const health = require('./healthScore');
const { cached } = require('./cache');

// Sum a per-currency map's field across currencies — ONLY for computing a
// unitless ratio (health proxy). Never surfaced as a money total.
function sumAcross(byCurrency, field) {
  return Object.values(byCurrency || {}).reduce((s, c) => s + (c[field] || 0), 0);
}

function computeHealth({ rates, today, fees, notif }) {
  const latePct = today.presentToday > 0 ? (today.lateToday / today.presentToday) * 100 : 0;
  const attendanceScore = health.attendanceHealth({ attendancePercentage: rates.month, latePct });

  const collected = sumAcross(fees.collectionTotal, 'totalMinor');
  const outstanding = sumAcross(fees.pendingAndOverdue, 'outstandingMinor');
  const overdue = sumAcross(fees.pendingAndOverdue, 'overdueMinor');
  const hasFees = collected + outstanding > 0;
  const feeScore = hasFees
    ? health.feeHealth({ collectionRatePct: (collected / (collected + outstanding)) * 100, overdueRatePct: outstanding > 0 ? (overdue / outstanding) * 100 : 0 })
    : null;

  const notifScore = notif.totalSent > 0 ? health.notificationHealth({ successRatePct: notif.deliverySuccessRatePct }) : null;

  const overall = health.overallHealth({ attendance: attendanceScore, fee: feeScore, notification: notifScore });
  return {
    attendance: attendanceScore,
    fee: feeScore,
    notification: notifScore,
    overall,
    label: health.label(overall),
  };
}

async function schoolSummary({ schoolId, ref = new Date() }) {
  return cached(`dash:${schoolId}:${require('./time').toDateStr(ref)}`, 60, async () => {
    const [students, today, rates, rfid, fees, notif, storage] = await Promise.all([
      studentStats({ schoolId, ref }),
      attendance.todaySnapshot({ schoolId, ref }),
      attendance.attendanceRates({ schoolId, ref }),
      rfidAnalytics({ schoolId, ref }),
      feeSummary({ schoolId, ref }),
      notificationStats({ schoolId }),
      storageStats({ schoolId }),
    ]);
    const promotions = await promotionStats({ schoolId, ref });
    const identity = await identityStats({ schoolId });
    const healthScores = computeHealth({ rates, today, fees, notif });
    return {
      students,
      attendance: { today, rates },
      rfid, fees, notifications: notif, storage, promotions, identity,
      health: healthScores,
      generatedAt: new Date().toISOString(),
    };
  });
}

module.exports = { schoolSummary, computeHealth };
