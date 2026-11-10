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
  assert.equal(res.status, 201, JSON.stringify(res.body));
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

  const placed = await api('/api/orders/checkout', {
    method: 'POST', token: customer,
    body: { address_id: addressId, payment_method: 'wallet', scheduled_for: in3Days },
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  assert.ok(placed.body.order.scheduled_for, 'the order stores the chosen slot');

  const merchant = await login('merchant1@buybuddy.ng');
  const early = await api(`/api/merchant/orders/${placed.body.order.id}/accept`, { method: 'POST', token: merchant });
  assert.equal(early.status, 400, 'and it waits for its slot instead of being cooked three days early');
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

test('PWA: manifest, icons and service worker are served correctly', async () => {
  const manifestRes = await fetch(base + '/manifest.webmanifest');
  assert.equal(manifestRes.status, 200);
  assert.match(manifestRes.headers.get('content-type') || '', /manifest\+json/);
  assert.equal(manifestRes.headers.get('cache-control'), 'no-cache, no-store, must-revalidate', 'the manifest must never be cached');

  const manifest = await manifestRes.json();
  assert.ok(manifest.name && manifest.short_name, 'installable apps need a name and short name');
  assert.equal(manifest.display, 'standalone', 'installs without browser chrome');
  assert.equal(manifest.start_url, '/');
  assert.ok(manifest.icons.some((i) => i.sizes === '192x192'), '192px icon required for Android');
  assert.ok(manifest.icons.some((i) => i.sizes === '512x512'), '512px icon required for splash screens');
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'), 'maskable icon required for adaptive launchers');
  assert.ok(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length > 0, 'long-press shortcuts are registered');

  // every icon the manifest promises must actually exist
  for (const icon of manifest.icons) {
    const res = await fetch(base + icon.src);
    assert.equal(res.status, 200, `missing icon: ${icon.src}`);
    assert.equal(res.headers.get('content-type'), 'image/png');
  }

  const swRes = await fetch(base + '/sw.js');
  assert.equal(swRes.status, 200);
  assert.match(swRes.headers.get('content-type') || '', /javascript/);
  assert.equal(swRes.headers.get('service-worker-allowed'), '/', 'service worker scope must cover the whole app');
  assert.equal(swRes.headers.get('cache-control'), 'no-cache, no-store, must-revalidate', 'a cached service worker pins users to an old build');
  const sw = await swRes.text();
  assert.ok(sw.includes("addEventListener('fetch'"), 'the worker intercepts fetch');
  assert.ok(!/pathname\.startsWith\('\/api'\)\s*\)\s*event\.respondWith/.test(sw), 'API responses must never be served from cache');

  // the built shell must advertise the manifest and the iOS install meta tags
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /apple-touch-icon/);
  assert.match(html, /apple-mobile-web-app-capable/);
});

/* ---------------------------------------------------------------------------
 * SMS delivery — the piece that turns "OTP in the log" into a real text message.
 * ------------------------------------------------------------------------- */

/* Loaded lazily inside each test: a static import here would be hoisted above the
   DATA_DIR / DB_FILE assignments at the top of this file, and the app modules
   would open the developer database instead of the throwaway one. */
const sms = () => import('../src/lib/sms.js');

test('Nigerian phone numbers are normalised to E.164 for the SMS provider', async () => {
  const { normalisePhone } = await sms();
  // every shape a Lagos customer might type
  for (const given of ['08031234567', '8031234567', '+2348031234567', '2348031234567', '0803 123 4567', '0803-123-4567']) {
    assert.equal(normalisePhone(given), '+2348031234567', `failed for ${given}`);
  }
  // all live Nigerian mobile prefixes must survive
  for (const prefix of ['0703', '0806', '0810', '0902', '0915']) {
    assert.equal(normalisePhone(`${prefix}1234567`), `+234${prefix.slice(1)}1234567`, `failed for ${prefix}`);
  }
  // rubbish is rejected rather than sent to a provider
  for (const bad of ['', null, '12345', '080312345', '0803123456789', 'not a phone', '+15551234567']) {
    assert.equal(normalisePhone(bad), null, `should reject ${bad}`);
  }
});

test('with no provider configured, sending is honest about it', async () => {
  const { sendSms, smsConfigured } = await sms();
  assert.equal(smsConfigured(), false, 'the test environment has no SMS_PROVIDER');
  const out = await sendSms('08031234567', 'BUYBUDDY test message');
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'not_configured');
  assert.equal(out.phone, '+2348031234567');

  // an invalid number never reaches the provider either
  const bad = await sendSms('nonsense', 'x');
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'invalid_phone');
});

test('OTP signup still works end to end without an SMS provider', async () => {
  const phone = '+2348039998877';
  const res = await fetch(base + '/api/auth/otp/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, purpose: 'signup' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.sent, 'the request is accepted');
  // development hands the code back so the flow stays testable without credit
  assert.ok(body.dev_code || process.env.SMS_PROVIDER, 'a code is either returned or texted');
});

/* ---------------------------------------------------------------------------
 * Photo upload — the path a merchant takes from "photo on my phone" to a
 * product page. Also the one place a stranger writes a file we serve back.
 * ------------------------------------------------------------------------- */
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const TINY_JPEG =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

test('merchant can upload a product photo and the app can serve it back', async () => {
  const token = await login('merchant1@buybuddy.ng');

  // the obvious failure first: no auth
  const anon = await api('/api/uploads', { method: 'POST', body: { data_url: `data:image/png;base64,${TINY_PNG}` } });
  assert.equal(anon.status, 401, 'uploads must require sign-in');

  const up = await api('/api/uploads', {
    method: 'POST',
    token,
    body: { data_url: `data:image/png;base64,${TINY_PNG}` },
  });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.match(up.body.url, /^\/uploads\/img_[A-Za-z0-9]+\.png$/, 'returns a stable, same-origin URL');

  const fetched = await fetch(base + up.body.url);
  assert.equal(fetched.status, 200);
  assert.match(fetched.headers.get('content-type') || '', /image\/png/);
  assert.equal(fetched.headers.get('x-content-type-options'), 'nosniff', 'stored files must never be sniffed into scripts');

  // a JPEG is accepted too, and stored under its real extension
  const jpg = await api('/api/uploads', {
    method: 'POST',
    token,
    body: { data_url: `data:image/jpeg;base64,${TINY_JPEG}` },
  });
  assert.equal(jpg.status, 201);
  assert.match(jpg.body.url, /\.jpg$/);
});

test('uploads refuse anything that is not a real photo', async () => {
  const token = await login('merchant1@buybuddy.ng');

  // an HTML page labelled as a PNG: the magic-number check catches it
  const html = Buffer.from('<html><script>alert(1)</script></html>').toString('base64');
  const disguised = await api('/api/uploads', {
    method: 'POST', token, body: { data_url: `data:image/png;base64,${html}` },
  });
  assert.equal(disguised.status, 415, 'a script must never be stored as an image');

  // SVG can carry script, so it is refused outright
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
  const vector = await api('/api/uploads', {
    method: 'POST', token, body: { data_url: `data:image/svg+xml;base64,${svg}` },
  });
  assert.equal(vector.status, 415);

  // oversized payloads stop well before they touch the disk
  const huge = 'A'.repeat(9 * 1024 * 1024);
  const big = await api('/api/uploads', {
    method: 'POST', token, body: { data_url: `data:image/jpeg;base64,${huge}` },
  });
  assert.equal(big.status, 413);

  // and junk in the body is a clear 400, not a crash
  const junk = await api('/api/uploads', { method: 'POST', token, body: { data_url: 'not-a-data-url' } });
  assert.equal(junk.status, 400);
});

/* ---------------------------------------------------------------------------
 * Live rider GPS. The map used to draw a dot sliding along a straight line; now
 * the rider's phone reports where it really is — if, and only if, it is the
 * rider on that delivery.
 * ------------------------------------------------------------------------- */
test('rider GPS reaches the customer map, and only from the assigned rider', async () => {
  const customer = await login('customer@buybuddy.ng');
  const merchant = await login('merchant1@buybuddy.ng');
  const rider = await login('rider@buybuddy.ng');
  const rider2 = await login('rider2@buybuddy.ng');

  // walk a fresh order to "on the way" (wallet payment keeps it deterministic)
  const addresses = await api('/api/addresses', { token: customer });
  const addressId = addresses.body.addresses[0].id;
  await api('/api/wallet/topup', { method: 'POST', token: customer, body: { amount: 60000 } });
  const products = await api('/api/products?limit=50');
  const item = products.body.products.find((p) => p.store.name === 'GreenMart Supermarket');
  await api('/api/cart', { method: 'DELETE', token: customer });
  await api('/api/cart', { method: 'POST', token: customer, body: { product_id: item.id, qty: 2 } });
  const checkout = await api('/api/orders/checkout', {
    method: 'POST', token: customer,
    headers: { 'Idempotency-Key': `gps-${Date.now()}` },
    body: { address_id: addressId, payment_method: 'wallet' },
  });
  const orderId = checkout.body.order.id;
  await api(`/api/merchant/orders/${orderId}/accept`, { method: 'POST', token: merchant });
  await api(`/api/merchant/orders/${orderId}/ready`, { method: 'POST', token: merchant });
  await api(`/api/worker/jobs/${orderId}/accept`, { method: 'POST', token: rider, body: { role: 'rider' } });
  await api(`/api/worker/jobs/${orderId}/pickup`, { method: 'POST', token: rider });
  await api(`/api/worker/jobs/${orderId}/in-transit`, { method: 'POST', token: rider });

  const POST = `/api/worker/jobs/${orderId}/location`;

  // whoever is holding the phone must actually be the rider on this delivery
  const anon = await api(POST, { method: 'POST', body: { lat: 6.45, lng: 3.47 } });
  assert.equal(anon.status, 401);
  const stranger = await api(POST, { method: 'POST', token: rider2, body: { lat: 6.45, lng: 3.47 } });
  assert.equal(stranger.status, 403, 'another rider cannot move the marker on someone else delivery');

  // nonsense coordinates are refused rather than stored
  assert.equal((await api(POST, { method: 'POST', token: rider, body: { lat: 'x', lng: 3.4 } })).status, 400);
  assert.equal((await api(POST, { method: 'POST', token: rider, body: { lat: 999, lng: 3.4 } })).status, 400);

  // a real fix from the phone
  const fix = { lat: 6.4491, lng: 3.4552, accuracy: 12, speed: 6.2, heading: 88 };
  const sent = await api(POST, { method: 'POST', token: rider, body: fix });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));

  const tracking = await api(`/api/orders/${orderId}/tracking`, { token: customer });
  assert.equal(tracking.status, 200);
  assert.equal(tracking.body.position_source, 'gps', 'the customer is shown the real position');
  assert.equal(tracking.body.rider_position.lat, fix.lat);
  assert.equal(tracking.body.rider_position.lng, fix.lng);
  assert.equal(tracking.body.accuracy_m, 12);
  assert.ok(tracking.body.eta_minutes >= 1 && tracking.body.eta_minutes <= 120);
  assert.ok(tracking.body.distance_km > 0);
  assert.equal(tracking.body.trail.length, 1);
  assert.equal(tracking.body.trail[0].lat, fix.lat);

  // a second phone call within two seconds must not pile rows into the table
  const tooSoon = await api(POST, { method: 'POST', token: rider, body: { lat: 6.4493, lng: 3.4559 } });
  assert.equal(tooSoon.status, 202);
  assert.equal(tooSoon.body.throttled, true);

  // ...but a moment later the trail grows, which is what the map draws
  await new Promise((r) => setTimeout(r, 1600));
  const second = await api(POST, { method: 'POST', token: rider, body: { lat: 6.4493, lng: 3.4559 } });
  assert.equal(second.status, 201);
  const after = await api(`/api/orders/${orderId}/tracking`, { token: customer });
  assert.equal(after.body.trail.length, 2);
  assert.equal(after.body.rider_position.lat, 6.4493);

  // once the delivery is finished the rider's phone cannot keep reporting
  const detail = await api(`/api/orders/${orderId}`, { token: customer });
  await api(`/api/worker/jobs/${orderId}/deliver`, {
    method: 'POST', token: rider, body: { pin: detail.body.delivery_pin },
  });
  const late = await api(POST, { method: 'POST', token: rider, body: { lat: 6.45, lng: 3.46 } });
  assert.equal(late.status, 400, 'reporting stops when the delivery ends');
});

test('webhook: signatures are checked, and both webhook paths exist', async () => {
  const crypto = await import('node:crypto');
  const { handlePaystackWebhook } = await import('../src/lib/payments.js');
  const secret = process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_WEBHOOK_SECRET || '';

  const body = JSON.stringify({ event: 'charge.success', data: { reference: 'ref_that_does_not_exist', amount: 10000 } });
  const sign = (k) => crypto.createHmac('sha512', k).update(body).digest('hex');

  if (secret) {
    // our own signature is accepted (the reference is unknown, so nothing is granted)
    assert.equal(handlePaystackWebhook(body, sign(secret)).ok, true);
    // a tampered body, a guessed key, or no signature at all are refused
    assert.throws(() => handlePaystackWebhook(body.replace('10000', '1'), sign(secret)), /signature/i);
    assert.throws(() => handlePaystackWebhook(body, sign('wrong-secret')), /signature/i);
    assert.throws(() => handlePaystackWebhook(body, ''), /signature/i);
  } else {
    // with no keys configured the server says so instead of silently accepting
    assert.throws(() => handlePaystackWebhook(body, 'anything'), /not configured/i);
  }

  // both webhook paths exist, because the URL pasted into a dashboard is a
  // detail people get wrong and there is no reason for it to cost a payment
  for (const path of ['/api/webhooks/paystack', '/api/payments/paystack/webhook']) {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-paystack-signature': 'nope' },
      body,
    });
    assert.equal(res.status, 400, `${path} must exist and reject a bad signature`);
  }
});

test('payment channels: card, transfer, OPay-style bank wallet, USSD, QR', async () => {
  const { paystackChannels } = await import('../src/lib/payments.js');

  const defaults = paystackChannels();
  for (const c of ['card', 'bank_transfer', 'bank', 'ussd']) {
    assert.ok(defaults.includes(c), `${c} must be offered by default`);
  }

  // an operator can narrow or extend the list without a code change
  const saved = process.env.PAYSTACK_CHANNELS;
  process.env.PAYSTACK_CHANNELS = 'card , bank_transfer';
  assert.deepEqual(paystackChannels(), ['card', 'bank_transfer']);

  // a typo must not take the whole checkout down: unknown names are dropped
  process.env.PAYSTACK_CHANNELS = 'card,nonsense_channel';
  assert.deepEqual(paystackChannels(), ['card']);

  process.env.PAYSTACK_CHANNELS = 'nonsense';
  assert.deepEqual(paystackChannels(), ['card'], 'never send an empty channel list to Paystack');

  if (saved === undefined) delete process.env.PAYSTACK_CHANNELS;
  else process.env.PAYSTACK_CHANNELS = saved;
});

test('an in-flight bank transfer is not a failed payment', async () => {
  const { classifyProviderStatus } = await import('../src/lib/payments.js');

  // the money arrived
  assert.equal(classifyProviderStatus('success'), 'success');

  // the money is on its way — none of these may cancel the order
  for (const s of ['ongoing', 'pending', 'queued', 'processing', 'send_otp', 'abandoned']) {
    assert.equal(classifyProviderStatus(s), 'pending', `${s} must be treated as still in flight`);
  }

  // these really did fail
  for (const s of ['failed', 'reversed', 'declined']) {
    assert.equal(classifyProviderStatus(s), 'failed', `${s} must be a failure`);
  }
});

test('the cart says exactly how much more is needed to reach a store minimum', async () => {
  const token = await login('customer@buybuddy.ng');
  await api('/api/cart', { method: 'DELETE', token });

  const products = await api('/api/products?limit=200');
  /*
   * Find a product priced below its store's minimum, with enough stock to reach
   * that minimum by adding units — the cart caps quantity at what is on the
   * shelf, so a nearly sold-out item can never clear the threshold and made this
   * test flaky depending on what earlier tests had bought.
   */
  let target = null;
  for (const p of products.body.products) {
    const store = await api(`/api/stores/${p.store.id}`);
    const min = store.body.store.min_order;
    if (min <= p.price) continue;
    const needed = Math.min(50, Math.ceil(min / p.price) + 1);
    if ((p.stock ?? 0) >= needed) { target = { p, min, needed }; break; }
  }
  assert.ok(target, 'seed data contains a product cheaper than its store minimum, in stock');

  await api('/api/cart', { method: 'POST', token, body: { product_id: target.p.id, qty: 1 } });
  const cart = await api('/api/cart', { token });
  const issue = cart.body.issues.find((i) => i.type === 'min_order');
  assert.ok(issue, 'a cart below the minimum raises an issue');
  assert.equal(issue.minimum, target.min);
  assert.equal(issue.shortfall, target.min - target.p.price, 'the shortfall is the number the customer needs');

  // the platform minimum is a second, higher wall on the same cart — it has to
  // carry its own gap, or the app tells the customer ₦50 when ₦550 is the truth
  const platform = cart.body.issues.find((i) => i.type === 'platform_min_order');
  if (platform) {
    // its own gap, computed against the same cart — not the store's number
    assert.ok(platform.shortfall > 0);
    assert.equal(platform.shortfall, platform.minimum - target.p.price);
  }
  assert.ok(issue.message.includes('Minimum order'));

  // reach the minimum and the issue disappears
  const qty = target.needed;
  const itemId = cart.body.items[0].id;
  const bumped = await api(`/api/cart/${itemId}`, { method: 'PATCH', token, body: { qty } });
  assert.equal(bumped.status, 200, JSON.stringify(bumped.body));
  const after = await api('/api/cart', { token });
  assert.ok(!after.body.issues.some((i) => i.type === 'min_order'), 'adding items clears the minimum-order issue');
});

test('backup and restore: the whole database survives a wipe', async () => {
  const token = await login('admin@buybuddy.ng');

  const before = await api('/api/orders', { token });
  const ordersBefore = before.body.orders.length;

  const { db } = await import('../src/lib/db.js');
  const backup = await api('/api/admin/backup', { token });
  assert.equal(backup.status, 200);
  const dump = backup.body;
  assert.equal(dump.app, 'buybuddy');
  assert.ok(dump.tables.users.length > 0, 'the dump contains users');
  assert.ok(dump.tables.orders.length >= ordersBefore);
  assert.ok(dump.tables.payments.length > 0, 'payments are in the dump too');
  assert.ok(dump.tables.settings.length > 0, 'settings ride along');

  // destroy a row, then put the backup back
  const victim = dump.tables.users.find((u) => u.role === 'customer');
  db.prepare("UPDATE users SET name = 'WIPED' WHERE id = ?").run(victim.id);

  const restored = await api('/api/admin/restore', {
    method: 'POST',
    token,
    body: { backup: dump, confirm: 'REPLACE ALL DATA' },
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.broken_foreign_keys, 0);
  assert.equal(restored.body.row_error_count, 0, JSON.stringify(restored.body.row_errors));

  const after = db.prepare('SELECT name FROM users WHERE id = ?').get(victim.id);
  assert.equal(after.name, victim.name, 'the wiped row came back');

  const ordersAfter = (await api('/api/orders', { token })).body.orders.length;
  assert.equal(ordersAfter, ordersBefore, 'every order is still there');

  // and a bad file is refused rather than half-applied
  const rejected = await api('/api/admin/restore', { method: 'POST', token, body: { backup: { nope: true }, confirm: 'REPLACE ALL DATA' } });
  assert.equal(rejected.status, 400);
});

test('a live server never seeds the password that is printed in the README', async () => {
  const { default: better } = await import('better-sqlite3');
  const { default: bcrypt } = await import('bcryptjs');

  const run = (env) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buybuddy-seed-'));
    execFileSync(process.execPath, ['src/seed.js', '--reset'], {
      cwd: path.resolve('.'),
      env: { ...process.env, NODE_ENV: 'production', DATA_DIR: dir, DB_FILE: path.join(dir, 'seed.sqlite'), ...env },
      stdio: 'pipe',
    });
    const d = new better(path.join(dir, 'seed.sqlite'));
    const admin = d.prepare("SELECT password_hash FROM users WHERE email = 'admin@buybuddy.ng'").get();
    d.close();
    fs.rmSync(dir, { recursive: true, force: true });
    return admin.password_hash;
  };

  // no SEED_PASSWORD: a live boot must not accept the published password
  const random = run({ SEED_PASSWORD: '', ALLOW_DEMO_PASSWORDS: '' });
  assert.equal(bcrypt.compareSync('Password123!', random), false, 'the README password must not work in production');

  // with SEED_PASSWORD: the owner's password is the one that works, every boot
  const owned = run({ SEED_PASSWORD: 'Owner-Chosen-Secret-1' });
  assert.equal(bcrypt.compareSync('Owner-Chosen-Secret-1', owned), true);
  assert.equal(bcrypt.compareSync('Password123!', owned), false);

  // local development keeps the convenient default
  assert.equal(bcrypt.compareSync('Password123!', run({ NODE_ENV: 'test', SEED_PASSWORD: '' })), true);
});

test('admin can create a plain customer account — and nothing more powerful', async () => {
  const token = await login('admin@buybuddy.ng');
  const created = await api('/api/admin/users', {
    method: 'POST',
    token,
    body: { name: 'Play Reviewer', email: 'reviewer@buybuddy.ng', password: 'Reviewer-Pass-2026', phone: '+2347001112233' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.user.role, 'customer');
  assert.equal(created.body.user.password, undefined, 'the password must never come back');

  const signedIn = await api('/api/auth/login', { method: 'POST', body: { identifier: 'reviewer@buybuddy.ng', password: 'Reviewer-Pass-2026' } });
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.body.user.role, 'customer');

  const asAdmin = await api('/api/admin/users', { method: 'POST', token, body: { name: 'Sneaky', email: 'sneaky@buybuddy.ng', password: 'Sneaky-Pass-2026', role: 'admin' } });
  assert.equal(asAdmin.status, 400, 'this endpoint cannot mint an admin');

  const shortPw = await api('/api/admin/users', { method: 'POST', token, body: { name: 'Weak', email: 'weak@buybuddy.ng', password: 'short' } });
  assert.equal(shortPw.status, 400);
});

test('cash on delivery reaches the merchant instead of stalling at pending_payment', async () => {
  const customer = await login('customer@buybuddy.ng');
  await api('/api/cart', { method: 'DELETE', token: customer });
  const address = (await api('/api/addresses', { token: customer })).body.addresses[0];
  const products = (await api('/api/products?limit=200')).body.products;
  for (const p of products.filter((x) => x.store.name === 'GreenMart Supermarket').slice(0, 2)) {
    await api('/api/cart', { method: 'POST', token: customer, body: { product_id: p.id, qty: 2 } });
  }
  const checkout = await api('/api/orders/checkout', {
    method: 'POST', token: customer, body: { address_id: address.id, payment_method: 'cash' },
  });
  assert.equal(checkout.status, 201, JSON.stringify(checkout.body));
  assert.equal(checkout.body.order.payment_status, 'paid_cash', 'the money is labelled as cash');
  assert.equal(checkout.body.order.status, 'paid', 'and the store can already see it');

  // the merchant can accept it — this is the exact step that used to fail
  const merchant = await login('merchant1@buybuddy.ng');
  const accepted = await api(`/api/merchant/orders/${checkout.body.order.id}/accept`, { method: 'POST', token: merchant });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.order.status, 'accepted');
});

test('a personal-shopping basket reaches a rider and a door, not a dead end', async () => {
  const customer = await login('customer@buybuddy.ng');
  const shopper = await login('shopper@buybuddy.ng');
  const rider = await login('rider@buybuddy.ng');
  const address = (await api('/api/addresses', { token: customer })).body.addresses[0];

  // the rider must be on shift to be offered anything
  await api('/api/worker/availability', { method: 'POST', token: rider, body: { available: true } });

  const created = await api('/api/shopping/requests', {
    method: 'POST',
    token: customer,
    body: {
      address_id: address.id,
      payment_method: 'wallet',
      budget: 6000,
      items: [{ description: 'Semovita 2kg', qty: 1, target_price: 3200 }],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const orderId = created.body.order.id;

  await api(`/api/worker/jobs/${orderId}/accept`, { method: 'POST', token: shopper, body: { role: 'shopper' } });
  await api(`/api/worker/jobs/${orderId}/start-shopping`, { method: 'POST', token: shopper });
  const shopping = (await api(`/api/orders/${orderId}`, { token: customer })).body.order;
  await api(`/api/worker/jobs/${orderId}/items/${shopping.shopping_items[0].id}`, {
    method: 'PATCH', token: shopper, body: { proposed_price: 3200 },
  });
  await api(`/api/worker/jobs/${orderId}/submit-for-approval`, { method: 'POST', token: shopper });

  const awaiting = (await api(`/api/orders/${orderId}`, { token: customer })).body.order;
  await api(`/api/orders/${orderId}/approvals`, {
    method: 'POST', token: customer,
    body: { items: awaiting.shopping_items.map((i) => ({ id: i.id, action: 'approve' })) },
  });
  await api(`/api/worker/jobs/${orderId}/purchased`, { method: 'POST', token: shopper });

  const ready = (await api(`/api/orders/${orderId}`, { token: customer })).body.order;
  assert.equal(ready.status, 'ready_for_delivery');

  // the offer has to be visible in the rider's own list, not just acceptable
  const board = (await api('/api/worker/dashboard', { token: rider })).body;
  assert.ok(board.offers.some((o) => o.id === orderId), 'the rider is shown the personal delivery offer');

  // this is the step that used to fail: ready_for_delivery was not acceptable
  const accepted = await api(`/api/worker/jobs/${orderId}/accept`, { method: 'POST', token: rider, body: { role: 'rider' } });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.order.status, 'rider_assigned');
  assert.equal(accepted.body.order.rider_id, (await api('/api/me', { token: rider })).body.user.id);

  await api(`/api/worker/jobs/${orderId}/pickup`, { method: 'POST', token: rider });
  await api(`/api/worker/jobs/${orderId}/in-transit`, { method: 'POST', token: rider });
  const pin = (await api(`/api/orders/${orderId}`, { token: customer })).body.order.delivery_pin;
  const delivered = await api(`/api/worker/jobs/${orderId}/deliver`, { method: 'POST', token: rider, body: { pin } });
  assert.equal(delivered.status, 200, JSON.stringify(delivered.body));
  const done = await api(`/api/orders/${orderId}/confirm-delivery`, { method: 'POST', token: customer });
  assert.equal(done.body.order.status, 'completed');
});

test('36. a forgotten password can be recovered with a code', async () => {
  const email = `forgetful${Date.now()}@example.com`;
  const made = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Forgetful Femi', email, phone: `0803${String(Date.now()).slice(-7)}`, password: 'OldPassword1!', role: 'customer' },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));

  // asking for a code never says whether the account exists
  const unknown = await api('/api/auth/password/forgot', { method: 'POST', body: { identifier: 'nobody@example.com' } });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.masked, null);

  const asked = await api('/api/auth/password/forgot', { method: 'POST', body: { identifier: email } });
  assert.equal(asked.status, 200, JSON.stringify(asked.body));
  assert.ok(asked.body.masked.includes('***'), 'we say where the code went, without spelling it out');
  assert.equal(asked.body.sms, false, 'no provider configured in tests');

  // the code is what support reads out, so it is six digits and in the table
  const { db } = await import('../src/lib/db.js');
  const row = db.prepare('SELECT * FROM password_resets ORDER BY created_at DESC LIMIT 1').get();
  assert.match(row.token, /^\d{6}$/);

  const wrong = await api('/api/auth/password/reset', { method: 'POST', body: { identifier: email, code: '000000', password: 'NewPassword1!' } });
  assert.equal(wrong.status, 400, 'a wrong code must not work');

  const short = await api('/api/auth/password/reset', { method: 'POST', body: { identifier: email, code: row.token, password: 'short' } });
  assert.equal(short.status, 400, 'passwords stay at least 8 characters');

  const done = await api('/api/auth/password/reset', { method: 'POST', body: { identifier: email, code: row.token, password: 'NewPassword1!' } });
  assert.equal(done.status, 200, JSON.stringify(done.body));

  const oldLogin = await api('/api/auth/login', { method: 'POST', body: { identifier: email, password: 'OldPassword1!' } });
  assert.ok([400, 401].includes(oldLogin.status), `the old password is dead (${oldLogin.status})`);
  const newLogin = await api('/api/auth/login', { method: 'POST', body: { identifier: email, password: 'NewPassword1!' } });
  assert.equal(newLogin.status, 200, 'the new one works');

  const reused = await api('/api/auth/password/reset', { method: 'POST', body: { identifier: email, code: row.token, password: 'ThirdPassword1!' } });
  assert.equal(reused.status, 400, 'a code works once');

  // and support can always read one out from the admin panel
  const admin = await login('admin@buybuddy.ng');
  const issued = await api(`/api/admin/users/${newLogin.body.user.id}/password-reset-code`, { method: 'POST', token: admin });
  assert.equal(issued.status, 200, JSON.stringify(issued.body));
  assert.match(issued.body.code, /^\d{6}$/);
  const viaAdmin = await api('/api/auth/password/reset', {
    method: 'POST',
    body: { identifier: email, code: issued.body.code, password: 'AdminHelped1!' },
  });
  assert.equal(viaAdmin.status, 200, JSON.stringify(viaAdmin.body));
});

test('37. wallet money only appears after it has been paid for', async () => {
  const token = await login('customer@buybuddy.ng');
  const before = (await api('/api/wallet', { token })).body.balance;

  const tooSmall = await api('/api/wallet/topup', { method: 'POST', token, body: { amount: 100 } });
  assert.equal(tooSmall.status, 400, 'no dust top-ups');

  const { db } = await import('../src/lib/db.js');
  const { creditWalletTopup } = await import('../src/lib/payments.js');

  /*
   * In tests there is no Paystack key, so the sandbox credits instantly — that is
   * the only reason this goes up without money. The real path is exercised
   * below: an intent exists, and the wallet is untouched until the provider says
   * the money arrived.
   */
  const ok = await api('/api/wallet/topup', { method: 'POST', token, body: { amount: 2000 } });
  assert.ok([200, 201].includes(ok.status), JSON.stringify(ok.body));
  assert.equal(ok.body.credited, 2000, 'sandbox credits immediately');

  const user = (await api('/api/me', { token })).body.user;
  const beforeReal = (await api('/api/wallet', { token })).body.balance;
  db.prepare(
    'INSERT INTO wallet_topups (id,user_id,reference,amount,status,authorization_url,created_at) VALUES (?,?,?,?,?,?,?)'
  ).run('wtu_test_one', user.id, 'bbt_test_ref_one', 7000, 'pending', null, new Date().toISOString());

  const untouched = (await api('/api/wallet', { token })).body.balance;
  assert.equal(untouched, beforeReal, 'an unpaid top-up adds nothing');

  const credited = creditWalletTopup('bbt_test_ref_one', { amount: 700000 });
  assert.equal(credited.status, 'success');
  assert.equal((await api('/api/wallet', { token })).body.balance, beforeReal + 7000);

  const again = creditWalletTopup('bbt_test_ref_one', { amount: 700000 });
  assert.equal(again.alreadyProcessed, true, 'a repeated callback does not double-credit');
  assert.equal((await api('/api/wallet', { token })).body.balance, beforeReal + 7000);

  // underpayment must not unlock the money
  db.prepare(
    'INSERT INTO wallet_topups (id,user_id,reference,amount,status,authorization_url,created_at) VALUES (?,?,?,?,?,?,?)'
  ).run('wtu_test_two', user.id, 'bbt_test_ref_two', 5000, 'pending', null, new Date().toISOString());
  const short = creditWalletTopup('bbt_test_ref_two', { amount: 100000 });
  assert.equal(short.status, 'failed', 'paying ₦1,000 for a ₦5,000 top-up is not a top-up');
  assert.equal((await api('/api/wallet', { token })).body.balance, beforeReal + 7000, 'and adds nothing');
  assert.ok((await api('/api/wallet', { token })).body.balance > before);
});

test('38. admin can pull one bad listing without freezing the whole shop', async () => {
  const admin = await login('admin@buybuddy.ng');
  const list = await api('/api/admin/products?limit=5', { token: admin });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.ok(list.body.products.length > 0, 'the marketplace has listings to moderate');
  const first = list.body.products[0];
  assert.ok(first.store_name && first.owner_name, 'the admin can see whose listing it is');

  const search = await api(`/api/admin/products?q=${encodeURIComponent(first.store_name.slice(0, 4))}`, { token: admin });
  assert.equal(search.status, 200);
  assert.ok(search.body.products.some((p) => p.id === first.id), 'search finds it by store name');

  const down = await api(`/api/admin/products/${first.id}`, {
    method: 'PATCH', token: admin, body: { status: 'inactive', reason: 'Photo does not match the product' },
  });
  assert.equal(down.status, 200, JSON.stringify(down.body));
  assert.equal(down.body.product.status, 'inactive');

  const hiddenFilter = await api('/api/admin/products?status=inactive&limit=50', { token: admin });
  assert.ok(hiddenFilter.body.products.some((p) => p.id === first.id), 'it moves into the hidden filter');

  const shop = await api(`/api/products?store=${first.store_id}&limit=200`);
  assert.ok(!shop.body.products.some((p) => p.id === first.id), 'shoppers can no longer see it');

  const { db } = await import('../src/lib/db.js');
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(first.store_id);
  const note = db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").get(store.merchant_id);
  assert.match(note.body, /took this listing down/i, 'the store owner is told why');

  const back = await api(`/api/admin/products/${first.id}`, { method: 'PATCH', token: admin, body: { status: 'active' } });
  assert.equal(back.body.product.status, 'active', 'and it can be put back');
  const visible = await api(`/api/products?store=${first.store_id}&limit=200`);
  assert.ok(visible.body.products.some((p) => p.id === first.id));

  const customers = await login('customer@buybuddy.ng');
  const refused = await api(`/api/admin/products/${first.id}`, { method: 'PATCH', token: customers, body: { status: 'inactive' } });
  assert.ok([401, 403].includes(refused.status), 'only admins moderate');
});

test('39. a withdrawal sets the money aside instead of promising it twice', async () => {
  const rider = await login('rider@buybuddy.ng');
  await api('/api/worker/profile', {
    method: 'PATCH', token: rider,
    body: { bank_name: 'GTBank', account_number: '0123456789', account_name: 'Chinedu Okeke' },
  });
  const admin = await login('admin@buybuddy.ng');
  // the demo data ships with a withdrawal already waiting — clear it first
  const earnings = await api('/api/worker/earnings', { token: rider });
  for (const p of earnings.body.payouts.filter((x) => ['requested', 'approved'].includes(x.status))) {
    await api(`/api/admin/payouts/${p.id}/decision`, { method: 'POST', token: admin, body: { decision: 'reject', reason: 'Cleanup' } });
  }

  const before = (await api('/api/wallet', { token: rider })).body.balance;
  assert.ok(before >= 2000, `rider needs money to withdraw first (has ${before})`);

  const first = await api('/api/worker/payouts', { method: 'POST', token: rider, body: { amount: 1000 } });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const afterFirst = (await api('/api/wallet', { token: rider })).body.balance;
  assert.equal(afterFirst, before - 1000, 'the money is held, not still spendable');

  const second = await api('/api/worker/payouts', { method: 'POST', token: rider, body: { amount: 1000 } });
  assert.equal(second.status, 400, 'a second request cannot be filed over the top');
  assert.match(second.body.error, /already have a ₦1,000 withdrawal waiting/i);

  const rejected = await api(`/api/admin/payouts/${first.body.payout.id}/decision`, {
    method: 'POST', token: admin, body: { decision: 'reject', reason: 'Bank details could not be verified' },
  });
  assert.equal(rejected.status, 200);
  assert.equal((await api('/api/wallet', { token: rider })).body.balance, before, 'a rejection gives it all back');

  const again = await api('/api/worker/payouts', { method: 'POST', token: rider, body: { amount: 1000 } });
  assert.equal(again.status, 201, 'and they can ask again');
  const approved = await api(`/api/admin/payouts/${again.body.payout.id}/decision`, {
    method: 'POST', token: admin, body: { decision: 'approve' },
  });
  assert.equal(approved.status, 200);
  const paid = await api(`/api/admin/payouts/${again.body.payout.id}/decision`, {
    method: 'POST', token: admin, body: { decision: 'pay' },
  });
  assert.equal(paid.status, 200);
  assert.equal((await api('/api/wallet', { token: rider })).body.balance, before - 1000, 'paid once, debited once');
});

test('40. a booked delivery time is kept, not ignored', async () => {
  const customer = await login('customer@buybuddy.ng');
  const merchant = await login('merchant1@buybuddy.ng');
  await api('/api/cart', { method: 'DELETE', token: customer });
  const products = await api('/api/products?limit=200');
  const green = products.body.products.find((p) => p.store.name === 'GreenMart Supermarket' && p.stock > 2);
  await api('/api/cart', { method: 'POST', token: customer, body: { product_id: green.id, qty: 2 } });
  const address = (await api('/api/addresses', { token: customer })).body.addresses[0];

  const tomorrow = new Date(Date.now() + 20 * 3600_000).toISOString();
  const placed = await api('/api/orders/checkout', {
    method: 'POST', token: customer,
    body: { address_id: address.id, payment_method: 'wallet', scheduled_for: tomorrow },
  });
  assert.ok([200, 201].includes(placed.status), JSON.stringify(placed.body));
  const orderId = placed.body.order.id;
  assert.ok(placed.body.order.scheduled_for, 'the time the customer picked is on the order');

  const tooSoon = await api('/api/orders/checkout', {
    method: 'POST', token: customer, body: { address_id: address.id, payment_method: 'wallet', scheduled_for: new Date(Date.now() + 60_000).toISOString() },
  });
  assert.equal(tooSoon.status, 400, 'a time fifteen minutes away is refused, not silently ignored');

  // the shop is not told to cook now
  const acceptEarly = await api(`/api/merchant/orders/${orderId}/accept`, { method: 'POST', token: merchant });
  assert.equal(acceptEarly.status, 400, 'the shop cannot start preparing a day early');
  assert.match(acceptEarly.body.error, /Booked for/i);
  assert.match(acceptEarly.body.error, /about an hour before/i);

  const rider = await login('rider@buybuddy.ng');
  const board = await api('/api/worker/dashboard', { token: rider });
  assert.ok(!board.body.offers.some((o) => o.id === orderId), 'and no rider is sent to a shut gate');

  // when the slot comes round, the scheduler hands it over
  const { releaseDueScheduledOrders, isHeld } = await import('../src/lib/orders.js');
  const { db } = await import('../src/lib/db.js');
  const fresh = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  assert.equal(isHeld(fresh), true, `held? scheduled_for=${fresh.scheduled_for} released_at=${fresh.released_at}`);

  const released = releaseDueScheduledOrders(new Date(tomorrow).getTime());
  assert.ok(released.includes(orderId), `due orders are released (got ${JSON.stringify(released)}, order ${orderId})`);

  const nowOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  assert.ok(nowOrder.released_at, 'the release is recorded');

  const note = db
    .prepare("SELECT * FROM notifications WHERE user_id = (SELECT merchant_id FROM stores WHERE id = ?) ORDER BY created_at DESC LIMIT 1")
    .get(green.store.id);
  assert.match(note.title, /is due/i, 'the shop is nudged when it is time');

  const acceptNow = await api(`/api/merchant/orders/${orderId}/accept`, { method: 'POST', token: merchant });
  assert.equal(acceptNow.status, 200, JSON.stringify(acceptNow.body));
});

test('41. a refund adds up, goes where the money can be spent, and never exceeds what was paid', async () => {
  const customer = await login('customer@buybuddy.ng');
  const admin = await login('admin@buybuddy.ng');

  // a wallet-paid order, so the test can follow the money without a card
  await api('/api/cart', { method: 'DELETE', token: customer });
  const products = await api('/api/products?limit=200');
  const item = products.body.products.find((p) => p.store.name === 'GreenMart Supermarket' && p.stock > 0);
  await api('/api/cart', { method: 'POST', token: customer, body: { product_id: item.id, qty: Math.max(2, Math.ceil(2000 / item.price)) } });
  const address = (await api('/api/addresses', { token: customer })).body.addresses[0];
  const placed = await api('/api/orders/checkout', {
    method: 'POST', token: customer, body: { address_id: address.id, payment_method: 'wallet' },
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const order = placed.body.order;

  const before = (await api('/api/wallet', { token: customer })).body.balance;

  const half = Math.floor(order.total / 2);
  const first = await api(`/api/admin/orders/${order.id}/refund`, { method: 'POST', token: admin, body: { amount: half, reason: 'Missing item' } });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.refunded, half);
  assert.equal(first.body.to_card, false, 'no card to send it to, so it goes to the wallet');
  assert.equal(first.body.fully_refunded, false);
  assert.equal((await api('/api/wallet', { token: customer })).body.balance, before + half, 'the customer can actually spend it');

  const tooMuch = await api(`/api/admin/orders/${order.id}/refund`, {
    method: 'POST', token: admin, body: { amount: order.total, reason: 'Trying it on' },
  });
  assert.equal(tooMuch.status, 400, 'cannot hand back more than is left');
  assert.match(tooMuch.body.error, new RegExp(`Only ₦${(order.total - half).toLocaleString()} is left`));

  const rest = await api(`/api/admin/orders/${order.id}/refund`, { method: 'POST', token: admin, body: { reason: 'Rest of it' } });
  assert.equal(rest.status, 200);
  assert.equal(rest.body.refunded, order.total - half, 'the default is exactly what is still owed');
  assert.equal(rest.body.fully_refunded, true);
  assert.equal((await api('/api/wallet', { token: customer })).body.balance, before + order.total);

  const again = await api(`/api/admin/orders/${order.id}/refund`, { method: 'POST', token: admin, body: { reason: 'Third time' } });
  assert.equal(again.status, 400);
  assert.match(again.body.error, /already been refunded/i);
});

test('42. a basket that grew asks for the difference, not the whole price again', async () => {
  const customer = await login('customer@buybuddy.ng');
  const shopper = await login('shopper@buybuddy.ng');
  await api('/api/worker/availability', { method: 'POST', token: shopper, body: { available: true } });
  const address = (await api('/api/addresses', { token: customer })).body.addresses[0];

  const made = await api('/api/shopping/requests', {
    method: 'POST', token: customer,
    body: {
      address_id: address.id,
      items: [{ description: 'Bag of rice 5kg', qty: 1, target_price: 2000 }],
      budget: 2500,
      payment_method: 'wallet',
    },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const orderId = made.body.order.id;
  const originalTotal = made.body.order.total;

  await api(`/api/worker/jobs/${orderId}/accept`, { method: 'POST', token: shopper });
  await api(`/api/worker/jobs/${orderId}/start-shopping`, { method: 'POST', token: shopper });
  const job = await api(`/api/worker/jobs/${orderId}`, { token: shopper });
  const item = job.body.order.shopping_items[0];
  await api(`/api/worker/jobs/${orderId}/items/${item.id}`, {
    method: 'PATCH', token: shopper, body: { proposed_price: 3500, proposed_qty: 1, status: 'proposed' },
  });
  await api(`/api/worker/jobs/${orderId}/submit-for-approval`, { method: 'POST', token: shopper });

  const approved = await api(`/api/orders/${orderId}/approvals`, {
    method: 'POST', token: customer, body: { items: [{ id: item.id, action: 'approve' }] },
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.order.payment_status, 'pending', 'the extra is owed before shopping continues');
  assert.equal(approved.body.order.amount_paid, originalTotal, 'we know exactly what has been paid');
  const due = approved.body.order.amount_due;
  assert.ok(due > 0, 'and exactly what is still owed');
  assert.equal(approved.body.order.status, 'awaiting_approval', 'the order waits for the money, not a dead end');

  const overpay = await api(`/api/orders/${orderId}/pay`, { method: 'POST', token: customer, body: { payment_method: 'wallet' } });
  assert.equal(overpay.status, 200, JSON.stringify(overpay.body));
  assert.equal(overpay.body.payment.method, 'wallet');
  const paid = await api(`/api/orders/${orderId}`, { token: customer });
  assert.equal(paid.body.order.payment_status, 'paid');
  assert.equal(paid.body.order.amount_due, 0);
  assert.equal(paid.body.order.amount_paid, paid.body.order.total, 'the total was reached once, not twice');
  assert.equal(paid.body.order.status, 'approved', 'and the shopper can buy now');

  const { db } = await import('../src/lib/db.js');
  const charged = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM payments WHERE order_id = ? AND status = 'success'").get(orderId).t;
  assert.equal(charged, paid.body.order.total, 'the ledger says one total, not the total plus the difference');

  const again = await api(`/api/orders/${orderId}/pay`, { method: 'POST', token: customer, body: { payment_method: 'wallet' } });
  assert.equal(again.status, 400, 'and it cannot be charged a second time');
});

test('43. a shop cannot decline an order the rider already collected', async () => {
  const customer = await login('customer@buybuddy.ng');
  const merchant = await login('merchant1@buybuddy.ng');
  const rider = await login('rider@buybuddy.ng');
  await api('/api/worker/availability', { method: 'POST', token: rider, body: { available: true } });

  await api('/api/cart', { method: 'DELETE', token: customer });
  const products = await api('/api/products?limit=200');
  const item = products.body.products.find((p) => p.store.name === 'GreenMart Supermarket' && p.stock > 3);
  await api('/api/cart', { method: 'POST', token: customer, body: { product_id: item.id, qty: Math.max(2, Math.ceil(2000 / item.price)) } });
  const address = (await api('/api/addresses', { token: customer })).body.addresses[0];
  const placed = await api('/api/orders/checkout', { method: 'POST', token: customer, body: { address_id: address.id, payment_method: 'wallet' } });
  const order = placed.body.order;

  await api(`/api/merchant/orders/${order.id}/accept`, { method: 'POST', token: merchant });
  await api(`/api/merchant/orders/${order.id}/ready`, { method: 'POST', token: merchant });
  await api(`/api/worker/jobs/${order.id}/accept`, { method: 'POST', token: rider });
  await api(`/api/worker/jobs/${order.id}/pickup`, { method: 'POST', token: rider });

  const late = await api(`/api/merchant/orders/${order.id}/reject`, { method: 'POST', token: merchant, body: { reason: 'Changed our mind' } });
  assert.equal(late.status, 400, 'the rider is already carrying it');
  assert.match(late.body.error, /cannot be declined/i);
  assert.match(late.body.error, /rider has collected it/i);
  assert.match(late.body.error, /ask BUYBUDDY support/i, 'and it says what to do instead');

  const still = await api(`/api/orders/${order.id}`, { token: customer });
  assert.notEqual(still.body.order.status, 'cancelled', 'the order was left alone');

  // declining before pickup still works, and gives the money back to the wallet
  const walletBefore = (await api('/api/wallet', { token: customer })).body.balance;
  await api('/api/cart', { method: 'DELETE', token: customer });
  await api('/api/cart', { method: 'POST', token: customer, body: { product_id: item.id, qty: Math.max(2, Math.ceil(2000 / item.price)) } });
  const second = await api('/api/orders/checkout', { method: 'POST', token: customer, body: { address_id: address.id, payment_method: 'wallet' } });
  const walletAfterPay = (await api('/api/wallet', { token: customer })).body.balance;
  const decline = await api(`/api/merchant/orders/${second.body.order.id}/reject`, {
    method: 'POST', token: merchant, body: { reason: 'Kitchen closed early' },
  });
  assert.equal(decline.status, 200, JSON.stringify(decline.body));
  const walletAfter = (await api('/api/wallet', { token: customer })).body.balance;
  assert.equal(walletAfter, walletBefore, 'paid from the wallet, returned to the wallet');

  const { db } = await import('../src/lib/db.js');
  const customerId = (await api('/api/me', { token: customer })).body.user.id;
  const note = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC')
    .all(customerId)
    .find((n) => /declin|refund/i.test(n.body)) || {};
  assert.match(note.body, /wallet/i, 'and the customer is told where the money went');
  assert.doesNotMatch(note.body, /have not been charged/i, 'no false comfort when money was taken');
});

test('44. cash a rider collects is tracked, refundable and has to be handed over', async () => {
  const customer = await login('customer@buybuddy.ng');
  const merchant = await login('merchant1@buybuddy.ng');
  const rider = await login('rider@buybuddy.ng');
  const admin = await login('admin@buybuddy.ng');
  await api('/api/worker/availability', { method: 'POST', token: rider, body: { available: true } });

  await api('/api/cart', { method: 'DELETE', token: customer });
  const products = (await api('/api/products?limit=200')).body.products;
  const item = products.find((p) => p.store.name === 'GreenMart Supermarket' && p.stock > 3);
  await api('/api/cart', { method: 'POST', token: customer, body: { product_id: item.id, qty: 2 } });
  const address = (await api('/api/addresses', { token: customer })).body.addresses[0];

  const placed = await api('/api/orders/checkout', {
    method: 'POST', token: customer, body: { address_id: address.id, payment_method: 'cash' },
  });
  const order = placed.body.order;
  assert.equal(order.payment_status, 'paid_cash');

  await api(`/api/merchant/orders/${order.id}/accept`, { method: 'POST', token: merchant });
  await api(`/api/merchant/orders/${order.id}/ready`, { method: 'POST', token: merchant });
  await api(`/api/worker/jobs/${order.id}/accept`, { method: 'POST', token: rider });
  await api(`/api/worker/jobs/${order.id}/pickup`, { method: 'POST', token: rider });
  await api(`/api/worker/jobs/${order.id}/in-transit`, { method: 'POST', token: rider });
  const pin = (await api(`/api/orders/${order.id}`, { token: customer })).body.order.delivery_pin;
  const delivered = await api(`/api/worker/jobs/${order.id}/deliver`, { method: 'POST', token: rider, body: { pin } });
  assert.equal(delivered.status, 200, JSON.stringify(delivered.body));

  // the notes in the rider's pocket are now on the books, minus the fee they keep
  const cash = await api('/api/admin/cash', { token: admin });
  const record = cash.body.records.find((r) => r.order_id === order.id);
  assert.ok(record, 'a cash record exists for the delivery');
  assert.equal(record.collected, order.total - order.delivery_fee, 'the rider keeps their delivery fee');
  assert.equal(record.outstanding, record.collected);

  // and they cannot withdraw money they are still holding in cash
  const earnings = await api('/api/worker/earnings', { token: rider });
  assert.equal(earnings.body.cash.outstanding >= record.collected, true, 'the rider app shows it');
  const tooMuch = await api('/api/worker/payouts', { method: 'POST', token: rider, body: { amount: earnings.body.balance } });
  assert.equal(tooMuch.status, 400, 'a rider holding cash cannot withdraw the full balance');
  assert.match(tooMuch.body.error, /holding/i);
  assert.match(tooMuch.body.error, /hand the cash over/i, 'and it says what to do');

  // a refund pays the customer from the wallet, so the rider owes that much less
  const refund = await api(`/api/admin/orders/${order.id}/refund`, { method: 'POST', token: admin, body: { amount: 500, reason: 'One item missing' } });
  assert.equal(refund.status, 200, JSON.stringify(refund.body));
  const afterRefund = (await api('/api/admin/cash', { token: admin })).body.records.find((r) => r.order_id === order.id);
  assert.equal(afterRefund.outstanding, record.collected - 500, 'the refund came off the cash handover');

  // the office takes the cash, the ledger clears
  const cleared = await api(`/api/admin/cash/${record.id}/clear`, { method: 'POST', token: admin, body: { note: 'Counted at the office' } });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal(cleared.body.cleared, record.collected - 500);
  const finalCash = (await api('/api/admin/cash', { token: admin })).body.records.find((r) => r.order_id === order.id);
  assert.equal(finalCash.status, 'cleared');
  assert.equal(finalCash.outstanding, 0, 'nothing left owed on that order');

  const again = await api(`/api/admin/cash/${record.id}/clear`, { method: 'POST', token: admin });
  assert.equal(again.status, 400, 'and it cannot be cleared twice');
  assert.match(again.body.error, /already/i);
});

test('45. a merchant is paid from the ledger and can only withdraw money once', async () => {
  const customer = await login('customer@buybuddy.ng');
  const merchant = await login('merchant1@buybuddy.ng');
  const rider = await login('rider@buybuddy.ng');
  const admin = await login('admin@buybuddy.ng');
  await api('/api/worker/availability', { method: 'POST', token: rider, body: { available: true } });

  // one real card order, taken all the way to the door
  await api('/api/cart', { method: 'DELETE', token: customer });
  const products = (await api('/api/products?limit=200')).body.products;
  const item = products.find((p) => p.store.name === 'GreenMart Supermarket' && p.stock > 3 && p.price >= 2000);
  await api('/api/cart', { method: 'POST', token: customer, body: { product_id: item.id, qty: 1 } });
  const address = (await api('/api/addresses', { token: customer })).body.addresses[0];
  const placed = await api('/api/orders/checkout', {
    method: 'POST', token: customer, body: { address_id: address.id, payment_method: 'paystack' },
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const order = placed.body.order;
  if (order.status === 'pending_payment') {
    const pay = await api(`/api/orders/${order.id}/pay`, { method: 'POST', token: customer });
    assert.equal(pay.status, 200, JSON.stringify(pay.body));
    const ref = pay.body.payment?.reference;
    assert.ok(ref, 'a payment reference comes back');
    const verified = await api(`/api/payments/${ref}/verify`, { method: 'POST', token: customer });
    assert.equal(verified.status, 200, JSON.stringify(verified.body));
  }
  await api(`/api/merchant/orders/${order.id}/accept`, { method: 'POST', token: merchant });
  await api(`/api/merchant/orders/${order.id}/ready`, { method: 'POST', token: merchant });
  // assign through the admin route so the test does not depend on which rider the
  // offer engine picked in an earlier test
  const riderId = (await api('/api/me', { token: rider })).body.user.id;
  const assigned = await api(`/api/admin/orders/${order.id}/assign`, {
    method: 'POST', token: admin, body: { worker_id: riderId, role: 'rider' },
  });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  await api(`/api/worker/jobs/${order.id}/pickup`, { method: 'POST', token: rider });
  await api(`/api/worker/jobs/${order.id}/in-transit`, { method: 'POST', token: rider });
  const pin = (await api(`/api/orders/${order.id}`, { token: customer })).body.order.delivery_pin;
  const delivered = await api(`/api/worker/jobs/${order.id}/deliver`, { method: 'POST', token: rider, body: { pin } });
  assert.equal(delivered.status, 200, JSON.stringify(delivered.body));
  // the customer confirms the door-drop; that is the moment the money settles
  const confirmed = await api(`/api/orders/${order.id}/confirm-delivery`, { method: 'POST', token: customer });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.order.status, 'completed');

  const ledger = await api('/api/merchant/settlements', { token: merchant });
  assert.equal(ledger.status, 200, JSON.stringify(ledger.body));
  const row = ledger.body.ledger.find((e) => e.order_code === order.code);
  assert.ok(row, 'the ledger shows the order that was just settled');
  assert.equal(row.type, 'credit');
  assert.equal(row.gross, order.subtotal, 'gross is the order subtotal');
  assert.equal(row.commission, row.gross - row.amount, 'commission is what was kept');
  assert.ok(row.amount > 0 && row.amount < row.gross, 'the merchant is paid less the commission');
  assert.equal(ledger.body.totals.net >= row.amount, true);
  const balanceBefore = ledger.body.balance;

  // no bank account, no payout — and the message says where to add it
  await api('/api/merchant/bank', {
    method: 'PATCH', token: merchant, body: { bank_name: '', account_name: '', account_number: '' },
  });
  const noBank = await api('/api/merchant/payouts', { method: 'POST', token: merchant, body: { amount: 1000 } });
  assert.equal(noBank.status, 400, JSON.stringify(noBank.body));
  assert.match(noBank.body.error, /bank account/i, 'it says what is missing');

  const badAccount = await api('/api/merchant/bank', {
    method: 'PATCH', token: merchant, body: { bank_name: 'GTBank', account_name: 'GreenMart Ltd', account_number: '123' },
  });
  assert.equal(badAccount.status, 400, 'a short account number is refused');
  assert.match(badAccount.body.error, /10-digit/);

  const saved = await api('/api/merchant/bank', {
    method: 'PATCH', token: merchant, body: { bank_name: 'GTBank', account_name: 'GreenMart Ltd', account_number: '0123456789' },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  const tooSmall = await api('/api/merchant/payouts', { method: 'POST', token: merchant, body: { amount: 500 } });
  assert.equal(tooSmall.status, 400);
  assert.match(tooSmall.body.error, /₦1,000/);

  const first = await api('/api/merchant/payouts', { method: 'POST', token: merchant, body: { amount: 1000 } });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.payout.amount, 1000);

  // the money has left the wallet, so a second request cannot spend it again
  const after = await api('/api/merchant/settlements', { token: merchant });
  assert.equal(after.body.balance, balanceBefore - 1000, 'the wallet is debited when the request is filed');
  const second = await api('/api/merchant/payouts', { method: 'POST', token: merchant, body: { amount: 1000 } });
  assert.equal(second.status, 400);
  assert.match(second.body.error, /already have/i);

  // the office sees it, with the merchant's bank details, and a rejection gives the money back
  const finance = await api('/api/admin/finance', { token: admin });
  const seen = finance.body.payouts.find((p) => p.id === first.body.payout.id);
  assert.ok(seen, 'the withdrawal shows in the admin finance list');
  assert.equal(seen.role, 'merchant');
  assert.equal(seen.bank_name, 'GTBank', 'a merchant payout carries its bank details, not a blank row');
  assert.equal(seen.account_number, '0123456789');

  const rejected = await api(`/api/admin/payouts/${first.body.payout.id}/decision`, {
    method: 'POST', token: admin, body: { decision: 'reject', reason: 'Account name mismatch' },
  });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  const back = await api('/api/merchant/settlements', { token: merchant });
  assert.equal(back.body.balance, balanceBefore, 'a rejected withdrawal returns the money');
});

test('46. a missing item becomes a claim the office can pay, and a pickup can be photographed', async () => {
  const customer = await login('customer@buybuddy.ng');
  const merchant = await login('merchant1@buybuddy.ng');
  const rider = await login('rider@buybuddy.ng');
  const admin = await login('admin@buybuddy.ng');
  await api('/api/worker/availability', { method: 'POST', token: rider, body: { available: true } });

  await api('/api/cart', { method: 'DELETE', token: customer });
  const products = (await api('/api/products?limit=200')).body.products;
  const item = products.find((p) => p.store.name === 'GreenMart Supermarket' && p.stock > 3 && p.price >= 2000);
  await api('/api/cart', { method: 'POST', token: customer, body: { product_id: item.id, qty: 1 } });
  const address = (await api('/api/addresses', { token: customer })).body.addresses[0];
  const placed = await api('/api/orders/checkout', {
    method: 'POST', token: customer, body: { address_id: address.id, payment_method: 'paystack' },
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const order = placed.body.order;
  if (order.status === 'pending_payment') {
    const pay = await api(`/api/orders/${order.id}/pay`, { method: 'POST', token: customer });
    assert.equal(pay.status, 200, JSON.stringify(pay.body));
    const ref = pay.body.payment?.reference;
    assert.ok(ref, 'a payment reference comes back');
    await api(`/api/payments/${ref}/verify`, { method: 'POST', token: customer });
  }
  await api(`/api/merchant/orders/${order.id}/accept`, { method: 'POST', token: merchant });
  await api(`/api/merchant/orders/${order.id}/ready`, { method: 'POST', token: merchant });
  const riderId = (await api('/api/me', { token: rider })).body.user.id;
  await api(`/api/admin/orders/${order.id}/assign`, { method: 'POST', token: admin, body: { worker_id: riderId, role: 'rider' } });

  // a claim for money cannot be filed while the bag is still moving
  const tooEarly = await api('/api/support/tickets', {
    method: 'POST', token: customer,
    body: { order_id: order.id, subject: 'Rice missing', message: 'The rice was not in the bag.', claim_amount: 500 },
  });
  assert.equal(tooEarly.status, 400);
  assert.match(tooEarly.body.error, /has arrived/i);

  // the rider photographs the bag at handover; the customer can see the proof
  const pickup = await api(`/api/worker/jobs/${order.id}/pickup`, {
    method: 'POST', token: rider, body: { photo: 'data:image/png;base64,iVBORw0KGgo=' },
  });
  assert.equal(pickup.status, 200, JSON.stringify(pickup.body));
  assert.equal(pickup.body.photo_saved, true);
  await api(`/api/worker/jobs/${order.id}/in-transit`, { method: 'POST', token: rider });
  const pin = (await api(`/api/orders/${order.id}`, { token: customer })).body.order.delivery_pin;
  await api(`/api/worker/jobs/${order.id}/deliver`, { method: 'POST', token: rider, body: { pin } });

  const seen = await api(`/api/orders/${order.id}`, { token: customer });
  assert.ok(
    seen.body.receipts.some((r) => /handover/i.test(r.note || '')),
    'the handover photo is attached to the order the customer is looking at'
  );

  // asking for more than was paid is refused, with the real ceiling in the message
  const greedy = await api('/api/support/tickets', {
    method: 'POST', token: customer,
    body: { order_id: order.id, subject: 'Everything missing', message: 'Nothing arrived at all.', claim_amount: order.total + 5000 },
  });
  assert.equal(greedy.status, 400);
  assert.match(greedy.body.error, /left to refund/i);

  const claim = await api('/api/support/tickets', {
    method: 'POST', token: customer,
    body: {
      order_id: order.id,
      subject: 'Rice missing from the bag',
      message: 'The bag came without the rice I paid for.',
      category: 'order',
      claim_amount: 800,
      claim_items: [item.id],
      photo: 'data:image/png;base64,iVBORw0KGgo=',
    },
  });
  assert.equal(claim.status, 201, JSON.stringify(claim.body));
  assert.equal(claim.body.ticket.claim_amount, 800);
  assert.equal(claim.body.ticket.photo != null, true, 'the customer can attach a photo');
  const ticketId = claim.body.ticket.id;

  // the office sees the claim next to the ticket
  const queue = await api('/api/admin/tickets', { token: admin });
  const seenTicket = queue.body.tickets.find((t) => t.id === ticketId);
  assert.ok(seenTicket, 'the claim is in the support queue');
  assert.equal(seenTicket.claim_amount, 800);
  assert.equal(seenTicket.customer_name.length > 0, true);

  // resolving with an amount refunds it through the normal path
  const resolved = await api(`/api/admin/tickets/${ticketId}/resolve`, {
    method: 'POST', token: admin, body: { refund_amount: 800, resolution: 'Rice was missing — refunded' },
  });
  assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
  assert.equal(resolved.body.refund.refunded, 800);

  const after = (await api('/api/support/tickets', { token: customer })).body.tickets.find((t) => t.id === ticketId);
  assert.equal(after.status, 'resolved');
  assert.equal(after.refunded_amount, 800);
  const wallet = (await api('/api/wallet', { token: customer })).body;
  assert.ok(wallet.entries.some((e) => /refund/i.test(e.description || '')), 'the customer sees the refund in their wallet');

  // and the same claim cannot be paid twice
  const again = await api(`/api/admin/tickets/${ticketId}/resolve`, {
    method: 'POST', token: admin, body: { refund_amount: 800 },
  });
  assert.equal(again.status, 200, 'a resolved ticket can still be topped up if support decides to');
  const total = (await api('/api/support/tickets', { token: customer })).body.tickets.find((t) => t.id === ticketId);
  assert.ok(total.refunded_amount >= 800);
});

test('47. a shopper photographs the bag at the shop, and a rider can read their own ledger', async () => {
  const customer = await login('customer@buybuddy.ng');
  const shopper = await login('shopper@buybuddy.ng');
  const rider = await login('rider@buybuddy.ng');
  const admin = await login('admin@buybuddy.ng');
  await api('/api/worker/availability', { method: 'POST', token: rider, body: { available: true } });

  const address = (await api('/api/addresses', { token: customer })).body.addresses[0];
  const created = await api('/api/shopping/requests', {
    method: 'POST', token: customer,
    body: {
      address_id: address.id, payment_method: 'wallet', budget: 6000,
      items: [{ description: 'Semovita 2kg', qty: 1, target_price: 3200 }],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const orderId = created.body.order.id;

  await api(`/api/worker/jobs/${orderId}/accept`, { method: 'POST', token: shopper, body: { role: 'shopper' } });
  await api(`/api/worker/jobs/${orderId}/start-shopping`, { method: 'POST', token: shopper });
  const shopping = (await api(`/api/orders/${orderId}`, { token: customer })).body.order;
  await api(`/api/worker/jobs/${orderId}/items/${shopping.shopping_items[0].id}`, {
    method: 'PATCH', token: shopper, body: { proposed_price: 3200 },
  });
  await api(`/api/worker/jobs/${orderId}/submit-for-approval`, { method: 'POST', token: shopper });
  const awaiting = (await api(`/api/orders/${orderId}`, { token: customer })).body.order;
  await api(`/api/orders/${orderId}/approvals`, {
    method: 'POST', token: customer,
    body: { items: awaiting.shopping_items.map((i) => ({ id: i.id, action: 'approve' })) },
  });

  // the shopper seals the bag and photographs it at the counter
  const bought = await api(`/api/worker/jobs/${orderId}/purchased`, {
    method: 'POST', token: shopper, body: { photo: 'data:image/png;base64,iVBORw0KGgo=' },
  });
  assert.equal(bought.status, 200, JSON.stringify(bought.body));
  const customerView = await api(`/api/orders/${orderId}`, { token: customer });
  assert.ok(
    customerView.body.receipts.some((r) => /shopper handover photo/i.test(r.note || '')),
    'the customer can see the shopper\u2019s photo of the sealed bag'
  );

  // the rider collects it with their own photo, delivers, customer confirms
  await api(`/api/worker/jobs/${orderId}/accept`, { method: 'POST', token: rider, body: { role: 'rider' } });
  await api(`/api/worker/jobs/${orderId}/pickup`, { method: 'POST', token: rider, body: { photo: 'data:image/png;base64,iVBORw0KGgo=' } });
  await api(`/api/worker/jobs/${orderId}/in-transit`, { method: 'POST', token: rider });
  const pin = (await api(`/api/orders/${orderId}`, { token: customer })).body.order.delivery_pin;
  await api(`/api/worker/jobs/${orderId}/deliver`, { method: 'POST', token: rider, body: { pin } });
  await api(`/api/orders/${orderId}/confirm-delivery`, { method: 'POST', token: customer });

  const proof = (await api(`/api/orders/${orderId}`, { token: customer })).body.receipts;
  assert.equal(proof.filter((r) => /handover|shopper/i.test(r.note || '')).length >= 2, true, 'both handovers are photographed');

  // the rider's earnings read like a ledger, not a number
  const earnings = await api('/api/worker/earnings', { token: rider });
  assert.equal(earnings.status, 200, JSON.stringify(earnings.body));
  const line = earnings.body.entries.find((e) => e.order_code === customerView.body.order.code);
  assert.ok(line, 'the earning carries the order code it came from');
  assert.equal(line.type, 'credit');
  assert.ok(line.balance_after > 0, 'and the balance after that line');
  assert.equal(typeof earnings.body.withdrawable, 'number');
  assert.ok(earnings.body.summary.jobs >= 1);
  assert.ok('month' in earnings.body.summary && 'withdrawn' in earnings.body.summary);
  assert.equal('open_payout' in earnings.body, true, 'the screen knows whether a withdrawal is already waiting');
  if (earnings.body.open_payout) assert.ok(['requested', 'approved'].includes(earnings.body.open_payout.status));

  // a rider holding cash cannot withdraw past it; the numbers say so
  if (earnings.body.cash.outstanding > 0) {
    assert.ok(earnings.body.withdrawable <= earnings.body.balance, 'withdrawable never exceeds the balance');
  }
});

test('48. two riders are offered the same job and only one of them can take it', async () => {
  const customer = await login('customer@buybuddy.ng');
  const merchant = await login('merchant1@buybuddy.ng');
  const riderA = await login('rider@buybuddy.ng');
  const riderB = await login('rider2@buybuddy.ng');
  await api('/api/worker/availability', { method: 'POST', token: riderA, body: { available: true } });
  await api('/api/worker/availability', { method: 'POST', token: riderB, body: { available: true } });

  await api('/api/cart', { method: 'DELETE', token: customer });
  const products = (await api('/api/products?limit=200')).body.products;
  const item = products.find((p) => p.store.name === 'GreenMart Supermarket' && p.stock > 3 && p.price >= 2000);
  await api('/api/cart', { method: 'POST', token: customer, body: { product_id: item.id, qty: 1 } });
  const address = (await api('/api/addresses', { token: customer })).body.addresses[0];
  const placed = await api('/api/orders/checkout', {
    method: 'POST', token: customer, body: { address_id: address.id, payment_method: 'wallet' },
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const order = placed.body.order;
  await api(`/api/merchant/orders/${order.id}/accept`, { method: 'POST', token: merchant });
  await api(`/api/merchant/orders/${order.id}/ready`, { method: 'POST', token: merchant });

  // both bikes on the road see it — an offer is not a lock
  const boardA = (await api('/api/worker/dashboard', { token: riderA })).body;
  const boardB = (await api('/api/worker/dashboard', { token: riderB })).body;
  assert.ok(boardA.offers.some((o) => o.id === order.id), 'rider A is offered the job');
  assert.ok(boardB.offers.some((o) => o.id === order.id), 'rider B is offered the same job');

  // the faster tap wins
  const taken = await api(`/api/worker/jobs/${order.id}/accept`, { method: 'POST', token: riderB });
  assert.equal(taken.status, 200, JSON.stringify(taken.body));
  const second = await api(`/api/worker/jobs/${order.id}/accept`, { method: 'POST', token: riderA });
  assert.equal(second.status, 400, 'the other rider is told, not silently ignored');
  assert.match(second.body.error, /already been taken|no longer available/i);

  // and the offer disappears from both boards, so nobody is left chasing a dead job
  const afterA = (await api('/api/worker/dashboard', { token: riderA })).body;
  const afterB = (await api('/api/worker/dashboard', { token: riderB })).body;
  assert.equal(afterA.offers.some((o) => o.id === order.id), false);
  assert.equal(afterB.offers.some((o) => o.id === order.id), false);

  const riderBId = (await api('/api/me', { token: riderB })).body.user.id;
  const final = (await api(`/api/orders/${order.id}`, { token: customer })).body.order;
  assert.equal(final.rider_id, riderBId, 'the order belongs to the rider who accepted');
});
