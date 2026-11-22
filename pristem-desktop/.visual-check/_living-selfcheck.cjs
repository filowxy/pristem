const { chromium } = require('playwright-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:8787/';

const out = [];
const log = (k, v) => { out.push([k, v]); console.log(`${k}: ${v}`); };

(async () => {
  const browser = await chromium.launch({
    executablePath: EDGE, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-shell');
  await page.waitForTimeout(2200);
  await page.locator('.tree-item:not(:disabled)').first().click();
  await page.waitForTimeout(900);

  const switchTo = async (i, name) => {
    await page.locator('.title-mode').click();
    await page.locator('.mode-menu button').nth(i).click();
    await page.waitForFunction((m) => document.querySelector('.app-shell')?.className.includes('mode-' + m), name.toLowerCase(), { timeout: 12000 });
    await page.waitForTimeout(700);
  };
  const probe = () => page.evaluate(() => {
    const shell = document.querySelector('.app-shell');
    const core = document.querySelector('.living-core');
    const cs = getComputedStyle(shell);
    return {
      mode: shell.className.match(/mode-([a-z]+)/)?.[1],
      rate: cs.getPropertyValue('--living-rate').trim(),
      presence: cs.getPropertyValue('--presence').trim(),
      afterOpacity: getComputedStyle(shell, '::after').opacity,
      core: !!core,
      coreAnims: core ? core.getAnimations().length : 0,
      coreTransform: core ? getComputedStyle(core).transform : 'none',
      shellAnims: shell.getAnimations().length,
      phase: cs.getPropertyValue('--phase').trim(),
      phasePlay: shell.getAnimations()
        .filter((a) => a.animationName === 'prism-phase')
        .map((a) => a.playState).join(',') || 'none',
      ai: document.querySelectorAll('[data-ai="true"]').length,
    };
  });

  // ① coding
  const coding = await probe();
  log('① coding living-core present', coding.core);
  log('① coding core.getAnimations()>0', coding.coreAnims > 0, );
  log('① coding computed transform !== none', coding.coreTransform !== 'none');
  log('① coding --living-rate', coding.rate);
  log('① coding shell.getAnimations()', coding.shellAnims);
  log('① coding prism phase / play-state', `${coding.phase} / ${coding.phasePlay}`);

  // ④ mode-menu spectrum opacity over 2s
  await page.locator('.title-mode').click();
  const m0 = await page.evaluate(() => getComputedStyle(document.querySelector('.mode-menu'), '::before').opacity);
  await page.waitForTimeout(2100);
  const m1 = await page.evaluate(() => getComputedStyle(document.querySelector('.mode-menu'), '::before').opacity);
  log('④ mode-menu ::before opacity t0 / t+2s', `${m0} / ${m1} (constant=${m0 === m1})`);
  await page.keyboard.press('Escape');

  // ② IDE
  await switchTo(1, 'IDE');
  const ide = await probe();
  log('② IDE core=null / ai=0 / shellAnims=0 / rate', `${!ide.core} / ${ide.ai} / ${ide.shellAnims} / ${ide.rate}`);
  log('② IDE prism clock paused', ide.phasePlay);

  // ④ summon spectrum opacity over 2s (real @ flow)
  await page.locator('.monaco-editor').first().click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await page.keyboard.type('@', { delay: 50 });
  await page.waitForSelector('.summon', { timeout: 3000 }).catch(() => {});
  const s0 = await page.evaluate(() => getComputedStyle(document.querySelector('.summon'), '::before').opacity);
  await page.waitForTimeout(2100);
  const s1 = await page.evaluate(() => getComputedStyle(document.querySelector('.summon'), '::before').opacity);
  log('④ summon ::before opacity t0 / t+2s', `${s0} / ${s1} (constant=${s0 === s1})`);
  await page.keyboard.press('Escape');

  // ② deepsleep (via coding -> confirmation)
  await switchTo(0, 'coding');
  await page.locator('.title-mode').click();
  await page.locator('.mode-menu button').nth(4).click();
  await page.waitForSelector('.line-buttons .mini-btn', { timeout: 8000 });
  await page.locator('.line-buttons .mini-btn').filter({ hasText: 'deepsleep' }).first().click();
  await page.waitForFunction(() => document.querySelector('.app-shell')?.className.includes('mode-deepsleep'), null, { timeout: 10000 });
  await page.waitForTimeout(800);
  const sleep = await probe();
  log('② deepsleep core=null / ai=0 / shellAnims=0 / rate', `${!sleep.core} / ${sleep.ai} / ${sleep.shellAnims} / ${sleep.rate}`);
  log('② deepsleep prism clock paused', sleep.phasePlay);

  // ③ goal
  await switchTo(5, 'goal');
  const goal = await probe();
  const borders = await page.evaluate(() => {
    const root = document.querySelector('.goal-inner');
    if (!root) return -1;
    let n = 0;
    root.querySelectorAll('*').forEach((el) => {
      const s = getComputedStyle(el);
      ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].forEach((k) => {
        if (s[k] === '1px') n++;
      });
    });
    return n;
  });
  log('③ goal ::after opacity / no core / 1px borders', `${goal.afterOpacity} / ${!goal.core} / ${borders}`);
  await page.waitForTimeout(1600);
  const goal2 = await probe();
  log('③ goal ::after opacity after 1.6s (constant)', `${goal2.afterOpacity} (constant=${goal.afterOpacity === goal2.afterOpacity})`);
  log('③ goal --living-rate / presence', `${goal.rate} / ${goal.presence}`);

  // Goal under LIVE kernel events: opacity must stay .90 and no gain/hue writes.
  await page.locator('.goal-input textarea').fill('make the presence dial honest');
  await page.keyboard.press('Enter');
  const samples = [];
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(400);
    samples.push(await page.evaluate(() => {
      const shell = document.querySelector('.app-shell');
      return {
        op: getComputedStyle(shell, '::after').opacity,
        gain: getComputedStyle(shell).getPropertyValue('--living-gain').trim(),
        hue: getComputedStyle(shell).getPropertyValue('--living-hue').trim(),
        a11y: document.querySelector('.sr-only[role="status"]')?.textContent ?? '',
      };
    }));
  }
  log('③ goal live-event opacity samples', samples.map((s) => s.op).join(','));
  log('③ goal live-event constant .9', samples.every((s) => s.op === '0.9'));
  log('③ goal gain never written above 0', samples.every((s) => Number(s.gain) === 0));
  log('③ goal hue stays 0deg', samples.every((s) => !s.hue || s.hue === '0deg'));
  log('a11y status text (last sample)', JSON.stringify(samples[samples.length - 1].a11y));

  // Coding: a real round must drive --living-gain / --living-hue, then decay.
  await switchTo(0, 'coding');
  await page.locator('.composer-box textarea').fill('check the presence signal');
  await page.keyboard.press('Enter');
  const gains = [];
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(350);
    gains.push(await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('.app-shell'));
      return `${s.getPropertyValue('--living-gain').trim()}/${s.getPropertyValue('--living-hue').trim()}`;
    }));
  }
  log('coding gain/hue over 3.5s', gains.join(' '));
  log('coding accent filter (the LIVING hue reaches the pixels)',
    await page.evaluate(() => getComputedStyle(document.querySelector('.app-shell'), '::after').filter));
  log('coding signal fired then decayed', gains.some((g) => Number(g.split('/')[0]) > 0) && Number(gains[gains.length - 1].split('/')[0]) === 0);
  log('coding core opacity', await page.evaluate(() => getComputedStyle(document.querySelector('.app-shell')).getPropertyValue('--living-opacity').trim()));

  // CSS-only sweep of all six mode token sets (no kernel round-trips).
  const sweep = await page.evaluate(() => {
    const shell = document.querySelector('.app-shell');
    const original = shell.className;
    const rows = [];
    for (const m of ['ide', 'deepsleep', 'helping', 'advisor', 'coding', 'goal']) {
      shell.className = original.replace(/mode-[a-z]+/, 'mode-' + m);
      const cs = getComputedStyle(shell);
      rows.push(`${m}: presence=${cs.getPropertyValue('--presence').trim()} rate=${cs.getPropertyValue('--living-rate').trim()} size=${cs.getPropertyValue('--living-size').trim()} opacity=${getComputedStyle(shell, '::after').opacity}`);
    }
    shell.className = original;
    return rows;
  });
  sweep.forEach((r) => log('mode token sweep', r));

  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
