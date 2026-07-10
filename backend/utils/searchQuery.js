/**
 * searchQuery.js — Shared helpers for the server-side searchable selectors.
 *
 * DESIGN NOTE — why anchored regex and not $text
 * A `$text` index matches whole stemmed tokens, so typing "Joh" never matches
 * "John". Type-ahead needs prefix matching. Mongo serves an ANCHORED regex
 * (/^joh/) as an index range scan; an UNANCHORED one (/joh/) degrades to a
 * full collection scan. At 10,000+ students that difference is the whole
 * feature, so anchoring is the default here and un-anchoring is opt-in.
 *
 * Word-boundary anchoring: users type "Smith" expecting to find "John Smith".
 * A strictly ^-anchored regex would miss it. We therefore anchor at any word
 * boundary — `(^|\s)smith` — which still uses the index prefix when the term
 * starts the field, and remains bounded for the middle-of-string case.
 */

/**
 * Escape every regex metacharacter so user input can never alter the pattern.
 * A student legitimately named "O'Brien (Jr.)" or an admission number like
 * "ADM/2024/01" must be searchable without blowing up the query.
 */
function escapeRegex(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build an anchored, case-insensitive prefix matcher.
 * @param {string} term
 * @param {{ wordBoundary?: boolean }} opts
 *   wordBoundary=true  → matches at the start of any word ("smith" finds "John Smith")
 *   wordBoundary=false → matches only at the start of the field (fastest; use for IDs)
 */
function prefixRegex(term, { wordBoundary = false } = {}) {
  const safe = escapeRegex(String(term).trim());
  if (!safe) return null;
  return wordBoundary
    ? new RegExp(`(^|\\s)${safe}`, 'i')
    : new RegExp(`^${safe}`, 'i');
}

/**
 * Normalise + guard a raw `search` query param.
 * Returns null when the term is absent or too short to be worth a query —
 * a single character against 10,000 students returns a useless page and
 * costs an index range scan of nearly the whole collection.
 */
function normaliseSearchTerm(raw, { minLength = 1 } = {}) {
  if (raw === undefined || raw === null) return null;
  // A Mongo operator object can never reach here (express-mongo-sanitize runs
  // globally), but coerce to a primitive anyway — defense in depth.
  const term = String(raw).trim();
  if (term.length < minLength) return null;
  return term;
}

module.exports = { escapeRegex, prefixRegex, normaliseSearchTerm };