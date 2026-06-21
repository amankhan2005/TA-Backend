 const mongoose = require('mongoose');

const attendanceRecordSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true },
    teacherId: { type: String, required: true },
    date: { type: String, required: true }, // YYYY-MM-DD
    markedAt: { type: Date, required: true, default: Date.now },
    mode: { type: String, enum: ['wifi', 'qr'], required: true },
    status: { type: String, enum: ['present'], default: 'present' },

    // WiFi mode data
    wifiSSID: { type: String, default: null },
    wifiBSSID: { type: String, default: null },

    // GPS data — captured for BOTH wifi and qr modes
    gpsLatitude: { type: Number, default: null },
    gpsLongitude: { type: Number, default: null },
    gpsAccuracy: { type: Number, default: null },
    distanceMeters: { type: Number, default: null },

    // Device diagnostics
    deviceModel: { type: String, default: null },
    osName: { type: String, default: null },
    osVersion: { type: String, default: null },
    appVersion: { type: String, default: null },
    platform: { type: String, enum: ['android', 'ios', 'unknown'], default: 'unknown' },

    // GPS diagnostics
    gpsPermissionStatus: { type: mongoose.Schema.Types.Mixed, default: null },
    gpsAttemptsCount: { type: Number, default: null },
    gpsStartTime: { type: String, default: null },
    gpsProvider: { type: String, default: null },

    // Validation result
    validationStatus: {
      type: String,
      enum: ['success', 'failed'],
      default: 'success',
    },
    validationErrors: [
      {
        check: { type: String },
        message: { type: String },
      },
    ],
    rejectionReason: { type: String, default: null },

    // QR mode data
    selfieUrl: { type: String, default: null },
    selfiePublicId: { type: String, default: null },
    qrSession: { type: mongoose.Schema.Types.ObjectId, ref: 'QRSession', default: null },

    // Security
    deviceId: { type: String, default: null },
    isSuspicious: { type: Boolean, default: false },
    suspiciousReason: { type: String, default: null },

    // Request metadata
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },
    submittedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Compound index: one attendance per teacher per day per school
attendanceRecordSchema.index({ schoolId: 1, teacherId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('AttendanceRecord', attendanceRecordSchema);