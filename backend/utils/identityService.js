/**
 * identityService.js — Phase 8 RFID Identity & Verification core. Additive and
 * read-mostly: it composes existing records (Student, RfidCard, RfidScanLog,
 * StudentAttendanceRecord) and manages QR identity state. It NEVER modifies
 * attendance, promotion, or fee logic. RFID lifecycle changes here only flip a
 * card's status + append history — the attendance scan path (which requires
 * status:'active') automatically ignores lost/damaged/disabled cards.
 */

const Student = require('../models/Student');
const RfidCard = require('../models/RfidCard');
const RfidCardHistory = require('../models/RfidCardHistory');
const RfidScanLog = require('../models/RfidScanLog');
const StudentAttendanceRecord = require('../models/StudentAttendanceRecord');
const StudentIdentity = require('../models/StudentIdentity');
const qr = require('./qrIdentity');

function parentOf(s) {
  return { name: s.fatherName || s.guardianName || s.motherName || null, mobile: s.mobileNumber || s.whatsappNumber || null };
}

async function ensureIdentity(schoolId, studentId, issuedBy = null) {
  return StudentIdentity.findOneAndUpdate(
    { schoolId, student: studentId },
    { $setOnInsert: { schoolId, student: studentId, qrVersion: 1, qrGeneratedAt: new Date(), qrIssuedBy: issuedBy } },
    { upsert: true, new: true }
  );
}

function tokenFor(schoolId, studentId, identity) {
  return qr.generateToken({ studentId: String(studentId), schoolId: String(schoolId), version: identity.qrVersion });
}

async function qrPngBuffer(token) {
  const QRCode = require('qrcode');
  return QRCode.toBuffer(token, { type: 'png', errorCorrectionLevel: 'M', margin: 1, width: 320 });
}

// ── Identity profile (Step 1) ────────────────────────────────────────────────
async function getIdentityProfile({ schoolId, studentId }) {
  const student = await Student.findOne({ _id: studentId, schoolId })
    .populate('class', 'name').populate('section', 'name').populate('session', 'name');
  if (!student) return null;

  const [card, identity, lastScan, lastRecord] = await Promise.all([
    RfidCard.findOne({ schoolId, student: student._id, status: 'active' }),
    ensureIdentity(schoolId, student._id),
    RfidScanLog.findOne({ schoolId, student: student._id }).sort({ scannedAt: -1 }),
    StudentAttendanceRecord.findOne({ schoolId, student: student._id }).sort({ punchInAt: -1 }),
  ]);
  const parent = parentOf(student);

  return {
    student: {
      photoUrl: student.photoUrl, name: student.name, studentId: student.studentId, rollNumber: student.rollNumber,
      class: student.class?.name || null, section: student.section?.name || null, session: student.session?.name || null,
      parentName: parent.name, parentMobile: parent.mobile, status: student.status,
    },
    rfid: card ? { uid: card.rfidNumber, status: card.status, cardType: card.cardType, assignedAt: card.assignedAt || card.createdAt } : { uid: null, status: 'unassigned' },
    identity: { qrVersion: identity.qrVersion, qrGeneratedAt: identity.qrGeneratedAt, verificationCount: identity.verificationCount, lastVerifiedAt: identity.lastVerifiedAt },
    lastAttendanceScan: lastScan ? { at: lastScan.scannedAt, outcome: lastScan.outcome } : null,
    lastPunchIn: lastRecord?.punchInAt || null,
    lastPunchOut: lastRecord?.punchOutAt || null,
  };
}

// ── QR generation / regeneration (Step 2) ────────────────────────────────────
async function generateQr({ schoolId, studentId, issuedBy, regenerate = false }) {
  const student = await Student.findOne({ _id: studentId, schoolId });
  if (!student) throw Object.assign(new Error('Student not found.'), { code: 'NOT_FOUND' });
  let identity = await ensureIdentity(schoolId, student._id, issuedBy);
  if (regenerate) {
    identity.qrVersion += 1;
    identity.qrGeneratedAt = new Date();
    identity.qrIssuedBy = issuedBy;
    identity.identityPdfUrl = null; // invalidate cached sheet — QR changed
    await identity.save();
  }
  const token = tokenFor(schoolId, student._id, identity);
  return { token, qrVersion: identity.qrVersion, studentId: student.studentId };
}

// ── Token verification (Step 3) — school-scoped, non-sensitive output ─────────
async function verifyByToken(token) {
  const res = qr.verifyToken(token);
  if (!res.valid) return { valid: false, reason: res.reason };
  const { sid, sc, v } = res.payload;

  const identity = await StudentIdentity.findOne({ schoolId: sc, student: sid });
  // Version check = revocation. A regenerated QR bumps qrVersion, so old tokens fail here.
  if (!identity || identity.qrVersion !== v) return { valid: false, reason: 'revoked_or_unknown' };

  const student = await Student.findOne({ _id: sid, schoolId: sc })
    .populate('class', 'name').populate('section', 'name').populate('session', 'name');
  if (!student) return { valid: false, reason: 'not_found' };

  const card = await RfidCard.findOne({ schoolId: sc, student: student._id, status: 'active' });

  identity.verificationCount += 1;
  identity.lastVerifiedAt = new Date();
  await identity.save();

  // Only non-sensitive verification fields are returned.
  return {
    valid: true,
    schoolId: sc,
    student: {
      photoUrl: student.photoUrl, name: student.name, studentId: student.studentId, rollNumber: student.rollNumber,
      currentClass: student.class?.name || null, currentSection: student.section?.name || null, currentSession: student.session?.name || null,
      status: student.status, // active / inactive — reflects promotions/transfers via current fields
    },
    rfidStatus: card ? card.status : 'unassigned',
  };
}

// ── Admin verification tools (Step 4) ────────────────────────────────────────
async function verifyRfidUid({ schoolId, rfidNumber }) {
  const card = await RfidCard.findOne({ schoolId, rfidNumber });
  if (!card) return { found: false };
  const [student, lastScan, lastRecord, history] = await Promise.all([
    card.student ? Student.findOne({ _id: card.student, schoolId }).select('name studentId rollNumber') : null,
    RfidScanLog.findOne({ schoolId, rfidNumber }).sort({ scannedAt: -1 }),
    card.student ? StudentAttendanceRecord.findOne({ schoolId, student: card.student }).sort({ punchInAt: -1 }) : null,
    RfidCardHistory.find({ schoolId, card: card._id }).sort({ performedAt: -1 }).limit(50),
  ]);
  return {
    found: true,
    rfid: { uid: card.rfidNumber, status: card.status, cardType: card.cardType },
    student: student ? { name: student.name, studentId: student.studentId, rollNumber: student.rollNumber } : null,
    lastScan: lastScan ? { at: lastScan.scannedAt, outcome: lastScan.outcome } : null,
    lastAttendance: lastRecord ? { punchInAt: lastRecord.punchInAt, punchOutAt: lastRecord.punchOutAt } : null,
    assignmentHistory: history,
  };
}

async function verifyStudent({ schoolId, studentId }) {
  const student = await Student.findOne({ _id: studentId, schoolId }).select('name studentId status');
  if (!student) return { found: false };
  const [card, identity] = await Promise.all([
    RfidCard.findOne({ schoolId, student: student._id, status: 'active' }),
    StudentIdentity.findOne({ schoolId, student: student._id }),
  ]);
  return {
    found: true,
    student: { name: student.name, studentId: student.studentId, status: student.status },
    currentRfid: card ? { uid: card.rfidNumber, status: card.status } : null,
    rfidStatus: card ? card.status : 'unassigned',
    qrStatus: identity ? { generated: true, version: identity.qrVersion, verifications: identity.verificationCount } : { generated: false },
    verificationStatus: student.status === 'active' && card ? 'verifiable' : 'incomplete',
  };
}

// ── RFID health monitoring (Step 8) ──────────────────────────────────────────
async function healthStats({ schoolId, inactiveDays = 30 }) {
  const cutoff = new Date(Date.now() - inactiveDays * 86400000);
  const [byStatus, activeStudents, neverUsed, recentlyReplaced] = await Promise.all([
    RfidCard.aggregate([{ $match: { schoolId } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Student.countDocuments({ schoolId, status: 'active' }),
    // active cards whose UID has never appeared in a scan log
    RfidCard.aggregate([
      { $match: { schoolId, status: 'active' } },
      { $lookup: { from: 'rfidscanlogs', localField: 'rfidNumber', foreignField: 'rfidNumber', as: 'scans' } },
      { $match: { scans: { $size: 0 } } },
      { $count: 'n' },
    ]),
    RfidCardHistory.countDocuments({ schoolId, action: { $in: ['replaced', 'reissued'] }, performedAt: { $gte: cutoff } }),
  ]);
  const by = Object.fromEntries(byStatus.map((r) => [r._id, r.count]));
  const active = by.active || 0;
  return {
    counts: {
      active, disabled: by.disabled || 0, lost: by.lost || 0, damaged: by.damaged || 0,
      replaced: by.replaced || 0, unassigned: by.unassigned || 0,
      total: byStatus.reduce((s, r) => s + r.count, 0),
    },
    activeStudents,
    utilizationRatePct: activeStudents > 0 ? +((active / activeStudents) * 100).toFixed(1) : 0,
    neverUsed: neverUsed[0]?.n || 0,
    recentlyReplaced,
    inactiveDays,
  };
}

module.exports = {
  ensureIdentity, tokenFor, qrPngBuffer, getIdentityProfile,
  generateQr, verifyByToken, verifyRfidUid, verifyStudent, healthStats, parentOf,
  markCard, reissueCard, logHistory,
};

async function resolveScope({ schoolId, scope, classId, sectionId, studentIds }) {
  const q = { schoolId, status: 'active' };
  if (scope === 'class' && classId) q.class = classId;
  else if (scope === 'section' && sectionId) { if (classId) q.class = classId; q.section = sectionId; }
  else if (scope === 'selected' && Array.isArray(studentIds)) q._id = { $in: studentIds };
  // scope === 'school' → all active students
  return Student.find(q).select('name studentId rollNumber class section photoUrl status')
    .populate('class', 'name').populate('section', 'name').lean();
}

module.exports.resolveScope = resolveScope;

async function logHistory({ schoolId, student, card, action, oldRfidNumber, newRfidNumber, reason, performedBy }) {
  return RfidCardHistory.create({ schoolId, student, card, action, oldRfidNumber, newRfidNumber, reason, performedBy });
}

// Mark a card lost/damaged (Step 7). Flips status only — the attendance scan
// path requires status:'active', so this immediately stops the card working
// without any change to attendance logic. Appends structured history.
async function markCard({ schoolId, cardId, status, reason, performedBy }) {
  if (!['lost', 'damaged'].includes(status)) throw new Error('markCard status must be lost or damaged.');
  const card = await RfidCard.findOne({ _id: cardId, schoolId });
  if (!card) throw Object.assign(new Error('RFID card not found.'), { code: 'NOT_FOUND' });

  const wasActive = card.status === 'active';
  card.status = status;
  await card.save();

  // If it was the student's active card, clear the pointer so they show as
  // needing a reissue (does not touch attendance history).
  if (wasActive && card.student) {
    await Student.updateOne({ _id: card.student, activeRfidCard: card._id }, { $set: { activeRfidCard: null } });
  }
  await logHistory({ schoolId, student: card.student, card: card._id, action: status, oldRfidNumber: card.rfidNumber, reason, performedBy });
  return card;
}

// Reissue: retire the old card (lost/damaged/replaced) and issue a NEW active
// card to the same student. Mirrors the assign/replace invariants (new card
// active, student.activeRfidCard → new). Never touches attendance records.
async function reissueCard({ schoolId, studentId, newRfidNumber, reason, retireStatus = 'replaced', cardType = 'card', performedBy }) {
  const student = await Student.findOne({ _id: studentId, schoolId });
  if (!student) throw Object.assign(new Error('Student not found.'), { code: 'NOT_FOUND' });

  const existing = await RfidCard.findOne({ schoolId, rfidNumber: newRfidNumber });
  if (existing) throw Object.assign(new Error('That RFID UID is already in the system.'), { code: 'DUPLICATE' });

  const oldCard = await RfidCard.findOne({ schoolId, student: student._id, status: 'active' });
  const oldUid = oldCard?.rfidNumber || null;
  if (oldCard) {
    oldCard.status = ['lost', 'damaged', 'replaced'].includes(retireStatus) ? retireStatus : 'replaced';
    await oldCard.save();
  }

  const newCard = await RfidCard.create({ schoolId, student: student._id, rfidNumber: newRfidNumber, cardType, status: 'active', assignedAt: new Date() });
  await Student.updateOne({ _id: student._id }, { $set: { activeRfidCard: newCard._id } });

  await logHistory({ schoolId, student: student._id, card: newCard._id, action: 'reissued', oldRfidNumber: oldUid, newRfidNumber, reason, performedBy });
  return { oldUid, newCard };
}
