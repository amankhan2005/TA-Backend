/**
 * promotionEngine.js — Pure preview/validation for Phase 7. Takes already-loaded
 * student data and classifies each into promote / retain / missing-data / issues.
 * No database access, no writes → preview is inherently reversible and unit-testable.
 * The service layer supplies loaded students, the retained set, and a per-student
 * outstanding-fees map; this engine just decides categories.
 */

function evaluateStudent(s, { source, retainedSet, outstandingMap }) {
  const issues = [];

  if (!s.class || !s.section || !s.session) {
    return { category: 'missingData', issues: ['Missing class, section, or session.'] };
  }
  if (s.status && s.status !== 'active') {
    return { category: 'inactive', issues: [`Student is ${s.status}, not active.`] };
  }
  if (source && source.class && String(s.class) !== String(source.class)) {
    issues.push('Current class does not match the batch source class.');
  }
  if (source && source.section && String(s.section) !== String(source.section)) {
    issues.push('Current section does not match the batch source section.');
  }
  const outstanding = outstandingMap.get(String(s._id)) || 0;
  if (outstanding > 0) issues.push(`Outstanding fees (${outstanding} minor units).`);

  const retained = retainedSet.has(String(s._id));
  return { category: retained ? 'retained' : 'promote', issues };
}

/**
 * @param {Object} p
 * @param {Array}  p.students        loaded student objects {_id, studentId, name, class, section, session, status}
 * @param {Object} p.source          { session?, class?, section? } expected current placement
 * @param {Object} p.destination     { session, class, section } target placement
 * @param {Set<string>} [p.retainedSet]  student ids to retain
 * @param {Map<string,number>} [p.outstandingMap]  studentId → outstanding minor units
 * @param {string} p.mode
 * @returns preview object (no writes)
 */
function buildPreview({ students, source = {}, destination, retainedSet = new Set(), outstandingMap = new Map(), mode }) {
  if (!destination || (!destination.class && mode !== 'retention')) {
    throw new Error('A destination class is required for preview (except pure retention).');
  }

  const toPromote = [];
  const toRetain = [];
  const missingData = [];
  const inactive = [];
  const withIssues = [];

  for (const s of students) {
    const brief = { studentId: s.studentId, name: s.name, id: String(s._id) };
    const { category, issues } = evaluateStudent(s, { source, retainedSet, outstandingMap });

    if (category === 'missingData') { missingData.push({ ...brief, issues }); continue; }
    if (category === 'inactive') { inactive.push({ ...brief, issues }); continue; }

    if (issues.length) withIssues.push({ ...brief, issues });
    if (category === 'retained') toRetain.push({ ...brief, issues });
    else toPromote.push({ ...brief, issues });
  }

  return {
    mode,
    destination,
    counts: {
      total: students.length,
      toPromote: toPromote.length,
      toRetain: toRetain.length,
      missingData: missingData.length,
      inactive: inactive.length,
      withIssues: withIssues.length,
    },
    toPromote,
    toRetain,
    missingData,
    inactive,
    withIssues,
    // A batch is executable if there is at least one student to move and no
    // student is in a hard-blocking state (missingData / inactive block only
    // themselves — they're simply excluded — so execution is allowed as long as
    // there is something to promote or retain).
    executable: toPromote.length + toRetain.length > 0,
  };
}

module.exports = { buildPreview, evaluateStudent };
