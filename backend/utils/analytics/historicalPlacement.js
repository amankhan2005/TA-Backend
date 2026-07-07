/**
 * historicalPlacement.js — Snapshot-with-fallback resolution (Phase 7.1).
 *
 * Records created from Phase 7.1 onward carry an immutable classSnapshot /
 * sectionSnapshot / sessionSnapshot of where the student was WHEN the record was
 * created. Analytics must group by those so a later promotion never rewrites
 * history. Older records have null snapshots → we fall back to the student's
 * CURRENT placement, which is the best (and only) value available for them.
 *
 * `groupKeyExpr` returns the Mongo aggregation expression; `resolvePlacement` is
 * the equivalent pure JS (used in tests and any in-memory rollup) so the two
 * stay in lockstep.
 */

// Aggregation expr: prefer the record's own snapshot, else the joined student's current field.
function groupKeyExpr(field, joinedAlias = 'st') {
  return { $ifNull: [`$${field}Snapshot`, `$${joinedAlias}.${field}`] };
}

// Pure equivalent for JS-side rollups / tests.
function resolvePlacement(record, student, field) {
  const snap = record ? record[`${field}Snapshot`] : null;
  if (snap != null) return snap;
  return student ? student[field] ?? null : null;
}

module.exports = { groupKeyExpr, resolvePlacement };
