const fs = require('fs'); const path = require('path'); const puppeteer = require('puppeteer');
const B = process.env.APP || 'http://127.0.0.1:8099';
const AXE = fs.readFileSync(path.join(__dirname, 'node_modules/axe-core/axe.min.js'), 'utf8');
const CHROME = '/home/user/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PW = 'GreenKola-2026-Lagos-813';
const ROUTE = process.env.ROUTE || '/';
const EMAIL = process.env.EMAIL || 'customer@buybuddy.ng';
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
  const r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: EMAIL, password: PW }) });
  const j = await r.json();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('bb_token', t), j.token);
  await page.goto(B + '/#' + ROUTE, { waitUntil: 'networkidle2' });
  await new Promise((r2) => setTimeout(r2, 1500));
  await page.evaluate(AXE);
  const out = await page.evaluate(async () => {
    const res = await axe.run(document, { runOnly: ['color-contrast', 'button-name', 'nested-interactive', 'link-name', 'label', 'aria-allowed-attr', 'aria-required-children', 'list', 'heading-order', 'landmark-one-main', 'region', 'duplicate-id', 'tabindex'] });
    return res.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => ({ t: n.target.join(' '), s: (n.failureSummary || '').replace(/\n/g, ' | ') })) }));
  });
  for (const v of out) {
    console.log('==', v.id, v.nodes.length);
    for (const n of v.nodes.slice(0, 40)) console.log('  ', n.t, '::', n.s.slice(0, 220));
  }
  await browser.close();
})();
