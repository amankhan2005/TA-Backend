const bcrypt = require('bcryptjs');
const SuperAdmin = require('../models/SuperAdmin');
const SchoolAdmin = require('../models/SchoolAdmin');
const Teacher = require('../models/Teacher');
const { generateToken: genJWT } = require('../middleware/auth');
const { generateToken, verifyToken, getResetExpiry } = require('../utils/token');
const { sendPasswordResetEmail } = require('../utils/email');
const { logEvent } = require('../utils/audit');

// ─── SUPER ADMIN LOGIN ──────────────────────────────────────────────────────
exports.superAdminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = await SuperAdmin.findOne({ email: email.toLowerCase() });

    if (!admin || !(await admin.comparePassword(password))) {
      // Log failed attempt — no req.user yet, use actorOverride
      await logEvent(req, 'auth.login.failed', {
        actorOverride: { userId: 'unknown', email: email.toLowerCase(), role: 'superAdmin' },
        status: 'failed',
        metadata: { reason: 'Invalid credentials' },
      });
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const token = genJWT({ userId: admin._id, role: 'superAdmin', email: admin.email });

    await logEvent(req, 'auth.login.success', {
      actorOverride: { userId: admin._id, email: admin.email, role: 'superAdmin' },
    });

    res.json({ success: true, token, user: admin.toSafeObject() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── SCHOOL ADMIN LOGIN ─────────────────────────────────────────────────────
exports.schoolAdminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = await SchoolAdmin.findOne({ email: email.toLowerCase() }).populate('school');

    if (!admin || !(await admin.comparePassword(password))) {
      await logEvent(req, 'auth.login.failed', {
        actorOverride: { userId: 'unknown', email: email.toLowerCase(), role: 'schoolAdmin' },
        status: 'failed',
        metadata: { reason: 'Invalid credentials' },
      });
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (admin.school.status !== 'active') {
      await logEvent(req, 'auth.login.failed', {
        actorOverride: { userId: admin._id, email: admin.email, role: 'schoolAdmin', schoolId: admin.schoolId },
        status: 'failed',
        metadata: { reason: 'School inactive', schoolStatus: admin.school.status },
      });
      return res.status(403).json({ success: false, message: 'Your school account is inactive. Contact support.' });
    }

    const token = genJWT({ userId: admin._id, schoolId: admin.schoolId, role: 'schoolAdmin', email: admin.email });

    await logEvent(req, 'auth.login.success', {
      actorOverride: { userId: admin._id, email: admin.email, role: 'schoolAdmin', schoolId: admin.schoolId },
    });

    res.json({ success: true, token, user: admin.toSafeObject() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── TEACHER LOGIN ──────────────────────────────────────────────────────────
// Teacher logins are NOT written to AuditLog (teacher is a separate role, not an admin).
// Their attendance activity is already tracked in AttendanceRecord.
exports.teacherLogin = async (req, res) => {
  try {
    const { email, password, deviceId } = req.body;
    const teacher = await Teacher.findOne({ email: email.toLowerCase() }).populate('school');

    if (!teacher || !(await teacher.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }
    if (!teacher.isActive) {
      return res.status(403).json({ success: false, message: 'Your account has been deactivated. Contact your school admin.' });
    }
    if (teacher.school.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Your school subscription is inactive.' });
    }

    if (deviceId && teacher.deviceId !== deviceId) {
      teacher.deviceId = deviceId;
      await teacher.save();
    }

    const token = genJWT({ userId: teacher._id, teacherId: teacher._id, schoolId: teacher.schoolId, role: 'teacher', email: teacher.email });
    res.json({ success: true, token, user: teacher.toSafeObject() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── FORGOT PASSWORD ────────────────────────────────────────────────────────
exports.forgotPassword = async (req, res) => {
  try {
    const { email, role } = req.body;

    let user = null;
    let frontendUrl = '';

    if (role === 'superAdmin') {
      user = await SuperAdmin.findOne({ email: email.toLowerCase() });
      frontendUrl = process.env.FRONTEND_SUPER_ADMIN_URL;
    } else {
      user = await SchoolAdmin.findOne({ email: email.toLowerCase() });
      frontendUrl = process.env.FRONTEND_SCHOOL_ADMIN_URL;
    }

    if (!user) {
      return res.json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
    }

    const { rawToken, hashedToken } = await generateToken();
    user.passwordResetToken = hashedToken;
    user.passwordResetExpiry = getResetExpiry();
    await user.save();

    const resetLink = `${frontendUrl}/reset-password?token=${rawToken}&role=${role}`;
    await sendPasswordResetEmail({ toEmail: user.email, resetLink, role });

    await logEvent(req, 'auth.password.reset_requested', {
      actorOverride: { userId: user._id, email: user.email, role, schoolId: user.schoolId || null },
      metadata: { role },
    });

    res.json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── RESET PASSWORD ─────────────────────────────────────────────────────────
exports.resetPassword = async (req, res) => {
  try {
    const { token, role, newPassword } = req.body;

    let Model = role === 'superAdmin' ? SuperAdmin : SchoolAdmin;
    const users = await Model.find({ passwordResetToken: { $ne: null }, passwordResetExpiry: { $gt: new Date() } });

    let matchedUser = null;
    for (const u of users) {
      const valid = await verifyToken(token, u.passwordResetToken);
      if (valid) { matchedUser = u; break; }
    }

    if (!matchedUser) {
      return res.status(400).json({ success: false, message: 'Reset link is invalid or has expired.' });
    }

    matchedUser.passwordHash = newPassword;
    matchedUser.passwordResetToken = null;
    matchedUser.passwordResetExpiry = null;
    await matchedUser.save();

    await logEvent(req, 'auth.password.reset_completed', {
      actorOverride: { userId: matchedUser._id, email: matchedUser.email, role, schoolId: matchedUser.schoolId || null },
      metadata: { role },
    });

    res.json({ success: true, message: 'Password reset successful. Please login with your new password.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── CHANGE PASSWORD (in-session) ───────────────────────────────────────────
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const { role, userId } = req.user;

    let Model = role === 'superAdmin' ? SuperAdmin : role === 'schoolAdmin' ? SchoolAdmin : Teacher;
    const user = await Model.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const match = await user.comparePassword(currentPassword);
    if (!match) return res.status(401).json({ success: false, message: 'Current password is incorrect.' });

    const same = await bcrypt.compare(newPassword, user.passwordHash);
    if (same) return res.status(400).json({ success: false, message: 'New password must differ from current password.' });

    user.passwordHash = newPassword;
    await user.save();

    // Only log for admin roles — teacher password changes are their own business
    if (role !== 'teacher') {
      await logEvent(req, 'auth.password.changed', { metadata: { role } });
    }

    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
