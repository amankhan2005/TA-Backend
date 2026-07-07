/**
 * notificationDelivery.js — The single per-channel send function, shared by the
 * worker's initial `notification.dispatch` and the `notification.retrySweep`
 * (F-4). Extracted so retry re-sends via the EXACT same code path as the first
 * attempt — no drift between "how we send" and "how we re-send".
 *
 * `deliverOnChannel` performs one delivery on one channel and either resolves
 * with `{ providerMessageId }` or throws (the caller logs sent/failed). It reads
 * the stored `data` payload (persisted on NotificationLog) so a retry can rebuild
 * the exact message without the original request context.
 */

const email = require('./email');
const whatsapp = require('./whatsapp');

async function deliverOnChannel({ channel, type, student, data = {} }) {
  if (channel === 'email') {
    if (type.startsWith('attendance_')) {
      await email.sendStudentAttendanceEmail({
        toEmail: student.email, schoolName: data.schoolName, schoolLogoUrl: data.schoolLogoUrl,
        studentName: student.name, studentIdNumber: student.studentId,
        className: data.className, sectionName: data.sectionName,
        date: data.date, time: data.time,
        eventType: type === 'attendance_punch_in' ? 'punch_in' : type === 'attendance_punch_out' ? 'punch_out' : 'late',
      });
      return { providerMessageId: null };
    }
    if (type === 'report_ready') {
      await email.sendReportReadyEmail({
        toEmail: student.email, schoolName: data.schoolName, schoolLogoUrl: data.schoolLogoUrl,
        studentName: data.studentName || student.name, reportLabel: data.reportLabel || 'Report', downloadUrl: data.downloadUrl,
      });
      return { providerMessageId: null };
    }
    if (type === 'fee_due' || type === 'fee_overdue') { // Phase 5-ready
      await email.sendFeeReminderEmail({
        toEmail: student.email, schoolName: data.schoolName, schoolLogoUrl: data.schoolLogoUrl,
        studentName: student.name, studentIdNumber: student.studentId,
        amountDue: data.amountDue, currency: data.currency, dueDate: data.dueDate,
        reminderType: type === 'fee_overdue' ? 'overdue' : 'due',
      });
      return { providerMessageId: null };
    }
    if (type === 'promotion') { // Phase 7
      await email.sendPromotionEmail({
        toEmail: student.email, schoolName: data.schoolName, schoolLogoUrl: data.schoolLogoUrl,
        studentName: student.name, newClassName: data.newClassName,
      });
      return { providerMessageId: null };
    }
    throw new Error(`No email template registered for notification type "${type}".`);
  }

  if (channel === 'whatsapp') {
    if (type.startsWith('attendance_')) {
      return whatsapp.sendStudentAttendanceWhatsApp({
        toNumber: student.whatsappNumber, studentName: student.name,
        eventLabel: type === 'attendance_punch_in' ? 'checked in' : type === 'attendance_punch_out' ? 'checked out' : 'arrived late',
        time: data.time, date: data.date, schoolName: data.schoolName,
      });
    }
    if (type === 'report_ready') {
      return whatsapp.sendReportReadyWhatsApp({
        toNumber: student.whatsappNumber, studentName: data.studentName || student.name,
        reportLabel: data.reportLabel || 'Report', schoolName: data.schoolName,
      });
    }
    if (type === 'fee_due' || type === 'fee_overdue') { // Phase 5-ready
      return whatsapp.sendFeeReminderWhatsApp({
        toNumber: student.whatsappNumber, studentName: student.name,
        amountDue: data.amountDue, currency: data.currency, dueDate: data.dueDate, schoolName: data.schoolName,
      });
    }
    if (type === 'promotion') { // Phase 7
      return whatsapp.sendPromotionWhatsApp({
        toNumber: student.whatsappNumber, studentName: student.name,
        newClassName: data.newClassName, schoolName: data.schoolName,
      });
    }
    throw new Error(`No WhatsApp template registered for notification type "${type}".`);
  }

  throw new Error(`Unknown notification channel "${channel}".`);
}

/**
 * Exponential backoff for the retry sweep. retryCount 0→5min, 1→10, 2→20, 3→40…
 * capped so a stuck message doesn't drift months into the future.
 */
function computeNextRetryAt(retryCount, baseMinutes = 5, capMinutes = 24 * 60) {
  const delayMin = Math.min(baseMinutes * Math.pow(2, retryCount), capMinutes);
  return new Date(Date.now() + delayMin * 60 * 1000);
}

module.exports = { deliverOnChannel, computeNextRetryAt };
