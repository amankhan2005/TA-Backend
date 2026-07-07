const mongoose = require('mongoose');

/**
 * StudentPromotionBatch — one promotion/transfer/retention operation over a set
 * of students, following preview → validation → execution. Holds the intent
 * (source/destination + mode), the last preview snapshot, and lifecycle status.
 * Nothing here mutates students until execution runs inside a transaction.
 */
const ref = (m) => ({ type: mongoose.Schema.Types.ObjectId, ref: m, default: null });

const studentPromotionBatchSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },
    mode: { type: String, enum: ['class', 'section', 'session', 'selected', 'transfer', 'retention'], required: true },

    sourceSession: ref('AcademicSession'),
    sourceClass: ref('SchoolClass'),
    sourceSection: ref('Section'),
    destSession: ref('AcademicSession'),
    destClass: ref('SchoolClass'),
    destSection: ref('Section'),

    selectedStudentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }],
    retainedStudentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }],
    retentionReason: { type: { type: String, enum: ['academic', 'attendance', 'administrative', 'custom', null], default: null }, note: { type: String, default: null } },

    totalStudents: { type: Number, default: 0 },
    promotedCount: { type: Number, default: 0 },
    retainedCount: { type: Number, default: 0 },
    transferredCount: { type: Number, default: 0 },

    status: { type: String, enum: ['draft', 'previewed', 'executed', 'cancelled', 'rolled_back'], default: 'draft', index: true },
    previewSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    notify: { type: Boolean, default: false },

    createdBy: ref('User'),
    executedBy: ref('User'),
    executedAt: { type: Date, default: null },
    rolledBackBy: ref('User'),
    rolledBackAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('StudentPromotionBatch', studentPromotionBatchSchema);
