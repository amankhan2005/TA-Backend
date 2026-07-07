const StudentAttendanceRecord = require('../models/StudentAttendanceRecord');
const AttendanceRecord = require('../models/AttendanceRecord'); // teacher
const Student = require('../models/Student');
const SchoolSettings = require('../models/SchoolSettings');
const { resolveRange } = require('../utils/dateRange');
const { computeAttendanceSummary } = require('../utils/attendanceSummary');
const { sendTabular } = require('../utils/exportService');
const { getPagination, buildPaginatedResponse } = require('../utils/pagination');

// ── helpers ──────────────────────────────────────────────────────────────────
function hhmm(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
const idStr = (v) => (v && v._id ? String(v._id) : v ? String(v) : '');
const nameOf = (snapshot, current) => snapshot?.name || current?.name || '';

async function loadSchoolCalendar(schoolId) {
  const ss = await SchoolSettings.findOne({ schoolId });
  return { weeklyOffDays: ss?.weeklyOffDays || [], holidays: ss?.holidays || [] };
}

// Populate student + placement snapshots consistently for both export & defaulters.
function attendanceQuery(filter) {
  return StudentAttendanceRecord.find(filter)
    .populate('classSnapshot', 'name')
    .populate('sectionSnapshot', 'name')
    .populate('sessionSnapshot', 'name')
    .populate({
      path: 'student',
      select: 'name admissionNumber studentId class section session status',
      populate: [
        { path: 'class', select: 'name' },
        { path: 'section', select: 'name' },
        { path: 'session', select: 'name' },
      ],
    })
    .sort({ studentIdRef: 1, date: 1 });
}

// In-memory scope filter (snapshot first, student placement fallback).
function inScope(rec, { session, klass, section }) {
  const s = rec.student || {};
  const sess = idStr(rec.sessionSnapshot) || idStr(s.session);
  const cls = idStr(rec.classSnapshot) || idStr(s.class);
  const sec = idStr(rec.sectionSnapshot) || idStr(s.section);
  if (session && sess !== session) return false;
  if (klass && cls !== klass) return false;
  if (section && sec !== section) return false;
  return true;
}

// Group records by student and compute each student's attendance % over the range.
function summarizeByStudent(records, from, to, cal) {
  const byStudent = new Map();
  for (const r of records) {
    const key = r.studentIdRef;
    if (!byStudent.has(key)) byStudent.set(key, []);
    byStudent.get(key).push(r);
  }
  const pctByStudent = new Map();
  for (const [key, recs] of byStudent) {
    const summary = computeAttendanceSummary({
      records: recs, periodStart: from, periodEnd: to,
      weeklyOffDays: cal.weeklyOffDays, holidays: cal.holidays,
    });
    pctByStudent.set(key, summary);
  }
  return { byStudent, pctByStudent };
}

// ═══════════════════════ STUDENT ATTENDANCE EXPORT (item 6) ══════════════════
/**
 * GET /api/student-attendance/export
 *   ?format=xlsx|csv &range=daily|weekly|monthly|custom
 *   &date=YYYY-MM-DD (anchor for daily/weekly/monthly)
 *   &from=&to= (custom) &session=&class=&section=
 *
 * One row per recorded attendance day per student (the days the student was
 * actually present/late — absence detail lives in the Defaulters report). The
 * "Attendance %" column is each student's true % over the whole selected range,
 * computed by attendanceSummary (which excludes weekends/holidays), so it is
 * consistent across every row for that student.
 */
exports.exportStudentAttendance = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
    const { from, to, label } = resolveRange(req.query);
    const scope = { session: req.query.session, klass: req.query.class, section: req.query.section };
    const cal = await loadSchoolCalendar(schoolId);

    const raw = await attendanceQuery({ schoolId, date: { $gte: from, $lte: to } });
    const records = raw.filter((r) => inScope(r, scope));
    const { pctByStudent } = summarizeByStudent(records, from, to, cal);

    const rows = records.map((r) => {
      const s = r.student || {};
      const pct = pctByStudent.get(r.studentIdRef)?.attendancePercentage ?? '';
      return {
        studentName: s.name || r.studentIdRef,
        admissionNumber: s.admissionNumber || '',
        session: nameOf(r.sessionSnapshot, s.session),
        class: nameOf(r.classSnapshot, s.class),
        section: nameOf(r.sectionSnapshot, s.section),
        rfid: r.punchInRfid || '',
        date: r.date,
        punchIn: hhmm(r.punchInAt),
        punchOut: hhmm(r.punchOutAt),
        status: r.status || '',
        late: r.isLate ? 'Yes' : 'No',
        attendancePct: pct === '' ? '' : `${pct}%`,
      };
    });

    const columns = [
      { key: 'studentName', header: 'Student Name', width: 22 },
      { key: 'admissionNumber', header: 'Admission Number', width: 18 },
      { key: 'session', header: 'Session', width: 16 },
      { key: 'class', header: 'Class', width: 12 },
      { key: 'section', header: 'Section', width: 10 },
      { key: 'rfid', header: 'RFID', width: 16 },
      { key: 'date', header: 'Date', width: 12 },
      { key: 'punchIn', header: 'Punch In', width: 10 },
      { key: 'punchOut', header: 'Punch Out', width: 10 },
      { key: 'status', header: 'Status', width: 14 },
      { key: 'late', header: 'Late', width: 8 },
      { key: 'attendancePct', header: 'Attendance %', width: 12 },
    ];

    return sendTabular(res, format, {
      filename: `student-attendance_${from}_to_${to}`,
      sheetName: 'Student Attendance',
      title: `Student Attendance — ${label}`,
      columns, rows,
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// ═══════════════════════ ATTENDANCE DEFAULTERS (item 8) ══════════════════════
/**
 * GET /api/student-attendance/defaulters
 *   ?range=&date=&from=&to=&session=&class=&section=
 *   &threshold=75  (percentage; students strictly BELOW this are defaulters)
 *   &format=xlsx|csv (optional — omit for JSON list, provide for a download)
 *   &page=&limit=   (JSON mode only)
 *
 * Roster-aware: expands EVERY active student in scope, so a student with zero
 * scans in the period correctly shows 0% present (not simply "missing"). This
 * is the absence-focused counterpart to the attendance export.
 */
exports.getAttendanceDefaulters = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { from, to, label } = resolveRange(req.query);
    const threshold = Math.min(100, Math.max(0, Number(req.query.threshold ?? 75)));
    const scope = { session: req.query.session, klass: req.query.class, section: req.query.section };
    const cal = await loadSchoolCalendar(schoolId);

    // Roster in scope (active students).
    const studentFilter = { schoolId, status: 'active' };
    if (scope.session) studentFilter.session = scope.session;
    if (scope.klass) studentFilter.class = scope.klass;
    if (scope.section) studentFilter.section = scope.section;
    const students = await Student.find(studentFilter)
      .select('name admissionNumber studentId class section session')
      .populate('class', 'name').populate('section', 'name').populate('session', 'name');

    // All records in the window (scope filter applied via student membership).
    const studentIdRefs = students.map((s) => s.studentId);
    const records = await StudentAttendanceRecord.find({
      schoolId, date: { $gte: from, $lte: to }, studentIdRef: { $in: studentIdRefs },
    }).select('studentIdRef date punchInAt punchOutAt isLate');

    const recsByStudent = new Map();
    for (const r of records) {
      if (!recsByStudent.has(r.studentIdRef)) recsByStudent.set(r.studentIdRef, []);
      recsByStudent.get(r.studentIdRef).push(r);
    }

    const all = students.map((s) => {
      const summary = computeAttendanceSummary({
        records: recsByStudent.get(s.studentId) || [], periodStart: from, periodEnd: to,
        weeklyOffDays: cal.weeklyOffDays, holidays: cal.holidays,
      });
      return {
        studentId: s.studentId,
        studentName: s.name,
        admissionNumber: s.admissionNumber,
        class: s.class?.name || '',
        section: s.section?.name || '',
        session: s.session?.name || '',
        attendancePct: summary.attendancePercentage,
        present: summary.presentDays,
        absent: summary.absentDays,
        late: summary.lateDays,
        schoolDays: summary.schoolDays,
      };
    });

    // Defaulters = strictly below threshold, worst first.
    const defaulters = all
      .filter((r) => r.attendancePct < threshold)
      .sort((a, b) => a.attendancePct - b.attendancePct);

    // Export mode.
    if (req.query.format === 'xlsx' || req.query.format === 'csv') {
      const columns = [
        { key: 'studentName', header: 'Student', width: 22 },
        { key: 'admissionNumber', header: 'Admission Number', width: 18 },
        { key: 'class', header: 'Class', width: 12 },
        { key: 'section', header: 'Section', width: 10 },
        { key: 'attendancePctText', header: 'Attendance %', width: 12 },
        { key: 'present', header: 'Present', width: 10 },
        { key: 'absent', header: 'Absent', width: 10 },
        { key: 'late', header: 'Late', width: 8 },
      ];
      const rows = defaulters.map((r) => ({ ...r, attendancePctText: `${r.attendancePct}%` }));
      return sendTabular(res, req.query.format, {
        filename: `attendance-defaulters_${from}_to_${to}`,
        sheetName: 'Attendance Defaulters',
        title: `Attendance Defaulters (< ${threshold}%) — ${label}`,
        columns, rows,
      });
    }

    // JSON mode (paginated).
    const { page, limit, skip } = getPagination(req.query);
    const pageRows = defaulters.slice(skip, skip + limit);
    return res.json({
      ...buildPaginatedResponse(pageRows, defaulters.length, page, limit),
      meta: { from, to, threshold, label, scopeStudentCount: students.length },
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// ═══════════════════════ TEACHER ATTENDANCE EXPORT (item 7) ══════════════════
/**
 * GET /api/attendance/export  (teacher attendance)
 *   ?format=xlsx|csv &range=&date=&from=&to=
 *
 * NOTE on the schema (documented, not assumed): the teacher AttendanceRecord is
 * single-punch, present-only (one `markedAt` per teacher per day, status is
 * always 'present'), and the Teacher model has NO employeeId field and NO
 * late/punch-out concept. The export therefore emits the requested 7 columns,
 * populated from what the model actually stores:
 *   - Employee ID  → teacher.email (best available stable identifier)
 *   - Check In     → markedAt
 *   - Check Out    → '' (not tracked for teachers)
 *   - Late         → '' (no teacher late threshold exists)
 * See the Export Report for the recommended schema additions.
 */
exports.exportTeacherAttendance = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
    const { from, to, label } = resolveRange(req.query);

    const records = await AttendanceRecord.find({ schoolId, date: { $gte: from, $lte: to } })
      .populate('teacher', 'name email')
      .sort({ date: 1, markedAt: 1 });

    const rows = records.map((r) => ({
      teacherName: r.teacher?.name || r.teacherId || '',
      employeeId: r.teacher?.email || r.teacherId || '',
      date: r.date,
      checkIn: hhmm(r.markedAt),
      checkOut: '',
      status: r.status ? r.status.charAt(0).toUpperCase() + r.status.slice(1) : 'Present',
      late: '',
    }));

    const columns = [
      { key: 'teacherName', header: 'Teacher Name', width: 22 },
      { key: 'employeeId', header: 'Employee ID', width: 24 },
      { key: 'date', header: 'Date', width: 12 },
      { key: 'checkIn', header: 'Check In', width: 10 },
      { key: 'checkOut', header: 'Check Out', width: 10 },
      { key: 'status', header: 'Status', width: 12 },
      { key: 'late', header: 'Late', width: 8 },
    ];

    return sendTabular(res, format, {
      filename: `teacher-attendance_${from}_to_${to}`,
      sheetName: 'Teacher Attendance',
      title: `Teacher Attendance — ${label}`,
      columns, rows,
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};
