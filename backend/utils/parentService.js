/**
 * parentService.js — Phase 9 read layer. Every function takes an already
 * OWNERSHIP-VALIDATED { schoolId, studentId } (from req.child) and composes data
 * from existing collections + reuses the Phase 4 attendance-summary engine, the
 * Phase 5 balance engine, and the Phase 8 identity service. It NEVER mutates
 * attendance/fee/rfid/report/promotion data — read-only by construction.
 */

const Student = require('../models/Student');
const StudentAttendanceRecord = require('../models/StudentAttendanceRecord');
const StudentInvoice = require('../models/StudentInvoice');
const FeePayment = require('../models/FeePayment');
const GeneratedReport = require('../models/GeneratedReport');
const FeeStatement = require('../models/FeeStatement');
const NotificationLog = require('../models/NotificationLog');
const StudentPromotionRecord = require('../models/StudentPromotionRecord');
const SchoolSettings = require('../models/SchoolSettings');
const RfidScanLog = require('../models/RfidScanLog');

const { computeAttendanceSummary } = require('./attendanceSummary');
const { computeStudentBalance } = require('./balanceEngine');
const { getIdentityProfile } = require('./identityService');
const { formatMinor } = require('./money');
const { toDateStr, dayBounds, monthBounds } = require('./analytics/time');

async function loadChild(schoolId, studentId) {
  return Student.findOne({ _id: studentId, schoolId })
    .populate('class', 'name').populate('section', 'name').populate('session', 'name');
}

function durationMinutes(rec) {
  if (rec.punchInAt && rec.punchOutAt) return Math.max(0, Math.round((new Date(rec.punchOutAt) - new Date(rec.punchInAt)) / 60000));
  return null;
}

async function feeBalance(schoolId, studentId) {
  const invoices = await StudentInvoice.find({ schoolId, student: studentId, status: { $ne: 'void' } })
    .select('currency totalPayableMinor paidMinor overpaidMinor status').lean();
  const { byCurrency } = computeStudentBalance(invoices.map((i) => ({ currency: i.currency, totalPayableMinor: i.totalPayableMinor, paidMinor: i.paidMinor, status: i.status })));
  for (const cur of Object.keys(byCurrency)) {
    const b = byCurrency[cur];
    b.outstandingDisplay = formatMinor(b.outstandingMinor, cur, { withCode: true });
    b.paidDisplay = formatMinor(b.paidMinor, cur, { withCode: true });
    b.advanceDisplay = formatMinor(b.advanceMinor, cur, { withCode: true });
  }
  return byCurrency;
}

async function attendanceAnalytics(schoolId, studentId, startStr, endStr) {
  const [records, settings] = await Promise.all([
    StudentAttendanceRecord.find({ schoolId, student: studentId, date: { $gte: startStr, $lte: endStr } }).lean(),
    SchoolSettings.findOne({ schoolId }),
  ]);
  return computeAttendanceSummary({
    records, periodStart: startStr, periodEnd: endStr,
    weeklyOffDays: settings?.weeklyOffDays || [], holidays: settings?.holidays || [],
  });
}

// ── Step 3: overview dashboard ───────────────────────────────────────────────
async function childOverview({ schoolId, studentId }) {
  const student = await loadChild(schoolId, studentId);
  if (!student) return null;
  const today = dayBounds().str;
  const month = monthBounds();
  const [identity, todayRec, monthSummary, balance, upcomingReports] = await Promise.all([
    getIdentityProfile({ schoolId, studentId }),
    StudentAttendanceRecord.findOne({ schoolId, student: studentId, date: today }).lean(),
    attendanceAnalytics(schoolId, studentId, month.startStr, month.endStr),
    feeBalance(schoolId, studentId),
    GeneratedReport.find({ schoolId, student: studentId, status: { $ne: 'failed' } }).sort({ generatedAt: -1 }).limit(3).select('periodLabel pdfUrl generatedAt'),
  ]);
  return {
    student: { name: student.name, studentId: student.studentId, photoUrl: student.photoUrl, class: student.class?.name, section: student.section?.name, session: student.session?.name },
    todayAttendance: todayRec ? { status: todayRec.status, punchInAt: todayRec.punchInAt, punchOutAt: todayRec.punchOutAt, isLate: todayRec.isLate } : { status: 'absent' },
    lastRfidScan: identity?.lastAttendanceScan || null,
    rfidStatus: identity?.rfid?.status || 'unassigned',
    attendancePercentageThisMonth: monthSummary.attendancePercentage,
    pendingFees: balance,
    upcomingReports,
  };
}

// ── Step 4: attendance history ───────────────────────────────────────────────
async function attendanceHistory({ schoolId, studentId, from, to }) {
  const records = await StudentAttendanceRecord.find({ schoolId, student: studentId, date: { $gte: from, $lte: to } }).sort({ date: -1 }).lean();
  return records.map((r) => ({ date: r.date, punchInAt: r.punchInAt, punchOutAt: r.punchOutAt, durationMinutes: durationMinutes(r), isLate: r.isLate, status: r.status }));
}

// ── Step 6: fees ─────────────────────────────────────────────────────────────
async function feesPortal({ schoolId, studentId }) {
  const [invoices, payments, balance] = await Promise.all([
    StudentInvoice.find({ schoolId, student: studentId }).sort({ dueDate: -1 }).lean(),
    FeePayment.find({ schoolId, student: studentId, status: 'recorded' }).sort({ paidAt: -1 }).lean(),
    feeBalance(schoolId, studentId),
  ]);
  const inv = invoices.map((i) => ({ invoiceNumber: i.invoiceNumber, dueDate: i.dueDate, status: i.status, currency: i.currency, totalDisplay: formatMinor(i.totalPayableMinor, i.currency, { withCode: true }), balanceDisplay: formatMinor(Math.max(0, i.totalPayableMinor - i.paidMinor), i.currency, { withCode: true }) }));
  const pay = payments.map((p) => ({ receiptNumber: p.receiptNumber, paidAt: p.paidAt, method: p.method, amountDisplay: formatMinor(p.amountMinor, p.currency, { withCode: true }) }));
  return { balance, invoices: inv, payments: pay };
}

// ── Step 7: reports ──────────────────────────────────────────────────────────
async function reportsPortal({ schoolId, studentId }) {
  const [reports, statements] = await Promise.all([
    GeneratedReport.find({ schoolId, student: studentId, status: { $ne: 'failed' } }).sort({ generatedAt: -1 }).limit(50).select('periodLabel pdfUrl generatedAt status'),
    FeeStatement.find({ schoolId, student: studentId }).sort({ generatedAt: -1 }).limit(50).select('periodLabel pdfUrl generatedAt'),
  ]);
  return { attendanceReports: reports, feeStatements: statements };
}

// ── Step 9: notifications ────────────────────────────────────────────────────
async function notificationsPortal({ schoolId, studentId }) {
  const logs = await NotificationLog.find({ schoolId, student: studentId }).sort({ createdAt: -1 }).limit(100)
    .select('type channel status createdAt');
  return logs.map((l) => ({ type: l.type, channel: l.channel, status: l.status, sentAt: l.createdAt }));
}

// ── Step 12: student summary + promotion history ─────────────────────────────
async function studentSummary({ schoolId, studentId }) {
  const student = await loadChild(schoolId, studentId);
  if (!student) return null;
  const history = await StudentPromotionRecord.find({ schoolId, student: studentId })
    .populate('previousClass', 'name').populate('newClass', 'name').populate('newSession', 'name')
    .sort({ promotedAt: -1 }).limit(20);
  return {
    currentClass: student.class?.name, currentSection: student.section?.name, currentSession: student.session?.name,
    promotionHistory: history.map((h) => ({ action: h.action, from: h.previousClass?.name, to: h.newClass?.name, session: h.newSession?.name, at: h.promotedAt })),
  };
}

module.exports = {
  childOverview, attendanceHistory, attendanceAnalytics, feesPortal, reportsPortal,
  notificationsPortal, studentSummary, feeBalance, loadChild,
};
