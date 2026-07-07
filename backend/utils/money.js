/**
 * money.js — Integer-minor-unit money primitives (Phase 5). The ONLY place money
 * arithmetic happens. Rules enforced here:
 *   • Every amount is an integer number of MINOR units (USD/LRD/KES cents, INR paise).
 *   • No floating-point math on money — ever. Parsing goes string → integer.
 *   • Amounts of different currencies are never combined (throws).
 *
 * All four supported currencies are 2-decimal (factor 100), but the engine reads
 * `factor`/`decimals` from the currency table so adding a 0- or 3-decimal currency
 * later is a table edit, not a logic change.
 */

const CURRENCIES = {
  USD: { code: 'USD', symbol: '$',   decimals: 2, factor: 100 },
  LRD: { code: 'LRD', symbol: 'L$',  decimals: 2, factor: 100 },
  INR: { code: 'INR', symbol: '\u20B9', decimals: 2, factor: 100 }, // ₹
  KES: { code: 'KES', symbol: 'KSh', decimals: 2, factor: 100 },
};

function requireCurrency(currency) {
  const cfg = CURRENCIES[currency];
  if (!cfg) throw new Error(`Unsupported currency "${currency}". Supported: ${Object.keys(CURRENCIES).join(', ')}.`);
  return cfg;
}

function isSupportedCurrency(currency) {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, currency);
}

// Number → plain decimal string without exponent/float artifacts for typical fee values.
function numToPlainString(n) {
  if (!Number.isFinite(n)) throw new Error('Amount is not a finite number.');
  // Avoid scientific notation for the value ranges fees live in.
  return String(n);
}

/**
 * Parse a human amount ("100.50", 100.5, "1,000") in MAJOR units into an integer
 * of minor units for the given currency. Rounds half-up if more fractional digits
 * are supplied than the currency allows. Never uses float multiplication.
 */
function parseMoneyToMinor(input, currency) {
  const cfg = requireCurrency(currency);
  let s = (typeof input === 'number' ? numToPlainString(input) : String(input)).trim();
  s = s.replace(/,/g, ''); // tolerate thousands separators
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid money amount "${input}".`);

  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);

  let [intPart, frac = ''] = s.split('.');

  // Round to currency decimals using the first dropped digit (half-up), all in string/int space.
  if (frac.length > cfg.decimals) {
    const keep = frac.slice(0, cfg.decimals);
    const nextDigit = frac.charCodeAt(cfg.decimals) - 48;
    let combined = BigInt(intPart + (keep || '')); // integer with `decimals` implied places
    if (nextDigit >= 5) combined += 1n;
    const factorBig = 10n ** BigInt(cfg.decimals);
    intPart = (combined / factorBig).toString();
    frac = (combined % factorBig).toString().padStart(cfg.decimals, '0');
  } else {
    frac = frac.padEnd(cfg.decimals, '0');
  }

  const minor = BigInt(intPart) * BigInt(cfg.factor) + BigInt(frac || '0');
  const result = Number(neg ? -minor : minor);
  if (!Number.isSafeInteger(result)) throw new Error('Amount exceeds safe integer range.');
  return result;
}

/** Assert a value is a valid integer minor-unit amount. */
function assertMinor(value, { allowNegative = false } = {}) {
  if (!Number.isInteger(value)) throw new Error(`Money must be an integer number of minor units (got ${value}).`);
  if (!allowNegative && value < 0) throw new Error(`Money amount cannot be negative (got ${value}).`);
  return value;
}

/** Format minor units → grouped major-unit string, optionally with the currency symbol. */
function formatMinor(minor, currency, { withSymbol = false, withCode = false } = {}) {
  const cfg = requireCurrency(currency);
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const intPart = Math.floor(abs / cfg.factor);
  const fracPart = abs % cfg.factor;
  const grouped = intPart.toLocaleString('en-US');
  const fracStr = cfg.decimals > 0 ? '.' + String(fracPart).padStart(cfg.decimals, '0') : '';
  const core = `${grouped}${fracStr}`;
  const symbol = withSymbol ? cfg.symbol : '';
  const code = withCode ? ` ${cfg.code}` : '';
  return `${neg ? '-' : ''}${symbol}${core}${code}`;
}

// ── Integer-only arithmetic (currency crossing is the caller's responsibility;
//    the fee engines pass a single currency through) ──────────────────────────
function addMinor(...amounts) { return amounts.reduce((a, b) => assertMinor(a, { allowNegative: true }) + assertMinor(b, { allowNegative: true }), 0); }
function subMinor(a, b) { return assertMinor(a, { allowNegative: true }) - assertMinor(b, { allowNegative: true }); }
function mulMinor(amount, quantity) {
  assertMinor(amount, { allowNegative: true });
  if (!Number.isInteger(quantity) || quantity < 0) throw new Error(`Quantity must be a non-negative integer (got ${quantity}).`);
  return amount * quantity;
}
function clampNonNeg(amount) { return amount < 0 ? 0 : amount; }
/** Percentage of an amount, rounded half-up to a whole minor unit. `pct` may be fractional. */
function percentOfMinor(amount, pct) {
  assertMinor(amount, { allowNegative: true });
  if (typeof pct !== 'number' || pct < 0) throw new Error(`Percent must be a non-negative number (got ${pct}).`);
  return Math.round((amount * pct) / 100);
}

module.exports = {
  CURRENCIES, requireCurrency, isSupportedCurrency,
  parseMoneyToMinor, assertMinor, formatMinor,
  addMinor, subMinor, mulMinor, clampNonNeg, percentOfMinor,
};
