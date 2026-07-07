/**
 * dateRange.js — Resolves the "daily / weekly / monthly / custom" export ranges
 * into an inclusive [from, to] pair of "YYYY-MM-DD" strings, matching the
 * string date format used everywhere in attendance records. Pure, no I/O.
 *
 *   daily   → the single anchor day (from == to)
 *   weekly  → Monday…Sunday of the week containing the anchor day
 *   monthly → 1st…last day of the month containing the anchor day
 *   custom  → explicit from/to (validated by caller)
 *
 * All arithmetic is UTC-based to avoid DST/off-by-one drift, consistent with
 * utils/attendanceSummary.eachDateStr.
 */

const RE = /^\d{4}-\d{2}-\d{2}$/;

function pad(n) { return String(n).padStart(2, '0'); }
function toStr(d) { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
function parse(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function todayStr() { return toStr(new Date()); }

/**
 * @param {Object} q  query-ish object
 * @param {'daily'|'weekly'|'monthly'|'custom'} q.range
 * @param {string} [q.date]  anchor day for daily/weekly/monthly (defaults to today)
 * @param {string} [q.from]  custom range start
 * @param {string} [q.to]    custom range end
 * @returns {{ from:string, to:string, label:string }}
 * @throws {Error} with a client-safe message on bad input
 */
function resolveRange({ range = 'daily', date, from, to } = {}) {
  const anchorStr = date && RE.test(date) ? date : todayStr();
  const anchor = parse(anchorStr);

  if (range === 'custom') {
    if (!RE.test(from || '') || !RE.test(to || '')) {
      throw new Error('custom range requires from and to as "YYYY-MM-DD".');
    }
    if (from > to) throw new Error('from must be on or before to.');
    return { from, to, label: `${from} to ${to}` };
  }

  if (range === 'daily') {
    return { from: anchorStr, to: anchorStr, label: anchorStr };
  }

  if (range === 'weekly') {
    // ISO week: Monday start. getUTCDay(): 0=Sun..6=Sat → shift so Monday=0.
    const dow = (anchor.getUTCDay() + 6) % 7;
    const monday = new Date(anchor); monday.setUTCDate(anchor.getUTCDate() - dow);
    const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
    return { from: toStr(monday), to: toStr(sunday), label: `Week of ${toStr(monday)}` };
  }

  if (range === 'monthly') {
    const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    const last = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
    return { from: toStr(first), to: toStr(last), label: `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}` };
  }

  throw new Error("range must be one of: daily, weekly, monthly, custom.");
}

module.exports = { resolveRange, todayStr, toStr, parse, RE };
