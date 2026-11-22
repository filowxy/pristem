import { useEffect, useMemo, useRef, useState } from 'react';
import { monaco } from '../monaco-setup';
import { clampPos } from './popover';
import { layerProps, useDismissable } from './overlayStack';
import { t, useI18n } from '../i18n';

type PickerKind = 'language' | 'eol' | 'indent';

/**
 * Status-bar document pickers (plan 4c). Language / indent / EOL are clickable;
 * selecting one fires a window event that the focused editor pane applies to its
 * active model. Encoding stays a read-only UTF-8 badge.
 */
export function DocPickers({ language, eol, indent }: { language?: string; eol?: string; indent?: number }) {
  useI18n();
  const [picker, setPicker] = useState<PickerKind | null>(null);
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);

  useDismissable('doc-language', picker === 'language', () => setPicker(null));
  useDismissable('doc-eol', picker === 'eol', () => setPicker(null));
  useDismissable('doc-indent', picker === 'indent', () => setPicker(null));

  useEffect(() => {
    if (picker === 'language') {
      setQuery('');
      window.requestAnimationFrame(() => search.current?.focus());
    }
  }, [picker]);

  const languages = useMemo(() => {
    const all = monaco.languages.getLanguages().map((l) => ({
      id: l.id,
      label: l.aliases?.[0] ?? l.id,
      haystack: `${l.id} ${l.aliases?.join(' ') ?? ''} ${l.extensions?.join(' ') ?? ''}`.toLowerCase(),
    }));
    all.sort((a, b) => a.id.localeCompare(b.id));
    return all;
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? languages.filter((l) => l.haystack.includes(q)) : languages;
    return list.slice(0, 80);
  }, [languages, query]);

  const open = (kind: PickerKind) => (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setAnchor({ x: r.left, y: r.top });
    setPicker((prev) => (prev === kind ? null : kind));
  };

  const emit = (name: string, detail: unknown) => {
    window.dispatchEvent(new CustomEvent(name, { detail }));
    setPicker(null);
  };

  const pos = (w: number, h: number) => clampPos(anchor.x, anchor.y - h - 6, w, h);

  return (
    <>
      {language && (
        <button type="button" className="status-item status-pick" aria-haspopup="menu" aria-expanded={picker === 'language'}
          title={t('status.pickLanguage')} onClick={open('language')} {...layerProps('doc-language')}>
          {language}
        </button>
      )}
      {eol && (
        <button type="button" className="status-item status-pick" aria-haspopup="menu" aria-expanded={picker === 'eol'}
          title={t('status.pickEol')} onClick={open('eol')} {...layerProps('doc-eol')}>
          {eol}
        </button>
      )}
      {indent != null && (
        <button type="button" className="status-item status-pick" aria-haspopup="menu" aria-expanded={picker === 'indent'}
          title={t('status.pickIndent')} onClick={open('indent')} {...layerProps('doc-indent')}>
          {indent} sp
        </button>
      )}
      <span className="status-item" title={t('status.encoding')}>UTF-8</span>

      {picker === 'language' && (
        <div className="doc-pop doc-pop-language" role="menu" aria-label={t('status.pickLanguage')}
          style={{ left: pos(240, 320).left, top: pos(240, 320).top }} {...layerProps('doc-language')}>
          <input
            ref={search}
            className="doc-pop-search"
            type="text"
            value={query}
            placeholder={t('status.searchLanguage')}
            aria-label={t('status.searchLanguage')}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="doc-pop-list">
            {filtered.map((l) => (
              <button key={l.id} type="button" role="menuitem" className={`doc-pop-item ${l.id === language ? 'is-current' : ''}`}
                onClick={() => emit('pristem:editor-set-language', { id: l.id })}>
                <span>{l.label}</span>
                <code>{l.id}</code>
              </button>
            ))}
          </div>
        </div>
      )}

      {picker === 'eol' && (
        <div className="doc-pop" role="menu" aria-label={t('status.pickEol')}
          style={{ left: pos(160, 96).left, top: pos(160, 96).top }} {...layerProps('doc-eol')}>
          {['LF', 'CRLF'].map((v) => (
            <button key={v} type="button" role="menuitem" className={`doc-pop-item ${v === eol ? 'is-current' : ''}`}
              onClick={() => emit('pristem:editor-set-eol', { eol: v })}>
              <span>{v}</span>
            </button>
          ))}
        </div>
      )}

      {picker === 'indent' && (
        <div className="doc-pop" role="menu" aria-label={t('status.pickIndent')}
          style={{ left: pos(160, 132).left, top: pos(160, 132).top }} {...layerProps('doc-indent')}>
          {[2, 4, 8].map((n) => (
            <button key={n} type="button" role="menuitem" className={`doc-pop-item ${n === indent ? 'is-current' : ''}`}
              onClick={() => emit('pristem:editor-set-indent', { size: n })}>
              <span>{n} sp</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}