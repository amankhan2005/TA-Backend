/**
 * attendanceSummary.js — Pure functions, ZERO I/O. Turns a set of
 * StudentAttendanceRecord rows for a date span into the numbers a parent's
 * PDF report shows: present days, absent days, late arrivals, attendance %,
 * and a date-wise breakdown.
 *
 * Kept pure and separately unit-tested (attendanceSummary.test.js) because
 * the "what counts as a school day" logic — excluding weekly-off days and
 * holidays (including recurring ones) from the denominator — is exactly the
 * kind of off-by-one-prone rule that a wrong result silently misreports a
 * child's attendance to a parent. Better to prove it in isolation than to
 * discover it in a delivered report.
 *
 * Absence is inferred, never stored: a "school day" in the period with no
 * punch-in record is an absence. Non-school days (weekends/holidays) are
 * excluded from BOTH numerator and denominator, so they never count against
 * a student.
 */

/** Iterate inclusive [startStr, endStr] as "YYYY-MM-DD", UTC-based to avoid DST drift. */
function eachDateStr(startStr, endStr) {
  const out = [];
  const [sy, sm, sd] = startStr.split('-').map(Number);
  const [ey, em, ed] = endStr.split('-').map(Number);
  let cur = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  while (cur <= end) {
    const dt = new Date(cur);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    out.push(`${y}-${m}-${d}`);
    cur += 86400000;
  }
  return out;
}

/** Day of week (0=Sun..6=Sat) for a "YYYY-MM-DD", UTC-based to match eachDateStr. */
function dowOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * A day is a holiday if an active holiday entry matches it exactly, or matches
 * its MM-DD when the entry is marked recurring.
 * @param {Array<{date:string,recurring?:boolean,isActive?:boolean}>} holidays
 */
function isHoliday(dateStr, holidays = []) {
  const mmdd = dateStr.slice(5);
  return holidays.some((h) => {
    if (h.isActive === false) return false;
    if (h.date === dateStr) return true;
    if (h.recurring && typeof h.date === 'string' && h.date.slice(5) === mmdd) return true;
    return false;
  });
}

function isSchoolDay(dateStr, weeklyOffDays = [], holidays = []) {
  if (weeklyOffDays.includes(dowOf(dateStr))) return false;
  if (isHoliday(dateStr, holidays)) return false;
  return true;
}

function formatDuration(punchInAt, punchOutAt) {
  if (!punchInAt || !punchOutAt) return null;
  const mins = Math.round((new Date(punchOutAt).getTime() - new Date(punchInAt).getTime()) / 60000);
  if (mins <= 0) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function hhmm(dt) {
  if (!dt) return null;
  const d = new Date(dt);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * @param {Object} params
 * @param {Array} params.records  StudentAttendanceRecord-like: { date:'YYYY-MM-DD', punchInAt, punchOutAt, isLate }
 * @param {string} params.periodStart "YYYY-MM-DD" inclusive
 * @param {string} params.periodEnd   "YYYY-MM-DD" inclusive
 * @param {number[]} [params.weeklyOffDays] 0..6
 * @param {Array} [params.holidays]
 * @returns {{
 *   schoolDays:number, presentDays:number, absentDays:number, lateDays:number,
 *   attendancePercentage:number, details:Array<{date,status,punchIn,punchOut,duration,isLate}>
 * }}
 */
function computeAttendanceSummary({ records = [], periodStart, periodEnd, weeklyOffDays = [], holidays = [] }) {
  const byDate = new Map();
  for (const r of records) {
    if (r && r.date) byDate.set(r.date, r);
  }

  let schoolDays = 0;
  let presentDays = 0;
  let lateDays = 0;
  const details = [];

  for (const dateStr of eachDateStr(periodStart, periodEnd)) {
    const schoolDay = isSchoolDay(dateStr, weeklyOffDays, holidays);
    const rec = byDate.get(dateStr);
    const present = !!(rec && rec.punchInAt);

    if (schoolDay) {
      schoolDays += 1;
      if (present) {
        presentDays += 1;
        if (rec.isLate) lateDays += 1;
      }
      details.push({
        date: dateStr,
        status: present ? (rec.isLate ? 'late' : 'present') : 'absent',
        punchIn: present ? hhmm(rec.punchInAt) : null,
        punchOut: present ? hhmm(rec.punchOutAt) : null,
        duration: present ? formatDuration(rec.punchInAt, rec.punchOutAt) : null,
        isLate: present ? !!rec.isLate : false,
      });
    } else if (present) {
      // Student punched in on a non-school day (e.g. an extra/holiday session):
      // shown for transparency but NOT counted in the percentage denominator.
      details.push({
        date: dateStr,
        status: 'present_non_school_day',
        punchIn: hhmm(rec.punchInAt),
        punchOut: hhmm(rec.punchOutAt),
        duration: formatDuration(rec.punchInAt, rec.punchOutAt),
        isLate: !!rec.isLate,
      });
    }
  }

  const absentDays = schoolDays - presentDays;
  const attendancePercentage = schoolDays > 0 ? Math.round((presentDays / schoolDays) * 100) : 0;

  return { schoolDays, presentDays, absentDays, lateDays, attendancePercentage, details };
}

module.exports = {
  computeAttendanceSummary,
  eachDateStr,
  isSchoolDay,
  isHoliday,
  formatDuration,
};
