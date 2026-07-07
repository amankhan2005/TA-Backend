/**
 * feeService.js — Phase 5 orchestration. Wires the PURE engines (money,
 * feeCalculation, invoiceStatus, balanceEngine) to the models + PDF + storage +
 * notification infrastructure. All money stays integer minor units; no float math
 * happens here — arithmetic is delegated to the tested engines.
 */

const Counter = require('../models/Counter');
const StudentInvoice = require('../models/StudentInvoice');
const FeePayment = require('../models/FeePayment');
const FeeStatement = require('../models/FeeStatement');
const School = require('../models/School');
const Student = require('../models/Student');

const { requireCurrency, clampNonNeg, formatMinor } = require('./money');
const { computeInvoiceAmounts } = require('./feeCalculation');
const { computeInvoiceStatus } = require('./invoiceStatus');
const { applyPaymentToInvoice } = require('./balanceEngine');
const { renderReceiptPDF, renderFeeStatementPDF } = require('./pdf');
const { uploadFeePdf } = require('./reportStorage');
const { assertStorageAvailable, recordUpload } = require('./storageService');
const { notifyStudentEvent } = require('./notificationService');

function shortSchool(schoolId) { return schoolId.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase(); }

async function nextInvoiceNumber(schoolId) {
  const year = new Date().getFullYear();
  const seq = await Counter.next(`${schoolId}:invoice:${year}`);
  return `INV-${shortSchool(schoolId)}-${year}-${String(seq).padStart(4, '0')}`;
}
async function nextReceiptNumber(schoolId) {
  const year = new Date().getFullYear();
  const seq = await Counter.next(`${schoolId}:receipt:${year}`);
  return `RCP-${shortSchool(schoolId)}-${year}-${String(seq).padStart(4, '0')}`;
}

// ── Invoice generation ───────────────────────────────────────────────────────
/**
 * @param {Object} p
 * @param {Object} p.student  a Student doc (needs _id, studentId)
 * @param {Object} [p.feeStructure]  a FeeStructure doc (source of currency/items/discounts)
 * @param {string} [p.currency] / {Array} [p.lineItems] / {Array} [p.discounts]  ad-hoc override
 */
async function generateInvoiceForStudent(p) {
  const { schoolId, student, feeStructure, periodLabel, issueDate, dueDate, createdBy } = p;
  const currency = (p.currency || feeStructure?.currency);
  requireCurrency(currency);
  const lineItems = p.lineItems || feeStructure?.lineItems?.map((li) => ({ description: li.description, amountMinor: li.amountMinor, quantity: li.quantity })) || [];
  const discounts = p.discounts || feeStructure?.discounts || [];

  const amounts = computeInvoiceAmounts({ currency, lineItems, discounts });
  const due = dueDate ? new Date(dueDate) : new Date();
  const statusInfo = computeInvoiceStatus({ totalPayableMinor: amounts.totalPayableMinor, paidMinor: 0, dueDate: due });

  const invoice = await StudentInvoice.create({
    schoolId,
    student: student._id,
    studentIdRef: student.studentId,
    feeStructure: feeStructure?._id || null,
    invoiceNumber: await nextInvoiceNumber(schoolId),
    currency,
    lineItems: amounts.lineItems,
    subtotalMinor: amounts.subtotalMinor,
    discountMinor: amounts.discountMinor,
    totalPayableMinor: amounts.totalPayableMinor,
    paidMinor: 0,
    status: statusInfo.status,
    classSnapshot: student.class?._id || student.class || null,
    sectionSnapshot: student.section?._id || student.section || null,
    sessionSnapshot: student.session?._id || student.session || null,
    periodLabel: periodLabel || null,
    issueDate: issueDate ? new Date(issueDate) : new Date(),
    dueDate: due,
    createdBy: createdBy || null,
  });
  return invoice;
}

// ── Payment recording ────────────────────────────────────────────────────────
async function recordPayment(p) {
  const { schoolId, invoice, amountMinor, method, reference, paidAt, recordedBy, notes } = p;
  if (invoice.status === 'void') throw Object.assign(new Error('Cannot record a payment against a void invoice.'), { code: 'INVOICE_VOID' });
  requireCurrency(invoice.currency);

  const split = applyPaymentToInvoice(
    { totalPayableMinor: invoice.totalPayableMinor, paidMinor: invoice.paidMinor },
    amountMinor
  );

  const payment = await FeePayment.create({
    schoolId,
    invoice: invoice._id,
    student: invoice.student,
    studentIdRef: invoice.studentIdRef,
    receiptNumber: await nextReceiptNumber(schoolId),
    currency: invoice.currency,
    amountMinor,
    appliedMinor: split.appliedMinor,
    overpayMinor: split.overpayMinor,
    method: method || 'cash',
    reference: reference || null,
    paidAt: paidAt ? new Date(paidAt) : new Date(),
    status: 'recorded',
    // Inherit the invoice's placement snapshot so collection-by-class stays
    // historically accurate after promotion (null on old invoices → fallback).
    classSnapshot: invoice.classSnapshot || null,
    sectionSnapshot: invoice.sectionSnapshot || null,
    sessionSnapshot: invoice.sessionSnapshot || null,
    notes: notes || null,
    recordedBy: recordedBy || null,
  });

  invoice.paidMinor = split.newPaidMinor;
  invoice.overpaidMinor = clampNonNeg(split.newPaidMinor - invoice.totalPayableMinor);
  invoice.status = computeInvoiceStatus({ totalPayableMinor: invoice.totalPayableMinor, paidMinor: invoice.paidMinor, dueDate: invoice.dueDate }).status;
  await invoice.save();

  return { payment, invoice };
}

// Recompute an invoice's paid/status from its non-void payments (after a void).
async function recomputeInvoicePaid(invoice) {
  const agg = await FeePayment.aggregate([
    { $match: { invoice: invoice._id, status: 'recorded' } },
    { $group: { _id: null, paid: { $sum: '$amountMinor' } } },
  ]);
  const paidMinor = agg[0]?.paid || 0;
  invoice.paidMinor = paidMinor;
  invoice.overpaidMinor = clampNonNeg(paidMinor - invoice.totalPayableMinor);
  invoice.status = computeInvoiceStatus({ totalPayableMinor: invoice.totalPayableMinor, paidMinor, dueDate: invoice.dueDate }).status;
  await invoice.save();
  return invoice;
}

async function voidPayment({ payment, invoice, reason }) {
  if (payment.status === 'void') throw Object.assign(new Error('Payment is already void.'), { code: 'ALREADY_VOID' });
  payment.status = 'void';
  payment.voidReason = reason || null;
  payment.voidedAt = new Date();
  await payment.save();
  await recomputeInvoicePaid(invoice);
  return { payment, invoice };
}

// ── Receipt PDF (on-demand, cached) ──────────────────────────────────────────
async function generateReceiptPdf({ schoolId, payment }) {
  if (payment.receiptUrl) return { url: payment.receiptUrl, cached: true };

  const [school, invoice, student] = await Promise.all([
    School.findOne({ schoolId }).populate('subscriptionPlan'),
    StudentInvoice.findById(payment.invoice),
    Student.findById(payment.student).populate('class', 'name').populate('section', 'name'),
  ]);
  const storageLimitMB = school?.subscriptionPlan?.storageLimitMB ?? null;

  const buffer = await renderReceiptPDF({
    school: { name: school?.name, logoUrl: school?.logoUrl },
    student: { name: student?.name, studentId: student?.studentId, className: student?.class?.name, sectionName: student?.section?.name },
    payment, invoice,
  });

  await assertStorageAvailable(schoolId, buffer.length, storageLimitMB);
  const up = await uploadFeePdf(buffer, { schoolId, filename: `receipt_${payment.receiptNumber}` });
  await recordUpload(schoolId, buffer.length, 'feeReports');

  payment.receiptUrl = up.url;
  payment.receiptPublicId = up.publicId;
  payment.sizeBytes = buffer.length;
  await payment.save();
  return { url: up.url, cached: false };
}

// ── Monthly statement (generate + deliver) ───────────────────────────────────
function monthBounds(year, month /* 1-12 */) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0)); // last day of month
  const iso = (d) => d.toISOString().slice(0, 10);
  return { start, end, startStr: iso(start), endStr: iso(end), label: start.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }) + ' ' + year };
}

async function generateStudentStatement({ schoolId, student, year, month, currency, createdBy }) {
  requireCurrency(currency);
  const { start, end, startStr, endStr, label } = monthBounds(year, month);

  const allInvoices = await StudentInvoice.find({ schoolId, student: student._id, currency, status: { $ne: 'void' } }).lean();
  const allPayments = await FeePayment.find({ schoolId, student: student._id, currency, status: 'recorded' }).lean();

  const inPeriod = (d) => { const t = new Date(d).getTime(); return t >= start.getTime() && t <= end.getTime() + 86399999; };
  const before = (d) => new Date(d).getTime() < start.getTime();

  const billedPrior = allInvoices.filter((i) => before(i.issueDate)).reduce((s, i) => s + i.totalPayableMinor, 0);
  const paidPrior = allPayments.filter((p) => before(p.paidAt)).reduce((s, p) => s + p.amountMinor, 0);
  const openingBalanceMinor = billedPrior - paidPrior;

  const invoicesInPeriod = allInvoices.filter((i) => inPeriod(i.issueDate));
  const paymentsInPeriod = allPayments.filter((p) => inPeriod(p.paidAt));
  const billedMinor = invoicesInPeriod.reduce((s, i) => s + i.totalPayableMinor, 0);
  const paidMinor = paymentsInPeriod.reduce((s, p) => s + p.amountMinor, 0);
  const closingBalanceMinor = openingBalanceMinor + billedMinor - paidMinor;

  const summary = { openingBalanceMinor, billedMinor, paidMinor, closingBalanceMinor };

  const [school, studentFull] = await Promise.all([
    School.findOne({ schoolId }).populate('subscriptionPlan'),
    Student.findById(student._id).populate('class', 'name').populate('section', 'name'),
  ]);
  const storageLimitMB = school?.subscriptionPlan?.storageLimitMB ?? null;

  const buffer = await renderFeeStatementPDF({
    school: { name: school?.name, logoUrl: school?.logoUrl },
    student: { name: studentFull?.name, studentId: studentFull?.studentId, className: studentFull?.class?.name, sectionName: studentFull?.section?.name },
    periodLabel: label, currency, invoices: invoicesInPeriod, payments: paymentsInPeriod, summary,
  });

  await assertStorageAvailable(schoolId, buffer.length, storageLimitMB);
  const up = await uploadFeePdf(buffer, { schoolId, filename: `statement_${student.studentId}_${year}_${String(month).padStart(2, '0')}` });
  await recordUpload(schoolId, buffer.length, 'feeReports');

  const statement = await FeeStatement.create({
    schoolId, student: student._id, studentIdRef: student.studentId,
    periodLabel: label, periodStart: startStr, periodEnd: endStr, currency,
    openingBalanceMinor, billedMinor, paidMinor, closingBalanceMinor,
    pdfUrl: up.url, pdfPublicId: up.publicId, sizeBytes: buffer.length, status: 'generated',
  });

  // Delivery reuses the tracked + retryable notification pipeline (F-4). Non-fatal
  // enqueue (F-6): the statement PDF is already saved & downloadable regardless.
  let deliveryQueued = false;
  try {
    await notifyStudentEvent({
      schoolId, studentId: student._id.toString(), type: 'report_ready',
      data: { schoolName: school?.name, schoolLogoUrl: school?.logoUrl, studentName: studentFull?.name, reportLabel: `Fee Statement — ${label}`, downloadUrl: up.url },
    });
    deliveryQueued = true;
  } catch (e) {
    console.error('[feeService] statement delivery enqueue failed:', e.message);
  }

  return { statement, deliveryQueued };
}

module.exports = {
  nextInvoiceNumber, nextReceiptNumber,
  generateInvoiceForStudent, recordPayment, voidPayment, recomputeInvoicePaid,
  generateReceiptPdf, generateStudentStatement, monthBounds,
};
