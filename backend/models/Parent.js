const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

/**
 * Parent — portal login account. Separate from the plain contact fields
 * (fatherName/motherName/mobileNumber/etc.) on Student, which exist even if
 * no portal account is ever created for that family.
 *
 * Login identifier: mobile number is primary, email secondary (per the
 * approved design). Not schoolId-scoped like Student/Teacher/SchoolAdmin —
 * a parent's linked children could span more than one school (siblings at
 * different schools, a mid-year transfer). Every portal query filters
 * explicitly against `linkedStudents`, never a bare schoolId.
 */

const parentSchema = new mongoose.Schema(
  {
    mobileNumber: { type: String, unique: true, sparse: true, index: true }, // primary login identifier
    email: { type: String, unique: true, sparse: true, index: true, lowercase: true, trim: true }, // secondary
    passwordHash: { type: String, required: true },
    name: { type: String, default: null },

    linkedStudents: [
      {
        student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
        schoolId: { type: String, required: true },
        relation: { type: String, enum: ['father', 'mother', 'guardian'], default: 'guardian' },
      },
    ],

    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },

    // Auth hardening (Phase 9).
    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },        // account temporarily locked after repeated failures
    resetTokenHash: { type: String, default: null }, // sha256 of a password-reset / activation token
    resetTokenExpiry: { type: Date, default: null },
    isActivated: { type: Boolean, default: true },   // false until a school-created account sets its password
  },
  { timestamps: true }
);

parentSchema.pre('validate', function (next) {
  if (!this.mobileNumber && !this.email) {
    return next(new Error('A parent account requires at least a mobile number or an email.'));
  }
  next();
});

parentSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.passwordHash);
};

module.exports = mongoose.model('Parent', parentSchema);
