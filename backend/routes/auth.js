const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const {
  superAdminLogin, schoolAdminLogin, teacherLogin,
  forgotPassword, resetPassword, changePassword,
} = require('../controllers/authController');

const passwordRules = body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.');
const newPasswordRules = body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters.');

// Super Admin login
router.post('/super-admin/login', [
  body('email').isEmail().withMessage('Valid email required.'),
  body('password').notEmpty().withMessage('Password required.'),
  validate,
], superAdminLogin);

// School Admin login
router.post('/school-admin/login', [
  body('email').isEmail().withMessage('Valid email required.'),
  body('password').notEmpty().withMessage('Password required.'),
  validate,
], schoolAdminLogin);

// Teacher login
router.post('/teacher/login', [
  body('email').isEmail().withMessage('Valid email required.'),
  body('password').notEmpty().withMessage('Password required.'),
  validate,
], teacherLogin);

// Forgot password (Super Admin & School Admin)
router.post('/forgot-password', [
  body('email').isEmail().withMessage('Valid email required.'),
  body('role').isIn(['superAdmin', 'schoolAdmin']).withMessage('Invalid role.'),
  validate,
], forgotPassword);

// Reset password via email token
router.post('/reset-password', [
  body('token').notEmpty().withMessage('Reset token required.'),
  body('role').isIn(['superAdmin', 'schoolAdmin']).withMessage('Invalid role.'),
  newPasswordRules,
  validate,
], resetPassword);

// Change password (in-session, all roles)
router.put('/change-password', protect('superAdmin', 'schoolAdmin', 'teacher'), [
  body('currentPassword').notEmpty().withMessage('Current password required.'),
  newPasswordRules,
  validate,
], changePassword);

module.exports = router;
