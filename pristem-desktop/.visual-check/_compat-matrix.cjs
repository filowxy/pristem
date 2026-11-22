/* Capability matrix: prove the UI is usable on old / mid / new system WebViews.
 *
 * We cannot ship a browser (no Electron), so we cannot guarantee pixel parity.
 * We CAN guarantee the L0 contract: readable, interactive, no transparent
 * surfaces, no modal click-through, no uncaught errors. This harness simulates
 * how an old engine actually behaves — it strips every declaration whose value
 * contains a feature the engine cannot parse, exactly like CSS error recovery
 * does — then asserts the L0 contract on three capability levels.
 *
 *   L0  old WebView2 / older WKWebView / WebKitGTK : no color-mix, no
 *       corner-shape, no :has(), no native inert
 *   L1  modern WebKit / mid WebView2               : color-mix + inert, no
 *       corner-shape, no :has()
 *   L2  current WebView2 (Chromium 139+)           : everything native
 *
 * Run against a serving instance: node _compat-matrix.cjs
 */
const { chromium } = require('playwright-core');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const APP = 'http://127.0.0.1:8787/';
const OUT = 'D:/projects/pristem/pristem-desktop/.screenshots';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (level, name, ok, detail = '') => {
  results.push({ level, name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${level}] ${name}${detail ? ' — ' + detail : ''}`);
};

/** Strip declarations/rules the simulated engine could not parse. */
const STRIP_JS = (level) => {
  const stripColorMix = level === 'l0';
  const stripCornerShape = level !== 'l2';
  const stripHas = level !== 'l2';
  let removed = 0;

  const walk = (list) => {
    for (const rule of Array.from(list)) {
      // NB: CSSStyleRule also exposes cssRules (for CSS nesting) in Chromium,
      // so recurse for grouping rules but STILL process this rule's style.
      if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules);
      if (rule.type === 1 && rule.style) {
        if (stripHas && /:has\(/.test(rule.selectorText || '')) {
          while (rule.style.length) rule.style.removeProperty(rule.style[0]);
          removed++;
        }
        for (let j = rule.style.length - 1; j >= 0; j--) {
          const prop = rule.style[j];
          const value = rule.style.getPropertyValue(prop);
          const unsupported = (stripColorMix && value.includes('color-mix('))
            || (stripCornerShape && prop === 'corner-shape');
          if (unsupported) { rule.style.removeProperty(prop); removed++; }
        }
      }
    }
  };

  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    if (!rules) continue;
    for (let i = rules.length - 1; i >= 0; i--) {
      const r = rules[i];
      if (r.type === 1 && r.style && r.selectorText && r.selectorText.includes('@property')) {
        sheet.deleteRule(i); removed++;
      }
    }
    walk(rules);
  }
  return removed;
};

/** Ratio of two rgb/rgba strings, falling back to 0 for transparent. */
const CONTRAST_JS = (fg, bg) => {
  const parse = (c) => {
    const m = (c || '').match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c) => {
    const v = [c.r, c.g, c.b].map((x) => {
      const s = x / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const f = parse(fg), b = parse(bg);
  if (!f || !b || b.a < 0.5) return 0;
  const l1 = lum(f), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

(async () => {
  const browser = await chromium.launch({
    executablePath: EDGE, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  for (const level of ['l0', 'l1', 'l2']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.addInitScript((lvl) => {
      // Make capability detection report the simulated engine honestly.
      const native = CSS.supports.bind(CSS);
      CSS.supports = function (a, b) {
        const prop = String(a || '');
        const val = String(b || '');
        if (lvl === 'l0') {
          if (val.includes('color-mix') && prop === 'color') return false;
          if (prop === 'corner-shape') return false;
          if (prop === 'selector(:has(*))') return false;
        } else if (lvl === 'l1') {
          if (prop === 'corner-shape') return false;
          if (prop === 'selector(:has(*))') return false;
        }
        return native(a, b);
      };
      if (lvl === 'l0') {
        try { delete HTMLElement.prototype.inert; } catch { /* getter only */ }
        try {
          Object.defineProperty(HTMLElement.prototype, 'inert', {
            configurable: true, get() { return undefined; },
          });
        } catch { /* already absent */ }
      }
    }, level);

    await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.app-shell', { timeout: 20000 });
    await page.waitForTimeout(1500);

    const removed = await page.evaluate(STRIP_JS, level);
    await page.waitForTimeout(250);

    // Exercise modal isolation the way overlayStack.ts does, then let the
    // MutationObserver-based L0 fallback settle before reading focus state.
    await page.evaluate(() => {
      const wb = document.querySelector('.workbench');
      if (wb) wb.setAttribute('inert', '');
    });
    await page.waitForTimeout(120);
    const inertState = await page.evaluate(() => {
      const wb = document.querySelector('.workbench');
      const f = wb ? wb.querySelector('button, input, [tabindex]') : null;
      return {
        pointer: wb ? getComputedStyle(wb).pointerEvents : 'missing',
        tabindex: f ? f.getAttribute('tabindex') : null,
      };
    });
    await page.evaluate(() => {
      const wb = document.querySelector('.workbench');
      if (wb) wb.removeAttribute('inert');
    });

    const probe = await page.evaluate((contrastSrc) => {
      const contrast = new Function('return ' + contrastSrc)();
      const root = document.documentElement;
      const cs = getComputedStyle(root);
      const make = (cls, tag) => {
        const e = document.createElement(tag || 'div');
        e.className = cls;
        document.body.appendChild(e);
        const s = getComputedStyle(e);
        const v = { bg: s.backgroundColor, color: s.color, radius: s.borderRadius, shape: s.getPropertyValue('corner-shape').trim() };
        e.remove();
        return v;
      };
      const activeTab = make('tree-item is-active');
      const primary = make('primary-btn', 'button');
      const badge = make('empty-icon');
      const glass = make('wake-card');
      const title = getComputedStyle(document.querySelector('.titlebar'));
      const status = getComputedStyle(document.querySelector('.statusbar'));

      return {
        level: root.dataset.capLevel,
        colorMix: root.dataset.capColorMix,
        cornerShape: root.dataset.capCornerShape,
        inert: root.dataset.capInert,
        glassFill: cs.getPropertyValue('--glass-fill').trim(),
        activeTab, primary, badge, glass,
        titleBg: title.backgroundColor, statusBg: status.backgroundColor,
        inertPointer, inertTabIndex,
        titleContrast: contrast(title.color, title.backgroundColor),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        appShell: !!document.querySelector('.app-shell'),
        titlebarHeight: document.querySelector('.titlebar').getBoundingClientRect().height,
      };
    }, CONTRAST_JS.toString());

    const opaque = (v) => v && v !== 'rgba(0, 0, 0, 0)' && v !== 'transparent';
    check(level, 'capability flags match simulated engine', probe.level === level,
      `level=${probe.level} colorMix=${probe.colorMix} cornerShape=${probe.cornerShape} inert=${probe.inert}`);
    check(level, 'no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    check(level, 'app shell + titlebar render', probe.appShell && Math.round(probe.titlebarHeight) === 36,
      `h=${probe.titlebarHeight}`);
    check(level, 'no horizontal overflow', probe.overflow <= 1, `delta=${probe.overflow}`);
    check(level, 'chrome surfaces are opaque', opaque(probe.titleBg) && opaque(probe.statusBg),
      `${probe.titleBg} / ${probe.statusBg}`);
    check(level, 'active tree row has a visible background', opaque(probe.activeTab.bg), probe.activeTab.bg);
    check(level, 'primary button has a visible background', opaque(probe.primary.bg), probe.primary.bg);
    check(level, 'empty-state tile has a visible background', opaque(probe.badge.bg), probe.badge.bg);
    check(level, 'glass card has a visible background', opaque(probe.glass.bg), probe.glass.bg);
    check(level, 'titlebar text meets WCAG AA', probe.titleContrast >= 4.5,
      `${probe.titleContrast.toFixed(2)}:1`);
    check(level, 'modal blocks pointer events', probe.inertPointer === 'none', probe.inertPointer);
    if (level === 'l0') {
      check(level, 'modal blocks keyboard focus (fallback)', probe.inertTabIndex === '-1',
        `tabindex=${probe.inertTabIndex}`);
    }
    check(level, 'corners still round without corner-shape', parseFloat(probe.badge.radius) > 0,
      `radius=${probe.badge.radius} shape=${probe.badge.shape || 'unset'}`);

    // Primary interaction must still work on every level.
    const search = page.locator('.search-capsule input').first();
    if (await search.count()) {
      await search.fill('matrix-probe');
      const v = await search.inputValue();
      check(level, 'primary input still works', v === 'matrix-probe', v);
      await search.fill('');
    }

    await page.screenshot({ path: `${OUT}/40-compat-${level}.png` });
    console.log(`      [${level}] stripped ${removed} unsupported declarations`);
    await page.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} capability-matrix checks passed`);
  if (failed.length) {
    console.log('FAILED: ' + failed.map((f) => `[${f.level}] ${f.name}`).join(', '));
    process.exitCode = 1;
  }
})().catch((e) => { console.error('MATRIX_FATAL', e); process.exit(1); });
