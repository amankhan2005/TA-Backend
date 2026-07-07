const mongoose = require('mongoose');

/**
 * RfidScanLog — raw ingestion audit of EVERY scan received at
 * POST /api/rfid/scan, regardless of outcome. This is what "log every scan
 * attempt / ignored scans / duplicate scans / unknown RFID scans" actually
 * means in the data model — StudentAttendanceRecord only reflects resolved
 * punch-in/out state, this collection reflects raw hardware reality
 * (including cards that don't resolve to any student at all).
 */
const rfidScanLogSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },
    rfidNumber: { type: String, required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', default: null }, // null when unknown_card
    device: { type: String, default: null }, // ApiDevice label/id from the authenticated request
    scannedAt: { type: Date, required: true },

    outcome: {
      type: String,
      enum: [
        'punch_in',
        'punch_out',
        'ignored_duplicate',
        'ignored_before_min_duration',
        'ignored_locked',
        'unknown_card',
      ],
      required: true,
    },

    attendanceRecord: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentAttendanceRecord', default: null },
  },
  { timestamps: true }
);

rfidScanLogSchema.index({ schoolId: 1, scannedAt: -1 });
rfidScanLogSchema.index({ rfidNumber: 1, scannedAt: -1 });
// TTL: raw scan logs are high-volume and lower long-term value than
// AttendanceRecord itself — bounded growth, mirrors AuditLog's TTL pattern.
rfidScanLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: parseInt(process.env.RFID_SCAN_LOG_TTL_DAYS || 180) * 86400 });

module.exports = mongoose.model('RfidScanLog', rfidScanLogSchema);
