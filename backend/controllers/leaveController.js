/**
 * leaveController.js — Phase 9 leave workflow. Parents submit/list/cancel leave
 * for their OWN children (ownership already enforced by requireChild); school
 * admins review (approve/reject). Leave never mutates attendance — it's an
 * informational request trail.
 */
const LeaveRequest = require('../models/LeaveRequest');
const Student = require('../models/Student');
const { logEvent } = require('../utils/audit');
const { getPagination, buildPaginatedResponse } = require('../utils/pagination');

const parentAudit = (req) => ({ user: { schoolId: req.child?.schoolId, userId: req.parent._id, email: req.parent.email || req.parent.mobileNumber }, ip: req.ip });

// ── Parent side ──────────────────────────────────────────────────────────────
exports.submit = async (req, res) => {
  try {
    const { schoolId, studentId } = req.child;
    const { type, startDate, endDate, reason, attachmentUrl } = req.body;
    if (!type || !startDate || !endDate || !reason) return res.status(400).json({ success: false, message: 'type, startDate, endDate and reason are required.' });
    if (endDate < startDate) return res.status(400).json({ success: false, message: 'endDate cannot be before startDate.' });
    const student = await Student.findOne({ _id: studentId, schoolId }).select('studentId');
    const leave = await LeaveRequest.create({
      schoolId, student: studentId, studentIdRef: student.studentId, parent: req.parent._id,
      type, startDate, endDate, reason, attachmentUrl: attachmentUrl || null, status: 'pending',
    });
    await logEvent(parentAudit(req), 'parent.leaveSubmitted', { targetType: 'LeaveRequest', targetId: leave._id, metadata: { type, startDate, endDate } });
    res.status(201).json({ success: true, leave });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.listForChild = async (req, res) => {
  try {
    const leaves = await LeaveRequest.find({ schoolId: req.child.schoolId, student: req.child.studentId, parent: req.parent._id }).sort({ submittedAt: -1 });
    res.json({ success: true, leaves });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.cancel = async (req, res) => {
  try {
    const leave = await LeaveRequest.findOne({ _id: req.params.leaveId, parent: req.parent._id });
    if (!leave) return res.status(404).json({ success: false, message: 'Leave request not found.' });
    if (leave.status !== 'pending') return res.status(400).json({ success: false, message: 'Only pending requests can be cancelled.' });
    leave.status = 'cancelled';
    await leave.save();
    res.json({ success: true, leave });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── School admin side ────────────────────────────────────────────────────────
exports.listForSchool = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { page, limit, skip } = getPagination(req.query);
    const filter = { schoolId };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.student) filter.student = req.query.student;

    // Resolve the ObjectId refs the parent-requests UI needs, so the client
    // never has to render bare IDs. Nested populate pulls class/section/session
    // names and the active RFID card in one round trip. Read-only + .lean() —
    // the request/approval workflow itself is unchanged.
    const [docs, total] = await Promise.all([
      LeaveRequest.find(filter)
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'student',
          select: 'name studentId admissionNumber photoUrl class section session activeRfidCard',
          populate: [
            { path: 'class', select: 'name' },
            { path: 'section', select: 'name' },
            { path: 'session', select: 'name' },
            { path: 'activeRfidCard', select: 'rfidNumber status' },
          ],
        })
        .populate({
          path: 'parent',
          select: 'name email mobileNumber isActive isActivated lastLoginAt linkedStudents',
        })
        .lean(),
      LeaveRequest.countDocuments(filter),
    ]);

    // Derive the parent↔this-child relationship (father/mother/guardian) from
    // the parent's linkedStudents, then strip that array from the wire payload
    // (it's only needed to compute `relation`).
    const items = docs.map((lr) => {
      const sid = lr.student && lr.student._id ? String(lr.student._id) : String(lr.student || '');
      const links = lr.parent && Array.isArray(lr.parent.linkedStudents) ? lr.parent.linkedStudents : [];
      const link = links.find((l) => String(l.student) === sid);
      const relation = link ? link.relation : null;
      if (lr.parent && lr.parent.linkedStudents) delete lr.parent.linkedStudents;
      return { ...lr, relation };
    });

    res.json(buildPaginatedResponse(items, total, page, limit));
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.review = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { decision, remarks } = req.body; // decision: 'approved' | 'rejected'
    if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ success: false, message: "decision must be 'approved' or 'rejected'." });
    const leave = await LeaveRequest.findOne({ _id: req.params.leaveId, schoolId });
    if (!leave) return res.status(404).json({ success: false, message: 'Leave request not found.' });
    if (leave.status !== 'pending') return res.status(400).json({ success: false, message: `Request is already ${leave.status}.` });
    leave.status = decision;
    leave.reviewedBy = req.user.userId;
    leave.reviewedAt = new Date();
    leave.remarks = remarks || null;
    await leave.save();
    await logEvent(req, decision === 'approved' ? 'leave.approved' : 'leave.rejected', { targetType: 'LeaveRequest', targetId: leave._id });
    res.json({ success: true, leave });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};