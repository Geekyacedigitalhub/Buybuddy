/**
 * Click-through of every screen, as every role, on the live app.
 * - records console errors / page exceptions / failed requests per route
 * - flags text that means something broke ("undefined", "NaN", "Something went wrong")
 * - presses the new money buttons (admin cash clear, payout reject, merchant decline)
 * - screenshots each route to /home/user/shots
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const B = process.env.APP || 'https://buybuddy-805j.onrender.com';
const PW = process.env.PW || 'GreenKola-2026-Lagos-813';
const OUT = '/home/user/shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, body, token, method) {
  const res = await fetch(B + p, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function fixture() {
  const before = (await api('/api/auth/login', { identifier: 'admin@buybuddy.ng', password: PW })).body.token;
  const dump = JSON.parse(fs.readFileSync('/home/user/backups/buybuddy-with-review-account.json', 'utf8'));
  const restored = await api('/api/admin/restore', { backup: dump, confirm: 'REPLACE ALL DATA' }, before);
  console.log('restore', restored.status);
  // a restore brings back the backup's signing secret, so every token minted
  // before it is void — sign in again afterwards
  const admin = (await api('/api/auth/login', { identifier: 'admin@buybuddy.ng', password: PW })).body.token;

  const customer = (await api('/api/auth/login', { identifier: 'customer@buybuddy.ng', password: PW })).body.token;
  const merchant = (await api('/api/auth/login', { identifier: 'merchant1@buybuddy.ng', password: PW })).body.token;
  const rider = (await api('/api/auth/login', { identifier: 'rider@buybuddy.ng', password: PW })).body.token;
  await api('/api/worker/availability', { available: true }, rider);
  const address = (await api('/api/addresses', null, customer)).body.addresses[0];
  const products = (await api('/api/products?limit=200')).body.products;
  const item = products.find((p) => p.store.name === 'GreenMart Supermarket' && p.stock > 3);

  // one order waiting for the shop (decline sheet), paid from the wallet
  await api('/api/cart', null, customer, 'DELETE');
  await api('/api/cart', { product_id: item.id, qty: 2 }, customer);
  const paid = (await api('/api/orders/checkout', { address_id: address.id, payment_method: 'wallet' }, customer)).body.order;

  // one cash order delivered, so the admin cash card has a row
  await api('/api/cart', null, customer, 'DELETE');
  await api('/api/cart', { product_id: item.id, qty: 2 }, customer);
  const cash = (await api('/api/orders/checkout', { address_id: address.id, payment_method: 'cash' }, customer)).body.order;
  for (const step of ['accept', 'ready']) await api(`/api/merchant/orders/${cash.id}/${step}`, {}, merchant);
  for (const step of ['accept', 'pickup', 'in-transit']) await api(`/api/worker/jobs/${cash.id}/${step}`, {}, rider);
  const pin = (await api(`/api/orders/${cash.id}`, null, customer)).body.order.delivery_pin;
  await api(`/api/worker/jobs/${cash.id}/deliver`, { pin }, rider);

  // a delivery in the rider's hands, and a shopping task in the shopper's, so the
  // per-job screens are actually opened (a blank task page once slipped through)
  await api('/api/cart', null, customer, 'DELETE');
  await api('/api/cart', { product_id: item.id, qty: 1 }, customer);
  const live = (await api('/api/orders/checkout', { address_id: address.id, payment_method: 'wallet' }, customer)).body.order;
  for (const step of ['accept', 'ready']) await api(`/api/merchant/orders/${live.id}/${step}`, {}, merchant);
  for (const step of ['accept', 'pickup', 'in-transit']) await api(`/api/worker/jobs/${live.id}/${step}`, {}, rider);

  const shopper = (await api('/api/auth/login', { identifier: 'shopper@buybuddy.ng', password: PW })).body.token;

  // something for every role to look at
  const orders = (await api('/api/orders', null, customer)).body.orders || [];
  const prods = (await api('/api/products?limit=5')).body.products || [];
  return {
    orderId: (orders.find((o) => o.id !== cash.id) || orders[0] || {}).id,
    riderJobId: live.id,
    // the shop-for-me task already in the backup, so the shopper's job screen opens
    shopperJobId: (orders.find((o) => o.type === 'personal' && !['completed', 'cancelled'].includes(o.status)) || {}).id,
    cashCode: cash.code,
    paidCode: paid.code,
    productId: prods[0] && prods[0].id,
    storeId: prods[0] && prods[0].store && prods[0].store.id,
    tokens: {
      customer, merchant, rider,
      shopper,
      admin,
    },
  };
}

const ROUTES = (f) => ({
  guest: ['/', '/search', '/browse', '/cart', '/favourites'],
  customer: ['/', '/search', '/browse', `/store/${f.storeId}`, `/product/${f.productId}`, '/cart', '/checkout',
    '/shop-for-me', '/orders', `/orders/${f.orderId}`, '/account', '/account/wallet', '/account/rewards',
    '/account/addresses', '/account/notifications', '/support', '/favourites'],
  shopper: ['/worker', `/worker/task/${f.shopperJobId}`, '/worker/earnings', '/worker/account'],
  rider: ['/worker', `/worker/task/${f.riderJobId}`, '/worker/earnings', '/worker/account'],
  merchant: ['/merchant', '/merchant/orders', '/merchant/products', '/merchant/settlements', '/merchant/settings'],
  admin: ['/admin', '/admin/today', '/admin/orders', '/admin/people', '/admin/merchants', '/admin/workers', '/admin/products',
    '/admin/finance', '/admin/marketing', '/admin/support', '/admin/settings', '/admin/integrations', '/admin/audit'],
});

const BAD_TEXT = [/Something went wrong/i, /\bundefined\b/, /\bNaN\b/, /Cannot read propert/i, /is not a function/i];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const f = await fixture();
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    env: { ...process.env, LD_LIBRARY_PATH: '/home/user/.cache/libs/usr/lib/x86_64-linux-gnu:/home/user/.cache/libs/lib/x86_64-linux-gnu' },
  });
  const problems = [];

  for (const [role, routes] of Object.entries(ROUTES(f))) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1360, height: 1000 });
    const token = role === 'guest' ? null : f.tokens[role];
    await page.evaluateOnNewDocument((t) => {
      localStorage.clear();
      if (t) localStorage.setItem('bb_token', t);
    }, token);

    for (const route of routes) {
      const errors = [];
      const onConsole = (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); };
      const onFail = (r) => { const t = r.url(); if (!/fonts|analytics|leaflet|tile/i.test(t)) errors.push(`REQ FAIL ${r.failure() && r.failure().errorText} ${t.slice(0, 120)}`); };
      const onPageErr = (e) => errors.push('PAGE ERROR ' + String(e.message).slice(0, 200));
      page.on('console', onConsole);
      page.on('requestfailed', onFail);
      page.on('pageerror', onPageErr);

      await page.goto(`${B}/#${route}`, { waitUntil: 'networkidle2', timeout: 60000 }).catch((e) => errors.push('NAV ' + e.message));
      // wait until the content stops growing (or 8s), so "still loading" is not mistaken for broken
      let last = -1;
      for (let i = 0; i < 16; i++) {
        await sleep(500);
        const len = await page.evaluate(() => (document.body.innerText || '').length);
        if (len === last && len > 0) break;
        last = len;
      }
      const text = await page.evaluate(() => document.body.innerText || '');
      const hit = BAD_TEXT.filter((re) => re.test(text));
      const stuck = /Loading/.test(text) && text.length < 260;
      const shot = path.join(OUT, `${role}${route.replace(/[/]/g, '_') || '_home'}.png`);
      await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
      const line = `${role.padEnd(8)} ${route.padEnd(26)} ${(text.length + ' chars').padEnd(10)} ${hit.length ? 'TEXT:' + hit.join('|') : ''} ${stuck ? 'STUCK-LOADING' : ''} ${errors.length ? 'ERR:' + errors.join(' ~ ') : ''}`;
      if (hit.length || stuck || errors.length) problems.push(line);
      console.log(line);

      page.off('console', onConsole);
      page.off('requestfailed', onFail);
      page.off('pageerror', onPageErr);
    }
    await page.close();
  }

  /* ---------------- pressing the money buttons ---------------- */
  const pressed = async (role, route, steps) => {
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
    await page.setViewport({ width: 1360, height: 1100 });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('bb_token', t), f.tokens[role]);
    await page.goto(`${B}/#${route}`, { waitUntil: 'networkidle2' });
    await sleep(3000);
    const result = await steps(page);
    await page.close();
    return { result, errs };
  };

  console.log('\n--- admin: cash received sheet');
  console.log(JSON.stringify(await pressed('admin', '/admin/finance', async (page) => {
    const btn = await page.$('xpath/.//button[contains(., "Mark cash received")]');
    if (!btn) return 'no cash button (fixture missing?)';
    await btn.click();
    await sleep(600);
    const modal = await page.evaluate(() => {
      const m = document.querySelector('.modal');
      return m ? m.innerText.replace(/\s+/g, ' ').slice(0, 200) : null;
    });
    await page.screenshot({ path: path.join(OUT, 'admin-finance-cash-sheet.png') });
    const confirm = await page.$('xpath/.//button[contains(., "Yes — I have")]');
    if (confirm) { await confirm.click(); await sleep(1400); }
    const after = await page.evaluate(() => document.body.innerText.includes('Cash riders are holding'));
    return { modal, cleared: !after };
  }), null, 2));

  console.log('\n--- admin: reject a withdrawal sheet');
  console.log(JSON.stringify(await pressed('admin', '/admin/finance', async (page) => {
    const btn = await page.$('xpath/.//button[contains(., "Reject")]');
    if (!btn) return 'no payout to reject (none requested)';
    await btn.click();
    await sleep(600);
    const modal = await page.evaluate(() => {
      const m = document.querySelector('.modal');
      return m ? m.innerText.replace(/\s+/g, ' ').slice(0, 220) : null;
    });
    await page.screenshot({ path: path.join(OUT, 'admin-finance-reject-sheet.png') });
    if (modal) { const close = await page.$('.modal button[aria-label="Close"]'); if (close) await close.click(); }
    return { modal };
  }), null, 2));

  console.log('\n--- merchant: decline sheet');
  console.log(JSON.stringify(await pressed('merchant', '/merchant', async (page) => {
    const btn = await page.$('xpath/.//button[contains(., "Reject") or contains(., "Decline")]');
    if (!btn) return 'no decline button (no order waiting)';
    await btn.click();
    await sleep(600);
    const modal = await page.evaluate(() => {
      const m = document.querySelector('.modal');
      return m ? m.innerText.replace(/\s+/g, ' ').slice(0, 260) : null;
    });
    await page.screenshot({ path: path.join(OUT, 'merchant-decline-sheet.png') });
    if (modal) { const close = await page.$('.modal button[aria-label="Close"]'); if (close) await close.click(); }
    return { modal };
  }), null, 2));

  console.log('\n--- customer: report a problem sheet');
  console.log(JSON.stringify(await pressed('customer', `/orders/${f.orderId}`, async (page) => {
    const btn = await page.$('xpath/.//button[contains(., "Report a problem")]');
    if (!btn) return 'no report button on this order';
    await btn.click();
    await sleep(600);
    const modal = await page.evaluate(() => {
      const m = document.querySelector('.modal');
      return m ? m.innerText.replace(/\s+/g, ' ').slice(0, 240) : null;
    });
    await page.screenshot({ path: path.join(OUT, 'customer-report-sheet.png') });
    if (modal) { const close = await page.$('.modal button[aria-label="Close"]'); if (close) await close.click(); }
    return { modal };
  }), null, 2));


  console.log('\n--- admin: refund sheet on an order');
  console.log(JSON.stringify(await pressed('admin', '/admin/orders', async (page) => {
    // the refund lives in an order's Manage sheet, so open one first
    const visible = (sel, re) => page.evaluate((s, r) => {
      const b = [...document.querySelectorAll(s)].filter((x) => new RegExp(r, 'i').test(x.innerText || '') && x.offsetParent);
      if (!b.length) return false;
      b[b.length - 1].click();
      return true;
    }, sel, re);
    let btns = await page.$$('xpath/.//button[contains(., "Refund")]');
    if (!btns.length) {
      // phones get cards and desks get a table, so only one Manage button is
      // actually on screen — clicking the hidden one throws
      if (!(await visible('button', '^Manage$'))) return 'no Manage button on the orders list';
      await sleep(1500);
      btns = await page.$$('xpath/.//button[contains(., "Refund")]');
    }
    if (!btns.length) return 'no refund button visible';
    await btns[btns.length - 1].click();
    await sleep(700);
    const modal = await page.evaluate(() => {
      const m = document.querySelector('.modal');
      return m ? m.innerText.replace(/\s+/g, ' ').slice(0, 240) : null;
    });
    await page.screenshot({ path: path.join(OUT, 'admin-refund-sheet.png') });
    if (modal) { const close = await page.$('.modal button[aria-label="Close"]'); if (close) await close.click(); }
    return { modal };
  }), null, 2));

  console.log('\n--- customer: the bell in the topbar');
  console.log(JSON.stringify(await pressed('customer', '/orders', async (page) => {
    const label = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Notifications/.test(x.getAttribute('aria-label') || '') && x.offsetParent);
      if (!b) return null;
      b.click();
      return b.getAttribute('aria-label');
    });
    if (!label) return 'no bell in the topbar';
    await sleep(1400);
    const sheet = await page.evaluate(() => {
      const m = document.querySelector('.modal');
      return m ? m.innerText.replace(/\s+/g, ' ').slice(0, 260) : null;
    });
    await page.screenshot({ path: path.join(OUT, 'customer-bell-sheet.png') });
    return { label, sheet };
  }), null, 2));

  console.log('\n--- customer: the receipt button on a paid order');
  console.log(JSON.stringify(await pressed('customer', `/orders/${f.orderId}`, async (page) => {
    const label = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Download PDF/i.test(x.innerText));
      return b ? b.innerText.trim() : null;
    });
    if (!label) return 'no receipt button on a paid order';
    // pull the same bytes the button downloads, with the page's own token, and
    // check they are a real PDF rather than a JSON error saved as .pdf
    const check = await page.evaluate(async (orderId) => {
      const t = localStorage.getItem('bb_token');
      const res = await fetch(`${location.origin}/api/orders/${orderId}/receipt.pdf`, { headers: { authorization: 'Bearer ' + t } });
      const buf = new Uint8Array(await res.arrayBuffer());
      const head = String.fromCharCode(...buf.slice(0, 8));
      const tail = String.fromCharCode(...buf.slice(-6));
      return { status: res.status, type: res.headers.get('content-type'), bytes: buf.length, head, tail };
    }, f.orderId).catch((e) => ({ error: String(e.message).slice(0, 120) }));
    await page.screenshot({ path: path.join(OUT, 'customer-receipt-button.png') });
    return { label, check };
  }), null, 2));

  console.log('\n--- customer: cancel sheet');
  console.log(JSON.stringify(await pressed('customer', '/orders', async (page) => {
    const btn = await page.$('xpath/.//button[contains(., "Cancel")]');
    if (!btn) return 'no cancellable order on the list';
    await btn.click();
    await sleep(600);
    const modal = await page.evaluate(() => {
      const m = document.querySelector('.modal');
      return m ? m.innerText.replace(/\s+/g, ' ').slice(0, 240) : null;
    });
    await page.screenshot({ path: path.join(OUT, 'customer-cancel-sheet.png') });
    if (modal) { const close = await page.$('.modal button[aria-label="Cancel"], .modal button[aria-label="Close"]'); if (close) await close.click(); }
    return { modal };
  }), null, 2));

  await browser.close();
  console.log(`\n=== ${problems.length} route(s) with problems`);
  problems.forEach((p) => console.log('  ' + p));
})();
