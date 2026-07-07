/**
 * balanceEngine.js — Pure payment/balance engine (Phase 5, Step 1).
 *   • applyPaymentToInvoice: split a payment into the part that clears the
 *     outstanding balance vs. the excess (advance/credit). Supports partial and
 *     advance payments. No float, no I/O.
 *   • computeStudentBalance: roll a student's invoices into billed/paid/
 *     outstanding/advance totals — grouped per currency (never crosses currencies).
 */

const { assertMinor, clampNonNeg, addMinor } = require('./money');

/**
 * @param {{ totalPayableMinor:number, paidMinor:number }} invoice
 * @param {number} paymentMinor  positive integer minor units
 * @returns {{ appliedMinor:number, overpayMinor:number, newPaidMinor:number, newBalanceMinor:number, willBeFullyPaid:boolean }}
 */
function applyPaymentToInvoice(invoice, paymentMinor) {
  assertMinor(invoice.totalPayableMinor);
  assertMinor(invoice.paidMinor);
  assertMinor(paymentMinor);
  if (paymentMinor <= 0) throw new Error('Payment amount must be greater than zero.');

  const balanceBefore = clampNonNeg(invoice.totalPayableMinor - invoice.paidMinor);
  const appliedMinor = Math.min(paymentMinor, balanceBefore);
  const overpayMinor = paymentMinor - appliedMinor; // excess becomes advance/credit
  const newPaidMinor = invoice.paidMinor + paymentMinor;
  const newBalanceMinor = clampNonNeg(invoice.totalPayableMinor - newPaidMinor);

  return {
    appliedMinor,
    overpayMinor,
    newPaidMinor,
    newBalanceMinor,
    willBeFullyPaid: newPaidMinor >= invoice.totalPayableMinor,
  };
}

/**
 * @param {Array<{ currency:string, totalPayableMinor:number, paidMinor:number, status?:string }>} invoices
 * @returns {{ byCurrency: Object<string,{billedMinor,paidMinor,outstandingMinor,advanceMinor,invoiceCount,overdueCount}> }}
 */
function computeStudentBalance(invoices = []) {
  const byCurrency = {};
  for (const inv of invoices) {
    if (inv.status === 'void') continue;
    const cur = inv.currency;
    if (!byCurrency[cur]) {
      byCurrency[cur] = { billedMinor: 0, paidMinor: 0, outstandingMinor: 0, advanceMinor: 0, invoiceCount: 0, overdueCount: 0 };
    }
    const b = byCurrency[cur];
    const paidTowardBill = Math.min(inv.paidMinor, inv.totalPayableMinor);
    b.billedMinor = addMinor(b.billedMinor, inv.totalPayableMinor);
    b.paidMinor = addMinor(b.paidMinor, paidTowardBill);
    b.outstandingMinor = addMinor(b.outstandingMinor, clampNonNeg(inv.totalPayableMinor - inv.paidMinor));
    b.advanceMinor = addMinor(b.advanceMinor, clampNonNeg(inv.paidMinor - inv.totalPayableMinor));
    b.invoiceCount += 1;
    if (inv.status === 'overdue') b.overdueCount += 1;
  }
  return { byCurrency };
}

module.exports = { applyPaymentToInvoice, computeStudentBalance };
