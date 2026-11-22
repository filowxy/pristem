const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'D:/projects/pristem/pristem-desktop/.screenshots';
const URL = process.env.PR_URL || 'http://127.0.0.1:8787/';
const UI_SRC = path.resolve(__dirname, '..', 'ui', 'src');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};
const skip = (name, why) => console.log(`SKIP  ${name} — ${why}`);

/** Read every source file of the UI for the L2 static layer. */
function readUiSources() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|css)$/.test(e.name)) out.push([p, fs.readFileSync(p, 'utf8')]);
    }
  };
  if (fs.existsSync(UI_SRC)) walk(UI_SRC);
  return out;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.app-shell', { timeout: 20000 });
  await page.waitForTimeout(2200); // SSE open + kernel session_opened

  // ---- first-run guide (fresh browser profile has no completion flag) -----
  check('guide: first run shows the setup guide', (await page.locator('.guide-overlay').count()) === 1);
  check('guide: offers a workspace step and a model step',
    (await page.locator('.guide-steps li').count()) === 2 &&
    (await page.locator('.guide-provider').count()) === 0);
  await page.locator('.guide-skip').click();
  await page.waitForTimeout(250);
  check('guide: skipping records completion and reveals the app',
    (await page.locator('.guide-overlay').count()) === 0 &&
    (await page.evaluate(() => localStorage.getItem('pristem.guide.done'))) === '1');

  // browser.newPage() creates a fresh context, so each helper page needs its own skip.
  const dismissGuide = async (target) => {
    if (await target.locator('.guide-overlay').count()) {
      await target.locator('.guide-skip').click();
      await target.waitForSelector('.guide-overlay', { state: 'detached' });
    }
  };

  const originalSessionLabel = await page.locator('.status-session').innerText();

  // ---- capability degradation: pty:false → notice, no crash ---------------
  // A separate page so the main run keeps its real shell.
  {
    const degrade = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const degradeErrors = [];
    degrade.on('pageerror', (e) => degradeErrors.push(String(e)));
    await degrade.route('**/api/io', async (route) => {
      if (!route.request().postData()?.includes('shell.capabilities')) return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      body.capabilities = { ...body.capabilities, pty: false };
      await route.fulfill({ response, json: body });
    });
    await degrade.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await degrade.waitForSelector('.app-shell', { timeout: 20000 }).catch(() => {});
    await dismissGuide(degrade);
    await degrade.waitForSelector('.xterm-rows', { timeout: 15000 }).catch(() => {});
    await degrade.waitForTimeout(1500);
    const termUnavailable = (await degrade.locator('.xterm-rows').count())
      ? await degrade.locator('.xterm-rows').innerText() : '';
    check('capabilities: pty:false degrades to a notice, no crash',
      /PTY/.test(termUnavailable) && degradeErrors.length === 0,
      `errors=${degradeErrors.length}`);
    await degrade.close();
  }

  // ---- disconnected retry: a real retry must reconstruct the service ------
  {
    const recovery = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await recovery.route('**/api/ping', (route) => route.abort());
    await recovery.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await recovery.waitForSelector('.app-shell', { timeout: 20000 }).catch(() => {});
    await dismissGuide(recovery);
    await recovery.waitForSelector('.conn-state.is-off', { timeout: 10000 });
    check('connection: only the disconnected badge offers retry',
      (await recovery.locator('.conn-retry').count()) === 1 &&
      (await page.locator('.conn-retry').count()) === 0);
    check('connection: offline state has no duplicate toast or raw i18n key',
      (await recovery.locator('.toast-stack').count()) === 0 &&
      !(await recovery.locator('body').innerText()).includes('common.contentUnavailable'));
    await recovery.unroute('**/api/ping');
    await recovery.locator('.conn-state.is-off').click();
    await recovery.locator('.conn-retry-menu [role="menuitem"]').click();
    const reconnected = await recovery.waitForSelector('.conn-state.is-off', { state: 'detached', timeout: 15000 })
      .then(() => true).catch(() => false);
    check('connection: retry reconnects the real kernel service', reconnected);
    if (reconnected) {
      let dropHelping = true;
      await recovery.route('**/api/request', async (route) => {
        const request = route.request().postDataJSON();
        if (dropHelping && request.type === 'switch_mode' && request.mode === 'helping') {
          dropHelping = false;
          return route.abort();
        }
        return route.continue();
      });
      await recovery.locator('.title-mode').click();
      await recovery.locator('.mode-menu button')
        .filter({ has: recovery.locator('.menu-name', { hasText: /^helping$/ }) }).click();
      await recovery.waitForSelector('.menu-pending', { timeout: 2000 });
      check('mode: only the target row shows a pending indicator',
        (await recovery.locator('.menu-pending').count()) === 1 &&
        (await recovery.locator('.mode-menu button.is-pending .menu-name').innerText()) === 'helping');
      await recovery.waitForSelector('.mode-menu-error', { timeout: 6000 });
      await recovery.unroute('**/api/request');
      await recovery.locator('.mode-menu-error .primary-btn').click();
      const retried = await recovery.waitForFunction(
        () => document.querySelector('.app-shell')?.className.includes('mode-helping'),
        null, { timeout: 8000 }).then(() => true).catch(() => false);
      check('mode: a failed switch can be retried without reload', retried);

      await recovery.locator('.title-mode').click();
      await recovery.locator('.mode-menu button')
        .filter({ has: recovery.locator('.menu-name', { hasText: /^deepsleep$/ }) }).click();
      await recovery.waitForSelector('.mode-menu-error', { timeout: 6000 });
      const codingRequest = recovery.waitForRequest((r) => {
        const body = r.postDataJSON();
        return body?.type === 'switch_mode' && body.mode === 'coding';
      });
      const sleepRequest = recovery.waitForRequest((r) => {
        const body = r.postDataJSON();
        return body?.type === 'switch_mode' && body.mode === 'deepsleep';
      });
      await recovery.locator('.mode-menu-error .primary-btn').click();
      await codingRequest;
      await sleepRequest;
      const recovered = await recovery.waitForFunction(
        () => document.querySelector('.app-shell')?.className.includes('mode-deepsleep'),
        null, { timeout: 10000 }).then(() => true).catch(() => false);
      check('mode: forbidden deepsleep entry recovers through coding', recovered);
      check('deepsleep: null briefing shows the request hint without a card',
        (await recovery.locator('.sleep-briefing-hint').count()) === 1 &&
        (await recovery.locator('.wake-card').count()) === 0);

      // The session panel lives beside the conversation, so list the ids from
      // coding mode (the client is still asleep after the recovery check).
      if (!(await recovery.evaluate(() => document.querySelector('.app-shell')?.className.includes('mode-coding')))) {
        await recovery.locator('.title-mode').click();
        await recovery.locator('.mode-menu button')
          .filter({ has: recovery.locator('.menu-name', { hasText: /^coding$/ }) }).click();
        await recovery.waitForFunction(
          () => document.querySelector('.app-shell')?.className.includes('mode-coding'),
          null, { timeout: 12000 }).catch(() => {});
      }
      await recovery.locator('.session-switcher-btn').click();
      await recovery.waitForTimeout(250);
      // Close through the panel's own buttons — a kernel close_session is not a
      // user path. Keep one session: closing the last one opens a replacement.
      for (let guard = 0; guard < 6; guard += 1) {
        if ((await recovery.locator('.session-card').count()) <= 1) break;
        await recovery.locator('.session-card .session-card-close').first().click();
        await recovery.waitForTimeout(300);
      }
    }
    await recovery.close();
  }
  check('connection: another client cannot replace the main session',
    (await page.locator('.status-session').innerText()) === originalSessionLabel,
    `before=${originalSessionLabel} after=${await page.locator('.status-session').innerText()}`);

  const modeClass = () => page.locator('.app-shell').getAttribute('class');
  const pickMode = async (name) => {
    if ((await page.locator('.mode-menu').count()) === 0) {
      await page.locator('.title-mode').click();
      await page.waitForSelector('.mode-menu', { timeout: 5000 });
    }
    await page.locator('.mode-menu button')
      .filter({ has: page.locator('.menu-name', { hasText: new RegExp('^' + name + '$') }) })
      .first()
      .click();
    await page.waitForFunction(
      (m) => document.querySelector('.app-shell')?.className.includes('mode-' + m),
      name.toLowerCase(), { timeout: 12000 }).catch(async (error) => {
      const state = await page.evaluate(() => ({
        shell: document.querySelector('.app-shell')?.className,
        status: document.querySelector('.statusbar')?.textContent,
        menu: document.querySelector('.mode-menu')?.textContent,
        system: [...document.querySelectorAll('.msg-system, .system-message')].map((e) => e.textContent).slice(-3),
      }));
      throw new Error(`mode ${name} did not arrive: ${JSON.stringify(state)}`, { cause: error });
    });
    await page.waitForTimeout(700);
  };
  const switchTo = (name) => pickMode(name);
  const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
  const text = async (sel) => (await page.locator(sel).count())
    ? (await page.locator(sel).first().innerText()) : '';

  // =====================================================================
  // L2 · source-level static checks (DESIGN §9.0)
  // =====================================================================
  const sources = readUiSources();
  const srcText = sources.map(([, s]) => s).join('\n');
  const cssText = sources.filter(([p]) => p.endsWith('.css')).map(([, s]) => s).join('\n');
  check('L2: no hard-coded protocol literal in the UI source',
    !/pristem\.ipc\/v0\./.test(srcText));
  check('L2: terminal instance field is "instance", never a string id',
    !/term_id/.test(srcText) && /instance\??:\s*number/.test(srcText));
  check('L2: --font-display is gone', !/--font-display/.test(cssText));
  check('L2: intensity formula is defined exactly once',
    (cssText.match(/clamp\(0,\s*calc\(var\(--presence\)/g) || []).length === 1);
  const cssClean = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const cssBlocks = cssClean.match(/[^{}]+\{[^{}]*\}/g) || [];
  const offenders = cssBlocks.filter((b) => {
    const sel = b.split('{')[0].trim();
    if (sel.startsWith('.app-shell')) return false;
    return /var\(--presence\)|var\(--living-gain\)/.test(b);
  });
  check('L2: --presence / --living-gain are only read on .app-shell',
    offenders.length === 0, offenders.map((b) => b.split('{')[0].trim()).join(' | '));
  check('L2: the rainbow gradient is defined exactly once',
    (cssText.match(/--spectrum:\s*linear-gradient/g) || []).length === 1);
  check('L2: the prism phase is registered exactly once',
    (cssText.match(/@property\s+--phase/g) || []).length === 1);
  check('L2: the rainbow never carries text',
    !/color:\s*var\(--spectrum/.test(cssText) && !/color:\s*var\(--accent-line\)/.test(cssText));
  check('L2: the phase is never frozen inside a custom property',
    !/--[a-z-]+:[^;]*var\(--phase\)/.test(cssText));

  // PRISM: the rainbow is the accent, and it stays legible. Every stop must
  // carry the ink — on white the same spectrum fails (1.97:1 on the amber).
  const spectrumStops = ['#E0564B', '#DEB349', '#59A15C', '#4680E1', '#8E6BE0', '#E0569E'];
  const relLum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a, b) => {
    const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const worstInk = Math.min(...spectrumStops.map((s) => contrast(s, '#0A0A0A')));
  check('C9: every spectrum stop carries the accent ink at 4.5:1 or better',
    worstInk >= 4.5, `worst=${worstInk.toFixed(2)}:1`);

  // PRISM: the accent reaches the pixels and the clock actually turns.
  const prism = await page.evaluate(() => {
    const shell = document.querySelector('.app-shell');
    const primary = document.querySelector('.primary-btn');
    return {
      primaryFill: primary ? getComputedStyle(primary, '::before').backgroundImage : '',
      primaryFilter: primary ? getComputedStyle(primary, '::before').filter : '',
      bandFilter: shell ? getComputedStyle(shell, '::after').filter : '',
      loops: document.getAnimations()
        .filter((a) => a.playState === 'running' && a.effect?.getTiming?.().iterations === Infinity)
        .map((a) => a.animationName || 'anonymous'),
    };
  });
  check('PRISM: the primary button is solid (no spectrum on buttons)',
    !/gradient/.test(prism.primaryFill), prism.primaryFill.slice(0, 48));
  check('PRISM: the accent fill turns with the phase clock (top band)',
    /hue-rotate/.test(prism.bandFilter),
    prism.bandFilter.slice(0, 48));
  const movers = prism.loops.filter((n) => n !== 'prism-phase');
  check('D2: at most one infinite animation moves geometry (the prism clock only turns colour)',
    movers.length <= 1, prism.loops.join(' | '));
  const phases = [];
  for (let i = 0; i < 7; i++) {
    phases.push(await page.evaluate(() =>
      parseFloat(getComputedStyle(document.querySelector('.app-shell')).getPropertyValue('--phase')) || 0));
    await page.waitForTimeout(500);
  }
  const spread = Math.max(...phases) - Math.min(...phases);
  const mode = await page.evaluate(() =>
    document.querySelector('.app-shell')?.className.match(/mode-([a-z]+)/)?.[1] || '');
  check('PRISM: the phase clock is running (IDE and deepsleep pause it by design)',
    ['ide', 'deepsleep'].includes(mode) || spread > 1,
    `mode=${mode} spread=${spread.toFixed(2)}deg`);
  for (const dead of ['.confirm-toast', '.intent-chips', '.activity-bar', '.title-menus', '.path-input', '.living-core', '.living-eye', '.living-bloom', '.living-highlight', '.goal-templates', '.menu-dial', '.demo-source-tag', '.ai-demo-tag', '.tool-card-demo-prefix', '.spectrum-living']) {
    check(`L2: ${dead} is gone from the source`, !srcText.includes(dead));
  }
  const globalKeydowns = sources.flatMap(([p, s]) =>
    [...s.matchAll(/window\.addEventListener\(\s*['"]keydown['"]/g)].map(() => p));
  check('L2: App owns the only window-level keydown listener',
    globalKeydowns.length === 1 && globalKeydowns[0].endsWith('App.tsx'),
    `listeners=${globalKeydowns.length}`);

  // =====================================================================
  // coding
  // =====================================================================
  const fsList = await page.evaluate(async () => {
    const r = await fetch('/api/io', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'fs.list' }),
    });
    try { return await r.json(); } catch { return {}; }
  });
  const protoFromShell = fsList.protocol ?? null;
  const badgeCount = await page.locator('.proto-badge').count();
  const badgeText = badgeCount ? await page.locator('.proto-badge').innerText() : '';
  check('D-5: protocol badge equals the fs.list protocol value',
    protoFromShell ? badgeCount === 1 && badgeText === protoFromShell : badgeCount === 0,
    protoFromShell ? `badge=${badgeText} shell=${protoFromShell}` : 'no protocol field → badge not rendered');
  check('coding: right AI dock present', (await page.locator('.ai-panel.right').count()) === 1);
  check('coding: AI elements rendered', (await page.locator('[data-ai="true"]').count()) > 0);
  const aiSeed = await page.locator('.ai-panel.right').innerText();
  check('ai: the panel-empty state does not advertise the summon chord',
    !/Shift\+@\+F1/.test(aiSeed) && aiSeed.includes('@'), aiSeed.split('\n').slice(0, 3).join(' / '));

  // ---- composer bar: workspace, permission, model, @ / / + send ----------
  const bar = page.locator('.ai-panel.right .composer-bar');
  check('composer: bar exposes workspace, permission and model',
    (await bar.locator('.composer-seg').count()) === 3 &&
    (await bar.locator('.foot-icon').count()) === 1 &&
    (await bar.locator('.send-btn').count()) === 1,
    `segments=${await bar.locator('.composer-seg').count()}`);
  check('composer: the mode chip is gone (titlebar owns switching)',
    (await page.locator('.composer-bar .composer-seg-label').filter({ hasText: /编码协作|Coding|协助执行|Helping/ }).count()) === 0);
  await bar.locator('.composer-seg').nth(0).click();
  check('composer: workspace menu offers the folder picker',
    (await page.locator('.composer-pop-row').filter({ hasText: /选择文件夹|Choose folder/ }).count()) === 1);
  await page.keyboard.press('Escape');
  await bar.locator('.composer-seg').nth(1).click();
  check('composer: permission menu lists all three levels',
    (await page.locator('.composer-pop-row').count()) === 3 &&
    (await page.locator('.composer-pop-note').count()) === 1,
    `rows=${await page.locator('.composer-pop-row').count()}`);
  await page.locator('.composer-pop-row').nth(1).click();
  check('composer: permission selection persists',
    (await page.evaluate(() => JSON.parse(localStorage.getItem('pristem.local') || '{}').permission)) === 'auto');
  await bar.locator('.composer-seg').nth(2).click();
  const modelLabels = await page.locator('.composer-pop-label').allInnerTexts();
  const modelHints = await page.locator('.composer-pop-hint').allInnerTexts();
  const modelBox = await page.locator('.composer-pop').boundingBox();
  const viewportW = await page.evaluate(() => window.innerWidth);
  check('composer: model menu lists models, not adapter categories',
    modelLabels.length >= 3 &&
    modelLabels.some((l) => /gpt-4o/.test(l)) &&
    !modelLabels.some((l) => /^(openai-chat|openai-responses|anthropic-messages)$/.test(l.trim())),
    modelLabels.join(' | '));
  check('composer: a working key is not announced as a badge',
    !modelHints.some((h) => /密钥已保存|Key saved/.test(h)),
    modelHints.join(' | '));
  check('composer: model menu stays inside the window',
    !!modelBox && modelBox.x >= 0 && modelBox.x + modelBox.width <= viewportW,
    JSON.stringify(modelBox));
  await page.keyboard.press('Escape');

  // Narrow windows: every centred or edge-anchored overlay must stay inside.
  await page.setViewportSize({ width: 1024, height: 683 });
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.locator('.title-mode').click();
  await page.waitForSelector('.mode-menu', { timeout: 4000 });
  const modeBox = await page.locator('.mode-menu').boundingBox();
  check('modes: the titlebar menu stays inside a 1024px window',
    !!modeBox && modeBox.x >= 0 && modeBox.x + modeBox.width <= 1024,
    JSON.stringify(modeBox));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+P');
  await page.waitForSelector('.palette', { timeout: 4000 });
  const palBox = await page.locator('.palette').boundingBox();
  check('palette: centred and inside a 1024px window',
    !!palBox && palBox.x >= 0 && Math.abs((palBox.x + palBox.width / 2) - 512) <= 1 &&
    palBox.x + palBox.width <= 1024,
    JSON.stringify(palBox));
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(250);

  const ta = page.locator('.ai-panel.right .composer-box textarea');
  await ta.click();
  await page.keyboard.type('@');
  check('composer: @ opens the file mention list with a file badge',
    (await page.locator('.composer-suggest-row').count()) > 0 &&
    (await page.locator('.composer-suggest-kind').count()) > 0);
  await page.keyboard.press('Escape');
  await ta.fill('');
  await page.keyboard.type('/');
  check('composer: / lists real commands',
    (await page.locator('.composer-suggest-row').count()) >= 5 &&
    (await page.locator('.composer-suggest-hint').first().innerText()).length > 0);
  await page.keyboard.press('Escape');
  await ta.fill('');
  await bar.locator('.foot-icon').click();
  check('composer: + inserts a file mention token',
    (await ta.inputValue()).startsWith('@') &&
    (await page.locator('.composer-suggest-row').count()) > 0,
    await ta.inputValue());
  await page.keyboard.press('Escape');
  await ta.fill('');

  // The AI panel has a usable floor; the composer bar never escapes it.
  const sepRight = page.locator('.ws-sep-right');
  await sepRight.focus();
  for (let i = 0; i < 30; i++) await sepRight.press('ArrowRight');
  await page.waitForTimeout(250);
  const rightBox = await page.locator('.ai-panel.right').boundingBox();
  const barOverflow = await bar.evaluate((el) => el.scrollWidth - el.clientWidth);
  check('layout: the AI panel cannot shrink below its usable minimum',
    !!rightBox && Math.round(rightBox.width) >= 300, `w=${Math.round(rightBox?.width ?? 0)}`);
  check('layout: the composer bar never overflows the panel', barOverflow <= 1, `overflow=${barOverflow}`);
  await sepRight.dblclick();
  await page.waitForTimeout(300);

  // Shift+F1 is order-independent and focuses the composer in an active mode.
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  await page.keyboard.press('Shift+F1');
  await page.waitForTimeout(200);
  check('shortcut: Shift+F1 focuses the AI composer',
    await page.evaluate(() => !!document.activeElement?.closest?.('.composer-box')));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pristem:window-state', { detail: { maximized: true } })));
  await page.waitForSelector('.wc-restore', { timeout: 2000 }).catch(() => {});
  check('titlebar: maximized state shows the restore glyph',
    (await page.locator('.wc-restore').count()) === 1 &&
    (await page.getByRole('button', { name: 'Restore' }).count()) === 1);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pristem:window-state', { detail: { maximized: false } })));
  await page.waitForSelector('.wc-max', { timeout: 2000 }).catch(() => {});
  check('titlebar: restored state returns to the maximize glyph',
    (await page.locator('.wc-max').count()) === 1 &&
    (await page.getByRole('button', { name: 'Maximize' }).count()) === 1);

  // ---- F1 / F2 · no title menu bar, no 48px activity bar ----------------
  check('F1: no title-bar menu bar', (await page.locator('.title-menus, .title-menu-btn').count()) === 0);
  check('5a: the menu bar is visible in coding mode', (await page.locator('.menubar').count()) === 1);
  check('F2: no 48px icon activity bar', (await page.locator('.activity-bar, .activity-item').count()) === 0);
  const railHead = page.locator('.left-rail-head');
  const railItems = page.locator('.view-seg-item');
  check('N1: left rail is a 28px horizontal head with a 24px switcher',
    (await railHead.count()) === 1 && Math.round((await railHead.boundingBox()).height) === 28 &&
    Math.round((await page.locator('.view-seg').boundingBox()).height) === 24 &&
    (await page.locator('.activity-rail').count()) === 0);
  check('N2: all three view segments have an icon and a text label',
    (await railItems.count()) === 3 && await railItems.evaluateAll((items) =>
      items.every((el) => el.querySelector('svg') && (el.textContent || '').trim().length > 0)));
  check('N4: the horizontal rail keeps its own settings action',
    (await page.locator('.rail-settings').count()) === 1);
  // The project column owns its chrome: narrowing it must tighten the rail and
  // tree actions, never clip them under the panel edge.
  await page.locator('.ws-sep-left').focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(400);
  check('N5: the project column chrome fits when narrowed to 236px', await page.evaluate(() => {
    const fit = (s) => {
      const el = document.querySelector(s);
      return !!el && el.scrollWidth <= el.clientWidth;
    };
    const gear = document.querySelector('.rail-settings')?.getBoundingClientRect();
    const col = document.querySelector('.left-column')?.getBoundingClientRect();
    return fit('.left-rail-head') && fit('.filetree .pane-head') &&
      !!gear && !!col && gear.right <= col.right;
  }));
  await page.locator('.ws-sep-left').dblclick();
  await page.waitForTimeout(400);
  check('N5: double-click restores the project column width',
    Math.round((await page.locator('.left-column').boundingBox()).width) === 268);
  const toastPosition = await page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'toast-stack';
    document.body.appendChild(el);
    const style = getComputedStyle(el);
    const result = { top: style.top, renderedTop: el.getBoundingClientRect().top };
    el.remove();
    return result;
  });
  check('F4: toasts stay at the top-right, away from the composer',
    toastPosition.top === '48px' && Math.round(toastPosition.renderedTop) === 48,
    `top=${toastPosition.top} rendered=${toastPosition.renderedTop}`);
  check('F3: title bar is 36px', Math.round((await page.locator('.titlebar').boundingBox()).height) === 36);
  // Window chrome basics: a click does nothing, a drag moves the window, and a
  // double-click toggles maximize — all on the titlebar background, never on a
  // control (buttons/inputs are excluded from both drag and maximize).
  const brandBox = await page.locator('.brand').boundingBox();
  const chromeOps = [];
  const onChrome = (r) => {
    if (!r.url().includes('/api/io')) return;
    const body = r.postData() || '';
    if (body.includes('window.drag')) chromeOps.push('drag');
    else if (body.includes('window.maximize')) chromeOps.push('max');
  };
  page.on('request', onChrome);
  await page.locator('.brand').click();
  await page.waitForTimeout(150);
  const clickOps = chromeOps.splice(0);
  const bx = brandBox.x + 60, by = brandBox.y + brandBox.height / 2;
  await page.mouse.move(bx, by);
  await page.mouse.down();
  await page.mouse.move(bx + 40, by + 18, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const dragOps = chromeOps.splice(0);
  await page.locator('.brand').dblclick();
  await page.waitForTimeout(150);
  page.off('request', onChrome);
  const dblOps = chromeOps.splice(0);
  check('titlebar: a plain click does not drag the window', clickOps.length === 0, clickOps.join(','));
  check('titlebar: dragging the bar moves the window',
    dragOps.filter((o) => o === 'drag').length === 1, dragOps.join(','));
  check('titlebar: a double-click toggles maximize without dragging',
    dblOps.includes('max') && !dblOps.includes('drag'), dblOps.join(','));
  check('F3: sessions live in the title-bar toggle',
    (await page.locator('.session-bar').count()) === 0 &&
    (await page.locator('.session-switcher').count()) === 1);
  check('F3: status bar is 24px', Math.round((await page.locator('.statusbar').boundingBox()).height) === 24);
  const leftW = Math.round((await page.locator('.left-column').boundingBox()).width);
  check('F4: left column is 268px', leftW === 268, `w=${leftW}`);
  const rightW = Math.round((await page.locator('.ai-panel.right').boundingBox()).width);
  check('F4: console column is 360px', rightW === 360, `w=${rightW}`);
  const stripH = Math.round((await page.locator('.terminal-pane').boundingBox()).height);
  check('F4: activity strip is 176px', stripH === 176, `h=${stripH}`);
  const statusChildren = await page.evaluate(() => {
    const el = document.querySelector('.statusbar');
    return el ? el.children.length : 0;
  });
  check('F8: status bar holds at most 6 elements', statusChildren <= 6, `count=${statusChildren}`);
  const statusText = await text('.statusbar');
  check('F9: status bar carries no branch / diagnostics / cursor / eol / indent',
    !/main|Ln \d|错误|警告|CRLF|LF|空格/.test(statusText), statusText.replace(/\n/g, ' '));
  // A healthy transport is silent; only exceptions are labelled. Either way,
  // a lone dot can never carry the meaning.
  check('chrome: a healthy connection adds no status copy',
    (await page.locator('.conn-state').count()) === 0 &&
    (await page.locator('.conn-dot').count()) === 0);
  check('chrome: the session toggle is a labelled block, not a dot',
    (await page.locator('.session-switcher-btn').innerText()).trim().length > 0 &&
    (await page.locator('.session-switcher .tab-dot').count()) === 0);
  await page.setViewportSize({ width: 640, height: 800 });
  await page.waitForTimeout(250);
  check('titlebar: narrow coding view does not overflow', await page.locator('.titlebar').evaluate((el) =>
    el.scrollWidth <= el.clientWidth));
  await page.setViewportSize({ width: 880, height: 800 });
  await page.waitForTimeout(300);
  check('narrow: no horizontal page scroll at 880px', await page.evaluate(() =>
    document.documentElement.scrollWidth === document.documentElement.clientWidth));
  check('narrow: the console floats over the work area below 880px',
    (await page.locator('.ai-panel.right').evaluate((el) => getComputedStyle(el).position)) === 'absolute');
  check('narrow: the session chip yields the titlebar below 880px',
    (await page.locator('.session-switcher').evaluate((el) => getComputedStyle(el).display)) === 'none');
  check('narrow: the search capsule collapses to its lens',
    Math.round((await page.locator('.search-capsule').boundingBox()).width) <= 30);
  await page.locator('.search-capsule').click();
  await page.waitForTimeout(200);
  check('narrow: focusing the capsule expands it into a field',
    Math.round((await page.locator('.search-capsule').boundingBox()).width) >= 150);
  await page.locator('.search-capsule input').evaluate((el) => el.blur());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(250);

  // ---- brand ------------------------------------------------------------
  check('brand: prism count <= 2', (await page.locator('.brand-prism').count()) <= 2,
    `count=${await page.locator('.brand-prism').count()}`);
  check('brand: legacy living parts removed',
    (await page.locator('.living-core, .living-eye, .living-bloom, .living-highlight').count()) === 0);
  // The wordmark is UI chrome. User data (a workspace folder called
  // "pristem", a file that contains the word) is not a brand occurrence.
  const wordmarks = await page.evaluate(() => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const skip = '.project-chip, .tree-root, .tree-item, .monaco-editor, .xterm, .term-history, .output-panel, .problem-row, .composer-bar';
    let n = 0, node;
    while ((node = w.nextNode())) {
      const txt = (node.textContent || '').trim();
      if (!/^pristem\.?$/i.test(txt)) continue;
      const el = node.parentElement;
      if (!el || getComputedStyle(el).display === 'none') continue;
      if (el.closest(skip)) continue;
      n++;
    }
    return n;
  });
  check('brand: wordmark appears once', wordmarks === 1, `count=${wordmarks}`);

  // ---- no demo wording --------------------------------------------------
  const banned = await page.evaluate(() => {
    const re = /演示|demo|假数据|未完成|占位|TODO/gi;
    const hits = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = w.nextNode())) {
      const txt = (node.textContent || '');
      if (re.test(txt)) hits.push(txt.trim().slice(0, 40));
      re.lastIndex = 0;
    }
    return hits;
  });
  check('no demo wording anywhere', banned.length === 0, banned.slice(0, 3).join(' | '));
  check('no demo tag elements',
    (await page.locator('.ai-demo-tag, .demo-source-tag, .tool-card-demo-prefix').count()) === 0);
  const connText = await page.evaluate(() => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n = 0, node;
    while ((node = w.nextNode())) {
      const txt = (node.textContent || '').trim();
      if (/内核未连接|离线夹具/.test(txt)) n++;
    }
    return n;
  });
  check('G12: the connection state is stated exactly once', connText <= 1, `count=${connText}`);

  // ---- editor ------------------------------------------------------------
  const file = page.locator('.tree-item:not(.is-dir)').first();
  if (await file.count()) {
    await file.click();
    await page.waitForTimeout(900);
    check('coding: Monaco renders a real file', (await page.locator('.monaco-editor .view-lines').count()) > 0);
    // Clicking past the last glyph must put the caret at the end of that line.
    const lineEnd = await page.evaluate(() => {
      const line = document.querySelector('.monaco-editor .view-line');
      if (!line) return null;
      const spans = [...line.querySelectorAll('span')];
      const box = (spans[spans.length - 1] || line).getBoundingClientRect();
      return { right: box.right, y: box.top + box.height / 2 };
    });
    if (lineEnd) {
      await page.mouse.click(lineEnd.right + 4, lineEnd.y);
      await page.waitForTimeout(200);
      const clicked = await page.locator('.monaco-editor .cursors-layer .cursor').first().boundingBox();
      // Font metrics can settle after the first paint, so compare against the
      // editor's own end-of-line position instead of the earlier pixel probe.
      await page.keyboard.press('End');
      await page.waitForTimeout(150);
      const ended = await page.locator('.monaco-editor .cursors-layer .cursor').first().boundingBox();
      check('editor: a click past the line end lands at the end, not offset',
        !!clicked && !!ended && Math.abs(clicked.x - ended.x) <= 2,
        `clicked=${clicked?.x?.toFixed(1)} end=${ended?.x?.toFixed(1)}`);
    }
  }
  // F15 — directories are expandable, not disabled.
  const dirDisabled = await page.evaluate(() => {
    const dirs = [...document.querySelectorAll('.tree-item.is-dir')];
    return dirs.filter((d) => d.hasAttribute('disabled')).length;
  });
  check('F15: directory rows are not disabled', dirDisabled === 0, `disabled=${dirDisabled}`);

  // terminal actually runs a command through the service IO channel
  await page.locator('.term-host').click();
  await page.keyboard.type('echo pristem-ok', { delay: 15 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1400);
  const termText = await page.locator('.xterm-rows').innerText();
  check('terminal: command executes via service IO', termText.includes('pristem-ok'));
  const promptLines = termText.split('\n').filter((l) => /PS\s|>\s*$/.test(l));
  check('G4: the terminal shows a real shell prompt', promptLines.length >= 1,
    `lines=${promptLines.length}`);
  check('G5: the terminal has no "pristem terminal" banner', !termText.includes('pristem terminal'));
  check('G6: the terminal has no shell echo of the command', !termText.includes('pristem@workspace %'));

  // Real PTY: cwd persists across commands (not a per-command spawn).
  await page.keyboard.type('cd pristem-desktop', { delay: 10 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  await page.keyboard.type('echo PTY_CWD_OK', { delay: 10 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  const cwdText = await page.locator('.xterm-rows').innerText();
  check('terminal: cwd persists across commands (real PTY)',
    cwdText.includes('PTY_CWD_OK') && /pristem-desktop/.test(cwdText));
  check('terminal: the header has a clear action', (await page.locator('.term-clear').count()) === 1);

  // Scrollback: a scrolled-up terminal offers a jump-to-bottom affordance.
  let shellName = '';
  for (let i = 0; i < 12; i += 1) {
    shellName = (await page.locator('.term-tab.is-active .term-tab-name').innerText()).trim().toLowerCase();
    if (!shellName.includes('启动') && !shellName.includes('开始') && !shellName.includes('starting')) break;
    await page.waitForTimeout(200);
  }
  const fill = shellName.includes('powershell') || shellName.includes('pwsh')
    ? '1..80 | % { "SCROLL_$_" }'
    : 'for /L %i in (1,1,80) do @echo SCROLL_%i';
  await page.locator('.term-host').click();
  await page.keyboard.type(fill, { delay: 5 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1600);
  await page.locator('.term-host').hover();
  await page.mouse.wheel(0, -900);
  await page.mouse.wheel(0, -900);
  await page.waitForTimeout(400);
  check('terminal: scrolling up shows the jump-to-bottom button',
    (await page.locator('.term-jump-bottom').count()) === 1);
  await page.locator('.term-jump-bottom').click();
  await page.waitForTimeout(400);
  check('terminal: jump-to-bottom returns to the tail and hides the button',
    (await page.locator('.term-jump-bottom').count()) === 0);

  // Ctrl+` toggles: focus in the terminal → collapse, press again → expand.
  await page.keyboard.press('Control+Backquote');
  await page.waitForTimeout(350);
  check('terminal: Ctrl+` collapses while the terminal has focus',
    (await page.locator('.terminal-pane.is-collapsed').count()) === 1);
  await page.keyboard.press('Control+Backquote');
  await page.waitForTimeout(500);
  check('terminal: Ctrl+` expands again',
    (await page.locator('.terminal-pane.is-collapsed').count()) === 0);

  // Collapse → expand keeps the session alive (the host never unmounts).
  await page.locator('.activity-toggle').click();
  await page.waitForTimeout(300);
  check('terminal: collapse hides the body',
    (await page.locator('.terminal-pane.is-collapsed').count()) === 1);
  await page.locator('.activity-handle').click();
  await page.waitForTimeout(500);
  await page.locator('.term-host').click();
  await page.keyboard.type('echo AFTER_EXPAND', { delay: 10 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  const expandText = await page.locator('.xterm-rows').innerText();
  check('terminal: expand restores the live session', expandText.includes('AFTER_EXPAND'));

  // file write + read round-trip through the service (scratch file, not source)
  const ioPost = (body) => fetch(`${URL}api/io`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json());
  await ioPost({ op: 'fs.write', path: 'pristem-desktop/.screenshots/smoke-edit.txt', content: 'service-io-roundtrip' });
  const readBack = await ioPost({ op: 'fs.read', path: 'pristem-desktop/.screenshots/smoke-edit.txt' });
  check('workspace: file write/read via service IO', readBack.content === 'service-io-roundtrip');

  await shot('01-coding');

  // ---- IDE ----------------------------------------------------------------
  await switchTo('IDE');
  const aiCount = await page.locator('[data-ai="true"]').count();
  const dormant = await page.evaluate(() => window.__pristemDormantCheck());
  check('IDE: ZERO AI elements in DOM', aiCount === 0, `count=${aiCount}`);
  check('IDE: runtime dormancy check', dormant === true);
  check('IDE: AI column collapsed', (await page.locator('.ai-panel').count()) === 0);
  const rightGrid = await page.evaluate(() => getComputedStyle(document.querySelector('.workspace')).gridTemplateColumns);
  check('IDE: right column width is 0', /0px/.test(rightGrid.split(' ').pop() || ''), rightGrid);
  const ideDial = await page.evaluate(() => {
    const el = document.querySelector('.statusbar .dial');
    return el ? el.getBoundingClientRect().width : 0;
  });
  check('E4: the IDE status-bar dial has zero width', ideDial === 0, `w=${ideDial}`);

  // ---- Phase 5 · menu bar, commands, task picker -------------------------
  check('5a: IDE shows the menu bar', (await page.locator('.menubar').count()) === 1);
  check('5a: five top-level menus', (await page.locator('.menubar-btn').count()) === 5,
    `count=${await page.locator('.menubar-btn').count()}`);
  check('5a: palette and menu share one command table',
    !(await page.locator('.title-menus, .title-menu-btn').count()));
  await page.locator('.menubar-btn').first().click();
  await page.waitForTimeout(220);
  const fileMenuItems = await page.locator('.menubar-menu [role="menuitem"]').count();
  check('5a: the File menu opens with real items', fileMenuItems >= 5, `items=${fileMenuItems}`);
  const fileMenuKeys = await page.locator('.menubar-menu .menubar-key').count();
  check('5a: menu items carry shortcut labels', fileMenuKeys >= 2, `keys=${fileMenuKeys}`);
  await page.locator('.menubar-menu [role="menuitem"]').first().focus();
  await page.keyboard.press('ArrowDown');
  check('5a: ArrowDown focuses a menu item through the app key handler',
    await page.evaluate(() => document.activeElement?.getAttribute('role') === 'menuitem' &&
      document.activeElement === document.querySelectorAll('.menubar-menu [role="menuitem"]')[1]));
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(120);
  check('5a: ArrowRight opens the adjacent menu through the app key handler',
    (await page.locator('.menubar-btn').nth(1).getAttribute('aria-expanded')) === 'true');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(120);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(220);
  check('5a: Esc closes the menu', (await page.locator('.menubar-menu').count()) === 0);

  await page.locator('.menubar-btn').nth(1).click();
  await page.waitForTimeout(180);
  const editItems = await page.locator('.menubar-menu [role="menuitem"]').count();
  check('5a: the Edit menu carries format + organize-imports', editItems >= 8, `items=${editItems}`);
  const editKeys = await page.locator('.menubar-menu .menubar-key').allTextContents();
  check('5a: the Edit menu exposes the navigation commands',
    ['F12', 'Shift+F12', 'Alt+F12', 'Shift+F6'].every((k) => editKeys.includes(k)),
    editKeys.join(','));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(180);

  await page.locator('.menubar-btn').nth(3).click();
  await page.waitForTimeout(180);
  const runItems = await page.locator('.menubar-menu [role="menuitem"]').count();
  check('5b: the Run menu lists four commands', runItems === 4, `items=${runItems}`);
  // Task list is the third enabled entry; it reads package.json then opens.
  await page.locator('.menubar-menu [role="menuitem"]').nth(2).click();
  await page.waitForSelector('.task-picker', { timeout: 4000 }).catch(() => {});
  const taskRows = await page.locator('.task-picker button').count();
  check('5b: the task picker lists detected tasks', taskRows >= 1, `tasks=${taskRows}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(220);
  check('5b: Esc closes the task picker', (await page.locator('.task-picker').count()) === 0);

  await shot('02-ide');

  // @ stays plain text; lone @ at word start summons near the cursor
  await page.locator('.monaco-editor').first().click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('@Mod', { delay: 45 });
  await page.waitForTimeout(700);
  check('IDE: @Mod types as plain text (no hijack)', (await page.locator('.summon').count()) === 0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await page.keyboard.type('@', { delay: 50 });
  await page.waitForSelector('.summon', { timeout: 3000 }).catch(() => {});
  const summoned = (await page.locator('.summon').count()) === 1;
  check('IDE: lone @ summons floating panel', summoned);
  if (summoned) {
    await shot('03-ide-summon');
    await page.locator('.summon input').fill('help me refactor this');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => document.querySelector('.app-shell')?.className.includes('mode-helping'),
      null, { timeout: 9000 },
    ).catch(() => {});
    check('IDE: sending from @ panel enters helping', (await modeClass()).includes('mode-helping'));
  } else {
    check('IDE: sending from @ panel enters helping', false, 'no summon panel');
  }
  await page.keyboard.press('Escape');

  // ---- helping ------------------------------------------------------------
  await switchTo('helping');
  await switchTo('helping');
  check('mode: reselecting the current mode does not latch pending',
    (await page.locator('.mode-menu button[aria-disabled="true"]').count()) === 0 &&
    (await page.locator('.menu-pending').count()) === 0);
  check('helping: dock inside project column', (await page.locator('.left-column .ai-panel.dock').count()) === 1);
  const geom = await page.evaluate(() => {
    const tree = document.querySelector('.filetree')?.getBoundingClientRect();
    const dock = document.querySelector('.ai-panel.dock')?.getBoundingClientRect();
    return tree && dock ? { treeBottom: tree.bottom, dockTop: dock.top, dockH: dock.height, treeH: tree.height } : null;
  });
  check('helping: dock occupies lower half of file tree column',
    !!geom && Math.abs(geom.dockH - geom.treeH) < 30 && geom.dockTop >= geom.treeBottom - 2,
    geom ? `tree=${Math.round(geom.treeH)} dock=${Math.round(geom.dockH)}` : 'no geometry');
  await shot('04-helping');

  // ---- advisor ------------------------------------------------------------
  await switchTo('advisor');
  check('advisor: review canvas present', (await page.locator('.review-canvas').count()) === 1);
  check('advisor: the sample badge stays inside the review canvas', await page.evaluate(() => {
    const tag = document.querySelector('.review-sample-tag');
    const canvas = document.querySelector('.review-canvas');
    if (!tag || !canvas) return true; // no sample source in this session
    const t = tag.getBoundingClientRect();
    const c = canvas.getBoundingClientRect();
    return t.left >= c.left && t.right <= c.right + 1;
  }));
  const code = await page.locator('.review-code').boundingBox();
  if (code) {
    await page.mouse.move(code.x + 12, code.y + 12);
    await page.mouse.down();
    await page.mouse.move(code.x + 190, code.y + 12, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  }
  const pop = (await page.locator('.annotation-pop').count()) === 1;
  check('advisor: span selection opens annotation popover', pop);
  if (pop) {
    await page.locator('.annotation-pop textarea').fill('This tool call reads the wrong file.');
    await page.locator('.annotation-pop .primary-btn').click();
    await page.waitForTimeout(300);
    check('advisor: annotation renders on spans', (await page.locator('.review-code .is-marked').count()) > 0);
  }
  await shot('05-advisor');

  // ---- deepsleep: one click, no second confirmation ----------------------
  await switchTo('coding');
  if ((await page.locator('.mode-menu').count()) === 0) {
    await page.locator('.title-mode').click();
    await page.waitForSelector('.mode-menu', { timeout: 5000 });
  }
  await page.locator('.mode-menu button')
    .filter({ has: page.locator('.menu-name', { hasText: /^deepsleep$/ }) })
    .first()
    .click();
  const reached = await page.waitForFunction(
    () => document.querySelector('.app-shell')?.className.includes('mode-deepsleep'),
    null, { timeout: 8000 }).then(() => true).catch(() => false);
  check('deepsleep: one click, no second confirmation', reached);
  check('deepsleep: no confirmation card left behind', (await page.locator('.line-buttons').count()) === 0);
  check('deepsleep: resume button exists', (await page.locator('.deepsleep-resume').count()) === 1);
  check('deepsleep: workbench still mounted', (await page.locator('.workspace').count()) === 1);
  const pe = await page.evaluate(() => {
    const w = document.querySelector('.workspace');
    return w ? getComputedStyle(w).pointerEvents : 'missing';
  });
  check('F6: the deepsleep workbench is not interactive', pe === 'none', `pointer-events=${pe}`);
  const haloDur = await page.evaluate(() => {
    const h = document.querySelector('.living-halo');
    return h ? getComputedStyle(h).animationDuration : 'none';
  });
  check('D3: deepsleep has a 12s breathing halo', haloDur === '12s', `duration=${haloDur}`);
  const shortAnims = await page.evaluate(() =>
    [...document.getAnimations()]
      .filter((a) => a.playState === 'running' && a.effect?.getTiming?.().iterations === Infinity)
      .filter((a) => (a.effect?.getTiming?.().duration ?? 9999) < 2000).length);
  check('D4: deepsleep has no animation faster than 2s', shortAnims === 0, `count=${shortAnims}`);
  const loopingAnims = await page.evaluate(() =>
    [...document.getAnimations()].filter((a) =>
      a.playState === 'running' && a.effect?.getTiming?.().iterations === Infinity).length);
  check('deepsleep: at most one looping animation runs at once', loopingAnims <= 1, `count=${loopingAnims}`);
  check('deepsleep: no usage vitals or empty execution chain',
    (await page.locator('.deepsleep-layer .ai-vitals, .deepsleep-layer .deepsleep-chain').count()) === 0);
  await page.keyboard.press('Control+Shift+F');
  await page.keyboard.press('Control+P');
  await page.keyboard.press('Control+G');
  check('deepsleep: workspace shortcuts cannot open hidden editor surfaces',
    (await page.locator('.palette, .jump-line-pop, .outline-pop').count()) === 0);
  await shot('06-deepsleep');

  await page.locator('.deepsleep-resume').click();
  await page.waitForFunction(
    () => document.querySelector('.app-shell')?.className.includes('mode-coding'),
    null, { timeout: 8000 }).catch(() => {});
  check('D-1a: the resume button returns to coding', (await modeClass()).includes('mode-coding'));

  // wake briefing
  const wakeBtn = page.locator('.deepsleep-actions .secondary-btn');
  await switchTo('deepsleep');
  if (await wakeBtn.count()) {
    await wakeBtn.click();
    await page.waitForSelector('.wake-card', { timeout: 8000 });
    const wakeRules = await page.locator('.wake-card li').count();
    check('deepsleep: wake-up briefing has rules or an explicit empty state',
      wakeRules > 0 || (await page.locator('.wake-empty').count()) === 1);
    check('deepsleep: wake-up briefing caps visible rules at five', wakeRules <= 5, `rules=${wakeRules}`);
    check('G8: the wake card has a close button', (await page.locator('.wake-card-close').count()) === 1);
    check('D-1c: the wake card has a "back to workbench" button', (await page.locator('.wake-card-back').count()) === 1);
    await page.waitForTimeout(700);
    await shot('07-wake-briefing');
    if ((await page.locator('.wake-card .primary-btn').count()) > 0) {
      await page.locator('.wake-card .primary-btn').click();
    } else {
      await page.locator('.wake-card-back').click();
      await page.locator('.deepsleep-resume').click();
    }
    await page.waitForTimeout(900);
    check('waking is resumable (back to coding)', (await modeClass()).includes('mode-coding'));
  }

  // ---- goal ---------------------------------------------------------------
  // The starters belong to the empty state, so start from a fresh session.
  if ((await page.locator('.session-panel').count()) === 0) {
    // Open the panel with a simulated click. The titlebar starts a native window
    // drag on mousedown, so the toggle must stop propagation or the click is
    // swallowed before it reaches React.
    const dragOps = [];
    const onToggleRequest = (r) => {
      if (r.url().includes('/api/io') && (r.postData() || '').includes('window.drag')) dragOps.push(1);
    };
    page.on('request', onToggleRequest);
    await page.locator('.session-switcher-btn').click();
    await page.waitForTimeout(300);
    page.off('request', onToggleRequest);
    check('sessions: the titlebar toggle clicks instead of dragging the window',
      dragOps.length === 0 && (await page.locator('.session-panel').count()) === 1,
      `drag=${dragOps.length} panel=${await page.locator('.session-panel').count()}`);
  }
  await page.locator('.session-panel .session-new').click();
  await page.waitForTimeout(900);
  await switchTo('goal');
  check('goal: the session panel follows the conversation',
    (await page.locator('.goal .session-panel').count()) === 1 &&
    (await page.locator('.goal .session-card').count()) >= 2,
    `cards=${await page.locator('.goal .session-card').count()}`);
  check('goal: NO codebase surfaces',
    (await page.locator('.filetree').count()) === 0 &&
    (await page.locator('.monaco-host').count()) === 0 &&
    (await page.locator('.term-host').count()) === 0);
  check('goal: pure conversation view', (await page.locator('.goal-composer').count()) === 1);
  const starterBox = await page.locator('.goal-template').first().boundingBox().catch(() => null);
  const starterTops = await page.evaluate(() =>
    [...document.querySelectorAll('.goal-template')].map((e) => e.offsetTop));
  check('G1: goal starters are short chips on one row',
    !!starterBox && starterBox.height <= 28 &&
    starterTops.length > 0 && starterTops.every((v) => v === starterTops[0]),
    `h=${starterBox ? Math.round(starterBox.height) : 'n/a'} tops=${starterTops.join(',')}`);
  check('goal: three starters', (await page.locator('.goal-template').count()) === 3);
  check('goal: no fake intent chips', (await page.locator('.intent-chips, .intent-chip').count()) === 0);
  await shot('08-goal');

  // =====================================================================
  // Phase 2 · UX spec assertions (UX_SPEC.md §9 + appendix D)
  // =====================================================================
  const caps = await page.evaluate(async () => {
    const r = await fetch('/api/io', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'shell.capabilities' }),
    });
    try { return (await r.json()).capabilities || {}; } catch { return {}; }
  });

  // ---- 7 settings --------------------------------------------------------
  await page.keyboard.press('Control+,');
  await page.waitForSelector('.settings-page', { timeout: 5000 }).catch(() => {});
  check('settings: opens as a separate view', (await page.locator('.settings-page').count()) === 1);
  check('F11: the side-panel settings version is gone', (await page.locator('.settings-panel').count()) === 0);
  check('F12: the settings page has at least 7 sections', (await page.locator('.settings-section').count()) >= 7,
    `count=${await page.locator('.settings-section').count()}`);
  check('settings: nav has 7 items', (await page.locator('.settings-nav-item').count()) === 7,
    `count=${await page.locator('.settings-nav-item').count()}`);
  check('settings: chrome stays reachable',
    (await page.locator('.titlebar').count()) === 1 &&
    (await page.locator('.statusbar').count()) === 1);
  // One mode switcher only: the titlebar. The composer chip and the status-bar
  // button are gone, so there is exactly one way to change mode.
  check('modes: exactly one mode switcher (titlebar)',
    (await page.locator('.title-mode').count()) === 1 &&
    (await page.locator('.mode-glyph').count()) === 0,
    `title=${await page.locator('.title-mode').count()} glyph=${await page.locator('.mode-glyph').count()}`);
  check('settings: has a search field', (await page.locator('.settings-search').count()) === 1);

  // The nav must report the section actually in view, not the last click.
  const lastNavLabel = (await page.locator('.settings-nav-item').last().innerText()).trim();
  await page.locator('.settings-page').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await page.waitForTimeout(400);
  const scrolledActive = (await page.locator('.settings-nav-item.is-active').innerText()).trim();
  check('settings: nav follows the scroll position', scrolledActive === lastNavLabel,
    `active=${scrolledActive} expected=${lastNavLabel}`);
  await page.locator('.settings-page').evaluate((el) => el.scrollTo({ top: 0 }));
  await page.waitForTimeout(250);

  await page.locator('.settings-nav-item').nth(1).click();
  await page.waitForSelector('.model-settings', { timeout: 5000 });
  // Clicking a nav row scrolls smoothly; let it settle before measuring movement.
  await page.waitForFunction(() => {
    const el = document.querySelector('.settings-page');
    if (!el) return true;
    const y = el.scrollTop;
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(el.scrollTop === y))));
  });
  const settingsText = await page.locator('.settings-page').innerText();
  check('models: demo mode is stated instead of a false key badge',
    (await page.locator('.model-banner.is-demo').count()) === 1 &&
    !settingsText.includes('密钥已就绪') && !settingsText.includes('Key present'),
    'demo banner / key text');
  check('models: endpoint rows rendered', (await page.locator('.model-row').count()) >= 3,
    `rows=${await page.locator('.model-row').count()}`);
  check('models: built-in rows show product names, not raw adapter ids',
    !(await page.locator('.model-row .model-name').allInnerTexts()).some((n) => /^(openai-chat|openai-responses|anthropic-messages)$/.test(n.trim())),
    (await page.locator('.model-row .model-name').allInnerTexts()).join(' | '));
  const scrollBeforeDialog = await page.locator('.settings-page').evaluate((el) => el.scrollTop);
  await page.locator('.model-add').click();
  await page.waitForSelector('.model-picker', { timeout: 5000 });
  check('models: provider picker offers presets', (await page.locator('.model-preset').count()) >= 10,
    `presets=${await page.locator('.model-preset').count()}`);
  const pickerBox = await page.locator('.model-picker').boundingBox();
  check('models: picker fits inside the window',
    !!pickerBox && pickerBox.y >= 0 && pickerBox.y + pickerBox.height <= 900,
    JSON.stringify(pickerBox));
  const pickerBg = await page.locator('.model-picker').evaluate((el) => getComputedStyle(el).backgroundColor);
  check('models: dialog surface is opaque', /^rgb\(/.test(pickerBg), pickerBg);
  check('models: picker lists Google, Anthropic, DeepSeek and local runtimes',
    (await page.locator('.model-preset').filter({ hasText: 'Google' }).count()) === 1 &&
    (await page.locator('.model-preset').filter({ hasText: 'Anthropic' }).count()) === 1 &&
    (await page.locator('.model-preset').filter({ hasText: 'DeepSeek' }).count()) === 1 &&
    (await page.locator('.model-preset').filter({ hasText: 'Ollama' }).count()) === 1);
  await page.locator('.model-preset').filter({ hasText: 'Google' }).click();
  await page.waitForSelector('.model-form', { timeout: 5000 });
  check('models: opening the form does not move the settings page',
    await page.locator('.settings-page').evaluate((el) => el.scrollTop) === scrollBeforeDialog,
    `before=${scrollBeforeDialog} after=${await page.locator('.settings-page').evaluate((el) => el.scrollTop)}`);
  check('models: preset fills the provider endpoint',
    (await page.locator('.model-form input').nth(0).inputValue()).includes('generativelanguage'),
    await page.locator('.model-form input').nth(0).inputValue());
  check('models: advanced parameters are present',
    (await page.locator('.model-advanced input').count()) >= 6 &&
    (await page.locator('.model-advanced').innerText()).includes('Top P'),
    `inputs=${await page.locator('.model-advanced input').count()}`);
  check('models: custom form has URL, model id and key fields',
    (await page.locator('.model-form input[type="password"]').count()) === 1 &&
    (await page.locator('.model-form input').count()) >= 4);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  check('models: Esc closes the form but keeps settings',
    (await page.locator('.model-form').count()) === 0 &&
    (await page.locator('.settings-page').count()) === 1);
  await page.locator('.settings-nav-item').nth(2).click();
  const numberInput = page.locator('.number-field input').nth(1);
  await numberInput.fill('99');
  await numberInput.blur();
  check('editor: numeric font setting clamps on commit', (await numberInput.inputValue()) === '32',
    `value=${await numberInput.inputValue()}`);
  await numberInput.fill('13');
  await numberInput.blur();
  await page.locator('.settings-nav-item').first().click();
  await page.setViewportSize({ width: 640, height: 800 });
  await page.waitForTimeout(250);
  const narrowSettings = await page.locator('.settings-inner').boundingBox();
  check('settings: narrow view keeps 16px side gutters',
    Math.round(narrowSettings.x) === 16 && Math.round(640 - narrowSettings.x - narrowSettings.width) === 16,
    `left=${narrowSettings.x} right=${640 - narrowSettings.x - narrowSettings.width}`);
  await shot('44-settings-640');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('settings: Esc closes', (await page.locator('.settings-page').count()) === 0);

  // ---- 8 dial ------------------------------------------------------------
  await page.locator('.title-mode').click();
  await page.waitForSelector('.mode-menu', { timeout: 5000 });
  const lit = await page.evaluate(() =>
    [...document.querySelectorAll('.mode-menu button')]
      .map((b) => b.querySelectorAll('.dial-cell.on').length));
  check('dial: 5 cells, left-to-right fill',
    lit.length === 6 && lit.every((n, i) => i === 0 || n >= lit[i - 1]) &&
    Math.max(...lit) === 5 && Math.min(...lit) === 0,
    `lit=[${lit.join(',')}]`);
  const dialW = await page.evaluate(() =>
    document.querySelector('.titlebar .title-mode .dial')?.getBoundingClientRect().width ?? -1);
  check('E1: the titlebar mode dial is 23px', Math.round(dialW) === 23, `w=${dialW}`);
  const menuDialW = await page.evaluate(() => {
    const el = document.querySelector('.mode-menu .dial-md');
    return el ? el.getBoundingClientRect().width : -1;
  });
  check('E2: the menu uses the same dial at 28px', Math.round(menuDialW) === 28, `w=${menuDialW}`);
  const infiniteInMenu = await page.evaluate(() =>
    [...document.querySelectorAll('.mode-menu *')].filter((el) =>
      [...el.getAnimations()].some((a) => a.playState === 'running' && a.effect?.getTiming?.().iterations === Infinity)).length);
  check('E6: the mode menu holds no looping animation', infiniteInMenu === 0, `count=${infiniteInMenu}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  // ---- 6 open folder -----------------------------------------------------
  await switchTo('coding');
  const ioCalls = [];
  const onRequest = (r) => {
    if (r.url().includes('/api/io') && r.method() === 'POST') {
      try { ioCalls.push(JSON.parse(r.postData() || '{}')); } catch { /* ignore */ }
    }
  };
  page.on('request', onRequest);
  const picker = page.locator('.filetree .pane-head .icon-btn[aria-label="打开文件夹"]');
  if (await picker.count()) {
    await picker.click();
    await page.waitForTimeout(500);
    // Phase 4b: the editor section left a dirty buffer, so opening a folder first
    // raises the data-safety gate. Dismiss it (Don't Save) to continue the flow.
    if (await page.locator('.save-prompt').count()) {
      check('4b: opening a folder guards dirty buffers', true);
      await page.locator('.save-prompt-actions button:nth-child(2)').click();
      await page.waitForTimeout(700);
    }
    await page.waitForTimeout(300);
  }
  // --no-window has no native picker, so the folder button must fall back to the
  // paste dialog instead of silently "opening" the current root.
  check('D-2a: "open folder" falls back to the path dialog without a native picker',
    caps.pickFolder === false &&
    (await page.locator('.path-dialog').count()) === 1 &&
    !ioCalls.some((c) => c.op === 'fs.pickFolder'),
    `pickFolder=${caps.pickFolder} dialog=${await page.locator('.path-dialog').count()} ops=${ioCalls.map((c) => c.op).join(',')}`);
  check('F13: the path input is gone', (await page.locator('.path-input').count()) === 0);
  if ((await page.locator('.path-dialog').count()) === 1) {
    check('UX 6b: the paste fallback validates an empty path',
      (await page.locator('.path-dialog-input').getAttribute('aria-label')) === '文件夹路径');
    await page.locator('.path-dialog .primary-btn').click();
    await page.waitForTimeout(250);
    const err = await text('.path-dialog-error');
    check('UX 6b: an empty path shows an inline error', err.includes('请输入文件夹路径'), err);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  } else {
    skip('UX 6b: the paste fallback validates an empty path', 'the native picker answered, no dialog');
  }
  page.off('request', onRequest);

  // ---- 13 activity strip -------------------------------------------------
  const tabs = page.locator('.panel-tabs [role="tab"]');
  const tabCount = await tabs.count();
  let allButtons = true;
  for (let i = 0; i < tabCount; i++) {
    if ((await tabs.nth(i).evaluate((el) => el.tagName)) !== 'BUTTON') allButtons = false;
  }
  check('G3: the activity strip has three real tabs', tabCount === 3 && allButtons, `count=${tabCount}`);
  await tabs.nth(1).click();
  await page.waitForTimeout(300);
  check('activity strip: the output tab renders', (await page.locator('.output-panel').count()) === 1);
  await tabs.nth(2).click();
  await page.waitForTimeout(300);
  check('activity strip: the problems tab renders', (await page.locator('.problems-panel').count()) === 1);
  await tabs.nth(0).click();
  await page.waitForTimeout(250);

  // ---- 13c terminal instances -------------------------------------------
  if (caps.termInstance) {
    await page.locator('.term-tab-add').click();
    await page.waitForTimeout(500);
    check('D-3b: a second terminal instance exists', (await page.locator('.term-tab').count()) === 2,
      `count=${await page.locator('.term-tab').count()}`);
    const secondName = (await text('.term-tab.is-active')).trim();
    check('terminal: the second instance is named after its real shell',
      /^(pwsh|powershell|cmd)$/.test(secondName), secondName);
    // Focus must follow the tab: typing right after `+` reaches the new shell.
    const activeRows = page.locator('.term-views .term-host:not([style*="display"]) .xterm-rows');
    await page.keyboard.type('echo FOCUS_ADD', { delay: 12 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    check('terminal: a new tab is typeable without clicking it',
      (await activeRows.innerText()).includes('FOCUS_ADD'));
    // Same after switching back with a tab click.
    await page.locator('.term-tab-name').first().click();
    await page.waitForTimeout(250);
    await page.keyboard.type('echo FOCUS_SWITCH', { delay: 12 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    check('terminal: switching tabs keeps typing in the active shell',
      (await activeRows.innerText()).includes('FOCUS_SWITCH'));
    // The arrow beside `+` must launch a tab with a chosen shell, and its menu
    // must stay inside the window.
    await page.locator('.term-tab-more').click();
    await page.waitForTimeout(250);
    const choices = page.locator('[data-pop="term-shell-menu"] [role="menuitem"]');
    const choiceCount = await choices.count();
    const choiceBox = await page.locator('[data-pop="term-shell-menu"]').boundingBox();
    const viewport = page.viewportSize();
    await choices.nth(3).click(); // cmd is the last entry
    await page.waitForTimeout(900);
    const chosenName = (await text('.term-tab.is-active')).trim();
    check('terminal: the arrow launches a tab with the chosen shell',
      choiceCount === 4 && !!choiceBox && choiceBox.x >= 0 && choiceBox.x + choiceBox.width <= viewport.width
        && (await page.locator('.term-tab').count()) === 3 && chosenName === 'cmd',
      `choices=${choiceCount} x=${choiceBox && Math.round(choiceBox.x)} tab="${chosenName}"`);
    await page.locator('.term-tab.is-active .tab-x').click();
    await page.waitForTimeout(400);
    await page.locator('.term-tab.is-active .tab-x').click();
    await page.waitForTimeout(400);
    check('terminal: closing a tab removes its host',
      (await page.locator('.term-tab').count()) === 1);
    // The PTY has to follow the pane: xterm only changes cols through fit(),
    // so a window/pane resize must reach term.resize with a new width.
    if ((await page.locator('.session-panel').count()) === 1) {
      await page.locator('.session-switcher-btn').click();
      await page.waitForTimeout(300);
    }
    const resizeOps = [];
    const onTermResize = (r) => {
      if (!r.url().includes('/api/io')) return;
      try {
        const body = JSON.parse(r.postData() || '{}');
        if (body.op === 'term.resize') resizeOps.push(body);
      } catch { /* ignore */ }
    };
    page.on('request', onTermResize);
    await page.setViewportSize({ width: 1024, height: 683 });
    await page.waitForTimeout(500);
    const narrowCols = resizeOps.length ? resizeOps[resizeOps.length - 1].cols : 0;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(600);
    page.off('request', onTermResize);
    const wideCols = resizeOps.length ? resizeOps[resizeOps.length - 1].cols : 0;
    check('terminal: the PTY follows the pane width',
      wideCols >= 80 && wideCols > narrowCols,
      `narrow=${narrowCols} wide=${wideCols}`);
  } else {
    skip('terminal: multiple instances', 'the shell exposes no instance channel');
    check('D-3b: a single terminal instance when unsupported',
      (await page.locator('.term-tab').count()) === 1,
      `count=${await page.locator('.term-tab').count()}`);
    check('D-3b: no "new instance" button when unsupported',
      (await page.locator('.term-tab-add').count()) === 0);
  }

  // ---- 4 usage -----------------------------------------------------------
  // The round ran in the first session; the goal tests opened a second one.
  // Usage is per session, so read the vitals from the session that owns them.
  const usageTabCount = Number(await page.locator('.session-switcher-btn').getAttribute('data-count') ?? '1');
  if (usageTabCount > 1) {
    if ((await page.locator('.session-panel').count()) === 0) {
      await page.locator('.session-switcher-btn').click();
      await page.waitForTimeout(250);
    }
    await page.locator('.session-card').first().click();
    await page.waitForTimeout(650);
  }
  const usageSeen = await page.evaluate(() => !!window.__pristemUsageSeen);
  if (usageSeen) {
    const vitals = await text('.ai-vitals');
    check('G14: the vitals row shows in / out / cached / calls / elapsed',
      /in /.test(vitals) && /out /.test(vitals) && /cached /.test(vitals) &&
      /calls/.test(vitals) && /s$/.test(vitals.trim()), vitals.replace(/\n/g, ' '));
  } else {
    check('D-4b: the vitals row is absent without a usage event',
      (await page.locator('.ai-vitals').count()) === 0);
  }
  if (usageTabCount > 1) {
    await page.locator('.session-card').last().click();
    await page.waitForTimeout(650);
  }

  // ---- 17 confirm --------------------------------------------------------
  check('H-7: the confirmation has a single surface', (await page.locator('.confirm-toast').count()) === 0);
  check('H-7: at most one inline confirmation card', (await page.locator('.line-buttons').count()) <= 1);

  // ---- 11 keyboard -------------------------------------------------------
  await page.keyboard.press('Control+Shift+P');
  await page.waitForSelector('.palette', { timeout: 4000 }).catch(() => {});
  const paletteButtons = await page.locator('.palette-list button').count();
  check('UX 2.3: the command palette lists the command table', paletteButtons >= 20,
    `count=${paletteButtons}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  // ---- goal again (the palette may have changed the mode) ----------------
  if (!(await modeClass()).includes('mode-goal')) {
    await switchTo('goal');
    check('goal: NO codebase surfaces (re-check)',
      (await page.locator('.filetree').count()) === 0 &&
      (await page.locator('.monaco-host').count()) === 0 &&
      (await page.locator('.term-host').count()) === 0);
  }

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  // ---- editor extras: Ctrl+Tab cycling + tab overflow dropdown -----------
  await switchTo('coding');
  await page.waitForSelector('.filetree', { timeout: 8000 });
  const activeName = () => page.locator('.editor-tab.is-active > span').first().innerText();
  const openNthFile = async (i) => {
    await page.locator('.tree-item:not(.is-dir)').nth(i).click();
    await page.waitForTimeout(450);
  };
  if ((await page.locator('.editor-tab').count()) < 2) await openNthFile(1);
  await page.locator('.monaco-editor').first().click();
  const tabA = await activeName();
  await page.keyboard.press('Control+Tab');
  await page.waitForTimeout(350);
  const tabB = await activeName();
  check('editor: Ctrl+Tab moves to the next tab', tabA !== tabB, `${tabA} -> ${tabB}`);
  await page.keyboard.press('Control+Shift+Tab');
  await page.waitForTimeout(350);
  check('editor: Ctrl+Shift+Tab returns to the previous tab', (await activeName()) === tabA);

  const fileCount = await page.locator('.tree-item:not(.is-dir)').count();
  for (let i = 2; i < fileCount; i += 1) await openNthFile(i);
  // The session panel is a column; close it so the editor keeps its width at 900px.
  if ((await page.locator('.session-panel').count()) === 1) {
    await page.locator('.session-switcher-btn').click();
    await page.waitForTimeout(250);
  }
  await page.setViewportSize({ width: 900, height: 820 });
  await page.waitForTimeout(500);
  check('editor: many tabs expose the overflow dropdown',
    (await page.locator('.tabs-overflow-btn').count()) === 1,
    `tabs=${await page.locator('.editor-tab').count()}`);
  await page.locator('.tabs-overflow-btn').click();
  await page.waitForTimeout(250);
  check('editor: the overflow dropdown lists every open tab',
    (await page.locator('.tab-overflow-pop .tab-overflow-item').count()) ===
      (await page.locator('.editor-tab').count()));
  await page.locator('.tab-overflow-pop .tab-overflow-item').first().click();
  await page.waitForTimeout(250);
  check('editor: picking from the overflow dropdown closes it',
    (await page.locator('.tab-overflow-pop').count()) === 0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);

  // ---- tabs: Open Editors, reopen, drag order, zoom ------------------------
  const tabNames = await page.locator('.editor-tab > span:not(.tab-close)').allTextContents();
  const editorRows = await page.locator('.open-editor-row').count();
  check('explorer: Open Editors lists every open tab', editorRows === tabNames.length,
    `rows=${editorRows} tabs=${tabNames.length}`);

  const beforeCount = await page.locator('.editor-tab').count();
  const closingName = await activeName();
  await page.keyboard.press('Control+W');
  await page.waitForTimeout(400);
  // An earlier interaction may have marked the tab dirty; closing then asks.
  if (await page.locator('.save-prompt').count()) {
    await page.locator('.save-prompt-actions .secondary-btn').nth(1).click();
    await page.waitForTimeout(400);
  }
  const afterClose = await page.locator('.editor-tab').count();
  await page.keyboard.press('Control+Shift+T');
  await page.waitForTimeout(700);
  const afterReopen = await page.locator('.editor-tab').count();
  check('editor: Ctrl+Shift+T reopens the closed editor',
    afterClose === beforeCount - 1 && afterReopen === beforeCount && (await activeName()) === closingName,
    `${closingName}: ${beforeCount} -> ${afterClose} -> ${afterReopen}`);

  const order0 = await page.locator('.editor-tab > span:not(.tab-close)').allTextContents();
  if (order0.length >= 2) {
    await page.locator('.editor-tab').nth(0).dragTo(page.locator('.editor-tab').nth(1));
    await page.waitForTimeout(450);
    const order1 = await page.locator('.editor-tab > span:not(.tab-close)').allTextContents();
    check('editor: tabs can be reordered by dragging',
      order1[0] === order0[1] && order1[1] === order0[0],
      `${order0.slice(0, 2)} -> ${order1.slice(0, 2)}`);
  }

  // The settings suite leaves the font at 32; reset, then prove one zoom step.
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(250);
  await page.keyboard.press('Control+=');
  await page.waitForTimeout(300);
  const zoomAfter = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('pristem.local') || '{}').editorFontSize);
  check('editor: Ctrl+= zooms the editor text', zoomAfter === 14, String(zoomAfter));
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(250);
  const zoomReset = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('pristem.local') || '{}').editorFontSize);
  check('editor: Ctrl+0 resets the editor zoom', zoomReset === 13, String(zoomReset));

  // ---- format on save: toggle in Settings, then save a messy JS file ------
  const io = (body) => page.evaluate(async (b) => {
    const r = await fetch('/api/io', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(b),
    });
    try { return await r.json(); } catch { return {}; }
  }, body);
  await io({ op: 'fs.mkdir', path: '__p5__' });
  await io({ op: 'fs.write', path: '__p5__/messy.js', content: 'const x={a:1,b:2}\nfunction f(){return x}\n' });
  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settings-editor', { timeout: 8000 });
  const formatSwitch = page.locator('#settings-editor .settings-switch').nth(1);
  await formatSwitch.scrollIntoViewIfNeeded();
  await formatSwitch.click();
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+p');
  await page.waitForSelector('.palette-head input', { timeout: 5000 });
  await page.locator('.palette-head input').fill('messy.js');
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.monaco-editor', { timeout: 8000 });
  await page.waitForTimeout(900);
  await page.locator('.monaco-editor').first().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' ');
  await page.waitForTimeout(250);
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(1600);
  const formatted = await io({ op: 'fs.read', path: '__p5__/messy.js' });
  check('editor: format on save reformats the document',
    typeof formatted.content === 'string' && formatted.content.includes('const x = { a: 1'),
    JSON.stringify(formatted.content || '').slice(0, 90));
  // Leave the preference as it was and clean up the fixture.
  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settings-editor', { timeout: 8000 });
  await page.locator('#settings-editor .settings-switch').nth(1).click();
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await io({ op: 'fs.delete', path: '__p5__/messy.js' });
  await io({ op: 'fs.delete', path: '__p5__' });

  // Close the extra sessions through the panel's own buttons — a kernel
  // close_session is not a user path. Keep one: closing the last opens a
  // replacement, and every suite runs against a fresh service.
  await switchTo('coding');
  if ((await page.locator('.session-panel').count()) === 0) {
    await page.locator('.session-switcher-btn').click();
    await page.waitForTimeout(200);
  }
  for (let guard = 0; guard < 8; guard += 1) {
    if ((await page.locator('.session-card').count()) <= 1) break;
    await page.locator('.session-card .session-card-close').first().click();
    await page.waitForTimeout(300);
  }

  // Controlled SSE envelopes cover the wake states the real briefing may not produce.
  for (const variant of [
    { name: 'empty', lines: [] },
    { name: 'overflow', lines: ['one', 'two', 'three', 'four', 'five', 'six', 'seven'] },
  ]) {
    const wake = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await wake.route('**/api/ping', (route) => route.fulfill({ json: {} }));
    await wake.route('**/api/io', (route) => route.fulfill({
      json: { files: [], root: '', capabilities: {} },
    }));
    await wake.route('**/api/request', (route) => route.fulfill({ json: {} }));
    const envelopes = [
      { channel: 'kernel', payload: { type: 'mode_changed', from: 'coding', to: 'deepsleep' } },
      { channel: 'kernel', payload: { type: 'reminder', lines: variant.lines } },
    ];
    await wake.route('**/api/events', (route) => route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
      body: envelopes.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''),
    }));
    await wake.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await wake.waitForSelector('.wake-card', { timeout: 10000 });
    if (variant.name === 'empty') {
      check('deepsleep: an empty briefing has an explicit empty state and no resume action',
        (await wake.locator('.wake-empty').count()) === 1 &&
        (await wake.locator('.wake-card li').count()) === 0 &&
        (await wake.locator('.wake-card .primary-btn').count()) === 0 &&
        (await wake.locator('.wake-card-back').count()) === 1);
    } else {
      check('deepsleep: an overflow briefing shows five rules and the remainder',
        (await wake.locator('.wake-card li').count()) === 5 &&
        (await wake.locator('.wake-more').innerText()).includes('2') &&
        (await wake.locator('.wake-card .primary-btn').count()) === 1);
    }
    await wake.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} visual checks passed`);
  console.log(`screenshots: ${OUT}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
