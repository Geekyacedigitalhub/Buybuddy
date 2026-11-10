import crypto from 'node:crypto';
import { db } from './db.js';
import { settingsAll, notify, event, walletEntry, walletBalance } from './settings.js';
import { bad, hmacSha512, money, now, uid } from './util.js';
import { offerJob, transition } from './orders.js';
import { pointsEntry } from './growth.js';

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

/**
 * Which ways a Nigerian customer can actually pay.
 *
 * - `card`          Visa, Mastercard, Verve
 * - `bank_transfer` a one-off account number to transfer into — the most trusted
 *                   option here, and it works from any banking app
 * - `bank`          Pay with Bank, which is how **OPay**, PalmPay, Kuda and 27
 *                   other banks/apps appear at checkout
 * - `ussd`          dial a code, works on a phone with no data at all
 * - `qr`            scan with a bank app
 *
 * `PAYSTACK_CHANNELS` overrides the list (comma separated) if you ever want to add
 * `apple_pay` or `eft`. Unknown names are dropped rather than sent to Paystack,
 * because one bad value fails the whole transaction.
 */
const KNOWN_CHANNELS = ['card', 'bank', 'bank_transfer', 'ussd', 'qr', 'eft', 'mobile_money', 'apple_pay', 'payattitude'];

export function paystackChannels() {
  const configured = String(process.env.PAYSTACK_CHANNELS || '')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  const wanted = configured.length ? configured : ['card', 'bank', 'bank_transfer', 'ussd', 'qr'];
  const valid = wanted.filter((c) => KNOWN_CHANNELS.includes(c));
  return valid.length ? valid : ['card'];
}

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
    /*
     * Order matters. markOrderPaid() steps aside for an order that already reads
     * "paid" or "paid_cash", so stamping paid_cash first left cash-on-delivery
     * orders sitting at pending_payment — the merchant could never accept them.
     * Confirm first, label the money second.
     */
    markOrderPaid(order.id, { provider: 'cash', reference: `cash_${order.id.slice(0, 8)}`, amount: order.total });
    db.prepare('UPDATE orders SET payment_status = ?, updated_at = ? WHERE id = ?').run('paid_cash', now(), order.id);
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
        channels: paystackChannels(),
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

/**
 * A bank transfer is not instant. The customer leaves for their banking app and
 * the money lands a minute later — or in ten. Paystack calls that `ongoing`,
 * `pending`, `queued`; those are not failures. Marking them failed would cancel
 * a perfectly good order while the money was still in flight, so only an
 * explicit failure counts as one.
 */
const IN_FLIGHT_STATUSES = ['ongoing', 'pending', 'queued', 'processing', 'send_otp', 'send_pin', 'pay_offline', 'abandoned'];

export function classifyProviderStatus(status) {
  if (status === 'success') return 'success';
  if (IN_FLIGHT_STATUSES.includes(status)) return 'pending';
  return 'failed';
}

/* ----------------------------- wallet top-ups ---------------------------- */

/**
 * Topping up a wallet is a payment like any other: the money has to be taken
 * before the credit appears. An earlier version of this screen simply added the
 * amount, which meant anyone could mint Naira into their own wallet and spend it
 * on real goods. Now it starts a real Paystack charge and the wallet is credited
 * only after Paystack (webhook, or an explicit verify on the way back) confirms
 * the money arrived — once, no matter how many times the callback fires.
 */
export async function initWalletTopup(user, amount, { callbackPath = '/#/payment/return' } = {}) {
  const naira = money(amount);
  const ref = `bbt_${user.id.slice(0, 8)}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  if (MOCK) {
    /* No provider is wired up, so there is no honest way to take the money.
       In development and tests the credit is instant and clearly labelled. */
    if (process.env.NODE_ENV === 'production') {
      throw bad('Card top-up is not switched on yet. Pay by card at checkout, or contact support to add money to your wallet.');
    }
    const balance = walletEntry(user.id, { type: 'credit', amount: naira, description: 'Wallet top-up (test mode)' });
    notify(user.id, { title: 'Wallet topped up', body: `₦${naira.toLocaleString()} added to your wallet.`, kind: 'payment' });
    return { balance, credited: naira, sandbox: true };
  }

  const { res, json } = await paystack('/transaction/initialize', {
    method: 'POST',
    body: {
      email: user.email || `wallet-${user.id}@buybuddy.ng`,
      amount: naira * 100,
      reference: ref,
      currency: 'NGN',
      channels: paystackChannels(),
      callback_url: `${APP_URL}${callbackPath}`,
      metadata: { purpose: 'wallet_topup', user_id: user.id },
    },
  });
  if (!res.ok || !json?.status) throw bad(json?.message || 'Could not start the top-up. Please try again.');

  db.prepare(
    'INSERT INTO wallet_topups (id,user_id,reference,amount,status,authorization_url,created_at) VALUES (?,?,?,?,?,?,?)'
  ).run(uid('wtu'), user.id, ref, naira, 'pending', json.data.authorization_url, now());

  return { payment_required: true, reference: ref, authorization_url: json.data.authorization_url, amount: naira };
}

/** Idempotent: three webhooks and two return-screen checks still credit once. */
export function creditWalletTopup(reference, payload) {
  const topup = db.prepare('SELECT * FROM wallet_topups WHERE reference = ?').get(reference);
  if (!topup) return null;
  if (topup.status === 'credited') return { status: 'success', alreadyProcessed: true, amount: topup.amount, topup };

  const paidKobo = payload?.amount ? money(payload.amount) : null;
  if (paidKobo != null && paidKobo < topup.amount * 100) {
    db.prepare("UPDATE wallet_topups SET status = 'failed' WHERE id = ?").run(topup.id);
    return { status: 'failed', amount: topup.amount, topup, message: 'The amount paid was less than the top-up.' };
  }

  const balance = walletEntry(topup.user_id, {
    type: 'credit',
    amount: topup.amount,
    description: 'Wallet top-up',
  });
  db.prepare("UPDATE wallet_topups SET status = 'credited', credited_at = ? WHERE id = ?").run(now(), topup.id);
  notify(topup.user_id, {
    title: 'Wallet topped up',
    body: `₦${topup.amount.toLocaleString()} added to your wallet.`,
    kind: 'payment',
  });
  return { status: 'success', amount: topup.amount, balance, topup };
}

/** The return screen asks this: has the top-up actually been paid for? */
export async function verifyWalletTopup(reference) {
  const topup = db.prepare('SELECT * FROM wallet_topups WHERE reference = ?').get(reference);
  if (!topup) return null;
  if (topup.status === 'credited') {
    return { status: 'success', alreadyProcessed: true, amount: topup.amount, balance: walletBalance(topup.user_id) };
  }
  if (topup.status === 'failed') return { status: 'failed', amount: topup.amount };

  if (MOCK) return creditWalletTopup(reference, { amount: topup.amount * 100, gateway_response: 'sandbox-approved' });

  const { res, json } = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
  if (!res.ok || !json?.status) throw bad('Could not verify this payment with the provider.');
  const data = json.data;
  if (data.status === 'success') {
    const out = creditWalletTopup(reference, data);
    return { ...out, balance: walletBalance(topup.user_id) };
  }
  if (classifyProviderStatus(data.status) === 'pending') {
    return {
      status: 'pending',
      message: data.gateway_response || 'Waiting for your bank to confirm the transfer.',
      amount: topup.amount,
    };
  }
  db.prepare("UPDATE wallet_topups SET status = 'failed' WHERE id = ?").run(topup.id);
  return { status: 'failed', amount: topup.amount };
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

  if (classifyProviderStatus(data.status) === 'pending') {
    db.prepare('UPDATE payments SET provider_payload = ? WHERE id = ?').run(JSON.stringify(data).slice(0, 4000), payment.id);
    return {
      status: 'pending',
      provider_status: data.status,
      message: data.gateway_response
        || (data.status === 'abandoned'
          ? 'This payment was not completed. Nothing has been charged.'
          : 'Waiting for your bank to confirm the transfer. This can take a few minutes.'),
      payment,
    };
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
    // Remember how they paid — card, transfer, USSD or bank wallet. Refunds and
    // reconciliation both go smoother when the channel is on the record.
    const channel = payload?.channel ? String(payload.channel).slice(0, 24) : null;
    db.prepare("UPDATE payments SET status = 'success', verified_at = ?, method = ?, provider_payload = ? WHERE id = ?").run(
      now(),
      channel || payment.method || 'card',
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

  // a wallet top-up is not attached to an order, so it settles here and returns
  const topup = db.prepare('SELECT * FROM wallet_topups WHERE reference = ?').get(ref);
  if (topup) {
    if (payload.event === 'charge.success') {
      creditWalletTopup(ref, payload.data);
      return { ok: true, processed: true, topup: true };
    }
    if (payload.event === 'charge.failed') {
      db.prepare("UPDATE wallet_topups SET status = 'failed' WHERE id = ?").run(topup.id);
      return { ok: true, processed: true, topup: true };
    }
    return { ok: true, ignored: true };
  }

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
export async function refundPayment(orderId, { amount, reason, actor, returnPoints = true }) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw bad('Order not found');
  if (order.payment_status === 'refunded') throw bad(`Everything on ${order.code} has already been refunded.`);
  if (!['paid', 'paid_cash'].includes(order.payment_status)) throw bad('This order has no captured payment to refund.');

  const captured = db
    .prepare("SELECT * FROM payments WHERE order_id = ? AND status IN ('success','refunded') ORDER BY created_at")
    .all(orderId);
  const paidTotal = captured.reduce((s, p) => s + p.amount, 0) || order.total;
  const givenBack = captured.reduce((s, p) => s + (p.refunded_amount || 0), 0);
  const remaining = Math.max(0, paidTotal - givenBack);
  if (remaining <= 0) throw bad(`Everything on ${order.code} has already been refunded.`);

  const amt = money(amount || remaining);
  if (amt <= 0) throw bad('Enter an amount to refund.');
  if (amt > remaining) {
    throw bad(`Only ₦${remaining.toLocaleString()} is left to refund on ${order.code} — ₦${givenBack.toLocaleString()} of ₦${paidTotal.toLocaleString()} has already gone back.`);
  }

  const payment = captured.filter((p) => p.status === 'success').pop() || captured[captured.length - 1];

  /*
   * Where the money goes has to match where it came from. A real card charge is
   * refunded at Paystack. Everything else — wallet, cash, or a demo reference
   * Paystack has never seen — is credited to the wallet, because that is the only
   * place the customer can actually spend it.
   */
  let sentToProvider = false;
  let refundNote = null;
  if (payment?.provider === 'paystack' && !MOCK) {
    const { res, json } = await paystack('/refund', {
      method: 'POST',
      body: {
        transaction: payment.reference,
        amount: Math.min(amt, payment.amount - (payment.refunded_amount || 0)) * 100,
        merchant_note: `BUYBUDDY refund ${order.code}: ${reason || 'no reason given'}`,
      },
    });
    if (!res.ok || !json?.status) {
      const said = String(json?.message || '').trim();
      const nothingCharged = /transaction not found|not been completed|no successful|not successful|does not exist/i.test(said);
      if (!nothingCharged) {
        throw bad(
          `Paystack refused this refund: “${said || 'no reason given'}”. ` +
          'Nothing has been marked refunded. Check the transaction in your Paystack dashboard — a refund needs enough balance in your Paystack account (Paystack → Balance) — then try again.'
        );
      }
      refundNote = { paystack: said, note: 'nothing was ever charged at Paystack — refunded to the wallet' };
    } else {
      sentToProvider = true;
      refundNote = { refund_status: json.data?.status || 'pending', refund_id: json.data?.id || null };
    }
  }

  const fully = givenBack + amt >= paidTotal;
  const tx = db.transaction(() => {
    if (payment) {
      const paidBack = (payment.refunded_amount || 0) + amt;
      db.prepare('UPDATE payments SET refunded_amount = ?, status = ?, provider_payload = ? WHERE id = ?').run(
        paidBack,
        paidBack >= payment.amount ? 'refunded' : 'success',
        JSON.stringify({ ...refundNote, refunded_amount: paidBack }).slice(0, 4000),
        payment.id
      );
    }
    if (!sentToProvider) {
      walletEntry(order.customer_id, { type: 'credit', amount: amt, orderId, description: `Refund — ${order.code}` });
    }
    db.prepare('UPDATE orders SET payment_status = ?, updated_at = ? WHERE id = ?').run(
      fully ? 'refunded' : order.payment_status,
      now(),
      orderId
    );
    if (fully) {
      db.prepare("UPDATE orders SET status = 'refunded', completed_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), orderId);
    }
    // points spent on the order come back with the money
    if (returnPoints && order.points_redeemed) {
      try {
        pointsEntry(order.customer_id, {
          type: 'adjust', points: order.points_redeemed, orderId,
          description: `Points returned — ${order.code} refunded`,
        });
      } catch (e) { console.error('[refund] points return failed:', e.message); }
    }
  });
  tx();

  const where = sentToProvider
    ? 'back to the card via Paystack (5–10 working days)'
    : 'to the BUYBUDDY wallet — spendable immediately';
  event(orderId, {
    actorId: actor?.id, actorRole: 'admin', type: 'refunded',
    message: `Refund of ₦${amt.toLocaleString()} issued ${where} — ${reason || 'no reason given'}${fully ? '' : ` (₦${(remaining - amt).toLocaleString()} still owed)`}`,
    meta: refundNote || undefined,
  });
  notify(order.customer_id, {
    title: `Refund issued — ${order.code}`,
    body: sentToProvider
      ? `₦${amt.toLocaleString()} is on its way back to your card — banks usually take 5–10 working days. ${reason || ''}`
      : `₦${amt.toLocaleString()} is in your BUYBUDDY wallet now, ready to spend. ${reason || ''}`,
    kind: 'payment',
    orderId,
  });
  return { refunded: amt, remaining: remaining - amt, to_card: sentToProvider, fully_refunded: fully };
}
