const mongoose = require('mongoose');

/**
 * RfidCardHistory — structured RFID lifecycle log (Phase 8). Complements the
 * audit trail with query-friendly fields (old/new UID, reason, actor) for the
 * Identity Center. Append-only; never mutates attendance or card records.
 */
const ref = (m) => ({ type: mongoose.Schema.Types.ObjectId, ref: m, default: null });

const rfidCardHistorySchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', default: null, index: true },
    card: { type: mongoose.Schema.Types.ObjectId, ref: 'RfidCard', default: null, index: true },
    action: {
      type: String,
      enum: ['assigned', 'reassigned', 'replaced', 'reissued', 'disabled', 'reactivated', 'unassigned', 'lost', 'damaged'],
      required: true,
    },
    oldRfidNumber: { type: String, default: null },
    newRfidNumber: { type: String, default: null },
    reason: { type: String, default: null },
    performedBy: ref('User'),
    performedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

rfidCardHistorySchema.index({ schoolId: 1, student: 1, performedAt: -1 });

module.exports = mongoose.model('RfidCardHistory', rfidCardHistorySchema);
