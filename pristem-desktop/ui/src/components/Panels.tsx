import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GitBranch, RefreshCw, TerminalSquare } from 'lucide-react';
import { SemanticIcon } from './SemanticIcon';
import { EmptyState, EMPTY_ICONS } from './EmptyState';
import { t } from '../i18n';
import type { FileEntry, IoRequest } from '../types';
import { readOutput, subscribeOutput } from '../terminalBus';

export interface RecentWorkspace { root: string; label: string; ts: number }
const RECENT_KEY = 'pristem.recentWorkspaces';
export function readRecent(): RecentWorkspace[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as RecentWorkspace[]; }
  catch { return []; }
}
export function pushRecent(root: string) {
  if (!root) return;
  const label = root.split(/[\\/]/).filter(Boolean).pop() ?? root;
  const list = readRecent().filter((r) => r.root !== root);
  list.unshift({ root, label, ts: Date.now() });
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8))); } catch { /* ignore */ }
}
export function removeRecent(root: string) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(readRecent().filter((r) => r.root !== root))); } catch { /* ignore */ }
}
export function clearRecent() {
  try { localStorage.setItem(RECENT_KEY, '[]'); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Welcome — no workspace. All actions are real; nothing is disabled.
// ---------------------------------------------------------------------------
export function Welcome({
  onOpenFolder, onNewProject, onClone, onNewFile, onOpenRecent,
}: {
  onOpenFolder: () => void;
  /** Absent when the shell has no native picker (headless): hide the action. */
  onNewProject?: () => void;
  onClone: (url: string) => void;
  onNewFile: () => void;
  onOpenRecent: (root: string) => void;
}) {
  const [url, setUrl] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const recent = readRecent();
  const visible = showAll ? recent : recent.slice(0, 4);
  const clone = () => {
    const v = url.trim();
    if (!/^(https?:\/\/|git@)/i.test(v)) { setInvalid(true); return; }
    setInvalid(false);
    onClone(v);
  };
  return (
    <div className="welcome" role="region" aria-label={t('welcome.title')}>
      <aside className="welcome-rail">
        <span className="welcome-rail-title">{t('welcome.noFolder')}</span>
        <span className="welcome-rail-desc">{t('welcome.noFolderDesc')}</span>
        <button type="button" className="text-btn" onClick={onOpenFolder}>{t('common.openFolder')}</button>
        <details className="welcome-help">
          <summary>{t('welcome.cloneHelp')}</summary>
          <p>{t('welcome.cloneHelpBody')}</p>
        </details>
        <button type="button" className="text-btn" onClick={() => setUrl((v) => v || ' ')}>{t('welcome.clone')}</button>
      </aside>
      <div className="welcome-main">
        <h1>{t('welcome.title')}</h1>
        <p className="welcome-lead">{t('welcome.desc')}</p>
        <div className="welcome-actions">
          <button type="button" className="welcome-action is-primary" data-pointer onClick={onOpenFolder}>
            <span className="welcome-action-icon"><SemanticIcon name="folder" size={18} /></span>
            <span className="welcome-action-label">{t('common.openFolder')}</span>
          </button>
          {onNewProject && (
            <button type="button" className="welcome-action" data-pointer onClick={onNewProject}>
              <span className="welcome-action-icon"><SemanticIcon name="folder" size={18} /></span>
              <span className="welcome-action-label">{t('welcome.newProject')}</span>
            </button>
          )}
          <button type="button" className="welcome-action" data-pointer onClick={onNewFile}>
            <span className="welcome-action-icon"><SemanticIcon name="pencil" size={18} /></span>
            <span className="welcome-action-label">{t('common.newFile')}</span>
          </button>
        </div>
        <div className="welcome-clone">
          <span className="welcome-clone-label">{t('welcome.clone')}</span>
          <div className="welcome-clone-row">
            <input
              value={url.trim() ? url : ''}
              placeholder={t('welcome.placeholder')}
              aria-label={t('welcome.cloneUrl')}
              onChange={(e) => { setUrl(e.target.value); setInvalid(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') clone(); }}
            />
            <button type="button" className="primary-btn small" onClick={clone}>{t('welcome.clone')}</button>
          </div>
          {invalid && <span className="welcome-clone-error">{t('welcome.cloneInvalid')}</span>}
        </div>
        <div className="welcome-recent">
          <div className="welcome-recent-head">
            <span>{t('welcome.recent')}</span>
            {recent.length > 4 && (
              <button type="button" className="text-btn" onClick={() => setShowAll((v) => !v)}>{t('common.more')}</button>
            )}
          </div>
          {recent.length === 0 ? (
            <div className="welcome-recent-empty">{t('welcome.recentEmpty')}. {t('welcome.recentEmptyDesc')}.</div>
          ) : (
            <ul>
              {visible.map((r) => (
                <li key={r.root}>
                  <button type="button" onClick={() => onOpenRecent(r.root)}>
                    <span>{r.label}</span><code>{r.root}</code>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search — recursive content search (fs.search) + replace (fs.replace).
// Self-contained: owns query/options/results; 300ms debounce + sequence cancel.
// ---------------------------------------------------------------------------
export interface SearchHit { path: string; line: number; column?: number; snippet: string }

interface SearchState { hits: SearchHit[]; files: number; truncated: boolean; scanned: number }

export function SearchPanel({
  sendIo, onOpen, onReplaced, openPaths, activePath,
}: {
  sendIo: (r: IoRequest) => Promise<unknown>;
  onOpen: (path: string, line: number) => void;
  onReplaced: () => void;
  openPaths: string[];
  activePath: string | null;
}) {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regexMode, setRegexMode] = useState(false);
  const [include, setInclude] = useState('');
  const [exclude, setExclude] = useState('');
  const [scope, setScope] = useState<'all' | 'open' | 'folder'>('all');
  const [state, setState] = useState<SearchState>({ hits: [], files: 0, truncated: false, scanned: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replacement, setReplacement] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const seq = useRef(0);
  const replaceRef = useRef<HTMLInputElement>(null);
  const openKey = openPaths.join('\n');
  const folder = activePath ? activePath.split('/').slice(0, -1).join('/') : '';
  const effectiveInclude = scope === 'folder'
    ? (folder ? `${folder}/**` : '**')
    : include.trim();

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) { setState({ hits: [], files: 0, truncated: false, scanned: 0 }); setError(null); setLoading(false); return; }
    const mySeq = ++seq.current;
    setLoading(true); setError(null);
    try {
      const r = (await sendIo({
        op: 'fs.search', query: q, caseSensitive, wholeWord, regex: regexMode,
        include: effectiveInclude || undefined, exclude: exclude.trim() || undefined,
        paths: scope === 'open' ? openKey.split('\n').filter(Boolean) : undefined,
      })) as { ok?: boolean; hits?: SearchHit[]; files?: number; truncated?: boolean; scanned?: number; error?: string } | undefined;
      if (mySeq !== seq.current) return;
      if (!r || r.ok === false) { setError(r?.error ?? t('search.failed')); setState({ hits: [], files: 0, truncated: false, scanned: 0 }); }
      else setState({ hits: r.hits ?? [], files: r.files ?? 0, truncated: !!r.truncated, scanned: r.scanned ?? 0 });
    } catch {
      if (mySeq === seq.current) setError(t('search.failed'));
    } finally {
      if (mySeq === seq.current) setLoading(false);
    }
  }, [query, caseSensitive, wholeWord, regexMode, include, exclude, sendIo, scope, openKey, effectiveInclude]);

  useEffect(() => {
    const id = setTimeout(() => void runSearch(), 300);
    return () => clearTimeout(id);
  }, [runSearch]);

  useEffect(() => {
    const onFocusReplace = () => { setReplaceOpen(true); setTimeout(() => replaceRef.current?.focus(), 0); };
    window.addEventListener('pristem:focus-replace', onFocusReplace);
    return () => window.removeEventListener('pristem:focus-replace', onFocusReplace);
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, SearchHit[]>();
    for (const h of state.hits) {
      const arr = map.get(h.path) ?? [];
      arr.push(h); map.set(h.path, arr);
    }
    return Array.from(map.entries());
  }, [state.hits]);

  const doReplace = async () => {
    const q = query.trim();
    if (!q || replacing) return;
    setReplacing(true); setConfirming(false);
    try {
      const r = (await sendIo({
        op: 'fs.replace', query: q, replacement, caseSensitive, wholeWord, regex: regexMode,
        include: effectiveInclude || undefined, exclude: exclude.trim() || undefined,
        paths: scope === 'open' ? openKey.split('\n').filter(Boolean) : undefined,
      })) as { ok?: boolean; files?: number; replacements?: number; error?: string } | undefined;
      if (r?.ok) {
        setDoneMsg(t('search.replaceDone', { n: r.replacements ?? 0, f: r.files ?? 0 }));
        onReplaced();
        void runSearch();
      } else setError(r?.error ?? t('search.failed'));
    } catch { setError(t('search.failed')); }
    finally { setReplacing(false); }
  };

  const toggleGroup = (path: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });

  const clearAll = () => { setQuery(''); setError(null); setDoneMsg(null); };
  const beginEdit = () => { if (query.trim()) setLoading(true); };
  const totalHits = state.hits.length;

  return (
    <section className="pane side-panel search-panel" aria-label={t('activity.search')}>
      <div className="pane-head"><span className="eyebrow">{t('activity.search')}</span></div>
      <div className="side-search">
        <input
          autoFocus
          value={query}
          placeholder={t('search.placeholder')}
          aria-label={t('activity.search')}
          onChange={(e) => { setQuery(e.target.value); setDoneMsg(null); if (e.target.value.trim()) setLoading(true); }}
        />
        {query && <button type="button" className="icon-btn" onClick={clearAll} aria-label={t('common.clear')}>×</button>}
      </div>
      <div className="search-toggles">
        <button type="button" className={`search-toggle${caseSensitive ? ' is-on' : ''}`} aria-pressed={caseSensitive} title={t('search.caseSensitive')} onClick={() => { setCaseSensitive((v) => !v); beginEdit(); }}>Aa</button>
        <button type="button" className={`search-toggle${wholeWord ? ' is-on' : ''}`} aria-pressed={wholeWord} title={t('search.wholeWord')} onClick={() => { setWholeWord((v) => !v); beginEdit(); }}>ab</button>
        <button type="button" className={`search-toggle${regexMode ? ' is-on' : ''}`} aria-pressed={regexMode} title={t('search.regex')} onClick={() => { setRegexMode((v) => !v); beginEdit(); }}>.*</button>
        <button type="button" className={`search-toggle${replaceOpen ? ' is-on' : ''}`} aria-pressed={replaceOpen} title={t('search.replace')} onClick={() => setReplaceOpen((v) => !v)}>⇄</button>
      </div>
      <div className="search-filters">
        <input value={include} placeholder={t('search.include')} aria-label={t('search.include')} onChange={(e) => { setInclude(e.target.value); beginEdit(); }} />
        <input value={exclude} placeholder={t('search.exclude')} aria-label={t('search.exclude')} onChange={(e) => { setExclude(e.target.value); beginEdit(); }} />
      </div>
      <div className="search-scope" role="group" aria-label={t('search.scope')}>
        <button type="button" className={scope === 'all' ? 'is-on' : ''} aria-pressed={scope === 'all'} onClick={() => { setScope('all'); beginEdit(); }}>{t('search.scopeAll')}</button>
        <button type="button" className={scope === 'open' ? 'is-on' : ''} aria-pressed={scope === 'open'} disabled={openPaths.length === 0} onClick={() => { setScope('open'); beginEdit(); }}>{t('search.scopeOpen')}</button>
        <button type="button" className={scope === 'folder' ? 'is-on' : ''} aria-pressed={scope === 'folder'} disabled={!activePath} title={activePath ? folder || '/' : undefined} onClick={() => { setScope('folder'); beginEdit(); }}>{t('search.scopeFolder')}</button>
      </div>
      {replaceOpen && (
        <div className="search-replace">
          <input ref={replaceRef} value={replacement} placeholder={t('search.replacePlaceholder')} aria-label={t('search.replace')} onChange={(e) => setReplacement(e.target.value)} />
          {confirming ? (
            <div className="search-replace-confirm">
              <span>{t('search.replaceConfirm', { n: totalHits })}</span>
              <div className="search-replace-preview">
                {groups.slice(0, 10).map(([path, hits]) => (
                  <div className="search-preview-row" key={path}>
                    <code>{path}</code><span>{hits.length}</span>
                  </div>
                ))}
                {groups.length > 10 && <div className="search-preview-more">{t('search.previewMore', { n: groups.length - 10 })}</div>}
              </div>
              <button type="button" className="primary-btn small" disabled={replacing} onClick={() => void doReplace()}>{t('search.confirm')}</button>
              <button type="button" className="text-btn" onClick={() => setConfirming(false)}>{t('common.cancel')}</button>
            </div>
          ) : (
            <button type="button" className="primary-btn small" disabled={!query.trim() || totalHits === 0 || replacing} onClick={() => setConfirming(true)}>{t('search.replaceAll')}</button>
          )}
        </div>
      )}
      {doneMsg && <div className="search-done">{doneMsg}</div>}
      {error && <div className="search-error">{error}</div>}
      {loading ? (
        <EmptyState variant="loading" title={t('empty.loading')} desc={t('empty.loadingDesc')} icon={<EMPTY_ICONS.search size={18} />} compact />
      ) : !query.trim() ? (
        <EmptyState variant="zero" title={t('search.noQuery')} desc={t('search.noQueryDesc')} icon={<EMPTY_ICONS.search size={18} />} compact />
      ) : error ? null : state.hits.length === 0 ? (
        <EmptyState variant="noresult" title={t('editor.treeNoMatch')} desc={t('editor.treeNoMatchDesc')} query={query} icon={<EMPTY_ICONS.search size={18} />} compact
          actions={[{ label: t('common.clear'), onClick: clearAll, primary: true }]} />
      ) : (
        <div className="side-list search-results">
          <div className="search-summary">{t('search.results', { n: totalHits, f: state.files })}{state.truncated ? ` · ${t('search.truncated')}` : ''}</div>
          {groups.map(([path, hits]) => (
            <div className="search-group" key={path}>
              <button type="button" className="search-group-head" aria-expanded={!collapsed.has(path)} onClick={() => toggleGroup(path)}>
                <span className="search-group-caret">{collapsed.has(path) ? '▸' : '▾'}</span>
                <span className="search-group-path">{path}</span>
                <span className="search-group-count">{hits.length}</span>
              </button>
              {!collapsed.has(path) && hits.map((h, i) => (
                <button type="button" key={`${path}:${h.line}:${i}`} className="search-hit" onClick={() => onOpen(path, h.line)}>
                  <span className="search-hit-line">{h.line}</span>
                  <span className="search-hit-snippet">{h.snippet}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Git — one-shot `proc.exec` calls (request/response, stdout+stderr merged).
// Independent of the user's PTY shell: no sentinels, no silent windows.
// ---------------------------------------------------------------------------
interface GitState {
  branch: string; changes: GitChange[];
  log: string[]; diff: { path: string; text: string } | null; loading: boolean; notRepo: boolean;
}
/** One `git status --porcelain` entry: index status, worktree status, path. */
interface GitChange { path: string; index: string; work: string; orig?: string }

// Arguments are passed as an array, so git never goes through cmd.exe: a commit
// message or file name cannot be re-parsed as a shell command.
async function gitExec(
  sendIo: (r: IoRequest) => Promise<unknown>,
  args: string[],
): Promise<{ ok: boolean; stdout: string; code: number }> {
  const r = (await sendIo({ op: 'proc.exec', command: 'git', args })) as
    { ok?: boolean; stdout?: string; code?: number } | undefined;
  return { ok: r?.ok === true, stdout: r?.stdout ?? '', code: r?.code ?? -1 };
}

/** `--porcelain=v1 -z`: NUL-separated, no quoting; a rename is followed by its old path. */
function parseGitStatus(raw: string): GitChange[] {
  const parts = raw.split('\0');
  const out: GitChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const index = entry[0];
    const work = entry[1];
    const path = entry.slice(3);
    let orig: string | undefined;
    if (index === 'R' || index === 'C') orig = parts[++i];
    if (path) out.push({ path, index, work, orig });
  }
  return out;
}

/** A change row is staged when the index differs from HEAD. */
const isStaged = (c: GitChange) => c.index !== ' ' && c.index !== '?';
const isUnstaged = (c: GitChange) => c.index === '?' || (c.work !== ' ' && c.work !== '?');

export function GitPanel({
  sendIo, onOpenFolder, onFocusTerminal,
}: {
  sendIo: (r: IoRequest) => Promise<unknown>;
  onOpenFolder: () => void;
  onFocusTerminal: () => void;
}) {
  const [state, setState] = useState<GitState>({ branch: '', changes: [], log: [], diff: null, loading: true, notRepo: false });
  const [message, setMessage] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);
  const discardTimer = useRef<number | null>(null);
  const diffSeq = useRef(0);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      // Keep the previous rows visible while refreshing: only the first load
      // shows the loading state, so staging never blanks the panel.
      const inside = await gitExec(sendIo, ['rev-parse', '--is-inside-work-tree']);
      if (!alive) return;
      if (!inside.ok || inside.stdout.trim() !== 'true') {
        setState({ branch: '', changes: [], log: [], diff: null, loading: false, notRepo: true });
        return;
      }
      const [status, branch, log] = await Promise.all([
        gitExec(sendIo, ['status', '--porcelain=v1', '-z']),
        gitExec(sendIo, ['branch', '--show-current']),
        gitExec(sendIo, ['log', '--oneline', '-8']),
      ]);
      if (!alive) return;
      const changes = parseGitStatus(status.stdout)
        .sort((a, b) => a.path.localeCompare(b.path));
      const commits = log.stdout.split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => /^[0-9a-f]{7,}\s/.test(l))
        .slice(0, 8);
      setState({
        branch: branch.stdout.trim(),
        changes,
        log: commits,
        diff: null, loading: false, notRepo: false,
      });
    };
    void run();
    return () => { alive = false; };
  }, [sendIo, refresh]);

  /** Run one git command through the argument channel; surface the first failure. */
  const exec = async (args: string[]): Promise<boolean> => {
    setBusy(true);
    setError(null);
    const r = await gitExec(sendIo, args);
    setBusy(false);
    if (!r.ok || r.code !== 0) {
      setError(r.stdout.trim() || `${args.join(' ')} — ${t('git.actionFailed')}`);
      return false;
    }
    return true;
  };

  const act = async (args: string[]) => {
    if (await exec(args)) setRefresh((v) => v + 1);
  };

  const stage = (c: GitChange) => void act(['add', '--', c.path]);
  const unstage = (c: GitChange) => void act(['restore', '--staged', '--', c.path]);

  const askDiscard = (path: string) => {
    setConfirmDiscard(path);
    if (discardTimer.current) window.clearTimeout(discardTimer.current);
    discardTimer.current = window.setTimeout(() => setConfirmDiscard(null), 3200);
  };

  // Discard is two-step. Untracked files (and staged additions) go to the
  // workspace trash, never unlink: the same rule as explorer delete.
  const discard = async (c: GitChange) => {
    setConfirmDiscard(null);
    setBusy(true);
    setError(null);
    if (c.index === '?') {
      const r = (await sendIo({ op: 'fs.delete', path: c.path })) as { ok?: boolean; error?: string } | undefined;
      if (!r?.ok) setError(r?.error ?? t('git.actionFailed'));
    } else if (c.index === 'A') {
      await gitExec(sendIo, ['restore', '--staged', '--', c.path]);
      const r = (await sendIo({ op: 'fs.delete', path: c.path })) as { ok?: boolean; error?: string } | undefined;
      if (!r?.ok) setError(r?.error ?? t('git.actionFailed'));
    } else {
      const r = await gitExec(sendIo, ['checkout', '--', c.path]);
      if (!r.ok || r.code !== 0) setError(r.stdout.trim() || t('git.actionFailed'));
    }
    setBusy(false);
    setRefresh((v) => v + 1);
  };

  const commit = async () => {
    const m = message.trim();
    if (!m || busy || !state.changes.some(isStaged)) return;
    setBusy(true);
    setError(null);
    const r = await gitExec(sendIo, ['commit', '-m', m]);
    setBusy(false);
    if (!r.ok || r.code !== 0) {
      setError(r.stdout.trim() || t('git.commitFailed'));
      return;
    }
    setMessage('');
    setRefresh((v) => v + 1);
  };

  const openDiff = async (c: GitChange) => {
    const seq = ++diffSeq.current;
    setState((s) => ({ ...s, diff: { path: c.path, text: '' } }));
    const worktree = await gitExec(sendIo, ['diff', '--', c.path]);
    let text = worktree.stdout;
    if (!text.trim()) {
      const staged = await gitExec(sendIo, ['diff', '--cached', '--', c.path]);
      text = staged.stdout;
    }
    if (seq !== diffSeq.current) return;
    setState((s) => ({ ...s, diff: { path: c.path, text } }));
  };

  const staged = state.changes.filter(isStaged);
  const unstaged = state.changes.filter(isUnstaged);

  const row = (c: GitChange, side: 'staged' | 'changes') => {
    const badge = side === 'staged' ? c.index : (c.index === '?' ? 'U' : c.work);
    return (
      <div key={`${side}:${c.path}`} className={`git-change-row s-${(badge || 'M').toUpperCase()}`} data-git-row={c.path} data-git-side={side}>
        <button
          type="button"
          className="git-change-main"
          onClick={() => void openDiff(c)}
          title={c.orig ? `${c.orig} → ${c.path}` : c.path}
        >
          <span className="git-change-status">{badge || 'M'}</span>
          <span className="git-change-path">{c.path}</span>
        </button>
        <span className="git-change-actions">
          <button
            type="button"
            className="git-mini"
            data-git-action={side === 'staged' ? 'unstage' : 'stage'}
            disabled={busy}
            title={side === 'staged' ? t('git.unstage') : t('git.stage')}
            aria-label={side === 'staged' ? t('git.unstage') : t('git.stage')}
            onClick={() => (side === 'staged' ? unstage(c) : stage(c))}
          >{side === 'staged' ? '−' : '+'}</button>
          {side === 'changes' && (
            confirmDiscard === c.path ? (
              <button type="button" className="git-mini is-confirm" data-git-action="discard" disabled={busy} onClick={() => void discard(c)}>
                {t('git.discardConfirm')}
              </button>
            ) : (
              <button
                type="button"
                className="git-mini"
                data-git-action="discard"
                disabled={busy}
                title={t('git.discard')}
                aria-label={t('git.discard')}
                onClick={() => askDiscard(c.path)}
              >
                <SemanticIcon name="trash" size={12} />
              </button>
            )
          )}
        </span>
      </div>
    );
  };

  return (
    <section className="pane side-panel git-panel" aria-label={t('git.panel')}>
      <div className="pane-head">
        <span className="eyebrow"><GitBranch size={12} /> {t('git.panel')}</span>
        <button type="button" className="icon-btn" onClick={() => setRefresh((v) => v + 1)} aria-label={t('common.refresh')}><RefreshCw size={12} /></button>
      </div>
      {state.loading ? (
        <EmptyState variant="loading" title={t('empty.loading')} desc={t('empty.loadingDesc')} compact />
      ) : state.notRepo ? (
        <EmptyState variant="error" title={t('git.notRepo')} desc={t('git.notRepoDesc')} compact
          actions={[
            { label: t('common.openFolder'), onClick: onOpenFolder, primary: true },
            { label: t('terminal.focus'), onClick: onFocusTerminal },
          ]} />
      ) : (
        <>
          <div className="git-branch">{state.branch || t('git.detached')}</div>
          {error && <div className="git-error" role="alert">{error}</div>}

          <div className="git-section-head">
            <span>{t('git.staged')} ({staged.length})</span>
            {staged.length > 0 && (
              <button type="button" className="git-section-action" data-git-section-action="unstage-all" disabled={busy}
                onClick={() => void act(['restore', '--staged', '.'])}>{t('git.unstageAll')}</button>
            )}
          </div>
          {staged.length === 0
            ? <div className="git-inline-empty">{t('git.noChanges')}</div>
            : <div className="side-list git-changes">{staged.map((c) => row(c, 'staged'))}</div>}

          <div className="git-section-head">
            <span>{t('git.changes')} ({unstaged.length})</span>
            {unstaged.length > 0 && (
              <button type="button" className="git-section-action" data-git-section-action="stage-all" disabled={busy}
                onClick={() => void act(['add', '-A'])}>{t('git.stageAll')}</button>
            )}
          </div>
          {unstaged.length === 0
            ? <div className="git-inline-empty">{t('git.noChanges')}</div>
            : <div className="side-list git-changes">{unstaged.map((c) => row(c, 'changes'))}</div>}

          {state.diff && (
            <div className="git-diff" data-pop="git-diff">
              <div className="git-diff-head"><span>{state.diff.path}</span><button type="button" className="icon-btn" onClick={() => setState((s) => ({ ...s, diff: null }))} aria-label={t('common.close')}>×</button></div>
              {state.diff.text.trim() ? (
                <pre data-git-diff>
                  {state.diff.text.split(/\r?\n/).map((line, i) => {
                    const cls = /^(diff |index |--- |\+\+\+ )/.test(line) ? 'is-meta'
                      : line.startsWith('@@') ? 'is-hunk'
                        : line.startsWith('+') ? 'is-add'
                          : line.startsWith('-') ? 'is-del' : '';
                    return <span key={i} className={`git-diff-line ${cls}`}>{line || ' '}</span>;
                  })}
                </pre>
              ) : <span className="git-inline-empty">{t('git.noDiff')}. {t('git.noDiffDesc')}.</span>}
            </div>
          )}

          <div className="git-section-head">{t('git.log')}</div>
          {state.log.length === 0 ? (
            <div className="git-inline-empty">{t('git.noCommits')}</div>
          ) : (
            <ul className="git-log">{state.log.map((l, i) => <li key={`${l}:${i}`}>{l}</li>)}</ul>
          )}
          <div className="git-commit">
            <textarea rows={2} value={message} placeholder={t('git.commitPlaceholder')} onChange={(e) => setMessage(e.target.value)} />
            {staged.length === 0 && state.changes.length > 0 && (
              <span className="git-commit-hint">{t('git.stageFirst')}</span>
            )}
            <button type="button" className="primary-btn small" disabled={!message.trim() || busy || staged.length === 0} onClick={() => void commit()}>{t('git.commit')}</button>
          </div>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Output — the merged shell + kernel output stream (activity strip, tab 2).
// ---------------------------------------------------------------------------
export function OutputPanel({ onFocusTerminal }: { onFocusTerminal: () => void }) {
  const [, force] = useState(0);
  useEffect(() => subscribeOutput(() => force((v) => v + 1)), []);
  const lines = useMemo(() => readOutput(), [force]);
  if (lines.length === 0) {
    return (
      <div className="output-panel">
        <EmptyState
          variant="zero" title={t('output.empty')} desc={t('output.emptyDesc')}
          icon={<EMPTY_ICONS.file size={18} />}
          actions={[{ label: t('terminal.focus'), onClick: onFocusTerminal, primary: true }]}
        />
      </div>
    );
  }
  return (
    <div className="output-panel">
      {lines.map((l, i) => (
        <div className="output-line" key={`${l.instance}:${i}:${l.text.slice(0, 12)}`}>
          <span className="output-source">{l.source === 'kernel' ? t('output.sourceKernel') : t('terminal.instance', { n: l.instance + 1 })}</span>
          <span>{l.text}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outline — the current document's symbols (doc strip popover).
// ---------------------------------------------------------------------------
export interface OutlineSymbol { name: string; line: number; kind: string }
const SYMBOL_RE = /^\s*(?:#+\s*|(?:pub\s+)?fn\s+|function\s+|class\s+|struct\s+|impl\s+|interface\s+|export\s+(?:default\s+)?(?:function|class|const)\s+|def\s+)(\S+)/;
export function parseOutline(content: string): OutlineSymbol[] {
  const out: OutlineSymbol[] = [];
  content.split('\n').forEach((line, i) => {
    const m = SYMBOL_RE.exec(line);
    if (m) out.push({ name: m[1].replace(/[({:].*$/, ''), line: i + 1, kind: 'symbol' });
  });
  return out;
}

export function OutlineList({ symbols, onJump }: { symbols: OutlineSymbol[]; onJump: (line: number) => void }) {
  if (symbols.length === 0) {
    return (
      <EmptyState
        variant="zero" title={t('editor.noSymbols')} desc={t('editor.noSymbolsDesc')}
        icon={<EMPTY_ICONS.outline size={18} />} compact
        actions={[{ label: t('common.jumpToLine'), onClick: () => onJump(1), primary: true }]}
      />
    );
  }
  return (
    <div className="side-list outline-list">
      {symbols.slice(0, 200).map((s, i) => (
        <button type="button" key={`${s.name}:${i}`} className="outline-item" onClick={() => onJump(s.line)}>
          <span className="outline-name">{s.name}</span><span className="outline-line">{s.line}</span>
        </button>
      ))}
    </div>
  );
}

export function OutlinePop({ symbols, onJump, onClose }: {
  symbols: OutlineSymbol[]; onJump: (line: number) => void; onClose: () => void;
}) {
  return (
    <div className="outline-pop" data-pop="outline-pop" role="menu" aria-label={t('outline.title')}>
      <div className="outline-pop-head">{t('outline.title')}</div>
      {symbols.length === 0 ? (
        <span className="outline-pop-head">{t('editor.noSymbols')}</span>
      ) : (
        symbols.slice(0, 200).map((s, i) => (
          <button type="button" key={`${s.name}:${i}`} className="outline-item" onClick={() => { onJump(s.line); onClose(); }}>
            <span className="outline-name">{s.name}</span><span className="outline-line">{s.line}</span>
          </button>
        ))
      )}
    </div>
  );
}

/** Terminal history as a side panel — kept for the terminal output history. */
export function TerminalHistoryPanel({ onFocus }: { onFocus: () => void }) {
  const [, force] = useState(0);
  useEffect(() => subscribeOutput(() => force((v) => v + 1)), []);
  const lines = useMemo(() => readOutput().filter((l) => l.source === 'shell').map((l) => l.text), [force]);
  return (
    <section className="pane side-panel" aria-label={t('terminal.title')}>
      <div className="pane-head"><span className="eyebrow"><TerminalSquare size={12} /> {t('terminal.title')}</span></div>
      {lines.length === 0 ? (
        <EmptyState variant="zero" title={t('terminal.noOutput')} desc={t('terminal.noOutputDesc')} icon={<EMPTY_ICONS.file size={18} />} compact
          actions={[{ label: t('terminal.focus'), onClick: onFocus, primary: true }]} />
      ) : (
        <pre className="term-history">{lines.slice(-200).join('\n')}</pre>
      )}
    </section>
  );
}
