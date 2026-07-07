/**
 * feeAnalyticsService.js — Fee analytics for one school. Reuses the Phase 5
 * feeAggregation (collections/outstanding) and adds period collection, advance
 * balances, and the fee-recovery breakdowns. Everything is grouped per currency
 * (money of different currencies is never summed). Tenant-scoped by schoolId.
 */

const StudentInvoice = require('../../models/StudentInvoice');
const FeePayment = require('../../models/FeePayment');
const { collectionSummary, outstandingSummary } = require('../feeAggregation');
const { formatMinor } = require('../money');
const { dayBounds, monthBounds, yearBounds } = require('./time');

function addDisplay(byCurrency, keys) {
  for (const cur of Object.keys(byCurrency)) {
    for (const k of keys) {
      const minorKey = k;
      const dispKey = k.replace(/Minor$/, 'Display');
      if (byCurrency[cur][minorKey] != null) byCurrency[cur][dispKey] = formatMinor(byCurrency[cur][minorKey], cur, { withCode: true });
    }
  }
  return byCurrency;
}

async function collectionByCurrency(schoolId, from, to) {
  const { byCurrency } = await collectionSummary({ schoolId, from, to });
  return byCurrency;
}

async function advanceByCurrency(schoolId) {
  const rows = await StudentInvoice.aggregate([
    { $match: { schoolId, status: { $ne: 'void' } } },
    { $group: { _id: '$currency', advanceMinor: { $sum: '$overpaidMinor' } } },
  ]);
  return Object.fromEntries(rows.map((r) => [r._id, { advanceMinor: r.advanceMinor }]));
}

async function feeSummary({ schoolId, ref = new Date() }) {
  const today = dayBounds(ref);
  const month = monthBounds(ref);
  const year = yearBounds(ref);
  const [total, todayC, monthC, yearC, outstanding, advance] = await Promise.all([
    collectionByCurrency(schoolId),
    collectionByCurrency(schoolId, today.start, today.end),
    collectionByCurrency(schoolId, month.start, month.end),
    collectionByCurrency(schoolId, year.start, year.end),
    outstandingSummary({ schoolId, asOf: ref }).then((o) => o.byCurrency),
    advanceByCurrency(schoolId),
  ]);
  return {
    collectionTotal: addDisplay(total, ['totalMinor']),
    collectionToday: addDisplay(todayC, ['totalMinor']),
    collectionThisMonth: addDisplay(monthC, ['totalMinor']),
    collectionThisYear: addDisplay(yearC, ['totalMinor']),
    pendingAndOverdue: addDisplay(outstanding, ['outstandingMinor', 'overdueMinor']),
    advance: addDisplay(advance, ['advanceMinor']),
  };
}

// ── Fee recovery ─────────────────────────────────────────────────────────────
async function topDefaulters({ schoolId, limit = 10, asOf = new Date() }) {
  const rows = await StudentInvoice.aggregate([
    { $match: { schoolId, status: { $ne: 'void' }, $expr: { $lt: ['$paidMinor', '$totalPayableMinor'] } } },
    { $group: { _id: { student: '$student', currency: '$currency' }, outstandingMinor: { $sum: { $subtract: ['$totalPayableMinor', '$paidMinor'] } }, invoices: { $sum: 1 }, overdue: { $sum: { $cond: [{ $lt: ['$dueDate', asOf] }, 1, 0] } } } },
    { $sort: { outstandingMinor: -1 } },
    { $limit: limit },
    { $lookup: { from: 'students', localField: '_id.student', foreignField: '_id', as: 'st' } },
    { $project: { _id: 0, studentId: { $arrayElemAt: ['$st.studentId', 0] }, name: { $arrayElemAt: ['$st.name', 0] }, currency: '$_id.currency', outstandingMinor: 1, invoices: 1, overdue: 1 } },
  ]);
  return rows.map((r) => ({ ...r, outstandingDisplay: formatMinor(r.outstandingMinor, r.currency, { withCode: true }) }));
}

async function pendingByGroup({ schoolId, groupBy = 'class' }) {
  const field = groupBy === 'section' ? 'section' : 'class';
  const from = groupBy === 'section' ? 'sections' : 'schoolclasses';
  const rows = await StudentInvoice.aggregate([
    { $match: { schoolId, status: { $ne: 'void' }, $expr: { $lt: ['$paidMinor', '$totalPayableMinor'] } } },
    { $lookup: { from: 'students', localField: 'student', foreignField: '_id', as: 'st' } }, { $unwind: '$st' },
    { $group: { _id: { grp: { $ifNull: [`$${field}Snapshot`, `$st.${field}`] }, currency: "$currency" }, outstandingMinor: { $sum: { $subtract: ["$totalPayableMinor", "$paidMinor"] } } } },
    { $lookup: { from, localField: '_id.grp', foreignField: '_id', as: 'g' } },
    { $project: { _id: 0, groupId: '$_id.grp', name: { $ifNull: [{ $arrayElemAt: ['$g.name', 0] }, 'Unknown'] }, currency: '$_id.currency', outstandingMinor: 1 } },
    { $sort: { outstandingMinor: -1 } },
  ]);
  return rows.map((r) => ({ ...r, outstandingDisplay: formatMinor(r.outstandingMinor, r.currency, { withCode: true }) }));
}

async function collectionByGroup({ schoolId, groupBy = 'class', from, to }) {
  const field = groupBy === 'section' ? 'section' : 'class';
  const fromColl = groupBy === 'section' ? 'sections' : 'schoolclasses';
  const match = { schoolId, status: 'recorded' };
  if (from || to) { match.paidAt = {}; if (from) match.paidAt.$gte = new Date(from); if (to) match.paidAt.$lte = new Date(to); }
  const rows = await FeePayment.aggregate([
    { $match: match },
    { $lookup: { from: 'students', localField: 'student', foreignField: '_id', as: 'st' } }, { $unwind: '$st' },
    { $group: { _id: { grp: { $ifNull: [`$${field}Snapshot`, `$st.${field}`] }, currency: "$currency" }, collectedMinor: { $sum: "$amountMinor" } } },
    { $lookup: { from: fromColl, localField: '_id.grp', foreignField: '_id', as: 'g' } },
    { $project: { _id: 0, groupId: '$_id.grp', name: { $ifNull: [{ $arrayElemAt: ['$g.name', 0] }, 'Unknown'] }, currency: '$_id.currency', collectedMinor: 1 } },
    { $sort: { collectedMinor: -1 } },
  ]);
  return rows.map((r) => ({ ...r, collectedDisplay: formatMinor(r.collectedMinor, r.currency, { withCode: true }) }));
}

async function feeRecovery({ schoolId, ref = new Date() }) {
  const [defaulters, pendingByClass, pendingBySection, collectionByClass, collectionBySection] = await Promise.all([
    topDefaulters({ schoolId, asOf: ref }),
    pendingByGroup({ schoolId, groupBy: 'class' }),
    pendingByGroup({ schoolId, groupBy: 'section' }),
    collectionByGroup({ schoolId, groupBy: 'class' }),
    collectionByGroup({ schoolId, groupBy: 'section' }),
  ]);
  return {
    topDefaulters: defaulters,
    mostOverdue: [...defaulters].sort((a, b) => b.overdue - a.overdue).slice(0, 10),
    pendingByClass, pendingBySection, collectionByClass, collectionBySection,
  };
}

module.exports = { feeSummary, feeRecovery, topDefaulters, pendingByGroup, collectionByGroup };
