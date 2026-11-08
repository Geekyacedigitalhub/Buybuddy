/**
 * SMS delivery.
 *
 * OTP codes and order updates have to reach a real phone, so this module talks
 * to a real provider. Two are supported — pick one with SMS_PROVIDER:
 *
 *   Termii  (best for Nigeria: cheap, local sender IDs, DND-safe routes)
 *     SMS_PROVIDER=termii
 *     TERMII_API_KEY=...
 *     TERMII_SENDER_ID=BUYBUDDY      (must be approved in the Termii dashboard)
 *
 *   Twilio  (works everywhere, more expensive to Nigeria)
 *     SMS_PROVIDER=twilio
 *     TWILIO_ACCOUNT_SID=...
 *     TWILIO_AUTH_TOKEN=...
 *     TWILIO_FROM=+1...              (or TWILIO_MESSAGING_SERVICE_SID=...)
 *
 * With nothing configured the app still works: codes are written to the server
 * log and returned to the client in development, which is how the demo runs.
 * Nothing else in the codebase needs to change when keys are added.
 */
import { db } from './db.js';
import { now, uid } from './util.js';

const TIMEOUT_MS = 12_000;

export const smsProvider = () => (process.env.SMS_PROVIDER || '').trim().toLowerCase();

export const smsConfigured = () => {
  const p = smsProvider();
  if (p === 'termii') return Boolean(process.env.TERMII_API_KEY);
  if (p === 'twilio') return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (process.env.TWILIO_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID));
  return false;
};

/**
 * Nigerian numbers arrive in every shape: 0803…, +234803…, 234803…, 803…
 * Providers want E.164, so normalise to +234XXXXXXXXXX and reject what cannot
 * possibly be a Nigerian mobile number.
 */
export function normalisePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d+]/g, '');
  let p = digits;
  if (p.startsWith('+234')) p = p.slice(4);
  else if (p.startsWith('234')) p = p.slice(3);
  else if (p.startsWith('0')) p = p.slice(1);
  if (!/^[7-9]\d{9}$/.test(p)) return null; // NG mobile: 803, 806, 810, 703, 902 …
  return `+234${p}`;
}

const log = (row) => {
  try {
    db.prepare(
      `INSERT INTO sms_log (id, phone, body, provider, status, provider_ref, error, created_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(uid('sms'), row.phone, row.body, row.provider, row.status, row.providerRef || null, row.error || null, now());
  } catch (e) {
    console.warn('[sms] could not write delivery log:', e.message);
  }
};

const withTimeout = async (url, options) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
};

const sendViaTermii = async (to, body) => {
  const res = await withTimeout('https://api.ng.termii.com/api/sms/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to,
      from: process.env.TERMII_SENDER_ID || 'BUYBUDDY',
      sms: body,
      type: 'plain',
      channel: process.env.TERMII_CHANNEL || 'generic', // generic | dnd | whatsapp
      api_key: process.env.TERMII_API_KEY,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.code === 'error' || json.message === 'error') {
    throw new Error(json.message || `Termii responded ${res.status}`);
  }
  return { providerRef: json.message_id || json.pinId || null };
};

const sendViaTwilio = async (to, body) => {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const form = new URLSearchParams({ To: to, Body: body });
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', process.env.TWILIO_MESSAGING_SERVICE_SID);
  else form.set('From', process.env.TWILIO_FROM);
  const res = await withTimeout(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `Twilio responded ${res.status}`);
  return { providerRef: json.sid || null };
};

/**
 * Send one SMS. Never throws — a failed message must not break the order or the
 * signup that triggered it. Everything is written to sms_log for audit.
 */
export async function sendSms(rawPhone, body) {
  const phone = normalisePhone(rawPhone);
  const provider = smsProvider();

  if (!phone) {
    log({ phone: String(rawPhone || ''), body, provider: provider || 'none', status: 'invalid_phone', error: 'not a Nigerian mobile number' });
    return { ok: false, reason: 'invalid_phone' };
  }

  if (!smsConfigured()) {
    console.log(`[sms] (not configured) ${phone} -> ${body}`);
    log({ phone, body, provider: 'none', status: 'logged_only' });
    return { ok: false, reason: 'not_configured', phone };
  }

  try {
    const out = provider === 'termii' ? await sendViaTermii(phone, body) : await sendViaTwilio(phone, body);
    log({ phone, body, provider, status: 'sent', providerRef: out.providerRef });
    return { ok: true, phone, provider, providerRef: out.providerRef };
  } catch (e) {
    console.error(`[sms] delivery failed via ${provider}: ${e.message}`);
    log({ phone, body, provider, status: 'failed', error: e.message.slice(0, 300) });
    return { ok: false, reason: 'provider_error', phone, error: e.message };
  }
}

/** Fire-and-forget variant: used from synchronous request paths. */
export function sendSmsInBackground(rawPhone, body) {
  sendSms(rawPhone, body).catch((e) => console.error('[sms] unexpected:', e.message));
}

/** What the dashboard shows: is this actually reaching phones, or only the log? */
export function smsStatus() {
  const provider = smsProvider();
  let sent = 0;
  let failed = 0;
  try {
    sent = db.prepare("SELECT COUNT(*) c FROM sms_log WHERE status = 'sent'").get().c;
    failed = db.prepare("SELECT COUNT(*) c FROM sms_log WHERE status = 'failed'").get().c;
  } catch { /* table created later in startup order */ }
  return {
    provider: provider || null,
    configured: smsConfigured(),
    live: smsConfigured(),
    senderId: process.env.TERMII_SENDER_ID || process.env.TWILIO_FROM || null,
    sent,
    failed,
  };
}
