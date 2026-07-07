/**
 * reportGenerator.js — Orchestrates producing attendance report PDFs and
 * queuing their delivery. Called from the background worker (scheduled runs)
 * and from reportController (ad-hoc "generate now"). Kept out of the worker
 * file itself so the same logic serves both entry points and the worker stays
 * a thin job-router.
 *
 * Per student it: pulls the period's attendance rows → computes the summary
 * (pure) → renders the PDF (pure-ish) → uploads it (reportStorage) → records a
 * GeneratedReport → enqueues a report_ready parent notification. One student
 * failing (bad photo, upload hiccup) is caught and recorded on that student's
 * GeneratedReport WITHOUT aborting the rest of the batch.
 */

const Student = require('../models/Student');
const School = require('../models/School');
const SchoolSettings = require('../models/SchoolSettings');
const StudentAttendanceRecord = require('../models/StudentAttendanceRecord');
const ReportSchedule = require('../models/ReportSchedule');
const GeneratedReport = require('../models/GeneratedReport');

const { computeReportPeriod } = require('./reportScheduling');
const { computeAttendanceSummary } = require('./attendanceSummary');
const { renderAttendanceReportPDF } = require('./pdf');
const { uploadReportPdf } = require('./reportStorage');
const { assertStorageAvailable, recordUpload } = require('./storageService');
const { notifyStudentEvent } = require('./notificationService');

/** Map a schedule's deliveryChannel override to an explicit channel pair, or null to use NotificationSettings. */
function resolveChannelOverride(deliveryChannel) {
  switch (deliveryChannel) {
    case 'email': return { email: true, whatsapp: false };
    case 'whatsapp': return { email: false, whatsapp: true };
    case 'both': return { email: true, whatsapp: true };
    case 'default':
    default: return null;
  }
}

function sanitizeFilename(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Generate one student's report for a period. Idempotent for scheduled runs:
 * if a GeneratedReport already exists for (schedule, student, period), it is
 * returned unchanged (a retry never double-generates or double-notifies).
 *
 * @returns {Promise<{ report: Object, created: boolean, deliveryQueued: boolean }>}
 */
async function generateOneStudentReport({ school, schoolSettings, student, period, schedule, storageLimitMB = null }) {
  if (schedule) {
    const existing = await GeneratedReport.findOne({
      schedule: schedule._id, student: student._id,
      periodStart: period.startStr, periodEnd: period.endStr,
    });
    if (existing) return { report: existing, created: false, deliveryQueued: false };
  }

  const records = await StudentAttendanceRecord.find({
    schoolId: school.schoolId,
    studentIdRef: student.studentId,
    date: { $gte: period.startStr, $lte: period.endStr },
  }).lean();

  const summary = computeAttendanceSummary({
    records,
    periodStart: period.startStr,
    periodEnd: period.endStr,
    weeklyOffDays: schoolSettings?.weeklyOffDays || [],
    holidays: schoolSettings?.holidays || [],
  });

  const summarySnapshot = {
    schoolDays: summary.schoolDays,
    presentDays: summary.presentDays,
    absentDays: summary.absentDays,
    lateDays: summary.lateDays,
    attendancePercentage: summary.attendancePercentage,
  };

  const baseDoc = {
    schoolId: school.schoolId,
    schedule: schedule?._id || null,
    student: student._id,
    studentIdRef: student.studentId,
    periodStart: period.startStr,
    periodEnd: period.endStr,
    periodLabel: period.label,
    summary: summarySnapshot,
    classSnapshot: student.class?._id || student.class || null,
    sectionSnapshot: student.section?._id || student.section || null,
    sessionSnapshot: student.session?._id || student.session || null,
  };

  let pdfBuffer;
  try {
    pdfBuffer = await renderAttendanceReportPDF({
      school: { name: school.name, logoUrl: school.logoUrl },
      student: {
        name: student.name,
        studentId: student.studentId,
        className: student.class?.name,
        sectionName: student.section?.name,
        sessionName: student.session?.name,
        photoUrl: student.photoUrl,
      },
      summary,
      period,
    });
  } catch (err) {
    const report = await GeneratedReport.create({ ...baseDoc, status: 'failed', error: `PDF render failed: ${err.message}` });
    return { report, created: true, deliveryQueued: false };
  }

  // Storage-limit enforcement (F-3) — check BEFORE spending an upload. A null
  // storageLimitMB means unlimited. Over-limit is recorded as a failed report
  // with a clear reason rather than silently dropping the run.
  try {
    await assertStorageAvailable(school.schoolId, pdfBuffer.length, storageLimitMB);
  } catch (err) {
    if (err.code === 'STORAGE_LIMIT') {
      const report = await GeneratedReport.create({ ...baseDoc, sizeBytes: pdfBuffer.length, status: 'failed', error: err.message });
      return { report, created: true, deliveryQueued: false };
    }
    throw err;
  }

  let pdfUrl = null;
  let pdfPublicId = null;
  try {
    const filename = sanitizeFilename(`attendance_${student.studentId}_${period.startStr}_${period.endStr}`);
    const up = await uploadReportPdf(pdfBuffer, { schoolId: school.schoolId, filename });
    pdfUrl = up.url;
    pdfPublicId = up.publicId;
  } catch (err) {
    const report = await GeneratedReport.create({ ...baseDoc, status: 'failed', error: `PDF upload failed: ${err.message}` });
    return { report, created: true, deliveryQueued: false };
  }

  // Record the bytes against the school's storage budget (atomic).
  await recordUpload(school.schoolId, pdfBuffer.length, 'attendanceReports');

  const report = await GeneratedReport.create({ ...baseDoc, pdfUrl, pdfPublicId, sizeBytes: pdfBuffer.length, status: 'generated' });

  // Enqueue the parent notification. Delivery status (sent/failed per channel)
  // is written back onto this GeneratedReport by the worker's notification
  // dispatch handler, keyed on relatedReportId. This enqueue is NON-FATAL
  // (F-6): if the queue is unreachable, the report is already saved and
  // downloadable — we return deliveryQueued:false rather than losing it.
  let deliveryQueued = false;
  try {
    await notifyStudentEvent({
      schoolId: school.schoolId,
      studentId: student._id.toString(),
      type: 'report_ready',
      data: {
        schoolName: school.name,
        schoolLogoUrl: school.logoUrl,
        studentName: student.name,
        reportLabel: 'Attendance Report',
        downloadUrl: pdfUrl,
      },
      relatedReportId: report._id.toString(),
      channelOverride: resolveChannelOverride(schedule?.deliveryChannel),
    });
    deliveryQueued = true;
  } catch (err) {
    console.error(`[reportGenerator] notification enqueue failed for ${student.studentId}:`, err.message);
  }

  return { report, created: true, deliveryQueued };
}

/** Load active students in a schedule's scope. Phase 4: scope is always 'all'. */
async function loadStudentsInScope(schoolId /* , schedule */) {
  return Student.find({ schoolId, status: 'active' })
    .populate('class', 'name')
    .populate('section', 'name')
    .populate('session', 'name');
}

/**
 * Generate reports for every in-scope student of ONE schedule, for the period
 * computed from runDate. Used by the worker's report.generateForSchool job.
 *
 * @returns {Promise<{ scheduleId, period, total, generated, skipped, failed }>}
 */
async function generateReportsForSchedule({ scheduleId, runDate }) {
  const schedule = await ReportSchedule.findById(scheduleId);
  if (!schedule) throw new Error(`generateReportsForSchedule: schedule ${scheduleId} not found`);
  if (!schedule.enabled) {
    return { scheduleId, period: null, total: 0, generated: 0, skipped: 0, failed: 0, note: 'schedule disabled' };
  }

  const [school, schoolSettings] = await Promise.all([
    School.findOne({ schoolId: schedule.schoolId }).populate('subscriptionPlan'),
    SchoolSettings.findOne({ schoolId: schedule.schoolId }),
  ]);
  if (!school) throw new Error(`generateReportsForSchedule: school ${schedule.schoolId} not found`);
  const storageLimitMB = school.subscriptionPlan?.storageLimitMB ?? null;

  const now = runDate ? new Date(runDate) : new Date();
  const period = computeReportPeriod(schedule, now);
  const students = await loadStudentsInScope(schedule.schoolId, schedule);

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const student of students) {
    try {
      const { report, created } = await generateOneStudentReport({ school, schoolSettings, student, period, schedule, storageLimitMB });
      if (!created) skipped += 1;
      else if (report.status === 'failed') failed += 1;
      else generated += 1;
    } catch (err) {
      failed += 1;
      console.error(`[reportGenerator] student ${student.studentId} failed:`, err.message);
    }
  }

  schedule.lastRunDate = period.endStr;
  schedule.lastRunAt = new Date();
  await schedule.save();

  return { scheduleId, period: period.label, total: students.length, generated, skipped, failed };
}

/**
 * Ad-hoc single-student report over an explicit date range (the "generate now"
 * / on-demand path from reportController). Not tied to a schedule, so it always
 * generates a fresh report.
 */
async function generateAdHocStudentReport({ schoolId, studentId, periodStart, periodEnd, periodLabel }) {
  const [school, schoolSettings, student] = await Promise.all([
    School.findOne({ schoolId }).populate('subscriptionPlan'),
    SchoolSettings.findOne({ schoolId }),
    Student.findOne({ _id: studentId, schoolId })
      .populate('class', 'name').populate('section', 'name').populate('session', 'name'),
  ]);
  if (!school) throw new Error('School not found.');
  if (!student) throw new Error('Student not found for this school.');
  const storageLimitMB = school.subscriptionPlan?.storageLimitMB ?? null;

  const period = {
    startStr: periodStart,
    endStr: periodEnd,
    label: periodLabel || `Custom — ${periodStart} to ${periodEnd}`,
  };

  const { report, deliveryQueued } = await generateOneStudentReport({ school, schoolSettings, student, period, schedule: null, storageLimitMB });
  return { report, deliveryQueued };
}

module.exports = {
  resolveChannelOverride,
  generateOneStudentReport,
  generateReportsForSchedule,
  generateAdHocStudentReport,
};
