const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { requireActiveSchool } = require('../middleware/subscription');
const admin = require('../controllers/parentAdminController');
const leave = require('../controllers/leaveController');

// School-admin management of parent accounts + leave review.
const guard = [protect('schoolAdmin'), requireActiveSchool];

// ── Leave review (unchanged paths) ───────────────────────────────────────────
// Declared BEFORE the parametric '/:id' routes so '/leave' is never captured
// as an :id.
router.get('/leave', ...guard, leave.listForSchool);                 // ?status=&student=&page=&limit=
router.post('/leave/:leaveId/review', ...guard, leave.review);       // { decision, remarks }

// ── Parent accounts ──────────────────────────────────────────────────────────
router.get('/', ...guard, admin.listParents);                        // ?search=&status=&page=&limit=

router.post('/', ...guard, [
  body('mobileNumber').optional({ nullable: true }).isString(),
  body('email').optional({ nullable: true }).isEmail().withMessage('A valid email is required.'),
  validate,
], admin.createParent);                                              // { name, mobileNumber, email, address, children[]|studentId }

router.post('/link', ...guard, [
  body('parentId').notEmpty(),
  body('studentId').notEmpty(),
  validate,
], admin.linkChild);                                                // { parentId, studentId, relation }

router.get('/:id', ...guard, admin.getParent);

router.patch('/:id', ...guard, [
  body('email').optional({ nullable: true }).isEmail().withMessage('A valid email is required.'),
  validate,
], admin.updateParent);                                             // { name?, email?, mobileNumber?, address?, children[]? }

router.patch('/:id/status', ...guard, [
  body('status').isIn(['pending', 'active', 'suspended']).withMessage('status must be pending, active, or suspended.'),
  validate,
], admin.setParentStatus);                                          // { status, reason? }

router.post('/:id/resend-activation', ...guard, admin.resendActivation);

router.delete('/:id/children/:studentId', ...guard, admin.unlinkChild);

module.exports = router;