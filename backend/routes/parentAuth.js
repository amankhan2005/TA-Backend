const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { protectParent } = require('../middleware/parentAuth');
const c = require('../controllers/parentAuthController');

// Dedicated, stricter limiter for parent credential endpoints (Step 11).
const parentAuthLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Too many attempts. Please try again later.' } });

// Public
router.post('/login', parentAuthLimiter, c.login);
router.post('/forgot-password', parentAuthLimiter, c.forgotPassword);
router.post('/reset-password', parentAuthLimiter, c.resetPassword);
router.post('/activate', parentAuthLimiter, c.activate);

// Authenticated
router.post('/logout', protectParent, c.logout);
router.get('/profile', protectParent, c.getProfile);
router.patch('/profile', protectParent, c.updateProfile);
router.post('/change-password', protectParent, c.changePassword);

module.exports = router;
