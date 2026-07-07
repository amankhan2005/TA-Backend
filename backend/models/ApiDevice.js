const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

/**
 * ApiDevice — a generic, hardware-agnostic device credential.
 *
 * Design decision (per explicit requirement): the backend must not be coupled
 * to any specific RFID reader vendor/protocol. This model does not know or
 * care what kind of device it represents — it just issues and verifies an API
 * key scoped to one school. Any device capable of an authenticated HTTPS POST
 * (an RFID reader, a kiosk app, a future biometric device, etc.) can use the
 * same credential and middleware (middleware/deviceAuth.js).
 *
 * Swapping RFID hardware vendors later means registering a new ApiDevice
 * record and pointing the new reader at the same /api/rfid/scan endpoint —
 * no backend code change required.
 *
 * Only the bcrypt hash of the API key is stored, mirroring the password-reset
 * token pattern already used elsewhere in this codebase (utils/token.js) —
 * the raw key is shown to the School Admin exactly once, at creation/rotation
 * time, and cannot be recovered afterward (only rotated).
 */

const apiDeviceSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },

    label: { type: String, required: true, trim: true }, // admin-facing name, e.g. "Main Gate Reader"
    deviceType: {
      type: String,
      enum: ['rfid_reader', 'kiosk', 'generic'],
      default: 'rfid_reader',
    },

    // Only the hash is ever stored. keyPrefix is a short, non-secret slice of
    // the raw key shown alongside the label in the admin UI so an admin can
    // tell devices apart without needing to store/expose the full key.
    apiKeyHash: { type: String, required: true },
    keyPrefix: { type: String, required: true },

    isActive: { type: Boolean, default: true },
    lastSeenAt: { type: Date, default: null },

    createdBy: { type: String, default: null }, // schoolAdmin email
  },
  { timestamps: true }
);

apiDeviceSchema.methods.compareKey = async function (rawKey) {
  return bcrypt.compare(rawKey, this.apiKeyHash);
};

apiDeviceSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.apiKeyHash;
  return obj;
};

apiDeviceSchema.index({ schoolId: 1, isActive: 1 });

module.exports = mongoose.model('ApiDevice', apiDeviceSchema);
