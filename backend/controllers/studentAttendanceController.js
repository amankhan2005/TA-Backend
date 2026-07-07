const RfidCard = require('../models/RfidCard');
const Student = require('../models/Student');
const StudentAttendanceSettings = require('../models/StudentAttendanceSettings');
const StudentAttendanceRecord = require('../models/StudentAttendanceRecord');
const RfidScanLog = require('../models/RfidScanLog');
const School = require('../models/School');
const { resolveScanOutcome } = require('../utils/attendanceStateMachine');
const { notifyStudentEvent } = require('../utils/notificationService');
const { logEvent } = require('../utils/audit');
const { getPagination, buildPaginatedResponse } = require('../utils/pagination');
const { processScan } = require('../utils/scanService');

// Known simplification, documented rather than silently assumed: this
// derives the attendance "date" from the scan timestamp using the server's
// local calendar day. Correct as long as the deployment's server timezone
// matches the school's timezone (true for a single-region Liberia
// deployment) — would need a per-school timezone field if that stops
// being true (e.g. schools spanning multiple timezones on one deployment).
function toSchoolDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ═══════════════════════ SETTINGS ═══════════════════════════════════════════

exports.getSettings = async (req, res) => {
  try {
    const { schoolId } = req.user;
    let settings = await StudentAttendanceSettings.findOne({ schoolId });
    if (!settings) settings = await StudentAttendanceSettings.create({ schoolId }); // defaults apply
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { schoolStartTime, schoolEndTime, minPunchOutDurationMinutes, duplicateScanWindowMinutes, lateThresholdMinutes } = req.body;

    // GAP-1 fix — cross-field invariant. The state machine evaluates the
    // duplicate window BEFORE the min-punch-out window (see
    // attendanceStateMachine.resolveScanOutcome), so if the duplicate window is
    // >= the min punch-out duration it would shadow the punch_out path entirely.
    // Merge the incoming partial patch with the stored document (or schema
    // defaults) and reject the combination if it would break that ordering.
    const current = (await StudentAttendanceSettings.findOne({ schoolId })) || new StudentAttendanceSettings({ schoolId });
    const effDuplicate = duplicateScanWindowMinutes !== undefined ? Number(duplicateScanWindowMinutes) : current.duplicateScanWindowMinutes;
    const effMinPunchOut = minPunchOutDurationMinutes !== undefined ? Number(minPunchOutDurationMinutes) : current.minPunchOutDurationMinutes;
    if (effDuplicate >= effMinPunchOut) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: [{
          field: 'duplicateScanWindowMinutes',
          message: `duplicateScanWindowMinutes (${effDuplicate}) must be less than minPunchOutDurationMinutes (${effMinPunchOut}), otherwise no scan could ever be recorded as a punch-out.`,
        }],
      });
    }

    const settings = await StudentAttendanceSettings.findOneAndUpdate(
      { schoolId },
      {
        $set: {
          ...(schoolStartTime !== undefined && { schoolStartTime }),
          ...(schoolEndTime !== undefined && { schoolEndTime }),
          // Coerce the numeric fields so a stringified "30" from the client is
          // stored (and schema-validated) as a real Number.
          ...(minPunchOutDurationMinutes !== undefined && { minPunchOutDurationMinutes: Number(minPunchOutDurationMinutes) }),
          ...(duplicateScanWindowMinutes !== undefined && { duplicateScanWindowMinutes: Number(duplicateScanWindowMinutes) }),
          ...(lateThresholdMinutes !== undefined && { lateThresholdMinutes: Number(lateThresholdMinutes) }),
        },
      },
      // runValidators enforces the schema min/max on update (previously skipped —
      // this is the core GAP-1 correctness fix); setDefaultsOnInsert keeps the
      // upsert path producing a fully-defaulted document.
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    await logEvent(req, 'studentAttendance.settings.updated', {
      targetType: 'studentAttendanceSettings', targetId: settings._id, metadata: req.body,
    });

    res.json({ success: true, message: 'Attendance settings updated.', settings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════ SCAN INGESTION (device-authenticated) ═════════════

/**
 * POST /api/rfid/scan — the hardware ingestion endpoint. Authenticated via
 * deviceAuth (middleware/deviceAuth.js), NOT a user JWT. Every single scan,
 * whatever the outcome, is written to RfidScanLog. Only punch_in/punch_out
 * outcomes touch StudentAttendanceRecord, and both use atomic,
 * race-safe Mongo operations (see inline comments) rather than a
 * find-then-write pattern, because real RFID hardware can genuinely
 * deliver two near-simultaneous reads (e.g. a momentary double-tap, or two
 * readers at the same gate) and a naive read-then-write is a real race,
 * not a theoretical one.
 */
exports.ingestScan = async (req, res) => {
  try {
    const schoolId = req.deviceSchoolId;
    const { rfidNumber } = req.body;
    const scanTime = req.body.scannedAt ? new Date(req.body.scannedAt) : new Date();
    if (!rfidNumber) return res.status(400).json({ success: false, message: 'rfidNumber is required.' });
    if (isNaN(scanTime.getTime())) return res.status(400).json({ success: false, message: 'Invalid scannedAt timestamp.' });

    // Single source of truth — the exact same pipeline the admin test endpoint
    // uses (utils/scanService.processScan). The device label is threaded through
    // from deviceAuth exactly as before.
    const result = await processScan({
      schoolId, rfidNumber, scanTime, deviceLabel: req.device?.label || null,
    });

    // Response shape is byte-for-byte identical to the pre-refactor endpoint so
    // existing ESP32 / reader firmware is unaffected: punch_in carries isLate,
    // every other outcome carries only { success, outcome }.
    const body = { success: true, outcome: result.outcome };
    if (result.outcome === 'punch_in') body.isLate = result.isLate;
    return res.json(body);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ═══════════════════════ READ ENDPOINTS ═════════════════════════════════════

exports.getDailyAttendance = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const date = req.query.date || toSchoolDateString(new Date());
    const { page, limit, skip } = getPagination(req.query);

    const filter = { schoolId, date };
    const [results, total] = await Promise.all([
      StudentAttendanceRecord.find(filter).populate('student', 'name studentId photoUrl class section').sort({ punchInAt: 1 }).skip(skip).limit(limit),
      StudentAttendanceRecord.countDocuments(filter),
    ]);

    res.json(buildPaginatedResponse(results, total, page, limit));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getScanLogs = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { outcome, rfidNumber } = req.query;
    const { page, limit, skip } = getPagination(req.query);

    const filter = { schoolId };
    if (outcome) filter.outcome = outcome;
    if (rfidNumber) filter.rfidNumber = rfidNumber;

    const [results, total] = await Promise.all([
      RfidScanLog.find(filter).populate('student', 'name studentId photoUrl').sort({ scannedAt: -1 }).skip(skip).limit(limit),
      RfidScanLog.countDocuments(filter),
    ]);

    res.json(buildPaginatedResponse(results, total, page, limit));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};