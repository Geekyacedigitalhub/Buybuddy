const puppeteer = require('puppeteer');
const B = process.env.APP || 'http://127.0.0.1:8099';
const PW = process.env.PW || 'GreenKola-2026-Lagos-813';
const CHROME = '/home/user/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const JOBS = [
  [390, 'customer@buybuddy.ng', '/', 'home'],
  [390, 'customer@buybuddy.ng', '/browse', 'browse'],
  [390, null, '/login', 'login'],
  [390, 'customer@buybuddy.ng', '/checkout', 'checkout'],
  [390, 'customer@buybuddy.ng', '/product/prd_adEd0dTZXnmz', 'product'],
  [390, 'customer@buybuddy.ng', '/orders', 'orders'],
  [1360, 'admin@buybuddy.ng', '/admin/orders', 'admin-orders'],
  [1360, 'merchant1@buybuddy.ng', '/merchant/products', 'merchant-products'],
];
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  for (const [w, email, route, name] of JOBS) {
    // one page per job: evaluateOnNewDocument scripts stack up, so a later job's
    // "clear localStorage" would run after an earlier job's "set the token"
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: w > 800 ? 900 : 844, deviceScaleFactor: w > 800 ? 1 : 2, isMobile: w < 800, hasTouch: w < 800 });
    let token = null;
    if (email) {
      const r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: email, password: PW }) });
      token = (await r.json()).token;
    }
    await page.evaluateOnNewDocument((t) => { localStorage.clear(); if (t) localStorage.setItem('bb_token', t); }, token);
    await page.goto(B + '/#' + route, { waitUntil: 'networkidle2' });
    await new Promise((r2) => setTimeout(r2, 1500));
    await page.screenshot({ path: `/home/user/shots/tap-${name}-${w}.png` });
    console.log('shot', name, w);
  }
  await browser.close();
})();
