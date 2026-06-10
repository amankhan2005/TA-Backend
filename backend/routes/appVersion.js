const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const {
  getActiveVersion,
  getAllVersions,
  createVersion,
  updateVersion,
  activateVersion,
  deleteVersion,
} = require('../controllers/appVersionController');

// ── PUBLIC: mobile app calls this on every launch ────────────────────────────
// No rate limiting beyond the global 100/min — this is a lightweight GET.
router.get('/', getActiveVersion);

// ── SUPER ADMIN: version history ─────────────────────────────────────────────
router.get('/history', protect('superAdmin'), getAllVersions);

// ── SUPER ADMIN: create new version config ───────────────────────────────────
router.post('/', protect('superAdmin'), [
  body('latestVersion')
    .matches(/^\d+\.\d+\.\d+$/)
    .withMessage('latestVersion must be semver format (e.g. 1.2.0).'),
  body('minimumVersion')
    .matches(/^\d+\.\d+\.\d+$/)
    .withMessage('minimumVersion must be semver format (e.g. 1.1.0).'),
  body('updateType')
    .isIn(['optional', 'force'])
    .withMessage('updateType must be optional or force.'),
  body('title')
    .notEmpty()
    .withMessage('title is required.')
    .isLength({ max: 100 })
    .withMessage('title must be 100 characters or less.'),
  body('message')
    .notEmpty()
    .withMessage('message is required.')
    .isLength({ max: 500 })
    .withMessage('message must be 500 characters or less.'),
  body('androidUrl')
    .optional({ nullable: true, checkFalsy: true })
    .isURL()
    .withMessage('androidUrl must be a valid URL.'),
  body('iosUrl')
    .optional({ nullable: true, checkFalsy: true })
    .isURL()
    .withMessage('iosUrl must be a valid URL.'),
  validate,
], createVersion);

// ── SUPER ADMIN: update a version config ─────────────────────────────────────
router.put('/:id', protect('superAdmin'), [
  param('id').isMongoId().withMessage('Invalid version ID.'),
  body('latestVersion')
    .optional()
    .matches(/^\d+\.\d+\.\d+$/)
    .withMessage('latestVersion must be semver format.'),
  body('minimumVersion')
    .optional()
    .matches(/^\d+\.\d+\.\d+$/)
    .withMessage('minimumVersion must be semver format.'),
  body('updateType')
    .optional()
    .isIn(['optional', 'force'])
    .withMessage('updateType must be optional or force.'),
  body('title')
    .optional()
    .notEmpty()
    .withMessage('title cannot be empty.')
    .isLength({ max: 100 }),
  body('message')
    .optional()
    .notEmpty()
    .withMessage('message cannot be empty.')
    .isLength({ max: 500 }),
  body('androidUrl')
    .optional({ nullable: true, checkFalsy: true })
    .isURL()
    .withMessage('androidUrl must be a valid URL.'),
  body('iosUrl')
    .optional({ nullable: true, checkFalsy: true })
    .isURL()
    .withMessage('iosUrl must be a valid URL.'),
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean.'),
  validate,
], updateVersion);

// ── SUPER ADMIN: activate a specific record ───────────────────────────────────
router.patch('/:id/activate', protect('superAdmin'), [
  param('id').isMongoId().withMessage('Invalid version ID.'),
  validate,
], activateVersion);

// ── SUPER ADMIN: delete a non-active record ───────────────────────────────────
router.delete('/:id', protect('superAdmin'), [
  param('id').isMongoId().withMessage('Invalid version ID.'),
  validate,
], deleteVersion);

module.exports = router;
