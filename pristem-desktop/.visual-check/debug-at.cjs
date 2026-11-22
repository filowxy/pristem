const { chromium } = require('playwright-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', m.type(), m.text()); });
  await page.goto('http://127.0.0.1:8787/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-shell');
  await page.waitForTimeout(1800);
  console.log('status:', await page.locator('.statusbar').innerText());

  await page.locator('.tree-item:not(:disabled)').first().click();
  await page.waitForTimeout(600);

  await page.locator('.title-mode').click();
  await page.locator('.mode-menu button').nth(1).click();
  await page.waitForFunction(() => document.querySelector('.app-shell')?.className.includes('mode-ide'), null, { timeout: 8000 });
  console.log('mode:', await page.locator('.app-shell').getAttribute('class'));

  await page.locator('.monaco-editor').first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('@Mod', { delay: 60 });
  await page.waitForTimeout(600);
  console.log('after @Mod summon count:', await page.locator('.summon').count());
  console.log('tail text:', (await page.locator('.view-lines').innerText()).slice(-160).replace(/\n/g, ' | '));

  await page.keyboard.press('Enter');
  await page.keyboard.type('@', { delay: 60 });
  const tail = async () => (await page.locator('.view-lines').innerText()).slice(-160).replace(/\n/g, ' | ');
  for (const ms of [100, 300, 600, 1000]) {
    await page.waitForTimeout(ms);
    console.log(`+${ms}ms summon=${await page.locator('.summon').count()} tail="${await tail()}"`);
  }
  await page.screenshot({ path: 'D:/projects/pristem/pristem-desktop/.screenshots/debug-at.png' });
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
