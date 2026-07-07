const mongoose = require('mongoose');

/**
 * ImportExportJob — tracks bulk Excel import/export operations
 * (student roster, fee data, RFID mapping — any future bulk operation).
 *
 * Design decision: large imports (e.g. a few thousand students) run in the
 * background worker (worker.js, ERP Phase 0 infra), not inline in the HTTP
 * request — an Excel file with thousands of rows should never risk an HTTP
 * timeout. This collection is the status/progress record the API polls or
 * the admin UI subscribes to, and it is where per-row validation errors are
 * reported back (row-level errors, not a single opaque failure).
 *
 * Introduced in Phase 0 as shared infrastructure; actual import/export
 * logic per module (students in Phase 2, fees in Phase 5, RFID mapping in
 * Phase 3) is implemented when each of those modules is built.
 */

const rowErrorSchema = new mongoose.Schema(
  {
    row: { type: Number, required: true },
    message: { type: String, required: true },
  },
  { _id: false }
);

const importExportJobSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, index: true },

    direction: { type: String, enum: ['import', 'export'], required: true },
    entity: {
      type: String,
      required: true,
      enum: ['students', 'fees', 'rfidMapping', 'attendance'],
    },

    status: {
      type: String,
      enum: ['queued', 'processing', 'completed', 'completed_with_errors', 'failed'],
      default: 'queued',
    },

    // Source file (import) or generated result file (export) — Cloudinary
    // asset, consistent with how every other file in this codebase is stored.
    sourceFileUrl: { type: String, default: null },
    resultFileUrl: { type: String, default: null },

    totalRows: { type: Number, default: 0 },
    processedRows: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    errorCount: { type: Number, default: 0 },
    rowErrors: { type: [rowErrorSchema], default: [] },

    requestedBy: { type: String, required: true }, // schoolAdmin email
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

importExportJobSchema.index({ schoolId: 1, createdAt: -1 });
importExportJobSchema.index({ status: 1 });

module.exports = mongoose.model('ImportExportJob', importExportJobSchema);
