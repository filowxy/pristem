/**
 * Capability contract for system-WebView rendering.
 *
 * Pristem ships a tao/wry window, so it renders with whatever engine the OS
 * provides: WebView2 (Chromium, Evergreen but can be as old as 86 on LTSC /
 * Server / policy-rolled-back machines), WKWebView (WebKit pinned to the macOS
 * version, never independently updated), or WebKitGTK (distro-dependent).
 * Bundling Chromium is what makes Electron predictable; we deliberately do not
 * do that, so instead of assuming a version we detect capabilities once,
 * publish them on <html data-cap-*>, and let CSS/TS share the same verdict.
 *
 * L0 (every supported engine) must be fully usable: readable, interactive,
 * no transparent surfaces, no modal click-through, no uncaught errors.
 * L1/L2 add refinement only, and every enhancement has a literal fallback.
 */

export interface Caps {
  colorMix: boolean;
  cornerShape: boolean;
  cssNesting: boolean;
  hasSelector: boolean;
  registeredProps: boolean;
  backdropFilter: boolean;
  inert: boolean;
  scrollbarGutter: boolean;
  textWrapBalance: boolean;
  maskImage: boolean;
  /** Rollup used by the QA matrix and by the specimen page. */
  level: 'l0' | 'l1' | 'l2';
}

const supportsProp = (name: string, value: string): boolean => {
  try {
    return typeof CSS !== 'undefined'
      && typeof CSS.supports === 'function'
      && CSS.supports(name, value);
  } catch { return false; }
};

const supportsSelector = (sel: string): boolean => {
  try {
    return typeof CSS !== 'undefined'
      && typeof CSS.supports === 'function'
      && CSS.supports('selector(' + sel + ')');
  } catch { return false; }
};

let current: Caps | null = null;

export function detectCaps(): Caps {
  const colorMix = supportsProp('color', 'color-mix(in srgb, red, blue)');
  const cornerShape = supportsProp('corner-shape', 'squircle');
  // Feature-detect behaviour, not just presence: a property can exist in the
  // prototype yet be a no-op on locked-down or partially implemented engines.
  const inert = (() => {
    try {
      const probe = document.createElement('div');
      probe.inert = true;
      return probe.inert === true;
    } catch { return false; }
  })();
  const level: Caps['level'] = cornerShape && colorMix && inert
    ? 'l2'
    : colorMix && inert ? 'l1' : 'l0';
  return {
    colorMix,
    cornerShape,
    cssNesting: supportsSelector('& .x'),
    hasSelector: supportsSelector(':has(*)'),
    registeredProps: typeof CSS !== 'undefined' && 'registerProperty' in CSS,
    backdropFilter: supportsProp('backdrop-filter', 'blur(1px)')
      || supportsProp('-webkit-backdrop-filter', 'blur(1px)'),
    inert,
    scrollbarGutter: supportsProp('scrollbar-gutter', 'stable'),
    textWrapBalance: supportsProp('text-wrap', 'balance'),
    maskImage: supportsProp('mask-image', 'linear-gradient(#000,#000)')
      || supportsProp('-webkit-mask-image', 'linear-gradient(#000,#000)'),
    level,
  };
}

export function caps(): Caps {
  if (!current) current = detectCaps();
  return current;
}

/** Publish one verdict for CSS and TS, so they can never disagree. */
export function applyCapFlags(): Caps {
  const c = caps();
  const root = document.documentElement;
  root.dataset.capLevel = c.level;
  root.dataset.capColorMix = String(c.colorMix);
  root.dataset.capCornerShape = String(c.cornerShape);
  root.dataset.capNesting = String(c.cssNesting);
  root.dataset.capHas = String(c.hasSelector);
  root.dataset.capRegisteredProps = String(c.registeredProps);
  root.dataset.capBackdrop = String(c.backdropFilter);
  root.dataset.capInert = String(c.inert);
  root.dataset.capScrollbarGutter = String(c.scrollbarGutter);
  root.dataset.capTextWrap = String(c.textWrapBalance);
  root.dataset.capMask = String(c.maskImage);
  return c;
}

/**
 * `inert` is Chrome 102+ / Safari 15.5+. On older engines the attribute is
 * simply ignored, which lets a modal overlay leak pointer AND keyboard focus
 * into the workbench. CSS blocks pointer events; this covers keyboard focus.
 * No-op when the attribute is natively honoured.
 */
export function installInertFallback(): void {
  if (caps().inert) return;
  const originals = new WeakMap<HTMLElement, string | null>();
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]';

  const sync = (host: HTMLElement) => {
    const active = host.hasAttribute('inert');
    host.querySelectorAll<HTMLElement>(FOCUSABLE).forEach((node) => {
      if (active) {
        if (!originals.has(node)) originals.set(node, node.getAttribute('tabindex'));
        node.setAttribute('tabindex', '-1');
        node.setAttribute('aria-hidden', 'true');
      } else if (originals.has(node)) {
        const previous = originals.get(node);
        if (previous === null) node.removeAttribute('tabindex');
        else node.setAttribute('tabindex', previous as string);
        node.removeAttribute('aria-hidden');
        originals.delete(node);
      }
    });
  };

  const watch = () => document.querySelectorAll<HTMLElement>('.workbench').forEach(sync);
  const observer = new MutationObserver(watch);
  observer.observe(document.documentElement, {
    attributes: true, childList: true, subtree: true, attributeFilter: ['inert'],
  });
  watch();
}
