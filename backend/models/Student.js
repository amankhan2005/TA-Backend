const mongoose = require('mongoose');

/**
 * Student — core profile. RFID lifecycle detail (history, device type) lives
 * in RfidCard (Phase 3, not yet built) — `activeRfidCard` here is just a
 * denormalized pointer for fast lookups; RfidCard is the source of truth.
 * Same relationship pattern the existing codebase uses elsewhere (e.g. a
 * Teacher document doesn't embed its own AttendanceRecord history).
 */

const studentSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },

    // Two distinct identifiers, deliberately: studentId is system-generated
    // and immutable (safe to print on ID cards / use in URLs); admissionNumber
    // is admin-entered and may follow the school's own existing numbering
    // scheme (may need to be edited/corrected after entry).
    studentId: { type: String, required: true, unique: true }, // e.g. "STU-<schoolId short>-000123"
    admissionNumber: { type: String, required: true, trim: true },

    name: { type: String, required: true, trim: true },
    photoUrl: { type: String, default: null },
    photoPublicId: { type: String, default: null }, // Cloudinary asset id, for deletion on photo replace
    dob: { type: Date, required: true },
    gender: { type: String, enum: ['male', 'female', 'other'], required: true },

    class: { type: mongoose.Schema.Types.ObjectId, ref: 'SchoolClass', required: true },
    section: { type: mongoose.Schema.Types.ObjectId, ref: 'Section', required: true },
    session: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicSession', required: true },
    rollNumber: { type: String, default: null },
    admissionDate: { type: Date, required: true },

    status: {
      type: String,
      enum: ['active', 'inactive', 'promoted', 'transferred', 'alumni'],
      default: 'active',
    },

    // Parent/guardian contact — denormalized here for fast attendance/fee
    // notification lookups without a join. A separate portal-login Parent
    // account (Phase 9) is optional and linked independently.
    fatherName: { type: String, default: null },
    motherName: { type: String, default: null },
    guardianName: { type: String, default: null },
    email: { type: String, default: null, trim: true, lowercase: true },
    mobileNumber: { type: String, default: null },
    whatsappNumber: { type: String, default: null },
    address: { type: String, default: null },

    // RFID (denormalized pointer — RfidCard, Phase 3, is the source of truth)
    activeRfidCard: { type: mongoose.Schema.Types.ObjectId, ref: 'RfidCard', default: null },

    createdBy: { type: String, default: null }, // schoolAdmin email
  },
  { timestamps: true }
);

studentSchema.index({ schoolId: 1, admissionNumber: 1 }, { unique: true });
studentSchema.index({ schoolId: 1, class: 1, section: 1 });
studentSchema.index({ schoolId: 1, status: 1 });
studentSchema.index({ name: 'text' });

module.exports = mongoose.model('Student', studentSchema);
