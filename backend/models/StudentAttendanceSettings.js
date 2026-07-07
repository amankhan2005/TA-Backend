const mongoose = require('mongoose');

/**
 * StudentAttendanceSettings — one document per school. Deliberately
 * separate from the existing SchoolSettings (which is teacher-attendance-
 * specific in both name and current usage) — see Phase 2-4 design doc §4.2.
 */
const studentAttendanceSettingsSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, unique: true, index: true },

    schoolStartTime: { type: String, default: '08:00' }, // "HH:MM", school-local wall clock
    schoolEndTime: { type: String, default: '15:00' },

    // Admin picks 1/2/4 hours in the UI, or a custom value — all resolve to
    // this one field. No separate "preset vs custom" flag needed; a preset
    // selection just writes the equivalent minute value.
    minPunchOutDurationMinutes: { type: Number, default: 240, min: 1 },

    duplicateScanWindowMinutes: { type: Number, default: 5, min: 1 },
    lateThresholdMinutes: { type: Number, default: 15, min: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('StudentAttendanceSettings', studentAttendanceSettingsSchema);
