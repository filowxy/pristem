/* Search self-check (Phase 3): recursive fs.search / fs.replace through the UI.
   Builds an isolated nested subtree and scopes every query to it (include
   __p3__/**) so the run is deterministic and never edits its own source.
   Exercises query / include / exclude / regex / invalid-regex / Replace-All /
   trash-exclusion / quick-open, then cleans up.
   Run against a fresh serving instance: node _search-selfcheck.cjs */
const { chromium } = require('playwright-core');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = process.env.PR_URL || 'http://127.0.0.1:8787/';
const TOKEN = 'findme';
const REPL = 'foundme';
const SCOPE = '__p3__/**';

const rows = [];
const check = (name, ok, detail = '') => {
  rows.push({ name, ok });
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
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.app-shell', { timeout: 20000 });
  await page.waitForTimeout(2200);
  // The first-run guide only appears on a fresh profile; dismiss it for this suite.
  if (await page.locator('.guide-overlay').count()) {
    await page.locator('.guide-skip').click();
    await page.waitForSelector('.guide-overlay', { state: 'detached' });
  }

  const io = (body) => page.evaluate(async (b) => {
    const r = await fetch('/api/io', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(b),
    });
    try { return await r.json(); } catch { return {}; }
  }, body);
  const wait = (ms) => page.waitForTimeout(ms);
  const query = (v) => page.locator('.side-search input').fill(v);
  const include = (v) => page.locator('.search-filters input').nth(0).fill(v);
  const exclude = (v) => page.locator('.search-filters input').nth(1).fill(v);
  const groups = () => page.locator('.search-group').count();
  const groupPaths = () => page.locator('.search-group-path').allTextContents();
  const toggle = (n) => page.locator('.search-toggle').nth(n).click();
  const settleHits = async () => { await wait(400); await page.waitForSelector('.search-summary', { timeout: 15000 }); await wait(200); };
  const settleErr = async () => { await wait(400); await page.waitForSelector('.search-error', { timeout: 15000 }); await wait(200); };

  // ---- setup: nested subtree with a shared token -------------------------
  await io({ op: 'fs.mkdir', path: '__p3__' });
  await io({ op: 'fs.mkdir', path: '__p3__/src' });
  await io({ op: 'fs.mkdir', path: '__p3__/src/sub' });
  await io({ op: 'fs.mkdir', path: '__p3__/docs' });
  await io({ op: 'fs.write', path: '__p3__/src/a.ts', content: `line one ${TOKEN}\nline two\n` });
  await io({ op: 'fs.write', path: '__p3__/src/sub/b.ts', content: `nested ${TOKEN} here\n` });
  await io({ op: 'fs.write', path: '__p3__/docs/c.md', content: `# doc ${TOKEN}\n` });
  await io({ op: 'fs.write', path: '__p3__/gone.txt', content: `${TOKEN} should vanish\n` });
  await io({ op: 'fs.delete', path: '__p3__/gone.txt' }); // -> .pristem/trash
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-shell', { timeout: 20000 });
  await wait(2200);
  if (await page.locator('.guide-overlay').count()) {
    await page.locator('.guide-skip').click();
    await page.waitForSelector('.guide-overlay', { state: 'detached' });
  }

  // ---- open the search view, scoped to the subtree -----------------------
  await page.keyboard.press('Control+Shift+F');
  await page.waitForSelector('.search-panel', { timeout: 5000 });
  check('search: Ctrl+Shift+F opens the search panel', (await page.locator('.search-panel').count()) === 1);
  await include(SCOPE);

  // ---- recursive hits across nested dirs ---------------------------------
  await query(TOKEN);
  await settleHits();
  const paths = await groupPaths();
  check('search: finds nested files recursively', (await groups()) === 3, `groups=${await groups()} ${paths.join(',')}`);
  check('search: includes a deeply nested hit', paths.some((p) => p.includes('src/sub/b.ts')), paths.join(','));
  check('search: never searches .pristem/trash', !paths.some((p) => p.includes('gone.txt') || p.includes('.pristem')), paths.join(','));

  // ---- include glob narrows further --------------------------------------
  await include('__p3__/**/*.md');
  await settleHits();
  const incPaths = await groupPaths();
  check('search: include glob narrows to *.md', (await groups()) === 1 && incPaths[0].endsWith('c.md'), incPaths.join(','));
  await include(SCOPE);
  await settleHits();

  // ---- exclude glob -------------------------------------------------------
  await exclude('**/*.md');
  await settleHits();
  const excPaths = await groupPaths();
  check('search: exclude glob drops *.md', !excPaths.some((p) => p.endsWith('c.md')) && (await groups()) === 2, excPaths.join(','));
  await exclude('');
  await settleHits();

  // ---- regex mode + invalid regex ----------------------------------------
  await toggle(2); // .*
  await query('findm[e]');
  await settleHits();
  check('search: regex mode matches', (await groups()) === 3, `groups=${await groups()}`);
  await query('findme[');
  await settleErr();
  check('search: invalid regex surfaces an error', (await page.locator('.search-error').count()) === 1);
  await toggle(2); // back to literal
  await query(TOKEN);
  await settleHits();

  // ---- scopes: open editors / current folder -----------------------------
  const aGroup = page.locator('.search-group').filter({ has: page.locator('.search-group-path', { hasText: 'src/a.ts' }) });
  await aGroup.locator('.search-hit').first().click();
  await wait(900);
  check('search: opening a hit keeps the search view', (await page.locator('.search-panel').count()) === 1);
  const scopeBtn = (i) => page.locator('.search-scope button').nth(i);
  await scopeBtn(1).click();
  await settleHits();
  let scopedPaths = await groupPaths();
  check('search: open-editors scope limits hits to open files',
    scopedPaths.length === 1 && scopedPaths[0].includes('a.ts'), scopedPaths.join(','));
  await scopeBtn(2).click();
  await settleHits();
  scopedPaths = await groupPaths();
  check('search: current-folder scope limits hits to that folder',
    scopedPaths.length === 2 && scopedPaths.every((p) => p.includes('__p3__/src/')), scopedPaths.join(','));
  await scopeBtn(0).click();
  await settleHits();
  check('search: workspace scope restores every hit', (await groups()) === 3, `groups=${await groups()}`);

  // ---- Replace All with local confirm (scoped) ---------------------------
  await toggle(3); // ⇄ open replace row
  await page.waitForSelector('.search-replace input', { timeout: 4000 });
  await page.locator('.search-replace input').fill(REPL);
  await page.locator('.search-replace .primary-btn').click(); // Replace All -> confirm
  await page.waitForSelector('.search-replace-confirm', { timeout: 4000 });
  check('search: Replace All asks for confirmation', (await page.locator('.search-replace-confirm').count()) === 1);
  const previewRows = await page.locator('.search-replace-preview .search-preview-row').count();
  check('search: confirm previews per-file replacement counts', previewRows === 3, `rows=${previewRows}`);
  await page.locator('.search-replace-confirm .primary-btn').click(); // confirm
  await page.waitForSelector('.search-done', { timeout: 8000 });
  check('search: Replace All reports completion', (await page.locator('.search-done').count()) === 1);
  const after = await io({ op: 'fs.read', path: '__p3__/src/a.ts' });
  check('search: replace wrote to disk', typeof after.content === 'string' && after.content.includes(REPL) && !after.content.includes(TOKEN), JSON.stringify(after).slice(0, 80));
  const afterNested = await io({ op: 'fs.read', path: '__p3__/src/sub/b.ts' });
  check('search: replace reached nested files', typeof afterNested.content === 'string' && afterNested.content.includes(REPL));

  // ---- quick open uses the recursive file index --------------------------
  await page.keyboard.press('Control+p');
  await page.waitForSelector('.palette-head input', { timeout: 5000 });
  await page.locator('.palette-head input').fill('b.ts');
  await wait(500);
  const paletteText = await page.locator('.palette-list').innerText();
  check('quick-open: lists nested files from the index', paletteText.includes('src/sub/b.ts'), paletteText.replace(/\n/g, '|').slice(0, 120));
  await page.keyboard.press('Escape');

  // ---- cleanup ------------------------------------------------------------
  await io({ op: 'fs.delete', path: '__p3__' });
  await wait(400);

  check('search: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  const passed = rows.filter((r) => r.ok).length;
  console.log(`\n${passed}/${rows.length} checks passed`);
  await browser.close();
  process.exit(passed === rows.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });