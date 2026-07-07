/**
 * feeAggregation.js — Reusable fee reporting aggregations (Phase 5, Step 7).
 * Deliberately pure MongoDB aggregations returning per-currency breakdowns (money
 * of different currencies is never summed together). Exported as standalone
 * functions so Phase 6 dashboards can call them directly without going through
 * the fee controller.
 */

const FeePayment = require('../models/FeePayment');
const StudentInvoice = require('../models/StudentInvoice');

/**
 * Total collected in [from, to], grouped by currency, with a per-method breakdown.
 * @returns {Promise<{ byCurrency: Object<string,{totalMinor,count,byMethod}> }>}
 */
async function collectionSummary({ schoolId, from, to }) {
  const match = { schoolId, status: 'recorded' };
  if (from || to) {
    match.paidAt = {};
    if (from) match.paidAt.$gte = new Date(from);
    if (to) match.paidAt.$lte = new Date(to);
  }
  const rows = await FeePayment.aggregate([
    { $match: match },
    { $group: { _id: { currency: '$currency', method: '$method' }, amount: { $sum: '$amountMinor' }, count: { $sum: 1 } } },
  ]);

  const byCurrency = {};
  for (const r of rows) {
    const cur = r._id.currency;
    if (!byCurrency[cur]) byCurrency[cur] = { totalMinor: 0, count: 0, byMethod: {} };
    byCurrency[cur].totalMinor += r.amount;
    byCurrency[cur].count += r.count;
    byCurrency[cur].byMethod[r._id.method] = { totalMinor: r.amount, count: r.count };
  }
  return { byCurrency };
}

/**
 * Outstanding + overdue balances as of `asOf`, grouped by currency.
 * @returns {Promise<{ asOf, byCurrency: Object<string,{outstandingMinor,overdueMinor,invoiceCount,overdueCount}> }>}
 */
async function outstandingSummary({ schoolId, asOf = new Date() }) {
  const asOfDate = asOf instanceof Date ? asOf : new Date(asOf);
  const rows = await StudentInvoice.aggregate([
    { $match: { schoolId, status: { $ne: 'void' } } },
    {
      $project: {
        currency: 1,
        outstanding: { $max: [0, { $subtract: ['$totalPayableMinor', '$paidMinor'] }] },
        isOverdue: { $and: [{ $lt: ['$dueDate', asOfDate] }, { $lt: ['$paidMinor', '$totalPayableMinor'] }] },
      },
    },
    {
      $group: {
        _id: '$currency',
        outstandingMinor: { $sum: '$outstanding' },
        invoiceCount: { $sum: 1 },
        overdueCount: { $sum: { $cond: ['$isOverdue', 1, 0] } },
        overdueMinor: { $sum: { $cond: ['$isOverdue', '$outstanding', 0] } },
      },
    },
  ]);

  const byCurrency = {};
  for (const r of rows) {
    byCurrency[r._id] = {
      outstandingMinor: r.outstandingMinor,
      overdueMinor: r.overdueMinor,
      invoiceCount: r.invoiceCount,
      overdueCount: r.overdueCount,
    };
  }
  return { asOf: asOfDate, byCurrency };
}

module.exports = { collectionSummary, outstandingSummary };
