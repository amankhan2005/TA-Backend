/**
 * validateEnv.js — Fail-fast startup validation (audit Fix 5).
 *
 * The app refuses to boot if a required secret is missing, and specifically if
 * QR_SIGNING_SECRET is absent or equal to JWT_SECRET (audit Fix 3). Delivery
 * providers (Cloudinary/Resend) are required in production and warned otherwise;
 * WhatsApp is optional (plan-gated) and only warned. Skipped under NODE_ENV=test
 * so unit tests never depend on secrets.
 */

function validateEnv({ role = 'api' } = {}) {
  if (process.env.NODE_ENV === 'test') return { ok: true, skipped: true };

  const isProd = process.env.NODE_ENV === 'production';
  const errors = [];
  const warnings = [];

  const need = (k) => { if (!process.env[k] || !String(process.env[k]).trim()) errors.push(`Missing required env var: ${k}`); };

  // Always required (both api and worker)
  need('JWT_SECRET');
  need('QR_SIGNING_SECRET');
  need('MONGODB_URI');
  need('REDIS_URL');

  // Key separation (audit Fix 3)
  if (process.env.QR_SIGNING_SECRET && process.env.JWT_SECRET && process.env.QR_SIGNING_SECRET === process.env.JWT_SECRET) {
    errors.push('QR_SIGNING_SECRET must differ from JWT_SECRET (key separation).');
  }
  // Weak-secret guard
  for (const k of ['JWT_SECRET', 'QR_SIGNING_SECRET']) {
    const v = process.env[k];
    if (v && v.length < 16) errors.push(`${k} is too short; use at least 16 random characters.`);
  }

  // Delivery providers: required in production, warned otherwise.
  const provider = (k) => { if (!process.env[k]) (isProd ? errors : warnings).push(`${isProd ? 'Missing' : '(dev) missing'} ${k}`); };
  ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'RESEND_API_KEY'].forEach(provider);

  // WhatsApp is optional (plan-gated) — warn only.
  if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
    warnings.push('WhatsApp credentials not set — WhatsApp notifications will be disabled (email still works).');
  }

  warnings.forEach((w) => console.warn(`[env] ⚠️  ${w}`));

  if (errors.length) {
    console.error(`\n[env] ❌ Startup blocked (${role}) — ${errors.length} problem(s):`);
    errors.forEach((e) => console.error(`  • ${e}`));
    console.error('Set the variables above (see .env.example) and restart.\n');
    throw new Error('Environment validation failed: ' + errors.join('; '));
  }
  console.log(`[env] ✅ Environment validated (${role}).`);
  return { ok: true, warnings };
}

module.exports = { validateEnv };
