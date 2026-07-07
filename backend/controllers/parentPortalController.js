/**
 * parentPortalController.js — Phase 9 parent-facing read endpoints. Every
 * per-child handler runs AFTER requireChild, so req.child.{studentId, schoolId}
 * is already ownership-validated and the school comes from the link, not input.
 */

const svc = require('../utils/parentService');
const Student = require('../models/Student');
const GeneratedReport = require('../models/GeneratedReport');
const FeeStatement = require('../models/FeeStatement');
const { getIdentityProfile } = require('../utils/identityService');
const { monthBounds, dayBounds } = require('../utils/analytics/time');
const { logEvent } = require('../utils/audit');

const wrap = (fn) => async (req, res) => {
  try { const out = await fn(req); if (out === null) return res.status(404).json({ success: false, message: 'Not found.' }); res.json({ success: true, ...out }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
const ctx = (req) => ({ schoolId: req.child.schoolId, studentId: req.child.studentId });
const auditCtx = (req) => ({ user: { schoolId: req.child?.schoolId, userId: req.parent._id, email: req.parent.email || req.parent.mobileNumber }, ip: req.ip });

// Multi-child: list the parent's linked children (no student id needed).
exports.getChildren = async (req, res) => {
  try {
    const ids = (req.parent.linkedStudents || []).map((l) => l.student);
    const students = await Student.find({ _id: { $in: ids } }).populate('class', 'name').populate('section', 'name').select('name studentId photoUrl class section status schoolId');
    const children = students.map((s) => {
      const link = req.parent.linkedStudents.find((l) => String(l.student) === String(s._id));
      return { studentId: s._id, name: s.name, studentIdNumber: s.studentId, photoUrl: s.photoUrl, class: s.class?.name, section: s.section?.name, status: s.status, schoolId: s.schoolId, relation: link?.relation };
    });
    res.json({ success: true, children });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getDashboard = wrap((req) => svc.childOverview(ctx(req)));

exports.getAttendance = wrap(async (req) => {
  const month = monthBounds();
  const from = req.query.from || month.startStr;
  const to = req.query.to || dayBounds().str;
  const [history, analytics] = await Promise.all([
    svc.attendanceHistory({ ...ctx(req), from, to }),
    svc.attendanceAnalytics(req.child.schoolId, req.child.studentId, from, to),
  ]);
  return { range: { from, to }, history, analytics };
});

exports.getRfid = wrap(async (req) => ({ rfid: await getIdentityProfile(ctx(req)) }));
exports.getFees = wrap((req) => svc.feesPortal(ctx(req)));
exports.getReports = wrap((req) => svc.reportsPortal(ctx(req)));
exports.getNotifications = wrap(async (req) => ({ notifications: await svc.notificationsPortal(ctx(req)) }));
exports.getSummary = wrap((req) => svc.studentSummary(ctx(req)));

// Report download — confirm the artifact belongs to this child, then return URL.
exports.downloadReport = async (req, res) => {
  try {
    const { schoolId, studentId } = ctx(req);
    const { reportId } = req.params;
    let doc = await GeneratedReport.findOne({ _id: reportId, schoolId, student: studentId }).select('pdfUrl periodLabel');
    let kind = 'attendance_report';
    if (!doc) { doc = await FeeStatement.findOne({ _id: reportId, schoolId, student: studentId }).select('pdfUrl periodLabel'); kind = 'fee_statement'; }
    if (!doc || !doc.pdfUrl) return res.status(404).json({ success: false, message: 'Report not found for this child.' });
    await logEvent(auditCtx(req), 'parent.reportDownloaded', { targetType: 'Report', targetId: doc._id, metadata: { kind } });
    res.json({ success: true, url: doc.pdfUrl, label: doc.periodLabel, kind });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
