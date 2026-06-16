const mongoose = require('mongoose');

const attendanceRecordSchema = new mongoose.Schema({
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
  wifiBSSID: { type: String, default: null },     // access-point MAC actually connected to
  gatewayIp: { type: String, default: null },     // legacy, no longer validated

  // GPS data — now captured for BOTH wifi and qr modes
  gpsLatitude: { type: Number, default: null },
  gpsLongitude: { type: Number, default: null },
  gpsAccuracy: { type: Number, default: null },   // device-reported horizontal accuracy (m)
  distanceMeters: { type: Number, default: null }, // computed distance from school at mark time

  // QR mode data
  selfieUrl: { type: String, default: null },
  selfiePublicId: { type: String, default: null },
  qrSession: { type: mongoose.Schema.Types.ObjectId, ref: 'QRSession', default: null },

  // Security
  deviceId: { type: String, default: null },
  isSuspicious: { type: Boolean, default: false },
  suspiciousReason: { type: String, default: null },
}, { timestamps: true });

// Compound index: one attendance per teacher per day per school
attendanceRecordSchema.index({ schoolId: 1, teacherId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('AttendanceRecord', attendanceRecordSchema);