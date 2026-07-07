const mongoose = require('mongoose');

/**
 * GeneratedReport — one document per (student, period) report actually produced.
 *
 * The model name is deliberately `GeneratedReport`: NotificationLog.relatedReport
 * was declared in Phase 1 as `ref: 'GeneratedReport'`, reserving this exact name.
 * Each report-ready NotificationLog therefore points back here, which is how the
 * "generated → sent → delivered/failed → retry attempts" history the spec asks
 * for is assembled (delivery attempts live in NotificationLog; this document is
 * the report those attempts are about).
 *
 * The `summary` snapshot is stored so the School Admin history view and the
 * future Parent Portal can show present/absent/% without re-parsing the PDF or
 * recomputing from raw attendance rows.
 */
const deliveryLeg = () => ({
  status: { type: String, enum: ['none', 'queued', 'sent', 'failed'], default: 'none' },
  at: { type: Date, default: null },
  error: { type: String, default: null },
});

const generatedReportSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },

    // null for an ad-hoc "generate now" report (not tied to a recurring schedule).
    schedule: { type: mongoose.Schema.Types.ObjectId, ref: 'ReportSchedule', default: null },

    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    studentIdRef: { type: String, required: true }, // denormalized Student.studentId

    reportType: { type: String, enum: ['attendance'], default: 'attendance' },

    periodStart: { type: String, required: true }, // "YYYY-MM-DD"
    periodEnd: { type: String, required: true },
    periodLabel: { type: String, default: null },

    pdfUrl: { type: String, default: null },        // Cloudinary raw asset secure_url
    pdfPublicId: { type: String, default: null },   // for deletion / regeneration
    sizeBytes: { type: Number, default: 0 },        // PDF byte size, for storage accounting (F-3)
    // Placement snapshot at generation time (Phase 7.1).
    classSnapshot: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolClass', default: null },
    sectionSnapshot: { type: mongoose.Schema.Types.ObjectId, ref: 'Section', default: null },
    sessionSnapshot: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicSession', default: null },

    summary: {
      schoolDays: { type: Number, default: 0 },
      presentDays: { type: Number, default: 0 },
      absentDays: { type: Number, default: 0 },
      lateDays: { type: Number, default: 0 },
      attendancePercentage: { type: Number, default: 0 },
    },

    // Roll-up status. 'sent' = every attempted channel succeeded;
    // 'partially_sent' = at least one channel sent and at least one failed;
    // 'failed' = generation failed or all channels failed.
    status: { type: String, enum: ['generated', 'sent', 'partially_sent', 'failed'], default: 'generated' },

    delivery: { email: deliveryLeg(), whatsapp: deliveryLeg() },

    error: { type: String, default: null }, // generation-time error, if any
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

generatedReportSchema.index({ schoolId: 1, createdAt: -1 });
generatedReportSchema.index({ schedule: 1, periodStart: 1 });
generatedReportSchema.index({ student: 1, periodStart: 1 });
// Guards against duplicate regeneration for the same schedule+student+period on
// a job retry. Partial filter on an ObjectId schedule means the constraint
// applies ONLY to scheduled reports — ad-hoc "generate now" reports (schedule
// = null) are excluded and can be regenerated freely.
generatedReportSchema.index(
  { schedule: 1, student: 1, periodStart: 1, periodEnd: 1 },
  { unique: true, partialFilterExpression: { schedule: { $type: 'objectId' } } }
);

module.exports = mongoose.model('GeneratedReport', generatedReportSchema);
