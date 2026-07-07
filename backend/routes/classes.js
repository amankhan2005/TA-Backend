const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { requireActiveSchool } = require('../middleware/subscription');
const {
  createClass, createDefaultLiberiaGrades, getClasses, updateClass,
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

module.exports = router;
