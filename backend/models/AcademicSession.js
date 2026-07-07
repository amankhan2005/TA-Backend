const mongoose = require('mongoose');

const academicSessionSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    name: { type: String, required: true, trim: true }, // e.g. "2026-2027"
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    isActive: { type: Boolean, default: false }, // exactly one active session per school, enforced in controller
  },
  { timestamps: true }
);

academicSessionSchema.index({ schoolId: 1, name: 1 }, { unique: true });
academicSessionSchema.index({ schoolId: 1, isActive: 1 });

module.exports = mongoose.model('AcademicSession', academicSessionSchema);
