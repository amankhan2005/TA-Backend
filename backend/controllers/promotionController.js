/**
 * promotionController.js — Phase 7 HTTP layer for student promotion. Enforces the
 * preview → validate → execute lifecycle: a batch must be previewed before it can
 * execute, and only an executed batch can be rolled back. Thin — all integrity
 * logic lives in promotionService (transactional).
 */

const StudentPromotionBatch = require('../models/StudentPromotionBatch');
const StudentPromotionRecord = require('../models/StudentPromotionRecord');
const promotion = require('../utils/promotionService');
const { logEvent } = require('../utils/audit');
const { getPagination, buildPaginatedResponse } = require('../utils/pagination');

const bad = (res, m) => res.status(400).json({ success: false, message: m });
const oops = (res, e) => res.status(500).json({ success: false, message: e.message });

function executeAuditAction(mode) {
  if (mode === 'retention') return 'retention.applied';
  if (mode === 'transfer') return 'transfer.executed';
  return 'promotion.executed';
}

exports.createBatch = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const b = req.body;
    if (!b.mode) return bad(res, 'mode is required.');
    const batch = await StudentPromotionBatch.create({
      schoolId, mode: b.mode,
      sourceSession: b.sourceSession || null, sourceClass: b.sourceClass || null, sourceSection: b.sourceSection || null,
      destSession: b.destSession || null, destClass: b.destClass || null, destSection: b.destSection || null,
      selectedStudentIds: b.selectedStudentIds || [], retainedStudentIds: b.retainedStudentIds || [],
      retentionReason: b.retentionReason || {}, notify: !!b.notify,
      status: 'draft', createdBy: req.user.userId,
    });
    res.status(201).json({ success: true, batch });
  } catch (err) { return bad(res, err.message); }
};

exports.listBatches = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { page, limit, skip } = getPagination(req.query);
    const filter = { schoolId };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.mode) filter.mode = req.query.mode;
    const [items, total] = await Promise.all([
      StudentPromotionBatch.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      StudentPromotionBatch.countDocuments(filter),
    ]);
    res.json(buildPaginatedResponse(items, total, page, limit));
  } catch (err) { return oops(res, err); }
};

exports.getBatch = async (req, res) => {
  try {
    const batch = await StudentPromotionBatch.findOne({ _id: req.params.id, schoolId: req.user.schoolId });
    if (!batch) return res.status(404).json({ success: false, message: 'Promotion batch not found.' });
    res.json({ success: true, batch });
  } catch (err) { return oops(res, err); }
};

// Preview — NO writes to students; stores the snapshot on the batch.
exports.previewBatch = async (req, res) => {
  try {
    const batch = await StudentPromotionBatch.findOne({ _id: req.params.id, schoolId: req.user.schoolId });
    if (!batch) return res.status(404).json({ success: false, message: 'Promotion batch not found.' });
    if (['executed', 'rolled_back'].includes(batch.status)) return bad(res, `Cannot preview a ${batch.status} batch.`);

    const preview = await promotion.preview(batch);
    batch.previewSnapshot = preview;
    batch.totalStudents = preview.counts.total;
    batch.status = 'previewed';
    await batch.save();
    await logEvent(req, 'promotion.previewed', { targetType: 'StudentPromotionBatch', targetId: batch._id, metadata: { mode: batch.mode, counts: preview.counts } });
    res.json({ success: true, preview });
  } catch (err) { return bad(res, err.message); }
};

// Execute — transactional, all-or-nothing.
exports.executeBatch = async (req, res) => {
  try {
    const batch = await StudentPromotionBatch.findOne({ _id: req.params.id, schoolId: req.user.schoolId });
    if (!batch) return res.status(404).json({ success: false, message: 'Promotion batch not found.' });
    if (batch.status !== 'previewed') return bad(res, 'Batch must be previewed before execution.');

    const result = await promotion.execute(batch, req.user.userId);
    await logEvent(req, executeAuditAction(batch.mode), { targetType: 'StudentPromotionBatch', targetId: batch._id, metadata: { mode: batch.mode, ...result } });

    let notify = { queued: 0 };
    try { notify = await promotion.notifyPromoted(batch); } catch (e) { /* non-fatal */ }
    res.json({ success: true, result, notifications: notify, batch });
  } catch (err) {
    if (err.code === 'NO_TRANSACTIONS') return res.status(501).json({ success: false, message: err.message });
    if (err.code === 'BAD_DESTINATION' || err.code === 'INCOMPLETE_STUDENT') return bad(res, err.message);
    return oops(res, err);
  }
};

// Rollback — restore every moved student's previous placement (transactional).
exports.rollbackBatch = async (req, res) => {
  try {
    const batch = await StudentPromotionBatch.findOne({ _id: req.params.id, schoolId: req.user.schoolId });
    if (!batch) return res.status(404).json({ success: false, message: 'Promotion batch not found.' });
    if (batch.status !== 'executed') return bad(res, 'Only an executed batch can be rolled back.');

    const result = await promotion.rollback(batch, req.user.userId);
    await logEvent(req, 'promotion.rolledBack', { targetType: 'StudentPromotionBatch', targetId: batch._id, metadata: result });
    res.json({ success: true, result, batch });
  } catch (err) {
    if (err.code === 'NO_TRANSACTIONS') return res.status(501).json({ success: false, message: err.message });
    return oops(res, err);
  }
};

exports.cancelBatch = async (req, res) => {
  try {
    const batch = await StudentPromotionBatch.findOne({ _id: req.params.id, schoolId: req.user.schoolId });
    if (!batch) return res.status(404).json({ success: false, message: 'Promotion batch not found.' });
    if (!['draft', 'previewed'].includes(batch.status)) return bad(res, `Cannot cancel a ${batch.status} batch.`);
    batch.status = 'cancelled';
    await batch.save();
    res.json({ success: true, batch });
  } catch (err) { return oops(res, err); }
};

// Complete academic history for a student (Step 7).
exports.getStudentHistory = async (req, res) => {
  try {
    const records = await StudentPromotionRecord.find({ schoolId: req.user.schoolId, student: req.params.studentId })
      .populate('previousClass', 'name').populate('newClass', 'name')
      .populate('previousSection', 'name').populate('newSection', 'name')
      .populate('previousSession', 'name').populate('newSession', 'name')
      .sort({ promotedAt: -1 });
    res.json({ success: true, history: records });
  } catch (err) { return oops(res, err); }
};
