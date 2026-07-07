/**
 * parentAuthController.js — Phase 9 parent authentication + profile.
 * Mobile-primary / email-secondary login, bcrypt passwords, account-lock
 * protection, and reset/activation via a hashed one-time token.
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
    if (!parent.isActive) return res.status(403).json({ success: false, message: 'Account is inactive.' });

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
    res.json({ success: true, token, parent: { id: parent._id, name: parent.name, mobileNumber: parent.mobileNumber, email: parent.email, childrenCount: parent.linkedStudents.length } });
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
    if (parent) {
      const token = crypto.randomBytes(24).toString('hex');
      parent.resetTokenHash = hashToken(token);
      parent.resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1h
      await parent.save();

      // Deliver via the existing notification infrastructure (email primary).
      // PARENT_PORTAL_URL already carries the "/parent" subpath; append page only.
      const base = (process.env.PARENT_PORTAL_URL || '').replace(/\/+$/, '');
      const resetLink = `${base}/reset-password?token=${token}`;
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

async function applyNewPassword(req, res, { activate }) {
  const { token, newPassword } = req.body;
  if (!token || !newPassword || newPassword.length < 8) return res.status(400).json({ success: false, message: 'A token and a password of at least 8 characters are required.' });
  const parent = await Parent.findOne({ resetTokenHash: hashToken(token), resetTokenExpiry: { $gt: new Date() } });
  if (!parent) return res.status(400).json({ success: false, message: 'Invalid or expired token.' });
  parent.passwordHash = await bcrypt.hash(newPassword, 10);
  parent.resetTokenHash = null; parent.resetTokenExpiry = null;
  Object.assign(parent, lock.reset());
  if (activate) parent.isActivated = true;
  await parent.save();
  await logEvent(auditCtx(parent, req), 'parent.passwordReset', { targetType: 'Parent', targetId: parent._id, metadata: { activate: !!activate } });
  res.json({ success: true, message: activate ? 'Account activated.' : 'Password reset.' });
}
exports.resetPassword = (req, res) => applyNewPassword(req, res, { activate: false });
exports.activate = (req, res) => applyNewPassword(req, res, { activate: true });

// ── Profile (authenticated) ──────────────────────────────────────────────────
exports.getProfile = async (req, res) => {
  const p = req.parent;
  res.json({ success: true, profile: { id: p._id, name: p.name, mobileNumber: p.mobileNumber, email: p.email, lastLoginAt: p.lastLoginAt, isActive: p.isActive, childrenCount: p.linkedStudents.length } });
};

exports.updateProfile = async (req, res) => {
  try {
    const p = req.parent;
    const { name, email, mobileNumber } = req.body;
    if (name !== undefined) p.name = name;
    if (email !== undefined) p.email = email;
    if (mobileNumber !== undefined) p.mobileNumber = mobileNumber;
    await p.save();
    await logEvent(auditCtx(p, req), 'parent.profileUpdated', { targetType: 'Parent', targetId: p._id });
    res.json({ success: true, profile: { name: p.name, email: p.email, mobileNumber: p.mobileNumber } });
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