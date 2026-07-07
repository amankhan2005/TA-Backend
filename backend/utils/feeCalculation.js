/**
 * feeCalculation.js — Pure fee-amount engine (Phase 5, Step 1).
 * Turns line items + discounts into subtotal / discount / total, all in integer
 * minor units of a single currency. No I/O, no floats.
 */

const { requireCurrency, assertMinor, mulMinor, addMinor, percentOfMinor, clampNonNeg } = require('./money');

/**
 * @param {Object} p
 * @param {string} p.currency
 * @param {Array<{description:string, amountMinor:number, quantity?:number}>} p.lineItems
 * @param {Array<{type:'fixed'|'percent', value:number, description?:string}>} [p.discounts]
 * @returns {{ currency, lineItems, subtotalMinor, discountMinor, totalPayableMinor }}
 */
function computeInvoiceAmounts({ currency, lineItems, discounts = [] }) {
  requireCurrency(currency);
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw new Error('An invoice needs at least one line item.');
  }

  const normalized = lineItems.map((li, i) => {
    if (!li || typeof li.description !== 'string' || !li.description.trim()) {
      throw new Error(`Line item ${i + 1} needs a description.`);
    }
    assertMinor(li.amountMinor); // non-negative integer
    const quantity = li.quantity == null ? 1 : li.quantity;
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error(`Line item ${i + 1} quantity must be a positive integer.`);
    const lineTotalMinor = mulMinor(li.amountMinor, quantity);
    return { description: li.description.trim(), amountMinor: li.amountMinor, quantity, lineTotalMinor };
  });

  const subtotalMinor = normalized.reduce((sum, li) => addMinor(sum, li.lineTotalMinor), 0);

  // Discounts apply against the subtotal; percent discounts round half-up. The
  // total discount is clamped so it can never exceed the subtotal (no negative invoice).
  let discountMinor = 0;
  for (const [i, d] of discounts.entries()) {
    if (!d || (d.type !== 'fixed' && d.type !== 'percent')) throw new Error(`Discount ${i + 1} type must be 'fixed' or 'percent'.`);
    if (d.type === 'fixed') {
      assertMinor(d.value);
      discountMinor = addMinor(discountMinor, d.value);
    } else {
      if (typeof d.value !== 'number' || d.value < 0 || d.value > 100) throw new Error(`Discount ${i + 1} percent must be 0–100.`);
      discountMinor = addMinor(discountMinor, percentOfMinor(subtotalMinor, d.value));
    }
  }
  if (discountMinor > subtotalMinor) discountMinor = subtotalMinor;

  const totalPayableMinor = clampNonNeg(subtotalMinor - discountMinor);

  return { currency, lineItems: normalized, subtotalMinor, discountMinor, totalPayableMinor };
}

module.exports = { computeInvoiceAmounts };
