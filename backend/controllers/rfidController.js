const RfidCard = require('../models/RfidCard');
const Student = require('../models/Student');
const School = require('../models/School');
const AuditLog = require('../models/AuditLog');
const { logEvent } = require('../utils/audit');

/**
 * RFID lifecycle controller. All routes here are schoolAdmin-authenticated
 * (normal JWT `protect('schoolAdmin')`), NOT device-authenticated — these
 * are admin actions taken from the School Admin UI, distinct from the
 * hardware-facing scan ingestion endpoint in studentAttendanceController.js.
 *
 * ── Scan-to-Link UID enrollment — design note ────────────────────────────
 * Most USB/desktop RFID readers used for enrollment (as opposed to
 * fixed-location attendance kiosks) act as a keyboard-emulation "wedge" —
 * the reader types the card's UID as plain text wherever the browser's
 * cursor focus is, no special driver/integration needed. That means the
 * "scan card, system reads UID" workflow is naturally just: the admin
 * clicks into a UID input field, taps the card, and the reader types the
 * UID in — then the admin's own authenticated browser session (their
 * existing schoolAdmin JWT) submits it to `assignRfid` below like any other
 * form field. No device API key, no separate device registration, is
 * needed for enrollment specifically — device credentials (ApiDevice/
 * deviceAuth) are for continuously-running attendance kiosks, a different
 * hardware role. If your actual reader hardware is NOT a keyboard-wedge
 * device (e.g. it only exposes a serial/vendor SDK), the `assignRfid`
 * endpoint's contract (accepts a plain `rfidNumber` string) doesn't
 * change — only what feeds that string into the admin's browser does, so
 * confirming which kind of reader you have doesn't block this endpoint,
 * only the frontend integration around it.
 */

// ── Assign RFID to a student (covers the "scan & auto-link" workflow) ───────
exports.assignRfid = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { studentId, rfidNumber, cardType } = req.body;

    const student = await Student.findOne({ _id: studentId, schoolId });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });
    if (student.activeRfidCard) {
      return res.status(400).json({ success: false, message: 'This student already has an active RFID card. Use Replace instead.' });
    }

    // RFID-limit enforcement (F-2) — mirrors studentLimit exactly. Only a
    // NET-NEW assignment is gated: Replace is a swap (old card → replaced,
    // new card → active, net active count unchanged) and Unassign frees a
    // slot, so neither is blocked here. A null rfidLimit means unlimited
    // (existing plans, before a Super Admin sets one).
    const school = await School.findOne({ schoolId }).populate('subscriptionPlan');
    const rfidLimit = school?.subscriptionPlan?.rfidLimit;
    if (rfidLimit != null) {
      const activeCards = await RfidCard.countDocuments({ schoolId, status: 'active' });
      if (activeCards >= rfidLimit) {
        return res.status(403).json({
          success: false,
          message: `RFID card limit reached (${rfidLimit}). Unassign a card or upgrade your subscription to add more.`,
        });
      }
    }

    const existingCard = await RfidCard.findOne({ rfidNumber });
    if (existingCard && existingCard.status === 'active') {
      return res.status(400).json({ success: false, message: 'This RFID is already assigned to another active card.' });
    }

    let card;
    if (existingCard) {
      // Re-linking a previously unassigned/disabled physical card to a (possibly new) student.
      existingCard.student = student._id;
      existingCard.status = 'active';
      existingCard.cardType = cardType || existingCard.cardType;
      existingCard.assignedDate = new Date();
      existingCard.unassignedDate = null;
      existingCard.disabledDate = null;
      card = await existingCard.save();
    } else {
      card = await RfidCard.create({
        schoolId, student: student._id, rfidNumber, cardType: cardType || 'card',
        status: 'active', assignedDate: new Date(),
      });
    }

    student.activeRfidCard = card._id;
    await student.save();

    await logEvent(req, 'rfidCard.assigned', {
      targetType: 'rfidCard', targetId: card._id, targetName: rfidNumber,
      metadata: { studentId: student._id, studentName: student.name, cardType: card.cardType },
    });

    res.status(201).json({ success: true, message: 'RFID assigned.', card });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ success: false, message: 'This RFID number is already registered.' });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Unassign RFID (remove from student, card remains valid for later reuse) ─
exports.unassignRfid = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { studentId } = req.body;

    const student = await Student.findOne({ _id: studentId, schoolId });
    if (!student || !student.activeRfidCard) {
      return res.status(404).json({ success: false, message: 'Student has no active RFID card to unassign.' });
    }

    const card = await RfidCard.findOne({ _id: student.activeRfidCard, schoolId });
    if (!card) return res.status(404).json({ success: false, message: 'RFID card not found.' });

    card.status = 'unassigned';
    card.student = null;
    card.unassignedDate = new Date();
    await card.save();

    student.activeRfidCard = null;
    await student.save();

    await logEvent(req, 'rfidCard.unassigned', {
      targetType: 'rfidCard', targetId: card._id, targetName: card.rfidNumber,
      metadata: { studentId: student._id, studentName: student.name },
    });

    res.json({ success: true, message: 'RFID unassigned. The card can be assigned to another student later.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Replace RFID (lost/damaged card → issue a new one) ──────────────────────
exports.replaceRfid = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { studentId, newRfidNumber, cardType, reason } = req.body;

    const student = await Student.findOne({ _id: studentId, schoolId });
    if (!student || !student.activeRfidCard) {
      return res.status(404).json({ success: false, message: 'Student has no active RFID card to replace.' });
    }

    const oldCard = await RfidCard.findOne({ _id: student.activeRfidCard, schoolId });

    const existingNew = await RfidCard.findOne({ rfidNumber: newRfidNumber });
    if (existingNew && existingNew.status === 'active') {
      return res.status(400).json({ success: false, message: 'The replacement RFID number is already assigned to another active card.' });
    }

    const newCard = await RfidCard.create({
      schoolId, student: student._id, rfidNumber: newRfidNumber, cardType: cardType || oldCard?.cardType || 'card',
      status: 'active', assignedDate: new Date(),
    });

    if (oldCard) {
      oldCard.status = 'replaced';
      oldCard.student = null;
      oldCard.replacedByCard = newCard._id;
      await oldCard.save();
    }

    student.activeRfidCard = newCard._id;
    await student.save();

    await logEvent(req, 'rfidCard.replaced', {
      targetType: 'rfidCard', targetId: newCard._id, targetName: newRfidNumber,
      metadata: { studentId: student._id, studentName: student.name, oldCardId: oldCard?._id, reason: reason || null },
    });

    res.status(201).json({ success: true, message: 'RFID replaced.', card: newCard });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ success: false, message: 'This RFID number is already registered.' });
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Disable RFID (lost/stolen — scans against it become unknown_card) ───────
exports.disableRfid = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { cardId, reason } = req.body;

    const card = await RfidCard.findOne({ _id: cardId, schoolId });
    if (!card) return res.status(404).json({ success: false, message: 'RFID card not found.' });
    if (card.status === 'disabled') return res.status(400).json({ success: false, message: 'This card is already disabled.' });

    card.status = 'disabled';
    card.disabledDate = new Date();
    await card.save();

    await logEvent(req, 'rfidCard.disabled', {
      targetType: 'rfidCard', targetId: card._id, targetName: card.rfidNumber,
      metadata: { reason: reason || null },
    });

    res.json({ success: true, message: 'RFID disabled.', card });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Reactivate a disabled RFID ───────────────────────────────────────────────
exports.reactivateRfid = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { cardId } = req.body;

    const card = await RfidCard.findOne({ _id: cardId, schoolId });
    if (!card) return res.status(404).json({ success: false, message: 'RFID card not found.' });
    if (card.status !== 'disabled') return res.status(400).json({ success: false, message: 'Only a disabled card can be reactivated.' });

    card.status = card.student ? 'active' : 'unassigned';
    card.disabledDate = null;
    await card.save();

    await logEvent(req, 'rfidCard.reactivated', { targetType: 'rfidCard', targetId: card._id, targetName: card.rfidNumber });

    res.json({ success: true, message: 'RFID reactivated.', card });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── List RFID cards for the school ───────────────────────────────────────────
exports.getRfidCards = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { status } = req.query;
    const filter = { schoolId };
    if (status) filter.status = status;
    const cards = await RfidCard.find(filter).populate('student', 'name studentId photoUrl').sort({ createdAt: -1 });
    res.json({ success: true, total: cards.length, cards });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── RFID audit history for one card ──────────────────────────────────────────
exports.getRfidHistory = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const card = await RfidCard.findOne({ _id: req.params.cardId, schoolId });
    if (!card) return res.status(404).json({ success: false, message: 'RFID card not found.' });

    const history = await AuditLog.find({ schoolId, targetType: 'rfidCard', targetId: card._id }).sort({ createdAt: -1 });
    res.json({ success: true, card, history });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};