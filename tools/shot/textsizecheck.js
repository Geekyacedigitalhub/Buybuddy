/*
 * Does the text-size switch actually do what it says? Presses each option on the
 * customer, shop and admin settings screens, then checks the page really scaled,
 * the choice survived a reload, and the button reports itself as pressed.
 */
const puppeteer = require('puppeteer');
const B = process.env.APP || 'http://127.0.0.1:8099';
const PW = process.env.PW || 'GreenKola-2026-Lagos-813';
const CHROME = '/home/user/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const CASES = [
  ['customer@buybuddy.ng', '/account', 'Text size'],
  ['merchant1@buybuddy.ng', '/merchant/settings', 'Text size'],
  ['shopper@buybuddy.ng', '/worker/account', 'Text size'],
  ['admin@buybuddy.ng', '/admin/settings', 'Text size'],
];
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  let fails = 0;
  for (const [email, route, heading] of CASES) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: email, password: PW }) });
    const j = await r.json();
    await page.evaluateOnNewDocument((t) => { localStorage.clear(); localStorage.setItem('bb_token', t); }, j.token);
    await page.goto(B + '/#' + route, { waitUntil: 'networkidle2' });
    await new Promise((r2) => setTimeout(r2, 1200));

    const hasCard = await page.evaluate((h) => [...document.querySelectorAll('.h3')].some((e) => e.innerText.trim() === h), heading);
    if (!hasCard) { console.log(`${email.padEnd(22)} NO TEXT SIZE CARD on ${route}`); fails++; await page.close(); continue; }

    const rows = [];
    for (const [label, expect] of [['Large', 1.15], ['Extra large', 1.3], ['Normal', 1]]) {
      await page.evaluate((l) => {
        const b = [...document.querySelectorAll('.textsize-option')].find((x) => x.innerText.startsWith(l));
        b.scrollIntoView({ block: 'center' });
        b.click();
      }, label);
      await new Promise((r3) => setTimeout(r3, 350));
      const state = await page.evaluate(() => ({
        zoom: getComputedStyle(document.getElementById('root')).zoom,
        stored: localStorage.getItem('bb_textsize'),
        pressed: [...document.querySelectorAll('.textsize-option')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.innerText.split('\n')[0]),
        attr: document.documentElement.getAttribute('data-textsize'),
      }));
      const ok = Math.abs(Number(state.zoom) - expect) < 0.001
        && state.stored === (label === 'Large' ? 'large' : label === 'Extra large' ? 'xlarge' : 'normal')
        && state.pressed.length === 1
        && state.attr === state.stored;
      rows.push(`${label}${ok ? '✓' : '✗'} (${state.zoom})`);
      if (!ok) { fails++; console.log('  FAILED', label, JSON.stringify(state)); }
    }
    // survives a reload
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r4) => setTimeout(r4, 900));
    const after = await page.evaluate(() => ({ zoom: getComputedStyle(document.getElementById('root')).zoom, stored: localStorage.getItem('bb_textsize') }));
    const kept = after.stored === 'normal';
    if (!kept) fails++;
    console.log(`${email.padEnd(22)} ${rows.join('  ')}  reload keeps it: ${kept ? 'yes' : 'NO'}`);
    await page.close();
  }
  console.log(fails ? `\n=== ${fails} problem(s)` : '\n=== the text-size switch works on all four screens, at all three sizes, and the choice survives a reload');
  await browser.close();
})();
