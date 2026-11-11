const puppeteer = require('puppeteer');
const B = 'http://127.0.0.1:8099', PW = 'GreenKola-2026-Lagos-813';
const CHROME = '/home/user/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 320, height: 800, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: 'customer@buybuddy.ng', password: PW }) });
  const j = await r.json();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('bb_token', t), j.token);
  for (let i = 0; i < 8; i++) {
    await page.goto(B + '/?r=' + i + '#/', { waitUntil: 'domcontentloaded' });
    for (const wait of [200, 500, 900, 1400]) {
      await new Promise((r2) => setTimeout(r2, wait));
      const hit = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('*')) {
          if (el.children.length) continue;                      // leaf nodes only
          const cs = getComputedStyle(el);
          if (cs.color !== 'rgb(166, 173, 168)') continue;
          out.push({ tag: el.tagName, cls: el.className, text: (el.innerText || '').slice(0, 40), html: el.outerHTML.slice(0, 120) });
        }
        return out;
      });
      if (hit.length) { console.log('run', i, 'after', wait, JSON.stringify(hit, null, 1)); await page.screenshot({ path: '/home/user/shots/why320.png' }); await browser.close(); return; }
    }
  }
  console.log('never saw rgb(166,173,168)');
  await browser.close();
})();
