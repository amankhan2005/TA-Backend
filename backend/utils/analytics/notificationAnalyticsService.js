/**
 * notificationAnalyticsService.js — Notification delivery analytics for one
 * school, from NotificationLog. Tenant-scoped. success rate excludes 'skipped'
 * (plan-disabled) from the denominator since those were never attempted.
 */
const NotificationLog = require('../../models/NotificationLog');

async function notificationStats({ schoolId, from, to }) {
  const match = { schoolId };
  if (from || to) { match.createdAt = {}; if (from) match.createdAt.$gte = new Date(from); if (to) match.createdAt.$lte = new Date(to); }

  const [byStatusChannel, retryAgg] = await Promise.all([
    NotificationLog.aggregate([
      { $match: match },
      { $group: { _id: { status: '$status', channel: '$channel' }, count: { $sum: 1 } } },
    ]),
    NotificationLog.aggregate([
      { $match: match },
      { $group: { _id: null, totalRetries: { $sum: '$retryCount' }, retried: { $sum: { $cond: [{ $gt: ['$retryCount', 0] }, 1, 0] } } } },
    ]),
  ]);

  let total = 0, sent = 0, failed = 0, skipped = 0, emailDelivered = 0, whatsappDelivered = 0, pending = 0, retrying = 0;
  for (const r of byStatusChannel) {
    total += r.count;
    const { status, channel } = r._id;
    if (status === 'sent') { sent += r.count; if (channel === 'email') emailDelivered += r.count; else whatsappDelivered += r.count; }
    else if (status === 'failed') failed += r.count;
    else if (status === 'skipped') skipped += r.count;
    else if (status === 'pending') pending += r.count;
    else if (status === 'retrying') retrying += r.count;
  }
  const attempted = sent + failed; // skipped/pending not counted as attempts
  return {
    totalSent: total, sent, failed, skipped, pending, retrying,
    emailDelivered, whatsappDelivered,
    totalRetries: retryAgg[0]?.totalRetries || 0,
    messagesRetried: retryAgg[0]?.retried || 0,
    deliverySuccessRatePct: attempted > 0 ? +((sent / attempted) * 100).toFixed(1) : 0,
  };
}

module.exports = { notificationStats };
