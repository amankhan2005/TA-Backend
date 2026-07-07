const mongoose = require('mongoose');

/**
 * SchoolStorage — one running counter document per school, tracking cumulative
 * bytes of generated assets against the plan's `storageLimitMB`. A running
 * counter (atomic `$inc`) is used instead of summing sizes on every check, so
 * enforcement stays O(1) even as a school accumulates thousands of report PDFs.
 *
 * `byCategory` breaks usage down so future modules (fee statements Phase 5, ID
 * cards Phase 8) are accounted for separately from attendance reports without
 * needing their own counters.
 */
const schoolStorageSchema = new mongoose.Schema(
  {
    schoolId: { type: String, required: true, unique: true, index: true },
    usedBytes: { type: Number, default: 0 },
    byCategory: {
      attendanceReports: { type: Number, default: 0 },
      feeReports: { type: Number, default: 0 },
      idCards: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SchoolStorage', schoolStorageSchema);
