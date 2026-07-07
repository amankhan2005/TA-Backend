const express = require('express');
const router = express.Router();
const { protectParent, requireChild } = require('../middleware/parentAuth');
const p = require('../controllers/parentPortalController');
const leave = require('../controllers/leaveController');

// Every route requires a valid parent session.
router.use(protectParent);

// Multi-child (no student id)
router.get('/children', p.getChildren);

// Per-child — requireChild enforces ownership + derives school from the link.
router.get('/children/:studentId/dashboard', requireChild, p.getDashboard);
router.get('/children/:studentId/attendance', requireChild, p.getAttendance);
router.get('/children/:studentId/rfid', requireChild, p.getRfid);
router.get('/children/:studentId/fees', requireChild, p.getFees);
router.get('/children/:studentId/reports', requireChild, p.getReports);
router.get('/children/:studentId/reports/:reportId/download', requireChild, p.downloadReport);
router.get('/children/:studentId/notifications', requireChild, p.getNotifications);
router.get('/children/:studentId/summary', requireChild, p.getSummary);

// Leave (parent side)
router.post('/children/:studentId/leave', requireChild, leave.submit);
router.get('/children/:studentId/leave', requireChild, leave.listForChild);
router.post('/leave/:leaveId/cancel', leave.cancel);

module.exports = router;
