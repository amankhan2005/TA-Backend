const mongoose = require('mongoose');

/**
 * RfidCard — one document per physical RFID credential ever issued.
 *
 * Lifecycle events (assign/unassign/replace/disable/reactivate) are NOT a
 * separate history collection here — they're written to the existing
 * AuditLog (targetType: 'rfidCard'), consistent with how every other admin
 * action in this codebase already gets its audit trail. Querying "history
 * for this card" is `AuditLog.find({ targetType: 'rfidCard', targetId })`.
 *
 * Status meanings:
 *   active     - currently assigned to `student` and usable for attendance scans
 *   unassigned - the physical card still exists/is valid, but is not linked
 *                to any student right now (removed via "Unassign", not lost/
 *                broken) — can be assigned to a different student later.
 *                `student` is null while in this state.
 *   disabled   - lost/stolen/broken; scans against this rfidNumber are
 *                rejected as unknown_card until reactivated.
 *   replaced   - superseded by a newer RfidCard for the same student
 *                (kept for historical audit trail, never reused).
 */
const rfidCardSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', default: null, index: true },

    rfidNumber: { type: String, required: true, unique: true }, // hardware UID — globally unique across all schools
    cardType: { type: String, enum: ['card', 'bracelet', 'tag', 'id_card'], default: 'card' },

    status: { type: String, enum: ['active', 'unassigned', 'disabled', 'replaced', 'lost', 'damaged'], default: 'active' },

    assignedDate: { type: Date, default: null },
    unassignedDate: { type: Date, default: null },
    disabledDate: { type: Date, default: null },
    replacedByCard: { type: mongoose.Schema.Types.ObjectId, ref: 'RfidCard', default: null },
  },
  { timestamps: true }
);

rfidCardSchema.index({ schoolId: 1, status: 1 });

module.exports = mongoose.model('RfidCard', rfidCardSchema);
