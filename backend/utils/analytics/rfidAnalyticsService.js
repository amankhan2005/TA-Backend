/**
 * rfidAnalyticsService.js — RFID card + scan analytics for one school.
 * Tenant-scoped. Reuses RfidCard (lifecycle states) and RfidScanLog (every scan).
 */
const RfidCard = require('../../models/RfidCard');
const RfidScanLog = require('../../models/RfidScanLog');
const { dayBounds } = require('./time');

async function cardStats({ schoolId }) {
  const rows = await RfidCard.aggregate([
    { $match: { schoolId } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r._id, r.count]));
  return {
    total: rows.reduce((s, r) => s + r.count, 0),
    active: by.active || 0, unassigned: by.unassigned || 0, disabled: by.disabled || 0, replaced: by.replaced || 0,
  };
}

async function scanStats({ schoolId, ref = new Date() }) {
  const { start, end } = dayBounds(ref);
  const rows = await RfidScanLog.aggregate([
    { $match: { schoolId, scannedAt: { $gte: start, $lte: end } } },
    { $group: { _id: '$outcome', count: { $sum: 1 } } },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r._id, r.count]));
  const duplicates = (by.ignored_duplicate || 0) + (by.ignored_before_min_duration || 0) + (by.ignored_locked || 0);
  return {
    totalToday: rows.reduce((s, r) => s + r.count, 0),
    punchInsToday: by.punch_in || 0,
    punchOutsToday: by.punch_out || 0,
    unknownToday: by.unknown_card || 0,
    duplicateIgnoredToday: duplicates,
  };
}

async function rfidAnalytics({ schoolId, ref = new Date() }) {
  const [cards, scans] = await Promise.all([cardStats({ schoolId }), scanStats({ schoolId, ref })]);
  return { cards, scans };
}

module.exports = { cardStats, scanStats, rfidAnalytics };
