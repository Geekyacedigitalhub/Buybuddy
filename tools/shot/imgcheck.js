const puppeteer = require('puppeteer');
const B = process.env.APP;
const CHROME = '/home/user/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: 'customer@buybuddy.ng', password: 'GreenKola-2026-Lagos-813' }) });
  const j = await r.json();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('bb_token', t), j.token);
  for (const [name, path] of [['home', '/'], ['pdp', '/'], ['browse', '/browse']]) {
    await page.goto(B + path, { waitUntil: 'networkidle2' });
    if (name === 'pdp') {
      await page.evaluate(() => document.querySelector('.prod')?.click());
      await new Promise((r) => setTimeout(r, 3000));
    }
    await new Promise((r) => setTimeout(r, 1200));
    await page.screenshot({ path: `/home/user/shots/perf-${name}-390.png` });
    const st = await page.evaluate(() => ({
      url: location.hash,
      imgs: [...document.images].map((i) => {
        const r = i.getBoundingClientRect();
        return { src: i.currentSrc.split('/').pop(), w: i.naturalWidth, drawn: Math.round(r.width),
          onScreen: r.top < innerHeight && r.bottom > 0, ok: i.complete && i.naturalWidth > 0 };
      }),
    }));
    const bad = st.imgs.filter((i) => !i.ok && i.onScreen);
    console.log(name, st.url, 'BROKEN on screen:', bad.length, '| not-yet-loaded off screen:', st.imgs.filter((i) => !i.ok && !i.onScreen).length, '| total:', st.imgs.length);
    if (bad.length) console.log('   ', bad.map((b) => b.src).join(', '));
    console.log('  ', st.imgs.slice(0, 6).map((i) => `${i.src}@{i.drawn}px n=${i.w}`.replace('{i.drawn}', i.drawn)).join(' | '));
  }
  await browser.close();
})();
