import crypto from 'node:crypto';
import { db } from './db.js';
import { settingsAll, notify, event, walletEntry, walletBalance } from './settings.js';
import { bad, hmacSha512, money, now, uid } from './util.js';
import { offerJob, transition } from './orders.js';

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || '';
const FLUTTERWAVE_SECRET = process.env.FLUTTERWAVE_SECRET_KEY || '';
const PAYSTACK_WEBHOOK_SECRET = process.env.PAYSTACK_WEBHOOK_SECRET || '';
const MOCK = !PAYSTACK_SECRET || process.env.PAYSTACK_MOCK === 'true';
const APP_URL = process.env.APP_URL || 'http://localhost:4000';

export const paymentModes = () => ({
  paystack: Boolean(PAYSTACK_SECRET) && !MOCK,
  flutterwave: Boolean(FLUTTERWAVE_SECRET),
  mock: MOCK,
  currency: 'NGN',
});

function reference(order) {
  return `bb_${order.id.slice(0, 8)}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Every call to Paystack goes through here.
 *
 * Paystack sits behind Cloudflare, which refuses requests whose User-Agent looks
 * like a script (error 1010, HTTP 403) — indistinguishable from a bad key unless
 * you look at the body. Naming ourselves fixes it and makes us visible in their
 * logs if anything ever needs explaining.
 */
const USER_AGENT = 'BUYBUDDY/1.0 (+https://buybuddy-805j.onrender.com)';

async function paystack(path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = {};
  try { json = await res.json(); } catch { /* non-JSON error page */ }
  return { res, json };
}

/**
 * Does Paystack actually accept the key we have? A key being *present* is not
 * the same as a key that *works* — a typo, a revoked key or a test key in live
 * mode all look identical from the inside until a customer tries to pay.
 * Asking for the balance is the cheapest honest question, cached for a minute so
 * the admin screen does not hammer the API.
 */
let reachability = { at: 0, value: null };

export async function paystackReachability() {
  if (!PAYSTACK_SECRET) return { configured: false, ok: false, detail: 'No key set.' };
  if (MOCK) return { configured: true, ok: false, detail: 'Sandbox mode is forced on (PAYSTACK_MOCK=true).' };
  if (Date.now() - reachability.at < 60_000 && reachability.value) return reachability.value;

  let value;
  try {
    const { res, json } = await paystack('/balance');
    if (res.ok && json?.status) {
      const ngn = (json.data || []).find((b) => String(b.currency).toUpperCase() === 'NGN');
      const naira = ngn ? Math.round(Number(ngn.balance) / 100) : null;
      value = {
        configured: true,
        ok: true,
        balance_naira: naira,
        detail: naira == null
          ? 'Paystack accepted the key.'
          : `Paystack accepted the key — NGN balance ₦${naira.toLocaleString()}.`,
      };
    } else if (res.status === 401 || res.status === 403) {
      value = {
        configured: true,
        ok: false,
        detail: json?.message || 'Paystack rejected this key. Check it is a live key with Transactions and Balance access.',
      };
    } else {
      value = { configured: true, ok: false, detail: json?.message || `Paystack answered ${res.status}.` };
    }
  } catch {
    // Network trouble is not the same as a bad key; say so instead of crying wolf.
    value = { configured: true, ok: false, transient: true, detail: 'Could not reach Paystack just now — try again in a minute.' };
  }
  reachability = { at: Date.now(), value };
  return value;
}

/**
 * Create a payment intent for an order and return the URL the client must open.
 * Idempotent per order: a pending intent is reused instead of double-charging.
 */
export async function initPayment(order, { method = 'paystack', callbackPath = '/#/payment/return' } = {}) {
  const s = settingsAll();
  const existing = db
    .prepare("SELECT * FROM payments WHERE order_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1")
    .get(order.id);
  if (existing) return { reference: existing.reference, authorization_url: existing.provider_payload, method: existing.method };

  if (method === 'cash') {
    if (!s.cod_enabled) throw bad('Cash on delivery is currently unavailable.');
    db.prepare('UPDATE orders SET payment_status = ?, updated_at = ? WHERE id = ?').run('paid_cash', now(), order.id);
    markOrderPaid(order.id, { provider: 'cash', reference: `cash_${order.id.slice(0, 8)}`, amount: order.total });
    return { method: 'cash', reference: null, authorization_url: null, paid: true };
  }

  if (method === 'wallet') {
    if (!s.wallet_enabled) throw bad('Wallet payments are currently unavailable.');
    const bal = walletBalance(order.customer_id);
    if (bal < order.total) throw bad(`Wallet balance is ₦${bal.toLocaleString()} — top up to continue.`);
    walletEntry(order.customer_id, { type: 'debit', amount: order.total, orderId: order.id, description: `Order ${order.code}` });
    const ref = reference(order);
    db.prepare(
      'INSERT INTO payments (id,order_id,provider,reference,amount,status,method,created_at,verified_at) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(uid('pay'), order.id, 'wallet', ref, order.total, 'success', 'wallet', now(), now());
    markOrderPaid(order.id, { provider: 'wallet', reference: ref, amount: order.total });
    return { method: 'wallet', reference: ref, authorization_url: null, paid: true };
  }

  const ref = reference(order);

  if (!MOCK) {
    const { res, json } = await paystack('/transaction/initialize', {
      method: 'POST',
      body: {
        email: order.__email || 'customer@buybuddy.ng',
        amount: order.total * 100, // Paystack works in kobo
        reference: ref,
        currency: 'NGN',
        callback_url: `${APP_URL}${callbackPath}`,
        metadata: { order_id: order.id, order_code: order.code },
      },
    });
    if (!res.ok || !json?.status) throw bad(json?.message || 'Could not start payment. Please try again.');
    db.prepare(
      'INSERT INTO payments (id,order_id,provider,reference,amount,status,method,provider_payload,created_at) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run(uid('pay'), order.id, 'paystack', ref, order.total, 'pending', 'card', json.data.authorization_url, now());
    return { reference: ref, authorization_url: json.data.authorization_url, method: 'paystack' };
  }

  /* ---- Sandbox mode: no keys configured, use the built-in test checkout ---- */
  const url = `${APP_URL}/#/pay/${ref}`;
  db.prepare(
    'INSERT INTO payments (id,order_id,provider,reference,amount,status,method,provider_payload,created_at) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(uid('pay'), order.id, 'sandbox', ref, order.total, 'pending', 'card', url, now());
  event(order.id, { type: 'payment_initiated', message: `Payment started (sandbox) — ₦${order.total.toLocaleString()}` });
  return { reference: ref, authorization_url: url, method: 'paystack', sandbox: true };
}

/** Server-side verification against the provider. Never trust the client. */
export async function verifyPayment(reference) {
  const payment = db.prepare('SELECT * FROM payments WHERE reference = ?').get(reference);
  if (!payment) throw bad('Unknown payment reference');
  if (payment.status === 'success') return { status: 'success', alreadyProcessed: true, payment };

  if (payment.provider === 'sandbox' || MOCK) {
    return completePayment(payment, { gateway_response: 'sandbox-approved' });
  }

  const { res, json } = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
  if (!res.ok || !json?.status) throw bad('Could not verify this payment with the provider.');
  const data = json.data;
  if (data.status === 'success' && money(data.amount) >= payment.amount * 100) {
    return completePayment(payment, data);
  }
  db.prepare("UPDATE payments SET status = 'failed', provider_payload = ? WHERE id = ?").run(JSON.stringify(data), payment.id);
  db.prepare("UPDATE orders SET payment_status = 'failed', updated_at = ? WHERE id = ?").run(now(), payment.order_id);
  event(payment.order_id, { type: 'payment_failed', message: 'Payment was not successful' });
  return { status: 'failed', payment };
}

/** Marks payment + order paid exactly once (idempotent under duplicate callbacks). */
export function completePayment(payment, payload) {
  const tx = db.transaction(() => {
    const fresh = db.prepare('SELECT * FROM payments WHERE id = ?').get(payment.id);
    if (fresh.status === 'success') return { status: 'success', alreadyProcessed: true, payment: fresh };
    db.prepare("UPDATE payments SET status = 'success', verified_at = ?, provider_payload = ? WHERE id = ?").run(
      now(),
      JSON.stringify(payload || {}).slice(0, 4000),
      payment.id
    );
    return { status: 'success', payment: fresh };
  });
  const result = tx();
  if (!result.alreadyProcessed) markOrderPaid(payment.order_id, { provider: payment.provider, reference: payment.reference, amount: payment.amount });
  return result;
}

export function markOrderPaid(orderId, { provider, reference: ref, amount }) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return null;
  if (order.payment_status === 'paid' || order.payment_status === 'paid_cash') return order;

  db.prepare("UPDATE orders SET payment_status = 'paid', updated_at = ? WHERE id = ?").run(now(), orderId);
  event(orderId, { type: 'payment_received', message: `Payment confirmed via ${provider} (₦${money(amount).toLocaleString()})`, meta: { reference: ref, provider } });
  notify(order.customer_id, { title: 'Payment confirmed', body: `Order ${order.code} is confirmed.`, kind: 'payment', orderId });

  const fresh = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (fresh.type === 'personal') {
    transition(orderId, 'open_for_shoppers', {
      actorRole: 'system',
      note: 'Shopping request is live — finding the best shopper for you',
    });
    if (settingsAll().auto_offer_jobs) offerJob(orderId, 'shopper');
  } else {
    transition(orderId, 'paid', { actorRole: 'system', note: 'Payment received — waiting for the store to accept' });
  }
  return fresh;
}

/** Paystack webhook: signature validated, then processing is idempotent. */
export function handlePaystackWebhook(rawBody, signature) {
  if (!PAYSTACK_SECRET && !PAYSTACK_WEBHOOK_SECRET) throw bad('Webhook not configured');

  /**
   * Paystack signs with HMAC-SHA512 over the raw body. Which secret it keys with
   * depends on the account: the classic secret key, or the newer webhook signing
   * secret (whsec_…) shown in the dashboard. Accept either — a mismatch here
   * means every real payment arrives and is thrown away — and compare in
   * constant time so the check cannot be probed a byte at a time.
   */
  const secrets = [PAYSTACK_WEBHOOK_SECRET, PAYSTACK_SECRET].filter(Boolean);
  const valid = Boolean(signature) && secrets.some((secret) => {
    const expected = hmacSha512(secret, rawBody);
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(String(signature), 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  if (!valid) throw bad('Invalid webhook signature');
  const payload = JSON.parse(rawBody);
  const ref = payload?.data?.reference;
  if (!ref) return { ok: true, ignored: true };
  const payment = db.prepare('SELECT * FROM payments WHERE reference = ?').get(ref);
  if (!payment) return { ok: true, ignored: true };
  if (payload.event === 'charge.success') {
    completePayment(payment, payload.data);
    return { ok: true, processed: true };
  }
  if (['charge.failed', 'transfer.failed'].includes(payload.event)) {
    db.prepare("UPDATE payments SET status = 'failed' WHERE id = ?").run(payment.id);
    db.prepare("UPDATE orders SET payment_status = 'failed', updated_at = ? WHERE id = ?").run(now(), payment.order_id);
    return { ok: true, processed: true };
  }
  return { ok: true, ignored: true };
}

/**
 * Refunds. Two very different situations hide behind one word:
 *
 *  - the money never left BUYBUDDY (wallet payments), so crediting the wallet back
 *    is the whole job;
 *  - a card was charged, and the money is sitting in the Paystack balance. Then
 *    saying "refunded" in our database while nothing moves is a lie the customer
 *    finds out about days later. So the refund is sent to Paystack first, and if
 *    Paystack refuses, the admin sees the reason and nothing is marked refunded.
 */
export async function refundPayment(orderId, { amount, reason, actor }) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw bad('Order not found');
  if (!['paid', 'paid_cash'].includes(order.payment_status)) throw bad('This order has no captured payment to refund.');
  const amt = money(amount || order.total);
  const payment = db.prepare("SELECT * FROM payments WHERE order_id = ? AND status = 'success' ORDER BY created_at DESC LIMIT 1").get(orderId);

  let refundNote = null;
  if (payment?.provider === 'paystack' && !MOCK) {
    const { res, json } = await paystack('/refund', {
      method: 'POST',
      body: {
        transaction: payment.reference,
        amount: Math.min(amt, payment.amount) * 100, // kobo, never more than was captured
        merchant_note: `BUYBUDDY refund ${order.code}: ${reason || 'no reason given'}`,
      },
    });
    if (!res.ok || !json?.status) {
      throw bad(json?.message || 'Paystack refused the refund — check the transaction in your Paystack dashboard.');
    }
    refundNote = { refund_status: json.data?.status || 'pending', refund_id: json.data?.id || null };
  }

  if (payment) {
    db.prepare("UPDATE payments SET status = 'refunded', provider_payload = ? WHERE id = ?").run(
      JSON.stringify({ ...refundNote, refunded_amount: amt }).slice(0, 4000),
      payment.id
    );
  }
  db.prepare("UPDATE orders SET payment_status = 'refunded', updated_at = ? WHERE id = ?").run(now(), orderId);
  if (order.payment_method === 'wallet' || payment?.provider === 'wallet') {
    walletEntry(order.customer_id, { type: 'credit', amount: amt, orderId, description: `Refund — ${order.code}` });
  }
  db.prepare("UPDATE orders SET status = 'refunded', completed_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), orderId);
  const where = payment?.provider === 'paystack' && !MOCK ? 'back to the customer\'s card via Paystack' : 'to the BUYBUDDY wallet';
  event(orderId, {
    actorId: actor?.id, actorRole: 'admin', type: 'refunded',
    message: `Refund of ₦${amt.toLocaleString()} issued ${where} — ${reason || 'no reason given'}`,
    meta: refundNote || undefined,
  });
  notify(order.customer_id, { title: `Refund issued — ${order.code}`, body: `₦${amt.toLocaleString()} has been refunded. ${reason || ''}`, kind: 'payment', orderId });
  return { refunded: amt };
}
