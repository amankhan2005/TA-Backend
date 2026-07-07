const mongoose = require('mongoose');

/**
 * ReportSchedule — one per configured automated report for a school. A school
 * may have several (e.g. a daily attendance digest AND a monthly summary), so
 * schoolId is indexed but NOT unique.
 *
 * The trigger day (frequency + dayOfWeek/monthlyMode/dayOfMonth) is interpreted
 * by the pure utils/reportScheduling.js module — this model only stores the
 * configuration; it contains no scheduling logic itself.
 *
 * `enabled` is the School Admin ON/OFF toggle. `deliveryChannel` overrides the
 * school's NotificationSettings.reportDelivery for THIS schedule only; 'default'
 * means "fall back to NotificationSettings", so a school that hasn't set up
 * WhatsApp keeps getting email-only unless it explicitly opts a schedule in.
 */
const reportScheduleSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },

    // Reserved for Phase 5 fee reports; attendance is all Phase 4 emits.
    reportType: { type: String, enum: ['attendance'], default: 'attendance' },

    name: { type: String, default: null, trim: true }, // optional admin label

    frequency: { type: String, enum: ['daily', 'weekly', 'monthly', 'custom'], required: true },

    dayOfWeek: { type: Number, min: 0, max: 6, default: null },       // weekly (0=Sun)
    monthlyMode: { type: String, enum: ['start', 'end', 'day'], default: null }, // monthly
    dayOfMonth: { type: Number, min: 1, max: 31, default: null },     // monthly 'day' + custom

    // Per-schedule delivery override. 'default' => use NotificationSettings.reportDelivery.
    deliveryChannel: { type: String, enum: ['default', 'email', 'whatsapp', 'both'], default: 'default' },

    // Which students the report covers. Only 'all' in Phase 4; class/section
    // scoping is an additive future extension that won't change this enum's
    // existing value.
    scope: { type: String, enum: ['all'], default: 'all' },

    enabled: { type: Boolean, default: true },

    createdBy: { type: String, default: null }, // schoolAdmin email
    lastRunDate: { type: String, default: null }, // "YYYY-MM-DD" of the last sweep that generated this
    lastRunAt: { type: Date, default: null },
  },
  { timestamps: true }
);

reportScheduleSchema.index({ schoolId: 1, enabled: 1 });

module.exports = mongoose.model('ReportSchedule', reportScheduleSchema);
