const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const c = require('../controllers/verificationController');

/**
 * Public, token-gated student verification (audit Fix 4).
 * Two layered limiters + abuse logging:
 *   • per-IP    — stops bulk scraping across many tokens / brute force.
 *   • per-token — stops a single leaked/printed QR from being hammered.
 * The signed token remains the credential; school scope + revocation are
 * enforced in the service. Burst protection via a short window + low max.
 */
const perIpLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many verification requests. Please slow down.' },
  handler: (req, res, next, options) => {
    console.warn(`[verify-abuse] per-IP limit hit from ${req.ip} on ${req.originalUrl}`);
    res.status(options.statusCode).json(options.message);
  },
});
const perTokenLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 60, standardHeaders: false, legacyHeaders: false,
  keyGenerator: (req) => `tok:${req.params.token || 'none'}`,
  message: { success: false, message: 'This code has been verified too many times recently.' },
  handler: (req, res, next, options) => {
    console.warn(`[verify-abuse] per-TOKEN limit hit from ${req.ip}`);
    res.status(options.statusCode).json(options.message);
  },
});

router.get('/student/:token', perIpLimiter, perTokenLimiter, c.verifyByToken);

module.exports = router;
