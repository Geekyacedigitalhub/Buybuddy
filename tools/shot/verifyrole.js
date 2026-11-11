const puppeteer = require('puppeteer');
const B = 'http://127.0.0.1:8099', PW = 'GreenKola-2026-Lagos-813';
const CHROME = '/home/user/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const JOBS = [['admin@buybuddy.ng', '/admin/orders'], ['merchant1@buybuddy.ng', '/merchant/products'], ['rider@buybuddy.ng', '/rider/jobs'], ['shopper@buybuddy.ng', '/shopper/jobs'], ['customer@buybuddy.ng', '/orders']];
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  for (const [email, route] of JOBS) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844 });
    const r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: email, password: PW }) });
    const j = await r.json();
    if (!j.token) { console.log(email, 'LOGIN FAILED', JSON.stringify(j).slice(0, 80)); await page.close(); continue; }
    await page.evaluateOnNewDocument((t) => localStorage.setItem('bb_token', t), j.token);
    await page.goto(B + '/#' + route, { waitUntil: 'networkidle2' });
    await new Promise((r2) => setTimeout(r2, 1200));
    const info = await page.evaluate(() => ({ hash: location.hash, h1: (document.querySelector('h1,h2,.h1,.h2') || {}).innerText || '', rows: document.querySelectorAll('table tbody tr, .list-row, .card').length }));
    console.log(email.padEnd(24), route.padEnd(18), '->', info.hash, '|', JSON.stringify(info.h1).slice(0, 40), '| blocks', info.rows);
    await page.close();
  }
  await browser.close();
})();
