import { useMemo, useState } from 'react';
import { Check, CircleDashed, LoaderCircle, Plus, Search, X } from 'lucide-react';
import type { Mode } from '../types';
import { getLang, t, useI18n } from '../i18n';

export interface SessionTabInfo {
  key: string;
  label: string;
  mode: Mode;
  id?: number | null;
  running: boolean;
  updatedAt: number;
}

type StatusId = 'running' | 'connecting' | 'done';

function statusOf(s: SessionTabInfo): { id: StatusId; label: string } {
  if (s.running) return { id: 'running', label: t('session.status.running') };
  if (s.id == null) return { id: 'connecting', label: t('session.status.connecting') };
  return { id: 'done', label: t('session.status.done') };
}

/** Today shows the clock; older activity shows the date as well. */
function timeLabel(ts: number): string {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  const locale = getLang() === 'en-US' ? 'en-US' : 'zh-CN';
  return new Intl.DateTimeFormat(
    locale,
    sameDay
      ? { hour: '2-digit', minute: '2-digit' }
      : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
  ).format(d);
}

function StatusIcon({ id }: { id: StatusId }) {
  if (id === 'running') return <LoaderCircle size={13} className="session-spin" />;
  if (id === 'connecting') return <CircleDashed size={13} />;
  return <Check size={13} />;
}

/**
 * Sessions are context, not workspace. The toggle lives in the titlebar; the
 * panel itself is a real column next to the conversation so the list can show
 * status and time instead of hiding everything behind a dropdown.
 */
export function SessionToggle({
  open, count, label, onToggle,
}: {
  open: boolean;
  count: number;
  label: string;
  onToggle: () => void;
}) {
  useI18n();
  return (
    <div className="session-switcher">
      <button
        type="button"
        className={`session-switcher-btn ${open ? 'is-open' : ''}`}
        data-count={count}
        aria-expanded={open}
        aria-controls="session-panel"
        title={t('session.switch')}
        onClick={onToggle}
      >
        <span className="session-switcher-label">{label}</span>
        <span className="session-count">{count}</span>
      </button>
    </div>
  );
}

export function SessionPanel({
  sessions, activeKey, onActivate, onNew, onClose, onCollapse,
}: {
  sessions: SessionTabInfo[];
  activeKey: string;
  onActivate: (key: string) => void;
  onNew: () => void;
  onClose: (key: string) => void;
  onCollapse: () => void;
}) {
  useI18n();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? sessions.filter((s) => s.label.toLowerCase().includes(q)) : sessions;
  }, [sessions, query]);

  return (
    <aside className="session-panel" id="session-panel" aria-label={t('session.list')}>
      <div className="session-panel-head">
        <span className="session-panel-title">{t('session.list')}</span>
        <span className="session-panel-count">{sessions.length}</span>
        <div className="session-panel-actions">
          <button
            type="button"
            className={`icon-btn ${searching ? 'is-on' : ''}`}
            aria-label={t('session.search')}
            title={t('session.search')}
            onClick={() => { setSearching((v) => !v); if (searching) setQuery(''); }}
          >
            <Search size={13} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('session.new')}
            title={t('session.new')}
            onClick={onNew}
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('session.collapse')}
            title={t('session.collapse')}
            onClick={onCollapse}
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {searching && (
        <input
          className="session-search"
          autoFocus
          value={query}
          placeholder={t('session.search')}
          aria-label={t('session.search')}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); setSearching(false); } }}
        />
      )}

      <div className="session-list" role="list">
        {list.map((s) => {
          const st = statusOf(s);
          return (
            <div
              key={s.key}
              role="listitem"
              tabIndex={0}
              className={`session-card ${s.key === activeKey ? 'is-active' : ''}`}
              data-session={s.id ?? undefined}
              data-mode={s.mode}
              onClick={() => onActivate(s.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(s.key); }
              }}
            >
              <span className={`session-status is-${st.id}`} aria-hidden="true"><StatusIcon id={st.id} /></span>
              <span className="session-card-body">
                <span className="session-card-title">{s.label}</span>
                <span className="session-card-meta">{st.label} · {timeLabel(s.updatedAt)}</span>
              </span>
              <button
                type="button"
                className="tab-x session-card-close"
                aria-label={`${t('common.close')} ${s.label}`}
                onClick={(e) => { e.stopPropagation(); onClose(s.key); }}
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
        {list.length === 0 && <p className="session-empty">{t('session.noMatch')}</p>}
      </div>

      <button type="button" className="session-new" onClick={onNew}>
        <Plus size={13} /> {t('session.new')}
      </button>
    </aside>
  );
}
