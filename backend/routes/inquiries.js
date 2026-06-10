const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const { protect } = require('../middleware/auth');
const { validate: handleValidation } = require('../middleware/validate');
const {
  createInquiry, getInquiries, getInquiry, updateInquiry, deleteInquiry,
} = require('../controllers/inquiryController');

// ── Validation chains ────────────────────────────────────────────────────────
const validateCreate = [
  body('schoolName').trim().notEmpty().withMessage('School name is required.'),
  body('contactPerson').trim().notEmpty().withMessage('Contact person is required.'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required.'),
  body('phone').trim().notEmpty().withMessage('Phone number is required.'),
  body('country').trim().notEmpty().withMessage('Country is required.'),
  body('teacherCount').isInt({ min: 1, max: 100000 }).withMessage('Teacher count must be a positive number.'),
  body('message').optional().trim().isLength({ max: 2000 }).withMessage('Message too long (max 2000 chars).'),
  handleValidation,
];

const validateUpdate = [
  param('id').isMongoId().withMessage('Invalid inquiry ID.'),
  body('status').optional().isIn(['new','contacted','demo_scheduled','converted','closed'])
    .withMessage('Invalid status.'),
  body('notes').optional().trim().isLength({ max: 5000 }),
  handleValidation,
];

const validateId = [
  param('id').isMongoId().withMessage('Invalid inquiry ID.'),
  handleValidation,
];

// ── Routes ────────────────────────────────────────────────────────────────────
// Public: anyone can submit an inquiry (website form)
router.post('/', validateCreate, createInquiry);

// Super Admin only
router.get('/',      protect('superAdmin'), getInquiries);
router.get('/:id',   protect('superAdmin'), validateId, getInquiry);
router.patch('/:id/status', protect('superAdmin'), validateUpdate, updateInquiry);
router.delete('/:id', protect('superAdmin'), validateId, deleteInquiry);

module.exports = router;
