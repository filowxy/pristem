// Capture the current pristem UI across modes for the redesign study.
const { chromium } = require('playwright-core');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = process.env.PR_URL || 'http://127.0.0.1:8795/';
const OUT = 'D:/projects/pristem/pristem-desktop/.screenshots/current';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({
    executablePath: EDGE, headless: true,
    args: ['--no-sandbox', '--disable-dev-gpu', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.app-shell', { timeout: 20000 });
  await sleep(2500);
  await page.screenshot({ path: `${OUT}/01-guide.png` });

  const skip = page.getByText('稍后设置', { exact: true });
  if (await skip.count()) { await skip.first().click(); await sleep(800); }
  await sleep(3000);
  await page.screenshot({ path: `${OUT}/02-welcome.png` });

  // Open a folder via the UI fallback (paste-path dialog in headless).
  const openBtn = page.getByText('打开文件夹', { exact: true }).first();
  if (await openBtn.count()) {
    await openBtn.click();
    await sleep(600);
    const input = page.locator('.path-dialog input, input[placeholder*="路径" i], input').last();
    if (await page.locator('.path-dialog').count()) {
      await page.locator('.path-dialog input').fill('D:\\projects\\pristem');
      const ok = page.locator('.path-dialog').getByText('打开', { exact: true });
      if (await ok.count()) { await ok.click(); await sleep(2500); }
    }
  }
  await sleep(2500);
  await page.screenshot({ path: `${OUT}/03-coding.png` });

  // Cycle the mode switcher to capture other modes.
  const modeBtn = page.locator('.titlebar [class*="mode"], .titlebar button').first();
  const labels = ['ide', 'helping', 'advisor', 'goal', 'deepsleep'];
  for (const label of labels) {
    try {
      const el = page.locator('.titlebar').getByText(label, { exact: false }).first();
      if (await el.count()) {
        await el.click();
        await sleep(1800);
        await page.screenshot({ path: `${OUT}/04-${label}.png` });
      }
    } catch (e) { console.log('mode skip', label, String(e).slice(0, 120)); }
  }

  // Narrow window
  await page.setViewportSize({ width: 900, height: 700 });
  await sleep(1200);
  await page.screenshot({ path: `${OUT}/05-narrow.png` });

  await browser.close();
  console.log('shots done');
  process.exit(0);
})().catch((e) => { console.error('SHOT ERROR', e); process.exit(1); });
