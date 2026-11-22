import { useEffect, useMemo, useRef, useState } from 'react';
import { SemanticIcon } from './SemanticIcon';
import { t } from '../i18n';
import { trapFocus } from './overlayStack';

export interface PaletteItem {
  id: string;
  label: string;
  group?: string;
  keys?: string;
  run: () => void;
}

const MAX_RESULTS = 40;

/**
 * The command palette is the only index of every command in the app
 * (UX §2.3). `file` mode is the quick-open panel (Ctrl+P).
 */
export function CommandPalette({
  mode,
  items,
  initialQuery = '',
  onClose,
}: {
  mode: 'command' | 'file';
  items: PaletteItem[];
  initialQuery?: string;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(initialQuery);
    setSel(0);
    window.requestAnimationFrame(() => input.current?.focus());
  }, [initialQuery, mode]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().replace(/^[>/]\s*/, '').trim();
    const matched = !q
      ? items
      : items.filter((i) => i.label.toLowerCase().includes(q) || (i.id.toLowerCase().includes(q)));
    return matched.slice(0, MAX_RESULTS);
  }, [items, query]);

  const total = useMemo(() => {
    const q = query.toLowerCase().replace(/^[>/]\s*/, '').trim();
    if (!q) return items.length;
    return items.filter((i) => i.label.toLowerCase().includes(q) || i.id.toLowerCase().includes(q)).length;
  }, [items, query]);

  useEffect(() => { setSel(0); }, [query]);

  useEffect(() => {
    const node = listRef.current?.querySelectorAll('button')[sel];
    node?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const groups = useMemo(() => {
    const out: { name: string; items: PaletteItem[] }[] = [];
    for (const item of filtered) {
      const name = item.group ?? '';
      const last = out[out.length - 1];
      if (last && last.name === name) last.items.push(item);
      else out.push({ name, items: [item] });
    }
    return out;
  }, [filtered]);

  let flatIndex = -1;

  const commit = (item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  return (
    <div className="palette" data-pop="palette" role="dialog" aria-modal="true" aria-label={t('chrome.palette')} ref={box}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSel((s) => (filtered.length ? (s + 1) % filtered.length : 0));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSel((s) => (filtered.length ? (s - 1 + filtered.length) % filtered.length : 0));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          commit(filtered[sel]);
        }
        trapFocus(box.current, e);
      }}
    >
      <div className="palette-head">
        {mode === 'command' ? <SemanticIcon name="command" size={15} /> : <SemanticIcon name="search" size={15} />}
        <input
          ref={input}
          value={query}
          placeholder={mode === 'file' ? t('chrome.quickOpen') : t('chrome.palette')}
          aria-label={mode === 'file' ? t('chrome.quickOpen') : t('chrome.palette')}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="palette-list" ref={listRef}>
        {filtered.length === 0 ? (
          <span className="palette-empty">{mode === 'file' ? t('palette.filesEmpty') : t('palette.empty')}</span>
        ) : (
          groups.map((g) => (
            <div key={g.name || 'root'}>
              {g.name && <div className="palette-group">{t(`command.group.${g.name}`)}</div>}
              {g.items.map((item) => {
                flatIndex += 1;
                const idx = flatIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={idx === sel ? 'is-sel' : undefined}
                    onMouseEnter={() => setSel(idx)}
                    onClick={() => commit(item)}
                  >
                    <span>{item.label}</span>
                    {item.keys && <span className="palette-key">{item.keys}</span>}
                  </button>
                );
              })}
            </div>
          ))
        )}
        {total > MAX_RESULTS && <div className="palette-more">{t('palette.more', { n: total - MAX_RESULTS })}</div>}
      </div>
    </div>
  );
}
