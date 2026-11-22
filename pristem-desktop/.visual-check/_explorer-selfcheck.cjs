/* Explorer self-check (Phase 2): real file management against a serving instance.
   Creates an isolated nested subtree, exercises depth-4 expansion, the context
   menu (create / rename / delete-to-trash), inline naming, and keyboard nav,
   then cleans up. Run: node _explorer-selfcheck.cjs */
const { chromium } = require('playwright-core');
const nodeFs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = process.env.PR_URL || 'http://127.0.0.1:8787/';

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
  page.on('pageerror', (e) => errors.push(`${e}\n${e.stack || ''}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }));
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
  const refresh = async () => {
    await page.locator('.filetree .icon-btn:has(.si-refresh)').click();
    await page.waitForTimeout(600);
  };
  const dirRow = (name) => page.locator('.tree-item.is-dir').filter({ hasText: new RegExp('^' + name + '$') }).first();
  const fileRow = (name) => page.locator('.tree-item:not(.is-dir)').filter({ hasText: new RegExp('^' + name + '$') }).first();
  const menuBtn = (re) => page.locator('.tree-context-menu button').filter({ hasText: re }).first();
  const expand = async (name) => { await dirRow(name).click(); await page.waitForTimeout(450); };
  const ensureExpanded = async (name) => {
    const row = dirRow(name);
    if ((await row.getAttribute('aria-expanded')) !== 'true') await expand(name);
    await page.waitForTimeout(250);
  };

  // ---- setup: isolated nested subtree (depth 4) --------------------------
  await io({ op: 'fs.delete', path: '__p2__' });
  await io({ op: 'fs.delete', path: '__p2dir__' });
  await io({ op: 'fs.mkdir', path: '__p2__' });
  await io({ op: 'fs.mkdir', path: '__p2__/a' });
  await io({ op: 'fs.mkdir', path: '__p2__/a/b' });
  await io({ op: 'fs.mkdir', path: '__p2__/a/b/c' });
  await io({ op: 'fs.write', path: '__p2__/a/b/c/deep.txt', content: 'deep' });
  await refresh();

  // ---- depth-4 expansion (no MAX_DEPTH cap) ------------------------------
  await expand('__p2__');
  await expand('a');
  await expand('b');
  await expand('c');
  check('tree: expands to depth 4', (await fileRow('deep.txt').count()) === 1);

  // ---- context menu opens on a row ---------------------------------------
  await dirRow('c').click({ button: 'right' });
  await page.waitForSelector('.tree-context-menu', { timeout: 4000 });
  check('tree: right-click opens a context menu', (await page.locator('.tree-context-menu').count()) === 1);
  const menuItems = await page.locator('.tree-context-menu button').count();
  check('tree: context menu has the full action set', menuItems >= 7, `items=${menuItems}`);

  // ---- Copy Path uses shell clipboard when WebView permission is absent ---
  await io({ op: 'clipboard.write', text: '__sentinel__' });
  await menuBtn(/^(复制路径|Copy Path)$/).click();
  await page.waitForTimeout(300);
  const copiedPath = await io({ op: 'clipboard.read' });
  check('tree: Copy Path works without navigator.clipboard', copiedPath.text === '__p2__/a/b/c', JSON.stringify(copiedPath));

  // ---- create a file inline from the menu --------------------------------
  await dirRow('c').click({ button: 'right' });
  await menuBtn(/^(新建文件|New File)$/).click();
  await page.waitForSelector('.tree-name-input', { timeout: 4000 });
  check('tree: New File shows an inline name input', (await page.locator('.tree-name-input').count()) === 1);
  await page.locator('.tree-name-input').fill('made.txt');
  await page.locator('.tree-name-input').press('Enter');
  await page.waitForTimeout(800);
  const made = await io({ op: 'fs.read', path: '__p2__/a/b/c/made.txt' });
  check('tree: inline create wrote the file', made && typeof made.content === 'string', JSON.stringify(made).slice(0, 60));

  // ---- invalid name is rejected ------------------------------------------
  await dirRow('c').click({ button: 'right' });
  await page.waitForSelector('.tree-context-menu', { timeout: 4000 });
  await menuBtn(/^(新建文件|New File)$/).click();
  await page.waitForSelector('.tree-name-input', { timeout: 4000 });
  await page.locator('.tree-name-input').fill('bad/name');
  await page.locator('.tree-name-input').press('Enter');
  await page.waitForTimeout(250);
  check('tree: invalid name keeps the input open', (await page.locator('.tree-name-input').count()) === 1);
  check('tree: invalid name shows an error', (await page.locator('.tree-name-err').count()) === 1);
  await page.locator('.tree-name-input').press('Escape');
  await page.waitForTimeout(250);
  check('tree: Escape cancels the input', (await page.locator('.tree-name-input').count()) === 0);

  // ---- rename inline from the menu ---------------------------------------
  await fileRow('made.txt').click({ button: 'right' });
  await page.waitForSelector('.tree-context-menu', { timeout: 4000 });
  await menuBtn(/^(重命名|Rename)$/).click();
  await page.waitForSelector('.tree-name-input', { timeout: 4000 });
  check('tree: Rename pre-fills the current name', (await page.locator('.tree-name-input').inputValue()) === 'made.txt');
  await page.locator('.tree-name-input').fill('renamed.txt');
  await page.locator('.tree-name-input').press('Enter');
  await page.waitForTimeout(800);
  const renamed = await io({ op: 'fs.read', path: '__p2__/a/b/c/renamed.txt' });
  const cList = await io({ op: 'fs.list', path: '__p2__/a/b/c' });
  const cNames = (cList.files ?? []).map((f) => f.name);
  check('tree: rename moved the file',
    renamed && typeof renamed.content === 'string' && cNames.includes('renamed.txt') && !cNames.includes('made.txt'),
    cNames.join(','));

  // ---- delete via menu is two-step and lands in trash --------------------
  await fileRow('renamed.txt').click({ button: 'right' });
  await page.waitForSelector('.tree-context-menu', { timeout: 4000 });
  await menuBtn(/^(删除|Delete)$/).click();
  await page.waitForTimeout(300);
  const confirm = page.locator('.tree-row').filter({ hasText: 'renamed.txt' }).locator('.tree-del.is-confirm');
  check('tree: delete asks to confirm', (await confirm.count()) === 1);
  await confirm.click();
  await page.waitForTimeout(900);
  check('tree: deleted row left the tree', (await fileRow('renamed.txt').count()) === 0);
  const trash = await io({ op: 'fs.list', path: '.pristem/trash' });
  const inTrash = (trash.files ?? []).some((f) => /-renamed\.txt$/.test(f.name));
  check('tree: delete moved the file to .pristem/trash (never unlinked)', inTrash);

  // ---- root context menu disables rename/delete --------------------------
  await page.locator('.tree-root').click({ button: 'right' });
  await page.waitForSelector('.tree-context-menu', { timeout: 4000 });
  const renameDisabled = await menuBtn(/^(重命名|Rename)$/).isDisabled();
  const deleteDisabled = await menuBtn(/^(删除|Delete)$/).isDisabled();
  check('tree: root disables rename and delete', renameDisabled && deleteDisabled);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  // ---- toolbar New Folder creates a directory inline ---------------------
  await page.locator('.filetree .icon-btn[aria-label="新建文件夹"], .filetree .icon-btn[aria-label="New Folder"]').first().click();
  await page.waitForSelector('.tree-name-input', { timeout: 4000 });
  await page.locator('.tree-name-input').fill('__p2dir__');
  await page.locator('.tree-name-input').press('Enter');
  await page.waitForTimeout(800);
  const rootList = await io({ op: 'fs.list' });
  check('tree: toolbar New Folder created a directory', (rootList.files ?? []).some((f) => f.name === '__p2dir__' && f.dir));

  // ---- keyboard navigation ------------------------------------------------
  await dirRow('__p2__').click();
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => document.activeElement?.getAttribute('data-tree-path'));
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => document.activeElement?.getAttribute('data-tree-path'));
  check('tree: ArrowDown moves focus to the next row', !!before && !!after && before !== after, `${before} -> ${after}`);
  const role = await page.evaluate(() => document.activeElement?.getAttribute('role'));
  check('tree: focused row is a treeitem', role === 'treeitem', role);

  // ---- copy / cut / paste -------------------------------------------------
  await ensureExpanded('__p2__');
  await fileRow('deep.txt').click({ button: 'right' });
  await page.waitForSelector('.tree-context-menu', { timeout: 4000 });
  await menuBtn(/^(复制|Copy)$/).click();
  await page.waitForTimeout(250);
  await dirRow('__p2dir__').click({ button: 'right' });
  await page.waitForSelector('.tree-context-menu', { timeout: 4000 });
  await menuBtn(/^(粘贴|Paste)$/).click();
  await page.waitForTimeout(900);
  const copiedList = await io({ op: 'fs.list', path: '__p2dir__' });
  const copiedNames = (copiedList.files ?? []).map((f) => f.name);
  check('tree: copy + paste duplicates into the target folder',
    copiedNames.includes('deep copy.txt'), copiedNames.join(','));

  await ensureExpanded('__p2dir__');
  await fileRow('deep copy.txt').click({ button: 'right' });
  await page.waitForSelector('.tree-context-menu', { timeout: 4000 });
  await menuBtn(/^(剪切|Cut)$/).click();
  await page.waitForTimeout(250);
  await dirRow('a').click({ button: 'right' });
  await page.waitForSelector('.tree-context-menu', { timeout: 4000 });
  await menuBtn(/^(粘贴|Paste)$/).click();
  await page.waitForTimeout(900);
  const aList = await io({ op: 'fs.list', path: '__p2__/a' });
  const dirList = await io({ op: 'fs.list', path: '__p2dir__' });
  check('tree: cut + paste moves the file (source gone)',
    (aList.files ?? []).some((f) => f.name === 'deep copy.txt') &&
    !(dirList.files ?? []).some((f) => f.name === 'deep copy.txt'),
    `target=${(aList.files ?? []).map((f) => f.name).join(',')} source=${(dirList.files ?? []).map((f) => f.name).join(',')}`);

  // ---- drag-and-drop move -------------------------------------------------
  await fileRow('deep copy.txt').dragTo(dirRow('b'), { targetPosition: { x: 12, y: 12 } });
  await page.waitForTimeout(1000);
  const bList = await io({ op: 'fs.list', path: '__p2__/a/b' });
  const aAfter = await io({ op: 'fs.list', path: '__p2__/a' });
  check('tree: drag-and-drop moves a file into a folder',
    (bList.files ?? []).some((f) => f.name === 'deep copy.txt') &&
    !(aAfter.files ?? []).some((f) => f.name === 'deep copy.txt'));

  // ---- external writes reach the tree through the watcher ----------------
  nodeFs.writeFileSync('D:/projects/pristem/__p2__/external.txt', 'external');
  await page.waitForTimeout(2800);
  check('tree: an external write appears without a manual refresh',
    (await fileRow('external.txt').count()) === 1);

  // ---- no runtime errors --------------------------------------------------
  check('explorer: no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  // ---- cleanup (move probes to trash) ------------------------------------
  await io({ op: 'fs.delete', path: '__p2__' });
  await io({ op: 'fs.delete', path: '__p2dir__' });

  const failed = rows.filter((r) => !r.ok).length;
  console.log(`\n${rows.length - failed}/${rows.length} explorer checks passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})();