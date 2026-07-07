/**
 * feeEngines.test.js — Tests for the pure Phase 5 financial engines.
 * Run with:  node utils/feeEngines.test.js
 * No DB, no float. Money is always integer minor units.
 */

const assert = require('assert');
const money = require('./money');
const { computeInvoiceAmounts } = require('./feeCalculation');
const { computeInvoiceStatus } = require('./invoiceStatus');
const { applyPaymentToInvoice, computeStudentBalance } = require('./balanceEngine');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}`); console.error(`     ${err.message}`); }
}

console.log('\n── money: parse (major → minor, no float) ──\n');

test('100.50 USD → 10050', () => assert.strictEqual(money.parseMoneyToMinor('100.50', 'USD'), 10050));
test('numeric 100.5 USD → 10050', () => assert.strictEqual(money.parseMoneyToMinor(100.5, 'USD'), 10050));
test('classic float trap 0.1+0.2 style: "0.30" → 30', () => assert.strictEqual(money.parseMoneyToMinor('0.30', 'USD'), 30));
test('whole number "1000" INR → 100000', () => assert.strictEqual(money.parseMoneyToMinor('1000', 'INR'), 100000));
test('thousands separators tolerated "1,000.00" → 100000', () => assert.strictEqual(money.parseMoneyToMinor('1,000.00', 'KES'), 100000));
test('rounds half-up beyond 2 dp: "1.005" → 101', () => assert.strictEqual(money.parseMoneyToMinor('1.005', 'USD'), 101));
test('trunc-round down: "1.004" → 100', () => assert.strictEqual(money.parseMoneyToMinor('1.004', 'USD'), 100));
test('rejects garbage', () => assert.throws(() => money.parseMoneyToMinor('abc', 'USD')));
test('rejects unsupported currency', () => assert.throws(() => money.parseMoneyToMinor('1.00', 'GBP')));

console.log('\n── money: format (minor → major) ──\n');

test('10050 USD → "100.50"', () => assert.strictEqual(money.formatMinor(10050, 'USD'), '100.50'));
test('100000 INR grouped → "1,000.00"', () => assert.strictEqual(money.formatMinor(100000, 'INR'), '1,000.00'));
test('with symbol ₹', () => assert.strictEqual(money.formatMinor(100000, 'INR', { withSymbol: true }), '\u20B91,000.00'));
test('with code', () => assert.strictEqual(money.formatMinor(10050, 'USD', { withCode: true }), '100.50 USD'));
test('round-trip parse∘format∘parse stable', () => {
  for (const v of ['0.00', '0.05', '12.34', '9999.99', '100000.00']) {
    const c = 'KES';
    const minor = money.parseMoneyToMinor(v, c);
    assert.strictEqual(money.parseMoneyToMinor(money.formatMinor(minor, c), c), minor);
  }
});

console.log('\n── money: integer arithmetic ──\n');

test('addMinor sums', () => assert.strictEqual(money.addMinor(100, 250, 50), 400));
test('mulMinor by qty', () => assert.strictEqual(money.mulMinor(10050, 3), 30150));
test('percentOfMinor 10% of 10050 → 1005 (half-up)', () => assert.strictEqual(money.percentOfMinor(10050, 10), 1005));
test('percentOfMinor rounds half-up: 15% of 333 → 50', () => assert.strictEqual(money.percentOfMinor(333, 15), 50));
test('mulMinor rejects fractional qty', () => assert.throws(() => money.mulMinor(100, 1.5)));
test('assertMinor rejects float amount', () => assert.throws(() => money.assertMinor(10.5)));

console.log('\n── feeCalculation: subtotal / discount / total ──\n');

test('single line item', () => {
  const r = computeInvoiceAmounts({ currency: 'USD', lineItems: [{ description: 'Tuition', amountMinor: 50000 }] });
  assert.strictEqual(r.subtotalMinor, 50000);
  assert.strictEqual(r.totalPayableMinor, 50000);
});
test('quantity multiplies', () => {
  const r = computeInvoiceAmounts({ currency: 'USD', lineItems: [{ description: 'Bus', amountMinor: 1500, quantity: 4 }] });
  assert.strictEqual(r.subtotalMinor, 6000);
});
test('multiple items + fixed discount', () => {
  const r = computeInvoiceAmounts({
    currency: 'INR',
    lineItems: [{ description: 'Tuition', amountMinor: 500000 }, { description: 'Lab', amountMinor: 100000 }],
    discounts: [{ type: 'fixed', value: 50000 }],
  });
  assert.strictEqual(r.subtotalMinor, 600000);
  assert.strictEqual(r.discountMinor, 50000);
  assert.strictEqual(r.totalPayableMinor, 550000);
});
test('percent discount rounds half-up', () => {
  const r = computeInvoiceAmounts({ currency: 'USD', lineItems: [{ description: 'X', amountMinor: 333 }], discounts: [{ type: 'percent', value: 15 }] });
  assert.strictEqual(r.discountMinor, 50); // 15% of 333 = 49.95 → 50
  assert.strictEqual(r.totalPayableMinor, 283);
});
test('discount clamped to subtotal (never negative invoice)', () => {
  const r = computeInvoiceAmounts({ currency: 'USD', lineItems: [{ description: 'X', amountMinor: 1000 }], discounts: [{ type: 'fixed', value: 5000 }] });
  assert.strictEqual(r.discountMinor, 1000);
  assert.strictEqual(r.totalPayableMinor, 0);
});
test('rejects empty line items', () => assert.throws(() => computeInvoiceAmounts({ currency: 'USD', lineItems: [] })));
test('rejects float amountMinor', () => assert.throws(() => computeInvoiceAmounts({ currency: 'USD', lineItems: [{ description: 'X', amountMinor: 10.5 }] })));
test('rejects percent > 100', () => assert.throws(() => computeInvoiceAmounts({ currency: 'USD', lineItems: [{ description: 'X', amountMinor: 100 }], discounts: [{ type: 'percent', value: 150 }] })));

console.log('\n── invoiceStatus ──\n');

const past = new Date('2026-06-01');
const future = new Date('2026-12-31');
const asOf = new Date('2026-07-03');

test('unpaid before due', () => assert.strictEqual(computeInvoiceStatus({ totalPayableMinor: 1000, paidMinor: 0, dueDate: future, asOf }).status, 'unpaid'));
test('partial before due', () => assert.strictEqual(computeInvoiceStatus({ totalPayableMinor: 1000, paidMinor: 400, dueDate: future, asOf }).status, 'partial'));
test('paid exact', () => assert.strictEqual(computeInvoiceStatus({ totalPayableMinor: 1000, paidMinor: 1000, dueDate: past, asOf }).status, 'paid'));
test('paid even if past due', () => assert.strictEqual(computeInvoiceStatus({ totalPayableMinor: 1000, paidMinor: 1000, dueDate: past, asOf }).status, 'paid'));
test('overdue: unpaid past due', () => assert.strictEqual(computeInvoiceStatus({ totalPayableMinor: 1000, paidMinor: 0, dueDate: past, asOf }).status, 'overdue'));
test('overdue: partial past due', () => assert.strictEqual(computeInvoiceStatus({ totalPayableMinor: 1000, paidMinor: 400, dueDate: past, asOf }).status, 'overdue'));
test('balance computed', () => assert.strictEqual(computeInvoiceStatus({ totalPayableMinor: 1000, paidMinor: 400, dueDate: future, asOf }).balanceMinor, 600));
test('overpaid → advance credit, zero balance', () => {
  const s = computeInvoiceStatus({ totalPayableMinor: 1000, paidMinor: 1500, dueDate: future, asOf });
  assert.strictEqual(s.status, 'paid'); assert.strictEqual(s.balanceMinor, 0); assert.strictEqual(s.overpaidMinor, 500);
});

console.log('\n── balanceEngine: payments ──\n');

test('partial payment', () => {
  const r = applyPaymentToInvoice({ totalPayableMinor: 1000, paidMinor: 0 }, 400);
  assert.deepStrictEqual([r.appliedMinor, r.overpayMinor, r.newBalanceMinor, r.willBeFullyPaid], [400, 0, 600, false]);
});
test('exact payment clears', () => {
  const r = applyPaymentToInvoice({ totalPayableMinor: 1000, paidMinor: 600 }, 400);
  assert.deepStrictEqual([r.appliedMinor, r.overpayMinor, r.willBeFullyPaid], [400, 0, true]);
});
test('advance payment → overpay is credit', () => {
  const r = applyPaymentToInvoice({ totalPayableMinor: 1000, paidMinor: 0 }, 1500);
  assert.deepStrictEqual([r.appliedMinor, r.overpayMinor, r.newBalanceMinor, r.willBeFullyPaid], [1000, 500, 0, true]);
});
test('rejects zero/negative payment', () => assert.throws(() => applyPaymentToInvoice({ totalPayableMinor: 1000, paidMinor: 0 }, 0)));

console.log('\n── balanceEngine: student rollup (per currency) ──\n');

test('rolls up per currency, excludes void', () => {
  const { byCurrency } = computeStudentBalance([
    { currency: 'USD', totalPayableMinor: 1000, paidMinor: 400, status: 'partial' },
    { currency: 'USD', totalPayableMinor: 2000, paidMinor: 2000, status: 'paid' },
    { currency: 'USD', totalPayableMinor: 500, paidMinor: 0, status: 'overdue' },
    { currency: 'INR', totalPayableMinor: 100000, paidMinor: 120000, status: 'paid' },
    { currency: 'USD', totalPayableMinor: 999, paidMinor: 0, status: 'void' },
  ]);
  assert.strictEqual(byCurrency.USD.billedMinor, 3500);
  assert.strictEqual(byCurrency.USD.paidMinor, 2400);
  assert.strictEqual(byCurrency.USD.outstandingMinor, 1100);
  assert.strictEqual(byCurrency.USD.overdueCount, 1);
  assert.strictEqual(byCurrency.USD.invoiceCount, 3); // void excluded
  assert.strictEqual(byCurrency.INR.advanceMinor, 20000);
  assert.strictEqual(byCurrency.INR.outstandingMinor, 0);
});

console.log(`\nRESULT: ${passed} passed, ${failed} failed (of ${passed + failed} total)\n`);
process.exit(failed ? 1 : 0);
