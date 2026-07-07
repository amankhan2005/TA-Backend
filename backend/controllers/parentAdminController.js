/**
 * parentAdminController.js — Phase 9 school-admin side of parent accounts:
 * create an account linked to a student and issue an activation token. Ownership
 * links are the security backbone, so linking is an admin-controlled action.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Parent = require('../models/Parent');
const Student = require('../models/Student');
const { logEvent } = require('../utils/audit');

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

exports.createParent = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { name, mobileNumber, email, studentId, relation } = req.body;
    if (!mobileNumber && !email) return res.status(400).json({ success: false, message: 'A mobile number or email is required.' });
    const student = await Student.findOne({ _id: studentId, schoolId });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found in this school.' });

    const activationToken = crypto.randomBytes(24).toString('hex');
    const parent = await Parent.create({
      name: name || null, mobileNumber: mobileNumber || undefined, email: email || undefined,
      passwordHash: await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10), // unusable until activation
      isActivated: false,
      resetTokenHash: hashToken(activationToken), resetTokenExpiry: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      linkedStudents: [{ student: student._id, schoolId, relation: relation || 'guardian' }],
    });
    await logEvent(req, 'parent.created', { targetType: 'Parent', targetId: parent._id, metadata: { student: student.studentId } });

    // Deliver activation link via email (reuses notification infrastructure).
    // PARENT_PORTAL_URL already carries the "/parent" subpath (e.g.
    // http://localhost:5175/parent), matching the FRONTEND_*_URL convention used
    // for the admin apps — so we append only the page path here.
    const base = (process.env.PARENT_PORTAL_URL || '').replace(/\/+$/, '');
    const activationLink = `${base}/activate?token=${activationToken}`;
    if (parent.email) {
      try {
        const { sendParentActivationEmail } = require('../utils/email');
        const school = await require('../models/School').findOne({ schoolId }).select('name');
        await sendParentActivationEmail({ toEmail: parent.email, activationLink, parentName: parent.name, schoolName: school?.name });
      } catch (e) { console.error('[parent.create] activation email failed:', e.message); }
    }

    // Raw token returned ONLY outside production (SMS/manual delivery fallback).
    const devToken = process.env.NODE_ENV === 'production' ? undefined : activationToken;
    res.status(201).json({ success: true, parentId: parent._id, activationToken: devToken, delivered: !!parent.email });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: 'A parent with that mobile/email already exists.' });
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.linkChild = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { parentId, studentId, relation } = req.body;
    const [parent, student] = await Promise.all([
      Parent.findById(parentId),
      Student.findOne({ _id: studentId, schoolId }),
    ]);
    if (!parent) return res.status(404).json({ success: false, message: 'Parent not found.' });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found in this school.' });
    if (parent.linkedStudents.some((l) => String(l.student) === String(student._id))) return res.status(409).json({ success: false, message: 'Child already linked.' });
    parent.linkedStudents.push({ student: student._id, schoolId, relation: relation || 'guardian' });
    await parent.save();
    await logEvent(req, 'parent.childLinked', { targetType: 'Parent', targetId: parent._id, metadata: { student: student.studentId } });
    res.json({ success: true, childrenCount: parent.linkedStudents.length });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};