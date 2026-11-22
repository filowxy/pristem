/* Git self-check: staging, unstaging, staged-only commit, diff colouring and
   discard through the real UI. The repositories in this checkout have no .git,
   so the suite creates one in the temp directory and opens it through the
   visible "open folder" control (headless has no native picker, so the paste
   dialog is the real path). `git` itself is only used for setup and assertions.
   Run against a fresh serving instance: node _git-selfcheck.cjs */
const { chromium } = require('playwright-core');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = process.env.PR_URL || 'http://127.0.0.1:8787/';
const MSG = 'fix: keep "quotes" and $HOME';

const rows = [];
const check = (name, ok, detail = '') => {
  rows.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pristem-git-'));
const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

try {
  git(['init', '-q']);
  git(['config', 'user.email', 'suite@example.com']);
  git(['config', 'user.name', 'Suite']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git(['add', 'a.txt']);
  git(['commit', '-q', '-m', 'init']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'untracked\n');

  let launched = null;
  (async () => {
    const browser = await chromium.launch({
      executablePath: EDGE, headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
    launched = browser;
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.app-shell', { timeout: 20000 });
    await page.waitForTimeout(2200);
    if (await page.locator('.guide-overlay').count()) {
      await page.locator('.guide-skip').click();
      await page.waitForSelector('.guide-overlay', { state: 'detached' });
    }
    const wait = (ms) => page.waitForTimeout(ms);
    const row = (side, p) => page.locator(`[data-git-side="${side}"][data-git-row="${p}"]`);

    // ---- open the temp repository through the visible control --------------
    // Headless shells report pickFolder: false, so this opens the paste dialog.
    await page.locator('.filetree .pane-head .icon-btn').nth(2).click();
    await page.waitForSelector('.path-dialog-input', { timeout: 10000 });
    await page.locator('.path-dialog-input').fill(repo);
    await page.locator('.path-dialog-actions .primary-btn').click();
    await page.waitForSelector('.path-dialog', { state: 'detached', timeout: 15000 });
    await wait(1200);

    await page.keyboard.press('Control+Shift+G');
    await page.waitForSelector('.git-panel', { timeout: 15000 });
    await page.waitForSelector('[data-git-row="a.txt"]', { timeout: 15000 });
    check('the panel lists a modified file in Changes', await row('changes', 'a.txt').count() === 1);
    check('an untracked file is listed too', await row('changes', 'b.txt').count() === 1);
    check('Staged starts empty', await page.locator('[data-git-side="staged"]').count() === 0);

    // ---- per-file stage / unstage -----------------------------------------
    await row('changes', 'a.txt').locator('[data-git-action="stage"]').click();
    await page.waitForSelector('[data-git-side="staged"][data-git-row="a.txt"]', { timeout: 10000 });
    check('staging moves the row to Staged', true);
    await row('staged', 'a.txt').locator('[data-git-action="unstage"]').click();
    await page.waitForSelector('[data-git-side="changes"][data-git-row="a.txt"]', { timeout: 10000 });
    check('unstaging returns it to Changes', await row('staged', 'a.txt').count() === 0);

    // ---- stage all, then commit only staged content ------------------------
    await page.locator('[data-git-section-action="stage-all"]').click();
    await page.waitForSelector('[data-git-side="staged"]', { timeout: 10000 });
    await wait(400);
    const stagedCount = await page.locator('[data-git-side="staged"]').count();
    check('stage all stages both files', stagedCount === 2, `${stagedCount} staged`);

    await page.locator('.git-commit textarea').fill(MSG);
    await page.locator('.git-commit .primary-btn').click();
    await wait(1600);
    const subject = git(['log', '-1', '--format=%s']).trim();
    check('the commit message is stored verbatim (no shell or sanitizer edits)', subject === MSG, subject);
    check('the working tree is clean after committing', git(['status', '--porcelain']).trim() === '');

    // ---- diff colouring ----------------------------------------------------
    // Change a committed line and add another, so the diff has both sides.
    fs.writeFileSync(path.join(repo, 'a.txt'), 'ONE\ntwo\nthree\n');
    await page.locator('.git-panel .pane-head .icon-btn').click();
    await page.waitForSelector('[data-git-side="changes"][data-git-row="a.txt"]', { timeout: 10000 });
    await row('changes', 'a.txt').locator('.git-change-main').click();
    await page.waitForSelector('[data-git-diff]', { timeout: 10000 });
    await wait(300);
    check('diff shows added lines', await page.locator('.git-diff-line.is-add').count() > 0);
    check('diff shows removed lines', await page.locator('.git-diff-line.is-del').count() > 0);

    // ---- discard is two-step and restores the file -------------------------
    await row('changes', 'a.txt').locator('[data-git-action="discard"]').click();
    await wait(250);
    await row('changes', 'a.txt').locator('[data-git-action="discard"]').click();
    await page.waitForSelector('[data-git-side="changes"][data-git-row="a.txt"]', { state: 'detached', timeout: 10000 });
    const restored = fs.readFileSync(path.join(repo, 'a.txt'), 'utf8').replace(/\r\n/g, '\n');
    check('discard restores the committed content', restored === 'one\ntwo\n', JSON.stringify(restored));

    check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

    await browser.close();
    const failed = rows.filter((r) => !r.ok).length;
    console.log(`\n${rows.length - failed}/${rows.length} passed`);
    process.exitCode = failed ? 1 : 0;
  })().catch(async (e) => {
    console.error('SUITE ERROR', e);
    process.exitCode = 1;
    try { await launched?.close(); } catch { /* ignore */ }
  });
} finally {
  // The suite owns this directory; leave nothing behind.
  process.on('exit', () => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ } });
}
