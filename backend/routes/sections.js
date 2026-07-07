const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { requireActiveSchool } = require('../middleware/subscription');
const { createSection, getSections } = require('../controllers/academicController');

router.use(protect('schoolAdmin'), requireActiveSchool);

router.post('/', [
  body('classId').notEmpty(),
  body('name').notEmpty(),
  validate,
], createSection);

router.get('/', getSections);

module.exports = router;
