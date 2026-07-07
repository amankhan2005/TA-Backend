const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { requireActiveSchool } = require('../middleware/subscription');
const { requireFeature } = require('../middleware/planFeature');
const c = require('../controllers/feeController');

// Fee Management is a paid capability → gate on the plan feature flag.
const guard = [protect('schoolAdmin'), requireActiveSchool, requireFeature('feeManagement')];

// ── Fee structures ───────────────────────────────────────────────────────────
router.post('/structures', ...guard, [
  body('name').isString().trim().notEmpty(),
  body('currency').isString(),
  body('lineItems').isArray({ min: 1 }),
], validate, c.createFeeStructure);
router.get('/structures', ...guard, c.listFeeStructures);
router.get('/structures/:id', ...guard, c.getFeeStructure);
router.patch('/structures/:id', ...guard, c.updateFeeStructure);
router.delete('/structures/:id', ...guard, c.deleteFeeStructure);

// ── Invoices ─────────────────────────────────────────────────────────────────
router.post('/invoices', ...guard, [
  body('studentId').isString().notEmpty(),
  body('dueDate').notEmpty(),
], validate, c.createInvoice);
router.post('/invoices/bulk', ...guard, [
  body('feeStructureId').isString().notEmpty(),
  body('dueDate').notEmpty(),
], validate, c.bulkGenerateInvoices);
router.get('/invoices', ...guard, c.listInvoices);
router.get('/invoices/:id', ...guard, c.getInvoice);
router.patch('/invoices/:id/void', ...guard, c.voidInvoice);

// ── Payments ─────────────────────────────────────────────────────────────────
router.post('/payments', ...guard, [
  body('invoiceId').isString().notEmpty(),
], validate, c.recordPayment);
router.get('/payments', ...guard, c.listPayments);
router.get('/payments/:id', ...guard, c.getPayment);
router.get('/payments/:id/receipt', ...guard, c.getReceipt);
router.patch('/payments/:id/void', ...guard, c.voidPayment);

// ── Statements ───────────────────────────────────────────────────────────────
router.post('/statements/generate', ...guard, [
  body('studentId').isString().notEmpty(),
  body('year').notEmpty(),
  body('month').notEmpty(),
], validate, c.generateStatement);
router.get('/statements', ...guard, c.listStatements);

// ── Student fee profile ──────────────────────────────────────────────────────
router.get('/students/:studentId/profile', ...guard, c.getStudentFeeProfile);

// ── Reports (reusable aggregations for Phase 6 dashboards) ────────────────────
router.get('/reports/collections', ...guard, c.getCollectionReport); // ?from=&to=
router.get('/reports/outstanding', ...guard, c.getOutstandingReport); // ?asOf=

// ── Fee defaulters (item 9) — per-student outstanding, scope-filtered, exportable
router.get('/defaulters', ...guard, c.getFeeDefaulters); // ?session=&class=&section=&format=xlsx|csv&page=&limit=

module.exports = router;
