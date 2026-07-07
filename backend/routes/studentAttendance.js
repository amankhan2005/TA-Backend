const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { requireActiveSchool } = require('../middleware/subscription');
const { requireFeature } = require('../middleware/planFeature');
const { deviceAuth } = require('../middleware/deviceAuth');
const {
  getSettings, updateSettings, ingestScan, getDailyAttendance, getScanLogs,
} = require('../controllers/studentAttendanceController');
const {
  exportStudentAttendance, getAttendanceDefaulters,
} = require('../controllers/attendanceExportController');

// ── Hardware ingestion — device-authenticated, deliberately NOT behind the
//    schoolAdmin JWT middleware used by every other route in this file.
router.post('/scan', deviceAuth, requireFeature('rfidAttendance'), [
  body('rfidNumber').notEmpty(),
  validate,
], ingestScan);

// ── Everything below is schoolAdmin-authenticated ────────────────────────────
router.get('/settings', protect('schoolAdmin'), requireActiveSchool, requireFeature('rfidAttendance'), getSettings);

// GAP-1 fix — strict validation on the attendance-rules PATCH. Every field is
// OPTIONAL (partial updates are supported), but any field that IS present must
// be well-formed: "HH:MM" 24-hour clock for the two time fields, and sane
// integer bounds for the three minute fields. The cross-field invariant
// (duplicateScanWindowMinutes < minPunchOutDurationMinutes) is enforced in the
// controller, where the incoming patch is merged with the stored document.
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
router.patch(
  '/settings',
  protect('schoolAdmin'), requireActiveSchool, requireFeature('rfidAttendance'),
  [
    body('schoolStartTime').optional().matches(HHMM).withMessage('schoolStartTime must be "HH:MM" (24-hour).'),
    body('schoolEndTime').optional().matches(HHMM).withMessage('schoolEndTime must be "HH:MM" (24-hour).'),
    body('lateThresholdMinutes').optional().isInt({ min: 0, max: 1440 }).withMessage('lateThresholdMinutes must be an integer between 0 and 1440.'),
    body('minPunchOutDurationMinutes').optional().isInt({ min: 1, max: 1440 }).withMessage('minPunchOutDurationMinutes must be an integer between 1 and 1440.'),
    body('duplicateScanWindowMinutes').optional().isInt({ min: 1, max: 1440 }).withMessage('duplicateScanWindowMinutes must be an integer between 1 and 1440.'),
    validate,
  ],
  updateSettings
);
router.get('/daily', protect('schoolAdmin'), requireActiveSchool, requireFeature('rfidAttendance'), getDailyAttendance); // ?date=YYYY-MM-DD&page=&limit=
router.get('/scan-logs', protect('schoolAdmin'), requireActiveSchool, requireFeature('rfidAttendance'), getScanLogs); // ?outcome=&rfidNumber=&page=&limit=

// ── Exports & defaulters (additive; read-only; reuse the scan-free summary engine)
router.get('/export', protect('schoolAdmin'), requireActiveSchool, requireFeature('rfidAttendance'), exportStudentAttendance); // ?format=xlsx|csv&range=&date=&from=&to=&session=&class=&section=
router.get('/defaulters', protect('schoolAdmin'), requireActiveSchool, requireFeature('rfidAttendance'), getAttendanceDefaulters); // ?range=&threshold=&session=&class=&section=&format=&page=&limit=

module.exports = router;
