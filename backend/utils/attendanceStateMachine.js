/**
 * attendanceStateMachine.js — Pure functions, zero dependencies on Express,
 * Mongoose, or any I/O. This is deliberate (risk assessment R-2): the exact
 * business rules below are the highest-severity risk in the whole ERP
 * build, so they live in one small, fully unit-testable module that is
 * tested exhaustively (see attendanceStateMachine.test.js) BEFORE the
 * ingestion controller (which does I/O) is written at all.
 *
 * ── Rules implemented (verbatim from the approved spec) ─────────────────
 * 1. First valid scan of the day = Punch In.
 * 2. Duplicate scans within N minutes (default 5) of the immediately
 *    preceding scan = Ignore.
 * 3. Before the configured minimum Punch-Out duration (measured from
 *    Punch In) = Ignore.
 * 4. After the minimum duration, the next valid scan = Punch Out.
 * 5. Only one Punch In and one Punch Out per day (a natural consequence of
 *    the above — punchInAt is only ever set once; the only way to reach
 *    Punch Out is from the "already punched in, not yet out" state).
 * 6. After Punch Out, attendance is locked — every further scan is ignored
 *    and logged (outcome: 'ignored_locked'), with no further subdivision
 *    (the spec doesn't ask for one, and inventing finer states here than
 *    the spec calls for is exactly the kind of unreviewed complexity this
 *    module should avoid).
 */

const MS_PER_MINUTE = 60 * 1000;

/**
 * @param {Object} params
 * @param {Object|null} params.existingRecord - today's StudentAttendanceRecord for this student, or null if none exists yet.
 *   Shape (only these fields are read): { punchInAt: Date|null, punchOutAt: Date|null, isLocked: Boolean }
 * @param {Object} params.settings - StudentAttendanceSettings for the school.
 *   Shape: { schoolStartTime: 'HH:MM', minPunchOutDurationMinutes: Number, duplicateScanWindowMinutes: Number, lateThresholdMinutes: Number }
 * @param {Date} params.scanTime - when this scan occurred (device/receipt time).
 *
 * @returns {{
 *   outcome: 'punch_in'|'punch_out'|'ignored_duplicate'|'ignored_before_min_duration'|'ignored_locked',
 *   recordPatch: Object|null,  // fields to set on the StudentAttendanceRecord, or null if no record change (ignored outcomes)
 *   isLate: Boolean|null,      // only meaningful when outcome === 'punch_in'
 * }}
 */
function resolveScanOutcome({ existingRecord, settings, scanTime }) {
  if (!(scanTime instanceof Date) || isNaN(scanTime.getTime())) {
    throw new TypeError('resolveScanOutcome: scanTime must be a valid Date.');
  }
  const duplicateWindowMs = (settings?.duplicateScanWindowMinutes ?? 5) * MS_PER_MINUTE;
  const minPunchOutMs = (settings?.minPunchOutDurationMinutes ?? 240) * MS_PER_MINUTE;

  // ── No record yet today → first scan → Punch In ─────────────────────────
  if (!existingRecord || !existingRecord.punchInAt) {
    return {
      outcome: 'punch_in',
      recordPatch: { punchInAt: scanTime, status: 'punched_in', isLocked: false },
      isLate: computeIsLate(scanTime, settings),
    };
  }

  // ── Already locked (punched out) → every further scan is ignored ───────
  if (existingRecord.isLocked || existingRecord.punchOutAt) {
    return { outcome: 'ignored_locked', recordPatch: null, isLate: null };
  }

  // ── Punched in, not yet out → decide duplicate / too-early / punch-out ──
  const msSincePunchIn = scanTime.getTime() - new Date(existingRecord.punchInAt).getTime();

  if (msSincePunchIn < 0) {
    // Scan timestamp before the recorded punch-in (clock skew / bad device time) — never trust it into a state change.
    return { outcome: 'ignored_duplicate', recordPatch: null, isLate: null };
  }

  if (msSincePunchIn < duplicateWindowMs) {
    return { outcome: 'ignored_duplicate', recordPatch: null, isLate: null };
  }

  if (msSincePunchIn < minPunchOutMs) {
    return { outcome: 'ignored_before_min_duration', recordPatch: null, isLate: null };
  }

  return {
    outcome: 'punch_out',
    recordPatch: { punchOutAt: scanTime, status: 'punched_out', isLocked: true },
    isLate: null,
  };
}

/**
 * Late = punch-in later than schoolStartTime + lateThresholdMinutes, on the
 * same calendar day as the scan. schoolStartTime is "HH:MM" (school-local
 * wall-clock, admin-configured) — compared against scanTime's own local
 * hours/minutes, so this is correct regardless of server timezone as long
 * as scanTime itself already reflects the school's local time.
 */
function computeIsLate(scanTime, settings) {
  if (!settings?.schoolStartTime) return false;
  const [startH, startM] = settings.schoolStartTime.split(':').map(Number);
  const thresholdMinutes = settings.lateThresholdMinutes ?? 15;

  const startBoundary = new Date(scanTime);
  startBoundary.setHours(startH, startM + thresholdMinutes, 0, 0);

  return scanTime.getTime() > startBoundary.getTime();
}

module.exports = { resolveScanOutcome, computeIsLate, MS_PER_MINUTE };
