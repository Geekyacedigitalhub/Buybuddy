const puppeteer = require('puppeteer');
const B = process.env.APP || 'http://127.0.0.1:8099';
const CHROME = '/home/user/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: 'customer@buybuddy.ng', password: 'GreenKola-2026-Lagos-813' }) });
  const j = await r.json();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('bb_token', t), j.token);
  await page.goto(B + '/', { waitUntil: 'networkidle2' });
  await new Promise((r2) => setTimeout(r2, 1200));

  // 1. tapping the card body (not the + button or the heart) opens the product
  await page.evaluate(() => document.querySelector('.prod').scrollIntoView({ block: 'center' }));
  await new Promise((r0) => setTimeout(r0, 600));
  const box = await page.evaluate(() => {
    const card = document.querySelector('.prod');
    const r = card.getBoundingClientRect();
    return { x: r.x + 12, y: r.y + 12 };           // top-left of the photo
  });
  await page.mouse.click(box.x, box.y);
  await new Promise((r3) => setTimeout(r3, 1800));
  const afterTap = await page.evaluate(() => location.hash);
  console.log('tap on the card photo   ->', afterTap.startsWith('#/product/') ? 'opens the product' : `WRONG: ${afterTap}`);

  await page.goto(B + '/', { waitUntil: 'networkidle2' });
  await new Promise((r4) => setTimeout(r4, 1000));

  // 2. the + button adds to the cart and does not navigate
  const before = await page.evaluate(async () => (await (await fetch('/api/cart', { headers: { Authorization: 'Bearer ' + localStorage.getItem('bb_token') } })).json()).items?.length || 0);
  await page.evaluate(() => document.querySelector('.prod-add').scrollIntoView({ block: 'center' }));
  await new Promise((r0) => setTimeout(r0, 600));
  const addBox = await page.evaluate(() => {
    const b = document.querySelector('.prod-add');
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(addBox.x, addBox.y);
  await new Promise((r5) => setTimeout(r5, 2200));
  const after = await page.evaluate(async () => (await (await fetch('/api/cart', { headers: { Authorization: 'Bearer ' + localStorage.getItem('bb_token') } })).json()).items?.length || 0);
  const hash = await page.evaluate(() => location.hash);
  console.log(`tap on the + button    -> cart ${before} -> ${after} item(s), still on ${hash === '#/' ? 'home' : hash}`);

  // 3. keyboard: the card is one focusable link with a name
  const link = await page.evaluate(() => {
    const a = document.querySelector('.prod-hit');
    return a ? { tag: a.tagName, name: a.getAttribute('aria-label'), href: a.getAttribute('href') } : null;
  });
  console.log('card link              ->', JSON.stringify(link));

  // 4. what muted text looks like now
  const colours = await page.evaluate(() => {
    const pick = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).color : null; };
    return { sub: pick('.sub'), tinyMuted: pick('.tiny.muted'), accentBtn: pick('.btn-accent') };
  });
  console.log('colours                ->', JSON.stringify(colours));
  await page.screenshot({ path: '/home/user/shots/a11y-home-390.png' });
  await browser.close();
})();
