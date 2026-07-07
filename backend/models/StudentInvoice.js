const mongoose = require('mongoose');
const { isSupportedCurrency } = require('../utils/money');

/**
 * StudentInvoice — an invoice issued to a student. Amounts are integer minor
 * units in `currency`, snapshotted at issue time (so later edits to the source
 * FeeStructure never mutate history). `paidMinor` and `status` are maintained by
 * feeService as payments are recorded/voided (never by floating math).
 *
 * NOTE: field names `status`, `totalPayableMinor`, `paidMinor`, `dueDate` are
 * read by the student-profile aggregation (Phase 2) — keep them stable.
 */
const invoiceLineSchema = new mongoose.Schema({
  description: { type: String, required: true },
  amountMinor: { type: Number, required: true, min: 0 },
  quantity: { type: Number, default: 1, min: 1 },
  lineTotalMinor: { type: Number, required: true, min: 0 },
}, { _id: false });

const studentInvoiceSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    studentIdRef: { type: String, required: true }, // denormalized human student id
    feeStructure: { type: mongoose.Schema.Types.ObjectId, ref: 'FeeStructure', default: null },

    invoiceNumber: { type: String, required: true }, // unique per school (index below)
    currency: {
      type: String, required: true, uppercase: true,
      validate: { validator: isSupportedCurrency, message: 'Unsupported currency.' },
    },

    lineItems: { type: [invoiceLineSchema], required: true },
    subtotalMinor: { type: Number, required: true, min: 0 },
    discountMinor: { type: Number, default: 0, min: 0 },
    totalPayableMinor: { type: Number, required: true, min: 0 },

    paidMinor: { type: Number, default: 0, min: 0 },       // sum of applied+advance from non-void payments
    overpaidMinor: { type: Number, default: 0, min: 0 },   // advance/credit portion

    status: { type: String, enum: ['unpaid', 'partial', 'paid', 'overdue', 'void'], default: 'unpaid', index: true },

    // Placement snapshot at issue time (Phase 7.1) — historical class/section
    // fee analytics stay correct after a student is promoted. Null → fallback.
    classSnapshot: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolClass', default: null },
    sectionSnapshot: { type: mongoose.Schema.Types.ObjectId, ref: 'Section', default: null },
    sessionSnapshot: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicSession', default: null },

    periodLabel: { type: String, default: null }, // e.g. "July 2026" / "Term 1"
    issueDate: { type: Date, default: Date.now },
    dueDate: { type: Date, required: true },

    // Reminder bookkeeping (F-4-style delivery lives in NotificationLog; these
    // throttle how often the fee reminder sweep re-notifies a given invoice).
    lastReminderAt: { type: Date, default: null },
    reminderCount: { type: Number, default: 0 },

    notes: { type: String, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

studentInvoiceSchema.index({ schoolId: 1, invoiceNumber: 1 }, { unique: true });
studentInvoiceSchema.index({ schoolId: 1, student: 1, dueDate: -1 });
studentInvoiceSchema.index({ schoolId: 1, status: 1, dueDate: 1 }); // reminder sweep

module.exports = mongoose.model('StudentInvoice', studentInvoiceSchema);
