/*
 * What a customer on a bad network actually sees.
 *
 * Blocks every /api call (the way a phone with no signal fails), opens the
 * screens that fetch, and asserts each one says "we could not load this" rather
 * than claiming the customer's orders do not exist. Then unblocks and presses
 * Try again, and asserts the real data arrives.
 */
const puppeteer = require('puppeteer');

const B = process.env.APP || 'http://127.0.0.1:8099';
/* Which role to walk. The worker and the shop are the other two screens that
   turned a failed request into bad news about their business. */
const ROLES = {
  customer: {
    email: 'customer@buybuddy.ng',
    checks: [['/orders', 'your orders'], ['/account/notifications', 'your notifications'], ['/favourites', 'your favourites'], ['/browse', 'the list'], ['/', 'the shop'], ['__ORDER__', 'this order']],
    recovered: /Your orders|Active|Past/i,
  },
  worker: {
    email: 'rider@buybuddy.ng',
    checks: [['/worker', 'your jobs']],
    recovered: /Jobs|Earnings|available|Online|Offline/i,
  },
  merchant: {
    email: 'merchant1@buybuddy.ng',
    checks: [['/merchant', 'your dashboard'], ['/merchant/settlements', 'your settlements']],
    recovered: /Orders|Revenue|Settlement/i,
  },
};
const ROLE = process.env.ROLE || 'customer';
const EMAIL = process.env.EMAIL || ROLES[ROLE].email;
const PW = process.env.PW || 'Password123!';
const OUT = process.env.OUT || '/home/user/shots/offline';
const CHROME = '/home/user/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';

const LIES = [
  'No active orders', 'No past orders yet', 'Nothing here yet', 'No favourites',
  'No products listed', 'no longer listed', 'Rewards unavailable', 'Could not load your settlements',
];

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const client = await page.target().createCDPSession();
  await client.send('Network.enable');

  const r = await fetch(B + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: EMAIL, password: PW }),
  });
  const j = await r.json();
  if (!j.token) throw new Error('login failed: ' + JSON.stringify(j));
  await page.evaluateOnNewDocument((t) => localStorage.setItem('bb_token', t), j.token);

  // Warm the shell once so the app itself is cached, as it would be for a returning user.
  await page.goto(B + '/', { waitUntil: 'networkidle2' });
  const orderId = await page.evaluate(async () => {
    const res = await fetch(location.origin + '/api/orders?limit=1', { headers: { Authorization: 'Bearer ' + localStorage.getItem('bb_token') } });
    const d = await res.json();
    return d.orders?.[0]?.id || null;
  });

  await client.send('Network.setBlockedURLs', { urls: ['*/api/*'] });

  const problems = [];
  const checks = ROLES[ROLE].checks
    .map(([p, what]) => (p === '__ORDER__' ? (orderId ? [`/orders/${orderId}`, what] : null) : [p, what]))
    .filter(Boolean);

  for (const [path, what] of checks) {
    await page.goto(B + '#' + path, { waitUntil: 'domcontentloaded' });
    await new Promise((r2) => setTimeout(r2, 2500));
    const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    const said = LIES.filter((l) => text.includes(l));
    const honest = /No internet|could not reach|Try again|did not answer/i.test(text);
    const hasRetry = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => /try again/i.test(b.textContent)));
    const name = path.replace(/\//g, '_') || 'home';
    await page.screenshot({ path: `${OUT}/${name}.png` }).catch(() => {});
    if (said.length) problems.push(`${path}: claims "${said.join('", "')}" while offline`);
    if (!honest) problems.push(`${path}: nothing on screen said the load failed`);
    if (!hasRetry) problems.push(`${path}: no Try again button`);
    console.log(`${path.padEnd(28)} failed-openly: ${honest ? 'yes' : 'NO'}  retry: ${hasRetry ? 'yes' : 'NO'}  lies: ${said.length ? said.join(', ') : 'none'}  (expected copy for ${what})`);
  }

  // the strip under the topbar, and the same page once the signal is back
  await client.send('Network.setBlockedURLs', { urls: [] });
  await page.goto(B + '#/orders', { waitUntil: 'domcontentloaded' });
  await new Promise((r3) => setTimeout(r3, 1200));
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /try again/i.test(x.textContent));
    if (b) { b.click(); return true; }
    return false;
  });
  await new Promise((r4) => setTimeout(r4, 3000));
  const after = await page.evaluate(() => document.body.innerText);
  // the screen either recovered on its own when the signal came back, or the
  // customer pressed the button — both are a pass, a dead end is not
  const reloaded = !/No internet/i.test(after) && !/Try again/i.test(after) && ROLES[ROLE].recovered.test(after);
  console.log(`recovery                   button: ${clicked ? 'pressed' : 'not needed (auto-retry)'}  orders back: ${reloaded ? 'yes' : 'NO'}`);
  if (!reloaded) problems.push('the orders did not come back after the signal returned');
  await page.screenshot({ path: `${OUT}/orders-recovered.png` }).catch(() => {});

  // and the honest strip while the device itself is offline
  await page.goto(B + '#/orders', { waitUntil: 'domcontentloaded' });
  await new Promise((r5) => setTimeout(r5, 1200));
  await client.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await new Promise((r5b) => setTimeout(r5b, 1200));
  const bar = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const strip = /You are offline/i.test(bar);
  console.log(`offline strip              ${strip ? 'shown' : 'NOT SHOWN'}`);
  if (!strip) problems.push('no offline strip while the device is offline');
  await page.screenshot({ path: `${OUT}/offline-strip.png` }).catch(() => {});
  await client.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  await browser.close();
  console.log(problems.length ? `\n=== ${problems.length} problem(s)\n- ` + problems.join('\n- ') : '\n=== 0 problems: every screen failed openly and recovered');
  process.exit(problems.length ? 1 : 0);
})();
