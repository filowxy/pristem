// Temporary: capture the current UI at desktop and narrow widths.
// Deleted after use.
const { chromium } = require('playwright-core');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = process.env.PR_URL || 'http://127.0.0.1:8790/';
const OUT = process.env.PR_SHOT_DIR || 'D:/projects/pristem/pristem-desktop/.screenshots/before';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({
    executablePath: EDGE, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  for (const [name, width, height] of [['desktop', 1440, 900], ['narrow', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.app-shell', { timeout: 20000 });
    await sleep(2500);
    const skip = page.getByText('稍后设置', { exact: true });
    if (await skip.count()) { await skip.first().click(); await sleep(600); }
    await sleep(3500); // let the entrance animation + fonts settle
    await page.screenshot({ path: `${OUT}/${name}.png` });
    // Overflow probe: does anything stick out of the viewport?
    const overflow = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const bad = [];
      document.querySelectorAll('*').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > w + 1 || r.left < -1)) {
          bad.push(`${el.className || el.tagName}: ${Math.round(r.left)}..${Math.round(r.right)} of ${w}`);
        }
      });
      return { scrollW: document.documentElement.scrollWidth, clientW: w, bad: bad.slice(0, 8) };
    });
    console.log(name, JSON.stringify(overflow));
    await page.close();
  }
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error('SHOT ERROR', e); process.exit(1); });
