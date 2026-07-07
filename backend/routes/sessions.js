const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { requireActiveSchool } = require('../middleware/subscription');
const {
  createSession, getSessions, activateSession,
} = require('../controllers/academicController');

router.use(protect('schoolAdmin'), requireActiveSchool);

router.post('/', [
  body('name').notEmpty(),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
  validate,
], createSession);

router.get('/', getSessions);
router.patch('/:id/activate', activateSession);

module.exports = router;
