import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { BrandMark } from './BrandMark';
import { EmptyState, EMPTY_ICONS } from './EmptyState';
import { ModelSettings } from './ModelSettings';
import { t, getLang, setLang } from '../i18n';
import { readSettings, writeSettings, type LocalSettings } from '../localSettings';
import type { RecentWorkspace } from './Panels';
import { trapFocus } from './overlayStack';
import type { IoRequest, ShellCapabilities } from '../types';

export type SettingsSectionId =
  | 'appearance' | 'providers' | 'editor' | 'living' | 'data' | 'keys' | 'about';

const SECTION_IDS: SettingsSectionId[] = ['appearance', 'providers', 'editor', 'living', 'data', 'keys', 'about'];

const KEYMAP: [string, string][] = [
  ['Ctrl+Shift+P', 'keymap.commandPalette'],
  ['Ctrl+P', 'keymap.quickOpen'],
  ['Ctrl+,', 'keymap.settings'],
  ['F2', 'keymap.modeMenu'],
  ['Ctrl+B', 'keymap.console'],
  ['Ctrl+`', 'keymap.terminal'],
  ['Ctrl+S', 'keymap.save'],
  ['Ctrl+Shift+S', 'keymap.saveAll'],
  ['Ctrl+G', 'keymap.jumpLine'],
  ['Ctrl+Shift+E', 'keymap.viewFiles'],
  ['Ctrl+Shift+F', 'keymap.viewSearch'],
  ['Ctrl+Shift+G', 'keymap.viewGit'],
  ['Ctrl+Shift+O', 'keymap.viewOutline'],
  ['Ctrl+Shift+H', 'keymap.replaceInFiles'],
  ['Ctrl+Tab', 'keymap.nextTab'],
  ['Ctrl+Shift+Tab', 'keymap.prevTab'],
  ['Ctrl+W', 'keymap.closeTab'],
  ['Ctrl+\\', 'keymap.splitRight'],
  ['Ctrl+Shift+\\', 'keymap.splitDown'],
  ['Ctrl+Z', 'keymap.undo'],
  ['Ctrl+Y', 'keymap.redo'],
  ['Ctrl+F', 'keymap.find'],
  ['Ctrl+H', 'keymap.replace'],
  ['Alt+Z', 'keymap.wordWrap'],
  ['Shift+Alt+F', 'keymap.format'],
  ['Shift+Alt+O', 'keymap.organizeImports'],
  ['Ctrl+Shift+C', 'keymap.copyTerminal'],
  ['Ctrl+Shift+V', 'keymap.pasteTerminal'],
  ['Ctrl+Insert', 'keymap.copyAlt'],
  ['Shift+Insert', 'keymap.pasteAlt'],
  ['Shift+@+F1', 'keymap.summon'],
  ['Shift+@+S', 'keymap.restore'],
  ['Esc', 'keymap.escape'],
];

interface RowDef {
  id: string;
  title: string;
  desc: string;
  wide?: boolean;
  render: () => ReactNode;
}

interface SectionDef {
  id: SettingsSectionId;
  title: string;
  rows: RowDef[];
}

/** VSCode-style numeric preference: type freely, commit on Enter/blur, clamp on commit. */
function NumberField({ value, min, max, step = 1, unit, ariaLabel, onCommit }: {
  value: number; min: number; max: number; step?: number; unit?: string;
  ariaLabel: string; onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) { setDraft(String(value)); return; }
    const next = Math.min(max, Math.max(min, Math.round(n)));
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <span className="number-field">
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={draft}
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); }
          if (e.key === 'Escape') { setDraft(String(value)); (e.target as HTMLInputElement).blur(); }
        }}
      />
      {unit && <span className="number-unit">{unit}</span>}
    </span>
  );
}

export function SettingsPage({
  protocol,
  sendIo,
  currentProvider,
  pendingProvider,
  onSwitchProvider,
  capabilities,
  hasActiveSession,
  recent,
  onRemoveRecent,
  onClearRecent,
  onOpenWorkspace,
  onExport,
  onClearSession,
  onClose,
  initialSection = 'appearance',
  commandRows,
}: {
  protocol: string | null;
  sendIo: (r: IoRequest) => Promise<unknown>;
  currentProvider: string | null;
  pendingProvider: string | null;
  onSwitchProvider: (id: string) => void;
  capabilities: ShellCapabilities;
  hasActiveSession: boolean;
  recent: RecentWorkspace[];
  onRemoveRecent: (root: string) => void;
  onClearRecent: () => void;
  onOpenWorkspace: (root: string) => void;
  onExport: () => void;
  onClearSession: () => void;
  onClose: () => void;
  initialSection?: SettingsSectionId;
  /** Live command table — the shortcut page never duplicates it by hand. */
  commandRows: { label: string; keys?: string }[];
}) {
  const [section, setSection] = useState<SettingsSectionId>(initialSection);
  const [search, setSearch] = useState('');
  const [s, setS] = useState<LocalSettings>(() => readSettings());
  const nav = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSection(initialSection);
    page.current?.scrollTo({ top: 0 });
    window.requestAnimationFrame(() => {
      const first = nav.current?.querySelector<HTMLButtonElement>('.settings-nav-item');
      first?.focus({ preventScroll: true });
    });
  }, [initialSection]);

  const patch = (p: Partial<LocalSettings>) => {
    writeSettings(p);
    setS(readSettings());
  };

  const seg = (options: { value: string; label: string }[], value: string, onPick: (v: string) => void) => (
    <div className="settings-seg" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'is-on' : undefined} onClick={() => onPick(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );

  const sections = useMemo<SectionDef[]>(() => {
    const appearance: SectionDef = {
      id: 'appearance',
      title: t('settings.section.appearance'),
      rows: [
        {
          id: 'lang', title: t('settings.appearance.lang'), desc: '',
          render: () => seg(
            [{ value: 'zh-CN', label: '中文' }, { value: 'en-US', label: 'English' }],
            getLang(),
            (v) => setLang(v === 'en-US' ? 'en-US' : 'zh-CN'),
          ),
        },
        {
          id: 'theme', title: t('settings.appearance.theme'), desc: t('settings.themeValue'),
          render: () => <span className="settings-value">{t('settings.themeValue')}</span>,
        },
        {
          id: 'baseFont', title: t('settings.appearance.baseFont'), desc: t('settings.rangeHint'), 
          render: () => (
            <NumberField
              value={s.baseFont}
              min={11}
              max={18}
              unit="px"
              ariaLabel={t('settings.appearance.baseFont')}
              onCommit={(n) => patch({ baseFont: n })}
            />
          ),
        },
        {
          id: 'motion', title: t('settings.appearance.motion'), desc: '',
          render: () => seg(
            [
              { value: 'system', label: t('settings.motion.system') },
              { value: 'reduced', label: t('settings.motion.reduced') },
              { value: 'full', label: t('settings.motion.full') },
            ],
            s.motion,
            (v) => patch({ motion: v as LocalSettings['motion'] }),
          ),
        },
        {
          id: 'living', title: t('settings.appearance.living'), desc: '',
          render: () => (
            <button
              type="button"
              className={`settings-switch ${s.living ? 'is-on' : ''}`}
              role="switch"
              aria-checked={s.living}
              aria-label={t('settings.appearance.living')}
              onClick={() => patch({ living: !s.living })}
            />
          ),
        },
      ],
    };

    const providerSection: SectionDef = {
      id: 'providers',
      title: t('settings.section.providers'),
      rows: [
        {
          id: 'models', title: t('models.list'), desc: '', wide: true,
          render: () => (
            <ModelSettings
              sendIo={sendIo}
              hasActiveSession={hasActiveSession}
              currentProvider={currentProvider}
              pendingProvider={pendingProvider}
              onSwitchProvider={onSwitchProvider}
            />
          ),
        },
      ],
    };

    const editor: SectionDef = {
      id: 'editor',
      title: t('settings.section.editor'),
      rows: [
        {
          id: 'editorFont', title: t('settings.editor.fontSize'), desc: t('settings.rangeHint'),
          render: () => (
            <NumberField
              value={s.editorFontSize}
              min={8}
              max={32}
              unit="px"
              ariaLabel={t('settings.editor.fontSize')}
              onCommit={(n) => patch({ editorFontSize: n })}
            />
          ),
        },
        {
          id: 'tabSize', title: t('settings.editor.tabSize'), desc: t('settings.tabRangeHint'),
          render: () => (
            <NumberField
              value={s.tabSize}
              min={1}
              max={8}
              ariaLabel={t('settings.editor.tabSize')}
              onCommit={(n) => patch({ tabSize: n })}
            />
          ),
        },
        {
          id: 'autoSave', title: t('settings.editor.autoSave'), desc: '',
          render: () => (
            <button
              type="button"
              className={`settings-switch ${s.autoSave ? 'is-on' : ''}`}
              role="switch"
              aria-checked={s.autoSave}
              aria-label={t('settings.editor.autoSave')}
              onClick={() => patch({ autoSave: !s.autoSave })}
            />
          ),
        },
        {
          id: 'formatOnSave', title: t('settings.editor.formatOnSave'), desc: t('settings.editor.formatOnSaveDesc'),
          render: () => (
            <button
              type="button"
              className={`settings-switch ${s.formatOnSave ? 'is-on' : ''}`}
              role="switch"
              aria-checked={s.formatOnSave}
              aria-label={t('settings.editor.formatOnSave')}
              onClick={() => patch({ formatOnSave: !s.formatOnSave })}
            />
          ),
        },
        {
          id: 'minimap', title: t('settings.editor.minimap'), desc: '',
          render: () => (
            <button
              type="button"
              className={`settings-switch ${s.editorMinimap ? 'is-on' : ''}`}
              role="switch"
              aria-checked={s.editorMinimap}
              aria-label={t('settings.editor.minimap')}
              onClick={() => patch({ editorMinimap: !s.editorMinimap })}
            />
          ),
        },
        {
          id: 'wordWrap', title: t('settings.editor.wordWrap'), desc: '',
          render: () => (
            <button
              type="button"
              className={`settings-switch ${s.editorWordWrap ? 'is-on' : ''}`}
              role="switch"
              aria-checked={s.editorWordWrap}
              aria-label={t('settings.editor.wordWrap')}
              onClick={() => patch({ editorWordWrap: !s.editorWordWrap })}
            />
          ),
        },
        {
          id: 'cursor', title: t('settings.editor.cursorStyle'), desc: '',
          render: () => seg(
            [{ value: 'block', label: '块' }, { value: 'underline', label: '下划线' }, { value: 'bar', label: '竖线' }],
            s.cursorStyle,
            (v) => patch({ cursorStyle: v as LocalSettings['cursorStyle'] }),
          ),
        },
        {
          id: 'instances', title: t('settings.editor.instances'), desc: '',
          render: () => capabilities.termInstance ? (
            seg(
              [{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }],
              String(s.defaultInstances),
              (v) => patch({ defaultInstances: Number(v) as 1 | 2 | 3 }),
            )
          ) : (
            <>
              <span className="settings-chip">{t('settings.chip.unavailable')}</span>
              <span className="settings-value">{t('settings.terminalInstancesUnavailable')}</span>
            </>
          ),
        },
        {
          id: 'terminalFont', title: t('settings.editor.terminalFontSize'), desc: t('settings.rangeHint'),
          render: () => (
            <NumberField
              value={s.terminalFontSize}
              min={8}
              max={32}
              unit="px"
              ariaLabel={t('settings.editor.terminalFontSize')}
              onCommit={(n) => patch({ terminalFontSize: n })}
            />
          ),
        },
        {
          id: 'shellProfile', title: t('settings.editor.shellProfile'), desc: t('settings.shell.hint'),
          render: () => seg(
            [
              { value: 'auto', label: t('settings.shell.auto') },
              { value: 'pwsh', label: t('settings.shell.pwsh') },
              { value: 'powershell', label: t('settings.shell.powershell') },
              { value: 'cmd', label: t('settings.shell.cmd') },
            ],
            s.shellProfile,
            (v) => patch({ shellProfile: v as LocalSettings['shellProfile'] }),
          ),
        },
      ],
    };

    const living: SectionDef = {
      id: 'living',
      title: t('settings.section.living'),
      rows: [
        {
          id: 'breathe', title: t('settings.living.breathe'), desc: '',
          render: () => (
            <button
              type="button"
              className={`settings-switch ${s.breathe ? 'is-on' : ''}`}
              role="switch"
              aria-checked={s.breathe}
              aria-label={t('settings.living.breathe')}
              onClick={() => patch({ breathe: !s.breathe })}
            />
          ),
        },
        {
          id: 'pointer', title: t('settings.living.pointer'), desc: '',
          render: () => (
            <button
              type="button"
              className={`settings-switch ${s.pointerFollow ? 'is-on' : ''}`}
              role="switch"
              aria-checked={s.pointerFollow}
              aria-label={t('settings.living.pointer')}
              onClick={() => patch({ pointerFollow: !s.pointerFollow })}
            />
          ),
        },
        {
          id: 'intensity', title: t('settings.living.intensity'), desc: '',
          render: () => (
            <span className="settings-slider">
              <input
                type="range" min={0} max={100} step={5} value={s.livingIntensity}
                aria-label={t('settings.living.intensity')}
                onChange={(e) => patch({ livingIntensity: Number(e.target.value) })}
              />
              <span className="settings-value">{s.livingIntensity}%</span>
            </span>
          ),
        },
        {
          id: 'lowRate', title: t('settings.living.lowRate'), desc: t('deepsleep.note'),
          render: () => <span className="settings-value">12s</span>,
        },
      ],
    };

    const data: SectionDef = {
      id: 'data',
      title: t('settings.section.data'),
      rows: [
        {
          id: 'recent', title: t('settings.data.recent'), desc: '', wide: true,
          render: () => (
            <div className="settings-recent">
              {recent.length === 0 ? (
                <span className="path-dialog-empty">{t('pathDialog.recentEmpty')}</span>
              ) : (
                recent.map((r: RecentWorkspace) => (
                  <div className="settings-recent-row" key={r.root}>
                    <button type="button" className="settings-recent-open" onClick={() => onOpenWorkspace(r.root)}>
                      <span className="settings-recent-label">{r.label}</span>
                      <code>{r.root}</code>
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t('common.remove')}
                      title={t('common.remove')}
                      onClick={() => onRemoveRecent(r.root)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))
              )}
              {recent.length > 0 && (
                <button type="button" className="text-btn settings-recent-clear" onClick={onClearRecent}>
                  {t('settings.data.clearAll')}
                </button>
              )}
            </div>
          ),
        },
        {
          id: 'export', title: t('settings.data.export'), desc: '',
          render: () => (
            <button type="button" className="secondary-btn" style={{ height: 28, padding: '0 10px', fontSize: 11 }} onClick={onExport}>
              {t('common.export')}
            </button>
          ),
        },
        {
          id: 'clearSession', title: t('settings.data.clear'), desc: '',
          render: () => (
            <button type="button" className="secondary-btn" style={{ height: 28, padding: '0 10px', fontSize: 11, borderColor: 'var(--danger)', color: 'var(--danger)' }} onClick={onClearSession}>
              {t('settings.data.clear')}
            </button>
          ),
        },
        {
          id: 'local', title: t('settings.data.local'), desc: t('settings.localOnly'),
          render: () => <span className="settings-value">localStorage</span>,
        },
      ],
    };

    const keys: SectionDef = {
      id: 'keys',
      title: t('settings.section.keys'),
      rows: [
        {
          id: 'keymap', title: t('settings.keysTitle'), desc: '', wide: true,
          render: () => (
            <table className="settings-table">
              <thead><tr><th>{t('settings.keyColumn')}</th><th>{t('settings.commandColumn')}</th></tr></thead>
              <tbody>
                {KEYMAP.map(([k, d]) => (
                  <tr key={`${k}:${d}`}><td><code>{k}</code></td><td>{t(d)}</td></tr>
                ))}
              </tbody>
            </table>
          ),
        },
        {
          id: 'commands', title: t('settings.commandsTitle'), desc: '', wide: true,
          render: () => (
            <table className="settings-table">
              <thead>
                <tr>
                  <th>{t('settings.commandColumn')}</th>
                  <th>{t('settings.keyColumn')}</th>
                </tr>
              </thead>
              <tbody>
                {commandRows.map((c) => (
                  <tr key={c.label}><td>{c.label}</td><td><code>{c.keys || '—'}</code></td></tr>
                ))}
              </tbody>
            </table>
          ),
        },
      ],
    };

    const about: SectionDef = {
      id: 'about',
      title: t('settings.section.about'),
      rows: [
        {
          id: 'mark', title: t('settings.about.appName'), desc: '', wide: true,
          render: () => <BrandMark size={64} />,
        },
        {
          id: 'version', title: t('settings.about.version'), desc: '',
          render: () => <span className="settings-value">0.1.0</span>,
        },
        {
          id: 'protocol', title: t('settings.about.protocol'), desc: '',
          render: () => (protocol ? <span className="settings-value">{protocol}</span> : null),
        },
        {
          id: 'build', title: t('settings.about.build'), desc: '',
          render: () => <span className="settings-value">desktop</span>,
        },
        {
          id: 'license', title: t('settings.about.license'), desc: '',
          render: () => <span className="settings-value">MIT</span>,
        },
      ],
    };

    return [appearance, providerSection, editor, living, data, keys, about];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, sendIo, currentProvider, pendingProvider, capabilities, hasActiveSession, recent.length, commandRows]);

  const q = search.trim().toLowerCase();
  const visible = useMemo(() => sections.map((sec) => ({
    sec,
    rows: q ? sec.rows.filter((r) => `${r.title} ${r.desc}`.toLowerCase().includes(q)) : sec.rows,
  })).filter((x) => x.rows.length > 0), [sections, q]);
  const anyMatch = visible.length > 0;

  // The nav reports the section the reader is actually looking at, not the last click.
  useEffect(() => {
    const scroller = page.current;
    if (!scroller) return;
    let raf = 0;
    const sync = () => {
      raf = 0;
      const marker = scroller.getBoundingClientRect().top + 64;
      // At the end of the page the last (short) section may never reach the marker.
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
      let current: SettingsSectionId | null = null;
      for (const id of SECTION_IDS) {
        const el = document.getElementById(`settings-${id}`);
        if (!el) continue;
        if (atBottom || el.getBoundingClientRect().top <= marker) current = id;
      }
      if (!current) {
        for (const id of SECTION_IDS) {
          if (document.getElementById(`settings-${id}`)) { current = id; break; }
        }
      }
      if (current) setSection((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => { if (!raf) raf = window.requestAnimationFrame(sync); };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    sync();
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [visible]);

  return (
    <div
      className="settings-page"
      role="dialog"
      aria-modal="true"
      aria-label={t('settings.title')}
      ref={page}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
        trapFocus(page.current, e);
      }}
    >
      <div className="settings-inner">
        <nav className="settings-nav" aria-label={t('settings.title')} ref={nav}>
          <input
            className="settings-search"
            type="search"
            placeholder={t('settings.searchPlaceholder')}
            aria-label={t('settings.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {SECTION_IDS.map((id) => {
            const sec = sections.find((x) => x.id === id);
            return (
              <button
                key={id}
                type="button"
                className={`settings-nav-item ${section === id ? 'is-active' : ''}`}
                aria-current={section === id ? 'true' : undefined}
                onClick={() => {
                  setSection(id);
                  // Instant jump: a smooth scroll keeps moving after the click and can
                  // drag the page while a dialog is open.
                  document.getElementById(`settings-${id}`)?.scrollIntoView({ block: 'start', behavior: 'auto' });
                }}
              >
                {sec ? sec.title : id}
              </button>
            );
          })}
        </nav>

        <div className="settings-body">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button type="button" className="icon-btn" aria-label={t('settings.close')} onClick={onClose}>
              <X size={14} />
            </button>
          </div>

          {!anyMatch ? (
            <EmptyState
              variant="noresult"
              title={t('settings.noMatch')}
              desc={t('settings.searchPlaceholder')}
              icon={<EMPTY_ICONS.search size={18} />}
              actions={[{ label: t('settings.clearSearch'), onClick: () => setSearch(''), primary: true }]}
            />
          ) : (
            visible.map(({ sec, rows }) => (
              <section className="settings-section" key={sec.id} id={`settings-${sec.id}`}>
                <h2 className="settings-section-title">{sec.title}</h2>
                {rows.map((r) => (
                  <div className={`settings-row ${r.wide ? 'is-wide' : ''}`} key={r.id}>
                    <div>
                      <div className="settings-row-title">{r.title}</div>
                      {r.desc && <div className="settings-row-desc">{r.desc}</div>}
                    </div>
                    <div className="settings-actions">{r.render()}</div>
                  </div>
                ))}
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
