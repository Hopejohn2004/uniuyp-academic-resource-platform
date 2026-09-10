const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
const VERIFICATION_EXPIRY_HOURS = 24;
const RESET_EXPIRY_MINUTES = 30;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[ch]));
}

async function sendEmail(toEmail, subject, html) {
  if (!RESEND_API_KEY) return { sent: false, reason: 'no_api_key' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: toEmail,
        subject,
        html
      })
    });
    if (!res.ok) return { sent: false, reason: 'api_error' };
    return { sent: true };
  } catch (err) {
    console.log(`[email] ${err.message}`);
    return { sent: false, reason: 'network_error' };
  }
}

async function sendVerificationEmail(toEmail, fullName, verifyUrl) {
  return sendEmail(
    toEmail,
    'Verify your Academic Resource Platform account',
    `<p>Hi ${escapeHtml(fullName)},</p>` +
    `<p>Please verify your email address for the UNIUYO Academic Resource Platform.</p>` +
    `<p><a href="${escapeHtml(verifyUrl)}">Verify your account</a></p>` +
    `<p>This link expires in ${VERIFICATION_EXPIRY_HOURS} hours.</p>`
  );
}

async function sendPasswordResetEmail(toEmail, fullName, resetUrl) {
  return sendEmail(
    toEmail,
    'Reset your Academic Resource Platform password',
    `<p>Hi ${escapeHtml(fullName)},</p>` +
    `<p>A password reset was requested for your account.</p>` +
    `<p><a href="${escapeHtml(resetUrl)}">Reset your password</a></p>` +
    `<p>This link expires in ${RESET_EXPIRY_MINUTES} minutes. If you did not request this, ignore this email.</p>`
  );
}

module.exports = {
  RESEND_API_KEY,
  VERIFICATION_EXPIRY_HOURS,
  RESET_EXPIRY_MINUTES,
  escapeHtml,
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail
};
