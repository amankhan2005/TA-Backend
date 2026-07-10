const { v4: uuidv4 } = require('uuid');
const School = require('../models/School');
const SchoolAdmin = require('../models/SchoolAdmin');
const SchoolSettings = require('../models/SchoolSettings');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const Teacher = require('../models/Teacher');
const AttendanceRecord = require('../models/AttendanceRecord');
const { generateToken, verifyToken, getInviteExpiry } = require('../utils/token');
const { sendSchoolInviteEmail } = require('../utils/email');
const { cloudinary } = require('../config/cloudinary');
const { logEvent } = require('../utils/audit');
const brand = require('../config/brand');

// ─── SEND SCHOOL INVITATION ─────────────────────────────────────────────────
exports.inviteSchool = async (req, res) => {
  try {
    const { schoolName, adminEmail, planId, maxTeachers } = req.body;

    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) return res.status(404).json({ success: false, message: 'Subscription plan not found.' });

    const existing = await SchoolAdmin.findOne({ email: adminEmail.toLowerCase() });
    if (existing) return res.status(400).json({ success: false, message: 'An admin with this email already exists.' });

    const existingSchool = await School.findOne({ inviteEmail: adminEmail.toLowerCase() });
    if (existingSchool) return res.status(400).json({ success: false, message: 'An invitation has already been sent to this email.' });

    const schoolId = uuidv4();
    const { rawToken, hashedToken } = await generateToken();

    const school = await School.create({
      schoolId,
      name: schoolName,
      city: 'Pending',
      state: 'Pending',
      phone: 'Pending',
      subscriptionPlan: plan._id,
      maxTeachers: maxTeachers || plan.maxTeachers,
      inviteToken: hashedToken,
      inviteTokenExpiry: getInviteExpiry(),
      inviteEmail: adminEmail.toLowerCase(),
      status: 'inactive',
    });

    const inviteLink = `${brand.schoolAdminUrl()}/register?token=${rawToken}&schoolId=${schoolId}`;
    await sendSchoolInviteEmail({ toEmail: adminEmail, schoolName, inviteLink });

    await logEvent(req, 'school.invite.sent', {
      targetType: 'school',
      targetId: schoolId,
      targetName: schoolName,
      metadata: { adminEmail, planId, planName: plan.name, maxTeachers: maxTeachers || plan.maxTeachers },
    });

    res.status(201).json({ success: true, message: `Invitation sent to ${adminEmail}.`, schoolId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── RESEND SCHOOL INVITATION ───────────────────────────────────────────────
exports.resendInvite = async (req, res) => {
  try {
    const { schoolId } = req.params;
    const school = await School.findOne({ schoolId });
    if (!school) return res.status(404).json({ success: false, message: 'School not found.' });
    if (school.status !== 'inactive' || !school.inviteEmail) {
      return res.status(400).json({ success: false, message: 'This school has already completed registration.' });
    }

    const { rawToken, hashedToken } = await generateToken();
    school.inviteToken = hashedToken;
    school.inviteTokenExpiry = getInviteExpiry();
    await school.save();

    const inviteLink = `${brand.schoolAdminUrl()}/register?token=${rawToken}&schoolId=${schoolId}`;
    await sendSchoolInviteEmail({ toEmail: school.inviteEmail, schoolName: school.name, inviteLink });

    await logEvent(req, 'school.invite.resent', {
      targetType: 'school',
      targetId: schoolId,
      targetName: school.name,
      metadata: { adminEmail: school.inviteEmail },
    });

    res.json({ success: true, message: `Invitation resent to ${school.inviteEmail}.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── COMPLETE SCHOOL REGISTRATION ──────────────────────────────────────────
exports.registerSchool = async (req, res) => {
  try {
    const { token, schoolId, name, password, schoolName, city, state, phone, website } = req.body;
    const logoUrl = req.file ? req.file.path : null;
    const logoPublicId = req.file ? req.file.filename : null;

    const school = await School.findOne({ schoolId });
    if (!school) return res.status(404).json({ success: false, message: 'Invalid registration link.' });
    if (!school.inviteToken || !school.inviteTokenExpiry) {
      return res.status(400).json({ success: false, message: 'This invite link has already been used.' });
    }
    if (new Date() > school.inviteTokenExpiry) {
      return res.status(400).json({ success: false, message: 'Invite link has expired. Contact your platform admin.' });
    }

    const valid = await verifyToken(token, school.inviteToken);
    if (!valid) return res.status(400).json({ success: false, message: 'Invalid invite token.' });

    const adminEmail = school.inviteEmail;

    school.name = schoolName || school.name;
    school.city = city;
    school.state = state;
    school.phone = phone;
    school.website = website || null;
    if (logoUrl) { school.logoUrl = logoUrl; school.logoPublicId = logoPublicId; }
    school.status = 'active';
    school.inviteToken = null;
    school.inviteTokenExpiry = null;
    school.inviteEmail = null;
    await school.save();

    const admin = await SchoolAdmin.create({
      schoolId,
      school: school._id,
      name,
      email: adminEmail,
      passwordHash: password,
    });

    await SchoolSettings.create({ schoolId, school: school._id });

    // Log as system since this is a public route (no req.user)
    await logEvent(req, 'school.registered', {
      actorOverride: { userId: admin._id, email: adminEmail, role: 'schoolAdmin', schoolId },
      targetType: 'school',
      targetId: schoolId,
      targetName: school.name,
      metadata: { city, state, phone, hasLogo: !!logoUrl },
    });

    res.status(201).json({ success: true, message: 'School registered successfully. You can now login.' });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'An admin with this email already exists.' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET ALL SCHOOLS ─────────────────────────────────────────────────────────
exports.getAllSchools = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (search) filter.name = { $regex: search, $options: 'i' };

    const schools = await School.find(filter)
      .populate('subscriptionPlan', 'name maxTeachers price')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await School.countDocuments(filter);

    const schoolsWithStats = await Promise.all(schools.map(async (s) => {
      const teacherCount = await Teacher.countDocuments({ schoolId: s.schoolId });
      return { ...s.toObject(), teacherCount };
    }));

    res.json({ success: true, total, page: parseInt(page), schools: schoolsWithStats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET SINGLE SCHOOL ──────────────────────────────────────────────────────
exports.getSchool = async (req, res) => {
  try {
    const school = await School.findOne({ schoolId: req.params.schoolId }).populate('subscriptionPlan');
    if (!school) return res.status(404).json({ success: false, message: 'School not found.' });
    const teacherCount = await Teacher.countDocuments({ schoolId: school.schoolId });
    res.json({ success: true, school: { ...school.toObject(), teacherCount } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── ENABLE / DISABLE SCHOOL ────────────────────────────────────────────────
exports.setSchoolStatus = async (req, res) => {
  try {
    const { schoolId } = req.params;
    const { status, reason } = req.body;

    const oldSchool = await School.findOne({ schoolId });
    if (!oldSchool) return res.status(404).json({ success: false, message: 'School not found.' });

    const school = await School.findOneAndUpdate({ schoolId }, { status }, { new: true });

    await logEvent(req, 'school.status.changed', {
      targetType: 'school',
      targetId: schoolId,
      targetName: school.name,
      metadata: {
        previousStatus: oldSchool.status,
        newStatus: status,
        reason: reason || null,
      },
    });

    res.json({ success: true, message: `School status set to ${status}.`, school });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── UPDATE SCHOOL SUBSCRIPTION ─────────────────────────────────────────────
exports.updateSchoolPlan = async (req, res) => {
  try {
    const { schoolId } = req.params;
    const { planId, maxTeachers } = req.body;

    const plan = await SubscriptionPlan.findById(planId);
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found.' });

    const oldSchool = await School.findOne({ schoolId }).populate('subscriptionPlan');
    if (!oldSchool) return res.status(404).json({ success: false, message: 'School not found.' });

    const school = await School.findOneAndUpdate(
      { schoolId },
      { subscriptionPlan: plan._id, maxTeachers: maxTeachers || plan.maxTeachers },
      { new: true }
    ).populate('subscriptionPlan');

    await logEvent(req, 'school.plan.changed', {
      targetType: 'school',
      targetId: schoolId,
      targetName: school.name,
      metadata: {
        previousPlan: oldSchool.subscriptionPlan?.name || null,
        newPlan: plan.name,
        previousMaxTeachers: oldSchool.maxTeachers,
        newMaxTeachers: maxTeachers || plan.maxTeachers,
      },
    });

    res.json({ success: true, message: 'Subscription updated.', school });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── UPDATE SCHOOL LOGO (school admin) ──────────────────────────────────────
exports.updateSchoolLogo = async (req, res) => {
  try {
    const { schoolId } = req.user;
    if (!req.file) return res.status(400).json({ success: false, message: 'No logo file uploaded.' });

    const school = await School.findOne({ schoolId });
    if (!school) return res.status(404).json({ success: false, message: 'School not found.' });

    const hadPreviousLogo = !!school.logoPublicId;
    if (school.logoPublicId) {
      try { await cloudinary.uploader.destroy(school.logoPublicId); } catch (_) {}
    }
    school.logoUrl = req.file.path;
    school.logoPublicId = req.file.filename;
    await school.save();

    await logEvent(req, 'school.logo.updated', {
      targetType: 'school',
      targetId: schoolId,
      targetName: school.name,
      metadata: { replacedPrevious: hadPreviousLogo, newLogoUrl: school.logoUrl },
    });

    res.json({ success: true, message: 'Logo updated.', logoUrl: school.logoUrl });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET SCHOOL PROFILE (school admin) ──────────────────────────────────────
exports.getMySchool = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const school = await School.findOne({ schoolId }).populate('subscriptionPlan');
    if (!school) return res.status(404).json({ success: false, message: 'School not found.' });
    const teacherCount = await Teacher.countDocuments({ schoolId });
    res.json({ success: true, school: { ...school.toObject(), teacherCount } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET SYSTEM STATS (super admin dashboard) ───────────────────────────────
exports.getSystemStats = async (req, res) => {
  try {
    const totalSchools = await School.countDocuments();
    const activeSchools = await School.countDocuments({ status: 'active' });
    const inactiveSchools = await School.countDocuments({ status: 'inactive' });
    const suspendedSchools = await School.countDocuments({ status: 'suspended' });
    const totalTeachers = await Teacher.countDocuments();

    const today = new Date().toISOString().split('T')[0];
    const todayAttendance = await AttendanceRecord.countDocuments({ date: today });

    const planBreakdown = await School.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$subscriptionPlan', count: { $sum: 1 } } },
      { $lookup: { from: 'subscriptionplans', localField: '_id', foreignField: '_id', as: 'plan' } },
      { $unwind: '$plan' },
      { $project: { planName: '$plan.name', count: 1 } },
    ]);

    res.json({
      success: true,
      stats: {
        totalSchools, activeSchools, inactiveSchools, suspendedSchools,
        totalTeachers, todayAttendance,
        subscriptionBreakdown: planBreakdown,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET SCHOOL ATTENDANCE (super admin) ────────────────────────────────────
exports.getSchoolAttendance = async (req, res) => {
  try {
    const { schoolId } = req.params;
    const { date, month, year } = req.query;

    const filter = { schoolId };
    if (date) {
      filter.date = date;
    } else if (month && year) {
      filter.date = { $regex: `^${year}-${String(month).padStart(2, '0')}` };
    } else {
      filter.date = new Date().toISOString().split('T')[0];
    }

    const records = await AttendanceRecord.find(filter)
      .populate('teacher', 'name email')
      .sort({ markedAt: -1 });

    res.json({ success: true, total: records.length, records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── REAL ANALYTICS: monthly attendance trend + school growth ───────────────
// GET /api/schools/analytics?months=12
exports.getAnalytics = async (req, res) => {
  try {
    const months = Math.min(parseInt(req.query.months) || 12, 24);
    const now = new Date();
    const results = [];

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year  = d.getFullYear();
      const month = d.getMonth() + 1;
      const monthStr = `${year}-${String(month).padStart(2, '0')}`;
      const label = d.toLocaleString('en', { month: 'short', year: '2-digit' });

      // Attendance count for this month across all schools
      const attendanceCount = await AttendanceRecord.countDocuments({
        date: { $regex: `^${monthStr}` },
      });

      // Schools registered by end of this month
      const endOfMonth = new Date(year, month, 0, 23, 59, 59);
      const schoolCount = await School.countDocuments({
        createdAt: { $lte: endOfMonth },
        status: { $in: ['active', 'suspended'] }, // exclude pending invites
      });

      results.push({ month: label, attendance: attendanceCount, schools: schoolCount });
    }

    // Current month summary
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [suspiciousThisMonth, topSchools] = await Promise.all([
      AttendanceRecord.countDocuments({
        date: { $regex: `^${currentMonth}` },
        isSuspicious: true,
      }),
      // Top 5 schools by attendance this month
      AttendanceRecord.aggregate([
        { $match: { date: { $regex: `^${currentMonth}` } } },
        { $group: { _id: '$schoolId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
        { $lookup: { from: 'schools', localField: '_id', foreignField: 'schoolId', as: 'school' } },
        { $unwind: '$school' },
        { $project: { schoolId: '$_id', name: '$school.name', count: 1, _id: 0 } },
      ]),
    ]);

    res.json({
      success: true,
      analytics: {
        trend: results,
        suspiciousThisMonth,
        topSchools,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── VALIDATE INVITE LINK (public, GET) ─────────────────────────────────────
// Used by the frontend to check if an invite is still valid before showing the form.
exports.validateInvite = async (req, res) => {
  try {
    const { token, schoolId } = req.query;

    if (!token || !schoolId) {
      return res.status(400).json({ success: false, message: 'Missing token or schoolId.' });
    }

    const school = await School.findOne({ schoolId });
    if (!school) {
      return res.status(404).json({ success: false, message: 'Invalid registration link.' });
    }

    if (!school.inviteToken || !school.inviteTokenExpiry) {
      return res.status(400).json({ success: false, message: 'This invite link has already been used.' });
    }

    if (new Date() > school.inviteTokenExpiry) {
      return res.status(400).json({ success: false, message: 'Invite link has expired. Contact your platform admin.' });
    }

    const valid = await verifyToken(token, school.inviteToken);
    if (!valid) {
      return res.status(400).json({ success: false, message: 'Invalid invite token.' });
    }

    res.json({
      success: true,
      schoolName: school.name,
      inviteEmail: school.inviteEmail,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};