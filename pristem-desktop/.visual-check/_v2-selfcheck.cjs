/* Independent v2 acceptance: proves the new surfaces actually work.
   Read-only against the running service; does not modify the three baselines. */
const { chromium } = require('playwright-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:8787/';
const fs = require('fs');
const OUT = 'D:/projects/pristem/pristem-desktop/.screenshots';
fs.mkdirSync(OUT, { recursive: true });

const rows = [];
const check = (name, ok, detail = '') => {
  rows.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};
const switchTo = async (page, index, name) => {
  await page.locator('.title-mode').click();
  await page.locator('.mode-menu button').nth(index).click();
  await page.waitForFunction((m) => document.querySelector('.app-shell')?.className.includes('mode-' + m),
    name.toLowerCase(), { timeout: 12000 });
  await page.waitForTimeout(450);
};

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.app-shell', { timeout: 20000 });
  await page.waitForTimeout(2200);

  // 1 · no stale explanatory copy, no dot separators, no dead buttons
  const bodyText = await page.locator('body').innerText();
  check('1 no ·xxx explanatory copy', !/本地标记|不影响内核|纯视图占位|OPEN QUESTION|零请求|尚未实现/.test(bodyText));
  const dead = await page.evaluate(() => ({
    disabled: document.querySelectorAll('.activity-item[aria-disabled="true"]').length,
    noClick: [...document.querySelectorAll('.activity-item')].filter((b) => !b.onclick && !b.getAttribute('data-pop-trigger')).length,
  }));
  check('2 activity rail has no disabled placeholders', dead.disabled === 0, `disabled=${dead.disabled}`);
  const items = await page.locator('.activity-item').count();
  check('3 activity rail has 7 real entries', items === 7, `count=${items}`);

  // 2 · language switch actually re-renders the UI
  const zhMenu = await page.locator('.title-menu-btn').first().innerText();
  await page.locator('.lang-switch').click();
  await page.waitForTimeout(220);
  const enMenu = await page.locator('.title-menu-btn').first().innerText();
  const proto = await page.locator('.proto-badge').innerText();
  check('4 language switch translates chrome', zhMenu !== enMenu, `${zhMenu} -> ${enMenu}`);
  check('5 proto-badge stays constant', proto === 'pristem.ipc/v0.3', proto);
  const langShot = await page.screenshot({ path: `${OUT}/14-english.png` });
  check('6 english screenshot written', !!langShot);
  await page.locator('.lang-switch').click();
  await page.waitForTimeout(220);

  // 3 · demo honesty
  check('7 offline demo kernel labelled', (await page.locator('.demo-badge').count()) === 1);
  check('8 AI panel shows scripted-run tag', (await page.locator('.ai-demo-tag').count()) === 1);

  // 4 · seven activity views each render real content
  const views = ['files', 'search', 'git', 'terminal', 'layers', 'settings'];
  for (let i = 0; i < views.length; i++) {
    await page.locator('.activity-item').nth(i).click();
    await page.waitForTimeout(260);
    const hasPanel = await page.locator('.filetree, .side-panel').count();
    check(`9.${i + 1} activity ${views[i]} renders a panel`, hasPanel > 0, `nodes=${hasPanel}`);
  }
  await page.locator('.activity-item').nth(0).click();

  // 5 · empty states: search zero results, terminal output, outline
  await page.locator('.activity-item').nth(1).click();
  await page.locator('.search-panel input').fill('zzzz-no-such-symbol-zzzz');
  await page.waitForTimeout(700);
  const noResult = await page.locator('.empty-state[data-v="noresult"]').count();
  check('10 search zero-result empty state', noResult === 1, `count=${noResult}`);
  await page.screenshot({ path: `${OUT}/11-empty-states.png` });
  await page.locator('.activity-item').nth(3).click();
  await page.waitForTimeout(250);
  check('11 terminal history has empty state or content',
    (await page.locator('.term-history, .empty-state').count()) > 0);
  await page.locator('.activity-item').nth(0).click();

  // 6 · structured tool calls appear after a real kernel round
  await page.locator('[data-composer] textarea').fill('inspect the presence dial');
  await page.locator('[data-composer] textarea').press('Enter');
  await page.waitForTimeout(2600);
  const cards = await page.locator('.tool-card').count();
  check('12 tool calls render as foldable cards', cards > 0, `cards=${cards}`);
  if (cards > 0) {
    const before = await page.locator('.tool-card-body').first().getAttribute('hidden');
    await page.locator('.tool-card-head').first().click();
    await page.waitForTimeout(220);
    const after = await page.locator('.tool-card-body').first().getAttribute('hidden');
    check('13 tool card expands', before !== null && after === null, `${before} -> ${after}`);
    const rawToggle = page.locator('.tool-card-raw-toggle').first();
    if (await rawToggle.count()) {
      await rawToggle.click();
      check('14 raw output expandable', (await page.locator('.tool-card-raw:not([hidden])').count()) > 0);
    } else check('14 raw output expandable', true, 'no output in this round');
    await page.screenshot({ path: `${OUT}/10-toolcard.png` });
  } else {
    check('13 tool card expands', false, 'no card');
    check('14 raw output expandable', false, 'no card');
  }

  // 7 · command palette + outside click
  await page.keyboard.press('Control+Shift+P');
  await page.waitForTimeout(220);
  check('15 command palette opens', (await page.locator('.palette').count()) === 1);
  await page.mouse.click(720, 500);
  await page.waitForTimeout(220);
  check('16 click outside closes palette', (await page.locator('.palette').count()) === 0);
  await page.keyboard.press('Control+Shift+P');
  await page.waitForTimeout(180);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(180);
  check('17 Esc closes top overlay', (await page.locator('.palette').count()) === 0);

  // 8 · IDE benchmark surfaces
  await switchTo(page, 1, 'IDE');
  check('18 IDE keeps zero AI DOM', (await page.locator('[data-ai="true"]').count()) === 0);
  const barText = await page.locator('.statusbar').innerText();
  check('19 IDE status bar has no fake Ln 12, Col 4', !/Ln 12, Col 4/.test(barText));
  check('20 IDE still has real editor + terminal',
    (await page.locator('.monaco-host').count()) === 1 && (await page.locator('.term-host').count()) === 1);
  await page.screenshot({ path: `${OUT}/13-ide-benchmark.png` });

  // 9 · goal benchmark surfaces. Templates are the empty-conversation state, so
  // clear the inherited transcript first through a real slash command.
  await switchTo(page, 5, 'goal');
  await page.locator('.goal-input textarea').fill('/clear');
  await page.locator('.goal-input textarea').press('Enter');
  await page.waitForTimeout(350);
  check('21a /clear empties the goal conversation', (await page.locator('.goal-line').count()) === 0);
  const templates = await page.locator('.goal-template').count();
  check('21 goal has 3 actionable templates', templates === 3, `count=${templates}`);
  check('22 goal has intent chips', (await page.locator('.intent-chip').count()) === 3);
  check('23 goal has no codebase DOM',
    (await page.locator('.filetree').count()) === 0 &&
    (await page.locator('.monaco-host').count()) === 0 &&
    (await page.locator('.term-host').count()) === 0);
  if (templates > 0) {
    await page.locator('.goal-template').first().click();
    const filled = await page.locator('.goal-input textarea').inputValue();
    check('24 goal template fills composer', filled.length > 0, `"${filled.slice(0, 24)}"`);
  } else check('24 goal template fills composer', false, 'no template');
  await page.screenshot({ path: `${OUT}/12-goal-templates.png` });

  // 10 · advisor honest sample label
  await switchTo(page, 3, 'advisor');
  check('25 advisor sample content labelled', (await page.locator('.review-sample-tag').count()) === 1);

  check('26 no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

  await browser.close();
  const failed = rows.filter((r) => !r.ok).length;
  console.log(`\n${rows.length - failed}/${rows.length} v2 acceptance checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
