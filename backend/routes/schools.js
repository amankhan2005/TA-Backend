const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { requireActiveSchool } = require('../middleware/subscription');
const { uploadLogo } = require('../config/cloudinary');
const {
  inviteSchool, validateInvite,
  getAnalytics, resendInvite, registerSchool, getAllSchools, getSchool,
  setSchoolStatus, updateSchoolPlan, updateSchoolLogo, getMySchool,
  getSystemStats, getSchoolAttendance,
} = require('../controllers/schoolController');
const { updateMySchoolDetails } = require('../controllers/teacherController');

// ── Super Admin routes ──────────────────────────────────────────────────────
router.post('/invite', protect('superAdmin'), [
  body('schoolName').notEmpty().withMessage('School name required.'),
  body('adminEmail').isEmail().withMessage('Valid admin email required.'),
  body('planId').notEmpty().withMessage('Subscription plan required.'),
  validate,
], inviteSchool);

router.get('/', protect('superAdmin'), getAllSchools);
router.get('/stats', protect('superAdmin'), getSystemStats);

// ── School Admin routes — MUST be before /:schoolId to avoid param clash ────
// Super Admin analytics
router.get('/analytics', protect('superAdmin'), getAnalytics);

router.get('/my-school', protect('schoolAdmin'), requireActiveSchool, getMySchool);
router.patch('/logo', protect('schoolAdmin'), requireActiveSchool, uploadLogo.single('logo'), updateSchoolLogo);
router.patch('/my-school', protect('schoolAdmin'), requireActiveSchool, updateMySchoolDetails);

// ── Public — validate invite token (before form display) ───────────────────
router.get('/validate-invite', validateInvite);

// ── Super Admin — school-specific routes ────────────────────────────────────
router.get('/:schoolId', protect('superAdmin'), getSchool);
router.post('/:schoolId/resend-invite', protect('superAdmin'), resendInvite);
router.get('/:schoolId/attendance', protect('superAdmin'), getSchoolAttendance);

router.patch('/:schoolId/status', protect('superAdmin'), [
  body('status').isIn(['active', 'inactive', 'suspended']).withMessage('Invalid status.'),
  validate,
], setSchoolStatus);

router.patch('/:schoolId/plan', protect('superAdmin'), [
  body('planId').notEmpty().withMessage('Plan ID required.'),
  validate,
], updateSchoolPlan);

// ── Public registration (school admin completes invite) ─────────────────────
router.post('/register', uploadLogo.single('logo'), [
  body('token').notEmpty().withMessage('Invite token required.'),
  body('schoolId').notEmpty().withMessage('School ID required.'),
  body('name').notEmpty().withMessage('Admin name required.'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
  body('city').notEmpty().withMessage('City required.'),
  body('state').notEmpty().withMessage('State required.'),
  body('phone').notEmpty().withMessage('Phone required.'),
  validate,
], registerSchool);

module.exports = router;
