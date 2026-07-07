/**
 * feeController.js — Phase 5 HTTP layer. Thin: validation + tenant scoping +
 * audit; all money math is delegated to feeService / the pure engines. Amounts in
 * request bodies may be given as human major units ("100.50") or explicit
 * integer `*Minor`; both normalize to integer minor units before storage.
 */

const FeeStructure = require('../models/FeeStructure');
const StudentInvoice = require('../models/StudentInvoice');
const FeePayment = require('../models/FeePayment');
const FeeStatement = require('../models/FeeStatement');
const Student = require('../models/Student');

const money = require('../utils/money');
const feeService = require('../utils/feeService');
const feeAgg = require('../utils/feeAggregation');
const { computeStudentBalance } = require('../utils/balanceEngine');
const { logEvent } = require('../utils/audit');
const { getPagination, buildPaginatedResponse } = require('../utils/pagination');

const bad = (res, msg) => res.status(400).json({ success: false, message: msg });
const oops = (res, err) => res.status(500).json({ success: false, message: err.message });

function normalizeLineItems(items, currency) {
  if (!Array.isArray(items) || !items.length) throw new Error('At least one line item is required.');
  return items.map((li) => {
    const amountMinor = li.amountMinor != null ? money.assertMinor(Number(li.amountMinor)) : money.parseMoneyToMinor(li.amount, currency);
    return { description: li.description, amountMinor, quantity: li.quantity != null ? Number(li.quantity) : 1 };
  });
}
function normalizeDiscounts(discounts, currency) {
  if (!discounts) return [];
  return discounts.map((d) => ({
    type: d.type,
    value: d.type === 'fixed' ? (d.valueMinor != null ? money.assertMinor(Number(d.valueMinor)) : money.parseMoneyToMinor(d.value, currency)) : Number(d.value),
    description: d.description,
  }));
}
// Attach human-readable formatted amounts to an invoice/payment for API responses.
function withDisplay(doc, currency) {
  const o = doc.toObject ? doc.toObject() : doc;
  const fmt = (m) => money.formatMinor(m, currency, { withCode: true });
  if (o.totalPayableMinor != null) { o.totalPayableDisplay = fmt(o.totalPayableMinor); o.paidDisplay = fmt(o.paidMinor || 0); o.balanceDisplay = fmt(Math.max(0, o.totalPayableMinor - (o.paidMinor || 0))); }
  if (o.amountMinor != null) o.amountDisplay = fmt(o.amountMinor);
  return o;
}

// ═══════════════════════ FEE STRUCTURES ═════════════════════════════════════

exports.createFeeStructure = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { name, description, currency, frequency, lineItems, discounts, appliesTo } = req.body;
    if (!money.isSupportedCurrency(currency)) return bad(res, `Unsupported currency. Use one of ${Object.keys(money.CURRENCIES).join(', ')}.`);
    const structure = await FeeStructure.create({
      schoolId, name, description, currency, frequency,
      lineItems: normalizeLineItems(lineItems, currency),
      discounts: normalizeDiscounts(discounts, currency),
      appliesTo: appliesTo || {}, createdBy: req.user.userId,
    });
    await logEvent(req, 'feeStructure.created', { targetType: 'FeeStructure', targetId: structure._id, targetName: name });
    res.status(201).json({ success: true, structure });
  } catch (err) { return bad(res, err.message); }
};

exports.listFeeStructures = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const filter = { schoolId };
    if (req.query.active != null) filter.isActive = req.query.active === 'true';
    const structures = await FeeStructure.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, structures });
  } catch (err) { return oops(res, err); }
};

exports.getFeeStructure = async (req, res) => {
  try {
    const structure = await FeeStructure.findOne({ _id: req.params.id, schoolId: req.user.schoolId });
    if (!structure) return res.status(404).json({ success: false, message: 'Fee structure not found.' });
    res.json({ success: true, structure });
  } catch (err) { return oops(res, err); }
};

exports.updateFeeStructure = async (req, res) => {
  try {
    const structure = await FeeStructure.findOne({ _id: req.params.id, schoolId: req.user.schoolId });
    if (!structure) return res.status(404).json({ success: false, message: 'Fee structure not found.' });
    const currency = req.body.currency || structure.currency;
    const up = req.body;
    ['name', 'description', 'frequency', 'isActive', 'appliesTo'].forEach((k) => { if (up[k] !== undefined) structure[k] = up[k]; });
    if (up.currency && money.isSupportedCurrency(up.currency)) structure.currency = up.currency;
    if (up.lineItems) structure.lineItems = normalizeLineItems(up.lineItems, currency);
    if (up.discounts) structure.discounts = normalizeDiscounts(up.discounts, currency);
    await structure.save();
    await logEvent(req, 'feeStructure.updated', { targetType: 'FeeStructure', targetId: structure._id, targetName: structure.name });
    res.json({ success: true, structure });
  } catch (err) { return bad(res, err.message); }
};

exports.deleteFeeStructure = async (req, res) => {
  try {
    const structure = await FeeStructure.findOneAndUpdate({ _id: req.params.id, schoolId: req.user.schoolId }, { isActive: false }, { new: true });
    if (!structure) return res.status(404).json({ success: false, message: 'Fee structure not found.' });
    await logEvent(req, 'feeStructure.deleted', { targetType: 'FeeStructure', targetId: structure._id, targetName: structure.name });
    res.json({ success: true, message: 'Fee structure deactivated.' });
  } catch (err) { return oops(res, err); }
};

// ═══════════════════════ INVOICES ═══════════════════════════════════════════

exports.createInvoice = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { studentId, feeStructureId, currency, lineItems, discounts, periodLabel, issueDate, dueDate } = req.body;
    if (!dueDate) return bad(res, 'dueDate is required.');
    const student = await Student.findOne({ _id: studentId, schoolId });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });

    let feeStructure = null;
    if (feeStructureId) {
      feeStructure = await FeeStructure.findOne({ _id: feeStructureId, schoolId });
      if (!feeStructure) return res.status(404).json({ success: false, message: 'Fee structure not found.' });
    }
    const cur = currency || feeStructure?.currency;
    const invoice = await feeService.generateInvoiceForStudent({
      schoolId, student, feeStructure,
      currency: cur,
      lineItems: lineItems ? normalizeLineItems(lineItems, cur) : undefined,
      discounts: discounts ? normalizeDiscounts(discounts, cur) : undefined,
      periodLabel, issueDate, dueDate, createdBy: req.user.userId,
    });
    await logEvent(req, 'invoice.generated', { targetType: 'StudentInvoice', targetId: invoice._id, targetName: invoice.invoiceNumber });
    res.status(201).json({ success: true, invoice: withDisplay(invoice, invoice.currency) });
  } catch (err) { return bad(res, err.message); }
};

exports.bulkGenerateInvoices = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { feeStructureId, periodLabel, dueDate, classId, sectionId, sessionId } = req.body;
    if (!dueDate) return bad(res, 'dueDate is required.');
    const feeStructure = await FeeStructure.findOne({ _id: feeStructureId, schoolId });
    if (!feeStructure) return res.status(404).json({ success: false, message: 'Fee structure not found.' });

    const scope = { schoolId, status: 'active' };
    const cls = classId || feeStructure.appliesTo?.class;
    const sec = sectionId || feeStructure.appliesTo?.section;
    const ses = sessionId || feeStructure.appliesTo?.session;
    if (cls) scope.class = cls;
    if (sec) scope.section = sec;
    if (ses) scope.session = ses;

    const students = await Student.find(scope);
    let generated = 0, failed = 0;
    const invoices = [];
    for (const student of students) {
      try {
        const inv = await feeService.generateInvoiceForStudent({ schoolId, student, feeStructure, periodLabel, dueDate, createdBy: req.user.userId });
        invoices.push(inv.invoiceNumber); generated += 1;
      } catch (e) { failed += 1; console.error('[fee.bulk] student', student.studentId, e.message); }
    }
    await logEvent(req, 'invoice.bulkGenerated', { targetType: 'FeeStructure', targetId: feeStructure._id, targetName: feeStructure.name, metadata: { generated, failed, total: students.length } });
    res.status(201).json({ success: true, total: students.length, generated, failed, invoices });
  } catch (err) { return bad(res, err.message); }
};

exports.listInvoices = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { page, limit, skip } = getPagination(req.query);
    const filter = { schoolId };
    if (req.query.student) filter.student = req.query.student;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.currency) filter.currency = req.query.currency;
    const [items, total] = await Promise.all([
      StudentInvoice.find(filter).sort({ dueDate: -1 }).skip(skip).limit(limit),
      StudentInvoice.countDocuments(filter),
    ]);
    res.json(buildPaginatedResponse(items.map((i) => withDisplay(i, i.currency)), total, page, limit));
  } catch (err) { return oops(res, err); }
};

exports.getInvoice = async (req, res) => {
  try {
    const invoice = await StudentInvoice.findOne({ _id: req.params.id, schoolId: req.user.schoolId });
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });
    const payments = await FeePayment.find({ invoice: invoice._id, schoolId: req.user.schoolId }).sort({ paidAt: -1 });
    res.json({ success: true, invoice: withDisplay(invoice, invoice.currency), payments: payments.map((p) => withDisplay(p, p.currency)) });
  } catch (err) { return oops(res, err); }
};

exports.voidInvoice = async (req, res) => {
  try {
    const invoice = await StudentInvoice.findOne({ _id: req.params.id, schoolId: req.user.schoolId });
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });
    if (invoice.paidMinor > 0) return bad(res, 'Cannot void an invoice that has payments. Void the payments first.');
    invoice.status = 'void';
    await invoice.save();
    await logEvent(req, 'invoice.voided', { targetType: 'StudentInvoice', targetId: invoice._id, targetName: invoice.invoiceNumber });
    res.json({ success: true, message: 'Invoice voided.', invoice: withDisplay(invoice, invoice.currency) });
  } catch (err) { return oops(res, err); }
};

// ═══════════════════════ PAYMENTS ═══════════════════════════════════════════

exports.recordPayment = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { invoiceId, amount, amountMinor, method, reference, paidAt, notes } = req.body;
    const invoice = await StudentInvoice.findOne({ _id: invoiceId, schoolId });
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });

    let minor;
    try { minor = amountMinor != null ? money.assertMinor(Number(amountMinor)) : money.parseMoneyToMinor(amount, invoice.currency); }
    catch (e) { return bad(res, e.message); }
    if (minor <= 0) return bad(res, 'Payment amount must be greater than zero.');

    const { payment, invoice: updated } = await feeService.recordPayment({
      schoolId, invoice, amountMinor: minor, method, reference, paidAt, notes, recordedBy: req.user.userId,
    });
    await logEvent(req, 'payment.recorded', { targetType: 'FeePayment', targetId: payment._id, targetName: payment.receiptNumber, metadata: { invoice: invoice.invoiceNumber, amountMinor: minor, currency: invoice.currency } });
    res.status(201).json({ success: true, payment: withDisplay(payment, payment.currency), invoice: withDisplay(updated, updated.currency) });
  } catch (err) { return err.code === 'INVOICE_VOID' ? bad(res, err.message) : oops(res, err); }
};

exports.listPayments = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { page, limit, skip } = getPagination(req.query);
    const filter = { schoolId };
    if (req.query.student) filter.student = req.query.student;
    if (req.query.invoice) filter.invoice = req.query.invoice;
    if (req.query.status) filter.status = req.query.status;
    const [items, total] = await Promise.all([
      FeePayment.find(filter).sort({ paidAt: -1 }).skip(skip).limit(limit),
      FeePayment.countDocuments(filter),
    ]);
    res.json(buildPaginatedResponse(items.map((p) => withDisplay(p, p.currency)), total, page, limit));
  } catch (err) { return oops(res, err); }
};

exports.getPayment = async (req, res) => {
  try {
    const payment = await FeePayment.findOne({ _id: req.params.id, schoolId: req.user.schoolId });
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found.' });
    res.json({ success: true, payment: withDisplay(payment, payment.currency) });
  } catch (err) { return oops(res, err); }
};

exports.voidPayment = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const payment = await FeePayment.findOne({ _id: req.params.id, schoolId });
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found.' });
    const invoice = await StudentInvoice.findById(payment.invoice);
    const { invoice: updated } = await feeService.voidPayment({ payment, invoice, reason: req.body.reason });
    await logEvent(req, 'payment.voided', { targetType: 'FeePayment', targetId: payment._id, targetName: payment.receiptNumber, metadata: { reason: req.body.reason } });
    res.json({ success: true, message: 'Payment voided.', payment: withDisplay(payment, payment.currency), invoice: updated ? withDisplay(updated, updated.currency) : null });
  } catch (err) { return err.code === 'ALREADY_VOID' ? bad(res, err.message) : oops(res, err); }
};

exports.getReceipt = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const payment = await FeePayment.findOne({ _id: req.params.id, schoolId });
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found.' });
    if (payment.status === 'void') return bad(res, 'Cannot generate a receipt for a void payment.');
    const { url, cached } = await feeService.generateReceiptPdf({ schoolId, payment });
    res.json({ success: true, receiptUrl: url, cached });
  } catch (err) { return err.code === 'STORAGE_LIMIT' ? res.status(507).json({ success: false, message: err.message }) : oops(res, err); }
};

// ═══════════════════════ STATEMENTS ═════════════════════════════════════════

exports.generateStatement = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { studentId, year, month, currency } = req.body;
    if (!year || !month) return bad(res, 'year and month are required.');
    const student = await Student.findOne({ _id: studentId, schoolId });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });

    // Default currency = the student's most-used invoice currency.
    let cur = currency;
    if (!cur) {
      const anyInv = await StudentInvoice.findOne({ schoolId, student: student._id }).sort({ createdAt: -1 });
      cur = anyInv?.currency;
      if (!cur) return bad(res, 'No invoices found for this student; specify a currency.');
    }
    const { statement, deliveryQueued } = await feeService.generateStudentStatement({ schoolId, student, year: Number(year), month: Number(month), currency: cur, createdBy: req.user.userId });
    await logEvent(req, 'statement.generated', { targetType: 'FeeStatement', targetId: statement._id, targetName: statement.periodLabel, metadata: { student: student.studentId, currency: cur } });
    res.status(201).json({ success: true, statement, deliveryQueued });
  } catch (err) { return err.code === 'STORAGE_LIMIT' ? res.status(507).json({ success: false, message: err.message }) : bad(res, err.message); }
};

exports.listStatements = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const filter = { schoolId };
    if (req.query.student) filter.student = req.query.student;
    const statements = await FeeStatement.find(filter).sort({ generatedAt: -1 }).limit(100);
    res.json({ success: true, statements });
  } catch (err) { return oops(res, err); }
};

// ═══════════════════════ STUDENT FEE PROFILE ════════════════════════════════

exports.getStudentFeeProfile = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const student = await Student.findOne({ _id: req.params.studentId, schoolId });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });
    const [invoices, payments] = await Promise.all([
      StudentInvoice.find({ schoolId, student: student._id }).sort({ dueDate: -1 }),
      FeePayment.find({ schoolId, student: student._id, status: 'recorded' }).sort({ paidAt: -1 }).limit(50),
    ]);
    const balance = computeStudentBalance(invoices.map((i) => ({ currency: i.currency, totalPayableMinor: i.totalPayableMinor, paidMinor: i.paidMinor, status: i.status })));
    // Add display strings per currency.
    for (const cur of Object.keys(balance.byCurrency)) {
      const b = balance.byCurrency[cur];
      b.outstandingDisplay = money.formatMinor(b.outstandingMinor, cur, { withCode: true });
      b.advanceDisplay = money.formatMinor(b.advanceMinor, cur, { withCode: true });
    }
    res.json({
      success: true,
      student: { id: student._id, studentId: student.studentId, name: student.name },
      balance: balance.byCurrency,
      invoices: invoices.map((i) => withDisplay(i, i.currency)),
      payments: payments.map((p) => withDisplay(p, p.currency)),
    });
  } catch (err) { return oops(res, err); }
};

// ═══════════════════════ REPORTS ════════════════════════════════════════════

exports.getCollectionReport = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { from, to } = req.query;
    const summary = await feeAgg.collectionSummary({ schoolId, from, to });
    for (const cur of Object.keys(summary.byCurrency)) summary.byCurrency[cur].totalDisplay = money.formatMinor(summary.byCurrency[cur].totalMinor, cur, { withCode: true });
    res.json({ success: true, from: from || null, to: to || null, ...summary });
  } catch (err) { return oops(res, err); }
};

exports.getOutstandingReport = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const summary = await feeAgg.outstandingSummary({ schoolId, asOf: req.query.asOf });
    for (const cur of Object.keys(summary.byCurrency)) {
      summary.byCurrency[cur].outstandingDisplay = money.formatMinor(summary.byCurrency[cur].outstandingMinor, cur, { withCode: true });
      summary.byCurrency[cur].overdueDisplay = money.formatMinor(summary.byCurrency[cur].overdueMinor, cur, { withCode: true });
    }
    res.json({ success: true, ...summary });
  } catch (err) { return oops(res, err); }
};

// ═══════════════════════ FEE DEFAULTERS (item 9) ════════════════════════════
const mongoose = require('mongoose');
const { sendTabular } = require('../utils/exportService');

/**
 * GET /api/fees/defaulters
 *   ?session=&class=&section=   (scope filters; snapshot-aware with student fallback)
 *   ?format=xlsx|csv            (omit for paginated JSON, provide for a download)
 *   ?page=&limit=               (JSON mode)
 *
 * One row per student per currency with a positive outstanding balance
 * (totalPayable − paid across non-void invoices). Multi-currency safe: a student
 * owing in two currencies yields two rows. Last Payment Date is the most recent
 * non-void FeePayment for that student. Mirrors the effective-placement pattern
 * used by feeAnalyticsService (snapshot ?? current student placement).
 */
exports.getFeeDefaulters = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const { session, class: klass, section, format } = req.query;

    const oid = (v) => {
      if (!v || !mongoose.isValidObjectId(v)) return null;
      return new mongoose.Types.ObjectId(v);
    };

    const pipeline = [
      { $match: { schoolId, status: { $ne: 'void' } } },
      { $lookup: { from: 'students', localField: 'student', foreignField: '_id', as: 'st' } },
      { $unwind: '$st' },
      { $addFields: {
        effSession: { $ifNull: ['$sessionSnapshot', '$st.session'] },
        effClass: { $ifNull: ['$classSnapshot', '$st.class'] },
        effSection: { $ifNull: ['$sectionSnapshot', '$st.section'] },
      } },
    ];

    const scopeMatch = {};
    if (oid(session)) scopeMatch.effSession = oid(session);
    if (oid(klass)) scopeMatch.effClass = oid(klass);
    if (oid(section)) scopeMatch.effSection = oid(section);
    if (Object.keys(scopeMatch).length) pipeline.push({ $match: scopeMatch });

    pipeline.push(
      { $group: {
        _id: { student: '$student', currency: '$currency' },
        totalMinor: { $sum: '$totalPayableMinor' },
        paidMinor: { $sum: '$paidMinor' },
        name: { $first: '$st.name' },
        admissionNumber: { $first: '$st.admissionNumber' },
        studentId: { $first: '$st.studentId' },
        classId: { $first: '$effClass' },
        sectionId: { $first: '$effSection' },
      } },
      { $addFields: { pendingMinor: { $subtract: ['$totalMinor', '$paidMinor'] } } },
      { $match: { pendingMinor: { $gt: 0 } } },
      { $lookup: { from: 'schoolclasses', localField: 'classId', foreignField: '_id', as: 'cls' } },
      { $lookup: { from: 'sections', localField: 'sectionId', foreignField: '_id', as: 'sec' } },
      { $sort: { pendingMinor: -1 } },
    );

    const [agg, lastPayments] = await Promise.all([
      StudentInvoice.aggregate(pipeline),
      FeePayment.aggregate([
        { $match: { schoolId, status: 'recorded' } },
        { $group: { _id: '$student', lastPaidAt: { $max: '$paidAt' } } },
      ]),
    ]);

    const lastByStudent = new Map(lastPayments.map((p) => [String(p._id), p.lastPaidAt]));

    const rows = agg.map((r) => {
      const cur = r._id.currency;
      const lastPaid = lastByStudent.get(String(r._id.student)) || null;
      return {
        student: r.name,
        studentName: r.name,
        admissionNumber: r.admissionNumber || '',
        class: r.cls?.[0]?.name || '',
        section: r.sec?.[0]?.name || '',
        currency: cur,
        totalMinor: r.totalMinor,
        paidMinor: r.paidMinor,
        pendingMinor: r.pendingMinor,
        totalFee: money.formatMinor(r.totalMinor, cur, { withCode: true }),
        paid: money.formatMinor(r.paidMinor, cur, { withCode: true }),
        pending: money.formatMinor(r.pendingMinor, cur, { withCode: true }),
        lastPaymentDate: lastPaid ? new Date(lastPaid).toISOString().slice(0, 10) : '',
      };
    });

    if (format === 'xlsx' || format === 'csv') {
      const columns = [
        { key: 'studentName', header: 'Student', width: 22 },
        { key: 'admissionNumber', header: 'Admission Number', width: 18 },
        { key: 'class', header: 'Class', width: 12 },
        { key: 'section', header: 'Section', width: 10 },
        { key: 'totalFee', header: 'Total Fee', width: 16 },
        { key: 'paid', header: 'Paid', width: 16 },
        { key: 'pending', header: 'Pending', width: 16 },
        { key: 'lastPaymentDate', header: 'Last Payment Date', width: 16 },
      ];
      return sendTabular(res, format, {
        filename: 'fee-defaulters',
        sheetName: 'Fee Defaulters',
        title: 'Fee Defaulters',
        columns, rows,
      });
    }

    const { page, limit, skip } = getPagination(req.query);
    const pageRows = rows.slice(skip, skip + limit);
    return res.json({ ...buildPaginatedResponse(pageRows, rows.length, page, limit) });
  } catch (err) { return oops(res, err); }
};
