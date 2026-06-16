const express = require('express');
const router  = express.Router();
const { body, param } = require('express-validator');
const { validate }          = require('../middleware/validate');
const { protect }           = require('../middleware/auth');
const { requireActiveSchool } = require('../middleware/subscription');
const { uploadSelfie } = require('../config/cloudinary');
const {
  markWifiAttendance, generateQRSession, getActiveQRSession, markQRAttendance,
  getTodayAttendance, getMyAttendance, getMonthlyReport, getDailyReport, getSuspiciousActivity,
} = require('../controllers/attendanceController');

// WiFi attendance — GPS is mandatory; SSID/BSSID enforced in controller (platform-aware).
router.post('/wifi', protect('teacher'), requireActiveSchool, [
  body('gpsLatitude').isFloat().withMessage('Valid GPS latitude required.'),
  body('gpsLongitude').isFloat().withMessage('Valid GPS longitude required.'),
  body('gpsAccuracy').optional({ nullable: true }).isFloat({ min: 0 }),
  validate,
], markWifiAttendance);

// QR attendance — multipart (selfie). The selfie is uploaded to Cloudinary by multer
// DURING body parsing, so we intentionally do NOT use the short-circuiting express-validator
// `validate` middleware here. All field/GPS validation happens inside markQRAttendance,
// which deletes the orphaned upload on any rejection. GPS is required for the
// range / anti-sharing check.
router.post('/qr', protect('teacher'), requireActiveSchool, uploadSelfie.single('selfie'), markQRAttendance);

router.get('/my-history', protect('teacher'), requireActiveSchool, getMyAttendance);

router.post('/qr-session',        protect('schoolAdmin'), requireActiveSchool, generateQRSession);
router.get('/qr-session/active',  protect('schoolAdmin'), requireActiveSchool, getActiveQRSession);
router.get('/today',              protect('schoolAdmin'), requireActiveSchool, getTodayAttendance);
router.get('/daily/:date',        protect('schoolAdmin'), requireActiveSchool, [param('date').matches(/^\d{4}-\d{2}-\d{2}$/), validate], getDailyReport);
router.get('/report/:year/:month',protect('schoolAdmin'), requireActiveSchool, getMonthlyReport);
router.get('/suspicious',         protect('superAdmin'),  getSuspiciousActivity);

module.exports = router;