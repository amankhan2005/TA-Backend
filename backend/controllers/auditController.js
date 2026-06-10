const AuditLog = require('../models/AuditLog');

/**
 * Shared query builder — both Super Admin and School Admin use this,
 * but School Admin is automatically scoped to their schoolId.
 */
const buildFilter = (query, scopedSchoolId = null) => {
  const filter = {};

  // School scope
  if (scopedSchoolId) {
    filter.schoolId = scopedSchoolId; // School Admin: always locked to own school
  } else if (query.schoolId) {
    filter.schoolId = query.schoolId; // Super Admin: optional filter by school
  }

  // Action category filter
  if (query.action) filter.action = query.action;

  // Action namespace filter (e.g. "auth" matches all auth.* events)
  if (query.category) filter.action = { $regex: `^${query.category}\\.` };

  // Actor filter
  if (query.actorEmail) filter.actorEmail = { $regex: query.actorEmail, $options: 'i' };
  if (query.actorRole) filter.actorRole = query.actorRole;

  // Target filter
  if (query.targetId) filter.targetId = query.targetId;

  // Date range
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(query.from);
    if (query.to) {
      const to = new Date(query.to);
      to.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = to;
    }
  }

  // Status filter
  if (query.status) filter.status = query.status;

  return filter;
};

// ─── SUPER ADMIN: full system audit log ─────────────────────────────────────
exports.getSystemAuditLogs = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const filter = buildFilter(req.query);

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    res.json({ success: true, total, page: parseInt(page), pages: Math.ceil(total / limit), logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── SUPER ADMIN: single actor history ─────────────────────────────────────
exports.getActorHistory = async (req, res) => {
  try {
    const { actorId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const filter = { actorId };
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) { const to = new Date(req.query.to); to.setHours(23,59,59,999); filter.createdAt.$lte = to; }
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(parseInt(limit)).lean(),
      AuditLog.countDocuments(filter),
    ]);

    res.json({ success: true, actorId, total, page: parseInt(page), logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── SUPER ADMIN: school-scoped audit logs ──────────────────────────────────
exports.getSchoolAuditLogs = async (req, res) => {
  try {
    const { schoolId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const filter = buildFilter(req.query, schoolId);

    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(parseInt(limit)).lean(),
      AuditLog.countDocuments(filter),
    ]);

    res.json({ success: true, schoolId, total, page: parseInt(page), logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── SUPER ADMIN: audit log summary / stats ─────────────────────────────────
exports.getAuditSummary = async (req, res) => {
  try {
    const { from, to } = req.query;
    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) { const d = new Date(to); d.setHours(23,59,59,999); dateFilter.$lte = d; }

    const matchStage = Object.keys(dateFilter).length ? { $match: { createdAt: dateFilter } } : { $match: {} };

    const [byAction, byRole, failedLogins, recentSuspicious] = await Promise.all([
      // Events by action category (group by namespace prefix)
      AuditLog.aggregate([
        matchStage,
        { $group: { _id: '$action', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),

      // Events by actor role
      AuditLog.aggregate([
        matchStage,
        { $group: { _id: '$actorRole', count: { $sum: 1 } } },
      ]),

      // Failed login attempts
      AuditLog.countDocuments({
        action: 'auth.login.failed',
        ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
      }),

      // Most recent suspicious attendance
      AuditLog.find({ action: 'attendance.suspicious_flagged' })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ]);

    res.json({
      success: true,
      summary: { byAction, byRole, failedLogins, recentSuspicious },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── SCHOOL ADMIN: own school's audit logs (scoped) ─────────────────────────
exports.getMySchoolAuditLogs = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { page = 1, limit = 50, category } = req.query;

    // School Admin can only see their own school's logs
    // Exclude auth.login.failed for other schools (already scoped by schoolId)
    const filter = buildFilter({ ...req.query, category }, schoolId);

    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(parseInt(limit)).lean(),
      AuditLog.countDocuments(filter),
    ]);

    res.json({ success: true, total, page: parseInt(page), pages: Math.ceil(total / limit), logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── SCHOOL ADMIN: own activity (what they personally did) ──────────────────
exports.getMyActivity = async (req, res) => {
  try {
    const { userId, schoolId } = req.user;
    const { page = 1, limit = 30 } = req.query;

    const filter = { actorId: String(userId), schoolId };

    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(parseInt(limit)).lean(),
      AuditLog.countDocuments(filter),
    ]);

    res.json({ success: true, total, page: parseInt(page), logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── SCHOOL ADMIN: login history for their own account ──────────────────────
exports.getMyLoginHistory = async (req, res) => {
  try {
    const { userId } = req.user;

    const logs = await AuditLog.find({
      actorId: String(userId),
      action: { $in: ['auth.login.success', 'auth.login.failed'] },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json({ success: true, total: logs.length, logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
