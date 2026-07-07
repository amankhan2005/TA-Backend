/**
 * storageService.js — Plan-based storage accounting and enforcement (F-3).
 *
 * The single place that answers "how much has this school stored, and may it
 * store more?" Enforcement is O(1) (a counter read), and recording is an atomic
 * `$inc` so concurrent uploads can't lose a write. A null `storageLimitMB`
 * means unlimited (consistent with how `studentLimit`/`rfidLimit` treat null).
 */

const SchoolStorage = require('../models/SchoolStorage');

const MB = 1024 * 1024;
const CATEGORIES = ['attendanceReports', 'feeReports', 'idCards'];

async function getUsage(schoolId) {
  const doc = await SchoolStorage.findOne({ schoolId });
  return doc || { schoolId, usedBytes: 0, byCategory: { attendanceReports: 0, feeReports: 0, idCards: 0 } };
}

/**
 * Throws an Error with `.code = 'STORAGE_LIMIT'` if adding `addBytes` would push
 * the school over `limitMB`. No-op when `limitMB` is null/undefined (unlimited).
 */
async function assertStorageAvailable(schoolId, addBytes, limitMB) {
  if (limitMB == null) return;
  const { usedBytes } = await getUsage(schoolId);
  if (usedBytes + addBytes > limitMB * MB) {
    const err = new Error(
      `Storage limit reached (${limitMB} MB). In use: ${(usedBytes / MB).toFixed(2)} MB; ` +
      `this file needs ${(addBytes / MB).toFixed(2)} MB. Free space or upgrade the plan.`
    );
    err.code = 'STORAGE_LIMIT';
    throw err;
  }
}

function safeCategory(category) {
  return CATEGORIES.includes(category) ? category : 'attendanceReports';
}

/** Atomically add `bytes` to a school's usage (upserts the counter). */
async function recordUpload(schoolId, bytes, category = 'attendanceReports') {
  const cat = safeCategory(category);
  await SchoolStorage.findOneAndUpdate(
    { schoolId },
    { $inc: { usedBytes: bytes, [`byCategory.${cat}`]: bytes } },
    { upsert: true, new: true }
  );
}

/** Atomically subtract `bytes` (e.g. when a report/asset is deleted). Never negative-panics. */
async function recordDelete(schoolId, bytes, category = 'attendanceReports') {
  const cat = safeCategory(category);
  await SchoolStorage.findOneAndUpdate(
    { schoolId },
    { $inc: { usedBytes: -bytes, [`byCategory.${cat}`]: -bytes } },
    { new: true }
  );
}

/** Build the used / remaining / limit view for an API response. */
function summarize(usageDoc, limitMB) {
  const usedBytes = usageDoc.usedBytes || 0;
  const usedMB = usedBytes / MB;
  return {
    usedBytes,
    usedMB: +usedMB.toFixed(2),
    limitMB: limitMB ?? null,
    remainingMB: limitMB != null ? +Math.max(0, limitMB - usedMB).toFixed(2) : null,
    unlimited: limitMB == null,
    percentUsed: limitMB != null && limitMB > 0 ? +Math.min(100, (usedMB / limitMB) * 100).toFixed(1) : 0,
    byCategory: usageDoc.byCategory || { attendanceReports: 0, feeReports: 0, idCards: 0 },
  };
}

module.exports = { MB, getUsage, assertStorageAvailable, recordUpload, recordDelete, summarize };
