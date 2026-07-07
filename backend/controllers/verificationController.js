/**
 * verificationController.js — Phase 8 public student verification (Step 3).
 * Token-gated (the signed QR token proves legitimacy), school-scoped by the
 * token's payload, and rate-limited by the app's global limiter. Returns only
 * non-sensitive fields and audits every verification.
 */
const identity = require('../utils/identityService');
const { logEvent } = require('../utils/audit');

exports.verifyByToken = async (req, res) => {
  try {
    const result = await identity.verifyByToken(req.params.token);
    if (!result.valid) {
      // Abuse logging (audit Fix 4): tampered/forged tokens are security-relevant.
      if (result.reason === 'bad_signature' || result.reason === 'malformed') {
        console.warn(`[verify-abuse] invalid token (${result.reason}) from ${req.ip}`);
      }
      return res.status(result.reason === 'bad_signature' || result.reason === 'malformed' ? 400 : 404)
        .json({ success: false, valid: false, reason: result.reason });
    }
    // Verification audit — schoolId comes from the signed token, not the client.
    try {
      await logEvent(
        { user: { schoolId: result.schoolId, userId: null, email: 'qr-verification' }, ip: req.ip },
        'student.verified',
        { targetType: 'Student', targetName: result.student.studentId, metadata: { rfidStatus: result.rfidStatus } }
      );
    } catch (_) { /* audit is best-effort */ }
    res.json({ success: true, valid: true, student: result.student, rfidStatus: result.rfidStatus });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
