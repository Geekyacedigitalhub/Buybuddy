import { db } from './db.js';
import { settingsAll, notify, event, walletEntry, walletBalance } from './settings.js';
import { bad, hmacSha512, money, now, uid } from './util.js';
import { offerJob, transition } from './orders.js';

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || '';
const FLUTTERWAVE_SECRET = process.env.FLUTTERWAVE_SECRET_KEY || '';
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
    const res = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: order.__email || 'customer@buybuddy.ng',
        amount: order.total * 100, // Paystack works in kobo
        reference: ref,
        currency: 'NGN',
        callback_url: `${APP_URL}${callbackPath}`,
        metadata: { order_id: order.id, order_code: order.code },
      }),
    });
    const json = await res.json();
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

  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
  });
  const json = await res.json();
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
  if (!PAYSTACK_SECRET) throw bad('Webhook not configured');
  const expected = hmacSha512(PAYSTACK_SECRET, rawBody);
  if (!signature || expected !== signature) throw bad('Invalid webhook signature');
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

export function refundPayment(orderId, { amount, reason, actor }) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw bad('Order not found');
  if (!['paid', 'paid_cash'].includes(order.payment_status)) throw bad('This order has no captured payment to refund.');
  const amt = money(amount || order.total);
  const payment = db.prepare("SELECT * FROM payments WHERE order_id = ? AND status = 'success' ORDER BY created_at DESC LIMIT 1").get(orderId);
  if (payment) db.prepare("UPDATE payments SET status = 'refunded' WHERE id = ?").run(payment.id);
  db.prepare("UPDATE orders SET payment_status = 'refunded', updated_at = ? WHERE id = ?").run(now(), orderId);
  if (order.payment_method === 'wallet' || payment?.provider === 'wallet') {
    walletEntry(order.customer_id, { type: 'credit', amount: amt, orderId, description: `Refund — ${order.code}` });
  }
  db.prepare("UPDATE orders SET status = 'refunded', completed_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), orderId);
  event(orderId, { actorId: actor?.id, actorRole: 'admin', type: 'refunded', message: `Refund of ₦${amt.toLocaleString()} issued — ${reason || 'no reason given'}` });
  notify(order.customer_id, { title: `Refund issued — ${order.code}`, body: `₦${amt.toLocaleString()} has been refunded. ${reason || ''}`, kind: 'payment', orderId });
  return { refunded: amt };
}
