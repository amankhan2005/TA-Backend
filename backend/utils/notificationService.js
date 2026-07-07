const { enqueueJob } = require('./queue');

/**
 * notificationService.js — The ONE function other modules call to notify a
 * parent. Callers never touch email.js/whatsapp.js/NotificationLog directly
 * — this keeps channel selection (NotificationSettings), delivery-log
 * bookkeeping, and retry logic in one place.
 *
 * Fire-and-forget from the caller's perspective (enqueues, does not await
 * delivery) — mirrors the existing utils/audit.js `logEvent()` pattern:
 * marking a student's attendance must never fail or slow down because a
 * WhatsApp template happened to be down (R-9 from the risk assessment).
 *
 * Actual sending happens in worker.js's `notification.dispatch` handler.
 */

/**
 * @param {Object} params
 * @param {string} params.schoolId
 * @param {string} params.studentId  - Student._id (Mongo ObjectId string)
 * @param {'attendance_punch_in'|'attendance_punch_out'|'attendance_late'|'fee_due'|'fee_overdue'|'report_ready'} params.type
 * @param {Object} params.data - template data specific to the notification type
 *   (e.g. { time, date, className, sectionName } for attendance events;
 *    { amountDue, currency, dueDate } for fee reminders;
 *    { reportLabel, downloadUrl } for report-ready notices)
 * @param {string} [params.relatedReportId]
 * @param {{email:boolean,whatsapp:boolean}|null} [params.channelOverride]
 *   When set, bypasses NotificationSettings for THIS notification only (used by
 *   report schedules with a per-schedule delivery-method override). null = use
 *   the school's NotificationSettings as normal.
 */
async function notifyStudentEvent({ schoolId, studentId, type, data = {}, relatedReportId = null, channelOverride = null }) {
  return enqueueJob('notification.dispatch', {
    schoolId,
    studentId,
    type,
    data,
    relatedReportId,
    channelOverride,
  });
  // No idempotency key here deliberately — each real-world event (a punch-in,
  // a specific day's fee reminder) is a distinct call from the caller, unlike
  // scheduled report generation which re-runs on a timer and needs dedup (R-6).
}

module.exports = { notifyStudentEvent };
