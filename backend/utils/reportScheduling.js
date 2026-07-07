/**
 * reportScheduling.js — Pure functions, ZERO dependency on Express, Mongoose,
 * BullMQ, or any I/O. Same deliberate discipline as attendanceStateMachine.js:
 * the "when does a parent actually receive a report" logic is subtle (weekly
 * weekday matching, month-start vs month-end, leap years, and custom days that
 * don't exist in every month) so it lives in one small, fully unit-testable
 * module (see reportScheduling.test.js) that is tested exhaustively BEFORE the
 * worker job that calls it (which does DB I/O) is written.
 *
 * ── The scheduling model (Phase 4, approved spec) ───────────────────────────
 * A single daily "sweep" job runs once per day. For each enabled schedule it
 * asks isScheduleDueOn(schedule, today); if due, a report-generation job is
 * enqueued for that school. This keeps ONE repeatable timer in BullMQ instead
 * of N per-schedule cron entries — simpler to reason about and idempotent
 * (re-running the sweep on the same day never double-sends; see R-6).
 *
 * Supported frequencies and their trigger day:
 *   daily    → every day
 *   weekly   → on schedule.dayOfWeek (0=Sun … 6=Sat)         e.g. "Every Sunday"
 *   monthly  → monthlyMode:
 *                'start' → the 1st of the month                e.g. "Every Month Start"
 *                'end'   → the last day of the month (leap-aware) e.g. "Every Month End"
 *                'day'   → schedule.dayOfMonth, clamped to the month's length
 *   custom   → schedule.dayOfMonth, clamped to the month's length ("Custom Day")
 *
 * ── Period covered (what the report summarizes) ─────────────────────────────
 * Trigger day and covered period are deliberately DECOUPLED so the report
 * always summarizes a COMPLETED span (never an in-progress day):
 *   daily   → yesterday                          [date-1 .. date-1]
 *   weekly  → the trailing 7 days ending yesterday [date-7 .. date-1]
 *   monthly 'end' → the month that is ending      [1st of date's month .. date]
 *   monthly 'start'/'day' + custom → the previous calendar month
 * This means "Every Month Start" (fires the 1st) and "Every Month End" (fires
 * the last day) both report a full month — the previous one and the ending one
 * respectively — which is the intuitive reading of each.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Last calendar day of a given month. Leap-year correct via JS Date rollover. */
function lastDayOfMonth(year, monthIndex0) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

/** Clamp a requested day-of-month to a month that may be shorter (31 → 28/29/30). */
function clampDayOfMonth(day, year, monthIndex0) {
  const last = lastDayOfMonth(year, monthIndex0);
  return Math.min(Math.max(day, 1), last);
}

function assertDate(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new TypeError('reportScheduling: date must be a valid Date.');
  }
}

/** "YYYY-MM-DD" in the date's own local calendar (matches controllers' toSchoolDateString). */
function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * @param {Object} schedule
 * @param {'daily'|'weekly'|'monthly'|'custom'} schedule.frequency
 * @param {number} [schedule.dayOfWeek]   0..6, for weekly
 * @param {'start'|'end'|'day'} [schedule.monthlyMode]  for monthly
 * @param {number} [schedule.dayOfMonth]  1..31, for monthly 'day' + custom
 * @param {Date} date  the run date (today)
 * @returns {boolean}  whether this schedule fires on `date`
 */
function isScheduleDueOn(schedule, date) {
  assertDate(date);
  if (!schedule || !schedule.frequency) return false;

  const y = date.getFullYear();
  const m = date.getMonth();
  const dom = date.getDate();

  switch (schedule.frequency) {
    case 'daily':
      return true;

    case 'weekly':
      return date.getDay() === Number(schedule.dayOfWeek);

    case 'monthly': {
      const mode = schedule.monthlyMode || 'day';
      if (mode === 'start') return dom === 1;
      if (mode === 'end') return dom === lastDayOfMonth(y, m);
      // 'day'
      return dom === clampDayOfMonth(Number(schedule.dayOfMonth) || 1, y, m);
    }

    case 'custom':
      return dom === clampDayOfMonth(Number(schedule.dayOfMonth) || 1, y, m);

    default:
      return false;
  }
}

/** Add N calendar days to a date, returning a new midnight-normalized Date. */
function addDays(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * @returns {{ start: Date, end: Date, startStr: string, endStr: string, label: string }}
 *   the completed span this run should summarize. start/end are midnight-normalized
 *   local Dates, inclusive on both ends.
 */
function computeReportPeriod(schedule, date) {
  assertDate(date);
  const freq = schedule?.frequency;

  if (freq === 'daily') {
    const day = addDays(date, -1);
    return periodResult(day, day, `Daily — ${toDateStr(day)}`);
  }

  if (freq === 'weekly') {
    const end = addDays(date, -1);
    const start = addDays(date, -7);
    return periodResult(start, end, `Weekly — ${toDateStr(start)} to ${toDateStr(end)}`);
  }

  // monthly + custom → a full calendar month
  const mode = schedule?.monthlyMode || 'day';
  if (freq === 'monthly' && mode === 'end') {
    // The month that is ending: 1st of date's month .. date (the last day).
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth(), lastDayOfMonth(date.getFullYear(), date.getMonth()));
    return periodResult(start, end, `Monthly — ${MONTHS[start.getMonth()]} ${start.getFullYear()}`);
  }

  // 'start' / 'day' / custom → the previous calendar month.
  const prev = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  const start = new Date(prev.getFullYear(), prev.getMonth(), 1);
  const end = new Date(prev.getFullYear(), prev.getMonth(), lastDayOfMonth(prev.getFullYear(), prev.getMonth()));
  return periodResult(start, end, `Monthly — ${MONTHS[start.getMonth()]} ${start.getFullYear()}`);
}

function periodResult(start, end, label) {
  return { start, end, startStr: toDateStr(start), endStr: toDateStr(end), label };
}

module.exports = {
  isScheduleDueOn,
  computeReportPeriod,
  lastDayOfMonth,
  clampDayOfMonth,
  toDateStr,
  addDays,
  MONTHS,
};
