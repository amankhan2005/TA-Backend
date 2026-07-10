const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { requireActiveSchool } = require('../middleware/subscription');
const {
  createClass, createDefaultLiberiaGrades, getClasses, updateClass,
  assignClassTeacher, removeClassTeacher,
} = require('../controllers/academicController');

router.use(protect('schoolAdmin'), requireActiveSchool);

router.post('/', [
  body('name').notEmpty(),
  body('session').notEmpty(),
  validate,
], createClass);

// Optional bulk "quick setup" — Nursery through Grade 12
router.post('/quick-setup', [
  body('session').notEmpty(),
  validate,
], createDefaultLiberiaGrades);

router.get('/', getClasses);
router.patch('/:id', updateClass);

// ── Class Teacher (added) ────────────────────────────────────────────────────
// PUT assigns/changes; DELETE removes. Both are schoolAdmin-only (inherited
// from router.use above) and re-scope on schoolId inside the controller.
router.put('/:id/teacher', [
  body('teacherId').notEmpty().withMessage('teacherId is required.'),
  validate,
], assignClassTeacher);

router.delete('/:id/teacher', removeClassTeacher);

module.exports = router;