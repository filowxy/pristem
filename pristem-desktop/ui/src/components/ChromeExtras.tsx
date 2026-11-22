import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ChevronRight, Check, X } from 'lucide-react';
import { BrandMark } from './BrandMark';
import { SemanticIcon } from './SemanticIcon';
import { LivingCore } from './LivingCore';
import { PresenceDial } from './PresenceDial';
import { EmptyState } from './EmptyState';
import { t, getLang, setLang } from '../i18n';
import { ALL_MODES, PRESENCE, type Mode } from '../types';
import { useDismissable } from './overlayStack';

type WindowOp = 'window.minimize' | 'window.maximize' | 'window.close';

/** The mode menu's async state; the titlebar owns the only switcher. */
export interface ModeMenuState {
  phase: 'idle' | 'pending' | 'confirming' | 'failed';
  target: Mode | null;
  errorTitle?: string;
  errorDesc?: string;
  recover?: boolean;
}

export interface TitleBarProps {
  mode: Mode;
  modeMenuOpen: boolean;
  onToggleModeMenu: () => void;
  modeState: ModeMenuState;
  onSwitchMode: (m: Mode) => void;
  onRetrySwitch: () => void;
  onRecover: () => void;
  root: string;
  search: string;
  onSearch: (v: string) => void;
  onWindow: (op: WindowOp) => void;
  onDrag: () => void;
  onPalette: (mode: 'command' | 'file') => void;
  haloRef: React.RefObject<HTMLSpanElement | null>;
  sessionSwitcher?: ReactNode;
  /** Menu bar fed by the same command table as the palette; visible in every mode. */
  menubar?: ReactNode;
}

export function TitleBar({
  mode, modeMenuOpen, onToggleModeMenu, modeState, onSwitchMode, onRetrySwitch, onRecover,
  root, search, onSearch, onWindow, onDrag, onPalette, haloRef, sessionSwitcher, menubar,
}: TitleBarProps) {
  const pending = modeState.phase === 'pending' || modeState.phase === 'confirming';
  const shortRoot = root.split(/[\\/]/).filter(Boolean).pop() ?? 'workspace';
  const stop = (e: ReactMouseEvent) => e.stopPropagation();
  // Windows chrome, the Windows way: the native move loop starts only after the
  // pointer actually travels. Starting it on mousedown swallows the click and
  // the double-click, so the titlebar could never toggle maximize.
  const dragStart = useRef<{ x: number; y: number; started: boolean } | null>(null);
  // Narrow windows collapse the capsule to the lens; clicking it must expand it.
  const searchRef = useRef<HTMLInputElement>(null);
  const interactive = (target: EventTarget | null) =>
    !!(target as HTMLElement | null)?.closest?.('button, input, textarea, a, [data-no-drag]');
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || interactive(e.target)) return;
    dragStart.current = { x: e.clientX, y: e.clientY, started: false };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = dragStart.current;
    if (!d || d.started) return;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 4) return;
    d.started = true;
    onDrag();
  };
  const onPointerEnd = () => { dragStart.current = null; };
  const onDoubleClick = (e: ReactMouseEvent) => {
    if (interactive(e.target)) return;
    onWindow('window.maximize');
  };
  // The shell reports native window state; the glyph must match it (maximize ↔ restore).
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const onState = (e: Event) => setMaximized(!!(e as CustomEvent<{ maximized?: boolean }>).detail?.maximized);
    window.addEventListener('pristem:window-state', onState);
    return () => window.removeEventListener('pristem:window-state', onState);
  }, []);

  return (
    <header
      className="titlebar"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={onDoubleClick}
    >
      {mode !== 'IDE' && (
        <div className="brand">
          <span className="brand-mark">
            <BrandMark size={18} />
            <LivingCore coreRef={haloRef} mode={mode} />
          </span>
          <span className="brand-name">pristem<i>.</i></span>
          <span className="brand-divider" />
          <span className="brand-tag">RESIDENT AGENT</span>
        </div>
      )}

      <div className="title-mode-wrap">
        <button
          type="button"
          className="title-mode"
          data-pop-trigger="mode-menu"
          aria-haspopup="menu"
          aria-expanded={modeMenuOpen}
          aria-label={t('status.switchMode')}
          onMouseDown={stop}
          onClick={onToggleModeMenu}
        >
          <PresenceDial level={PRESENCE[mode]} size="sm" className={mode === 'IDE' ? 'is-off' : ''} />
          <span className="title-mode-name">{t(`modeName.${mode}`)}</span>
          <span className="title-mode-id">{mode}</span>
          <ChevronRight size={11} className={modeMenuOpen ? 'rot' : undefined} />
        </button>
        {modeMenuOpen && (
          <div className="mode-menu" role="menu" data-pop="mode-menu" onMouseDown={stop}>
            <div className="mode-menu-head">
              <span className="eyebrow">{t('status.switchMode')}</span>
            </div>
            {ALL_MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="menuitem"
                className={`${m === mode ? 'is-current' : ''} ${pending && modeState.target === m ? 'is-pending' : ''}`}
                aria-disabled={pending ? 'true' : undefined}
                title={m === 'deepsleep' ? t('mode.hint.deepsleepTitle') : undefined}
                onClick={() => { if (!pending) onSwitchMode(m); }}
              >
                <PresenceDial level={PRESENCE[m]} size="md" current={m === mode} />
                <span className="menu-name">{m}</span>
                <span className="menu-hint">{t(`modeHint.${m}`)}</span>
                {pending && modeState.target === m && <span className="menu-pending"><span className="menu-pending-dot" aria-hidden="true" />{t('mode.pendingShort')}</span>}
                {m === mode && <Check size={12} />}
              </button>
            ))}
            {modeState.phase === 'failed' && (
              <div className="mode-menu-error">
                <EmptyState
                  variant="error"
                  title={modeState.errorTitle ?? t('mode.failed.timeout')}
                  desc={modeState.errorDesc ?? t('mode.failed.timeoutDesc')}
                  actions={modeState.recover
                    ? [{ label: t('mode.failed.recover'), onClick: onRecover, primary: true }]
                    : [{ label: t('mode.failed.retry'), onClick: onRetrySwitch, primary: true }]}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="project-chip" onMouseDown={stop} title={root}>{shortRoot}</div>
      {menubar}
      {sessionSwitcher}

      <div
        className="search-capsule"
        onMouseDown={stop}
        onClick={() => searchRef.current?.focus()}
        data-mode={search.startsWith('>') ? 'command' : 'file'}
      >
        <SemanticIcon name="search" size={15} />
        <input
          ref={searchRef}
          type="text"
          value={search}
          placeholder={t('chrome.searchPlaceholder')}
          aria-label={t('chrome.searchPlaceholder')}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onSearch('');
            if (e.key === 'Enter' && search.trim()) {
              e.preventDefault();
              onPalette(search.startsWith('>') ? 'command' : 'file');
            }
          }}
        />
        {search && (
          <button type="button" className="search-clear" aria-label={t('common.clear')} onClick={() => onSearch('')}>
            <SemanticIcon name="backspace" size={13} />
          </button>
        )}
      </div>

      <div className="title-icons">
        <button
          type="button"
          className="icon-btn"
          title={t('chrome.shortcuts')}
          aria-label={t('chrome.shortcuts')}
          onMouseDown={stop}
          onClick={() => onPalette('command')}
        >
          <SemanticIcon name="command" size={15} />
        </button>
      </div>

      <div className="window-controls" onMouseDown={stop}>
        <button type="button" onClick={() => onWindow('window.minimize')} aria-label="Minimize"><span className="wc-min" /></button>
        <button type="button" onClick={() => onWindow('window.maximize')} aria-label={maximized ? 'Restore' : 'Maximize'}>
          {maximized ? <span className="wc-restore" /> : <span className="wc-max" />}
        </button>
        <button type="button" className="is-close" onClick={() => onWindow('window.close')} aria-label="Close"><X size={13} /></button>
      </div>
    </header>
  );
}

/** Status-bar language switch. Shows the target language; never inside mode-menu. */
export function LangSwitch() {
  const lang = getLang();
  return (
    <button
      type="button"
      className="lang-switch"
      aria-label={t('chrome.langSwitch')}
      title={t('chrome.langSwitch')}
      onClick={() => setLang(lang === 'zh-CN' ? 'en-US' : 'zh-CN')}
    >
      {lang === 'zh-CN' ? 'EN' : '中'}
    </button>
  );
}

export type ConnState = 'ok' | 'fixture' | 'off' | 'connecting';

/**
 * R-CONN-1: the transport status has exactly ONE home — the status bar.
 * No panel, card or toast may repeat it.
 */
export function ConnectionBadge({ state, onRetry }: { state: ConnState; onRetry: () => void }) {
  const [open, setOpen] = useState(false);
  useDismissable('conn-retry', open, () => setOpen(false));
  // A healthy transport is the default, not news: anything that is working does
  // not need a label saying so on every frame. Only the exceptions are shown.
  if (state === 'ok') return null;
  const label = state === 'fixture' ? t('status.demo')
    : state === 'connecting' ? t('status.connecting')
      : t('status.offline');
  if (state !== 'off') {
    return (
      <span className={`conn-state is-${state}`} title={state === 'fixture' ? t('status.demoLong') : undefined}>
        {label}
      </span>
    );
  }
  return (
    <span className="conn-retry">
      <button
        type="button"
        className="conn-state is-off"
        aria-haspopup="menu"
        aria-expanded={open}
        data-pop-trigger="conn-retry"
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && (
        <div className="conn-retry-menu" role="menu" data-pop="conn-retry">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onRetry(); }}>
            {t('status.retryConnection')}
          </button>
        </div>
      )}
    </span>
  );
}

