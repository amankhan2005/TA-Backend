const mongoose = require('mongoose');

/**
 * StudentIdentity — per-student identity/QR state (Phase 8). One doc per student.
 * Holds the current QR version (bumping it revokes old tokens) and generation
 * metadata. Kept separate from Student so identity operations never touch the
 * student record that attendance/promotion/fees depend on.
 */
const studentIdentitySchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, unique: true, index: true },
    qrVersion: { type: Number, default: 1 },
    qrGeneratedAt: { type: Date, default: Date.now },
    qrIssuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Cached identity-sheet PDF (optional; schools may never print).
    identityPdfUrl: { type: String, default: null },
    identityPdfPublicId: { type: String, default: null },
    identityPdfVersion: { type: Number, default: 0 },
    verificationCount: { type: Number, default: 0 },
    lastVerifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('StudentIdentity', studentIdentitySchema);
