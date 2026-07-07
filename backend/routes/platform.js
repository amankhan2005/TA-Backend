const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const c = require('../controllers/platformController');

// Super Admin only — platform-wide analytics.
const guard = [protect('superAdmin')];

router.get('/summary', ...guard, c.getSummary);
router.get('/revenue', ...guard, c.getRevenue);
router.get('/subscriptions', ...guard, c.getSubscriptions);
router.get('/usage', ...guard, c.getUsage);
router.get('/rankings', ...guard, c.getRankings); // ?limit=
router.get('/storage', ...guard, c.getStorage);

module.exports = router;
