/**
 * whatsapp.js — Meta WhatsApp Cloud API wrapper (ERP Phase 1).
 *
 * Mirrors utils/email.js's shape deliberately: one function per message
 * type, lazy client config (reads env at call time, not at module load —
 * same reasoning as email.js's getClient(), avoids crashing on import if
 * env vars aren't set yet), single module.exports block.
 *
 * IMPORTANT — WhatsApp Business API constraint that does not apply to email:
 * any business-initiated message (i.e. anything that isn't a reply within a
 * customer-opened 24-hour window) MUST use a pre-approved message TEMPLATE,
 * not free-form text. Every function below sends a template by name with
 * positional parameters — the templates themselves (wording, language) are
 * created and approved in the Meta Business Manager, not in this code. The
 * template names below (e.g. 'student_attendance_update') are the expected
 * names to register; if you name them differently in Meta's console, update
 * the constants at the top of this file, not the call sites.
 */

const TEMPLATE_NAMES = {
  attendanceUpdate: process.env.WHATSAPP_TEMPLATE_ATTENDANCE || 'student_attendance_update',
  feeReminder: process.env.WHATSAPP_TEMPLATE_FEE_REMINDER || 'fee_payment_reminder',
  reportReady: process.env.WHATSAPP_TEMPLATE_REPORT_READY || 'report_ready',
  promotion: process.env.WHATSAPP_TEMPLATE_PROMOTION || 'student_promotion_update',
};

const GRAPH_API_VERSION = 'v21.0';

function getConfig() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!accessToken || !phoneNumberId) {
    throw new Error('WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured.');
  }
  return { accessToken, phoneNumberId };
}

/**
 * Normalizes a mobile number to E.164-ish digits-only for the Cloud API
 * (no leading '+', country code required). Does NOT guess a country code —
 * the caller (Student.whatsappNumber) is expected to store it with country
 * code already, consistent with how international numbers should be
 * captured at data-entry time.
 */
function normalizeNumber(raw) {
  return String(raw || '').replace(/[^\d]/g, '');
}

async function sendTemplateMessage(toNumber, templateName, languageCode, bodyParams = []) {
  const { accessToken, phoneNumberId } = getConfig();
  const to = normalizeNumber(toNumber);
  if (!to) throw new Error('Invalid or missing WhatsApp number.');

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode || 'en_US' },
      components: bodyParams.length
        ? [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text: String(text) })) }]
        : [],
    },
  };

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    // Surfaces Meta's error detail (e.g. template not approved, invalid
    // number, rate limit) to the caller — NotificationLog records this,
    // consistent with the "never swallow a delivery failure" principle
    // from the risk assessment (R-9).
    const message = data?.error?.message || `WhatsApp API error (HTTP ${response.status})`;
    const err = new Error(message);
    err.whatsappError = data?.error;
    throw err;
  }

  return { providerMessageId: data?.messages?.[0]?.id || null, raw: data };
}

// ── Student RFID punch-in / punch-out / late notification ────────────────────
const sendStudentAttendanceWhatsApp = async ({ toNumber, studentName, eventLabel, time, date, schoolName }) =>
  sendTemplateMessage(toNumber, TEMPLATE_NAMES.attendanceUpdate, 'en_US', [
    studentName, eventLabel, time, date, schoolName,
  ]);

// ── Fee due / overdue reminder ────────────────────────────────────────────────
const sendFeeReminderWhatsApp = async ({ toNumber, studentName, amountDue, currency, dueDate, schoolName }) =>
  sendTemplateMessage(toNumber, TEMPLATE_NAMES.feeReminder, 'en_US', [
    studentName, `${currency} ${amountDue}`, dueDate, schoolName,
  ]);

// ── Generic "report ready" notification ───────────────────────────────────────
const sendReportReadyWhatsApp = async ({ toNumber, studentName, reportLabel, schoolName }) =>
  sendTemplateMessage(toNumber, TEMPLATE_NAMES.reportReady, 'en_US', [
    studentName, reportLabel, schoolName,
  ]);

const sendPromotionWhatsApp = async ({ toNumber, studentName, newClassName, schoolName }) =>
  sendTemplateMessage(toNumber, TEMPLATE_NAMES.promotion, 'en_US', [
    studentName, newClassName, schoolName,
  ]);

module.exports = {
  sendStudentAttendanceWhatsApp,
  sendPromotionWhatsApp,
  sendFeeReminderWhatsApp,
  sendReportReadyWhatsApp,
  normalizeNumber, // exported for reuse in parent registration validation
};
