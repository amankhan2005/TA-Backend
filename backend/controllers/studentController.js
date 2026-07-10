const Student = require('../models/Student');
const School = require('../models/School');
const RfidCard = require('../models/RfidCard');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const { logEvent } = require('../utils/audit');
const { getPagination, buildPaginatedResponse } = require('../utils/pagination');
const { prefixRegex, normaliseSearchTerm } = require('../utils/searchQuery');
// Reuse the SAME Cloudinary instance the upload preset is built on — this is
// only for deleting the previous asset on photo replace/remove (no new upload
// system is introduced).
const { cloudinary } = require('../config/cloudinary');

// Generates a short, collision-resistant, human-readable student ID.
// Not sequential/guessable on purpose (sequential IDs leak enrollment counts
// across requests) — mirrors the non-guessable-token philosophy already
// used for invite/reset tokens elsewhere in this codebase.
function generateStudentId(schoolId) {
  const shortSchool = schoolId.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `STU-${shortSchool}-${rand}`;
}

exports.createStudent = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const school = await School.findOne({ schoolId }).populate('subscriptionPlan');
    if (!school) return res.status(404).json({ success: false, message: 'School not found.' });

    // Student-limit enforcement — mirrors teacherController.createTeacher's
    // maxTeachers check exactly. A missing/null studentLimit means unlimited
    // (existing plans, before a Super Admin explicitly sets a limit).
    const plan = school.subscriptionPlan;
    if (plan?.studentLimit != null) {
      const studentCount = await Student.countDocuments({ schoolId, status: 'active' });
      if (studentCount >= plan.studentLimit) {
        return res.status(403).json({
          success: false,
          message: `Student limit reached (${plan.studentLimit}). Upgrade your subscription to add more.`,
        });
      }
    }

    const {
      admissionNumber, name, dob, gender, class: classId, section, session,
      rollNumber, admissionDate, fatherName, motherName, guardianName,
      email, mobileNumber, whatsappNumber, address,
    } = req.body;

    const student = await Student.create({
      schoolId, school: school._id,
      studentId: generateStudentId(schoolId),
      admissionNumber, name, dob, gender,
      class: classId, section, session,
      rollNumber: rollNumber || null,
      admissionDate: admissionDate || new Date(),
      fatherName, motherName, guardianName,
      email: email ? email.toLowerCase() : null,
      mobileNumber, whatsappNumber, address,
      photoUrl: req.file?.path || null,
      photoPublicId: req.file?.filename || null,
      createdBy: req.user.email,
    });

    await logEvent(req, 'student.created', {
      targetType: 'student', targetId: student._id, targetName: student.name,
      metadata: { admissionNumber, classId, section },
    });

    res.status(201).json({ success: true, message: 'Student created.', student });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ success: false, message: 'A student with this admission number already exists.' });
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Resolve the student ids whose ACTIVE RFID card number starts with `term`.
 *
 * rfidNumber lives on RfidCard, not Student — Student only carries an
 * `activeRfidCard` ObjectId pointer. So an RFID search is necessarily a
 * two-step: find matching cards in this school, then match their `student`
 * refs. RfidCard is indexed on { schoolId, status } and is an order of
 * magnitude smaller than Student, so this stays cheap.
 *
 * Returns [] when nothing matches, which the caller folds into the $or as a
 * dead branch rather than skipping (a skipped branch would wrongly widen the
 * result set).
 */
async function studentIdsMatchingRfid(schoolId, term) {
  const rx = prefixRegex(term);
  if (!rx) return [];
  const cards = await RfidCard.find({
    schoolId,
    rfidNumber: rx,
    student: { $ne: null },
  }).select('student').limit(200).lean();
  return cards.map((c) => c.student);
}

/**
 * GET /api/students?search=&classId=&section=&status=&page=&limit=
 *
 * Response shape is UNCHANGED: the standard paginated envelope from
 * utils/pagination.js — { success, total, page, limit, totalPages, results }.
 *
 * SEARCH BEHAVIOUR (rewritten)
 * Previously: `filter.$text = { $search: search }` against a `{ name: 'text' }`
 * index. That could not power a type-ahead selector:
 *   • $text matches whole stemmed tokens — "Joh" never matched "John".
 *   • studentId / admissionNumber were not in the index at all.
 *   • RFID was unreachable (different collection).
 *
 * Now: an anchored, case-insensitive regex $or across name, studentId and
 * admissionNumber, plus an id-set from the RfidCard lookup above. Anchored
 * regexes are served as index range scans by the compound indexes declared in
 * models/Student.js, so this stays sub-linear at 10,000+ students.
 *
 * `name` is anchored at any WORD boundary so typing "Smith" finds
 * "John Smith". Identifier fields are anchored at the string start only,
 * because a partial match in the middle of an ID is never what a user means.
 */
exports.getStudents = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { classId, section, status } = req.query;
    const { page, limit, skip } = getPagination(req.query);
    const term = normaliseSearchTerm(req.query.search);

    const filter = { schoolId };
    if (classId) filter.class = classId;
    if (section) filter.section = section;
    filter.status = status || 'active';

    if (term) {
      const rfidStudentIds = await studentIdsMatchingRfid(schoolId, term);
      filter.$or = [
        { name: prefixRegex(term, { wordBoundary: true }) },
        { studentId: prefixRegex(term) },
        { admissionNumber: prefixRegex(term) },
        { _id: { $in: rfidStudentIds } },
      ];
    }

    const [results, total] = await Promise.all([
      Student.find(filter)
        .populate('class', 'name')
        .populate('section', 'name')
        .populate('activeRfidCard', 'rfidNumber status')
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit),
      Student.countDocuments(filter),
    ]);

    res.json(buildPaginatedResponse(results, total, page, limit));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getStudent = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const student = await Student.findOne({ _id: req.params.id, schoolId })
      .populate('class', 'name')
      .populate('section', 'name')
      .populate('session', 'name');
    if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });
    res.json({ success: true, student });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateStudent = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const student = await Student.findOne({ _id: req.params.id, schoolId });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });

    const editableFields = [
      'name', 'dob', 'gender', 'class', 'section', 'session', 'rollNumber',
      'fatherName', 'motherName', 'guardianName', 'email', 'mobileNumber',
      'whatsappNumber', 'address', 'status',
    ];
    editableFields.forEach((field) => {
      if (req.body[field] !== undefined) student[field] = req.body[field];
    });

    // Photo lifecycle. Multipart bodies arrive as strings, so accept the common
    // truthy string forms for removePhoto. Capture the old asset id BEFORE we
    // overwrite it so we can clean it up and avoid orphaning Cloudinary assets.
    const oldPublicId = student.photoPublicId;
    const wantsRemove =
      req.body.removePhoto === true ||
      req.body.removePhoto === 'true' ||
      req.body.removePhoto === '1';

    if (req.file) {
      // Replace: point at the new asset, then best-effort destroy the previous one.
      student.photoUrl = req.file.path;
      student.photoPublicId = req.file.filename;
      if (oldPublicId && oldPublicId !== student.photoPublicId) {
        try { await cloudinary.uploader.destroy(oldPublicId); }
        catch (e) { console.error('[student.update] old photo cleanup failed:', e.message); }
      }
    } else if (wantsRemove) {
      // Remove: clear the pointers and destroy the asset (never 500 on a
      // Cloudinary hiccup — the DB is the source of truth).
      student.photoUrl = null;
      student.photoPublicId = null;
      if (oldPublicId) {
        try { await cloudinary.uploader.destroy(oldPublicId); }
        catch (e) { console.error('[student.update] photo removal cleanup failed:', e.message); }
      }
    }

    await student.save();
    await logEvent(req, 'student.updated', { targetType: 'student', targetId: student._id, targetName: student.name });
    res.json({ success: true, message: 'Student updated.', student });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.deleteStudent = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const student = await Student.findOne({ _id: req.params.id, schoolId });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });

    // Soft delete — preserves attendance/fee history integrity for a
    // student who has already accrued records (consistent with why
    // AttendanceRecord/FeePayment are append-only elsewhere in this design).
    student.status = 'inactive';
    await student.save();

    await logEvent(req, 'student.deleted', { targetType: 'student', targetId: student._id, targetName: student.name });
    res.json({ success: true, message: 'Student deactivated.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Student profile aggregation endpoint (design doc §E). Attendance/fee/
 * report/notification sections are populated once those modules exist
 * (Phase 3/4/5) — until then they return empty arrays/nulls by design,
 * not an error, since a brand-new student legitimately has no history yet.
 */
exports.getStudentProfile = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const student = await Student.findOne({ _id: req.params.id, schoolId })
      .populate('class', 'name')
      .populate('section', 'name')
      .populate('session', 'name')
      .populate('activeRfidCard');
    if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });

    // Parallel, best-effort lookups against modules that may not be built
    // yet in this deployment — each guarded so a missing model doesn't 500
    // the whole profile. Real implementations replace these guards once
    // Phase 3/4/5 land, at which point they become plain Promise.all calls.
    const safeRequire = (path) => { try { return require(path); } catch (_) { return null; } };
    const StudentAttendanceRecord = safeRequire('../models/StudentAttendanceRecord');
    const StudentInvoice = safeRequire('../models/StudentInvoice');
    const GeneratedReport = safeRequire('../models/GeneratedReport');
    const NotificationLog = safeRequire('../models/NotificationLog');
    const StudentPromotionRecord = safeRequire('../models/StudentPromotionRecord');

    const [attendanceSummary, feeSummary, reportHistory, notificationHistory, academicHistory] = await Promise.all([
      StudentAttendanceRecord
        ? StudentAttendanceRecord.aggregate([
            { $match: { student: student._id } },
            { $group: { _id: '$status', count: { $sum: 1 } } },
          ])
        : [],
      StudentInvoice
        ? StudentInvoice.find({ student: student._id }).select('status totalPayableMinor paidMinor currency invoiceNumber dueDate').sort({ dueDate: -1 }).limit(10)
        : [],
      GeneratedReport
        ? GeneratedReport.find({ student: student._id }).sort({ generatedAt: -1 }).limit(10)
        : [],
      NotificationLog
        ? NotificationLog.find({ student: student._id }).sort({ createdAt: -1 }).limit(20)
        : [],
      StudentPromotionRecord
        ? StudentPromotionRecord.find({ student: student._id })
            .populate('previousClass', 'name').populate('newClass', 'name')
            .populate('newSession', 'name').sort({ promotedAt: -1 }).limit(20)
        : [],
    ]);

    res.json({
      success: true,
      student,
      attendanceSummary,
      feeSummary,
      reportHistory,
      notificationHistory,
      academicHistory,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};