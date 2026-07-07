const mongoose = require('mongoose');

/**
 * StudentPromotionRecord — the immutable academic-history entry for ONE student
 * in ONE batch. Captures the full before→after (session/class/section) so the
 * student profile shows a complete progression trail and a batch can be rolled
 * back by restoring `previous*`. Never deleted; rollback sets `reversed:true`.
 */
const ref = (m) => ({ type: mongoose.Schema.Types.ObjectId, ref: m, default: null });

const studentPromotionRecordSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    studentIdRef: { type: String, required: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentPromotionBatch', required: true, index: true },

    action: { type: String, enum: ['promoted', 'retained', 'transferred'], required: true },

    previousSession: ref('AcademicSession'), previousClass: ref('SchoolClass'), previousSection: ref('Section'),
    newSession: ref('AcademicSession'), newClass: ref('SchoolClass'), newSection: ref('Section'),

    reason: {
      type: { type: String, enum: ['academic', 'attendance', 'administrative', 'custom', 'promotion', 'transfer'], default: 'promotion' },
      note: { type: String, default: null },
    },

    reversed: { type: Boolean, default: false },
    promotedBy: ref('User'),
    promotedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

studentPromotionRecordSchema.index({ schoolId: 1, student: 1, promotedAt: -1 });

module.exports = mongoose.model('StudentPromotionRecord', studentPromotionRecordSchema);
