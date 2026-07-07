const ApiDevice = require('../models/ApiDevice');
const School = require('../models/School');
const RfidScanLog = require('../models/RfidScanLog');
const { generateToken } = require('../utils/token');
const { logEvent } = require('../utils/audit');
const { processScan } = require('../utils/scanService');

// Scan outcomes that create/advance an attendance record vs. the ones that are
// logged-only. Used to build a friendly message for the admin test tool.
const OUTCOME_MESSAGE = {
  punch_in: 'Punch-in recorded.',
  punch_out: 'Punch-out recorded.',
  unknown_card: 'Unknown card — no active RFID card / student matched this number for this school.',
  ignored_duplicate: 'Duplicate scan ignored (a punch-in already exists for today).',
  ignored_locked: 'Ignored — attendance for today is already locked (punch-out done).',
  ignored_min_duration: 'Ignored — minimum time between punch-in and punch-out not yet reached.',
};

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Device registration — issues the credential that goes into a reader's
 * `X-Device-Key` header (see middleware/deviceAuth.js). Without this,
 * nothing could actually call POST /api/student-attendance/scan — this
 * closes that gap.
 *
 * The raw key is returned ONCE, at creation/rotation time, exactly like
 * this codebase's existing invite/reset tokens — it is never retrievable
 * again afterward, only rotatable.
 */

exports.registerDevice = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { label, deviceType } = req.body;

    const school = await School.findOne({ schoolId });
    if (!school) return res.status(404).json({ success: false, message: 'School not found.' });

    const { rawToken, hashedToken } = await generateToken();
    const device = await ApiDevice.create({
      schoolId, school: school._id,
      label, deviceType: deviceType || 'rfid_reader',
      apiKeyHash: hashedToken,
      keyPrefix: rawToken.slice(0, 8),
      createdBy: req.user.email,
    });

    await logEvent(req, 'apiDevice.registered', {
      targetType: 'apiDevice', targetId: device._id, targetName: label,
      metadata: { deviceType: device.deviceType },
    });

    // rawToken is shown exactly once — the caller must save it now.
    res.status(201).json({
      success: true,
      message: 'Device registered. Save this key now — it will not be shown again.',
      device: device.toSafeObject(),
      deviceKey: `${device._id}.${rawToken}`, // ready to paste into the reader's X-Device-Key config
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.rotateDeviceKey = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const device = await ApiDevice.findOne({ _id: req.params.id, schoolId });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found.' });

    const { rawToken, hashedToken } = await generateToken();
    device.apiKeyHash = hashedToken;
    device.keyPrefix = rawToken.slice(0, 8);
    await device.save();

    await logEvent(req, 'apiDevice.keyRotated', { targetType: 'apiDevice', targetId: device._id, targetName: device.label });

    res.json({
      success: true,
      message: 'Device key rotated. Update the reader with this new key — the old key stops working immediately.',
      deviceKey: `${device._id}.${rawToken}`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.revokeDevice = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const device = await ApiDevice.findOne({ _id: req.params.id, schoolId });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found.' });

    device.isActive = false;
    await device.save();

    await logEvent(req, 'apiDevice.revoked', { targetType: 'apiDevice', targetId: device._id, targetName: device.label });
    res.json({ success: true, message: 'Device revoked.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getDevices = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const devices = await ApiDevice.find({ schoolId }).select('-apiKeyHash').sort({ createdAt: -1 });

    // Attach a lightweight totalScans count per device (matched by label, which
    // is how RfidScanLog records the originating device). Kept as a small
    // aggregate so the list stays one round-trip.
    const labels = devices.map((d) => d.label);
    const counts = await RfidScanLog.aggregate([
      { $match: { schoolId, device: { $in: labels } } },
      { $group: { _id: '$device', total: { $sum: 1 } } },
    ]);
    const byLabel = Object.fromEntries(counts.map((c) => [c._id, c.total]));
    const enriched = devices.map((d) => ({ ...d.toObject(), totalScans: byLabel[d.label] || 0 }));

    res.json({ success: true, total: enriched.length, devices: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/rfid-devices/:id — reader detail + activity statistics.
 * School-scoped: a reader that belongs to another school returns 404, never
 * data. Stats are derived from RfidScanLog filtered by this school + this
 * device's label, so cross-school scans can never leak in.
 */
exports.getDevice = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const device = await ApiDevice.findOne({ _id: req.params.id, schoolId }).select('-apiKeyHash');
    if (!device) return res.status(404).json({ success: false, message: 'Device not found.' });

    const filter = { schoolId, device: device.label };
    const [
      totalScans, todayScans, lastSuccessful, lastFailed, lastAttendance, recent,
    ] = await Promise.all([
      RfidScanLog.countDocuments(filter),
      RfidScanLog.countDocuments({ ...filter, scannedAt: { $gte: startOfToday() } }),
      RfidScanLog.findOne({ ...filter, outcome: { $in: ['punch_in', 'punch_out'] } }).sort({ scannedAt: -1 }),
      RfidScanLog.findOne({ ...filter, outcome: { $in: ['unknown_card', 'ignored_duplicate', 'ignored_locked'] } }).sort({ scannedAt: -1 }),
      RfidScanLog.findOne({ ...filter, attendanceRecord: { $ne: null } }).sort({ scannedAt: -1 }),
      RfidScanLog.find(filter).populate('student', 'name studentId').sort({ scannedAt: -1 }).limit(15),
    ]);

    res.json({
      success: true,
      device,
      stats: {
        totalScans,
        todayScans,
        lastSuccessfulScanAt: lastSuccessful?.scannedAt || null,
        lastFailedScanAt: lastFailed?.scannedAt || null,
        lastAttendanceCreatedAt: lastAttendance?.scannedAt || null,
      },
      recentActivity: recent,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/rfid-devices/:id/activate — re-enable a disabled/revoked reader.
 * Mirror image of revoke; both toggle isActive on a school-scoped device.
 */
exports.activateDevice = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const device = await ApiDevice.findOne({ _id: req.params.id, schoolId });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found.' });

    device.isActive = true;
    await device.save();

    await logEvent(req, 'apiDevice.activated', { targetType: 'apiDevice', targetId: device._id, targetName: device.label });
    res.json({ success: true, message: 'Device activated.', device: device.toSafeObject() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/rfid-devices/:id/test-scan — School-Admin RFID test tool.
 *
 * SECURITY / ISOLATION:
 *  - Route is protected by protect('schoolAdmin') + requireActiveSchool +
 *    requireFeature('rfidAttendance') — same gates as every other admin route.
 *  - The device is loaded scoped to req.user.schoolId; a device from another
 *    school 404s. processScan is then called with THAT schoolId, so the test
 *    can only ever affect the admin's own school — identical isolation to the
 *    hardware path (which uses req.deviceSchoolId).
 *  - Environment-gated: disabled in production unless ALLOW_TEST_SCAN=true.
 *  - Uses the SAME utils/scanService.processScan as the real hardware endpoint.
 *    There is no duplicated attendance logic and no second state machine.
 *  - Does NOT update the reader's lastSeenAt — that field means "real hardware
 *    contact"; a simulated scan must not fake device liveness.
 */
exports.testScan = async (req, res) => {
  try {
    const testingAllowed = process.env.NODE_ENV !== 'production' || process.env.ALLOW_TEST_SCAN === 'true';
    if (!testingAllowed) {
      return res.status(403).json({
        success: false,
        message: 'RFID test scanning is disabled in this environment. Set ALLOW_TEST_SCAN=true to enable.',
      });
    }

    const { schoolId } = req.user;
    const { rfidNumber } = req.body;
    if (!rfidNumber) return res.status(400).json({ success: false, message: 'rfidNumber is required.' });

    const device = await ApiDevice.findOne({ _id: req.params.id, schoolId });
    if (!device) return res.status(404).json({ success: false, message: 'Device not found.' });

    const scanTime = new Date();
    const result = await processScan({
      schoolId,
      rfidNumber,
      scanTime,
      deviceLabel: device.label,
    });

    await logEvent(req, 'apiDevice.testScan', {
      targetType: 'apiDevice', targetId: device._id, targetName: device.label,
      metadata: { rfidNumber, outcome: result.outcome },
    });

    // Shape a rich, admin-friendly payload. student is populated (name + class/
    // section names) inside processScan for card-matched scans.
    const s = result.student;
    const rec = result.attendanceRecord;
    res.json({
      success: true,
      outcome: result.outcome,
      isLate: result.isLate ?? (rec?.isLate ?? null),
      message: OUTCOME_MESSAGE[result.outcome] || `Scan processed: ${result.outcome}.`,
      rfidNumber,
      student: s ? {
        id: s._id,
        studentId: s.studentId,
        name: s.name,
        className: s.class?.name || null,
        sectionName: s.section?.name || null,
      } : null,
      attendanceRecord: rec ? {
        id: rec._id,
        date: rec.date,
        status: rec.status,
        isLate: rec.isLate,
        punchInAt: rec.punchInAt || null,
        punchOutAt: rec.punchOutAt || null,
      } : null,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
