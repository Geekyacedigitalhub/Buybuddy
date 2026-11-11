/*
 * Text-size check. Sets the app's own text size (normal / large / extra large) and
 * then looks for the two things that go wrong when a layout grows: sideways
 * scrolling, and text or controls cut off by a box that cannot grow.
 *
 *   node zoom.js            # all roles, 390 px
 *   W=320 node zoom.js
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const B = process.env.APP || 'http://127.0.0.1:8099';
const W = Number(process.env.W || 390);
const PW = process.env.PW || 'GreenKola-2026-Lagos-813';
const OUT = process.env.OUT || '/home/user/shots/zoom';
const CHROME = '/home/user/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const SIZES = ['normal', 'large', 'xlarge'];
const ACCOUNTS = {
  guest: null,
  customer: 'customer@buybuddy.ng',
  shopper: 'shopper@buybuddy.ng',
  rider: 'rider@buybuddy.ng',
  merchant: 'merchant1@buybuddy.ng',
  admin: 'admin@buybuddy.ng',
};
const ROUTES = {
  guest: ['/', '/search?q=rice', '/browse', '/login', '/product/__PRODUCT__', '/store/__STORE__'],
  customer: ['/', '/orders', '/cart', '/checkout', '/shop-for-me', '/account', '/account/wallet',
    '/account/rewards', '/account/addresses', '/account/notifications', '/favourites', '/support'],
  shopper: ['/worker', '/worker/earnings', '/worker/account'],
  rider: ['/worker', '/worker/earnings', '/worker/account'],
  merchant: ['/merchant', '/merchant/orders', '/merchant/products', '/merchant/settlements', '/merchant/settings'],
  admin: ['/admin', '/admin/orders', '/admin/users', '/admin/products', '/admin/settings'],
};
fs.mkdirSync(OUT, { recursive: true });

async function token(email) {
  if (!email) return null;
  const r = await fetch(B + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: email, password: PW }),
  });
  const j = await r.json();
  if (!j.token) throw new Error(`login failed for ${email}: ${JSON.stringify(j).slice(0, 120)}`);
  return j.token;
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const p = await (await fetch(B + '/api/products?limit=1')).json();
  const ids = { PRODUCT: p.products?.[0]?.id || '', STORE: p.products?.[0]?.store_id || '' };
  const problems = [];

  for (const [role, email] of Object.entries(ACCOUNTS)) {
    const t = await token(email);
    for (const size of SIZES) {
      const page = await browser.newPage();
      await page.setViewport({ width: W, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await page.evaluateOnNewDocument((tok, sz) => {
        localStorage.clear();
        if (tok) localStorage.setItem('bb_token', tok);
        localStorage.setItem('bb_textsize', sz);
      }, t, size);
      for (const raw of ROUTES[role]) {
        const route = raw.replace('__PRODUCT__', ids.PRODUCT).replace('__STORE__', ids.STORE);
        await page.goto(B + '/#' + route, { waitUntil: 'networkidle2' });
        await new Promise((r) => setTimeout(r, 900));
        const found = await page.evaluate(() => {
          const out = [];
          const de = document.documentElement;
          if (de.scrollWidth > window.innerWidth + 2) {
            out.push(`the page scrolls sideways: ${de.scrollWidth}px wide in a ${window.innerWidth}px screen`);
          }
          for (const el of document.querySelectorAll('body *')) {
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            // text cut off inside a fixed-height box
            // text cut off: compare where the last line of text ends, not scrollHeight —
            // a decorative circle behind the hero makes scrollHeight lie
            const lastText = [...el.querySelectorAll('*')].filter((c) => c.children.length === 0 && c.innerText?.trim()).pop();
            if ((cs.overflowY === 'hidden' || cs.overflowY === 'clip') && lastText) {
              const lr = lastText.getBoundingClientRect();
              if (lr.bottom > r.bottom + 4) {
                out.push(`cut-off text in <${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 28)}">: "${lastText.innerText.trim().slice(0, 32)}"`);
              }
            }
            // a control pushed off the right edge — unless it sits inside a strip that
            // is meant to scroll sideways (tables, chip rows), where off-screen is normal
            let scroller = el.parentElement, scrolls = false;
            while (scroller && scroller !== document.body) {
              const sc = getComputedStyle(scroller);
              if (/auto|scroll/.test(sc.overflowX)) { scrolls = true; break; }
              scroller = scroller.parentElement;
            }
            if (!scrolls && r.right > window.innerWidth + 4 && cs.position !== 'fixed' && r.width < window.innerWidth) {
              out.push(`control past the right edge: <${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 28)}"> at ${Math.round(r.right)}px`);
            }
          }
          return [...new Set(out)];
        });
        for (const f of found) problems.push({ role, size, route, what: f });
      }
      if (size !== 'normal') {
        await page.goto(B + '/#' + ROUTES[role][0], { waitUntil: 'networkidle2' });
        await new Promise((r) => setTimeout(r, 800));
        await page.screenshot({ path: `${OUT}/${role}-${size}-${W}.png` });
      }
      await page.close();
    }
    console.log(role, 'done');
  }

  const bySize = {};
  for (const p2 of problems) bySize[p2.size] = (bySize[p2.size] || 0) + 1;
  console.log('\n=== %d problem(s) at %d px — %s', problems.length, W, JSON.stringify(bySize));
  const seen = new Set();
  for (const p2 of problems) {
    const key = p2.what.slice(0, 90);
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`  ${p2.size.padEnd(7)} ${p2.role}/${p2.route}  ${p2.what}`);
  }
  fs.writeFileSync(`${OUT}/zoom.json`, JSON.stringify({ W, problems }, null, 1));
  await browser.close();
})();
