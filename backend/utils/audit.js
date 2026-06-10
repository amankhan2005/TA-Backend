/**
 * audit.js — Fire-and-forget audit log writer.
 *
 * Usage inside any controller:
 *   const { logEvent } = require('../utils/audit');
 *   await logEvent(req, 'teacher.created', { targetType: 'teacher', targetId: teacher._id, targetName: teacher.name, metadata: { email: teacher.email } });
 *
 * Rules:
 *  - Never throws — a logging failure must NEVER break the main request.
 *  - Always extracts IP and User-Agent from the request object.
 *  - actorId / actorEmail / actorRole come from req.user (already set by protect middleware).
 *  - For public routes (registration), pass actorOverride explicitly.
 */

const AuditLog = require('../models/AuditLog');

/**
 * @param {import('express').Request} req
 * @param {string} action        — must match AuditLog enum
 * @param {object} opts
 * @param {string}  [opts.targetType]
 * @param {string}  [opts.targetId]
 * @param {string}  [opts.targetName]
 * @param {object}  [opts.metadata]
 * @param {'success'|'failed'} [opts.status]
 * @param {object}  [opts.actorOverride]  — use for public routes with no req.user
 */
const logEvent = async (req, action, opts = {}) => {
  try {
    const actor = opts.actorOverride || req.user || {};

    const ip =
      req.headers['x-forwarded-for']?.split(',')[0].trim() ||
      req.connection?.remoteAddress ||
      req.ip ||
      null;

    await AuditLog.create({
      actorId:    String(actor.userId || actor.id || 'system'),
      actorEmail: actor.email || 'system',
      actorRole:  actor.role  || 'system',
      schoolId:   actor.schoolId || opts.schoolId || null,
      action,
      targetType: opts.targetType || null,
      targetId:   opts.targetId   ? String(opts.targetId) : null,
      targetName: opts.targetName || null,
      status:     opts.status || 'success',
      metadata:   opts.metadata || {},
      ipAddress:  ip,
      userAgent:  req.headers['user-agent'] || null,
    });
  } catch (err) {
    // Log to console but never propagate — audit failure ≠ request failure
    console.error('[AuditLog] Write failed:', err.message);
  }
};

module.exports = { logEvent };
