const mongoose = require('mongoose');

/**
 * AppVersion — stores the current active version configuration.
 *
 * Design decisions:
 *  - Only ONE active document at a time (isActive: true).
 *    The GET /api/app-version public endpoint returns the active record.
 *  - Previous records are kept for history — never deleted.
 *  - updateType drives mobile behavior: 'optional' shows a dismissible modal,
 *    'force' blocks the app entirely until the user updates.
 *  - semver strings validated by the pre-save hook, not by a library,
 *    to keep dependencies minimal.
 */

const SEMVER = /^\d+\.\d+\.\d+$/;

const appVersionSchema = new mongoose.Schema(
  {
    // ── Version strings ────────────────────────────────────────────────────
    latestVersion: {
      type: String,
      required: true,
      trim: true,
      validate: { validator: v => SEMVER.test(v), message: 'latestVersion must be semver (e.g. 1.2.0).' },
    },
    minimumVersion: {
      type: String,
      required: true,
      trim: true,
      validate: { validator: v => SEMVER.test(v), message: 'minimumVersion must be semver (e.g. 1.1.0).' },
    },

    // ── Update behaviour ───────────────────────────────────────────────────
    updateType: {
      type: String,
      required: true,
      enum: ['optional', 'force'],
      default: 'optional',
    },

    // ── User-facing copy ───────────────────────────────────────────────────
    title:   { type: String, required: true, trim: true, maxlength: 100 },
    message: { type: String, required: true, trim: true, maxlength: 500 },

    // ── Store URLs ─────────────────────────────────────────────────────────
    androidUrl: {
      type: String,
      default: '',
      trim: true,
      validate: {
        validator: v => v === '' || /^https?:\/\/.+/.test(v),
        message: 'androidUrl must be a valid URL or empty string.',
      },
    },
    iosUrl: {
      type: String,
      default: '',
      trim: true,
      validate: {
        validator: v => v === '' || /^https?:\/\/.+/.test(v),
        message: 'iosUrl must be a valid URL or empty string.',
      },
    },

    // ── Visibility ─────────────────────────────────────────────────────────
    isActive: { type: Boolean, default: true, index: true },

    // ── Who created this record ────────────────────────────────────────────
    createdBy: { type: String, default: null }, // admin email
  },
  { timestamps: true }
);

// Validate minimumVersion <= latestVersion before save
appVersionSchema.pre('save', function (next) {
  const toNum = (v) => v.split('.').map(Number);
  const [lMaj, lMin, lPat] = toNum(this.latestVersion);
  const [mMaj, mMin, mPat] = toNum(this.minimumVersion);

  const latest  = lMaj * 1e6 + lMin * 1e3 + lPat;
  const minimum = mMaj * 1e6 + mMin * 1e3 + mPat;

  if (minimum > latest) {
    return next(new Error('minimumVersion cannot be greater than latestVersion.'));
  }
  next();
});

appVersionSchema.index({ isActive: 1, createdAt: -1 });

module.exports = mongoose.model('AppVersion', appVersionSchema);
