const mongoose = require('mongoose');
const { isSupportedCurrency } = require('../utils/money');

/**
 * FeePayment — an append-only payment recorded against a StudentInvoice. Money is
 * integer minor units in `currency` (which must match the invoice's currency).
 * Corrections are never edits: a payment is voided (status:'void') and the
 * invoice recomputed. `appliedMinor`/`overpayMinor` capture how this payment
 * split into clearing the balance vs. advance credit (for receipt clarity).
 */
const feePaymentSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentInvoice', required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    studentIdRef: { type: String, required: true },

    receiptNumber: { type: String, required: true }, // unique per school (index below)
    currency: {
      type: String, required: true, uppercase: true,
      validate: { validator: isSupportedCurrency, message: 'Unsupported currency.' },
    },

    amountMinor: { type: Number, required: true, min: 1 }, // integer minor units, > 0
    appliedMinor: { type: Number, required: true, min: 0 },
    overpayMinor: { type: Number, default: 0, min: 0 },

    method: { type: String, enum: ['cash', 'bank_transfer', 'mobile_money', 'card', 'cheque', 'other'], default: 'cash' },
    reference: { type: String, default: null }, // txn / cheque ref
    paidAt: { type: Date, default: Date.now },

    status: { type: String, enum: ['recorded', 'void'], default: 'recorded', index: true },
    voidReason: { type: String, default: null },
    voidedAt: { type: Date, default: null },

    // On-demand receipt PDF (cached after first generation).
    // Placement snapshot at payment time (Phase 7.1), copied from the invoice.
    classSnapshot: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolClass', default: null },
    sectionSnapshot: { type: mongoose.Schema.Types.ObjectId, ref: 'Section', default: null },
    sessionSnapshot: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicSession', default: null },

    receiptUrl: { type: String, default: null },
    receiptPublicId: { type: String, default: null },
    sizeBytes: { type: Number, default: 0 },

    notes: { type: String, default: null },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

feePaymentSchema.index({ schoolId: 1, receiptNumber: 1 }, { unique: true });
feePaymentSchema.index({ schoolId: 1, paidAt: -1 });          // collection reports
feePaymentSchema.index({ schoolId: 1, invoice: 1, status: 1 });

module.exports = mongoose.model('FeePayment', feePaymentSchema);
