const AcademicSession = require('../models/AcademicSession');
const SchoolClass = require('../models/SchoolClass');
const Section = require('../models/Section');
const School = require('../models/School');
const Teacher = require('../models/Teacher');
const Student = require('../models/Student');
const FeeStructure = require('../models/FeeStructure');
const { logEvent } = require('../utils/audit');

// Fields exposed when a class teacher is populated onto a class. Never
// includes passwordHash; `isActive` is the teacher's employment status, which
// the Class Dashboard renders as the "Status" column.
const TEACHER_PUBLIC_FIELDS = 'name email phone isActive profileImageUrl';

// ═════════════════════════ ACADEMIC SESSIONS ═══════════════════════════════

exports.createSession = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { name, startDate, endDate, makeActive } = req.body;
    const school = await School.findOne({ schoolId });
    if (!school) return res.status(404).json({ success: false, message: 'School not found.' });

    const session = await AcademicSession.create({
      schoolId, school: school._id, name, startDate, endDate, isActive: !!makeActive,
    });

    if (makeActive) {
      await AcademicSession.updateMany({ schoolId, _id: { $ne: session._id } }, { isActive: false });
    }

    await logEvent(req, 'academicSession.created', {
      targetType: 'academicSession', targetId: session._id, targetName: session.name,
      metadata: { startDate, endDate, isActive: session.isActive },
    });

    res.status(201).json({ success: true, message: 'Academic session created.', session });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ success: false, message: 'A session with this name already exists.' });
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getSessions = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const sessions = await AcademicSession.find({ schoolId }).sort({ startDate: -1 });
    res.json({ success: true, total: sessions.length, sessions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.activateSession = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const session = await AcademicSession.findOne({ _id: req.params.id, schoolId });
    if (!session) return res.status(404).json({ success: false, message: 'Session not found.' });

    await AcademicSession.updateMany({ schoolId }, { isActive: false });
    session.isActive = true;
    await session.save();

    await logEvent(req, 'academicSession.activated', {
      targetType: 'academicSession', targetId: session._id, targetName: session.name,
    });

    res.json({ success: true, message: 'Session activated.', session });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ═════════════════════════ CLASSES (GRADES) ════════════════════════════════

exports.createClass = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { name, session, sortOrder } = req.body;
    const school = await School.findOne({ schoolId });
    if (!school) return res.status(404).json({ success: false, message: 'School not found.' });

    const schoolClass = await SchoolClass.create({
      schoolId, school: school._id, session, name, sortOrder: sortOrder ?? 0,
    });

    await logEvent(req, 'schoolClass.created', {
      targetType: 'schoolClass', targetId: schoolClass._id, targetName: schoolClass.name,
    });

    res.status(201).json({ success: true, message: 'Class created.', schoolClass });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ success: false, message: 'This class already exists for the selected session.' });
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Optional "quick setup" — bulk-creates the standard Liberia grade list
 * (Nursery through Grade 12) for a session in one call. School Admin is
 * never required to use this; createClass above still works for any
 * fully-custom grade name, and classes created this way are ordinary
 * SchoolClass documents indistinguishable from manually-created ones.
 */
exports.createDefaultLiberiaGrades = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { session } = req.body;
    const school = await School.findOne({ schoolId });
    if (!school) return res.status(404).json({ success: false, message: 'School not found.' });

    const { DEFAULT_LIBERIA_GRADES } = require('../models/SchoolClass');
    const docs = DEFAULT_LIBERIA_GRADES.map((name, index) => ({
      schoolId, school: school._id, session, name, sortOrder: index,
    }));

    const created = await SchoolClass.insertMany(docs, { ordered: false }).catch((err) => {
      // Partial success is expected/fine if some grade names already exist
      // for this session (unique index) — surface what actually landed.
      if (err.insertedDocs) return err.insertedDocs;
      throw err;
    });

    await logEvent(req, 'schoolClass.created', {
      targetType: 'schoolClass', targetId: null, targetName: 'Default Liberia grade set',
      metadata: { count: created.length, session },
    });

    res.status(201).json({ success: true, message: `${created.length} default grades created.`, classes: created });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Response shape unchanged: { success, total, classes }.
 * `classTeacher` is now populated (or null) on every class — the School Admin
 * Class Dashboard reads name/email/phone/isActive straight off it.
 */
exports.getClasses = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { session } = req.query;
    const filter = { schoolId };
    if (session) filter.session = session;

    const classes = await SchoolClass.find(filter)
      .populate('classTeacher', TEACHER_PUBLIC_FIELDS)
      .sort({ sortOrder: 1 });
    res.json({ success: true, total: classes.length, classes });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateClass = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { name, sortOrder, isActive } = req.body;
    const schoolClass = await SchoolClass.findOne({ _id: req.params.id, schoolId });
    if (!schoolClass) return res.status(404).json({ success: false, message: 'Class not found.' });

    if (name !== undefined) schoolClass.name = name;
    if (sortOrder !== undefined) schoolClass.sortOrder = sortOrder;
    if (isActive !== undefined) schoolClass.isActive = isActive;
    await schoolClass.save();

    await logEvent(req, 'schoolClass.updated', { targetType: 'schoolClass', targetId: schoolClass._id, targetName: schoolClass.name });

    const populated = await SchoolClass.findById(schoolClass._id).populate('classTeacher', TEACHER_PUBLIC_FIELDS);
    res.json({ success: true, message: 'Class updated.', schoolClass: populated });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ success: false, message: 'This class already exists for the selected session.' });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ═════════════════════════ CLASS TEACHER ═══════════════════════════════════

/**
 * PUT /api/classes/:id/teacher   { teacherId }
 *
 * Assign OR change the class teacher. Idempotent-ish: re-assigning the same
 * teacher is a no-op that still returns 200 with the current state, so a
 * double-click in the UI can't produce a spurious error.
 *
 * Both the class and the teacher are re-fetched under `schoolId` — a School
 * Admin can never attach another school's teacher to their class, regardless
 * of what id the client sends.
 */
exports.assignClassTeacher = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { teacherId } = req.body;

    if (!teacherId) {
      return res.status(400).json({ success: false, message: 'A teacherId is required.' });
    }

    const [schoolClass, teacher] = await Promise.all([
      SchoolClass.findOne({ _id: req.params.id, schoolId }),
      Teacher.findOne({ _id: teacherId, schoolId }).select(TEACHER_PUBLIC_FIELDS),
    ]);

    if (!schoolClass) return res.status(404).json({ success: false, message: 'Class not found.' });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found in this school.' });

    // An inactive (suspended/offboarded) teacher must not be handed a class.
    if (!teacher.isActive) {
      return res.status(400).json({ success: false, message: 'This teacher is inactive and cannot be assigned as class teacher.' });
    }

    const previousTeacherId = schoolClass.classTeacher ? String(schoolClass.classTeacher) : null;
    const isChange = previousTeacherId && previousTeacherId !== String(teacher._id);

    schoolClass.classTeacher = teacher._id;
    schoolClass.classTeacherAssignedAt = new Date();
    schoolClass.classTeacherAssignedBy = req.user.email || null;
    await schoolClass.save();

    await logEvent(req, isChange ? 'schoolClass.classTeacherChanged' : 'schoolClass.classTeacherAssigned', {
      targetType: 'schoolClass',
      targetId: schoolClass._id,
      targetName: schoolClass.name,
      metadata: {
        teacherId: String(teacher._id),
        teacherName: teacher.name,
        previousTeacherId,
        session: String(schoolClass.session),
      },
    });

    const populated = await SchoolClass.findById(schoolClass._id).populate('classTeacher', TEACHER_PUBLIC_FIELDS);

    res.json({
      success: true,
      message: isChange ? 'Class teacher changed.' : 'Class teacher assigned.',
      schoolClass: populated,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * DELETE /api/classes/:id/teacher
 * Remove the class teacher. Returns 200 (not 404) when none was assigned —
 * the caller's intent ("this class should have no teacher") is already true.
 */
exports.removeClassTeacher = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const schoolClass = await SchoolClass.findOne({ _id: req.params.id, schoolId });
    if (!schoolClass) return res.status(404).json({ success: false, message: 'Class not found.' });

    if (!schoolClass.classTeacher) {
      return res.json({ success: true, message: 'No class teacher was assigned.', schoolClass });
    }

    const previousTeacherId = String(schoolClass.classTeacher);
    schoolClass.classTeacher = null;
    schoolClass.classTeacherAssignedAt = null;
    schoolClass.classTeacherAssignedBy = null;
    await schoolClass.save();

    await logEvent(req, 'schoolClass.classTeacherRemoved', {
      targetType: 'schoolClass',
      targetId: schoolClass._id,
      targetName: schoolClass.name,
      metadata: { previousTeacherId },
    });

    res.json({ success: true, message: 'Class teacher removed.', schoolClass });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ═════════════════════════ SECTIONS ═════════════════════════════════════════

exports.createSection = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { classId, name, capacity } = req.body;

    const schoolClass = await SchoolClass.findOne({ _id: classId, schoolId });
    if (!schoolClass) return res.status(404).json({ success: false, message: 'Class not found.' });

    const section = await Section.create({ schoolId, class: classId, name, capacity: capacity ?? null });

    await logEvent(req, 'section.created', {
      targetType: 'section', targetId: section._id, targetName: section.name,
      metadata: { classId, className: schoolClass.name },
    });

    res.status(201).json({ success: true, message: 'Section created.', section });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ success: false, message: 'This section already exists for the selected class.' });
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getSections = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { classId } = req.query;
    const filter = { schoolId };
    if (classId) filter.class = classId;

    const sections = await Section.find(filter).populate('class', 'name sortOrder').sort({ name: 1 });
    res.json({ success: true, total: sections.length, sections });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PATCH /api/sections/:id   { name?, capacity?, isActive? }
 *
 * A section's parent `class` is deliberately NOT editable. Moving a section
 * between classes would silently orphan every Student.section→class
 * relationship (Student stores class AND section independently), so the safe
 * operation is: create the new section, promote/transfer the students, delete
 * the old one. The promotion module already exists for exactly that.
 */
exports.updateSection = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { name, capacity, isActive } = req.body;

    const section = await Section.findOne({ _id: req.params.id, schoolId });
    if (!section) return res.status(404).json({ success: false, message: 'Section not found.' });

    const before = { name: section.name, capacity: section.capacity, isActive: section.isActive };

    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ success: false, message: 'Section name cannot be empty.' });
      section.name = String(name).trim();
    }
    if (capacity !== undefined) {
      if (capacity === null || capacity === '') {
        section.capacity = null;
      } else {
        const parsed = Number(capacity);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return res.status(400).json({ success: false, message: 'Capacity must be a non-negative number, or empty for unlimited.' });
        }
        // Refuse to set a capacity below the students already placed here —
        // that would render the section permanently "over capacity" with no
        // action the admin could take short of moving children out.
        const enrolled = await Student.countDocuments({ schoolId, section: section._id, status: 'active' });
        if (parsed > 0 && parsed < enrolled) {
          return res.status(400).json({
            success: false,
            message: `Capacity cannot be below the ${enrolled} student(s) currently enrolled in this section.`,
          });
        }
        section.capacity = parsed;
      }
    }
    if (isActive !== undefined) section.isActive = !!isActive;

    await section.save();

    await logEvent(req, 'section.updated', {
      targetType: 'section', targetId: section._id, targetName: section.name,
      metadata: { before, after: { name: section.name, capacity: section.capacity, isActive: section.isActive } },
    });

    const populated = await Section.findById(section._id).populate('class', 'name sortOrder');
    res.json({ success: true, message: 'Section updated.', section: populated });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ success: false, message: 'Another section with this name already exists for this class.' });
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/sections/:id/delete-impact
 *
 * Dry-run the delete. The UI calls this before opening the confirm dialog so
 * the admin sees exactly what blocks (and what merely survives) BEFORE they
 * commit. Same logic as deleteSection, minus the write — deliberately shared
 * via collectDeleteImpact() so the two can never drift.
 */
async function collectDeleteImpact(schoolId, sectionId) {
  // Optional models: attendance/fee/report modules may not exist in every
  // deployment (this codebase already uses safeRequire for exactly this).
  const safeRequire = (p) => { try { return require(p); } catch (_) { return null; } };
  const StudentAttendanceRecord = safeRequire('../models/StudentAttendanceRecord');
  const StudentInvoice = safeRequire('../models/StudentInvoice');
  const FeePayment = safeRequire('../models/FeePayment');
  const GeneratedReport = safeRequire('../models/GeneratedReport');

  const [
    activeStudents,
    anyStudents,
    feeStructures,
    attendanceSnapshots,
    invoiceSnapshots,
    paymentSnapshots,
    reportSnapshots,
  ] = await Promise.all([
    Student.countDocuments({ schoolId, section: sectionId, status: 'active' }),
    Student.countDocuments({ schoolId, section: sectionId }),
    FeeStructure.countDocuments({ schoolId, 'appliesTo.section': sectionId }),
    StudentAttendanceRecord ? StudentAttendanceRecord.countDocuments({ schoolId, sectionSnapshot: sectionId }) : 0,
    StudentInvoice ? StudentInvoice.countDocuments({ schoolId, sectionSnapshot: sectionId }) : 0,
    FeePayment ? FeePayment.countDocuments({ schoolId, sectionSnapshot: sectionId }) : 0,
    GeneratedReport ? GeneratedReport.countDocuments({ schoolId, sectionSnapshot: sectionId }) : 0,
  ]);

  // BLOCKERS — deleting would orphan a REQUIRED reference or point a live
  // fee structure at nothing.
  //
  //   Student.section is `required: true`. A student in this section cannot
  //   exist without it. We block on ANY student (not just active ones):
  //   an 'inactive'/'alumni' student document still carries the required ref.
  //
  //   FeeStructure.appliesTo.section drives bulk invoice generation. A
  //   structure pointing at a deleted section silently generates nothing.
  const blockers = [];
  if (anyStudents > 0) {
    blockers.push({
      type: 'students',
      count: anyStudents,
      activeCount: activeStudents,
      message: `${anyStudents} student record(s) are assigned to this section (${activeStudents} active). Move or transfer them first.`,
    });
  }
  if (feeStructures > 0) {
    blockers.push({
      type: 'feeStructures',
      count: feeStructures,
      message: `${feeStructures} fee structure(s) target this section. Re-scope or delete them first.`,
    });
  }

  // NON-BLOCKERS — historical denormalized copies. Their `sectionSnapshot`
  // field is nullable and exists precisely so history survives structural
  // change. They keep their own ObjectId; a populate simply resolves to null.
  // Nothing is cascaded or rewritten. This is why an old invoice still shows
  // its own totals after its section is gone.
  const historicalSnapshots = {
    attendanceRecords: attendanceSnapshots,
    invoices: invoiceSnapshots,
    payments: paymentSnapshots,
    reports: reportSnapshots,
  };
  const historicalTotal = Object.values(historicalSnapshots).reduce((a, b) => a + b, 0);

  return {
    canDelete: blockers.length === 0,
    blockers,
    historicalSnapshots,
    historicalSnapshotTotal: historicalTotal,
    // RFID carries NO section reference (RfidCard → Student → section), so it
    // is covered transitively by the students blocker above.
    rfidNote: 'RFID cards reference students, not sections; they are covered by the student check.',
  };
}

exports.getSectionDeleteImpact = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const section = await Section.findOne({ _id: req.params.id, schoolId }).populate('class', 'name');
    if (!section) return res.status(404).json({ success: false, message: 'Section not found.' });

    const impact = await collectDeleteImpact(schoolId, section._id);
    res.json({ success: true, section, ...impact });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * DELETE /api/sections/:id
 *
 * Hard-deletes the Section document ONLY when nothing depends on it.
 * Historical snapshots are left untouched by design (see collectDeleteImpact).
 * Returns 409 Conflict with a machine-readable `blockers` array so the client
 * can render exactly which dependency stands in the way.
 */
exports.deleteSection = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const section = await Section.findOne({ _id: req.params.id, schoolId });
    if (!section) return res.status(404).json({ success: false, message: 'Section not found.' });

    const impact = await collectDeleteImpact(schoolId, section._id);

    if (!impact.canDelete) {
      return res.status(409).json({
        success: false,
        message: 'This section cannot be deleted while other records depend on it.',
        blockers: impact.blockers,
        historicalSnapshots: impact.historicalSnapshots,
      });
    }

    await Section.deleteOne({ _id: section._id, schoolId });

    await logEvent(req, 'section.deleted', {
      targetType: 'section',
      targetId: section._id,
      targetName: section.name,
      metadata: {
        classId: String(section.class),
        historicalSnapshotsPreserved: impact.historicalSnapshotTotal,
      },
    });

    res.json({
      success: true,
      message: 'Section deleted.',
      historicalSnapshotsPreserved: impact.historicalSnapshotTotal,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Exported for reuse/testing.
exports._collectDeleteImpact = collectDeleteImpact;
exports.TEACHER_PUBLIC_FIELDS = TEACHER_PUBLIC_FIELDS;