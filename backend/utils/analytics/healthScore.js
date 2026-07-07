/**
 * healthScore.js — Pure school-health scoring (Phase 6). No I/O. Turns raw
 * analytics rates into 0–100 component scores, a weighted overall score, and a
 * human label. Deterministic and unit-tested so the dashboard's headline number
 * is defensible.
 */

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const r = (n) => Math.round(n);

/** Attendance: driven by attendance % and dragged down by a high late rate. */
function attendanceHealth({ attendancePercentage = 0, latePct = 0 }) {
  return clamp(r(attendancePercentage - 0.5 * latePct));
}

/** Fee: collection rate, dragged down by the share of balances that are overdue. */
function feeHealth({ collectionRatePct = 0, overdueRatePct = 0 }) {
  return clamp(r(collectionRatePct - 0.5 * overdueRatePct));
}

/** Notification: simply the delivery success rate. */
function notificationHealth({ successRatePct = 0 }) {
  return clamp(r(successRatePct));
}

const WEIGHTS = { attendance: 0.4, fee: 0.35, notification: 0.25 };

/**
 * Weighted overall from whichever components are present (null components are
 * dropped and the remaining weights renormalized, so a school with no fees yet
 * isn't unfairly scored).
 */
function overallHealth({ attendance = null, fee = null, notification = null }) {
  const parts = [];
  if (attendance != null) parts.push(['attendance', attendance]);
  if (fee != null) parts.push(['fee', fee]);
  if (notification != null) parts.push(['notification', notification]);
  if (!parts.length) return null;
  const totalWeight = parts.reduce((s, [k]) => s + WEIGHTS[k], 0);
  const score = parts.reduce((s, [k, v]) => s + v * (WEIGHTS[k] / totalWeight), 0);
  return clamp(r(score));
}

function label(score) {
  if (score == null) return 'Unknown';
  if (score >= 85) return 'Excellent';
  if (score >= 70) return 'Good';
  if (score >= 50) return 'Average';
  return 'Needs Attention';
}

module.exports = { attendanceHealth, feeHealth, notificationHealth, overallHealth, label, WEIGHTS };
