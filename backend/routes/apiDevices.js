const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { requireActiveSchool } = require('../middleware/subscription');
const { requireFeature } = require('../middleware/planFeature');
const {
  registerDevice, rotateDeviceKey, revokeDevice, getDevices,
  getDevice, activateDevice, testScan,
} = require('../controllers/apiDeviceController');

router.use(protect('schoolAdmin'), requireActiveSchool, requireFeature('rfidAttendance'));

router.post('/', [body('label').notEmpty(), validate], registerDevice);
router.get('/', getDevices);
router.get('/:id', getDevice);
router.post('/:id/rotate-key', rotateDeviceKey);
router.post('/:id/revoke', revokeDevice);
router.post('/:id/activate', activateDevice);

// School-Admin RFID testing tool. Reuses the SAME scan pipeline as the
// hardware endpoint (utils/scanService); env-gated; school-scoped.
router.post('/:id/test-scan', [body('rfidNumber').notEmpty(), validate], testScan);

module.exports = router;
