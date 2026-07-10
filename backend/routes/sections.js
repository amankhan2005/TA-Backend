const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { requireActiveSchool } = require('../middleware/subscription');
const {
  createSection, getSections, updateSection, deleteSection, getSectionDeleteImpact,
} = require('../controllers/academicController');

router.use(protect('schoolAdmin'), requireActiveSchool);

router.post('/', [
  body('classId').notEmpty(),
  body('name').notEmpty(),
  validate,
], createSection);

router.get('/', getSections);

// ── Section edit / delete (added) ────────────────────────────────────────────
// GET delete-impact is a read-only dry-run the UI calls before showing the
// confirm dialog, so an admin sees blockers BEFORE committing.
router.get('/:id/delete-impact', getSectionDeleteImpact);

router.patch('/:id', [
  body('name').optional().notEmpty().withMessage('Section name cannot be empty.'),
  body('capacity').optional({ nullable: true }),
  body('isActive').optional().isBoolean(),
  validate,
], updateSection);

router.delete('/:id', deleteSection);

module.exports = router;