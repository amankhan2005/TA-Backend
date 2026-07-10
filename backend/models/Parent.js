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
 *
 * ── STATUS SYSTEM (replaces isActive + isActivated) ─────────────────────────
 * The old model carried TWO overlapping booleans with no way to express
 * "suspended", and `login` only ever checked `isActive` — a never-activated
 * account was blocked purely because createParent assigned it an unusable
 * random password, which is incidental rather than intentional security.
 *
 *   pending    — created by a school admin, activation link issued, password
 *                not yet set. Cannot log in.
 *   active     — the parent completed activation (or reset) and set a password.
 *   suspended  — an admin revoked portal access. Cannot log in. Distinct from
 *                `pending` so re-activation and un-suspension are different
 *                operations with different audit trails.
 *
 * `isActive` / `isActivated` survive as READ-ONLY VIRTUALS so any JSON
 * consumer that still reads them keeps working. They are NOT queryable —
 * Mongoose virtuals do not participate in query filters, and are skipped
 * entirely under `.lean()`. Every query/lean call site in this codebase has
 * been migrated to `status` (parentAnalyticsService.js, leaveController.js).
 * Do not add new code that filters on the virtuals.
 */

const PARENT_STATUSES = ['pending', 'active', 'suspended'];

const parentSchema = new mongoose.Schema(
  {
    mobileNumber: { type: String, unique: true, sparse: true, index: true }, // primary login identifier
    email: { type: String, unique: true, sparse: true, index: true, lowercase: true, trim: true }, // secondary
    passwordHash: { type: String, required: true },
    name: { type: String, default: null },
    address: { type: String, default: null },

    linkedStudents: [
      {
        student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
        schoolId: { type: String, required: true },
        relation: { type: String, enum: ['father', 'mother', 'guardian'], default: 'guardian' },
      },
    ],

    // Single source of truth for account state.
    status: {
      type: String,
      enum: PARENT_STATUSES,
      default: 'pending',
      index: true,
    },
    suspendedAt: { type: Date, default: null },
    suspendedReason: { type: String, default: null },
    activatedAt: { type: Date, default: null },

    lastLoginAt: { type: Date, default: null },

    // Auth hardening (Phase 9).
    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },        // account temporarily locked after repeated failures
    resetTokenHash: { type: String, default: null }, // sha256 of a password-reset / activation token
    resetTokenExpiry: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Supports the school-scoped admin parent list + status filter.
parentSchema.index({ 'linkedStudents.schoolId': 1, status: 1 });
// Supports admin parent search by name.
parentSchema.index({ 'linkedStudents.schoolId': 1, name: 1 });

// ── Backwards-compatible read-only virtuals ─────────────────────────────────
// Present so a JSON response still carries the shapes older clients expect.
// NEVER usable in a query filter or under .lean().
parentSchema.virtual('isActive').get(function () {
  return this.status === 'active';
});
parentSchema.virtual('isActivated').get(function () {
  return this.status === 'active' || this.status === 'suspended';
});

parentSchema.pre('validate', function (next) {
  if (!this.mobileNumber && !this.email) {
    return next(new Error('A parent account requires at least a mobile number or an email.'));
  }
  next();
});

parentSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.passwordHash);
};

/**
 * Safe wire shape for admin/portal responses. Never leaks passwordHash,
 * reset tokens, or lock counters.
 */
parentSchema.methods.toSafeObject = function () {
  return {
    _id: this._id,
    id: this._id,
    name: this.name,
    email: this.email,
    mobileNumber: this.mobileNumber,
    address: this.address,
    status: this.status,
    isActive: this.status === 'active',
    isActivated: this.status === 'active' || this.status === 'suspended',
    activatedAt: this.activatedAt,
    suspendedAt: this.suspendedAt,
    suspendedReason: this.suspendedReason,
    lastLoginAt: this.lastLoginAt,
    childrenCount: (this.linkedStudents || []).length,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('Parent', parentSchema);
module.exports.PARENT_STATUSES = PARENT_STATUSES;