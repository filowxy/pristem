// Phase 4 E2E: split editor + shared models, data-safety guards, truncation
// guard, workspace persistence across refresh, and the mode x width overflow
// matrix. Runs against a fresh headless service on 8787 (kernel suites alone).
const { chromium } = require('playwright-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = process.env.PR_URL || 'http://127.0.0.1:8787/';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

(async () => {
  const browser = await chromium.launch({
    executablePath: EDGE, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.app-shell', { timeout: 20000 });
  await page.waitForTimeout(2200);
  // The first-run guide only appears on a fresh profile; dismiss it for this suite.
  if (await page.locator('.guide-overlay').count()) {
    await page.locator('.guide-skip').click();
    await page.waitForSelector('.guide-overlay', { state: 'detached' });
  }

  const pickMode = async (name) => {
    await page.keyboard.press('Escape'); // clear any stray overlay before opening the menu
    await page.waitForTimeout(150);
    if ((await page.locator('.mode-menu').count()) === 0) {
      await page.locator('.title-mode').click();
      await page.waitForSelector('.mode-menu', { timeout: 5000 });
    }
    await page.locator('.mode-menu button')
      .filter({ has: page.locator('.menu-name', { hasText: new RegExp('^' + name + '$') }) })
      .first().click();
    await page.waitForFunction(
      (m) => document.querySelector('.app-shell')?.className.includes('mode-' + m),
      name.toLowerCase(), { timeout: 12000 });
    await page.waitForTimeout(600);
  };
  const openFirstFile = async () => {
    const f = page.locator('.tree-item:not(.is-dir)').first();
    await f.click();
    await page.waitForTimeout(800);
  };
  const paneCount = () => page.locator('.editor-pane').count();
  const io = (body) => page.evaluate(async (b) => {
    const r = await fetch('/api/io', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
    });
    try { return await r.json(); } catch { return {}; }
  }, body);

  await pickMode('coding');
  await page.waitForSelector('.filetree', { timeout: 8000 });

  // ---- 4a split right -> 2 panes, shared model ---------------------------
  await openFirstFile();
  check('4a: one editor pane before split', (await paneCount()) === 1, `panes=${await paneCount()}`);
  await page.locator('.monaco-editor').first().click();
  await page.keyboard.press('Control+\\');
  await page.waitForTimeout(700);
  check('4a: split right yields two panes', (await paneCount()) === 2, `panes=${await paneCount()}`);
  const activeTabs = await page.locator('.editor-tab.is-active').allInnerTexts();
  check('4a: both groups show the same active file',
    activeTabs.length === 2 && activeTabs[0].trim() === activeTabs[1].trim(),
    JSON.stringify(activeTabs));

  // shared ITextModel: an edit in one pane appears in the other. Type at the
  // top so both panes' independent viewports render the changed line.
  await page.locator('.editor-pane').nth(1).locator('.monaco-editor').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('SPLIT_SHARED_MARKER');
  await page.waitForTimeout(400);
  const pane0 = await page.locator('.editor-pane').nth(0).locator('.view-lines').innerText();
  const pane1 = await page.locator('.editor-pane').nth(1).locator('.view-lines').innerText();
  check('4a: edits are shared live across panes',
    pane0.includes('SPLIT_SHARED_MARKER') && pane1.includes('SPLIT_SHARED_MARKER'));

  // ---- 4b dirty-close guard + group close merges -------------------------
  await page.keyboard.press('Control+w');
  await page.waitForTimeout(400);
  check('4b: closing a dirty tab raises the save prompt',
    (await page.locator('.save-prompt').count()) === 1);
  // Don't Save (second action button) discards and closes the empty group
  await page.locator('.save-prompt-actions button:nth-child(2)').click();
  await page.waitForTimeout(600);
  check('4a: closing the split group returns to one pane',
    (await paneCount()) === 1, `panes=${await paneCount()}`);

  // Cancel keeps the dirty tab open
  await openFirstFile();
  await page.locator('.monaco-editor').first().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('DIRTY_CANCEL');
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+w');
  await page.waitForTimeout(400);
  const promptUp = (await page.locator('.save-prompt').count()) === 1;
  await page.locator('.save-prompt-actions button:nth-child(1)').click(); // Cancel
  await page.waitForTimeout(400);
  check('4b: Cancel leaves the dirty tab open',
    promptUp && (await page.locator('.save-prompt').count()) === 0 &&
    (await page.locator('.editor-tab').count()) >= 1);

  // ---- 4b truncation guard: a >400k file opens read-only -----------------
  const bigPath = '__p4_large__.txt';
  const big = 'a'.repeat(450000);
  await io({ op: 'fs.write', path: bigPath, content: big });
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+p');
  await page.waitForTimeout(400);
  await page.keyboard.type('__p4_large__');
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  check('4b: a truncated large file shows the read-only notice',
    (await page.locator('.editor-readonly-note').count()) === 1);
  await io({ op: 'fs.delete', path: bigPath });
  await page.waitForTimeout(300);
  // close the (read-only, non-dirty) large-file tab so it does not pollute the
  // persistence tab set — restore correctly drops paths whose file is gone
  const bigTab = page.locator('.editor-tab', { hasText: '__p4_large__' });
  if (await bigTab.count()) {
    await bigTab.locator('.tab-close').click();
    await page.waitForTimeout(400);
  }

  // ---- 4d persistence across refresh -------------------------------------
  await pickMode('coding');
  await openFirstFile();
  // expand a directory and resize the left column so there is state to restore
  const dir = page.locator('.tree-item.is-dir').first();
  if (await dir.count()) { await dir.click(); await page.waitForTimeout(500); }
  const sep = page.locator('.ws-sep-left');
  await sep.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(700); // persistence debounce (300ms) + margin
  const before = await page.evaluate(() => ({
    left: Math.round(document.querySelector('.left-column')?.getBoundingClientRect().width ?? 0),
    tabs: [...document.querySelectorAll('.editor-tab')].map((e) => e.textContent.trim()),
    expanded: [...document.querySelectorAll('.tree-item.is-dir[aria-expanded="true"]')].length,
  }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-shell', { timeout: 20000 });
  await page.waitForTimeout(2600);
  // Reload kept the completion flag, but keep the suite independent of profile state.
  if (await page.locator('.guide-overlay').count()) {
    await page.locator('.guide-skip').click();
    await page.waitForSelector('.guide-overlay', { state: 'detached' });
  }
  await pickMode('coding');
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => ({
    left: Math.round(document.querySelector('.left-column')?.getBoundingClientRect().width ?? 0),
    tabs: [...document.querySelectorAll('.editor-tab')].map((e) => e.textContent.trim()),
    expanded: [...document.querySelectorAll('.tree-item.is-dir[aria-expanded="true"]')].length,
  }));
  check('4d: refresh restores the left column width',
    before.left > 268 && after.left === before.left, `before=${before.left} after=${after.left}`);
  check('4d: refresh restores open tabs',
    before.tabs.length > 0 && before.tabs.every((t) => after.tabs.includes(t)),
    `before=${JSON.stringify(before.tabs)} after=${JSON.stringify(after.tabs)}`);
  check('4d: refresh restores tree expansion',
    before.expanded > 0 && after.expanded >= before.expanded,
    `before=${before.expanded} after=${after.expanded}`);

  // ---- mode x width overflow matrix --------------------------------------
  const modes = ['coding', 'IDE', 'helping', 'advisor', 'goal', 'deepsleep'];
  const widths = [1440, 1100, 960];
  let overflowFails = 0;
  let overlapFails = 0;
  const detail = [];
  for (const m of modes) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await pickMode(m);
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(450);
      const ov = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth, inner: window.innerWidth,
      }));
      const ok = ov.scroll <= ov.inner + 1;
      if (!ok) { overflowFails++; detail.push(`${m}@${w}:${ov.scroll}>${ov.inner}`); }
      // Title-bar boxes must never collide (the IDE menu bar is the tightest fit).
      const overlaps = await page.evaluate(() => {
        const boxes = [...document.querySelectorAll('.titlebar > *')]
          .map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0);
        let n = 0;
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j];
            if (a.left < b.right - 1 && b.left < a.right - 1) n++;
          }
        }
        return n;
      });
      if (overlaps > 0) { overlapFails++; detail.push(`${m}@${w}:overlap=${overlaps}`); }
    }
  }
  check('matrix: no horizontal overflow in 6 modes x 3 widths',
    overflowFails === 0, detail.join(' | ') || '18 combinations clean');
  check('matrix: title-bar boxes never overlap', overlapFails === 0, detail.join(' | ') || '18 combinations clean');

  check('phase4: no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} phase4 checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });