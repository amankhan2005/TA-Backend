const mongoose = require('mongoose');

/**
 * FeeStatement — a generated monthly fee statement PDF for a student (mirrors
 * GeneratedReport's shape so delivery tracking + Phase 9 parent-portal history
 * work the same way). Balance figures are snapshotted integer minor units.
 */
const deliveryLeg = () => ({
  status: { type: String, enum: ['none', 'sent', 'failed'], default: 'none' },
  at: { type: Date, default: null },
  error: { type: String, default: null },
});

const feeStatementSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    studentIdRef: { type: String, required: true },
    periodLabel: { type: String, required: true }, // "July 2026"
    periodStart: { type: String, required: true }, // YYYY-MM-DD
    periodEnd: { type: String, required: true },
    currency: { type: String, required: true, uppercase: true },

    openingBalanceMinor: { type: Number, default: 0 },
    billedMinor: { type: Number, default: 0 },
    paidMinor: { type: Number, default: 0 },
    closingBalanceMinor: { type: Number, default: 0 },

    pdfUrl: { type: String, default: null },
    pdfPublicId: { type: String, default: null },
    sizeBytes: { type: Number, default: 0 },

    status: { type: String, enum: ['generated', 'sent', 'partially_sent', 'failed'], default: 'generated' },
    delivery: { email: deliveryLeg(), whatsapp: deliveryLeg() },
    error: { type: String, default: null },
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

feeStatementSchema.index({ schoolId: 1, student: 1, periodStart: 1 });

module.exports = mongoose.model('FeeStatement', feeStatementSchema);
