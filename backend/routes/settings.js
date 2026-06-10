const express = require('express');
const router  = express.Router();
const { body } = require('express-validator');
const { validate }          = require('../middleware/validate');
const { protect }           = require('../middleware/auth');
const { requireActiveSchool } = require('../middleware/subscription');
const {
  getSettings, updateWifiSettings, updateQrSettings, toggleAttendanceMode,
  updateWeeklyOffDays, addHoliday, updateHoliday, deleteHoliday, updateSupportContact,
} = require('../controllers/settingsController');

// GET — teachers can read (for support contact + attendance mode info)
router.get('/', protect('teacher', 'schoolAdmin'), requireActiveSchool, getSettings);

// All writes — schoolAdmin only (middleware stacks on top of GET)
router.use(protect('schoolAdmin'), requireActiveSchool);

router.patch('/wifi', [
  body('wifiSSID').notEmpty(),
  body('gatewayIp').notEmpty(),
  body('gpsLatitude').isFloat({ min:-90, max:90 }),
  body('gpsLongitude').isFloat({ min:-180, max:180 }),
  body('gpsRadius').isInt({ min:50, max:1000 }),
  validate,
], updateWifiSettings);

router.patch('/qr', [
  body('qrExpiryMinutes').isInt({ min:1, max:60 }),
  validate,
], updateQrSettings);

router.patch('/mode', [
  body('wifiAttendanceEnabled').isBoolean(),
  body('qrAttendanceEnabled').isBoolean(),
  validate,
], toggleAttendanceMode);

router.patch('/weekly-off', [body('weeklyOffDays').isArray(), validate], updateWeeklyOffDays);

router.post('/holidays',              [body('date').notEmpty(), body('name').notEmpty(), validate], addHoliday);
router.patch('/holidays/:holidayId',  updateHoliday);
router.delete('/holidays/:holidayId', deleteHoliday);

router.patch('/support', updateSupportContact);

module.exports = router;
