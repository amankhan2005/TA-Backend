const mongoose = require('mongoose');
const { isSupportedCurrency } = require('../utils/money');

/**
 * FeeStructure — a reusable fee template (e.g. "Grade 4 Term 1 Fees") a school
 * admin defines once and generates invoices from. All amounts are integer minor
 * units in the structure's `currency`. `appliesTo` optionally scopes bulk
 * generation to a class/section/session.
 */
const lineItemSchema = new mongoose.Schema({
  description: { type: String, required: true, trim: true },
  amountMinor: { type: Number, required: true, min: 0 }, // integer minor units
  quantity: { type: Number, default: 1, min: 1 },
}, { _id: false });

const discountSchema = new mongoose.Schema({
  type: { type: String, enum: ['fixed', 'percent'], required: true },
  value: { type: Number, required: true, min: 0 }, // fixed=minor units, percent=0..100
  description: { type: String, trim: true },
}, { _id: false });

const feeStructureSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    currency: {
      type: String, required: true, uppercase: true,
      validate: { validator: isSupportedCurrency, message: 'Unsupported currency.' },
    },
    frequency: { type: String, enum: ['one_time', 'monthly', 'term', 'annual'], default: 'one_time' },
    lineItems: { type: [lineItemSchema], validate: (v) => v.length > 0 },
    discounts: { type: [discountSchema], default: [] },
    appliesTo: {
      class: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolClass', default: null },
      section: { type: mongoose.Schema.Types.ObjectId, ref: 'Section', default: null },
      session: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicSession', default: null },
    },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

feeStructureSchema.index({ schoolId: 1, isActive: 1 });

module.exports = mongoose.model('FeeStructure', feeStructureSchema);
