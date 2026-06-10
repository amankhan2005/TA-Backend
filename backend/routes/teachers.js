const express = require('express');
const router  = express.Router();
const { body }  = require('express-validator');
const { validate }           = require('../middleware/validate');
const { protect }            = require('../middleware/auth');
const { requireActiveSchool }= require('../middleware/subscription');
const { uploadProfilePhoto } = require('../config/cloudinary');
const {
  createTeacher, getTeachers, getTeacher,
  updateTeacher, resetTeacherPassword, deleteTeacher,
  resetTeacherDevice, getTeacherAnalytics,
  // New
  getMyProfile, uploadMyPhoto, requestDeletion,
  getDeletionRequests, resolveDeletionRequest, uploadTeacherPhoto,
  updateMySchoolDetails,
} = require('../controllers/teacherController');

// ── Teacher self-service (BEFORE the schoolAdmin middleware) ─────────────────
router.get ('/me',                   protect('teacher'), requireActiveSchool, getMyProfile);
router.patch('/me/photo',            protect('teacher'), requireActiveSchool, uploadProfilePhoto.single('photo'), uploadMyPhoto);
router.post ('/me/request-deletion', protect('teacher'), requireActiveSchool, [body('reason').optional().isString(), validate], requestDeletion);

// ── School Admin — all routes below require schoolAdmin ──────────────────────
router.use(protect('schoolAdmin'), requireActiveSchool);

router.post('/', [
  body('name').notEmpty(),
  body('email').isEmail(),
  body('password').isLength({ min:8 }),
  validate,
], createTeacher);

router.get('/', getTeachers);
router.get('/analytics/:year/:month', getTeacherAnalytics);
router.get('/deletion-requests',      getDeletionRequests);

router.patch('/:id/deletion-request', [
  body('action').isIn(['approve','reject']),
  validate,
], resolveDeletionRequest);

router.get   ('/:id',                getTeacher);
router.put   ('/:id',                [body('name').optional().notEmpty(), body('isActive').optional().isBoolean(), validate], updateTeacher);
router.patch ('/:id/reset-password', [body('newPassword').isLength({ min:8 }), validate], resetTeacherPassword);
router.patch ('/:id/reset-device',   resetTeacherDevice);
router.patch ('/:id/photo',          uploadProfilePhoto.single('photo'), uploadTeacherPhoto);
router.delete('/:id',                deleteTeacher);

module.exports = router;
