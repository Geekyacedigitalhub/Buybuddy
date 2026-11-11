/*
 * Thumb-size audit. A tap target smaller than 44x44 CSS px is a miss for a lot of
 * people (Apple's guideline is 44, Google's is 48, WCAG 2.2 AA asks for 24).
 * This walks every screen each role can reach and records every visible control
 * that is smaller than 44 in either direction, ignoring targets whose parent
 * already is a big target (a link inside a link, an icon inside a button).
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const B = process.env.APP || 'http://127.0.0.1:8099';
const W = Number(process.env.W || 390);
const PW = process.env.PW || 'GreenKola-2026-Lagos-813';
const OUT = process.env.OUT || '/home/user/shots/tap';
const CHROME = '/home/user/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const ROLES = {
  guest: null,
  customer: 'customer@buybuddy.ng',
  shopper: 'shopper@buybuddy.ng',
  rider: 'rider@buybuddy.ng',
  merchant: 'merchant1@buybuddy.ng',
  admin: 'admin@buybuddy.ng',
};
async function token(email) {
  if (!email) return null;
  const r = await fetch(B + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: email, password: PW }),
  });
  const j = await r.json();
  if (!j.token) throw new Error(`login failed for ${email}: ${JSON.stringify(j).slice(0, 150)}`);
  return j.token;
}

async function sampleIds() {
  const get = async (p) => (await fetch(B + p)).json();
  const products = await get('/api/products?limit=1');
  const first = products.products?.[0];
  return { PRODUCT: first?.id, STORE: first?.store_id };
}

const ROUTES = {
  guest: ['/', '/search?q=rice', '/browse', '/login', '/product/__PRODUCT__', '/store/__STORE__'],
  customer: ['/', '/orders', '/product/__PRODUCT__', '/cart', '/checkout', '/shop-for-me', '/account',
    '/account/wallet', '/account/rewards', '/account/addresses', '/account/notifications', '/favourites', '/support'],
  shopper: ['/worker', '/worker/earnings', '/worker/account'],
  rider: ['/worker', '/worker/earnings', '/worker/account'],
  merchant: ['/merchant', '/merchant/orders', '/merchant/products', '/merchant/settlements', '/merchant/settings'],
  admin: ['/admin', '/admin/orders', '/admin/users', '/admin/merchants', '/admin/workers', '/admin/products',
    '/admin/finance', '/admin/cash', '/admin/promos', '/admin/banners', '/admin/tickets', '/admin/settings',
    '/admin/integrations', '/admin/audit'],
};
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  // one page per role: evaluateOnNewDocument scripts accumulate on a page, so the
  // previous role's "clear localStorage" would run after this role's "set token"
  await browser.newPage();
  const found = {};
  const bad = [];
  const ids = await sampleIds();
  for (const [role, email] of Object.entries(ROLES)) {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const t = await token(email);
    await page.evaluateOnNewDocument((tok) => { localStorage.clear(); if (tok) localStorage.setItem('bb_token', tok); }, t);
    for (const raw of ROUTES[role]) {
      const route = raw.replace('__PRODUCT__', ids.PRODUCT || '').replace('__STORE__', ids.STORE || '');
      await page.goto(B + '/#' + route, { waitUntil: 'networkidle2' });
      await new Promise((r2) => setTimeout(r2, 900));
      // a route that bounces to the sign-in page or 404s would otherwise be
      // measured as "no small controls" and look like a pass
      const landed = await page.evaluate(() => ({ hash: location.hash, h: (document.querySelector('h1,.h1,.h2') || {}).innerText || '' }));
      const isSignInPage = route === '/login' && landed.hash.startsWith('#/login');
      if (!isSignInPage && (landed.hash.startsWith('#/login') || /not found/i.test(landed.h))) {
        bad.push(`${role}${route} -> ${landed.hash || '#'} "${landed.h.slice(0, 30)}"`);
        continue;
      }
      const small = await page.evaluate(() => {
        const out = [];
        const sel = 'a[href], button, [role="button"], input[type="checkbox"], input[type="radio"], select, summary, [tabindex="0"]';
        for (const el of document.querySelectorAll(sel)) {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.bottom < 0 || r.top > window.innerHeight * 4) continue;   // not rendered yet (virtual lists)
          if (r.width >= 44 && r.height >= 44) continue;
          // a control inside a bigger control is not its own target
          let p = el.parentElement, covered = false;
          while (p && p !== document.body) {
            const pr = p.getBoundingClientRect();
            if (pr.width >= 44 && pr.height >= 44 && (p.matches('a[href],button,[role="button"],label'))) { covered = true; break; }
            p = p.parentElement;
          }
          if (covered) continue;
          const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.getAttribute('placeholder') || el.tagName).trim().slice(0, 40).replace(/\s+/g, ' ');
          const key = `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ').filter(Boolean).slice(0, 2).join('.')} | "${name}" | ${Math.round(r.width)}x${Math.round(r.height)}`;
          out.push(key);
        }
        return out;
      });
      for (const k of small) {
        found[k] = found[k] || new Set();
        found[k].add(`${role}${route}`);
      }
    }
    console.log(role, 'done');
    await page.close();
  }
  const rows = Object.entries(found).map(([k, v]) => ({ k, screens: v.size, where: [...v].slice(0, 3).join(' ') }))
    .sort((a, b) => b.screens - a.screens);
  if (bad.length) {
    console.log('\n!!! %d route(s) did not render (login bounce or 404) — the audit below is incomplete:', bad.length);
    for (const b of bad) console.log('   ', b);
  }
  console.log('\n=== %d distinct small controls, %d screens at %d px', rows.length, Object.values(ROUTES).flat().length, W);
  for (const r of rows) console.log(`${String(r.screens).padStart(3)}  ${r.k}   [${r.where}]`);
  fs.writeFileSync(`${OUT}/tap.json`, JSON.stringify(rows, null, 1));
  await browser.close();
})();
