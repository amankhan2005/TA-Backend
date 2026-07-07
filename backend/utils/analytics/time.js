/**
 * time.js — Date helpers for analytics. All "today/week/month" boundaries are
 * computed in UTC for deterministic aggregation (attendance `date` is stored as
 * a school-local "YYYY-MM-DD" string; scan/payment/notification timestamps are
 * Dates matched by range). Trend bucketing produces stable, sortable keys.
 */

function toDateStr(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 10);
}

function dayBounds(ref = new Date()) {
  const d = new Date(ref);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
  return { start, end, str: toDateStr(start) };
}

function weekBounds(ref = new Date()) {
  // ISO-ish week: Monday→Sunday containing `ref`.
  const d = new Date(ref);
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day, 0, 0, 0, 0));
  const end = new Date(start.getTime() + 7 * 86400000 - 1);
  return { start, end, startStr: toDateStr(start), endStr: toDateStr(end) };
}

function monthBounds(ref = new Date()) {
  const d = new Date(ref);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { start, end, startStr: toDateStr(start), endStr: toDateStr(end) };
}

function yearBounds(ref = new Date()) {
  const d = new Date(ref);
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), 11, 31, 23, 59, 59, 999));
  return { start, end, startStr: toDateStr(start), endStr: toDateStr(end) };
}

// N periods back from `ref` (inclusive of current), oldest→newest, as {key,start,end}.
function trendBuckets(granularity, count, ref = new Date()) {
  const buckets = [];
  const base = new Date(ref);
  for (let i = count - 1; i >= 0; i--) {
    let start, end, key;
    if (granularity === 'daily') {
      const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() - i));
      ({ start, end } = dayBounds(d)); key = toDateStr(start);
    } else if (granularity === 'weekly') {
      const d = new Date(base.getTime() - i * 7 * 86400000);
      const wb = weekBounds(d); start = wb.start; end = wb.end; key = wb.startStr;
    } else if (granularity === 'monthly') {
      const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
      const mb = monthBounds(d); start = mb.start; end = mb.end; key = mb.startStr.slice(0, 7);
    } else if (granularity === 'yearly') {
      const d = new Date(Date.UTC(base.getUTCFullYear() - i, 0, 1));
      const yb = yearBounds(d); start = yb.start; end = yb.end; key = String(d.getUTCFullYear());
    } else {
      throw new Error(`Unknown granularity "${granularity}".`);
    }
    buckets.push({ key, start, end });
  }
  return buckets;
}

module.exports = { toDateStr, dayBounds, weekBounds, monthBounds, yearBounds, trendBuckets };
