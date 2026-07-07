const mongoose = require('mongoose');

/**
 * LeaveRequest — Phase 9 parent-submitted student leave workflow. A parent
 * submits leave for one of their linked children; a school admin approves or
 * rejects. Independent of attendance records — it never mutates attendance;
 * it's an informational request/approval trail scoped to (schoolId, student).
 */
const leaveRequestSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    studentIdRef: { type: String, required: true },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Parent', required: true, index: true },

    type: { type: String, enum: ['sick', 'personal', 'emergency', 'other'], required: true },
    startDate: { type: String, required: true }, // YYYY-MM-DD
    endDate: { type: String, required: true },
    reason: { type: String, required: true },
    attachmentUrl: { type: String, default: null },

    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    remarks: { type: String, default: null },

    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

leaveRequestSchema.index({ schoolId: 1, status: 1, submittedAt: -1 });
leaveRequestSchema.index({ parent: 1, submittedAt: -1 });

module.exports = mongoose.model('LeaveRequest', leaveRequestSchema);
