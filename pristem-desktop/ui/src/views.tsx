import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  Check, ChevronDown, ChevronRight, CircleDot, FileText, FolderOpen, Layers, Moon, Plus,
  Quote, RefreshCw, Shield, Sparkles, Square, X,
} from 'lucide-react';
import { SemanticIcon } from './components/SemanticIcon';
import type { Annotation, ButtonSpec, Mode, ServerEvent, TranscriptItem, UsageTotals } from './types';
import { PRESENCE } from './types';
import { BrandMark } from './components/BrandMark';
import { clampPos } from './components/popover';
import { EmptyState, EMPTY_ICONS } from './components/EmptyState';
import { PresenceDial } from './components/PresenceDial';
import { ConnectionBadge, LangSwitch, type ConnState } from './components/ChromeExtras';
import { ToolCard, type CallRow } from './components/ToolCard';
import { SessionPanel, type SessionTabInfo } from './components/SessionBar';
import { t, useI18n } from './i18n';
import { writeClipboard } from './service';
import type { ComposerPermission } from './localSettings';
import { useDismissable } from './components/overlayStack';

let uid = 0;
export const nextUid = () => `e${++uid}`;

export function fromEvent(ev: ServerEvent): TranscriptItem | null {
  const base = { uid: nextUid(), ts: Date.now() };
  switch (ev.type) {
    case 'speech': return { ...base, kind: 'speech', text: ev.text };
    case 'call': return { ...base, kind: 'call', tool: ev.tool, verdict: ev.verdict };
    case 'result': return { ...base, kind: 'result', tool: ev.tool, status: ev.status, output: ev.output };
    case 'answer': return { ...base, kind: 'answer', text: ev.text };
    case 'intercepted': return { ...base, kind: 'intercepted', sigIds: ev.sig_ids, position: ev.position };
    case 'missing_reminder': return { ...base, kind: 'missing', lines: ev.lines, reject: ev.reject };
    case 'digest_requested': return { ...base, kind: 'digest', text: ev.reason };
    case 'reminder': return { ...base, kind: 'reminder', lines: ev.lines };
    case 'buttons': return { ...base, kind: 'buttons', prompt: ev.prompt, buttons: ev.buttons };
    case 'finished': return null;
    case 'error': return { ...base, kind: 'system', text: ev.message };
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Execution chain — the general form of "what just happened" (DESIGN §8.7.3).
// ---------------------------------------------------------------------------

export interface ChainStep {
  uid: string;
  tool: string;
  ts: number;
  verdict?: string;
  status?: string;
  output?: string;
}

export type ChainUnit =
  | { kind: 'item'; item: TranscriptItem }
  | { kind: 'chain'; steps: ChainStep[] };

/** Split a transcript into items and the execution chains that follow each round. */
export function buildUnits(items: TranscriptItem[]): ChainUnit[] {
  const units: ChainUnit[] = [];
  let pending: ChainStep[] = [];
  const flush = () => {
    if (pending.length) { units.push({ kind: 'chain', steps: pending }); pending = []; }
  };
  for (const it of items) {
    if (it.kind === 'call') {
      pending.push({ uid: it.uid, tool: it.tool ?? 'tool', ts: it.ts, verdict: it.verdict });
      continue;
    }
    if (it.kind === 'result') {
      const step: ChainStep = { uid: it.uid, tool: it.tool ?? 'tool', ts: it.ts, status: it.status, output: it.output };
      const open = [...pending].reverse().find((p) => !p.status && p.tool === step.tool);
      if (open) { open.status = step.status; open.output = step.output; }
      else pending.push(step);
      continue;
    }
    units.push({ kind: 'item', item: it });
    flush();
  }
  flush();
  return units;
}

const clock = (ts: number) => {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

function ExecutionChain({ steps, title }: { steps: ChainStep[]; title?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => {
    const out: { tool: string; rows: CallRow[] }[] = [];
    for (const s of steps) {
      const last = out[out.length - 1];
      if (last && last.tool === s.tool) last.rows.push({ uid: s.uid, tool: s.tool, ts: s.ts, verdict: s.verdict, status: s.status, output: s.output });
      else out.push({ tool: s.tool, rows: [{ uid: s.uid, tool: s.tool, ts: s.ts, verdict: s.verdict, status: s.status, output: s.output }] });
    }
    return out;
  }, [steps]);

  return (
    <div className="exec-chain">
      <button type="button" className="exec-chain-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>{title ?? t('chain.steps', { n: steps.length })}</span>
        <ChevronRight size={11} className={open ? 'rot' : undefined} />
      </button>
      {open && (
        <div className="exec-chain-body">
          {groups.map((g, gi) => (
            g.rows.length >= 3 ? (
              <ToolCard key={`${g.tool}:${gi}`} tool={g.tool} rows={g.rows} />
            ) : (
              <div className="exec-step" key={`${g.tool}:${gi}`}>
                <span className="exec-dot" aria-hidden="true" />
                <span className="exec-time">{clock(g.rows[0].ts ?? 0)}</span>
                <span className="exec-tool">{g.tool}</span>
                <span className="exec-summary">{g.rows[0].output ? g.rows[0].output.split('\n')[0].slice(0, 60) : ''}</span>
                <span className="exec-status">{g.rows[0].status ?? t('toolCard.pending')}</span>
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transcript — structured tool cards + localized message rows.
// ---------------------------------------------------------------------------

function Item({
  item, onConfirm, onCopy, onRegenerate, onEdit, isLastAnswer,
}: {
  item: TranscriptItem;
  onConfirm: (b: ButtonSpec) => void;
  onCopy: (text: string) => void;
  onRegenerate: (text: string) => void;
  onEdit: (text: string) => void;
  isLastAnswer: boolean;
}) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="line line-user">
          <span className="line-tag">{t('ai.you')}</span>
          <p>{item.text}</p>
        </div>
      );
    case 'speech':
      return <p className="line line-speech">{item.text}</p>;
    case 'answer':
      return (
        <div className="line line-answer">
          <span className="answer-rule" />
          <div className="line-answer-body">
            <p>{item.text}</p>
            <div className="msg-actions">
              <button type="button" className="icon-btn" title={t('common.copy')} aria-label={t('common.copy')} onClick={() => onCopy(item.text ?? '')}><SemanticIcon name="copy" size={13} /></button>
              {isLastAnswer && (
                <>
                  <button type="button" className="icon-btn" title={t('ai.regenerate')} aria-label={t('ai.regenerate')} onClick={() => onRegenerate(item.text ?? '')}><RefreshCw size={12} /></button>
                  <button type="button" className="icon-btn" title={t('ai.edit')} aria-label={t('ai.edit')} onClick={() => onEdit(item.text ?? '')}><Quote size={12} /></button>
                </>
              )}
            </div>
          </div>
        </div>
      );
    case 'intercepted':
      return <div className="line line-warn">{t('a11y.intercepted')} · {item.position}</div>;
    case 'missing':
      return <div className="line line-warn">{item.reject ? 'reject' : 'answer gate'} {item.lines?.join(' | ')}</div>;
    case 'digest':
      return <div className="line line-digest">{t('toolCard.think')} {item.text}</div>;
    case 'reminder':
      return (
        <div className="line line-reminder">
          <span className="eyebrow">{t('wake.title')}</span>
          {(item.lines?.length ? item.lines : [t('deepsleep.noBriefing')]).map((l, i) => <p key={i}>{l}</p>)}
        </div>
      );
    case 'buttons':
      return (
        <div className="line line-buttons" role="group" aria-label={t('a11y.awaitingConfirm')}>
          <p>{item.prompt}</p>
          <div className="btn-row">
            {(item.buttons?.length ? item.buttons : [{ id: -1, label: t('common.retry'), choice: 'retry', uri: '' }]).map((b) => (
              <button key={b.id} className="mini-btn" onClick={() => onConfirm(b)}>{b.label}</button>
            ))}
          </div>
        </div>
      );
    case 'system':
      return <div className="line line-system">{item.text}</div>;
    default:
      return null;
  }
}

export function Transcript({
  items, onConfirm, compact, onSuggestion, onCopy, onRegenerate, onEdit, running, onStop,
}: {
  items: TranscriptItem[];
  onConfirm: (b: ButtonSpec) => void;
  compact?: boolean;
  onSuggestion: (text: string) => void;
  onCopy: (text: string) => void;
  onRegenerate: (text: string) => void;
  onEdit: (text: string) => void;
  running?: boolean;
  onStop?: () => void;
}) {
  useI18n();
  const box = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const prevLen = useRef(items.length);
  const [newMessages, setNewMessages] = useState(false);

  useEffect(() => {
    if (items.length === prevLen.current) return;
    const grew = items.length > prevLen.current;
    prevLen.current = items.length;
    const el = box.current;
    if (!el) return;
    if (atBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    else if (grew) setNewMessages(true);
  }, [items.length]);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    atBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
    if (atBottom.current && newMessages) setNewMessages(false);
  };
  const jumpToLatest = () => {
    const el = box.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    atBottom.current = true;
    setNewMessages(false);
  };

  const units = useMemo(() => buildUnits(items), [items]);
  const lastAnswerUid = useMemo(() => [...items].reverse().find((i) => i.kind === 'answer')?.uid, [items]);

  return (
    <div className={`transcript ${compact ? 'is-compact' : ''}`} ref={box} onScroll={onScroll} role="log" aria-live="polite">
      {items.length === 0 && (
        <div className="transcript-seed">
          <span className="seed-title">{t('ai.seedTitle')}</span>
          <span className="seed-sub">{t('ai.seedDesc')}</span>
        </div>
      )}
      {units.map((u) => {
        if (u.kind === 'chain') return <ExecutionChain key={`chain-${u.steps[0]?.uid}`} steps={u.steps} />;
        const g = u.item;
        return (
          <Item
            key={g.uid}
            item={g}
            onConfirm={onConfirm}
            onCopy={onCopy}
            onRegenerate={onRegenerate}
            onEdit={onEdit}
            isLastAnswer={g.uid === lastAnswerUid}
          />
        );
      })}
      {running && (
        <div className="thinking-indicator" role="status" aria-live="polite">
          <span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span>
          <span>{t('ai.thinking')}</span>
          {onStop && <button type="button" className="text-btn" onClick={onStop}><Square size={10} /> {t('ai.stop')}</button>}
        </div>
      )}
      {newMessages && <button type="button" className="new-messages" onClick={jumpToLatest}>{t('ai.newMessages')}</button>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vitals — the single source of truth for usage. Absent when there is no
// `usage` event (D-4b): the whole row is not rendered, not a zero.
// ---------------------------------------------------------------------------

export function fmtTokens(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n < 1000) return String(Math.round(n));
  const k = n / 1000;
  return `${k >= 100 ? Math.round(k) : k.toFixed(1)}k`;
}

export function Vitals({ usage }: { usage: UsageTotals | null }) {
  if (!usage) return null;
  const total = Math.max(1, usage.input_tokens + usage.output_tokens + usage.cached_tokens);
  const cached = (usage.cached_tokens / total) * 120;
  const input = (usage.input_tokens / total) * 120;
  const output = Math.max(0, 120 - cached - input);
  return (
    <div className="ai-vitals" aria-live="polite">
      <span>in {fmtTokens(usage.input_tokens)}</span>
      <span className="vitals-sep">·</span>
      <span>out {fmtTokens(usage.output_tokens)}</span>
      <span className="vitals-sep">·</span>
      <span>cached {fmtTokens(usage.cached_tokens)}</span>
      <span className="vitals-sep">·</span>
      <span>{usage.tool_calls} calls</span>
      <span className="vitals-sep">·</span>
      <span>{(usage.elapsed_ms / 1000).toFixed(1)}s</span>
      <span className="vitals-bar" aria-hidden="true">
        <i className="vitals-cached" style={{ width: `${cached}px` }} />
        <i className="vitals-input" style={{ width: `${input}px` }} />
        <i className="vitals-output" style={{ width: `${output}px` }} />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI panel
// ---------------------------------------------------------------------------

/** Everything the composer bar can act on; built once in App and shared by both panels. */
export interface ComposerContext {
  root: string;
  recent: { label: string; root: string }[];
  files: string[];
  providers: { id: string; label: string; model: string; keyPresent: boolean }[];
  currentProvider: string | null;
  pendingProvider: string | null;
  permission: ComposerPermission;
  slash: { token: string; label: string }[];
  onOpenFolder: () => void;
  onOpenWorkspace: (root: string) => void;
  onSwitchProvider: (id: string) => void;
  onSwitchMode: (m: Mode) => void;
  onPermission: (p: ComposerPermission) => void;
}

const PERMISSIONS: { id: ComposerPermission; titleKey: string; hintKey: string }[] = [
  { id: 'ask', titleKey: 'ai.permission.ask', hintKey: 'ai.permission.askHint' },
  { id: 'auto', titleKey: 'ai.permission.auto', hintKey: 'ai.permission.autoHint' },
  { id: 'open', titleKey: 'ai.permission.open', hintKey: 'ai.permission.openHint' },
];

/** Built-in endpoint ids read as protocol names; show the product name instead. */
const PROVIDER_NAME: Record<string, string> = {
  'openai-chat': 'OpenAI',
  'openai-responses': 'OpenAI Responses',
  'anthropic-messages': 'Anthropic',
};

export type RunState = 'working' | 'awaiting' | 'blocked' | 'idle';

export function AiPanel({
  variant, mode, items, running, onSend, onConfirm, onEscalate, onDismiss,
  onCollapse, onExport, onCopy, onRegenerate, onEdit, onStop, queued, suggestionText, onConsumeSuggestion, blocked,
  usage, providerName, composer,
}: {
  variant: 'right' | 'dock';
  mode: Mode;
  items: TranscriptItem[];
  running: boolean;
  onSend: (text: string) => void;
  onConfirm: (b: ButtonSpec) => void;
  onEscalate?: () => void;
  onDismiss?: () => void;
  onCollapse?: () => void;
  onExport: () => void;
  onCopy: (text: string) => void;
  onRegenerate: (text: string) => void;
  onEdit: (text: string) => void;
  onStop: () => void;
  queued: number;
  suggestionText: string | null;
  onConsumeSuggestion: () => void;
  blocked?: boolean;
  usage: UsageTotals | null;
  providerName: string | null;
  composer: ComposerContext;
}) {
  useI18n();
  const [text, setText] = useState('');
  const [trigger, setTrigger] = useState<{ kind: 'at' | 'slash'; start: number; query: string } | null>(null);
  const [pickIndex, setPickIndex] = useState(0);
  const [menu, setMenu] = useState<'workspace' | 'permission' | 'mode' | 'model' | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useDismissable('composer-menu', !!menu, () => setMenu(null));

  useEffect(() => {
    if (suggestionText) { setText(suggestionText); onConsumeSuggestion(); }
  }, [suggestionText, onConsumeSuggestion]);

  const submit = () => {
    const v = text.trim();
    if (!v) return;
    onSend(v);
    setText('');
    setTrigger(null);
    setMenu(null);
  };

  // `@` mentions files, `/` lists real commands. Both replace the active token.
  const fileMatches = trigger?.kind === 'at'
    ? composer.files.filter((p) => p.toLowerCase().includes(trigger.query.toLowerCase())).slice(0, 8)
    : [];
  const slashMatches = trigger?.kind === 'slash'
    ? composer.slash.filter((s) => s.token.toLowerCase().includes(trigger.query.toLowerCase())).slice(0, 8)
    : [];
  const picks = trigger?.kind === 'at'
    ? fileMatches.map((p) => ({ key: p, label: p.split('/').pop() ?? p, hint: p }))
    : slashMatches.map((s) => ({ key: s.token, label: s.token, hint: s.label }));

  const syncTrigger = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const at = before.match(/(?:^|\s)@([^\s@]*)$/);
    const slash = before.match(/(?:^|\s)\/([a-z-]*)$/);
    if (at) {
      setTrigger({ kind: 'at', start: caret - at[1].length - 1, query: at[1] });
      setPickIndex(0);
    } else if (slash) {
      setTrigger({ kind: 'slash', start: caret - slash[1].length - 1, query: slash[1] });
      setPickIndex(0);
    } else {
      setTrigger(null);
    }
  };

  const pick = (index: number) => {
    if (!trigger) return;
    const chosen = picks[index];
    if (!chosen) return;
    const end = trigger.start + 1 + trigger.query.length;
    const insert = trigger.kind === 'at' ? `@${chosen.key} ` : `${chosen.key} `;
    const next = text.slice(0, trigger.start) + insert + text.slice(end);
    setText(next);
    setTrigger(null);
    const caret = trigger.start + insert.length;
    window.requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) { el.focus(); el.setSelectionRange(caret, caret); }
    });
  };

  const addFile = () => {
    const el = taRef.current;
    const pos = el?.selectionStart ?? text.length;
    setText(text.slice(0, pos) + '@' + text.slice(pos));
    setTrigger({ kind: 'at', start: pos, query: '' });
    setPickIndex(0);
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos + 1, pos + 1);
    });
  };

  const runState: RunState = blocked ? 'blocked'
    : items.some((i) => i.kind === 'buttons') ? 'awaiting'
      : running ? 'working' : 'idle';

  const currentModelLabel = composer.currentProvider
    ? (composer.providers.find((p) => p.id === composer.currentProvider)?.model
      || PROVIDER_NAME[composer.currentProvider]
      || composer.currentProvider)
    : (providerName ?? t('ai.noModel'));
  const providerLabel = (p: { id: string; label: string }) => PROVIDER_NAME[p.id] ?? p.label;

  return (
    <section className={`pane ai-panel ${variant}`} data-ai="true">
      <div className="ai-head">
        <div className="ai-head-left">
          <PresenceDial level={PRESENCE[mode]} size="sm" />
          <span className="ai-mode-name">{t(`modeName.${mode}`)}</span>
          <span className="ai-mode-id">{mode}</span>
        </div>
        <div className="ai-head-right">
          {runState !== 'idle' && (
            <span className={`running-pill is-${runState}`}>
              {runState === 'working' ? t('ai.runState.working')
                : runState === 'awaiting' ? t('ai.runState.awaiting') : t('ai.runState.blocked')}
            </span>
          )}
          {queued > 0 && <span className="queue-hint">{t('ai.queue', { n: queued })}</span>}
          <button type="button" className="icon-btn" title={t('common.export')} aria-label={t('common.export')} onClick={onExport}><SemanticIcon name="export" size={15} /></button>
          {variant === 'dock' && (
            <>
              <button className="text-btn" onClick={onEscalate}>{t('ai.escalate')}</button>
              <button className="text-btn" onClick={onDismiss}>{t('ai.dismiss')}</button>
            </>
          )}
          {onCollapse && <button type="button" className="icon-btn" onClick={onCollapse} title={t('ai.collapse')} aria-label={t('ai.collapse')}><X size={14} /></button>}
        </div>
      </div>
      <Vitals usage={usage} />
      <Transcript
        items={items}
        onConfirm={onConfirm}
        compact={variant === 'dock'}
        onSuggestion={setText}
        onCopy={onCopy}
        onRegenerate={onRegenerate}
        onEdit={onEdit}
        running={running}
        onStop={onStop}
      />
      <div className="composer">
        {blocked && (
          <div className="composer-blocked" role="status">
            <span className="composer-blocked-title">{t('error.noWorkspace.title')}</span>
            <span className="composer-blocked-desc">{t('error.noWorkspace.reason')}</span>
          </div>
        )}
        <div className="composer-box" data-composer>
          <textarea
            ref={taRef}
            rows={2}
            value={text}
            disabled={blocked}
            placeholder={blocked ? t('welcome.title') : variant === 'dock' ? t('ai.composerPlaceholderDock') : t('ai.composerPlaceholder')}
            onChange={(e) => {
              const el = e.currentTarget;
              setText(el.value);
              syncTrigger(el.value, el.selectionStart);
            }}
            onKeyDown={(e) => {
              const open = picks.length > 0;
              if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault();
                setPickIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : picks.length - 1)) % picks.length);
                return;
              }
              if (open && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pick(pickIndex); return; }
              if (trigger && e.key === 'Escape') { e.preventDefault(); setTrigger(null); return; }
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
          />

          {trigger && picks.length > 0 && (
            <div className="composer-suggest" role="listbox"
              aria-label={trigger.kind === 'at' ? t('ai.mentionFiles') : t('ai.slashCommands')}>
              {picks.map((p, i) => (
                <button
                  type="button"
                  key={p.key}
                  role="option"
                  aria-selected={i === pickIndex}
                  className={`composer-suggest-row ${i === pickIndex ? 'is-active' : ''}`}
                  onMouseEnter={() => setPickIndex(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(i)}
                >
                  {trigger.kind === 'at' ? <FileText size={12} /> : <CircleDot size={12} />}
                  <span className="composer-suggest-label">{p.label}</span>
                  <span className="composer-suggest-hint">{p.hint}</span>
                  {trigger.kind === 'at' && <span className="composer-suggest-kind">{t('ai.fileChip')}</span>}
                </button>
              ))}
            </div>
          )}

          <div className="composer-bar">
            <button type="button" className="foot-icon" title={t('ai.addFile')} aria-label={t('ai.addFile')} onClick={addFile}>
              <Plus size={14} />
            </button>

            <span className="composer-seg-wrap">
              <button
                type="button"
                className={`composer-seg ${menu === 'workspace' ? 'is-open' : ''}`}
                aria-haspopup="menu"
                aria-expanded={menu === 'workspace'}
                title={composer.root || t('ai.noWorkspace')}
                onClick={() => setMenu((m) => (m === 'workspace' ? null : 'workspace'))}
              >
                <FolderOpen size={12} />
                <span className="composer-seg-label">
                  {composer.root ? (composer.root.split(/[\\/]/).filter(Boolean).pop() ?? composer.root) : t('ai.noWorkspace')}
                </span>
                <ChevronDown size={11} />
              </button>
              {menu === 'workspace' && (
                <div className="composer-pop" role="menu" data-pop="composer-menu">
                  <div className="composer-pop-head">{t('ai.workspaceTitle')}</div>
                  {composer.root && <div className="composer-pop-current"><code>{composer.root}</code></div>}
                  <button type="button" className="composer-pop-row" onClick={() => { setMenu(null); composer.onOpenFolder(); }}>
                    <FolderOpen size={12} /><span>{t('guide.chooseFolder')}</span>
                  </button>
                  {composer.recent.slice(0, 5).map((r) => (
                    <button type="button" key={r.root} className="composer-pop-row" onClick={() => { setMenu(null); composer.onOpenWorkspace(r.root); }}>
                      <span className="composer-pop-label">{r.label}</span>
                      <span className="composer-pop-hint">{r.root}</span>
                    </button>
                  ))}
                </div>
              )}
            </span>

            <span className="composer-seg-wrap">
              <button
                type="button"
                className={`composer-seg ${menu === 'permission' ? 'is-open' : ''}`}
                aria-haspopup="menu"
                aria-expanded={menu === 'permission'}
                onClick={() => setMenu((m) => (m === 'permission' ? null : 'permission'))}
              >
                <Shield size={12} />
                <span className="composer-seg-label">{t(PERMISSIONS.find((p) => p.id === composer.permission)?.titleKey ?? 'ai.permission.open')}</span>
                <ChevronDown size={11} />
              </button>
              {menu === 'permission' && (
                <div className="composer-pop" role="menu" data-pop="composer-menu">
                  <div className="composer-pop-head">{t('ai.permissionTitle')}</div>
                  {PERMISSIONS.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      className={`composer-pop-row ${composer.permission === p.id ? 'is-active' : ''}`}
                      onClick={() => { setMenu(null); composer.onPermission(p.id); }}
                    >
                      <span className="composer-pop-label">{t(p.titleKey)}</span>
                      <span className="composer-pop-hint">{t(p.hintKey)}</span>
                    </button>
                  ))}
                  <div className="composer-pop-note">{t('ai.permissionPending')}</div>
                </div>
              )}
            </span>

            <span className="composer-seg-wrap">
              <button
                type="button"
                className={`composer-seg ${menu === 'model' ? 'is-open' : ''}`}
                aria-haspopup="menu"
                aria-expanded={menu === 'model'}
                title={currentModelLabel}
                onClick={() => setMenu((m) => (m === 'model' ? null : 'model'))}
              >
                <Sparkles size={12} />
                <span className="composer-seg-label">{currentModelLabel}</span>
                <ChevronDown size={11} />
              </button>
              {menu === 'model' && (
                <div className="composer-pop" role="menu" data-pop="composer-menu">
                  <div className="composer-pop-head">{t('ai.modelTitle')}</div>
                  {composer.providers.length === 0 && <div className="composer-pop-note">{t('models.keyMissing')}</div>}
                  {composer.providers.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      className={`composer-pop-row ${composer.currentProvider === p.id ? 'is-active' : ''}`}
                      disabled={!p.keyPresent || composer.pendingProvider === p.id}
                      title={!p.keyPresent ? t('models.keyMissing') : undefined}
                      onClick={() => { setMenu(null); composer.onSwitchProvider(p.id); }}
                    >
                      <span className="composer-pop-label">{p.model || providerLabel(p)}</span>
                      <span className="composer-pop-hint">
                        {providerLabel(p)}
                        {composer.pendingProvider === p.id ? ` · ${t('models.switching')}`
                          : !p.keyPresent ? ` · ${t('models.keyMissing')}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </span>

            <span className="foot-spacer" />
            <button type="button" className="send-btn" onClick={submit} disabled={blocked} aria-label={t('common.send')}><SemanticIcon name="send" size={15} /></button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Advisor
// ---------------------------------------------------------------------------

const ANNOTATION_KINDS: Annotation['kind'][] = ['question', 'correction', 'reference', 'tool-call error'];

export function AdvisorCanvas({
  source, annotations, onAdd, onSubmit, handoff, items, sourceIsSample,
}: {
  source: string;
  annotations: Annotation[];
  onAdd: (a: Omit<Annotation, 'id'>) => void;
  onSubmit: () => void;
  handoff: number;
  items: TranscriptItem[];
  sourceIsSample: boolean;
}) {
  useI18n();
  const [sel, setSel] = useState<{ start: number; end: number; text: string; x: number; y: number } | null>(null);
  const [kind, setKind] = useState<Annotation['kind']>('correction');
  const [note, setNote] = useState('');
  const canvas = useRef<HTMLDivElement>(null);

  const onMouseUp = () => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !canvas.current) return;
    const range = s.getRangeAt(0);
    const startEl = (range.startContainer.parentElement ?? null)?.closest('[data-i]') as HTMLElement | null;
    const endEl = (range.endContainer.parentElement ?? null)?.closest('[data-i]') as HTMLElement | null;
    if (!startEl || !endEl) return;
    const start = Math.min(Number(startEl.dataset.i), Number(endEl.dataset.i));
    const end = Math.max(Number(startEl.dataset.i), Number(endEl.dataset.i)) + 1;
    const rect = range.getBoundingClientRect();
    setSel({ start, end, text: source.slice(start, end), x: rect.left, y: rect.bottom + 8 });
    setNote('');
  };

  const marked = useMemo(() => {
    const set = new Set<number>();
    annotations.forEach((a) => { for (let i = a.start; i < a.end; i++) set.add(i); });
    return set;
  }, [annotations]);

  return (
    <section className="full-view advisor" data-ai="true">
      <div className="full-head">
        <div className="full-head-left">
          <span className="eyebrow">advisor</span>
          <span className="full-title">{t('advisor.reviewer')}</span>
          <span className="paused-pill">{t('advisor.paused')}</span>
        </div>
        <span className="micro">{t('advisor.recorded')}</span>
      </div>

      <div className="advisor-body">
        <div className="review-canvas" ref={canvas} onMouseUp={onMouseUp}>
          {sourceIsSample && <span className="sample-tag review-sample-tag">{t('advisor.sampleTag')}</span>}
          <div className="review-gutter">
            {source.split('\n').map((_, i) => <span key={`gutter-${i}`}>{i + 1}</span>)}
          </div>
          <pre className="review-code">
            {source.split('').map((c, i) => (
              <span key={`char-${i}`} data-i={i} className={marked.has(i) ? 'is-marked' : ''}>{c}</span>
            ))}
          </pre>
        </div>

        <aside className="annotation-rail">
          <div className="rail-head">
            <span className="eyebrow">{t('advisor.annotations')}</span>
            <span className="count">{annotations.length}</span>
          </div>
          {annotations.length === 0 ? (
            <EmptyState variant="zero" title={t('advisor.empty')} desc={t('advisor.emptyDesc')} icon={<EMPTY_ICONS.file size={18} />} compact
              actions={[{ label: t('advisor.focusCanvas'), onClick: () => canvas.current?.focus(), primary: true }]} />
          ) : (
            <div className="annotation-list">
              {annotations.map((a) => (
                <div className={`annotation-card kind-${a.kind.replace(/\s/g, '-')}`} key={a.id}>
                  <span className={`kind-tag ${a.kind.replace(/\s/g, '-')}`}>{a.kind}</span>
                  <code>{a.span.slice(0, 70)}</code>
                  {a.note && <p>{a.note}</p>}
                </div>
              ))}
            </div>
          )}
          <div className="rail-foot">
            <button className="primary-btn" disabled={annotations.length === 0 || handoff > 0} onClick={onSubmit}>
              <Layers size={13} /> {t('advisor.submit')}
            </button>
          </div>
        </aside>
      </div>

      {sel && (
        <div className="annotation-pop" style={clampPos(sel.x, sel.y, 340, 260)} data-pop="annotation-pop">
          <div className="pop-head"><Quote size={12} /><code>{sel.text.slice(0, 48)}</code><button onClick={() => setSel(null)} aria-label={t('common.close')}><X size={12} /></button></div>
          <div className="kind-row">
            {ANNOTATION_KINDS.map((k) => (
              <button key={k} className={kind === k ? 'is-on' : ''} onClick={() => setKind(k)}>{k}</button>
            ))}
          </div>
          <textarea rows={2} autoFocus placeholder={t('advisor.notice')} value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="primary-btn small" onClick={() => {
            onAdd({ start: sel.start, end: sel.end, span: sel.text, kind, note });
            setSel(null);
            window.getSelection()?.removeAllRanges();
          }}><Check size={12} /> {t('advisor.add')}</button>
        </div>
      )}

      {handoff > 0 && (
        <div className="handoff">
          <div className="handoff-card" data-pointer>
            <span className="eyebrow">{t('advisor.handoff')}</span>
            <h2>advisor <ChevronRight size={20} /> deepsleep</h2>
            {[t('advisor.add'), t('advisor.paused'), t('deepsleep.title'), t('deepsleep.subtitle')].map((s, i) => (
              <div key={i} className={`handoff-step ${handoff > i ? 'is-done' : ''} ${handoff === i + 1 ? 'is-active' : ''}`}>
                <span>{handoff > i ? <Check size={12} /> : i + 1}</span>{s}
              </div>
            ))}
            <div className="handoff-log">{items.slice(-2).map((i) => <p key={i.uid}>{i.text ?? i.output ?? ''}</p>)}</div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Deepsleep — a layer over the workbench, never a full view (DESIGN §8.4).
// ---------------------------------------------------------------------------

export function DeepsleepView({
  items, briefing, onResume, onResumeSession, onWake, onDismissBriefing,
}: {
  items: TranscriptItem[];
  briefing: string[] | null;
  onResume: () => void;
  onResumeSession: () => void;
  onWake: () => void;
  onDismissBriefing: () => void;
}) {
  useI18n();
  const chainSteps = useMemo(
    () => buildUnits(items).flatMap((u) => (u.kind === 'chain' ? u.steps : [])),
    [items],
  );
  const [sleepRows, setSleepRows] = useState<string[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const pushRow = () => {
      const now = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      setSleepRows((rows) => [...rows.slice(-3), `${p(now.getHours())}:${p(now.getMinutes())}`]);
    };
    tickRef.current = setInterval(pushRow, 4000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  return (
    <section className="deepsleep-layer deepsleep" data-ai="true">
      <div className="night-grain" />
      <div className="ambient" aria-hidden="true" />
      <div className="view-frame" aria-hidden="true" />
      <div className="deepsleep-center">
        <div className="breath"><BrandMark size={24} className="breath-prism" /></div>
        <span className="eyebrow">deepsleep</span>
        <h1>{t('deepsleep.title')}</h1>
        <p className="deepsleep-sub">{t('deepsleep.subtitle')}</p>
        <p className="sleep-note">{t('deepsleep.note')}</p>
        <div className="sleep-meta">
          <span><CircleDot size={12} />{t('deepsleep.pause')}</span>
        </div>
        <div className="sleep-log">
          <p>{t('deepsleep.noLog')}</p>
          <p className="sleep-log-desc">{t('deepsleep.noLogDesc')}</p>
          {sleepRows.map((time, i) => (
            <p key={i} className="sleep-log-row">
              {t('deepsleep.noLog')}
              <span className="sleep-log-sep" aria-hidden="true" />
              {time}
            </p>
          ))}
        </div>
        {chainSteps.length > 0 && (
          <ExecutionChain
            steps={chainSteps}
            title={(
              <>
                {t('deepsleep.chainTitleLeft')}
                <span className="chain-title-sep" aria-hidden="true" />
                {t('deepsleep.chainTitleRight', { n: chainSteps.length })}
              </>
            )}
          />
        )}
        {briefing === null && (
          <div className="sleep-briefing-hint">
            <p>{t('deepsleep.noBriefing')}</p>
            <p>{t('deepsleep.noBriefingDesc')}</p>
          </div>
        )}
      </div>

      <div className="deepsleep-actions">
        <button type="button" className="primary-btn deepsleep-resume" onClick={onResume} title={t('deepsleep.resumeHint')}>
          {t('deepsleep.resume')}
        </button>
        <button type="button" className="secondary-btn" onClick={onWake}>{t('deepsleep.wake')}</button>
      </div>

      {briefing && (
        <div className="wake-overlay">
          <div className="wake-card" data-pointer>
            <div className="wake-top">
              <span className="eyebrow">{t('wake.title')}</span>
              <span className="wake-badge">{t('wake.badge')}</span>
              <button type="button" className="wake-card-close" aria-label={t('common.close')} onClick={onDismissBriefing}>
                <X size={13} />
              </button>
            </div>
            <h2>{t('wake.title')}</h2>
            {briefing.length === 0 ? (
              <p className="wake-empty">{t('wake.empty')}</p>
            ) : (
              <>
                <p className="wake-lead">{t('wake.lead')}</p>
                <ul>
                  {briefing.slice(0, 5).map((l, i) => (
                    <li key={`${i}:${l}`}><span>{String(i + 1).padStart(2, '0')}</span>{l}</li>
                  ))}
                </ul>
                {briefing.length > 5 && <p className="wake-more">{t('wake.more', { n: briefing.length - 5 })}</p>}
              </>
            )}
            <div className="wake-actions">
              <button type="button" className="secondary-btn wake-card-back" onClick={onDismissBriefing}>
                {t('wake.back')}
              </button>
              {briefing.length > 0 && (
                <button type="button" className="primary-btn" onClick={onResumeSession}><SemanticIcon name="send" size={13} /> {t('wake.resume')}</button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Goal — a single sentence, not three giant cards (DESIGN §8.2).
// ---------------------------------------------------------------------------

const GOAL_STARTERS = ['goal.t1', 'goal.t2', 'goal.t3'];

export function GoalView({
  items, goal, running, onSend, sessions, activeKey, sessionsOpen,
  onNewSession, onActivate, onClose, onToggleSessions,
}: {
  items: TranscriptItem[];
  goal: string | null;
  running: boolean;
  onSend: (text: string) => void;
  sessions: SessionTabInfo[];
  activeKey: string;
  sessionsOpen: boolean;
  onNewSession: () => void;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  onToggleSessions: () => void;
}) {
  useI18n();
  const [text, setText] = useState('');
  const visible = items.filter((i) => i.kind === 'user' || i.kind === 'answer' || i.kind === 'speech');
  const submit = () => { const v = text.trim(); if (!v) return; onSend(v); setText(''); };

  return (
    <section className={`full-view goal ${sessionsOpen ? 'has-sessions' : ''}`} data-ai="true">
      <div className="ambient" aria-hidden="true" />
      <div className="view-frame" aria-hidden="true" />
      <div className="goal-inner">
        <div className="goal-card">
          <span className="eyebrow">{t('goal.statusStrip')}</span>
          <p>{goal ?? t('goal.noGoal')}</p>
        </div>

        <div className="goal-transcript">
          {visible.length === 0 ? (
            <div className="goal-empty">
              <div className="goal-starters">
                {GOAL_STARTERS.map((k) => (
                  <button type="button" key={k} className="goal-template" data-pointer onClick={() => setText(t(k))}>{t(k)}</button>
                ))}
              </div>
              <p className="goal-seed">{t('goal.seedDesc')}</p>
            </div>
          ) : visible.map((i) => (
            <div key={i.uid} className={`goal-line ${i.kind}`}>
              <span>{i.kind === 'user' ? t('goal.you') : t('goal.pristem')}</span>
              <p>{i.text}</p>
              <button type="button" className="msg-actions-inline" title={t('common.copy')} aria-label={t('common.copy')}
                onClick={() => { void writeClipboard(i.text ?? ''); }}><SemanticIcon name="copy" size={13} /></button>
            </div>
          ))}
        </div>

        <div className="goal-composer">
          <div className="goal-composer-head">
            {running && <span className="running-pill is-working">{t('ai.runState.working')}</span>}
          </div>
          <div className="goal-input" data-composer>
            <textarea rows={2} autoFocus value={text} placeholder={t('goal.placeholder')}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
            <button className="send-btn" onClick={submit} aria-label={t('common.send')}><SemanticIcon name="send" size={15} /></button>
          </div>
        </div>
      </div>

      {sessionsOpen && (
        <SessionPanel
          sessions={sessions}
          activeKey={activeKey}
          onActivate={onActivate}
          onNew={onNewSession}
          onClose={onClose}
          onCollapse={onToggleSessions}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Summon
// ---------------------------------------------------------------------------

export function Summon({ x, y, onSend, onClose }: {
  x: number; y: number; onSend: (text: string) => void; onClose: () => void;
}) {
  useI18n();
  const [text, setText] = useState('');
  return (
    <div className="summon" style={clampPos(x, y, 340, 170)} data-pop="summon">
      <div className="summon-head">
        <span className="summon-mark"><BrandMark size={16} /></span>
        <span className="eyebrow">{t('summon.title')}</span>
        <span className="micro">helping</span>
        <button onClick={onClose} aria-label={t('common.close')}><X size={12} /></button>
      </div>
      <input autoFocus value={text} placeholder={t('summon.placeholder')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter' && text.trim()) onSend(text.trim());
        }} />
      <div className="summon-foot">
        <span>{t('summon.foot')}</span>
        <span className="micro">{t('summon.dormant')}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status bar — the only home of the connection state and the dial.
// ---------------------------------------------------------------------------

export interface StatusInfo {
  cursor?: { line: number; col: number };
  language?: string;
  eol?: string;
  indent?: number;
  branch?: string;
  errors?: number;
  warnings?: number;
}

export function StatusBar({
  sessionLabel, conn, onRetryConnection, protocol, a11yRef, alertRef,
}: {
  sessionLabel: string;
  conn: ConnState;
  onRetryConnection: () => void;
  protocol: string | null;
  a11yRef: RefObject<HTMLSpanElement | null>;
  alertRef: RefObject<HTMLSpanElement | null>;
}) {
  useI18n();
  return (
    <footer className="statusbar">
      <span className="status-item status-session">{sessionLabel}</span>
      <div className="status-group-right">
        <ConnectionBadge state={conn} onRetry={onRetryConnection} />
        {protocol && <span className="proto-badge" title={t('status.kernel')}>{protocol}</span>}
        <LangSwitch />
      </div>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true" ref={a11yRef} />
      <span className="sr-only" role="alert" aria-live="assertive" aria-atomic="true" ref={alertRef} />
    </footer>
  );
}
