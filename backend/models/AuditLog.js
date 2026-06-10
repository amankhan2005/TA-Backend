const mongoose = require('mongoose');

/**
 * AuditLog — Immutable event log for every significant admin action.
 *
 * Design decisions:
 *  - Single collection for both Super Admin and School Admin events.
 *    schoolId is null for platform-level events (superAdmin acting on the platform).
 *  - action uses dot-notation namespacing: "auth.login", "teacher.create", etc.
 *  - actor stores who did it; target stores what was affected.
 *  - metadata is a free-form object — avoids needing schema changes for new event types.
 *  - No updates or deletes on this collection — logs are append-only.
 *  - TTL index: auto-expire after 1 year (configurable via AUDIT_LOG_TTL_DAYS).
 */

const auditLogSchema = new mongoose.Schema(
  {
    // ── Who did it ─────────────────────────────────────────────────────────
    actorId:    { type: String, required: true },          // userId (string form)
    actorEmail: { type: String, required: true },
    actorRole:  { type: String, required: true, enum: ['superAdmin', 'schoolAdmin', 'system'] },

    // ── School scope (null = platform-level superAdmin action) ─────────────
    schoolId:   { type: String, default: null, index: true },

    // ── What happened ──────────────────────────────────────────────────────
    action: {
      type: String,
      required: true,
      enum: [
        // Auth
        'auth.login.success',
        'auth.login.failed',
        'auth.logout',
        'auth.password.changed',
        'auth.password.reset_requested',
        'auth.password.reset_completed',

        // School lifecycle (Super Admin)
        'school.invite.sent',
        'school.invite.resent',
        'school.registered',
        'school.status.changed',         // activate / deactivate / suspend
        'school.plan.changed',           // subscription plan updated
        'school.logo.updated',

        // Teacher management (School Admin)
        'teacher.created',
        'teacher.updated',
        'teacher.deleted',
        'teacher.password.reset',
        'teacher.device.reset',

        // Settings (School Admin)
        'settings.wifi.updated',
        'settings.qr.updated',
        'settings.mode.toggled',

        // Subscription Plans (Super Admin)
        'plan.created',
        'plan.updated',
        'plan.deactivated',

        // Attendance security events
        'attendance.suspicious_flagged',
        'attendance.wifi.failed_validation',

        // App Version Management (Super Admin)
        'appversion.created',
  'inquiry.status.changed',
  'inquiry.deleted',
        'appversion.updated',
        'appversion.deleted',
      ],
    },

    // ── What was affected ──────────────────────────────────────────────────
    targetType: { type: String, default: null },  // 'school' | 'teacher' | 'plan' | 'settings' | null
    targetId:   { type: String, default: null },
    targetName: { type: String, default: null },  // human-readable label for UI display

    // ── Outcome & context ──────────────────────────────────────────────────
    status:   { type: String, enum: ['success', 'failed'], default: 'success' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }, // before/after, reason, IP, etc.

    // ── Network context ────────────────────────────────────────────────────
    ipAddress:  { type: String, default: null },
    userAgent:  { type: String, default: null },
  },
  {
    timestamps: true,         // createdAt = event time
    // No updatedAt needed — logs are immutable
  }
);

// ── Indexes ────────────────────────────────────────────────────────────────
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ schoolId: 1, createdAt: -1 });
auditLogSchema.index({ 'metadata.targetTeacherId': 1 });  // teacher-specific queries

// TTL: auto-delete logs older than AUDIT_LOG_TTL_DAYS (default 365 days)
auditLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: parseInt(process.env.AUDIT_LOG_TTL_DAYS || 365) * 86400 }
);

// Prevent any update to existing log entries
auditLogSchema.pre('findOneAndUpdate', function () {
  throw new Error('AuditLog entries are immutable.');
});
auditLogSchema.pre('updateOne', function () {
  throw new Error('AuditLog entries are immutable.');
});
auditLogSchema.pre('updateMany', function () {
  throw new Error('AuditLog entries are immutable.');
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
