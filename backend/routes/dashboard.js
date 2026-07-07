const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { requireActiveSchool } = require('../middleware/subscription');
const c = require('../controllers/dashboardController');

// School Admin analytics. Available to any active school (not a paid add-on);
// tenant isolation is enforced by using req.user.schoolId everywhere.
const guard = [protect('schoolAdmin'), requireActiveSchool];

router.get('/summary', ...guard, c.getSummary);
router.get('/attendance', ...guard, c.getAttendance); // ?period=daily|weekly|monthly
router.get('/students', ...guard, c.getStudents);
router.get('/rfid', ...guard, c.getRfid);
router.get('/fees', ...guard, c.getFees);
router.get('/fees/recovery', ...guard, c.getFeeRecovery);
router.get('/notifications', ...guard, c.getNotifications); // ?from=&to=
router.get('/storage', ...guard, c.getStorage);
router.get('/promotions', ...guard, c.getPromotions);
router.get('/identity', ...guard, c.getIdentity);
router.get('/parents', ...guard, c.getParents);
router.get('/health', ...guard, c.getHealth);
router.get('/trends', ...guard, c.getTrend); // ?metric=attendance|fees|notifications|reports|students&granularity=daily|weekly|monthly|yearly&count=

module.exports = router;
