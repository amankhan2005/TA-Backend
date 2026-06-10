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

// wifiSSID / gatewayIp intentionally NOT required — iOS cannot retrieve them
router.post('/wifi', protect('teacher'), requireActiveSchool, [
  body('gpsLatitude').isFloat().withMessage('Valid GPS latitude required.'),
  body('gpsLongitude').isFloat().withMessage('Valid GPS longitude required.'),
  validate,
], markWifiAttendance);

router.post('/qr', protect('teacher'), requireActiveSchool, uploadSelfie.single('selfie'), [
  body('qrToken').notEmpty().withMessage('QR token required.'),
  validate,
], markQRAttendance);

router.get('/my-history', protect('teacher'), requireActiveSchool, getMyAttendance);

router.post('/qr-session',        protect('schoolAdmin'), requireActiveSchool, generateQRSession);
router.get('/qr-session/active',  protect('schoolAdmin'), requireActiveSchool, getActiveQRSession);
router.get('/today',              protect('schoolAdmin'), requireActiveSchool, getTodayAttendance);
router.get('/daily/:date',        protect('schoolAdmin'), requireActiveSchool, [param('date').matches(/^\d{4}-\d{2}-\d{2}$/), validate], getDailyReport);
router.get('/report/:year/:month',protect('schoolAdmin'), requireActiveSchool, getMonthlyReport);
router.get('/suspicious',         protect('superAdmin'),  getSuspiciousActivity);

module.exports = router;
