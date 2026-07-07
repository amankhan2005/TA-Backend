/**
 * invoiceStatus.js — Pure invoice-status engine (Phase 5, Step 1).
 * Given what an invoice bills and what's been paid, derive its status and balance.
 * No I/O. `void` is a stored terminal state handled by the caller, not derived here.
 *
 * Status precedence (for a non-void invoice), evaluated as of `asOf`:
 *   paid      → paidMinor >= totalPayableMinor
 *   overdue   → not fully paid AND asOf > dueDate
 *   partial   → 0 < paidMinor < totalPayableMinor (and not past due)
 *   unpaid    → paidMinor == 0 (and not past due)
 */

const { assertMinor, clampNonNeg } = require('./money');

function computeInvoiceStatus({ totalPayableMinor, paidMinor, dueDate, asOf = new Date() }) {
  assertMinor(totalPayableMinor);
  assertMinor(paidMinor);

  const balanceMinor = clampNonNeg(totalPayableMinor - paidMinor);
  const overpaidMinor = clampNonNeg(paidMinor - totalPayableMinor); // advance / credit
  const fullyPaid = paidMinor >= totalPayableMinor;

  let pastDue = false;
  if (dueDate) {
    const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
    if (!Number.isNaN(due.getTime())) pastDue = asOf.getTime() > due.getTime();
  }

  let status;
  if (fullyPaid) status = 'paid';
  else if (pastDue) status = 'overdue';
  else if (paidMinor > 0) status = 'partial';
  else status = 'unpaid';

  return { status, balanceMinor, overpaidMinor, fullyPaid, pastDue };
}

module.exports = { computeInvoiceStatus };
