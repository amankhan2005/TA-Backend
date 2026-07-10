/**
 * parentAuthController.js — Phase 9 parent authentication + profile.
 * Mobile-primary / email-secondary login, bcrypt passwords, account-lock
 * protection, and reset/activation via a hashed one-time token.
 *
 * ── STATUS GATING (replaces the isActive boolean check) ─────────────────────
 * The old login checked `!parent.isActive` only. It NEVER checked
 * `isActivated`, so a school-created account was blocked purely because
 * createParent assigned it a random unusable password — incidental security,
 * not intentional. Now the gate is explicit and total:
 *
 *   pending    → 403, "activate your account" (they have an activation link)
 *   suspended  → 403, "contact your school"   (an admin revoked access)
 *   active     → proceed to password check
 *
 * The two 403s are deliberately DISTINGUISHABLE from each other but both are
 * only reachable AFTER the account has been found. Account existence is still
 * hidden behind the generic "Invalid credentials." on lookup failure, so this
 * leaks nothing to an unauthenticated prober that a valid activation link
 * doesn't already reveal.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Parent = require('../models/Parent');
const { generateToken } = require('../middleware/auth');
const lock = require('../utils/accountLock');
const { logEvent } = require('../utils/audit');

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
const auditCtx = (parent, req) => ({ user: { schoolId: parent.linkedStudents?.[0]?.schoolId || null, userId: parent._id, email: parent.email || parent.mobileNumber }, ip: req.ip });

function findByIdentifier(identifier) {
  // Coerce to a primitive string so a query-operator object can never reach the
  // filter (defense-in-depth alongside the global mongo-sanitize middleware).
  const raw = String(identifier || '').trim();
  const id = raw.toLowerCase();
  return Parent.findOne({ $or: [{ mobileNumber: raw }, { email: id }] });
}

const STATUS_DENIAL = {
  pending: 'Your account has not been activated yet. Please use the activation link sent to you, or ask your school to resend it.',
  suspended: 'Your portal access has been suspended. Please contact your school administrator.',
};

exports.login = async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) return res.status(400).json({ success: false, message: 'Identifier and password are required.' });

    const parent = await findByIdentifier(identifier);
    // Generic error to avoid leaking which accounts exist.
    if (!parent) return res.status(401).json({ success: false, message: 'Invalid credentials.' });

    if (lock.isLocked(parent)) {
      return res.status(423).json({ success: false, message: 'Account temporarily locked due to failed attempts. Try again later.' });
    }

    if (parent.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: STATUS_DENIAL[parent.status] || 'Account is not active.',
        status: parent.status,
      });
    }

    const ok = await parent.comparePassword(password);
    if (!ok) {
      Object.assign(parent, lock.registerFailure(parent));
      await parent.save();
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    Object.assign(parent, lock.reset());
    parent.lastLoginAt = new Date();
    await parent.save();

    const token = generateToken({ parentId: parent._id.toString(), role: 'parent' });
    await logEvent(auditCtx(parent, req), 'parent.login', { targetType: 'Parent', targetId: parent._id });
    res.json({
      success: true,
      token,
      parent: {
        id: parent._id,
        name: parent.name,
        mobileNumber: parent.mobileNumber,
        email: parent.email,
        status: parent.status,
        childrenCount: parent.linkedStudents.length,
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.logout = async (req, res) => {
  // Stateless JWT — logout is client-side token disposal; we just audit it.
  try { await logEvent(auditCtx(req.parent, req), 'parent.logout', { targetType: 'Parent', targetId: req.parent._id }); } catch (_) {}
  res.json({ success: true, message: 'Logged out.' });
};

exports.forgotPassword = async (req, res) => {
  try {
    const parent = await findByIdentifier(req.body.identifier);
    // Always respond success (don't reveal account existence).
    //
    // A SUSPENDED parent gets no reset link. Handing one out would let a
    // revoked account quietly re-enter the reset flow; resetPassword does not
    // change status, so they still could not log in — but issuing the token at
    // all is noise we don't want in the audit trail.
    if (parent && parent.status !== 'suspended') {
      const token = crypto.randomBytes(24).toString('hex');
      parent.resetTokenHash = hashToken(token);
      parent.resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1h
      await parent.save();

      const brand = require('../config/brand');
      // brand.parentPortalUrl() already carries the "/parent" subpath; append page only.
      const resetLink = `${brand.parentPortalUrl()}/reset-password?token=${token}`;
      if (parent.email) {
        try {
          const { sendParentPasswordResetEmail } = require('../utils/email');
          await sendParentPasswordResetEmail({ toEmail: parent.email, resetLink, parentName: parent.name });
        } catch (e) { console.error('[parent.forgotPassword] email delivery failed:', e.message); }
      }
      try { await logEvent(auditCtx(parent, req), 'parent.passwordResetRequested', { targetType: 'Parent', targetId: parent._id }); } catch (_) {}

      // Raw token is returned ONLY outside production (for local testing).
      const devToken = process.env.NODE_ENV === 'production' ? undefined : token;
      return res.json({ success: true, message: 'If the account exists, a reset link has been sent.', devToken });
    }
    res.json({ success: true, message: 'If the account exists, a reset link has been sent.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

/**
 * Shared password-setting path for both /reset-password and /activate.
 *
 * `activate: true` is the ONLY way an account becomes `active`. That is
 * deliberate — "active" means "the parent chose their own password". No admin
 * endpoint can set it, because doing so would leave the random unusable hash
 * from createParent in place on an account that displays as Active.
 *
 * A suspended account cannot be revived through either path: the token may be
 * valid, but status is not the token's to change.
 */
async function applyNewPassword(req, res, { activate }) {
  const { token, newPassword } = req.body;
  if (!token || !newPassword || newPassword.length < 8) return res.status(400).json({ success: false, message: 'A token and a password of at least 8 characters are required.' });

  const parent = await Parent.findOne({ resetTokenHash: hashToken(token), resetTokenExpiry: { $gt: new Date() } });
  if (!parent) return res.status(400).json({ success: false, message: 'Invalid or expired token.' });

  if (parent.status === 'suspended') {
    return res.status(403).json({ success: false, message: 'This account is suspended. Please contact your school administrator.' });
  }

  parent.passwordHash = await bcrypt.hash(newPassword, 10);
  parent.resetTokenHash = null;
  parent.resetTokenExpiry = null;
  Object.assign(parent, lock.reset());

  if (activate) {
    parent.status = 'active';
    parent.activatedAt = parent.activatedAt || new Date();
  }

  await parent.save();
  await logEvent(auditCtx(parent, req), 'parent.passwordReset', { targetType: 'Parent', targetId: parent._id, metadata: { activate: !!activate } });
  res.json({ success: true, message: activate ? 'Account activated.' : 'Password reset.', status: parent.status });
}

exports.resetPassword = (req, res) => applyNewPassword(req, res, { activate: false });
exports.activate = (req, res) => applyNewPassword(req, res, { activate: true });

// ── Profile (authenticated) ──────────────────────────────────────────────────
exports.getProfile = async (req, res) => {
  const p = req.parent;
  res.json({
    success: true,
    profile: {
      id: p._id,
      name: p.name,
      mobileNumber: p.mobileNumber,
      email: p.email,
      address: p.address,
      lastLoginAt: p.lastLoginAt,
      status: p.status,
      // Retained for older portal builds that still read this key.
      isActive: p.status === 'active',
      childrenCount: p.linkedStudents.length,
    },
  });
};

exports.updateProfile = async (req, res) => {
  try {
    const p = req.parent;
    const { name, email, mobileNumber, address } = req.body;
    if (name !== undefined) p.name = name;
    if (address !== undefined) p.address = address;

    // A parent must retain at least one login identifier.
    const nextEmail = email !== undefined ? (email || null) : p.email;
    const nextMobile = mobileNumber !== undefined ? (mobileNumber || null) : p.mobileNumber;
    if (!nextEmail && !nextMobile) {
      return res.status(400).json({ success: false, message: 'You must keep at least a mobile number or an email on your account.' });
    }
    if (email !== undefined) p.email = email || undefined;
    if (mobileNumber !== undefined) p.mobileNumber = mobileNumber || undefined;

    await p.save();
    await logEvent(auditCtx(p, req), 'parent.profileUpdated', { targetType: 'Parent', targetId: p._id });
    res.json({ success: true, profile: { name: p.name, email: p.email, mobileNumber: p.mobileNumber, address: p.address } });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: 'That mobile/email is already in use.' });
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ success: false, message: 'New password must be at least 8 characters.' });
    const p = req.parent;
    if (!(await p.comparePassword(oldPassword))) return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    p.passwordHash = await bcrypt.hash(newPassword, 10);
    await p.save();
    await logEvent(auditCtx(p, req), 'parent.passwordReset', { targetType: 'Parent', targetId: p._id, metadata: { self: true } });
    res.json({ success: true, message: 'Password changed.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};