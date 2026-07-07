const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { requireActiveSchool } = require('../middleware/subscription');
const { requireFeature } = require('../middleware/planFeature');
const {
  assignRfid, unassignRfid, replaceRfid, disableRfid, reactivateRfid,
  getRfidCards, getRfidHistory,
} = require('../controllers/rfidController');

router.use(protect('schoolAdmin'), requireActiveSchool, requireFeature('rfidAttendance'));

router.post('/assign', [
  body('studentId').notEmpty(),
  body('rfidNumber').notEmpty(),
  validate,
], assignRfid);

router.post('/unassign', [body('studentId').notEmpty(), validate], unassignRfid);

router.post('/replace', [
  body('studentId').notEmpty(),
  body('newRfidNumber').notEmpty(),
  validate,
], replaceRfid);

router.post('/disable', [body('cardId').notEmpty(), validate], disableRfid);
router.post('/reactivate', [body('cardId').notEmpty(), validate], reactivateRfid);

router.get('/cards', getRfidCards); // ?status=active|unassigned|disabled|replaced
router.get('/cards/:cardId/history', getRfidHistory);

module.exports = router;
