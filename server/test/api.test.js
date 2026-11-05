import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Integration tests: boot a throwaway database, seed it, start the real HTTP
 * server and drive complete marketplace flows over the API (not mocking the
 * business rules). Run with `npm test`.
 */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'buybuddy-test-'));
process.env.DATA_DIR = TMP;
process.env.DB_FILE = path.join(TMP, 'test.sqlite');
process.env.NODE_ENV = 'test';
process.env.ALLOW_DEV_OTP = 'true';
process.env.PAYSTACK_MOCK = 'true';
process.env.DISABLE_RATE_LIMIT = 'true'; // individual tests re-enable it where relevant

let server;
let base;

const api = (path, { method = 'GET', body, token, headers = {} } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

async function login(identifier, password = 'Password123!') {
  const res = await api('/api/auth/login', { method: 'POST', body: { identifier, password } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}

before(async () => {
  execFileSync(process.execPath, ['src/seed.js', '--reset'], { cwd: path.resolve('.'), env: process.env, stdio: 'pipe' });
  const { startServer } = await import('../src/app.js');
  server = await startServer(0, '127.0.0.1');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('health endpoint reports sandbox payment mode', async () => {
  const res = await api('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.payments.mock, true);
});

test('public config exposes Nigerian launch settings', async () => {
  const res = await api('/api/config');
  assert.equal(res.status, 200);
  assert.equal(res.body.settings.currency, 'NGN');
  assert.ok(res.body.settings.delivery_fee_base > 0);
});

test('rejects bad credentials', async () => {
  const res = await api('/api/auth/login', { method: 'POST', body: { identifier: 'customer@buybuddy.ng', password: 'wrong' } });
  assert.equal(res.status, 400);
});

test('registers a new customer and enforces OTP + Nigerian phone format', async () => {
  const bad = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Test', email: 't1@example.com', phone: '12345', password: 'Password123!' },
  });
  assert.equal(bad.status, 400);

  const res = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Testing User', email: 'newbie@example.com', phone: '08031234567', password: 'Password123!' },
  });
  assert.equal(res.status, 201);
  assert.ok(res.body.token);
  assert.equal(res.body.user.phone, '+2348031234567');
  const otp = res.body.verification.dev_code;
  const verify = await api('/api/auth/otp/verify', { method: 'POST', body: { phone: '08031234567', code: otp } });
  assert.equal(verify.status, 200);
  assert.equal(Boolean(verify.body.user.phone_verified), true);
});

test('search returns catalogue results and blocks unauthenticated cart access', async () => {
  const search = await api('/api/search?q=rice');
  assert.equal(search.status, 200);
  assert.ok(search.body.products.length >= 1);
  const cart = await api('/api/cart');
  assert.equal(cart.status, 401);
});

test('cart enforces single-store rule and produces a priced quote', async () => {
  const token = await login('customer@buybuddy.ng');
  await api('/api/cart', { method: 'DELETE', token });
  const products = await api('/api/products?limit=50');
  const green = products.body.products.find((p) => p.store.name === 'GreenMart Supermarket');
  const other = products.body.products.find((p) => p.store.name !== 'GreenMart Supermarket');

  const qty = Math.max(2, Math.ceil(3200 / green.price));
  const add = await api('/api/cart', { method: 'POST', token, body: { product_id: green.id, qty } });
  assert.equal(add.status, 201);
  assert.equal(add.body.items[0].qty, qty);

  const conflict = await api('/api/cart', { method: 'POST', token, body: { product_id: other.id, qty: 1 } });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'store_conflict');

  const quote = await api('/api/cart/quote', { method: 'POST', token, body: { promo_code: 'WELCOME10' } });
  assert.equal(quote.status, 200);
  assert.ok(quote.body.serviceFee > 0);
  assert.ok(quote.body.deliveryFee > 0);
  assert.ok(quote.body.discount > 0);
  assert.ok(quote.body.total > 0);
});

test('full merchant order lifecycle: checkout → pay → accept → deliver with PIN → settle', async () => {
  const customer = await login('customer@buybuddy.ng');
  const merchant = await login('merchant1@buybuddy.ng');
  const rider = await login('rider@buybuddy.ng');

  // wallet checkout keeps the test deterministic (no external gateway)
  const addresses = await api('/api/addresses', { token: customer });
  const addressId = addresses.body.addresses[0].id;
  await api('/api/wallet/topup', { method: 'POST', token: customer, body: { amount: 60000 } });

  const products = await api('/api/products?limit=50');
  const item = products.body.products.find((p) => p.store.name === 'GreenMart Supermarket');
  await api('/api/cart', { method: 'DELETE', token: customer });
  const qty = Math.max(1, Math.ceil(3000 / item.price));
  await api('/api/cart', { method: 'POST', token: customer, body: { product_id: item.id, qty } });

  const key = `test-${Date.now()}`;
  const checkout = await api('/api/orders/checkout', {
    method: 'POST',
    token: customer,
    headers: { 'Idempotency-Key': key },
    body: { address_id: addressId, payment_method: 'wallet' },
  });
  assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
  assert.equal(checkout.body.order.payment_status, 'paid');
  assert.equal(checkout.body.order.status, 'paid');
  const orderId = checkout.body.order.id;

  // replaying the same idempotency key must not create a second order
  const replay = await api('/api/orders/checkout', {
    method: 'POST',
    token: customer,
    headers: { 'Idempotency-Key': key },
    body: { address_id: addressId, payment_method: 'wallet' },
  });
  assert.equal(replay.body.replay, true);
  assert.equal(replay.body.order.id, orderId);

  // merchant accepts and marks ready
  const accept = await api(`/api/merchant/orders/${orderId}/accept`, { method: 'POST', token: merchant });
  assert.equal(accept.status, 200, JSON.stringify(accept.body));
  const ready = await api(`/api/merchant/orders/${orderId}/ready`, { method: 'POST', token: merchant });
  assert.equal(ready.body.order.status, 'ready_for_pickup');
  assert.ok(ready.body.riders_offered >= 1);

  // rider picks up the offered job
  const offers = await api('/api/offers?role=rider', { token: rider });
  assert.ok(offers.body.offers.some((o) => o.order_id === orderId));
  const take = await api(`/api/worker/jobs/${orderId}/accept`, { method: 'POST', token: rider, body: { role: 'rider' } });
  assert.equal(take.status, 200, JSON.stringify(take.body));

  // a second rider must not be able to take the same job
  const rider2 = await login('rider2@buybuddy.ng');
  const stolen = await api(`/api/worker/jobs/${orderId}/accept`, { method: 'POST', token: rider2, body: { role: 'rider' } });
  assert.equal(stolen.status, 400);

  await api(`/api/worker/jobs/${orderId}/pickup`, { method: 'POST', token: rider });
  const transit = await api(`/api/worker/jobs/${orderId}/in-transit`, { method: 'POST', token: rider });
  assert.equal(transit.body.order.status, 'in_transit');

  const detail = await api(`/api/orders/${orderId}`, { token: customer });
  const pin = detail.body.delivery_pin;
  assert.ok(pin, 'customer can see the delivery PIN');

  const wrong = await api(`/api/worker/jobs/${orderId}/deliver`, { method: 'POST', token: rider, body: { pin: '0000' } });
  assert.equal(wrong.status, 400, 'wrong PIN is rejected');

  const delivered = await api(`/api/worker/jobs/${orderId}/deliver`, { method: 'POST', token: rider, body: { pin } });
  assert.equal(delivered.body.order.status, 'delivered');

  const confirm = await api(`/api/orders/${orderId}/confirm-delivery`, { method: 'POST', token: customer });
  assert.equal(confirm.body.order.status, 'completed');

  const wallet = await api('/api/wallet', { token: rider });
  assert.ok(wallet.body.entries.some((e) => e.order_id === orderId && e.type === 'credit'), 'rider is paid on completion');

  const review = await api(`/api/orders/${orderId}/review`, { method: 'POST', token: customer, body: { rating: 5, comment: 'Great' } });
  assert.equal(review.status, 200);
});

test('personal shopping: shopper proposes, customer approves, basket total is recomputed', async () => {
  const customer = await login('customer@buybuddy.ng');
  const shopper = await login('shopper@buybuddy.ng');
  const addresses = await api('/api/addresses', { token: customer });
  await api('/api/wallet/topup', { method: 'POST', token: customer, body: { amount: 80000 } });

  const created = await api('/api/shopping/requests', {
    method: 'POST',
    token: customer,
    body: {
      address_id: addresses.body.addresses[0].id,
      payment_method: 'wallet',
      budget: 15000,
      instructions: 'Please buy the exact brand if available.',
      items: [
        { description: 'Cerelac 400g', qty: 2, target_price: 3000 },
        { description: 'Fresh strawberries', qty: 1, target_price: 4000 },
      ],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const orderId = created.body.order.id;
  assert.equal(created.body.order.status, 'open_for_shoppers');
  assert.equal(created.body.order.shopping_items.length, 2);

  const accept = await api(`/api/worker/jobs/${orderId}/accept`, { method: 'POST', token: shopper, body: { role: 'shopper' } });
  assert.equal(accept.status, 200, JSON.stringify(accept.body));
  await api(`/api/worker/jobs/${orderId}/start-shopping`, { method: 'POST', token: shopper });

  const detail = await api(`/api/orders/${orderId}`, { token: shopper });
  const [first, second] = detail.body.order.shopping_items;
  await api(`/api/worker/jobs/${orderId}/items/${first.id}`, {
    method: 'PATCH', token: shopper,
    body: { proposed_name: 'Nestlé Cerelac 400g', proposed_price: 3250, proposed_qty: 2, status: 'proposed' },
  });
  await api(`/api/worker/jobs/${orderId}/items/${second.id}`, {
    method: 'PATCH', token: shopper,
    body: { status: 'unavailable', note: 'Out of season' },
  });
  const submitted = await api(`/api/worker/jobs/${orderId}/submit-for-approval`, { method: 'POST', token: shopper });
  assert.equal(submitted.body.order.status, 'awaiting_approval');

  // the customer cannot approve from a different account
  const other = await login('zainab@buybuddy.ng');
  const denied = await api(`/api/orders/${orderId}/approvals`, { method: 'POST', token: other, body: { items: [{ id: first.id, action: 'approve' }] } });
  assert.equal(denied.status, 403);

  const approve = await api(`/api/orders/${orderId}/approvals`, {
    method: 'POST', token: customer,
    body: { items: [{ id: first.id, action: 'approve' }] },
  });
  assert.equal(approve.status, 200, JSON.stringify(approve.body));
  assert.equal(approve.body.order.status, 'approved');
  assert.equal(approve.body.order.approved_subtotal, 6500);

  const purchased = await api(`/api/worker/jobs/${orderId}/purchased`, { method: 'POST', token: shopper });
  assert.equal(purchased.body.order.status, 'ready_for_delivery');
});

test('payment webhook rejects an invalid signature', async () => {
  const res = await fetch(`${base}/api/webhooks/paystack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-paystack-signature': 'not-a-real-signature' },
    body: JSON.stringify({ event: 'charge.success', data: { reference: 'anything' } }),
  });
  assert.equal(res.status, 400);
});

test('role-based access: customers cannot reach admin or merchant APIs', async () => {
  const customer = await login('customer@buybuddy.ng');
  assert.equal((await api('/api/admin/overview', { token: customer })).status, 403);
  assert.equal((await api('/api/merchant/store', { token: customer })).status, 403);
  const admin = await login('admin@buybuddy.ng');
  const overview = await api('/api/admin/overview', { token: admin });
  assert.equal(overview.status, 200);
  assert.ok(overview.body.kpis.orders_total > 0);
});

test('admin can approve a pending merchant and verify a pending worker', async () => {
  const admin = await login('admin@buybuddy.ng');
  const merchants = await api('/api/admin/merchants', { token: admin });
  const pendingStore = merchants.body.merchants.find((m) => m.status === 'pending');
  assert.ok(pendingStore);
  const decision = await api(`/api/admin/merchants/${pendingStore.id}/decision`, {
    method: 'POST', token: admin, body: { decision: 'approve' },
  });
  assert.equal(decision.body.store.status, 'active');

  const workers = await api('/api/admin/workers', { token: admin });
  const pending = workers.body.workers.find((w) => w.verified === 0);
  const approved = await api(`/api/admin/workers/${pending.id}/decision`, {
    method: 'POST', token: admin, body: { decision: 'approve' },
  });
  assert.equal(approved.status, 200);
});

test('order state machine rejects illegal jumps', async () => {
  const admin = await login('admin@buybuddy.ng');
  const orders = await api('/api/admin/orders?status=paid', { token: admin });
  const order = orders.body.orders[0];
  assert.ok(order);
  const illegal = await api(`/api/admin/orders/${order.id}/status`, {
    method: 'POST', token: admin, body: { status: 'completed' },
  });
  assert.equal(illegal.status, 400);
});

/**
 * Drives a real merchant order from empty cart to `completed` (wallet payment),
 * which is the trigger for loyalty points and referral rewards.
 */
async function completeMerchantOrder(customerToken, { minTotal = 3000, extra = {} } = {}) {
  const merchant = await login('merchant1@buybuddy.ng');
  const rider = await login('rider@buybuddy.ng');
  let addresses = await api('/api/addresses', { token: customerToken });
  if (!addresses.body.addresses?.length) {
    const made = await api('/api/addresses', {
      method: 'POST', token: customerToken,
      body: { label: 'Home', line1: '12 Admiralty Way', area: 'Lekki Phase 1', city: 'Lagos', phone: '08031234567' },
    });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    addresses = await api('/api/addresses', { token: customerToken });
  }
  const addressId = addresses.body.addresses[0].id;
  await api('/api/wallet/topup', { method: 'POST', token: customerToken, body: { amount: 80000 } });

  const products = await api('/api/products?limit=50');
  const item = products.body.products.find((p) => p.store.name === 'GreenMart Supermarket');
  await api('/api/cart', { method: 'DELETE', token: customerToken });
  const qty = Math.max(1, Math.ceil(minTotal / item.price));
  await api('/api/cart', { method: 'POST', token: customerToken, body: { product_id: item.id, qty } });

  const checkout = await api('/api/orders/checkout', {
    method: 'POST',
    token: customerToken,
    headers: { 'Idempotency-Key': `h-${Date.now()}-${Math.random().toString(36).slice(2)}` },
    body: { address_id: addressId, payment_method: 'wallet', ...extra },
  });
  assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
  const orderId = checkout.body.order.id;

  await api(`/api/merchant/orders/${orderId}/accept`, { method: 'POST', token: merchant });
  await api(`/api/merchant/orders/${orderId}/ready`, { method: 'POST', token: merchant });
  await api(`/api/worker/jobs/${orderId}/accept`, { method: 'POST', token: rider, body: { role: 'rider' } });
  await api(`/api/worker/jobs/${orderId}/pickup`, { method: 'POST', token: rider });
  await api(`/api/worker/jobs/${orderId}/in-transit`, { method: 'POST', token: rider });
  const detail = await api(`/api/orders/${orderId}`, { token: customerToken });
  const delivered = await api(`/api/worker/jobs/${orderId}/deliver`, {
    method: 'POST', token: rider, body: { pin: detail.body.delivery_pin },
  });
  assert.equal(delivered.status, 200, JSON.stringify(delivered.body));
  const confirm = await api(`/api/orders/${orderId}/confirm-delivery`, { method: 'POST', token: customerToken });
  assert.equal(confirm.body.order.status, 'completed');

  return { orderId, order: checkout.body.order };
}

test('security headers, request id and readiness probe', async () => {
  const res = await fetch(base + '/api/health');
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('x-request-id'), 'every response carries a request id');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(res.headers.get('content-security-policy'), 'CSP is set');
  assert.ok(res.headers.get('referrer-policy'));

  const ready = await api('/api/ready');
  assert.equal(ready.status, 200);
  assert.equal(ready.body.ready, true);
  assert.equal(ready.body.db, 'ok');
});

test('rate limiting blocks repeated failed sign-ins with 429', async () => {
  process.env.DISABLE_RATE_LIMIT = 'false';
  try {
    let limited = null;
    for (let i = 0; i < 26 && !limited; i += 1) {
      const res = await api('/api/auth/login', {
        method: 'POST', body: { identifier: 'customer@buybuddy.ng', password: 'wrong-password' },
      });
      if (res.status === 429) limited = res;
    }
    assert.ok(limited, 'the 21st failed attempt is rejected');
    assert.equal(limited.body.code, 'rate_limited');
    assert.ok(Number(limited.body.retry_after) > 0);

    // a correct password from the same IP is also blocked while the window is open
    const stillBlocked = await api('/api/auth/login', {
      method: 'POST', body: { identifier: 'customer@buybuddy.ng', password: 'Password123!' },
    });
    assert.equal(stillBlocked.status, 429);
  } finally {
    process.env.DISABLE_RATE_LIMIT = 'true';
  }
});

test('saved lists: create, list, and delete a reusable shopping list', async () => {
  const customer = await login('customer@buybuddy.ng');

  const created = await api('/api/saved-lists', {
    method: 'POST', token: customer,
    body: {
      name: 'Weekly groceries',
      items: [
        { description: 'Golden Penny spaghetti', qty: 4, target_price: 1200 },
        { description: 'Peak milk sachets', qty: 10, target_price: 250 },
      ],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const listId = created.body.list.id;

  const listed = await api('/api/saved-lists', { token: customer });
  const found = listed.body.lists.find((l) => l.id === listId);
  assert.ok(found, 'the new list is returned');
  assert.equal(found.items.length, 2);

  const empty = await api('/api/saved-lists', { method: 'POST', token: customer, body: { name: 'Nothing', items: [] } });
  assert.equal(empty.status, 400, 'an empty list is rejected');

  const del = await api(`/api/saved-lists/${listId}`, { method: 'DELETE', token: customer });
  assert.equal(del.status, 200);
  const after = await api('/api/saved-lists', { token: customer });
  assert.ok(!after.body.lists.some((l) => l.id === listId), 'the list is gone');
});

test('scheduled delivery: future windows are accepted, invalid ones rejected', async () => {
  const customer = await login('customer@buybuddy.ng');
  const addresses = await api('/api/addresses', { token: customer });
  const addressId = addresses.body.addresses[0].id;
  const products = await api('/api/products?limit=50');
  const item = products.body.products.find((p) => p.store.name === 'GreenMart Supermarket');
  await api('/api/cart', { method: 'DELETE', token: customer });
  await api('/api/cart', { method: 'POST', token: customer, body: { product_id: item.id, qty: Math.max(1, Math.ceil(3000 / item.price)) } });

  const in3Days = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
  const okQuote = await api('/api/cart/quote', { method: 'POST', token: customer, body: { address_id: addressId, scheduled_for: in3Days } });
  assert.equal(okQuote.status, 200, JSON.stringify(okQuote.body));
  assert.equal(okQuote.body.scheduled, new Date(in3Days).toISOString(), 'quote echoes the requested slot');

  const tooSoon = await api('/api/cart/quote', {
    method: 'POST', token: customer,
    body: { address_id: addressId, scheduled_for: new Date(Date.now() + 10 * 60_000).toISOString() },
  });
  assert.ok(tooSoon.body.scheduled?.error, 'less than the minimum notice is flagged');

  const tooLate = await api('/api/cart/quote', {
    method: 'POST', token: customer,
    body: { address_id: addressId, scheduled_for: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString() },
  });
  assert.ok(tooLate.body.scheduled?.error, 'beyond the booking horizon is flagged');

  const rejected = await api('/api/orders/checkout', {
    method: 'POST', token: customer,
    headers: { 'Idempotency-Key': `sched-${Date.now()}` },
    body: { address_id: addressId, payment_method: 'wallet', scheduled_for: new Date(Date.now() + 3600_000).toISOString() },
  });
  assert.equal(rejected.status, 400, 'checkout refuses an invalid window');

  const { order } = await completeMerchantOrder(customer, { extra: { scheduled_for: in3Days } });
  assert.ok(order.scheduled_for, 'the order stores the chosen slot');
});

test('loyalty: points accrue on completion, redeem at checkout, refund on cancel', async () => {
  const admin = await login('admin@buybuddy.ng');
  // generous test rates so a single order crosses the redemption floor
  await api('/api/admin/settings', {
    method: 'PUT', token: admin,
    body: { settings: { loyalty_enabled: true, loyalty_points_per_1000: 100, loyalty_min_redeem: 100, loyalty_naira_per_point: 1, loyalty_max_redeem_percent: 20 } },
  });

  const customer = await login('customer@buybuddy.ng');
  const before = await api('/api/loyalty', { token: customer });
  assert.equal(before.status, 200);
  const startingBalance = before.body.balance;

  const { orderId, order } = await completeMerchantOrder(customer, { minTotal: 4000 });
  const expectedEarn = Math.floor((order.subtotal / 1000) * 100);

  const after = await api('/api/loyalty', { token: customer });
  assert.equal(after.body.balance, startingBalance + expectedEarn, 'points earned = floor(subtotal/1000 × rate)');
  assert.ok(after.body.entries.some((e) => e.order_id === orderId && e.points === expectedEarn), 'ledger records the earn');

  // idempotency: settling again must not double-credit
  const settleAgain = await api(`/api/admin/orders/${orderId}/settle`, { method: 'POST', token: admin });
  const stillSame = await api('/api/loyalty', { token: customer });
  assert.equal(stillSame.body.balance, after.body.balance, 'no double credit on re-settle');
  assert.ok([200, 400, 404].includes(settleAgain.status));

  // redeem at checkout
  const addresses = await api('/api/addresses', { token: customer });
  const addressId = addresses.body.addresses[0].id;
  const products = await api('/api/products?limit=50');
  const item = products.body.products.find((p) => p.store.name === 'GreenMart Supermarket');
  await api('/api/cart', { method: 'DELETE', token: customer });
  await api('/api/cart', { method: 'POST', token: customer, body: { product_id: item.id, qty: Math.max(1, Math.ceil(5000 / item.price)) } });

  const cartQuote = await api('/api/cart/quote', { method: 'POST', token: customer, body: { address_id: addressId } });
  const quoteSubtotal = cartQuote.body.subtotal;
  assert.ok(quoteSubtotal >= 5000, 'cart is large enough to redeem against');

  const preview = await api('/api/loyalty/preview', { method: 'POST', token: customer, body: { points: 100, subtotal: quoteSubtotal } });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.discount, 100, '1 point = ₦1 at the test rate');

  const tooMany = await api('/api/loyalty/preview', { method: 'POST', token: customer, body: { points: stillSame.body.balance + 5000, subtotal: quoteSubtotal } });
  assert.ok(tooMany.body.error, 'cannot spend more points than you own');

  const quote = await api('/api/cart/quote', { method: 'POST', token: customer, body: { address_id: addressId, loyalty_points: 100 } });
  assert.equal(quote.body.loyalty.discount, 100);
  const plainQuote = await api('/api/cart/quote', { method: 'POST', token: customer, body: { address_id: addressId } });
  assert.equal(quote.body.total, plainQuote.body.total - 100, 'the points discount comes off the order total');

  const checkout = await api('/api/orders/checkout', {
    method: 'POST', token: customer,
    headers: { 'Idempotency-Key': `loyal-${Date.now()}` },
    body: { address_id: addressId, payment_method: 'wallet', loyalty_points: 100 },
  });
  assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
  assert.equal(checkout.body.order.points_redeemed, 100, 'the redeemed points are stored on the order');
  // fees are recalculated at checkout, so compare the direction not the exact naira
  assert.ok(checkout.body.order.total < plainQuote.body.total, 'the order is cheaper than the same basket without points');

  const spent = await api('/api/loyalty', { token: customer });
  assert.equal(spent.body.balance, stillSame.body.balance - 100, 'points leave the balance at checkout');

  // cancelling before the merchant accepts refunds the points
  const cancel = await api(`/api/orders/${checkout.body.order.id}/cancel`, { method: 'POST', token: customer, body: { reason: 'Changed my mind' } });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
  const refunded = await api('/api/loyalty', { token: customer });
  assert.equal(refunded.body.balance, stillSame.body.balance, 'points are refunded when the order is cancelled');
});

test('referrals: code links at signup and pays out once, on the first completed order', async () => {
  const referrer = await login('customer@buybuddy.ng');
  const info = await api('/api/referrals', { token: referrer });
  assert.equal(info.status, 200);
  const code = info.body.code;
  assert.ok(code && code.length >= 4, 'the customer has a referral code');

  const check = await api('/api/referrals/validate', { method: 'POST', body: { code } });
  assert.equal(check.body.valid, true);
  const bogus = await api('/api/referrals/validate', { method: 'POST', body: { code: 'NOPE9999' } });
  assert.equal(bogus.body.valid, false);

  const phone = `0812${String(Date.now()).slice(-7)}`;
  const email = `referee${Date.now()}@buybuddy.ng`;
  const signup = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Amaka Test', email, phone, password: 'Password123!', role: 'customer', referral_code: code },
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  const referee = signup.body.token;

  const walletBefore = await api('/api/wallet', { token: referrer });
  const creditBefore = walletBefore.body.balance;

  await completeMerchantOrder(referee, { minTotal: 4000 });

  const walletAfter = await api('/api/wallet', { token: referrer });
  assert.equal(walletAfter.body.balance, creditBefore + 1000, 'referrer is paid ₦1,000');
  assert.ok(walletAfter.body.entries.some((e) => e.type === 'credit' && e.amount === 1000 && /referral/i.test(e.description || '')),
    'the referral credit is labelled in the wallet ledger');

  const summary = await api('/api/referrals', { token: referrer });
  assert.ok(summary.body.qualified >= 1);

  // a second completed order by the same referee must not pay again
  await completeMerchantOrder(referee, { minTotal: 4000 });
  const walletFinal = await api('/api/wallet', { token: referrer });
  assert.equal(walletFinal.body.balance, creditBefore + 1000, 'reward is paid exactly once per referee');
});

test('rewards summary endpoint powers the account screen', async () => {
  const customer = await login('customer@buybuddy.ng');
  const me = await api('/api/me/rewards', { token: customer });
  assert.equal(me.status, 200);
  assert.equal(typeof me.body.points, 'number');
  assert.ok(me.body.referral_code);
  assert.equal(me.body.loyalty.enabled, true);
});
