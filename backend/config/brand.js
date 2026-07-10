/**
 * brand.js — Single source of truth for every public-facing URL and brand
 * string used in emails, activation links, and CORS.
 *
 * WHY THIS FILE EXISTS
 * Before this, the production domain was hardcoded in six places inside
 * utils/email.js and once inside server.js's CORS allowlist. Changing domain
 * meant editing template HTML. Now every domain reference resolves through
 * here, and every value is env-overridable so localhost development is
 * unaffected (see the DEV_DEFAULTS block).
 *
 * WHAT IS DELIBERATELY *NOT* HERE
 *   • Cloudinary folder paths ("teacherattendance/logos", .../students, ...)
 *     — those are STORAGE KEYS, not URLs. Renaming them orphans every asset
 *     already uploaded. See config/cloudinary.js and utils/reportStorage.js.
 *   • The seeded Super Admin email (utils/seed.js) — that is a LOGIN IDENTITY.
 *     Changing it locks existing databases out of their own admin account.
 *
 * Both are intentionally left on the old string.
 */

const stripTrailingSlash = (url) => String(url || '').replace(/\/+$/, '');

// Production defaults. Any of these can be overridden per-environment.
const DEFAULTS = {
  SITE_URL: 'https://liberiaschoolhub.com',
  API_URL: 'https://api.liberiaschoolhub.com',
  SCHOOL_ADMIN_URL: 'https://liberiaschoolhub.com/schooladmin',
  SUPER_ADMIN_URL: 'https://liberiaschoolhub.com/superadmin',
  PARENT_PORTAL_URL: 'https://liberiaschoolhub.com/parent',
  BRAND_NAME: 'Liberia School Hub',
  EMAIL_FROM: 'Liberia School Hub <no-reply@liberiaschoolhub.com>',
};

/**
 * Resolve a URL from env with a production fallback. Empty-string env values
 * are treated as unset (a common .env footgun: `FOO=` yields '').
 */
const fromEnv = (key, fallback) => {
  const raw = process.env[key];
  if (raw && String(raw).trim()) return stripTrailingSlash(String(raw).trim());
  return stripTrailingSlash(fallback);
};

const brand = {
  // Marketing / footer site.
  siteUrl: () => fromEnv('PUBLIC_SITE_URL', DEFAULTS.SITE_URL),

  // Bare host, for rendering as link text ("liberiaschoolhub.com").
  siteHost: () => {
    try { return new URL(brand.siteUrl()).host.replace(/^www\./, ''); }
    catch { return DEFAULTS.SITE_URL.replace(/^https?:\/\//, ''); }
  },

  apiUrl: () => fromEnv('PUBLIC_API_URL', DEFAULTS.API_URL),

  // These three already existed as env vars and are read by existing code
  // (schoolController, authController, parentAdminController). We only add
  // sane production fallbacks so a missing var no longer produces the string
  // "undefined/register?token=..." in a live invite email.
  schoolAdminUrl: () => fromEnv('FRONTEND_SCHOOL_ADMIN_URL', DEFAULTS.SCHOOL_ADMIN_URL),
  superAdminUrl: () => fromEnv('FRONTEND_SUPER_ADMIN_URL', DEFAULTS.SUPER_ADMIN_URL),

  // NOTE: the codebase reads PARENT_PORTAL_URL. The old .env.example also
  // declared FRONTEND_PARENT_PORTAL_URL, which nothing ever read. We accept
  // both so an existing deployment configured with the dead name keeps working.
  parentPortalUrl: () =>
    fromEnv('PARENT_PORTAL_URL', fromEnv('FRONTEND_PARENT_PORTAL_URL', DEFAULTS.PARENT_PORTAL_URL)),

  brandName: () => (process.env.BRAND_NAME || '').trim() || DEFAULTS.BRAND_NAME,

  emailFrom: () => (process.env.EMAIL_FROM || '').trim() || DEFAULTS.EMAIL_FROM,

  /**
   * Every origin the browser may legitimately send. Subpath-deployed apps
   * (/schooladmin, /parent) collapse to the same origin, which is exactly
   * what the Origin header carries.
   */
  allowedOrigins: () => {
    const originOf = (url) => { try { return new URL(url).origin; } catch { return null; } };

    const configured = [
      brand.siteUrl(),
      brand.parentPortalUrl(),
      brand.schoolAdminUrl(),
      brand.superAdminUrl(),
      process.env.FRONTEND_URL,
    ].map(originOf);

    // Extra origins for previews / legacy hosts, comma-separated.
    // e.g. EXTRA_CORS_ORIGINS=https://foo.netlify.app,https://bar.onrender.com
    const extra = String(process.env.EXTRA_CORS_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(originOf);

    const devOrigins = [
      'http://localhost:5173', // website / super admin local
      'http://localhost:5174', // school admin local
      'http://localhost:5175', // parent portal local
    ];

    return [...new Set([...configured, ...extra, ...devOrigins].filter(Boolean))];
  },
};

module.exports = brand;
module.exports.DEFAULTS = DEFAULTS;
module.exports.stripTrailingSlash = stripTrailingSlash;