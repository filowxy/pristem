﻿/* Effect-layer self-check: proves the Figma-derived effect set is live.
   Read-only against a serving instance. Run: node _effects-selfcheck.cjs */
const { chromium } = require('playwright-core');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = process.env.PR_URL || 'http://127.0.0.1:8787/';
const OUT = 'D:/projects/pristem/pristem-desktop/.screenshots';
fs.mkdirSync(OUT, { recursive: true });

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

  const openMenu = async () => {
    if ((await page.locator('.mode-menu').count()) === 0) {
      await page.locator('.title-mode').click();
      await page.waitForSelector('.mode-menu', { timeout: 5000 });
    }
  };
  const enterMode = async (name) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await openMenu();
      const retry = page.locator('.mode-menu-error .primary-btn');
      if (await retry.count()) await retry.first().click();
      await page.locator('.mode-menu button')
        .filter({ has: page.locator('.menu-name', { hasText: new RegExp('^' + name + '$') }) })
        .first().click();
      const ok = await page.waitForFunction(
        (m) => document.querySelector('.app-shell')?.className.includes('mode-' + m),
        name.toLowerCase(), { timeout: 5000 }).then(() => true).catch(() => false);
      if (ok) { await page.waitForTimeout(700); return; }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
    const diag = await page.evaluate(() => ({
      cls: document.querySelector('.app-shell')?.className,
      menu: !!document.querySelector('.mode-menu'),
      disabled: [...document.querySelectorAll('.mode-menu button')].map((b) => b.getAttribute('aria-disabled')),
      hint: document.querySelector('.status-hint')?.textContent ?? '',
      err: (document.querySelector('.mode-menu-error')?.textContent ?? '').slice(0, 80),
    }));
    throw new Error(`mode ${name} unreachable: ${JSON.stringify(diag)}`);
  };

  // 1 · glass floats: translucent fill + backdrop blur
  await openMenu();
  const menu = await page.evaluate(() => {
    const el = document.querySelector('.mode-menu');
    if (!el) return null;
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, blur: s.backdropFilter || s.webkitBackdropFilter, sheen: s.backgroundImage };
  });
  check('glass: mode menu has backdrop blur', !!menu && /blur\(/.test(menu.blur), menu && menu.blur);
  check('glass: mode menu fill is translucent',
    !!menu && !/^rgb\(/.test(menu.bg), menu && menu.bg);
  check('glass: mode menu keeps the top sheen', !!menu && /linear-gradient/.test(menu.sheen));
  await page.locator('.mode-menu').screenshot({ path: `${OUT}/22-effect-glass-menu.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  // 2 · progressive edge fade on the transcript
  const mask = await page.evaluate(() => {
    const el = document.querySelector('.transcript');
    if (!el) return null;
    const s = getComputedStyle(el);
    return s.maskImage || s.webkitMaskImage;
  });
  check('fade: transcript has a top mask', !!mask && /linear-gradient/.test(mask), mask);

  // 2a · semantic icon set is wired to real verbs
  const treeFolder = await page.evaluate(() => {
    const el = document.querySelector('.tree-item .si-folder');
    return el ? { flap: !!el.querySelector('.si-folder-flap'), body: !!el.querySelector('.si-folder-body') } : null;
  });
  check('icon: file-tree folder uses the semantic set', !!treeFolder && treeFolder.flap && treeFolder.body,
    JSON.stringify(treeFolder));
  const launchRow = page.locator('.tree-item.is-dir').filter({ hasText: /^launch$/ }).first();
  if (await launchRow.count()) {
    await launchRow.click();
    await page.waitForTimeout(650);
  }
  check('tree: a folder expands to its children',
    (await page.locator('.tree-row').filter({ hasText: 'install-shortcuts.ps1' }).count()) === 1);
  const desktopRow = page.locator('.tree-item.is-dir').filter({ hasText: /^pristem-desktop$/ }).first();
  if (await desktopRow.count()) {
    await desktopRow.click();
    await page.waitForTimeout(600);
  }
  // Scope to the nested folder: the workspace also has a root .screenshots.
  const shotsRow = page.locator('.tree-children .tree-item.is-dir').filter({ hasText: /^\.screenshots$/ }).first();
  if (await shotsRow.count()) {
    await shotsRow.click();
    await page.waitForTimeout(700);
  }
  check('tree: hidden folders list and expand',
    (await page.locator('.tree-row').filter({ hasText: '01-coding.png' }).count()) === 1);
  await page.locator('.filetree').screenshot({ path: `${OUT}/27-effect-tree.png` });
  const folderRow = page.locator('.tree-item').filter({ has: page.locator('.si-folder') }).first();
  const fr = await folderRow.boundingBox();
  if (fr) await page.mouse.move(fr.x + fr.width * 0.5, fr.y + fr.height * 0.5);
  await page.waitForTimeout(200);
  const flapT = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.tree-item .si-folder .si-folder-flap')).transform);
  check('icon: folder flap opens on row hover', flapT !== 'none', flapT);
  await page.mouse.move(640, 420);
  await page.locator('.search-capsule input').fill('x');
  check('icon: search clear is the backspace',
    (await page.locator('.search-clear .si-backspace').count()) === 1);
  const clearBox = await page.locator('.search-clear').boundingBox();
  if (clearBox) await page.mouse.move(clearBox.x + clearBox.width / 2, clearBox.y + clearBox.height / 2);
  await page.waitForTimeout(200);
  const backT = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.search-clear .si-back-body')).transform);
  check('icon: backspace retracts on hover', backT !== 'none', backT);
  await page.locator('.search-clear').click();
  await page.keyboard.press('Control+Shift+P');
  await page.waitForSelector('.palette-head .si-command', { timeout: 4000 });
  const cmdAnim = await page.evaluate(() => {
    const el = document.querySelector('.palette-head .si-command-loop');
    return el ? getComputedStyle(el).animationName : null;
  });
  check('icon: command loop traces on open', cmdAnim === 'si-draw', cmdAnim);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 2a1 · new bash is a real, isolated terminal stream
  const addBash = page.locator('.term-tab-add');
  if (await addBash.count()) {
    const before = await page.locator('.term-tab').count();
    await addBash.click();
    await page.waitForTimeout(1400);
    check('terminal: + creates a new tab',
      (await page.locator('.term-tab').count()) === before + 1);
    const activeHost = page.locator('.term-host:visible').first();
    await activeHost.click();
    await page.keyboard.type('echo instance-two-xyz');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1600);
    const secondText = await activeHost.innerText();
    check('terminal: the new instance runs its command',
      secondText.includes('instance-two-xyz'), secondText.slice(-120));
    await page.locator('.term-tab').first().click();
    await page.waitForTimeout(350);
    const firstText = await page.locator('.term-host:visible').first().innerText();
    check('terminal: instances do not share output',
      !firstText.includes('instance-two-xyz'), firstText.slice(-120));
    await page.locator('.term-tab').last().click();
    await page.waitForTimeout(250);
  } else {
    check('terminal: + creates a new tab', false, 'no add-terminal button');
  }

  // 2a2 · test entry + trash flow (real IO, deletion goes to .pristem/trash)
  const testEntry = await page.evaluate(() => {
    const btn = document.querySelector('.filetree .icon-btn:has(.si-flask)');
    const flask = document.querySelector('.filetree .si-flask');
    return { btn: !!btn, bubbles: flask ? flask.querySelectorAll('.si-flask-bubble').length : 0 };
  });
  check('test: flask entry is wired', testEntry.btn && testEntry.bubbles === 3, JSON.stringify(testEntry));

  await page.evaluate(async () => {
    await fetch('/api/io', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'fs.write', path: 'artifacts/delete-probe.txt', content: 'probe' }),
    });
  });
  await page.locator('.filetree .icon-btn:has(.si-refresh)').click();
  await page.waitForTimeout(700);
  const artifactsRow = page.locator('.tree-item.is-dir').filter({ hasText: /^artifacts$/ }).first();
  if (await artifactsRow.count()) {
    await artifactsRow.click();
    await page.waitForTimeout(650);
  }
  const probeRow = page.locator('.tree-row').filter({ hasText: 'delete-probe.txt' }).first();
  check('delete: probe appears in the tree', (await probeRow.count()) === 1);
  await probeRow.hover();
  await probeRow.locator('.tree-del').click();
  await page.waitForTimeout(180);
  const confirmBtn = probeRow.locator('.tree-del.is-confirm');
  check('delete: first click asks to confirm', (await confirmBtn.count()) === 1);
  await confirmBtn.click();
  await page.waitForTimeout(900);
  check('delete: probe left the tree',
    (await page.locator('.tree-row').filter({ hasText: 'delete-probe.txt' }).count()) === 0);

  // 2b · Figma icon tile: badge geometry, self-draw, hover tilt
  const searchTab = page.locator('.view-seg-item').nth(1);
  if (await searchTab.count()) {
    await searchTab.click();
    // Recursive search scans the whole workspace (incl. these scripts), so the
    // no-match token is built at runtime — its full form exists in no file.
    const noMatch = 'zznomatch-' + Date.now();
    await page.locator('.side-search input').fill(noMatch);
    await page.waitForSelector('.side-panel .empty-icon', { timeout: 8000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/26-effect-empty-icon-full.png` });
    const badge = await page.evaluate(() => {
      const el = document.querySelector('.side-panel .empty-icon');
      const s = getComputedStyle(el);
      return { w: s.width, r: s.borderRadius, bg: s.backgroundColor, anim: s.animationName };
    });
    check('icon: empty-state badge is a tile',
      badge.w === '26px' && parseFloat(badge.r) > 0, JSON.stringify(badge));
    check('icon: badge springs in on mount', /icon-pop/.test(badge.anim), badge.anim);
    const emptyIcon = page.locator('.side-panel .empty-icon');
    const b = await emptyIcon.boundingBox();
    // Use Playwright's visibility-aware hover; raw headless mouse moves can miss CSS :hover.
    let tilt;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (b) await emptyIcon.hover({ position: { x: b.width * 0.82 - attempt, y: b.height * 0.18 + attempt } });
      await page.waitForTimeout(400);
      tilt = await page.evaluate(() => {
        const el = document.querySelector('.side-panel .empty-icon');
        if (!el) return { px: null, t: 'missing', text: (document.querySelector('.side-panel')?.textContent || '').slice(0, 60) };
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width * 0.82, r.top + r.height * 0.18);
        return {
          px: el.style.getPropertyValue('--px'),
          t: getComputedStyle(el).transform,
          hover: el.matches(':hover'),
          pointer: document.documentElement.dataset.pointer,
          top: top ? (typeof top.className === 'string' ? top.className : top.tagName) : null,
        };
      });
      if (tilt.t !== 'none') break;
    }
    check('icon: badge tilts under the cursor',
      tilt.px !== null && tilt.t !== 'none' && tilt.px !== '', JSON.stringify(tilt));
    await page.locator('.side-panel .empty-state').screenshot({ path: `${OUT}/26-effect-empty-icon.png` });
    await page.locator('.side-search input').fill('');
    await page.locator('.view-seg-item').nth(0).click();
    await page.waitForTimeout(250);
  } else {
    check('icon: empty-state badge is a tile', false, 'no search view segment');
  }

  // 3 · goal atmosphere: grain + pointer-parallax light
  await enterMode('goal');
  const goal = await page.evaluate(() => {
    const el = document.querySelector('.goal');
    if (!el) return null;
    return {
      grain: getComputedStyle(el, '::before').backgroundImage,
      light: getComputedStyle(el, '::after').backgroundImage,
      transform: getComputedStyle(el, '::after').transform,
    };
  });
  check('noise: goal carries the grain texture', !!goal && /data:image\/svg/.test(goal.grain));
  check('light: goal has the ambient light pool', !!goal && /radial-gradient/.test(goal.light));
  const goalScene = await page.evaluate(() => {
    const a = document.querySelector('.goal .ambient');
    const f = document.querySelector('.goal .view-frame');
    return {
      anim: a ? getComputedStyle(a).animationName : null,
      frame: f ? getComputedStyle(f).borderTopWidth : null,
    };
  });
  check('ambient: goal has the drifting light field', goalScene.anim === 'ambient-drift', JSON.stringify(goalScene));
  check('frame: goal has the cinematic inset frame', goalScene.frame === '1px', goalScene.frame);
  await page.mouse.move(300, 300);
  await page.waitForTimeout(450);
  const moved = await page.evaluate(() => getComputedStyle(document.querySelector('.goal'), '::after').transform);
  check('light: the goal pool tracks the pointer', !!goal && moved !== goal.transform, `${goal && goal.transform} -> ${moved}`);
  const chipBox = await page.locator('.goal-template').first().boundingBox();
  if (chipBox) {
    await page.mouse.move(chipBox.x + chipBox.width * 0.82, chipBox.y + chipBox.height * 0.2);
    await page.waitForTimeout(160);
  }
  const pointer = await page.evaluate(() => {
    const el = document.querySelector('.goal-template');
    if (!el) return null;
    return {
      px: el.style.getPropertyValue('--px'),
      py: el.style.getPropertyValue('--py'),
      transform: getComputedStyle(el).transform,
    };
  });
  check('pointer: chip reports local cursor coords', !!pointer && pointer.px !== '' && pointer.py !== '', JSON.stringify(pointer));
  check('pointer: chip tilts under the cursor', !!pointer && pointer.transform !== 'none', pointer && pointer.transform);
  await page.locator('.goal').screenshot({ path: `${OUT}/23-effect-goal.png` });

  // 4 · deepsleep atmosphere + glass wake card
  await enterMode('deepsleep');
  const sleep = await page.evaluate(() => {
    const el = document.querySelector('.deepsleep-layer');
    if (!el) return null;
    return {
      vignette: getComputedStyle(el, '::before').backgroundImage,
      grain: getComputedStyle(el.querySelector('.night-grain')).backgroundImage,
    };
  });
  check('noise: deepsleep carries film grain', !!sleep && /data:image\/svg/.test(sleep.grain));
  check('light: deepsleep has a vignette', !!sleep && /radial-gradient/.test(sleep.vignette));
  const sleepScene = await page.evaluate(() => {
    const a = document.querySelector('.deepsleep-layer .ambient');
    const f = document.querySelector('.deepsleep-layer .view-frame');
    return {
      anim: a ? getComputedStyle(a).animationName : null,
      dur: a ? getComputedStyle(a).animationDuration : null,
      frame: f ? getComputedStyle(f).borderTopWidth : null,
    };
  });
  // DESIGN §5: the 12s halo is the only looping animation in deepsleep.
  check('ambient: deepsleep leaves motion to the 12s halo', sleepScene.anim === 'none' && sleepScene.dur === '0s',
    JSON.stringify(sleepScene));
  check('frame: deepsleep has the cinematic inset frame', sleepScene.frame === '1px', sleepScene.frame);
  await page.locator('.deepsleep-layer').screenshot({ path: `${OUT}/24-effect-deepsleep.png` });

  const wake = page.locator('.deepsleep-actions .secondary-btn');
  if (await wake.count()) {
    await wake.click();
    await page.waitForSelector('.wake-card', { timeout: 8000 });
    const card = await page.evaluate(() => {
      const el = document.querySelector('.wake-card');
      const s = getComputedStyle(el);
      return { blur: s.backdropFilter || s.webkitBackdropFilter, bg: s.backgroundColor };
    });
    check('glass: wake card has backdrop blur', /blur\(/.test(card.blur), card.blur);
    check('glass: wake card fill is translucent', !/^rgb\(/.test(card.bg), card.bg);
    await page.locator('.wake-card').screenshot({ path: `${OUT}/25-effect-wake-card.png` });
  } else {
    check('glass: wake card has backdrop blur', false, 'no wake button');
  }

  // 5 · no runtime errors while the effect layer is live
  check('effects: no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  const failed = rows.filter((r) => !r.ok).length;
  console.log(`\n${rows.length - failed}/${rows.length} effect checks passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
