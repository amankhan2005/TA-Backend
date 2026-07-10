const { Resend } = require('resend');
const brand = require('../config/brand');

// Lazy init — prevents crash on module load when RESEND_API_KEY not yet set
const getClient = () => new Resend(process.env.RESEND_API_KEY);
const FROM = () => brand.emailFrom();

// ── Shared design tokens ─────────────────────────────────────────────────────
const BRAND = {
  navy: '#0A3475',
  teal: '#13C6B3',
  tealDark: '#0f9e8e',
  white: '#FFFFFF',
  bg: '#F0F4F9',
  cardBg: '#FFFFFF',
  textDark: '#0F172A',
  textMid: '#374151',
  textLight: '#6B7280',
  textMuted: '#9CA3AF',
  border: '#E2E8F0',
  errorBg: '#FEF2F2',
  errorBorder: '#FCA5A5',
  errorText: '#991B1B',
  successBg: '#F0FEFA',
  successBorder: '#13C6B3',
};

// ── Base email wrapper ───────────────────────────────────────────────────────
const baseWrapper = (bodyContent) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${brand.brandName()}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.bg};font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:${BRAND.bg};padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,${BRAND.navy} 0%,#1A3F7A 100%);border-radius:12px 12px 0 0;padding:28px 36px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="margin:0;font-size:22px;font-weight:700;color:${BRAND.white};letter-spacing:-0.3px;">${brand.brandName()}</p>
                    <p style="margin:5px 0 0;font-size:12px;color:#93C5FD;letter-spacing:0.6px;text-transform:uppercase;">School Attendance Management</p>
                  </td>
                  <td align="right">
                    <div style="width:44px;height:44px;background:rgba(19,198,179,0.18);border-radius:50%;display:inline-block;line-height:44px;text-align:center;font-size:22px;">📋</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body Card -->
          <tr>
            <td style="background:${BRAND.cardBg};padding:36px 36px 28px;border-left:1px solid ${BRAND.border};border-right:1px solid ${BRAND.border};">
              ${bodyContent}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#F8FAFC;border:1px solid ${BRAND.border};border-top:none;border-radius:0 0 12px 12px;padding:20px 36px;text-align:center;">
              <p style="margin:0 0 6px;font-size:12px;color:${BRAND.textMuted};">
                © ${new Date().getFullYear()} ${brand.brandName()} &nbsp;·&nbsp;
                <a href="${brand.siteUrl()}" style="color:${BRAND.tealDark};text-decoration:none;">${brand.siteHost()}</a>
              </p>
              <p style="margin:0;font-size:11px;color:#C1CBD8;">Empowering schools across Africa with modern attendance tracking.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

// ── Reusable button ──────────────────────────────────────────────────────────
const ctaButton = (href, label) => `
<table cellpadding="0" cellspacing="0" role="presentation" style="margin:24px 0;">
  <tr>
    <td style="border-radius:8px;background:linear-gradient(135deg,${BRAND.navy},#1A56DB);">
      <a href="${href}" style="display:inline-block;padding:14px 32px;color:${BRAND.white};font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;letter-spacing:0.2px;">${label}</a>
    </td>
  </tr>
</table>
<p style="color:${BRAND.textLight};font-size:12px;margin:0 0 4px;">Button not working? Paste this link in your browser:</p>
<p style="margin:0;"><a href="${href}" style="color:${BRAND.navy};font-size:12px;word-break:break-all;">${href}</a></p>
`;

// ── Section divider ──────────────────────────────────────────────────────────
const divider = `<hr style="border:none;border-top:1px solid ${BRAND.border};margin:28px 0;" />`;

// ── Send school invitation email ─────────────────────────────────────────────
const sendSchoolInviteEmail = async ({ toEmail, schoolName, inviteLink }) => {
  const body = `
    <h2 style="margin:0 0 6px;font-size:26px;font-weight:700;color:${BRAND.textDark};">You're Invited! 🎉</h2>
    <p style="margin:0 0 20px;font-size:13px;color:${BRAND.tealDark};font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">School Admin Invitation</p>

    <p style="color:${BRAND.textMid};font-size:15px;line-height:1.7;margin:0 0 12px;">
      You've been selected to manage <strong style="color:${BRAND.textDark};">${schoolName}</strong> on the ${brand.brandName()} platform — a modern, streamlined system for tracking teacher attendance across your school.
    </p>
    <p style="color:${BRAND.textMid};font-size:15px;line-height:1.7;margin:0 0 4px;">
      Click the button below to complete your registration and set up your school account.
    </p>

    <div style="background:${BRAND.successBg};border:1px solid ${BRAND.successBorder};border-radius:8px;padding:14px 18px;margin:20px 0;">
      <p style="margin:0;font-size:13px;color:#0f766e;">
        ⏱ &nbsp;<strong>This invitation link expires in 48 hours.</strong> Please register before then.
      </p>
    </div>

    ${ctaButton(inviteLink, 'Complete Registration →')}

    ${divider}
    <p style="color:${BRAND.textMuted};font-size:12px;margin:0;">If you weren't expecting this invitation, you can safely ignore this email.</p>
  `;
  await getClient().emails.send({
    from: FROM(),
    to: toEmail,
    subject: `You're invited to manage ${schoolName} on ${brand.brandName()}`,
    html: baseWrapper(body),
  });
};

// ── Send password reset email ─────────────────────────────────────────────────
const sendPasswordResetEmail = async ({ toEmail, resetLink, role }) => {
  const roleLabel = role === 'superAdmin' ? 'Super Admin' : 'School Admin';
  const body = `
    <h2 style="margin:0 0 6px;font-size:26px;font-weight:700;color:${BRAND.textDark};">Password Reset</h2>
    <p style="margin:0 0 20px;font-size:13px;color:${BRAND.tealDark};font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">${roleLabel} Account</p>

    <p style="color:${BRAND.textMid};font-size:15px;line-height:1.7;margin:0 0 12px;">
      We received a request to reset the password for your <strong>${roleLabel}</strong> account on ${brand.brandName()}. If this was you, click below to set a new password.
    </p>

    <div style="background:${BRAND.successBg};border:1px solid ${BRAND.successBorder};border-radius:8px;padding:14px 18px;margin:20px 0;">
      <p style="margin:0;font-size:13px;color:#0f766e;">
        ⏱ &nbsp;<strong>This reset link expires in 30 minutes.</strong>
      </p>
    </div>

    ${ctaButton(resetLink, 'Reset My Password →')}

    <div style="background:${BRAND.errorBg};border-left:4px solid #EF4444;border-radius:6px;padding:14px 18px;margin-top:24px;">
      <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:${BRAND.errorText};">⚠️ Didn't request this?</p>
      <p style="margin:0;font-size:13px;color:${BRAND.errorText};line-height:1.6;">
        Your account may be at risk. Contact ${brand.brandName()} support immediately at
        <a href="${brand.siteUrl()}" style="color:${BRAND.errorText};font-weight:600;">${brand.siteHost()}</a>.
      </p>
    </div>

    ${divider}
    <p style="color:${BRAND.textMuted};font-size:12px;margin:0;">For your security, this link can only be used once.</p>
  `;
  await getClient().emails.send({
    from: FROM(),
    to: toEmail,
    subject: `Password Reset Request — ${brand.brandName()}`,
    html: baseWrapper(body),
  });
};

// ── Send teacher welcome email ────────────────────────────────────────────────
const sendTeacherWelcomeEmail = async ({ toEmail, teacherName, schoolName, tempPassword }) => {
  const body = `
    <h2 style="margin:0 0 6px;font-size:26px;font-weight:700;color:${BRAND.textDark};">Welcome, ${teacherName}! 👋</h2>
    <p style="margin:0 0 20px;font-size:13px;color:${BRAND.tealDark};font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Your account is ready</p>

    <p style="color:${BRAND.textMid};font-size:15px;line-height:1.7;margin:0 0 16px;">
      Your ${brand.brandName()} account has been created for <strong style="color:${BRAND.textDark};">${schoolName}</strong>. Download the mobile app and log in with the credentials below.
    </p>

    <!-- Credentials card -->
    <table cellpadding="0" cellspacing="0" role="presentation" width="100%" style="margin:20px 0;">
      <tr>
        <td style="background:#F0F4FF;border:1px solid #BFDBFE;border-radius:10px;padding:20px 24px;">
          <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#3B5FBF;text-transform:uppercase;letter-spacing:0.8px;">Login Credentials</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #DBEAFE;">
                <span style="font-size:13px;color:#6B7280;font-weight:600;">Email</span>
              </td>
              <td align="right" style="padding:8px 0;border-bottom:1px solid #DBEAFE;">
                <span style="font-size:14px;color:${BRAND.textDark};font-weight:700;">${toEmail}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 0 0;">
                <span style="font-size:13px;color:#6B7280;font-weight:600;">Temporary Password</span>
              </td>
              <td align="right" style="padding:10px 0 0;">
                <span style="font-size:16px;color:${BRAND.navy};font-weight:700;font-family:monospace;letter-spacing:1px;">${tempPassword}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <div style="background:#FFFBEB;border:1px solid #FCD34D;border-radius:8px;padding:14px 18px;margin-bottom:8px;">
      <p style="margin:0;font-size:13px;color:#92400E;">
        🔐 &nbsp;<strong>Important:</strong> Please change your password immediately after your first login to keep your account secure.
      </p>
    </div>

    ${divider}
    <p style="color:${BRAND.textMuted};font-size:12px;margin:0;">Need help? Contact your school administrator or visit ${brand.siteHost()}.</p>
  `;
  await getClient().emails.send({
    from: FROM(),
    to: toEmail,
    subject: `Your ${brand.brandName()} account for ${schoolName}`,
    html: baseWrapper(body),
  });
};

// ── Send inquiry admin notification ──────────────────────────────────────────
const sendInquiryAdminEmail = async ({ inquiry }) => {
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!adminEmail) {
    console.warn('[Inquiry] ADMIN_NOTIFICATION_EMAIL not set, skipping admin email.');
    return;
  }

  const row = (label, value, shade) => `
    <tr style="background:${shade ? '#F8FAFC' : BRAND.white};">
      <td style="padding:11px 16px;font-size:13px;font-weight:600;color:#374151;border:1px solid ${BRAND.border};white-space:nowrap;width:36%;">${label}</td>
      <td style="padding:11px 16px;font-size:13px;color:${BRAND.textDark};border:1px solid ${BRAND.border};">${value}</td>
    </tr>
  `;

  const body = `
    <div style="background:${BRAND.successBg};border:1px solid ${BRAND.successBorder};border-radius:8px;padding:14px 18px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;font-weight:700;color:#0f766e;">🆕 New inquiry submitted from ${brand.siteHost()}</p>
    </div>

    <h2 style="margin:0 0 4px;font-size:22px;font-weight:700;color:${BRAND.textDark};">${inquiry.schoolName}</h2>
    <p style="margin:0 0 20px;font-size:13px;color:${BRAND.textLight};">${inquiry.country} &nbsp;·&nbsp; ${inquiry.teacherCount} teachers</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:8px;overflow:hidden;margin-bottom:24px;">
      ${row('Contact Person', inquiry.contactPerson, false)}
      ${row('Email', `<a href="mailto:${inquiry.email}" style="color:${BRAND.navy};font-weight:600;">${inquiry.email}</a>`, true)}
      ${row('Phone', inquiry.phone, false)}
      ${row('Country', inquiry.country, true)}
      ${row('Teacher Count', `${inquiry.teacherCount} teachers`, false)}
      ${inquiry.message ? row('Message', inquiry.message, true) : ''}
      ${row('Submitted', `${new Date().toLocaleString('en-GB', { timeZone: 'Africa/Nairobi' })} EAT`, false)}
    </table>

    <div style="background:#EFF6FF;border-left:4px solid ${BRAND.navy};border-radius:6px;padding:14px 18px;">
      <p style="margin:0;font-size:13px;font-weight:700;color:${BRAND.navy};">Action Required</p>
      <p style="margin:6px 0 0;font-size:13px;color:#1E40AF;">Follow up within 24 hours to schedule a demo call.</p>
    </div>

    ${divider}
    <p style="color:${BRAND.textMuted};font-size:12px;margin:0;">This is an automated notification from ${brand.brandName()}.</p>
  `;

  await getClient().emails.send({
    from: FROM(),
    to: adminEmail,
    subject: `New School Inquiry — ${inquiry.schoolName} (${inquiry.country})`,
    html: baseWrapper(body),
  });
};

// ── Send inquiry confirmation to user ────────────────────────────────────────
const sendInquiryConfirmationEmail = async ({ inquiry }) => {
  const body = `
    <h2 style="margin:0 0 6px;font-size:26px;font-weight:700;color:${BRAND.textDark};">Thank you, ${inquiry.contactPerson}! ✅</h2>
    <p style="margin:0 0 20px;font-size:13px;color:${BRAND.tealDark};font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Inquiry Received</p>

    <p style="color:${BRAND.textMid};font-size:15px;line-height:1.7;margin:0 0 20px;">
      We've received your inquiry for <strong style="color:${BRAND.textDark};">${inquiry.schoolName}</strong>. Our team will review the details and get in touch within <strong>24 hours</strong>.
    </p>

    <!-- Inquiry summary -->
    <div style="background:#F8FAFC;border:1px solid ${BRAND.border};border-radius:10px;padding:18px 22px;margin-bottom:24px;">
      <p style="margin:0 0 10px;font-size:11px;font-weight:700;color:${BRAND.textLight};text-transform:uppercase;letter-spacing:0.8px;">Your Inquiry Summary</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:5px 0;font-size:13px;color:${BRAND.textLight};width:44%;">School</td>
          <td style="padding:5px 0;font-size:13px;color:${BRAND.textDark};font-weight:600;">${inquiry.schoolName}</td>
        </tr>
        <tr>
          <td style="padding:5px 0;font-size:13px;color:${BRAND.textLight};">Country</td>
          <td style="padding:5px 0;font-size:13px;color:${BRAND.textDark};font-weight:600;">${inquiry.country}</td>
        </tr>
        <tr>
          <td style="padding:5px 0;font-size:13px;color:${BRAND.textLight};">Teachers</td>
          <td style="padding:5px 0;font-size:13px;color:${BRAND.textDark};font-weight:600;">${inquiry.teacherCount}</td>
        </tr>
      </table>
    </div>

    <!-- Next steps -->
    <div style="background:${BRAND.successBg};border:1px solid ${BRAND.successBorder};border-radius:10px;padding:20px 24px;margin-bottom:8px;">
      <p style="margin:0 0 14px;font-size:14px;font-weight:700;color:#0f766e;">What happens next?</p>
      <table cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:5px 0;vertical-align:top;">
            <div style="width:22px;height:22px;background:${BRAND.teal};border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:700;color:white;margin-right:12px;">1</div>
          </td>
          <td style="padding:5px 0 5px 12px;font-size:13px;color:${BRAND.textMid};line-height:1.6;">Our team reviews your inquiry</td>
        </tr>
        <tr>
          <td style="padding:5px 0;vertical-align:top;">
            <div style="width:22px;height:22px;background:${BRAND.teal};border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:700;color:white;margin-right:12px;">2</div>
          </td>
          <td style="padding:5px 0 5px 12px;font-size:13px;color:${BRAND.textMid};line-height:1.6;">Demo call scheduled within 24 hours</td>
        </tr>
        <tr>
          <td style="padding:5px 0;vertical-align:top;">
            <div style="width:22px;height:22px;background:${BRAND.teal};border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:700;color:white;margin-right:12px;">3</div>
          </td>
          <td style="padding:5px 0 5px 12px;font-size:13px;color:${BRAND.textMid};line-height:1.6;">School account created within 48 hours</td>
        </tr>
        <tr>
          <td style="padding:5px 0;vertical-align:top;">
            <div style="width:22px;height:22px;background:${BRAND.teal};border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:700;color:white;margin-right:12px;">4</div>
          </td>
          <td style="padding:5px 0 5px 12px;font-size:13px;color:${BRAND.textMid};line-height:1.6;">Teachers onboarded with the mobile app</td>
        </tr>
      </table>
    </div>

    ${divider}
    <p style="color:${BRAND.textMuted};font-size:12px;margin:0;">Questions? Reply to this email or visit <a href="${brand.siteUrl()}" style="color:${BRAND.tealDark};">${brand.siteHost()}</a>.</p>
  `;
  await getClient().emails.send({
    from: FROM(),
    to: inquiry.email,
    subject: `We received your inquiry — ${brand.brandName()}`,
    html: baseWrapper(body),
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// ERP Phase 1 — Parent-facing email templates (additive; nothing above changed)
// ─────────────────────────────────────────────────────────────────────────────

// ── Student RFID punch-in / punch-out notification ───────────────────────────
const sendStudentAttendanceEmail = async ({
  toEmail, schoolName, schoolLogoUrl, studentName, studentIdNumber,
  className, sectionName, date, time, eventType, // eventType: 'punch_in' | 'punch_out' | 'late'
}) => {
  const labels = {
    punch_in: { title: 'Punch In Recorded', emoji: '✅', color: BRAND.successBorder, verb: 'checked in' },
    punch_out: { title: 'Punch Out Recorded', emoji: '👋', color: BRAND.tealDark, verb: 'checked out' },
    late: { title: 'Late Arrival', emoji: '⏰', color: '#D97706', verb: 'arrived late' },
  };
  const l = labels[eventType] || labels.punch_in;
  const logo = schoolLogoUrl
    ? `<img src="${schoolLogoUrl}" alt="${schoolName}" style="height:36px;margin-bottom:16px;" />`
    : `<p style="margin:0 0 16px;font-size:14px;font-weight:700;color:${BRAND.navy};">${schoolName}</p>`;

  const body = `
    ${logo}
    <h2 style="margin:0 0 6px;font-size:24px;font-weight:700;color:${BRAND.textDark};">${l.emoji} ${l.title}</h2>
    <p style="margin:0 0 20px;font-size:13px;color:${l.color};font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Attendance Update</p>
    <p style="color:${BRAND.textMid};font-size:15px;line-height:1.7;margin:0 0 16px;">
      <strong style="color:${BRAND.textDark};">${studentName}</strong> (ID: ${studentIdNumber}, ${className} - ${sectionName}) ${l.verb} at <strong>${time}</strong> on ${date}.
    </p>
    ${divider}
    <p style="color:${BRAND.textMuted};font-size:12px;margin:0;">This is an automated notification from ${schoolName}, sent via the ${brand.brandName()} platform.</p>
  `;
  await getClient().emails.send({
    from: FROM(),
    to: toEmail,
    subject: `${l.title} — ${studentName}`,
    html: baseWrapper(body),
  });
};

// ── Fee due / overdue reminder ────────────────────────────────────────────────
const sendFeeReminderEmail = async ({
  toEmail, schoolName, schoolLogoUrl, studentName, studentIdNumber,
  amountDue, currency, dueDate, reminderType, // reminderType: 'due' | 'overdue'
}) => {
  const isOverdue = reminderType === 'overdue';
  const logo = schoolLogoUrl
    ? `<img src="${schoolLogoUrl}" alt="${schoolName}" style="height:36px;margin-bottom:16px;" />`
    : `<p style="margin:0 0 16px;font-size:14px;font-weight:700;color:${BRAND.navy};">${schoolName}</p>`;

  const body = `
    ${logo}
    <h2 style="margin:0 0 6px;font-size:24px;font-weight:700;color:${BRAND.textDark};">${isOverdue ? '⚠️ Overdue Fee Reminder' : '📌 Fee Payment Reminder'}</h2>
    <p style="margin:0 0 20px;font-size:13px;color:${isOverdue ? BRAND.errorText : BRAND.tealDark};font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">${schoolName}</p>
    <p style="color:${BRAND.textMid};font-size:15px;line-height:1.7;margin:0 0 12px;">
      A fee payment for <strong style="color:${BRAND.textDark};">${studentName}</strong> (ID: ${studentIdNumber}) ${isOverdue ? 'is now overdue' : 'is coming due'}.
    </p>
    <div style="background:${isOverdue ? BRAND.errorBg : BRAND.successBg};border:1px solid ${isOverdue ? BRAND.errorBorder : BRAND.successBorder};border-radius:8px;padding:14px 18px;margin:20px 0;">
      <p style="margin:0;font-size:15px;color:${BRAND.textDark};"><strong>Amount:</strong> ${currency} ${amountDue}</p>
      <p style="margin:4px 0 0;font-size:15px;color:${BRAND.textDark};"><strong>Due date:</strong> ${dueDate}</p>
    </div>
    ${divider}
    <p style="color:${BRAND.textMuted};font-size:12px;margin:0;">Please contact the school office if you have already made this payment or have any questions.</p>
  `;
  await getClient().emails.send({
    from: FROM(),
    to: toEmail,
    subject: `${isOverdue ? 'Overdue' : 'Reminder'}: Fee payment for ${studentName}`,
    html: baseWrapper(body),
  });
};

// ── Generic "your report is ready" notification (attendance or fee reports) ──
const sendReportReadyEmail = async ({ toEmail, schoolName, schoolLogoUrl, studentName, reportLabel, downloadUrl }) => {
  const logo = schoolLogoUrl
    ? `<img src="${schoolLogoUrl}" alt="${schoolName}" style="height:36px;margin-bottom:16px;" />`
    : `<p style="margin:0 0 16px;font-size:14px;font-weight:700;color:${BRAND.navy};">${schoolName}</p>`;
  const body = `
    ${logo}
    <h2 style="margin:0 0 6px;font-size:24px;font-weight:700;color:${BRAND.textDark};">📄 ${reportLabel} Ready</h2>
    <p style="color:${BRAND.textMid};font-size:15px;line-height:1.7;margin:0 0 16px;">
      A new ${reportLabel.toLowerCase()} for <strong style="color:${BRAND.textDark};">${studentName}</strong> is ready to download.
    </p>
    ${ctaButton(downloadUrl, 'Download Report →')}
    ${divider}
    <p style="color:${BRAND.textMuted};font-size:12px;margin:0;">Sent by ${schoolName} via the ${brand.brandName()} platform.</p>
  `;
  await getClient().emails.send({
    from: FROM(),
    to: toEmail,
    subject: `${reportLabel} ready — ${studentName}`,
    html: baseWrapper(body),
  });
};

const sendPromotionEmail = async ({ toEmail, schoolName, schoolLogoUrl, studentName, newClassName }) => {
  const logo = schoolLogoUrl
    ? `<img src="${schoolLogoUrl}" alt="${schoolName}" style="height:36px;margin-bottom:16px;" />`
    : `<p style="margin:0 0 16px;font-size:14px;font-weight:700;color:${BRAND.navy};">${schoolName}</p>`;
  const body = `
    ${logo}
    <h2 style="margin:0 0 6px;font-size:24px;font-weight:700;color:${BRAND.textDark};">🎓 Promotion Update</h2>
    <p style="color:${BRAND.textMid};font-size:15px;line-height:1.7;margin:0 0 16px;">
      <strong style="color:${BRAND.textDark};">${studentName}</strong> has been promoted to <strong>${newClassName}</strong>. Congratulations!
    </p>
    ${divider}
    <p style="color:${BRAND.textMuted};font-size:12px;margin:0;">Sent by ${schoolName} via the ${brand.brandName()} platform.</p>
  `;
  await getClient().emails.send({ from: FROM(), to: toEmail, subject: `${studentName} promoted to ${newClassName}`, html: baseWrapper(body) });
};

const sendParentPasswordResetEmail = async ({ toEmail, resetLink, parentName }) => {
  const body = `
    <h2 style="margin:0 0 6px;font-size:26px;font-weight:700;color:${BRAND.textDark};">Reset your password</h2>
    <p style="margin:0 0 20px;font-size:13px;color:${BRAND.tealDark};font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Parent Portal</p>
    <p style="color:${BRAND.textMid};font-size:15px;line-height:1.7;margin:0 0 12px;">
      Hi ${parentName || 'there'}, we received a request to reset your Parent Portal password. Click below to set a new one.
    </p>
    <div style="background:${BRAND.successBg};border:1px solid ${BRAND.successBorder};border-radius:8px;padding:14px 18px;margin:20px 0;">
      <p style="margin:0;font-size:13px;color:#0f766e;">⏱ &nbsp;<strong>This link expires in 1 hour.</strong></p>
    </div>
    ${ctaButton(resetLink, 'Reset My Password →')}
    <p style="color:${BRAND.textMuted};font-size:12px;margin-top:20px;">If you didn't request this, you can safely ignore this email.</p>
  `;
  await getClient().emails.send({ from: FROM(), to: toEmail, subject: 'Reset your Parent Portal password', html: baseWrapper(body) });
};

const sendParentActivationEmail = async ({ toEmail, activationLink, parentName, schoolName }) => {
  const body = `
    <h2 style="margin:0 0 6px;font-size:26px;font-weight:700;color:${BRAND.textDark};">Activate your account</h2>
    <p style="margin:0 0 20px;font-size:13px;color:${BRAND.tealDark};font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Parent Portal${schoolName ? ' · ' + schoolName : ''}</p>
    <p style="color:${BRAND.textMid};font-size:15px;line-height:1.7;margin:0 0 12px;">
      Hi ${parentName || 'there'}, an account has been created for you to follow your child's attendance, fees, and reports. Set your password to get started.
    </p>
    <div style="background:${BRAND.successBg};border:1px solid ${BRAND.successBorder};border-radius:8px;padding:14px 18px;margin:20px 0;">
      <p style="margin:0;font-size:13px;color:#0f766e;">⏱ &nbsp;<strong>This activation link expires in 7 days.</strong></p>
    </div>
    ${ctaButton(activationLink, 'Activate My Account →')}
  `;
  await getClient().emails.send({ from: FROM(), to: toEmail, subject: `Activate your Parent Portal account${schoolName ? ' — ' + schoolName : ''}`, html: baseWrapper(body) });
};

module.exports = {
  sendSchoolInviteEmail,
  sendPasswordResetEmail,
  sendTeacherWelcomeEmail,
  sendInquiryAdminEmail,
  sendInquiryConfirmationEmail,
  // ERP Phase 1 additions:
  sendStudentAttendanceEmail,
  sendFeeReminderEmail,
  sendReportReadyEmail,
  sendPromotionEmail,
  sendParentPasswordResetEmail,
  sendParentActivationEmail,
};