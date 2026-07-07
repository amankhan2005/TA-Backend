const AcademicSession = require('../models/AcademicSession');
const SchoolClass = require('../models/SchoolClass');
const Section = require('../models/Section');
const School = require('../models/School');
const { logEvent } = require('../utils/audit');

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

exports.getClasses = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { session } = req.query;
    const filter = { schoolId };
    if (session) filter.session = session;

    const classes = await SchoolClass.find(filter).sort({ sortOrder: 1 });
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
    res.json({ success: true, message: 'Class updated.', schoolClass });
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
