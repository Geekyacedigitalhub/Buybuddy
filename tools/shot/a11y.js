/*
 * Accessibility sweep: runs axe-core (WCAG 2.0/2.1 A + AA) over every screen a
 * role can reach, and groups the findings by rule so the fixes can be ordered by
 * how many people they affect.
 *
 *   node a11y.js                     # every role, phone width 390
 *   ROLE=customer W=320 node a11y.js
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const B = process.env.APP || 'http://127.0.0.1:8099';
const W = Number(process.env.W || 390);
const ROLE = process.env.ROLE || 'all';
const OUT = process.env.OUT || '/home/user/shots/a11y';
const AXE = fs.readFileSync(path.join(__dirname, 'node_modules/axe-core/axe.min.js'), 'utf8');
const CHROME = '/home/user/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';

const PW = process.env.PW || 'GreenKola-2026-Lagos-813';
const ACCOUNTS = {
  guest: null,
  customer: 'customer@buybuddy.ng',
  shopper: 'shopper@buybuddy.ng',
  rider: 'rider@buybuddy.ng',
  merchant: 'merchant1@buybuddy.ng',
  admin: 'admin@buybuddy.ng',
};

const ROUTES = {
  guest: ['/', '/search?q=rice', '/browse', '/product/__PRODUCT__', '/store/__STORE__', '/login'],
  customer: ['/', '/orders', '/orders/__ORDER__', '/cart', '/checkout', '/shop-for-me', '/account',
    '/account/wallet', '/account/rewards', '/account/addresses', '/account/notifications', '/favourites', '/support'],
  shopper: ['/worker', '/worker/earnings', '/worker/account'],
  rider: ['/worker', '/worker/earnings', '/worker/account'],
  merchant: ['/merchant', '/merchant/orders', '/merchant/products', '/merchant/settlements', '/merchant/settings'],
  admin: ['/admin', '/admin/orders', '/admin/users', '/admin/merchants', '/admin/workers', '/admin/products',
    '/admin/finance', '/admin/cash', '/admin/promos', '/admin/banners', '/admin/tickets', '/admin/settings',
    '/admin/integrations', '/admin/audit'],
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

async function ids(t) {
  const get = async (p) => (await fetch(B + p, { headers: { Authorization: `Bearer ${t}` } })).json();
  const products = await get('/api/products?limit=1');
  const orders = await get('/api/orders?limit=1');
  const out = { PRODUCT: products.products?.[0]?.id, ORDER: orders.orders?.[0]?.id };
  const stores = await get('/api/stores/' + (products.products?.[0]?.store_id || ''));
  out.STORE = products.products?.[0]?.store_id || stores.store?.id;
  return out;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const roles = ROLE === 'all' ? ['guest', 'customer', 'shopper', 'rider', 'merchant', 'admin'] : [ROLE];
  const findings = {}; // rule -> {impact, help, screens:Set, nodes:[], example}
  const screenReport = [];

  for (const role of roles) {
    const t = await token(ACCOUNTS[role]);
    const replacements = t ? await ids(t) : {};
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    if (t) await page.evaluateOnNewDocument((tok) => localStorage.setItem('bb_token', tok), t);

    for (const raw of ROUTES[role]) {
      const route = raw.replace('__PRODUCT__', replacements.PRODUCT).replace('__ORDER__', replacements.ORDER).replace('__STORE__', replacements.STORE);
      if (route.includes('undefined')) continue;
      await page.goto(B + '/#' + route, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1400));
      await page.evaluate(AXE).catch(() => {});
      const res = await page.evaluate(async () => {
        // eslint-disable-next-line no-undef
        const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
        return r.violations.map((v) => ({
          id: v.id, impact: v.impact, help: v.help, count: v.nodes.length,
          nodes: v.nodes.slice(0, 3).map((n) => ({ target: n.target.join(' '), summary: (n.failureSummary || '').split('\n').slice(0, 3).join(' | ') })),
        }));
      }).catch(() => []);
      const name = `${role}${route.replace(/[/?=]/g, '_') || '_home'}`;
      screenReport.push({ screen: name, violations: res.reduce((s, v) => s + v.count, 0), rules: res.map((v) => `${v.id}×${v.count}`) });
      for (const v of res) {
        const cur = findings[v.id] || (findings[v.id] = { impact: v.impact, help: v.help, nodes: 0, screens: new Set(), example: v.nodes[0] });
        cur.nodes += v.count;
        cur.screens.add(name);
      }
      if (res.length) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false }).catch(() => {});
    }
    await page.close();
    console.log(`${role.padEnd(9)} done`);
  }

  const rows = Object.entries(findings)
    .map(([rule, v]) => ({ rule, impact: v.impact, nodes: v.nodes, screens: v.screens.size, help: v.help }))
    .sort((a, b) => b.nodes - a.nodes);
  console.log('\nrule                          impact   nodes  screens  what it is');
  for (const r of rows) console.log(`${r.rule.padEnd(29)} ${String(r.impact).padEnd(8)} ${String(r.nodes).padEnd(6)} ${String(r.screens).padEnd(8)} ${r.help}`);
  const total = rows.reduce((s, r) => s + r.nodes, 0);
  console.log(`\n=== ${total} problem(s) across ${Object.keys(findings).length} rule(s), ${screenReport.length} screens at ${W}px`);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ at: new Date().toISOString(), app: B, width: W, total, rows, screens: screenReport, detail: Object.fromEntries(Object.entries(findings).map(([k, v]) => [k, { ...v, screens: [...v.screens] }])) }, null, 1));
  await browser.close();
})();
