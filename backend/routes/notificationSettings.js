const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { requireActiveSchool } = require('../middleware/subscription');
const {
  getNotificationSettings, updateNotificationSettings, testNotification,
} = require('../controllers/notificationAdminController');

router.use(protect('schoolAdmin'), requireActiveSchool);

router.get('/', getNotificationSettings);
router.patch('/', updateNotificationSettings);

// Parent notification test tool — inline delivery, immediate per-channel verdict.
router.post('/test', [
  body('studentId').notEmpty().withMessage('studentId is required.'),
  body('event').isIn(['punch_in', 'punch_out', 'fee']).withMessage('event must be punch_in, punch_out or fee.'),
  validate,
], testNotification);

module.exports = router;
