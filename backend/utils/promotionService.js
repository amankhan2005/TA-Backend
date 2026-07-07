/**
 * promotionService.js — Phase 7 orchestration. preview → validate → execute,
 * with execution and rollback wrapped in MongoDB transactions so a batch is
 * ALL-OR-NOTHING (no partial promotions; any failure aborts and leaves every
 * student in their original valid state).
 *
 * Non-destructive by construction: promotion only updates a Student's
 * class/section/session. Attendance, fees, reports, and RFID cards reference the
 * student by _id (and denormalized studentIdRef, which never changes), so they
 * are untouched and remain fully accessible after promotion.
 */

const mongoose = require('mongoose');
const Student = require('../models/Student');
const SchoolClass = require('../models/SchoolClass');
const Section = require('../models/Section');
const AcademicSession = require('../models/AcademicSession');
const StudentInvoice = require('../models/StudentInvoice');
const StudentPromotionRecord = require('../models/StudentPromotionRecord');
const { buildPreview } = require('./promotionEngine');
const { notifyStudentEvent } = require('./notificationService');

// Run a function inside a transaction; ALL-OR-NOTHING. Surfaces a clear message
// if the Mongo deployment doesn't support transactions (must be a replica set).
async function inTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await fn(session); });
    return result;
  } catch (err) {
    if (/Transaction numbers|replica set|not supported/i.test(err.message)) {
      throw Object.assign(new Error('Promotion execution requires MongoDB transactions (a replica set). The current deployment does not support them.'), { code: 'NO_TRANSACTIONS' });
    }
    throw err;
  } finally {
    session.endSession();
  }
}

// ── Candidate resolution by mode ─────────────────────────────────────────────
function candidateQuery(batch) {
  const q = { schoolId: batch.schoolId, status: 'active' };
  switch (batch.mode) {
    case 'class': q.class = batch.sourceClass; if (batch.sourceSession) q.session = batch.sourceSession; break;
    case 'section': q.class = batch.sourceClass; q.section = batch.sourceSection; if (batch.sourceSession) q.session = batch.sourceSession; break;
    case 'session': q.session = batch.sourceSession; break;
    case 'selected': q._id = { $in: batch.selectedStudentIds || [] }; break;
    case 'transfer':
      if (batch.sourceSection) { q.class = batch.sourceClass; q.section = batch.sourceSection; }
      else if (batch.sourceClass) { q.class = batch.sourceClass; }
      else if (batch.selectedStudentIds?.length) { q._id = { $in: batch.selectedStudentIds }; }
      if (batch.sourceSession) q.session = batch.sourceSession;
      break;
    case 'retention':
      if (batch.sourceSection) { q.class = batch.sourceClass; q.section = batch.sourceSection; }
      else if (batch.sourceClass) { q.class = batch.sourceClass; }
      else if (batch.selectedStudentIds?.length) { q._id = { $in: batch.selectedStudentIds }; }
      if (batch.sourceSession) q.session = batch.sourceSession;
      break;
    default: throw new Error(`Unknown promotion mode "${batch.mode}".`);
  }
  return q;
}

async function resolveCandidates(batch, session = null) {
  let query = Student.find(candidateQuery(batch)).select('studentId name class section session status');
  if (session) query = query.session(session);
  return query.lean();
}

async function loadOutstandingMap(schoolId, studentIds) {
  if (!studentIds.length) return new Map();
  const rows = await StudentInvoice.aggregate([
    { $match: { schoolId, student: { $in: studentIds }, status: { $ne: 'void' }, $expr: { $lt: ['$paidMinor', '$totalPayableMinor'] } } },
    { $group: { _id: '$student', outstanding: { $sum: { $subtract: ['$totalPayableMinor', '$paidMinor'] } } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.outstanding]));
}

// Destination must exist and belong to this school (checked before any write).
async function validateDestination(batch) {
  const errs = [];
  if (batch.destClass) { if (!(await SchoolClass.exists({ _id: batch.destClass, schoolId: batch.schoolId }))) errs.push('Destination class not found in this school.'); }
  if (batch.destSection) { if (!(await Section.exists({ _id: batch.destSection, schoolId: batch.schoolId }))) errs.push('Destination section not found in this school.'); }
  if (batch.destSession) { if (!(await AcademicSession.exists({ _id: batch.destSession, schoolId: batch.schoolId }))) errs.push('Destination session not found in this school.'); }
  return errs;
}

// ── Preview (no writes) ──────────────────────────────────────────────────────
async function preview(batch) {
  const destErrors = await validateDestination(batch);
  const students = await resolveCandidates(batch);
  const outstandingMap = await loadOutstandingMap(batch.schoolId, students.map((s) => s._id));
  const retainedSet = new Set((batch.retainedStudentIds || []).map(String));
  if (batch.mode === 'retention') for (const s of students) retainedSet.add(String(s._id));

  const result = buildPreview({
    students,
    source: { session: batch.sourceSession, class: batch.sourceClass, section: batch.sourceSection },
    destination: { session: batch.destSession, class: batch.destClass, section: batch.destSection },
    retainedSet, outstandingMap, mode: batch.mode,
  });
  result.destinationErrors = destErrors;
  result.executable = result.executable && destErrors.length === 0;
  return result;
}

// ── Execute (transactional, all-or-nothing) ──────────────────────────────────
async function execute(batch, executedBy) {
  const destErrors = await validateDestination(batch);
  if (destErrors.length) throw Object.assign(new Error(`Destination invalid: ${destErrors.join(' ')}`), { code: 'BAD_DESTINATION' });

  return inTransaction(async (session) => {
    const students = await resolveCandidates(batch, session);
    const retainedSet = new Set((batch.retainedStudentIds || []).map(String));
    if (batch.mode === 'retention') for (const s of students) retainedSet.add(String(s._id));

    let promoted = 0, retained = 0, transferred = 0;
    const records = [];

    for (const s of students) {
      // Hard invariant: any student without a full placement fails the WHOLE
      // batch (no partial promotions). Student schema requires these, so this is
      // a defensive guard, not an expected path.
      if (!s.class || !s.section || !s.session) {
        throw Object.assign(new Error(`Student ${s.studentId} has incomplete placement; batch aborted.`), { code: 'INCOMPLETE_STUDENT' });
      }
      const prev = { previousSession: s.session, previousClass: s.class, previousSection: s.section };
      const isRetain = retainedSet.has(String(s._id));

      if (isRetain) {
        records.push({
          schoolId: batch.schoolId, student: s._id, studentIdRef: s.studentId, batch: batch._id, action: 'retained',
          ...prev, newSession: s.session, newClass: s.class, newSection: s.section,
          reason: { type: batch.retentionReason?.type || 'academic', note: batch.retentionReason?.note || null },
          promotedBy: executedBy, promotedAt: new Date(),
        });
        retained += 1;
      } else {
        const nu = { session: batch.destSession || s.session, class: batch.destClass || s.class, section: batch.destSection || s.section };
        await Student.updateOne({ _id: s._id }, { $set: { session: nu.session, class: nu.class, section: nu.section } }, { session });
        const action = batch.mode === 'transfer' ? 'transferred' : 'promoted';
        records.push({
          schoolId: batch.schoolId, student: s._id, studentIdRef: s.studentId, batch: batch._id, action,
          ...prev, newSession: nu.session, newClass: nu.class, newSection: nu.section,
          reason: { type: action === 'transferred' ? 'transfer' : 'promotion', note: null },
          promotedBy: executedBy, promotedAt: new Date(),
        });
        if (action === 'transferred') transferred += 1; else promoted += 1;
      }
    }

    if (records.length) await StudentPromotionRecord.insertMany(records, { session });

    batch.totalStudents = students.length;
    batch.promotedCount = promoted;
    batch.retainedCount = retained;
    batch.transferredCount = transferred;
    batch.status = 'executed';
    batch.executedBy = executedBy;
    batch.executedAt = new Date();
    await batch.save({ session });

    return { promoted, retained, transferred, total: students.length };
  });
}

// ── Rollback (transactional) — restore each moved student's previous placement ─
async function rollback(batch, rolledBackBy) {
  return inTransaction(async (session) => {
    const records = await StudentPromotionRecord.find({ batch: batch._id, reversed: false, action: { $in: ['promoted', 'transferred'] } }).session(session);
    let reversed = 0;
    for (const r of records) {
      await Student.updateOne({ _id: r.student }, { $set: { session: r.previousSession, class: r.previousClass, section: r.previousSection } }, { session });
      r.reversed = true;
      await r.save({ session });
      reversed += 1;
    }
    batch.status = 'rolled_back';
    batch.rolledBackBy = rolledBackBy;
    batch.rolledBackAt = new Date();
    await batch.save({ session });
    return { reversed };
  });
}

// ── Optional parent notifications (best-effort, post-commit) ──────────────────
async function notifyPromoted(batch) {
  if (!batch.notify) return { queued: 0 };
  const records = await StudentPromotionRecord.find({ batch: batch._id, action: { $in: ['promoted', 'transferred'] } }).populate('newClass', 'name');
  const School = require('../models/School');
  const school = await School.findOne({ schoolId: batch.schoolId });
  let queued = 0;
  for (const r of records) {
    try {
      await notifyStudentEvent({
        schoolId: batch.schoolId, studentId: r.student.toString(), type: 'promotion',
        data: { schoolName: school?.name, schoolLogoUrl: school?.logoUrl, newClassName: r.newClass?.name || 'the next class' },
        channelOverride: { email: true, whatsapp: false },
      });
      queued += 1;
    } catch (e) { console.error('[promotionService] notify failed:', e.message); }
  }
  return { queued };
}

module.exports = { preview, execute, rollback, notifyPromoted, resolveCandidates, candidateQuery, validateDestination };
