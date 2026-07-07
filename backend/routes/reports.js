const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { requireActiveSchool } = require('../middleware/subscription');
const { requireFeature } = require('../middleware/planFeature');
const {
  createSchedule, listSchedules, updateSchedule, toggleSchedule, deleteSchedule,
  listReports, getReport, generateNow, getStorageUsage,
} = require('../controllers/reportController');

// Attendance reports are meaningless without the attendance data they summarize,
// so they ride the same plan feature flag as RFID/student attendance. (A
// separate 'reports' flag can be split out later without changing these routes.)
const guard = [protect('schoolAdmin'), requireActiveSchool, requireFeature('rfidAttendance')];

// ── Schedules ────────────────────────────────────────────────────────────────
router.post('/schedules', ...guard, [
  body('frequency').isIn(['daily', 'weekly', 'monthly', 'custom']),
  validate,
], createSchedule);

router.get('/schedules', ...guard, listSchedules);
router.patch('/schedules/:id', ...guard, updateSchedule);
router.patch('/schedules/:id/toggle', ...guard, toggleSchedule);
router.delete('/schedules/:id', ...guard, deleteSchedule);

// ── Report history ───────────────────────────────────────────────────────────
router.get('/', ...guard, listReports); // ?student=&status=&scheduleId=&from=&to=&page=&limit=
router.get('/storage', ...guard, getStorageUsage); // MUST precede '/:id'
router.get('/:id', ...guard, getReport);

// ── Ad-hoc "generate now" ────────────────────────────────────────────────────
router.post('/generate', ...guard, [
  body('studentId').notEmpty(),
  body('periodStart').notEmpty(),
  body('periodEnd').notEmpty(),
  validate,
], generateNow);

module.exports = router;
