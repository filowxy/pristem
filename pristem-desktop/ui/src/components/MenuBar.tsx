import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { MenuSpec } from '../commands';
import { t } from '../i18n';
import { useDismissable } from './overlayStack';

/**
 * IDE-only menu bar (plan 5a). One command table feeds both this and the
 * palette; the bar never holds its own command implementations.
 * ponytail: below 1200px the labels collapse into a "≡" that opens the
 * command palette — a second menu layout would be duplicate UI for the same
 * table.
 */
export interface MenuBarHandle {
  handleKey: (e: KeyboardEvent) => boolean;
}

export const MenuBar = forwardRef<MenuBarHandle, {
  menus: MenuSpec[];
  onCompact: () => void;
}>(function MenuBar({ menus, onCompact }, ref) {
  const [openId, setOpenId] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismissable('menubar', openId !== null, () => setOpenId(null));

  const focusItem = (i: number) => {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])');
    if (!items?.length) return;
    items[(i + items.length) % items.length].focus();
  };
  const indexOfFocus = () => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []);
    return items.indexOf(document.activeElement as HTMLButtonElement);
  };

  const openAt = (index: number) => {
    const next = menus[(index + menus.length) % menus.length];
    setOpenId(next.id);
    window.requestAnimationFrame(() => focusItem(0));
  };

  useImperativeHandle(ref, () => ({
    handleKey(e) {
      if (!openId || e.defaultPrevented) return false;
      if (e.key === 'ArrowDown') focusItem(indexOfFocus() + 1);
      else if (e.key === 'ArrowUp') focusItem(indexOfFocus() - 1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const i = menus.findIndex((m) => m.id === openId);
        openAt(i + (e.key === 'ArrowRight' ? 1 : -1));
      } else return false;
      e.preventDefault();
      return true;
    },
  }), [openId, menus]);

  const index = menus.findIndex((m) => m.id === openId);
  const current = index >= 0 ? menus[index] : null;

  return (
    <div className="menubar" role="menubar" aria-label={t('menu.bar')} ref={barRef} onMouseDown={(e) => e.stopPropagation()}>
      {menus.map((m, i) => (
        <div key={m.id} className="menubar-slot">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={openId === m.id}
            className={`menubar-btn ${openId === m.id ? 'is-open' : ''}`}
            data-pop-trigger="menubar"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setOpenId(openId === m.id ? null : m.id)}
            onMouseEnter={() => { if (openId) setOpenId(m.id); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAt(i); }
              else if (e.key === 'ArrowRight') { e.preventDefault(); openAt(i + 1); }
              else if (e.key === 'ArrowLeft') { e.preventDefault(); openAt(i - 1); }
            }}
          >
            {m.label}
          </button>
          {current?.id === m.id && (
            <div className="menubar-menu" role="menu" aria-label={m.label} data-pop="menubar" ref={menuRef}>
              {current.entries.map((entry, ei) => entry === 'separator' ? (
                <div key={`sep-${ei}`} className="menubar-sep" role="separator" />
              ) : (
                <button
                  key={entry.id}
                  type="button"
                  role="menuitem"
                  disabled={entry.disabled}
                  title={entry.disabled ? entry.reason : undefined}
                  onClick={() => { setOpenId(null); entry.run(); }}
                >
                  <span className="menubar-label">{entry.label}</span>
                  {entry.keys && <span className="menubar-key">{entry.keys}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <button type="button" className="menubar-compact" aria-label={t('chrome.palette')} title={t('chrome.palette')} onClick={onCompact}>
        ≡
      </button>
    </div>
  );
});
