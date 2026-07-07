const mongoose = require('mongoose');

/**
 * NotificationLog — append-only delivery record for every parent
 * notification attempt (email or WhatsApp), regardless of outcome.
 * Powers: School Admin delivery-log views, Parent Portal notification
 * history, and the worker's retry sweep (status: 'pending'/'retrying').
 */

const notificationLogSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', default: null },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Parent', default: null },

    channel: { type: String, enum: ['email', 'whatsapp'], required: true },
    type: {
      type: String,
      enum: [
        'attendance_punch_in',
        'attendance_punch_out',
        'attendance_late',
        'fee_due',
        'fee_overdue',
        'report_ready',
      ],
      required: true,
    },

    recipient: { type: String, required: true }, // email address or phone number actually used
    status: { type: String, enum: ['pending', 'sent', 'failed', 'retrying', 'skipped'], default: 'pending' },
    providerMessageId: { type: String, default: null },
    errorMessage: { type: String, default: null },
    retryCount: { type: Number, default: 0 },
    // Template data needed to RE-SEND on retry (F-4) — the original request
    // context is gone by the time the retry sweep runs, so it's persisted here.
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    // When the retry sweep may next attempt this log (exponential backoff).
    // null = not scheduled for retry (sent / skipped / terminally failed).
    nextRetryAt: { type: Date, default: null },

    relatedReport: { type: mongoose.Schema.Types.ObjectId, ref: 'GeneratedReport', default: null },
  },
  { timestamps: true }
);

notificationLogSchema.index({ schoolId: 1, student: 1, createdAt: -1 });
notificationLogSchema.index({ status: 1, createdAt: 1 });
// Retry sweep (F-4): find failed logs whose backoff window has elapsed.
notificationLogSchema.index({ status: 1, nextRetryAt: 1 });

module.exports = mongoose.model('NotificationLog', notificationLogSchema);
