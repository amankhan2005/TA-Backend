const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { requireActiveSchool } = require('../middleware/subscription');
const {
  getSystemAuditLogs,
  getActorHistory,
  getSchoolAuditLogs,
  getAuditSummary,
  getMySchoolAuditLogs,
  getMyActivity,
  getMyLoginHistory,
} = require('../controllers/auditController');

// ── Super Admin routes ──────────────────────────────────────────────────────
// Full system log with all filters
router.get('/system', protect('superAdmin'), getSystemAuditLogs);

// Audit summary / analytics
router.get('/summary', protect('superAdmin'), getAuditSummary);

// History for a specific actor (by userId)
router.get('/actor/:actorId', protect('superAdmin'), getActorHistory);

// All audit logs scoped to a specific school
router.get('/school/:schoolId', protect('superAdmin'), getSchoolAuditLogs);

// ── School Admin routes ─────────────────────────────────────────────────────
// School Admin sees only their own school's logs
router.get('/my-school', protect('schoolAdmin'), requireActiveSchool, getMySchoolAuditLogs);

// What this admin personally did
router.get('/my-activity', protect('schoolAdmin'), requireActiveSchool, getMyActivity);

// This admin's own login history
router.get('/my-logins', protect('schoolAdmin'), requireActiveSchool, getMyLoginHistory);

module.exports = router;
