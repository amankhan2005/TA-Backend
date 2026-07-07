const RfidCard = require('../models/RfidCard');
const Student = require('../models/Student');
const StudentAttendanceSettings = require('../models/StudentAttendanceSettings');
const StudentAttendanceRecord = require('../models/StudentAttendanceRecord');
const RfidScanLog = require('../models/RfidScanLog');
const School = require('../models/School');
const { resolveScanOutcome } = require('./attendanceStateMachine');
const { notifyStudentEvent } = require('./notificationService');

/**
 * scanService.js — THE single source of truth for RFID attendance processing.
 *
 * Both the production hardware endpoint (POST /api/student-attendance/scan,
 * device-authenticated) and the School-Admin test endpoint
 * (POST /api/rfid-devices/:id/test-scan) call processScan(). There is exactly
 * one attendance code path, one state machine, one set of DB writes and one
 * notification trigger — extracted here verbatim from the original
 * studentAttendanceController.ingestScan so behaviour is byte-for-byte
 * identical regardless of caller.
 *
 * The ONLY difference between callers is how `schoolId` is derived:
 *   - real scan: req.deviceSchoolId (from deviceAuth middleware)
 *   - test scan: req.user.schoolId (from protect('schoolAdmin')), plus the
 *     device is loaded and its schoolId asserted to match — so school
 *     isolation is preserved identically on both paths.
 */

// Derives the attendance "date" from the scan timestamp using the server's
// local calendar day (unchanged from the original controller).
function toSchoolDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * processScan — runs one RFID scan through the full attendance pipeline.
 *
 * @param {Object} p
 * @param {string} p.schoolId      tenant scope (device school or admin school)
 * @param {string} p.rfidNumber    the scanned card number
 * @param {Date}   p.scanTime      when the scan happened
 * @param {string|null} p.deviceLabel  label recorded on the scan log / attendance record
 * @returns {Promise<{ outcome:string, isLate?:boolean, student?:object, attendanceRecord?:object }>}
 */
async function processScan({ schoolId, rfidNumber, scanTime, deviceLabel = null }) {
  const card = await RfidCard.findOne({ schoolId, rfidNumber, status: 'active' });

  if (!card || !card.student) {
    await RfidScanLog.create({
      schoolId, rfidNumber, student: null, device: deviceLabel,
      scannedAt: scanTime, outcome: 'unknown_card', attendanceRecord: null,
    });
    return { outcome: 'unknown_card' };
  }

  const student = await Student.findById(card.student).populate('class', 'name').populate('section', 'name');
  if (!student || student.status !== 'active') {
    await RfidScanLog.create({
      schoolId, rfidNumber, student: card.student, device: deviceLabel,
      scannedAt: scanTime, outcome: 'unknown_card', attendanceRecord: null,
    });
    return { outcome: 'unknown_card' };
  }

  const settings = await StudentAttendanceSettings.findOne({ schoolId });
  const dateStr = toSchoolDateString(scanTime);
  const existingRecord = await StudentAttendanceRecord.findOne({ schoolId, studentIdRef: student.studentId, date: dateStr });

  const { outcome, recordPatch, isLate } = resolveScanOutcome({ existingRecord, settings, scanTime });

  let attendanceRecord = existingRecord;

  if (outcome === 'punch_in') {
    // Atomic upsert: only the FIRST concurrent request actually inserts.
    const upserted = await StudentAttendanceRecord.findOneAndUpdate(
      { schoolId, studentIdRef: student.studentId, date: dateStr },
      {
        $setOnInsert: {
          schoolId, student: student._id, studentIdRef: student.studentId, date: dateStr,
          punchInAt: recordPatch.punchInAt, punchInRfid: rfidNumber, punchInDevice: deviceLabel,
          isLate, status: 'punched_in', isLocked: false,
          classSnapshot: student.class?._id || student.class || null,
          sectionSnapshot: student.section?._id || student.section || null,
          sessionSnapshot: student.session || null,
        },
      },
      { new: true, upsert: true }
    );
    attendanceRecord = upserted;

    const won = upserted.punchInAt.getTime() === recordPatch.punchInAt.getTime();
    if (!won) {
      await RfidScanLog.create({
        schoolId, rfidNumber, student: student._id, device: deviceLabel,
        scannedAt: scanTime, outcome: 'ignored_duplicate', attendanceRecord: upserted._id,
      });
      return { outcome: 'ignored_duplicate', student, attendanceRecord: upserted };
    }

    await RfidScanLog.create({
      schoolId, rfidNumber, student: student._id, device: deviceLabel,
      scannedAt: scanTime, outcome: 'punch_in', attendanceRecord: upserted._id,
    });

    const school = await School.findOne({ schoolId });
    const notifyData = {
      schoolName: school?.name, schoolLogoUrl: school?.logoUrl,
      className: student.class?.name, sectionName: student.section?.name,
      date: dateStr, time: scanTime.toTimeString().slice(0, 5),
    };
    await notifyStudentEvent({ schoolId, studentId: student._id.toString(), type: 'attendance_punch_in', data: notifyData });
    if (isLate) {
      await notifyStudentEvent({ schoolId, studentId: student._id.toString(), type: 'attendance_late', data: notifyData });
    }

    return { outcome: 'punch_in', isLate, student, attendanceRecord: upserted };
  }

  if (outcome === 'punch_out') {
    // Atomic conditional update — see original controller comment.
    const updated = await StudentAttendanceRecord.findOneAndUpdate(
      { schoolId, studentIdRef: student.studentId, date: dateStr, isLocked: false },
      { $set: { punchOutAt: recordPatch.punchOutAt, punchOutRfid: rfidNumber, punchOutDevice: deviceLabel, status: 'punched_out', isLocked: true } },
      { new: true }
    );

    if (!updated) {
      await RfidScanLog.create({
        schoolId, rfidNumber, student: student._id, device: deviceLabel,
        scannedAt: scanTime, outcome: 'ignored_locked', attendanceRecord: existingRecord?._id || null,
      });
      return { outcome: 'ignored_locked', student, attendanceRecord: existingRecord };
    }

    await RfidScanLog.create({
      schoolId, rfidNumber, student: student._id, device: deviceLabel,
      scannedAt: scanTime, outcome: 'punch_out', attendanceRecord: updated._id,
    });

    const school = await School.findOne({ schoolId });
    await notifyStudentEvent({
      schoolId, studentId: student._id.toString(), type: 'attendance_punch_out',
      data: { schoolName: school?.name, schoolLogoUrl: school?.logoUrl, date: dateStr, time: scanTime.toTimeString().slice(0, 5) },
    });

    return { outcome: 'punch_out', student, attendanceRecord: updated };
  }

  // Ignored outcomes — log only, no state change, no notification.
  await RfidScanLog.create({
    schoolId, rfidNumber, student: student._id, device: deviceLabel,
    scannedAt: scanTime, outcome, attendanceRecord: attendanceRecord?._id || null,
  });

  return { outcome, student, attendanceRecord };
}

module.exports = { processScan, toSchoolDateString };
