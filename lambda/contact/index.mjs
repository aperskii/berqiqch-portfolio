/**
 * Contact form handler.
 *
 * Static form -> Lambda Function URL -> SES. Nothing is persisted anywhere:
 * the submission exists only for the lifetime of this invocation.
 *
 * Environment:
 *   MAIL_TO         required  recipient (verified SES identity)
 *   MAIL_FROM       required  verified sender identity
 *   ALLOWED_ORIGIN  required  exact origin allowed to call this, or "*"
 *   AUTO_REPLY      optional  "true" to send a confirmation to the sender.
 *                             Requires SES production access - in the sandbox
 *                             SES rejects unverified recipients.
 */

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const ses = new SESv2Client({});

const MAIL_TO = process.env.MAIL_TO;
const MAIL_FROM = process.env.MAIL_FROM;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
const AUTO_REPLY = process.env.AUTO_REPLY === 'true';

const LIMITS = {
  name: 100,
  email: 254,
  subject: 150,
  message: 5000
};

const MIN_MESSAGE = 10;

// Intentionally conservative. Rejects things SES would bounce anyway.
const EMAIL_RE = /^[^\s@,;:<>()[\]\\]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGIN === '*'
    ? '*'
    : (origin && origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN);

  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function reply(statusCode, body, origin) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...corsHeaders(origin)
    },
    body: JSON.stringify(body)
  };
}

/** Strip CR/LF so nothing submitted can forge extra mail headers. */
function oneLine(value, max) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, max);
}

function multiLine(value, max) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .trim()
    .slice(0, max);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function validate(payload) {
  const errors = [];

  const name = oneLine(payload.name, LIMITS.name);
  const email = oneLine(payload.email, LIMITS.email).toLowerCase();
  const subject = oneLine(payload.subject, LIMITS.subject);
  const message = multiLine(payload.message, LIMITS.message);

  if (!name) errors.push('Name is required.');
  if (!email) errors.push('Email is required.');
  else if (!EMAIL_RE.test(email)) errors.push('Email address is not valid.');

  if (!message) errors.push('Message is required.');
  else if (message.length < MIN_MESSAGE) {
    errors.push(`Message must be at least ${MIN_MESSAGE} characters.`);
  }

  // Raw lengths matter too: a 1 MB body should be rejected, not truncated.
  for (const [key, max] of Object.entries(LIMITS)) {
    if (typeof payload[key] === 'string' && payload[key].length > max) {
      errors.push(`${key} exceeds the maximum length of ${max} characters.`);
    }
  }

  return { errors, clean: { name, email, subject, message } };
}

function buildNotification({ name, email, subject, message }) {
  const heading = subject || 'New message from your portfolio';

  const text = [
    `From:    ${name} <${email}>`,
    `Subject: ${subject || '(none)'}`,
    '',
    message,
    '',
    '---',
    'Sent from the contact form on berqiqch.de'
  ].join('\n');

  const html = `<!doctype html>
<html><body style="margin:0;background:#f5f7fa;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
  <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e3e8ef;border-radius:12px;overflow:hidden">
    <div style="padding:18px 24px;border-bottom:1px solid #e3e8ef">
      <p style="margin:0;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#64748b">Portfolio contact form</p>
      <h1 style="margin:6px 0 0;font-size:18px;line-height:1.3">${escapeHtml(heading)}</h1>
    </div>
    <div style="padding:24px">
      <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#64748b">From</p>
      <p style="margin:0 0 20px;font-size:15px">
        ${escapeHtml(name)} &lt;<a href="mailto:${escapeHtml(email)}" style="color:#0d9488">${escapeHtml(email)}</a>&gt;
      </p>
      <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Message</p>
      <div style="font-size:15px;line-height:1.65;white-space:pre-wrap">${escapeHtml(message)}</div>
    </div>
  </div>
</body></html>`;

  return { subject: `[Portfolio] ${heading}`, text, html };
}

function buildAutoReply({ name, message }) {
  const text = [
    `Hello ${name},`,
    '',
    'thank you for your message — it arrived and I will get back to you shortly.',
    '',
    'For reference, this is what you sent:',
    '',
    message,
    '',
    'Best regards',
    'Yassine Berqiqch',
    'https://www.berqiqch.de'
  ].join('\n');

  const html = `<!doctype html>
<html><body style="margin:0;background:#f5f7fa;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
  <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e3e8ef;border-radius:12px;padding:28px">
    <p style="margin:0 0 16px;font-size:15px">Hello ${escapeHtml(name)},</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.65">
      thank you for your message — it arrived and I will get back to you shortly.
    </p>
    <p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Your message</p>
    <div style="font-size:14px;line-height:1.65;white-space:pre-wrap;padding:14px;background:#f8fafc;border-left:3px solid #14b8a6;border-radius:4px">${escapeHtml(message)}</div>
    <p style="margin:24px 0 0;font-size:15px">
      Best regards<br><strong>Yassine Berqiqch</strong><br>
      <a href="https://www.berqiqch.de" style="color:#0d9488">berqiqch.de</a>
    </p>
  </div>
</body></html>`;

  return { subject: 'Thank you for your message', text, html };
}

function sendEmail({ to, replyTo, subject, text, html }) {
  return ses.send(new SendEmailCommand({
    FromEmailAddress: MAIL_FROM,
    Destination: { ToAddresses: [to] },
    ...(replyTo ? { ReplyToAddresses: [replyTo] } : {}),
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: {
          Text: { Data: text, Charset: 'UTF-8' },
          Html: { Data: html, Charset: 'UTF-8' }
        }
      }
    }
  }));
}

export const handler = async (event) => {
  const headers = event?.headers ?? {};
  const origin = headers.origin ?? headers.Origin ?? '';
  const method =
    event?.requestContext?.http?.method ?? event?.httpMethod ?? 'POST';

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(origin), body: '' };
  }

  if (method !== 'POST') {
    return reply(405, { error: 'Method not allowed.' }, origin);
  }

  if (!MAIL_TO || !MAIL_FROM) {
    console.error('Misconfigured: MAIL_TO and MAIL_FROM must both be set.');
    return reply(500, { error: 'The contact form is misconfigured.' }, origin);
  }

  // Reject cross-origin callers unless the deployment opts into "*".
  if (ALLOWED_ORIGIN && ALLOWED_ORIGIN !== '*' && origin && origin !== ALLOWED_ORIGIN) {
    return reply(403, { error: 'Origin not allowed.' }, origin);
  }

  let raw = event?.body ?? '';
  if (event?.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');

  // Cheap guard before we spend cycles parsing.
  if (raw.length > 20000) {
    return reply(413, { error: 'Request body is too large.' }, origin);
  }

  let payload;
  try {
    payload = JSON.parse(raw || '{}');
  } catch {
    return reply(400, { error: 'Request body must be valid JSON.' }, origin);
  }

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return reply(400, { error: 'Request body must be a JSON object.' }, origin);
  }

  // Honeypot: humans never see this field. Answer 200 so bots learn nothing.
  if (typeof payload.company === 'string' && payload.company.trim() !== '') {
    console.log('Honeypot triggered; discarding submission.');
    return reply(200, { ok: true }, origin);
  }

  const { errors, clean } = validate(payload);
  if (errors.length) {
    return reply(400, { error: errors[0], errors }, origin);
  }

  const notification = buildNotification(clean);

  try {
    await sendEmail({
      to: MAIL_TO,
      replyTo: clean.email, // replying in the mail client answers the sender
      subject: notification.subject,
      text: notification.text,
      html: notification.html
    });
  } catch (err) {
    console.error('SES send to owner failed:', err);
    return reply(502, { error: 'Could not send your message. Please email me directly.' }, origin);
  }

  if (AUTO_REPLY) {
    const auto = buildAutoReply(clean);
    try {
      await sendEmail({
        to: clean.email,
        replyTo: MAIL_TO,
        subject: auto.subject,
        text: auto.text,
        html: auto.html
      });
    } catch (err) {
      // The message reached its destination; a failed courtesy copy is not an error
      // worth surfacing to the sender.
      console.warn('Auto-reply failed (non-fatal):', err?.name, err?.message);
    }
  }

  return reply(200, { ok: true }, origin);
};
