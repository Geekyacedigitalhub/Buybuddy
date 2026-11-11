/**
 * 360 px sweep: the smallest phone screen we support (a Galaxy A-series in a
 * browser, or the app with the system font size turned up).
 *
 * For every screen, as every role, it asks two questions a screenshot cannot:
 *  1. Can the page be wider than the screen? (a sideways scroll is a broken page
 *     on a phone, not a design choice)
 *  2. At the very bottom of the page, is any text sitting underneath a fixed bar
 *     (bottom nav, product buy bar, chat composer)? That is the bug that made the
 *     last line of a product page disappear behind "Add to cart".
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const B = process.env.APP || 'https://buybuddy-805j.onrender.com';
const PW = process.env.PW || 'GreenKola-2026-Lagos-813';
const OUT = process.env.OUT || '/home/user/shots/w360';
const W = Number(process.env.W || 360);
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
  console.log('restore', (await api('/api/admin/restore', { backup: dump, confirm: 'REPLACE ALL DATA' }, before)).status);

  const admin = (await api('/api/auth/login', { identifier: 'admin@buybuddy.ng', password: PW })).body.token;
  const customer = (await api('/api/auth/login', { identifier: 'customer@buybuddy.ng', password: PW })).body.token;
  const merchant = (await api('/api/auth/login', { identifier: 'merchant1@buybuddy.ng', password: PW })).body.token;
  const rider = (await api('/api/auth/login', { identifier: 'rider@buybuddy.ng', password: PW })).body.token;
  const shopper = (await api('/api/auth/login', { identifier: 'shopper@buybuddy.ng', password: PW })).body.token;

  const mine = (await api('/api/orders?limit=50', null, customer)).body.orders || [];
  const paidOrder = mine.find((o) => ['paid', 'paid_cash'].includes(o.payment_status)) || mine[0];
  const products = (await api('/api/products?limit=10')).body.products;
  const merchants = (await api('/api/merchants?limit=5', null, admin)).body.merchants || [];

  return {
    tokens: { customer, merchant, rider, shopper, admin },
    orderId: paidOrder?.id,
    productId: products[0]?.id,
    storeId: products[0]?.store?.id,
    merchantId: merchants[0]?.id,
  };
}

const ROUTES = (f) => ({
  guest: ['/', '/search', '/browse', '/cart'],
  customer: ['/', '/search', '/browse', `/store/${f.storeId}`, `/product/${f.productId}`, '/cart', '/checkout',
    '/shop-for-me', '/orders', `/orders/${f.orderId}`, '/account', '/account/wallet', '/account/rewards',
    '/account/addresses', '/account/notifications', '/support', '/favourites'],
  shopper: ['/worker', '/worker/earnings', '/worker/account'],
  rider: ['/worker', '/worker/earnings', '/worker/account'],
  merchant: ['/merchant', '/merchant/orders', '/merchant/products', '/merchant/settlements', '/merchant/settings'],
  admin: ['/admin', '/admin/today', '/admin/orders', '/admin/people', '/admin/merchants', '/admin/workers',
    '/admin/products', '/admin/finance', '/admin/marketing', '/admin/support', '/admin/settings',
    '/admin/integrations', '/admin/audit'],
});

const probe = () => {
  const vw = window.innerWidth;
  const bars = [...document.querySelectorAll('body *')].filter((el) => {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') return false;
    const r = el.getBoundingClientRect();
    return r.height > 20 && r.width > vw * 0.5 && r.bottom > window.innerHeight - 4 && r.top > window.innerHeight * 0.5;
  });
  const scrollers = [...document.querySelectorAll('*')].filter(
    (x) => x.scrollHeight > x.clientHeight + 40 && getComputedStyle(x).overflowY !== 'visible'
  );
  const sc = scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
  if (sc) sc.scrollTop = sc.scrollHeight;
  else window.scrollTo(0, document.body.scrollHeight);

  const barTop = bars.length ? Math.min(...bars.map((b) => b.getBoundingClientRect().top)) : window.innerHeight;
  const inBar = (el) => bars.some((b) => b.contains(el));
  const hidden = [];
  for (const el of document.querySelectorAll('span, p, div, h1, h2, h3, td, li')) {
    if (inBar(el)) continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    const txt = (el.innerText || '').trim();
    if (!txt || el.querySelector('*')) continue; // leaf text only
    const r = el.getBoundingClientRect();
    if (r.height === 0 || r.width === 0) continue;
    if (r.top < barTop && r.bottom > barTop + 2) hidden.push({ text: txt.slice(0, 40), bottom: Math.round(r.bottom), barTop: Math.round(barTop) });
  }

  // Anything sticking out to the right of the screen. A card peeking out of a
  // horizontal film strip is deliberate, so only elements with no sideways
  // scroll container above them count.
  const scrollsSideways = (el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
    return false;
  };
  const over = [...document.querySelectorAll('body *')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.right > vw + 2 && r.left < vw && !scrollsSideways(el);
    })
    .slice(0, 4)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ')[0]} → ${Math.round(r.right)}px`;
    });

  return {
    docW: document.documentElement.scrollWidth,
    vw,
    hiddenUnderBar: hidden.slice(0, 3),
    overflowing: over,
    barTop: Math.round(barTop),
  };
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const f = await fixture();
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    env: { ...process.env, LD_LIBRARY_PATH: '/home/user/.cache/libs/usr/lib/x86_64-linux-gnu:/home/user/.cache/libs/lib/x86_64-linux-gnu' },
  });
  const problems = [];
  let count = 0;

  for (const [role, routes] of Object.entries(ROUTES(f))) {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: 780, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await page.evaluateOnNewDocument((t) => {
      localStorage.clear();
      if (t) localStorage.setItem('bb_token', t);
    }, role === 'guest' ? null : f.tokens[role]);

    for (const route of routes) {
      count += 1;
      const errors = [];
      const onErr = (e) => errors.push(String(e.message).slice(0, 140));
      page.on('pageerror', onErr);
      await page.goto(`${B}/#${route}`, { waitUntil: 'networkidle2', timeout: 60000 }).catch((e) => errors.push('NAV ' + e.message));
      let last = -1;
      for (let i = 0; i < 14; i++) {
        await sleep(400);
        const len = await page.evaluate(() => (document.body.innerText || '').length);
        if (len === last && len > 0) break;
        last = len;
      }
      const info = await page.evaluate(probe);
      const parts = [];
      if (info.docW > info.vw + 1) parts.push(`WIDE ${info.docW}>${info.vw}`);
      if (info.overflowing.length) parts.push('OVER ' + info.overflowing.join(', '));
      if (info.hiddenUnderBar.length) parts.push('HIDDEN ' + JSON.stringify(info.hiddenUnderBar));
      if (errors.length) parts.push('ERR ' + errors.join(' ~ '));
      const line = `${role.padEnd(8)} ${route.padEnd(26)} ${parts.length ? parts.join(' | ') : 'ok'}`;
      console.log(line);
      if (parts.length) {
        problems.push(line);
        const clean = route.replace(/[/]/g, '_') || '_home';
        await page.screenshot({ path: path.join(OUT, `${role}${clean}.png`) }).catch(() => {});
      }
      page.off('pageerror', onErr);
    }
    await page.close();
  }

  console.log(`\n=== ${count} screens at ${W} px, ${problems.length} with problems`);
  for (const p of problems) console.log('  ' + p);
  await browser.close();
})();
