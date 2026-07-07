/**
 * identityController.js — Phase 8 RFID Identity Center (school-admin). Thin over
 * identityService. Additive: no attendance/promotion/fee code is touched.
 */

const identity = require('../utils/identityService');
const RfidCard = require('../models/RfidCard');
const RfidCardHistory = require('../models/RfidCardHistory');
const StudentIdentity = require('../models/StudentIdentity');
const Student = require('../models/Student');
const School = require('../models/School');
const { renderIdentitySheetPDF } = require('../utils/pdf');
const { uploadIdentityPdf } = require('../utils/reportStorage');
const { assertStorageAvailable, recordUpload } = require('../utils/storageService');
const { enqueueJob } = require('../utils/queue');
const { logEvent } = require('../utils/audit');

const bad = (res, m) => res.status(400).json({ success: false, message: m });
const nf = (res, m) => res.status(404).json({ success: false, message: m || 'Not found.' });
const oops = (res, e) => res.status(500).json({ success: false, message: e.message });

// ── Identity profile (Step 1) ────────────────────────────────────────────────
exports.getProfile = async (req, res) => {
  try {
    const profile = await identity.getIdentityProfile({ schoolId: req.user.schoolId, studentId: req.params.studentId });
    if (!profile) return nf(res, 'Student not found.');
    res.json({ success: true, profile });
  } catch (err) { return oops(res, err); }
};

exports.getHistory = async (req, res) => {
  try {
    const history = await RfidCardHistory.find({ schoolId: req.user.schoolId, student: req.params.studentId }).sort({ performedAt: -1 });
    res.json({ success: true, history });
  } catch (err) { return oops(res, err); }
};

// ── QR generation (Step 2) ───────────────────────────────────────────────────
exports.generateQr = async (req, res) => {
  try {
    const regenerate = !!req.body.regenerate;
    const out = await identity.generateQr({ schoolId: req.user.schoolId, studentId: req.params.studentId, issuedBy: req.user.userId, regenerate });
    await logEvent(req, regenerate ? 'qr.regenerated' : 'qr.generated', { targetType: 'Student', targetId: req.params.studentId, metadata: { qrVersion: out.qrVersion } });
    res.json({ success: true, ...out });
  } catch (err) { return err.code === 'NOT_FOUND' ? nf(res, err.message) : oops(res, err); }
};

exports.getQrImage = async (req, res) => {
  try {
    const out = await identity.generateQr({ schoolId: req.user.schoolId, studentId: req.params.studentId, issuedBy: req.user.userId });
    const png = await identity.qrPngBuffer(out.token);
    res.type('png').send(png);
  } catch (err) { return err.code === 'NOT_FOUND' ? nf(res, err.message) : oops(res, err); }
};

// ── Admin verification tools (Step 4) ────────────────────────────────────────
exports.verifyRfid = async (req, res) => {
  try {
    const out = await identity.verifyRfidUid({ schoolId: req.user.schoolId, rfidNumber: req.params.uid });
    if (!out.found) return nf(res, 'RFID UID not found in this school.');
    res.json({ success: true, ...out });
  } catch (err) { return oops(res, err); }
};

exports.verifyStudent = async (req, res) => {
  try {
    const out = await identity.verifyStudent({ schoolId: req.user.schoolId, studentId: req.params.studentId });
    if (!out.found) return nf(res, 'Student not found.');
    res.json({ success: true, ...out });
  } catch (err) { return oops(res, err); }
};

// ── Reissue management (Step 7) ──────────────────────────────────────────────
exports.markLost = async (req, res) => {
  try {
    const card = await identity.markCard({ schoolId: req.user.schoolId, cardId: req.params.cardId, status: 'lost', reason: req.body.reason, performedBy: req.user.userId });
    await logEvent(req, 'rfidCard.markedLost', { targetType: 'rfidCard', targetId: card._id, targetName: card.rfidNumber, metadata: { reason: req.body.reason } });
    res.json({ success: true, card });
  } catch (err) { return err.code === 'NOT_FOUND' ? nf(res, err.message) : oops(res, err); }
};

exports.markDamaged = async (req, res) => {
  try {
    const card = await identity.markCard({ schoolId: req.user.schoolId, cardId: req.params.cardId, status: 'damaged', reason: req.body.reason, performedBy: req.user.userId });
    await logEvent(req, 'rfidCard.markedDamaged', { targetType: 'rfidCard', targetId: card._id, targetName: card.rfidNumber, metadata: { reason: req.body.reason } });
    res.json({ success: true, card });
  } catch (err) { return err.code === 'NOT_FOUND' ? nf(res, err.message) : oops(res, err); }
};

exports.reissue = async (req, res) => {
  try {
    const { newRfidNumber, reason, retireStatus, cardType } = req.body;
    if (!newRfidNumber) return bad(res, 'newRfidNumber is required.');
    const out = await identity.reissueCard({ schoolId: req.user.schoolId, studentId: req.params.studentId, newRfidNumber, reason, retireStatus, cardType, performedBy: req.user.userId });
    await logEvent(req, 'rfidCard.reissued', { targetType: 'rfidCard', targetId: out.newCard._id, targetName: newRfidNumber, metadata: { oldUid: out.oldUid, reason } });
    res.status(201).json({ success: true, ...out });
  } catch (err) {
    if (err.code === 'NOT_FOUND') return nf(res, err.message);
    if (err.code === 'DUPLICATE') return bad(res, err.message);
    return oops(res, err);
  }
};

// ── Health monitoring (Step 8) ───────────────────────────────────────────────
exports.getHealth = async (req, res) => {
  try {
    const stats = await identity.healthStats({ schoolId: req.user.schoolId, inactiveDays: req.query.inactiveDays ? Number(req.query.inactiveDays) : 30 });
    res.json({ success: true, health: stats });
  } catch (err) { return oops(res, err); }
};

// ── Individual identity PDF (Step 6) ─────────────────────────────────────────
exports.getStudentSheet = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const student = await Student.findOne({ _id: req.params.studentId, schoolId }).populate('class', 'name').populate('section', 'name');
    if (!student) return nf(res, 'Student not found.');
    const [school, gen, card] = await Promise.all([
      School.findOne({ schoolId }).populate('subscriptionPlan'),
      identity.generateQr({ schoolId, studentId: student._id, issuedBy: req.user.userId }),
      RfidCard.findOne({ schoolId, student: student._id, status: 'active' }),
    ]);
    const qrBuffer = await identity.qrPngBuffer(gen.token);
    const buffer = await renderIdentitySheetPDF({
      school: { name: school?.name, logoUrl: school?.logoUrl }, title: 'Student Identity Sheet',
      cards: [{ student: { name: student.name, studentId: student.studentId, rollNumber: student.rollNumber, className: student.class?.name, sectionName: student.section?.name, photoUrl: student.photoUrl }, qrBuffer, rfidUid: card?.rfidNumber }],
    });
    const limitMB = school?.subscriptionPlan?.storageLimitMB ?? null;
    await assertStorageAvailable(schoolId, buffer.length, limitMB);
    const up = await uploadIdentityPdf(buffer, { schoolId, filename: `identity_${student.studentId}` });
    await recordUpload(schoolId, buffer.length, 'idCards');
    await StudentIdentity.updateOne({ schoolId, student: student._id }, { $set: { identityPdfUrl: up.url, identityPdfPublicId: up.publicId, identityPdfVersion: gen.qrVersion } });
    res.json({ success: true, sheetUrl: up.url });
  } catch (err) { return err.code === 'STORAGE_LIMIT' ? res.status(507).json({ success: false, message: err.message }) : oops(res, err); }
};

// ── Bulk identity operations (Step 5) — queued, non-blocking ─────────────────
exports.bulkQr = async (req, res) => {
  try {
    const { scope = 'school', classId, sectionId, studentIds, regenerate } = req.body;
    const job = await enqueueJob('identity.bulkQr', { schoolId: req.user.schoolId, scope, classId, sectionId, studentIds, regenerate: !!regenerate, requestedBy: req.user.userId }, { idempotencyKey: `bulkqr:${req.user.schoolId}:${Date.now()}` });
    res.status(202).json({ success: true, message: 'Bulk QR job queued.', jobId: job?.id || null });
  } catch (err) { return oops(res, err); }
};

exports.bulkPdf = async (req, res) => {
  try {
    const { scope = 'class', classId, sectionId, studentIds } = req.body;
    const job = await enqueueJob('identity.bulkPdf', { schoolId: req.user.schoolId, scope, classId, sectionId, studentIds, requestedBy: req.user.userId }, { idempotencyKey: `bulkpdf:${req.user.schoolId}:${Date.now()}` });
    res.status(202).json({ success: true, message: 'Bulk identity-PDF job queued.', jobId: job?.id || null });
  } catch (err) { return oops(res, err); }
};

exports.bulkExport = async (req, res) => {
  try {
    const { scope = 'school', classId, sectionId } = req.body;
    const job = await enqueueJob('identity.bulkExport', { schoolId: req.user.schoolId, scope, classId, sectionId, requestedBy: req.user.userId }, { idempotencyKey: `bulkexport:${req.user.schoolId}:${Date.now()}` });
    res.status(202).json({ success: true, message: 'Bulk identity export queued.', jobId: job?.id || null });
  } catch (err) { return oops(res, err); }
};
