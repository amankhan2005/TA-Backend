const Teacher = require('../models/Teacher');
const School = require('../models/School');
const SchoolClass = require('../models/SchoolClass');
const AttendanceRecord = require('../models/AttendanceRecord');
const { sendTeacherWelcomeEmail } = require('../utils/email');
const { logEvent } = require('../utils/audit');
const { getPagination, buildPaginatedResponse } = require('../utils/pagination');
const { prefixRegex, normaliseSearchTerm } = require('../utils/searchQuery');

/**
 * Detach a teacher from every class where they are the class teacher.
 *
 * WHY THIS EXISTS: Teacher documents are HARD-deleted (deleteTeacher,
 * resolveDeletionRequest → approve). SchoolClass.classTeacher is an ObjectId
 * ref with no database-level foreign key, so a delete would leave a dangling
 * pointer that `.populate()` silently resolves to `null` — a class that looks
 * unassigned but still holds a ghost id. Every hard-delete path calls this
 * first, inside the same request, before the Teacher row disappears.
 */
async function detachTeacherFromClasses(schoolId, teacherId) {
  const result = await SchoolClass.updateMany(
    { schoolId, classTeacher: teacherId },
    { $set: { classTeacher: null, classTeacherAssignedAt: null, classTeacherAssignedBy: null } }
  );
  return result.modifiedCount || 0;
}

// ─── CREATE TEACHER ─────────────────────────────────────────────────────────
exports.createTeacher = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { name, email, password, phone, sendWelcomeEmail } = req.body;

    const school = await School.findOne({ schoolId });
    const teacherCount = await Teacher.countDocuments({ schoolId });

    if (teacherCount >= school.maxTeachers) {
      return res.status(403).json({
        success: false,
        message: `Teacher limit reached (${school.maxTeachers}). Upgrade your subscription to add more.`,
      });
    }

    const teacher = await Teacher.create({
      schoolId,
      school: school._id,
      name,
      email: email.toLowerCase(),
      passwordHash: password,
      phone: phone || null,
    });

    if (sendWelcomeEmail) {
      try {
        await sendTeacherWelcomeEmail({ toEmail: email, teacherName: name, schoolName: school.name, tempPassword: password });
      } catch (_) {}
    }

    await logEvent(req, 'teacher.created', {
      targetType: 'teacher',
      targetId: teacher._id,
      targetName: teacher.name,
      metadata: {
        email: teacher.email,
        phone: teacher.phone,
        welcomeEmailSent: !!sendWelcomeEmail,
        teacherCount: teacherCount + 1,
        maxTeachers: school.maxTeachers,
      },
    });

    res.status(201).json({ success: true, message: 'Teacher account created.', teacher: teacher.toSafeObject() });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ success: false, message: 'A teacher with this email already exists.' });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET ALL TEACHERS ───────────────────────────────────────────────────────
/**
 * GET /api/teachers?search=&isActive=&page=&limit=
 *
 * RESPONSE SHAPE IS BACKWARDS COMPATIBLE. The original contract —
 * { success, total, maxTeachers, teachers } — is preserved exactly, because
 * TeachersPage.jsx and the teacher analytics UI read `teachers` directly.
 * We ADD `results` / `page` / `limit` / `totalPages` alongside it so the new
 * searchable selector can paginate. Existing callers that pass no page/limit
 * still receive the full list (limit defaults high enough to be a no-op for
 * schools under the 1,000-teacher target).
 *
 * SEARCH (widened): was `filter.name = { $regex: search }` — name only, and
 * unanchored, so it scanned the collection. Now an anchored $or across
 * name / email / phone, served by the compound indexes in models/Teacher.js.
 */
exports.getTeachers = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { isActive } = req.query;
    const term = normaliseSearchTerm(req.query.search);

    const filter = { schoolId };
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    if (term) {
      filter.$or = [
        { name: prefixRegex(term, { wordBoundary: true }) },
        { email: prefixRegex(term) },
        { phone: prefixRegex(term) },
      ];
    }

    // Pagination is OPT-IN: only applied when the caller asks for it, so the
    // legacy "give me every teacher" call keeps working untouched.
    const wantsPaging = req.query.page !== undefined || req.query.limit !== undefined;

    let teachers;
    let total;

    if (wantsPaging) {
      const { page, limit, skip } = getPagination(req.query);
      [teachers, total] = await Promise.all([
        Teacher.find(filter).select('-passwordHash').sort({ name: 1 }).skip(skip).limit(limit),
        Teacher.countDocuments(filter),
      ]);
      const school = await School.findOne({ schoolId });
      const body = buildPaginatedResponse(teachers, total, page, limit);
      return res.json({ ...body, teachers, maxTeachers: school?.maxTeachers });
    }

    teachers = await Teacher.find(filter).select('-passwordHash').sort({ name: 1 });
    total = teachers.length;
    const school = await School.findOne({ schoolId });

    res.json({ success: true, total, maxTeachers: school?.maxTeachers, teachers, results: teachers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET SINGLE TEACHER ─────────────────────────────────────────────────────
exports.getTeacher = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const teacher = await Teacher.findOne({ _id: req.params.id, schoolId }).select('-passwordHash');
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found.' });
    res.json({ success: true, teacher });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── UPDATE TEACHER ─────────────────────────────────────────────────────────
/**
 * Deactivating (isActive → false) a teacher who currently holds a class ALSO
 * detaches them. assignClassTeacher refuses to assign an inactive teacher, so
 * leaving an inactive teacher attached would create a state the assign path
 * itself considers illegal.
 */
exports.updateTeacher = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { name, phone, isActive } = req.body;

    const oldTeacher = await Teacher.findOne({ _id: req.params.id, schoolId });
    if (!oldTeacher) return res.status(404).json({ success: false, message: 'Teacher not found.' });

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (isActive !== undefined) updateData.isActive = isActive;

    const teacher = await Teacher.findOneAndUpdate(
      { _id: req.params.id, schoolId },
      updateData,
      { new: true, runValidators: true }
    ).select('-passwordHash');

    let detachedClasses = 0;
    if (isActive === false && oldTeacher.isActive === true) {
      detachedClasses = await detachTeacherFromClasses(schoolId, teacher._id);
    }

    const changes = {};
    if (name !== undefined && name !== oldTeacher.name) changes.name = { from: oldTeacher.name, to: name };
    if (phone !== undefined && phone !== oldTeacher.phone) changes.phone = { from: oldTeacher.phone, to: phone };
    if (isActive !== undefined && isActive !== oldTeacher.isActive) changes.isActive = { from: oldTeacher.isActive, to: isActive };

    await logEvent(req, 'teacher.updated', {
      targetType: 'teacher',
      targetId: teacher._id,
      targetName: teacher.name,
      metadata: { changes, detachedClasses },
    });

    res.json({
      success: true,
      message: detachedClasses
        ? `Teacher updated. Removed as class teacher from ${detachedClasses} class(es).`
        : 'Teacher updated.',
      teacher,
      detachedClasses,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── RESET TEACHER PASSWORD ─────────────────────────────────────────────────
exports.resetTeacherPassword = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const teacher = await Teacher.findOne({ _id: req.params.id, schoolId });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found.' });

    teacher.passwordHash = req.body.newPassword;
    await teacher.save();

    await logEvent(req, 'teacher.password.reset', {
      targetType: 'teacher',
      targetId: teacher._id,
      targetName: teacher.name,
      metadata: { teacherEmail: teacher.email },
    });

    res.json({ success: true, message: 'Teacher password reset successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── DELETE TEACHER ─────────────────────────────────────────────────────────
exports.deleteTeacher = async (req, res) => {
  try {
    const { schoolId } = req.user;

    // Detach BEFORE the document disappears — otherwise SchoolClass.classTeacher
    // holds an id that resolves to nothing.
    const detachedClasses = await detachTeacherFromClasses(schoolId, req.params.id);

    const teacher = await Teacher.findOneAndDelete({ _id: req.params.id, schoolId });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found.' });

    await logEvent(req, 'teacher.deleted', {
      targetType: 'teacher',
      targetId: req.params.id,
      targetName: teacher.name,
      metadata: { email: teacher.email, phone: teacher.phone, detachedClasses },
    });

    res.json({
      success: true,
      message: detachedClasses
        ? `Teacher deleted. Removed as class teacher from ${detachedClasses} class(es).`
        : 'Teacher deleted successfully.',
      detachedClasses,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── RESET TEACHER DEVICE ───────────────────────────────────────────────────
exports.resetTeacherDevice = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const teacher = await Teacher.findOneAndUpdate(
      { _id: req.params.id, schoolId },
      { deviceId: null },
      { new: true }
    ).select('-passwordHash');
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found.' });

    await logEvent(req, 'teacher.device.reset', {
      targetType: 'teacher',
      targetId: teacher._id,
      targetName: teacher.name,
      metadata: { teacherEmail: teacher.email },
    });

    res.json({ success: true, message: 'Device session reset. Teacher can login from a new device.', teacher });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── GET TEACHER ANALYTICS ──────────────────────────────────────────────────
exports.getTeacherAnalytics = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { month, year } = req.params;

    const datePrefix = `${year}-${String(month).padStart(2, '0')}`;
    const teachers = await Teacher.find({ schoolId, isActive: true }).select('name email');
    const records = await AttendanceRecord.find({ schoolId, date: { $regex: `^${datePrefix}` } });

    const workingDaysSet = new Set(records.map(r => r.date));
    const workingDays = workingDaysSet.size || 1;

    const analytics = teachers.map(teacher => {
      const teacherRecords = records.filter(r => r.teacherId === teacher._id.toString());
      const presentDays = teacherRecords.length;
      const absentDays = workingDays - presentDays;
      const attendancePct = Math.round((presentDays / workingDays) * 100);

      const onTime = teacherRecords.filter(r => {
        const hour = new Date(r.markedAt).getUTCHours();
        return hour < 6; // before 9am EAT (UTC+3)
      }).length;

      return {
        teacher: { id: teacher._id, name: teacher.name, email: teacher.email },
        presentDays, absentDays, workingDays,
        attendancePercentage: attendancePct,
        onTimeDays: onTime,
        records: teacherRecords.map(r => ({ date: r.date, mode: r.mode, markedAt: r.markedAt })),
      };
    });

    analytics.sort((a, b) => b.attendancePercentage - a.attendancePercentage);
    res.json({ success: true, month, year, workingDays, analytics });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Issue 7 / 8: GET OWN PROFILE (teacher) ─────────────────────────────────
// Returns teacher + populated school (name, logoUrl) for displaying school logo
exports.getMyProfile = async (req, res) => {
  try {
    const { userId: teacherId } = req.user;  // req.user = { userId, schoolId, role, email }
    const teacher = await Teacher.findById(teacherId)
      .select('-passwordHash')
      .populate('school', 'name logoUrl city state phone website');
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found.' });
    res.json({ success: true, teacher });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Issue 8: UPLOAD OWN PROFILE PHOTO (teacher) ─────────────────────────────
exports.uploadMyPhoto = async (req, res) => {
  try {
    const { userId: teacherId } = req.user;
    if (!req.file) return res.status(400).json({ success: false, message: 'No photo uploaded.' });
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found.' });
    // Delete old Cloudinary image if present
    if (teacher.profileImagePublicId) {
      const { cloudinary } = require('../config/cloudinary');
      try { await cloudinary.uploader.destroy(teacher.profileImagePublicId); } catch (_) {}
    }
    teacher.profileImageUrl      = req.file.path;
    teacher.profileImagePublicId = req.file.filename;
    await teacher.save();
    res.json({ success: true, message: 'Profile photo updated.', teacher: teacher.toSafeObject() });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Issue 8: UPLOAD TEACHER PHOTO (school admin) ────────────────────────────
exports.uploadTeacherPhoto = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ success: false, message: 'No photo uploaded.' });
    const teacher = await Teacher.findOne({ _id: id, schoolId });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found.' });
    if (teacher.profileImagePublicId) {
      const { cloudinary } = require('../config/cloudinary');
      try { await cloudinary.uploader.destroy(teacher.profileImagePublicId); } catch (_) {}
    }
    teacher.profileImageUrl      = req.file.path;
    teacher.profileImagePublicId = req.file.filename;
    await teacher.save();
    res.json({ success: true, message: 'Teacher photo updated.', teacher: teacher.toSafeObject() });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Issue 9: TEACHER REQUESTS OWN DELETION ──────────────────────────────────
exports.requestDeletion = async (req, res) => {
  try {
    const { userId: teacherId } = req.user;
    const { reason } = req.body;
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found.' });
    if (teacher.deletionRequest && teacher.deletionRequest.requested)
      return res.status(400).json({ success: false, message: 'Deletion request already submitted.' });
    teacher.deletionRequest = { requested: true, requestedAt: new Date(), reason: reason || null, status: 'pending' };
    await teacher.save();
    res.json({ success: true, message: 'Deletion request submitted. Your school admin will review it.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Issue 9: LIST DELETION REQUESTS (school admin) ──────────────────────────
exports.getDeletionRequests = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const teachers = await Teacher.find({ schoolId, 'deletionRequest.requested': true }).select('-passwordHash');
    res.json({ success: true, total: teachers.length, teachers });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Issue 9: APPROVE / REJECT DELETION (school admin) ───────────────────────
exports.resolveDeletionRequest = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { id } = req.params;
    const { action } = req.body;  // 'approve' | 'reject'
    if (!['approve','reject'].includes(action))
      return res.status(400).json({ success: false, message: "action must be 'approve' or 'reject'." });
    const teacher = await Teacher.findOne({ _id: id, schoolId });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found.' });
    if (!teacher.deletionRequest || !teacher.deletionRequest.requested)
      return res.status(400).json({ success: false, message: 'No pending deletion request.' });

    if (action === 'approve') {
      // Same dangling-ref hazard as deleteTeacher — detach first.
      const detachedClasses = await detachTeacherFromClasses(schoolId, id);
      await Teacher.findOneAndDelete({ _id: id, schoolId });
      await logEvent(req, 'teacher.deletion.approved', {
        targetType:'teacher', targetId:id, targetName:teacher.name,
        metadata:{ email:teacher.email, detachedClasses },
      });
      return res.json({ success: true, message: 'Teacher account deleted.', detachedClasses });
    }

    teacher.deletionRequest.status     = 'rejected';
    teacher.deletionRequest.resolvedAt = new Date();
    teacher.deletionRequest.resolvedBy = req.user.email;
    await teacher.save();
    await logEvent(req, 'teacher.deletion.rejected', { targetType:'teacher', targetId:id, targetName:teacher.name });
    res.json({ success: true, message: 'Request rejected. Teacher account remains active.', teacher: teacher.toSafeObject() });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Issue 10: UPDATE SCHOOL DETAILS (school admin) ──────────────────────────
exports.updateMySchoolDetails = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { name, city, state, phone, website } = req.body;
    const upd = {};
    if (name    && name.trim())    upd.name    = name.trim();
    if (city    && city.trim())    upd.city    = city.trim();
    if (state   && state.trim())   upd.state   = state.trim();
    if (phone   && phone.trim())   upd.phone   = phone.trim();
    if (website !== undefined)     upd.website = website || null;
    const school = await School.findOneAndUpdate({ schoolId }, { $set: upd }, { new: true, runValidators: true }).populate('subscriptionPlan');
    if (!school) return res.status(404).json({ success: false, message: 'School not found.' });
    await logEvent(req, 'school.details.updated', { targetType:'school', targetId:schoolId, targetName:school.name, metadata:{ fields:Object.keys(upd) } });
    const teacherCount = await Teacher.countDocuments({ schoolId });
    res.json({ success: true, message: 'School details updated.', school: { ...school.toObject(), teacherCount } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// Exported for reuse/testing.
exports._detachTeacherFromClasses = detachTeacherFromClasses;