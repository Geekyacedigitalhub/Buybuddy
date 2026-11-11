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
  await page.goto(B + '/', { waitUntil: 'networkidle2' });
  await new Promise((r2) => setTimeout(r2, 1600));
  const out = await page.evaluate(() => {
    const res = [];
    for (const el of document.querySelectorAll('.sub')) {
      const cs = getComputedStyle(el);
      const chain = [];
      let p = el;
      while (p && p !== document.body) {
        const s = getComputedStyle(p);
        if (s.opacity !== '' && s.opacity !== '1') chain.push(`${p.tagName}.${p.className} opacity=${s.opacity}`);
        p = p.parentElement;
      }
      res.push({ text: el.innerText.slice(0, 40), color: cs.color, bg: getComputedStyle(el.parentElement).backgroundColor, chain: chain.join(' | ') });
    }
    return res;
  });
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
