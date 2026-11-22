import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { PanelRightOpen } from 'lucide-react';
import { getService, resetService, writeClipboard, type Service } from './service';
import { EditorArea, EditorPane, FileTree, TerminalPane, type ActivityTab, type EditorGroup, type OpenFile, type Problem } from './workspace';
import { disposeAllModels, renameModel, setModelContent } from './editorModels';
import { Separators } from './components/Separators';
import { DEFAULT_SIZES, clampSize, readWorkspaceState, writeWorkspaceState, type SizeKind } from './workspaceState';
import { AdvisorCanvas, AiPanel, DeepsleepView, fromEvent, GoalView, nextUid, StatusBar, Summon, type ComposerContext } from './views';
import { TitleBar, type ConnState } from './components/ChromeExtras';
import { SessionPanel, SessionToggle } from './components/SessionBar';
import { ActivityRail, type ActiveView } from './components/LeftRail';
import { EmptyState, EMPTY_ICONS, ErrorCard, type ErrorCode } from './components/EmptyState';
import { CommandPalette, type PaletteItem } from './components/CommandPalette';
import { buildCommands, buildMenus } from './commands';
import { MenuBar, type MenuBarHandle } from './components/MenuBar';
import { activeFileTask, detectTasks, testCommand, type Task } from './tasks';
import { PathDialog } from './components/PathDialog';
import { SavePromptDialog } from './components/SavePromptDialog';
import { SettingsPage, type SettingsSectionId } from './components/SettingsPage';
import { Onboarding } from './components/Onboarding';
import {
  GitPanel, SearchPanel, Welcome, clearRecent, parseOutline, pushRecent, readRecent,
  removeRecent, type RecentWorkspace,
} from './components/Panels';
import { installOutsideDismiss, overlayStack, useDismissable } from './components/overlayStack';
import { clamp, createLivingSignal, quantize, type LivingSignal } from './living';
import { t, useI18n, getLang, setLang } from './i18n';
import { readSettings, subscribeSettings, writeSettings, type ComposerPermission } from './localSettings';
import { recordOutput } from './terminalBus';
import type {
  Annotation, ButtonSpec, ClientRequest, FileEntry, IoEvent, IoRequest, Mode,
  ProviderInfo, ServerEvent, SessionState, ShellCapabilities, StreamEnvelope,
} from './types';
import { dormant, normalizeMode } from './types';

// Sample source only used when advisor has no real file to review. It is always
// labelled as sample content in the UI — never presented as a real file.
const REVIEW_SOURCE = `fn presence_dial(mode: Mode) -> u8 {
    match mode {
        Mode::Ide => 0,
        Mode::Deepsleep => 1,
        Mode::Helping => 2,
        Mode::Advisor => 3,
        Mode::Coding => 4,
        Mode::Goal => 5,
    }
}
`;

const newSessionState = (key: string, label: string, mode: Mode = 'coding'): SessionState => ({
  key, label, id: null, mode, updatedAt: Date.now(), items: [], goal: null, annotations: [],
  wakeBriefing: null, wakePending: false, running: false, handoff: 0, archived: false,
  usage: null, providerId: null, providerModel: null,
});

type ModeSwitchPhase = 'idle' | 'pending' | 'confirming' | 'failed';

interface ModeSwitchState {
  phase: ModeSwitchPhase;
  target: Mode | null;
  origin: Mode;
  source: 'user' | 'advisor-handoff';
  buttonId: number | null;
  startedAt: number;
  errorTitle?: string;
  errorDesc?: string;
  recover?: boolean;
}

const IDLE_SWITCH: ModeSwitchState = {
  phase: 'idle', target: null, origin: 'coding', source: 'user', buttonId: null, startedAt: 0,
};

const DEFAULT_CAPS: ShellCapabilities = {
  pickFolder: false, termInstance: false, fsListPath: false, pty: false, procExec: false,
  fsMkdir: false, fsRename: false, fsCopy: false, fsSearch: false,
};

export default function App() {
  useI18n();
  const [svc, setSvc] = useState<Service | null>(null);
  const svcRef = useRef<Service | null>(null);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [sessions, setSessions] = useState<SessionState[]>([newSessionState('s1', 'session 01')]);
  const [activeKey, setActiveKey] = useState('s1');
  const [lastKey, setLastKey] = useState<string | null>(null);
  const pendingOpens = useRef<string[]>([]);
  const closedHistory = useRef<{ label: string; mode: Mode }[]>([]);
  const activeRef = useRef(activeKey);
  const sessionsRef = useRef(sessions);
  activeRef.current = activeKey;
  sessionsRef.current = sessions;

  const [summon, setSummon] = useState<{ x: number; y: number } | null>(null);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  /** The session column is opt-in: it takes space from the conversation panel. */
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [aiCollapsed, setAiCollapsed] = useState(false);
  const [search, setSearch] = useState('');
  const [fileIndex, setFileIndex] = useState<string[]>([]);
  const [activeView, setActiveView] = useState<ActiveView>('files');
  const [palette, setPalette] = useState<'command' | 'file' | null>(null);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('appearance');
  const [pathDialogOpen, setPathDialogOpen] = useState(false);
  // First-run guide: shown until the user finishes or skips it once.
  const [guideOpen, setGuideOpen] = useState(() => {
    try { return localStorage.getItem('pristem.guide.done') !== '1'; } catch { return false; }
  });
  const finishGuide = useCallback(() => {
    try { localStorage.setItem('pristem.guide.done', '1'); } catch { /* storage unavailable */ }
    setGuideOpen(false);
  }, []);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [queued, setQueued] = useState(0);
  const queueRef = useRef<string[]>([]);
  const pointer = useRef({ x: 480, y: 320 });
  const [outlineOpen, setOutlineOpen] = useState(false);

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [root, setRoot] = useState('');
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [groups, setGroups] = useState<EditorGroup[]>([{ id: 'g1', files: [], activePath: null }]);
  const [activeGroupId, setActiveGroupId] = useState('g1');
  const [splitDir, setSplitDir] = useState<'row' | 'column' | null>(null);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const activeGroupIdRef = useRef(activeGroupId);
  activeGroupIdRef.current = activeGroupId;
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const groupSeq = useRef(1);
  /** Editors closed in this workspace, newest last — Ctrl+Shift+T pops one. */
  const closedTabs = useRef<string[]>([]);

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0];
  const openFiles = activeGroup.files;
  const activePath = activeGroup.activePath;

  // Group-aware setters keep the existing call sites working: they target the
  // active group, while cross-group edits (shared models) use setGroups directly.
  const setOpenFiles = useCallback((updater: OpenFile[] | ((prev: OpenFile[]) => OpenFile[])) => {
    setGroups((prev) => prev.map((g) => g.id === activeGroupIdRef.current
      ? { ...g, files: typeof updater === 'function' ? updater(g.files) : updater }
      : g));
  }, []);
  const setActivePath = useCallback((updater: string | null | ((prev: string | null) => string | null)) => {
    setGroups((prev) => prev.map((g) => g.id === activeGroupIdRef.current
      ? { ...g, activePath: typeof updater === 'function' ? updater(g.activePath) : updater }
      : g));
  }, []);
  const [protocol, setProtocol] = useState<string | null>(null);
  const [caps, setCaps] = useState<ShellCapabilities>(DEFAULT_CAPS);
  const [capsKnown, setCapsKnown] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersError, setProvidersError] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [activityTab, setActivityTab] = useState<ActivityTab>('terminal');
  const [activityOpen, setActivityOpen] = useState(true);
  const [sizes, setSizes] = useState({ ...DEFAULT_SIZES });
  const [expandedDirs, setExpandedDirs] = useState<string[]>([]);
  const [treeRestore, setTreeRestore] = useState<{ paths: string[]; nonce: number } | null>(null);
  const restoringRef = useRef(false);
  const treeRestoreSeq = useRef(0);
  const restoreRef = useRef<(r: string) => Promise<void>>(async () => {});
  const [defaultInstances, setDefaultInstances] = useState(1);
  const [recent, setRecent] = useState<RecentWorkspace[]>(() => readRecent());
  const [permission, setPermission] = useState<ComposerPermission>(() => readSettings().permission);
  const setComposerPermission = useCallback((p: ComposerPermission) => {
    writeSettings({ permission: p });
    setPermission(p);
  }, []);

  const [modeSwitch, setModeSwitch] = useState<ModeSwitchState>(IDLE_SWITCH);
  const modeSwitchRef = useRef(modeSwitch);
  modeSwitchRef.current = modeSwitch;
  const answeredButtonIds = useRef(new Set<number>());
  const pendingButtons = useRef<{ prompt: string; buttons: ButtonSpec[] } | null>(null);
  const handoffEndsAt = useRef(0);
  const recoverToSleepRef = useRef(false);

  const appShellRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const menuBarRef = useRef<MenuBarHandle>(null);
  const a11yRef = useRef<HTMLSpanElement>(null);
  const alertRef = useRef<HTMLSpanElement>(null);
  const haloRef = useRef<HTMLSpanElement>(null);
  const livingRef = useRef<LivingSignal | null>(null);
  const modeRef = useRef<Mode>('coding');
  const ptrWrite = useRef({ t: 0, x: Number.NaN, y: Number.NaN });

  const send = useCallback((req: ClientRequest) => { void svcRef.current?.send(req); }, []);
  const sendIo = useCallback(async (req: IoRequest) => svcRef.current?.io(req), []);
  // External edits (watcher, git checkout) refresh clean buffers only; a dirty
  // buffer is never overwritten by disk content.
  const refreshCleanBuffers = useCallback(() => {
    const paths = Array.from(new Set(
      groupsRef.current.flatMap((g) => g.files.filter((f) => !f.dirty).map((f) => f.path)),
    ));
    if (!paths.length) return;
    void Promise.all(paths.map(async (p) => {
      const r = (await sendIo({ op: 'fs.read', path: p })) as { content?: string; truncated?: boolean } | undefined;
      return { path: p, content: r?.content ?? '', truncated: !!r?.truncated };
    })).then((rows) => {
      const byPath = new Map(rows.map((r) => [r.path, r]));
      for (const r of rows) setModelContent(r.path, r.content);
      setGroups((prev) => prev.map((g) => ({
        ...g,
        files: g.files.map((f) => {
          const r = byPath.get(f.path);
          return r && !f.dirty ? { ...f, content: r.content, readOnly: r.truncated } : f;
        }),
      })));
    });
  }, [sendIo]);
  const patch = useCallback((key: string, fn: (s: SessionState) => SessionState) =>
    setSessions((prev) => prev.map((s) => (s.key === key ? { ...fn(s), updatedAt: Date.now() } : s))), []);

  const active = sessions.find((s) => s.key === activeKey) ?? sessions[0];
  const mode = active.mode;
  const isDormant = dormant(mode);
  modeRef.current = mode;
  // An opened but empty folder is still a workspace; only a missing root is
  // "no workspace". Treating `files.length === 0` as none made the tree and the
  // welcome surface disagree.
  const noWorkspace = workspaceReady && root === '';

  const announce = useCallback((text: string, urgent = false) => {
    const el = urgent ? alertRef.current : a11yRef.current;
    if (el) el.textContent = text;
  }, []);

  useDismissable('mode-menu', modeMenuOpen, () => setModeMenuOpen(false));
  useDismissable('summon', summon !== null, () => setSummon(null));
  useDismissable('palette', palette !== null, () => setPalette(null), { modal: true });
  useDismissable('path-dialog', pathDialogOpen, () => setPathDialogOpen(false), { modal: true });
  useDismissable('settings', settingsOpen, () => setSettingsOpen(false), { modal: true });
  useEffect(() => installOutsideDismiss(), []);

  // -------------------------------------------------------------------------
  // ServerEvent → UI state. Mode is ONLY ever set by `mode_changed` (H-1).
  // -------------------------------------------------------------------------
  const handleKernel = useCallback((ev: ServerEvent) => {
    const sid = 'session' in ev ? (ev as { session: number }).session : 0;
    let key = sessionsRef.current.find((s) => s.id === sid)?.key;
    if (!key && ev.type === 'session_opened') {
      const pending = pendingOpens.current.shift();
      if (!pending) return;
      key = pending;
    }
    if (!key) {
      if (sid !== 0) return;
      key = activeRef.current;
    }

    if (ev.type === 'mode_changed') {
      const to = normalizeMode(ev.to);
      setSessions((prev) => prev.map((s) => {
        if (s.key !== key) return s;
        const next: SessionState = {
          ...s, mode: to, handoff: 0,
          wakeBriefing: normalizeMode(ev.from) === 'deepsleep' ? null : s.wakeBriefing,
          wakePending: false, archived: to === 'deepsleep',
        };
        if (to === 'deepsleep') {
          next.items = [...s.items, { uid: nextUid(), kind: 'system', text: t('mode.cost'), ts: Date.now() }];
        }
        return next;
      }));
      if (to === 'coding' && recoverToSleepRef.current) {
        recoverToSleepRef.current = false;
        const next: ModeSwitchState = { phase: 'pending', target: 'deepsleep', origin: 'coding', source: 'user', buttonId: null, startedAt: Date.now() };
        modeSwitchRef.current = next;
        setModeSwitch(next);
        void svcRef.current?.send({ type: 'switch_mode', session: sid, mode: 'deepsleep' });
        return;
      }
      recoverToSleepRef.current = false;
      const idle: ModeSwitchState = { ...IDLE_SWITCH, origin: modeRef.current };
      modeSwitchRef.current = idle;
      setModeSwitch(idle);
      setModeMenuOpen(false);
      return;
    }
    if (ev.type === 'session_opened') { patch(key, (s) => ({ ...s, id: ev.session, mode: normalizeMode(ev.mode) })); return; }
    if (ev.type === 'finished') { patch(key, (s) => ({ ...s, running: false })); return; }
    if (ev.type === 'session_closed') return;
    if (ev.type === 'usage') {
      (window as unknown as { __pristemUsageSeen?: boolean }).__pristemUsageSeen = true;
      patch(key, (s) => ({
        ...s,
        usage: s.usage ? {
          input_tokens: s.usage.input_tokens + ev.input_tokens,
          output_tokens: s.usage.output_tokens + ev.output_tokens,
          cached_tokens: s.usage.cached_tokens + ev.cached_tokens,
          elapsed_ms: s.usage.elapsed_ms + ev.elapsed_ms,
          tool_calls: s.usage.tool_calls + ev.tool_calls,
        } : {
          input_tokens: ev.input_tokens,
          output_tokens: ev.output_tokens,
          cached_tokens: ev.cached_tokens,
          elapsed_ms: ev.elapsed_ms,
          tool_calls: ev.tool_calls,
        },
      }));
      return;
    }
    if (ev.type === 'providers') {
      setProviders(ev.providers);
      setProvidersLoading(false);
      setProvidersError(false);
      return;
    }
    if (ev.type === 'provider_changed') {
      patch(key, (s) => ({ ...s, providerId: ev.provider, providerModel: ev.model }));
      setProviders((prev) => (prev ? prev.map((p) => ({ ...p, is_default: p.id === ev.provider })) : prev));
      setPendingProvider(null);
      return;
    }
    if (ev.type === 'result' && ev.output) {
      for (const l of String(ev.output).split(/\r?\n/)) if (l) recordOutput({ instance: 0, source: 'kernel', text: l });
    }
    if (ev.type === 'error') {
      const msg = String(ev.message);
      const st = modeSwitchRef.current;
      if (st.phase === 'pending' || st.phase === 'confirming') {
        const m = /mode transition (\w+) -> (\w+) is forbidden:\s*(.*)$/.exec(msg);
        const unknown = /unknown mode/.test(msg);
        const failed: ModeSwitchState = unknown
          ? { ...st, phase: 'failed', errorTitle: t('mode.failed.unknown'), errorDesc: msg, recover: false }
          : m
            ? {
              ...st, phase: 'failed',
              errorTitle: t('mode.failed.forbidden', { from: m[1], to: m[2] }),
              errorDesc: t('mode.failed.forbiddenDesc', { note: m[3] }),
              recover: m[1] !== 'coding' && m[2] === 'deepsleep',
            }
            : { ...st, phase: 'failed', errorTitle: t('mode.failed.timeout'), errorDesc: msg, recover: false };
        modeSwitchRef.current = failed;
        setModeSwitch(failed);
        setModeMenuOpen(true);
        announce(t('a11y.error', { msg: msg.slice(0, 80) }), true);
      }
      patch(key, (s) => ({ ...s, running: false, items: [...s.items, { uid: nextUid(), kind: 'system', text: ev.message, ts: Date.now() }] }));
      return;
    }
    if (ev.type === 'buttons') {
      // R-C1 / R-C3 — the UI answers the kernel only when the user's click
      // already expressed the intent. Otherwise the card is the human's
      // surface (H-7).
      const st = modeSwitchRef.current;
      // R-C1 — exactly one real choice. The kernel may add an implicit
      // "cancel" next to it; that is not a second question.
      const real = ev.buttons.filter((b) => b.choice !== 'cancel');
      const only = real.length === 1;
      const btn = real[0];
      const matches = !!btn && btn.choice !== 'release' && btn.choice === st.target;
      if (st.phase === 'pending' && only && matches) {
        const id = btn.id;
        if (answeredButtonIds.current.has(id)) return;      // R-C2
        answeredButtonIds.current.add(id);
        pendingButtons.current = { prompt: ev.prompt, buttons: ev.buttons };
        const confirming: ModeSwitchState = { ...st, phase: 'confirming', buttonId: id };
        modeSwitchRef.current = confirming;
        setModeSwitch(confirming);
        const answer = () => {
          const s = sessionsRef.current.find((x) => x.key === activeRef.current);
          if (!s || s.id == null) return;
          void svcRef.current?.send({ type: 'confirm', session: s.id, id, choice: btn.choice });
        };
        if (st.source === 'advisor-handoff') {
          // R-C4 — never cover the handoff animation.
          const wait = Math.max(0, handoffEndsAt.current - Date.now());
          window.setTimeout(answer, wait);
        } else {
          answer();
        }
        return;
      }
      pendingButtons.current = null;
      patch(key, (s) => ({ ...s, items: [...s.items, { uid: nextUid(), kind: 'buttons', prompt: ev.prompt, buttons: ev.buttons, ts: Date.now() }] }));
      return;
    }
    patch(key, (s) => {
      if (dormant(s.mode)) return s;
      if (s.mode === 'goal' && (ev.type === 'call' || ev.type === 'result')) return s;
      const item = fromEvent(ev);
      const items = item ? [...s.items, item] : s.items;
      const next: SessionState = { ...s, items };
      if (ev.type === 'reminder' && s.mode === 'deepsleep') { next.wakeBriefing = ev.lines; next.wakePending = true; }
      return next;
    });
  }, [announce, patch]);

  const handleIo = useCallback((io: IoEvent) => {
    window.dispatchEvent(new CustomEvent('pristem:term', { detail: io }));
    if (io.type === 'workspace' && io.root) {
      setRoot(io.root);
      pushRecent(io.root);
      setRecent(readRecent());
      void sendIo({ op: 'fs.list' }).then((r) => {
        const res = r as { files?: FileEntry[] } | undefined;
        if (res?.files) setFiles(res.files);
        setWorkspaceReady(true);
      });
    }
    if (io.type === 'fs.changed') {
      window.dispatchEvent(new CustomEvent('pristem:fs-changed'));
      refreshCleanBuffers();
      void sendIo({ op: 'fs.list' }).then((r) => {
        const res = r as { files?: FileEntry[] } | undefined;
        if (res?.files) setFiles(res.files);
      });
    }
  }, [sendIo, refreshCleanBuffers]);

  // ── boot ────────────────────────────────────────────────────────────────
  useEffect(() => {
    livingRef.current = createLivingSignal(appShellRef, () => modeRef.current);
    return () => { livingRef.current?.dispose(); livingRef.current = null; };
  }, []);

  useEffect(() => {
    let off: (() => void) | undefined;
    let alive = true;
    void getService().then(async (service) => {
      if (!alive) return;
      svcRef.current = service;
      setSvc(service);
      off = service.onEnvelope((e: StreamEnvelope) => {
        if (e.channel === 'kernel') livingRef.current?.onKernelEvent(e.payload);
        if (e.channel === 'kernel') handleKernel(e.payload);
        else handleIo(e.payload);
      });
      await service.ready();
      const r = (await service.io({ op: 'fs.list' })) as { files?: FileEntry[]; root?: string; protocol?: string };
      if (r?.files) setFiles(r.files);
      if (r?.root) { setRoot(r.root); pushRecent(r.root); void restoreRef.current(r.root); }
      // D-5 — the protocol version comes from the shell, never from a literal.
      if (r?.protocol) setProtocol(r.protocol);
      setWorkspaceReady(true);

      // Capability probe (B-9). Unknown op → every capability stays false.
      const cr = (await service.io({ op: 'shell.capabilities' })) as
        { ok?: boolean; capabilities?: Partial<ShellCapabilities> } | undefined;
      if (cr?.capabilities) {
        setCaps({
          pickFolder: cr.capabilities.pickFolder === true,
          termInstance: cr.capabilities.termInstance === true,
          fsListPath: cr.capabilities.fsListPath === true,
          pty: cr.capabilities.pty === true,
          procExec: cr.capabilities.procExec === true,
          fsMkdir: cr.capabilities.fsMkdir === true,
          fsRename: cr.capabilities.fsRename === true,
          fsCopy: cr.capabilities.fsCopy === true,
          fsSearch: cr.capabilities.fsSearch === true,
        });
      }
      setCapsKnown(true);

      pendingOpens.current.push('s1');
      await service.send({ type: 'open_session', mode: 'coding' });
    });
    return () => { alive = false; off?.(); };
  }, [handleKernel, handleIo, connectionAttempt]);

  const retryConnection = useCallback(() => {
    svcRef.current?.close();
    svcRef.current = null;
    resetService();
    setSvc(null);
    setError(null);
    setConnectionAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    (window as unknown as { __pristemDormantCheck: () => boolean }).__pristemDormantCheck = () =>
      document.querySelectorAll('[data-ai="true"]').length === 0;
  }, [isDormant, mode]);

  // The deepsleep workbench is inert for the keyboard, not only for the mouse.
  useEffect(() => {
    const el = workspaceRef.current;
    if (!el) return;
    if (mode === 'deepsleep') el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }, [mode]);

  useEffect(() => subscribeSettings(() => setDefaultInstances(readSettings().defaultInstances)), []);
  // The living intensity slider applies immediately, not on the next kernel event.
  useEffect(() => subscribeSettings(() => livingRef.current?.refresh()), []);

  useEffect(() => {
    const open = () => setOutlineOpen(true);
    window.addEventListener('pristem:outline-open', open);
    return () => window.removeEventListener('pristem:outline-open', open);
  }, []);

  // LIVING pulse (WAAPI) after transcript changes.
  useEffect(() => {
    if (active.items.length === 0) return;
    const timer = window.setTimeout(() => {
      if (!livingRef.current?.shouldPulse()) return;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const duration = reduced ? 120 : 480;
      const easing = 'cubic-bezier(.16,1,.3,1)';
      livingRef.current?.beginPulse(duration);
      const shell = appShellRef.current;
      const halo = haloRef.current;
      try {
        if (halo) halo.animate(
          reduced ? [{ opacity: 0.9 }, { opacity: 1 }, { opacity: 0.9 }]
            : [{ transform: 'scale(1)' }, { transform: 'scale(1.12)', offset: 0.33 }, { transform: 'scale(1)' }],
          { duration, easing });
      } catch { /* WAAPI unavailable */ }
      if (!reduced) {
        const band: Keyframe[] = [
          { transform: 'translateX(0)' }, { transform: 'translateX(12px)', offset: 0.33 }, { transform: 'translateX(0)' },
        ];
        try { shell?.animate(band, { duration, easing, pseudoElement: '::after' } as KeyframeAnimationOptions); } catch { /* silent */ }
      }
    }, 100);
    return () => window.clearTimeout(timer);
  }, [active.items.length]);

  // Follow-up queue: drain on `finished`.
  useEffect(() => {
    if (active.running || queueRef.current.length === 0) return;
    const next = queueRef.current.shift();
    setQueued(queueRef.current.length);
    if (next) window.setTimeout(() => {
      const s = sessionsRef.current.find((x) => x.key === activeRef.current);
      if (s?.id != null) {
        patch(s.key, (x) => ({ ...x, items: [...x.items, { uid: nextUid(), kind: 'user', text: next, ts: Date.now() }], running: true }));
        svcRef.current?.send({ type: 'submit_round', session: s.id, text: next });
      }
    }, 60);
  }, [active.running, patch]);

  // -------------------------------------------------------------------------
  // Mode switch state machine (UX §1).
  // -------------------------------------------------------------------------
  const guard = useCallback(() => {
    if (!noWorkspace) return false;
    setError('noWorkspace');
    return true;
  }, [noWorkspace]);

  const switchMode = useCallback((m: Mode, source: 'user' | 'advisor-handoff' = 'user') => {
    const phase = modeSwitchRef.current.phase;
    if (phase === 'pending' || phase === 'confirming') return;
    recoverToSleepRef.current = false;
    if (m !== 'IDE' && guard()) return;
    const s = sessionsRef.current.find((x) => x.key === activeRef.current);
    if (!s || s.id == null) return;
    const next: ModeSwitchState = { phase: 'pending', target: m, origin: s.mode, source, buttonId: null, startedAt: Date.now() };
    modeSwitchRef.current = next;
    setModeSwitch(next);
    svcRef.current?.send({ type: 'switch_mode', session: s.id, mode: m });
  }, [guard]);

  // R-C6 — a pending intent that gets no answer within 3s fails visibly.
  useEffect(() => {
    if (modeSwitch.phase !== 'pending') return;
    const timer = window.setTimeout(() => {
      setModeSwitch((prev) => {
        if (prev.phase !== 'pending') return prev;
        const failed: ModeSwitchState = { ...prev, phase: 'failed', errorTitle: t('mode.failed.timeout'), errorDesc: t('mode.failed.timeoutDesc'), recover: false };
        modeSwitchRef.current = failed;
        return failed;
      });
      setModeMenuOpen(true);
      announce(t('a11y.modeTimeout'), true);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [modeSwitch.phase, announce]);

  // R-C5 — the silent answer must land within 2s, otherwise the card shows.
  useEffect(() => {
    if (modeSwitch.phase !== 'confirming') return;
    const timer = window.setTimeout(() => {
      const payload = pendingButtons.current;
      if (payload) {
        pendingButtons.current = null;
        patch(activeRef.current, (s) => ({
          ...s,
          items: [...s.items, { uid: nextUid(), kind: 'buttons', prompt: payload.prompt, buttons: payload.buttons, ts: Date.now() }],
        }));
      }
      setModeSwitch((prev) => {
        if (prev.phase !== 'confirming') return prev;
        const failed: ModeSwitchState = { ...prev, phase: 'failed', errorTitle: t('mode.failed.timeout'), errorDesc: t('mode.failed.timeoutDesc'), recover: false };
        modeSwitchRef.current = failed;
        return failed;
      });
      setModeMenuOpen(true);
      announce(t('a11y.modeTimeout'), true);
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [modeSwitch.phase, announce, patch]);

  const retrySwitch = useCallback(() => {
    const st = modeSwitchRef.current;
    if (!st.target) return;
    const s = sessionsRef.current.find((x) => x.key === activeRef.current);
    if (!s || s.id == null) return;
    const next: ModeSwitchState = { phase: 'pending', target: st.target, origin: st.origin, source: 'user', buttonId: null, startedAt: Date.now() };
    modeSwitchRef.current = next;
    setModeSwitch(next);
    svcRef.current?.send({ type: 'switch_mode', session: s.id, mode: st.target });
  }, []);

  const recoverSwitch = useCallback(() => {
    const s = sessionsRef.current.find((x) => x.key === activeRef.current);
    if (!s || s.id == null) return;
    const next: ModeSwitchState = { phase: 'pending', target: 'deepsleep', origin: s.mode, source: 'user', buttonId: null, startedAt: Date.now() };
    recoverToSleepRef.current = true;
    modeSwitchRef.current = next;
    setModeSwitch(next);
    svcRef.current?.send({ type: 'switch_mode', session: s.id, mode: 'coding' });
  }, []);

  const openSettings = useCallback((section: SettingsSectionId = 'appearance') => {
    setSettingsSection(section);
    setSettingsOpen(true);
    // The provider list is real data — ask the kernel for it.
    setProvidersLoading(true);
    setProvidersError(false);
    svcRef.current?.send({ type: 'list_providers', client: 'desktop' });
    window.setTimeout(() => {
      setProvidersLoading((loading) => {
        if (loading) setProvidersError(true);
        return false;
      });
    }, 2500);
  }, []);

  useEffect(() => {
    if (active.id == null || providers) return;
    // The composer's model menu needs the real endpoint list before settings is opened.
    svcRef.current?.send({ type: 'list_providers', client: 'desktop' });
  }, [active.id, providers]);

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------
  const newSession = useCallback((withMode?: Mode, label?: string) => {
    const key = `s${Date.now()}`;
    const n = sessionsRef.current.length + 1;
    setSessions((prev) => [...prev, newSessionState(key, label ?? `session ${String(n).padStart(2, '0')}`)]);
    setLastKey(activeRef.current);
    setActiveKey(key);
    pendingOpens.current.push(key);
    svcRef.current?.send({ type: 'open_session', mode: withMode ?? 'coding' });
  }, []);

  const activateTab = (key: string) => {
    if (key === activeKey) return;
    setLastKey(activeKey);
    setActiveKey(key);
  };
  const closeTab = (key: string) => {
    const s = sessionsRef.current.find((x) => x.key === key);
    if (!s) return;
    closedHistory.current.push({ label: s.label, mode: s.mode });
    if (s.id != null) svcRef.current?.send({ type: 'close_session', session: s.id });
    const rest = sessionsRef.current.filter((x) => x.key !== key);
    if (rest.length === 0) {
      const fresh = newSessionState(`s${Date.now()}`, 'session 01');
      setSessions([fresh]); setActiveKey(fresh.key);
      pendingOpens.current.push(fresh.key);
      svcRef.current?.send({ type: 'open_session', mode: 'coding' });
    } else {
      setSessions(rest);
      if (key === activeKey) setActiveKey(rest[rest.length - 1].key);
    }
  };
  const loadLastSession = useCallback(() => {
    const prior = lastKey && sessionsRef.current.find((s) => s.key === lastKey);
    if (prior) { setLastKey(activeRef.current); setActiveKey(prior.key); announce(t('session.announce.restore')); return; }
    const saved = closedHistory.current.pop();
    if (saved) newSession(saved.mode, saved.label);
  }, [newSession, announce]);

  const appendUser = (key: string, text: string) =>
    patch(key, (s) => ({ ...s, items: [...s.items, { uid: nextUid(), kind: 'user', text, ts: Date.now() }], running: true }));

  const submit = useCallback((text: string, fromSummon = false) => {
    const s = sessionsRef.current.find((x) => x.key === activeRef.current);
    if (!s || s.id == null) return;
    const v = text.trim();
    if (!v) return;
    const key = s.key, id = s.id, m = s.mode;
    if (v === '/help') { openSettings('keys'); return; }
    if (v === '/session') { newSession(); return; }
    if (v === '/clear') { patch(key, (x) => ({ ...x, items: [] })); return; }
    if (v.startsWith('/mode ')) { switchMode(normalizeMode(v.slice(6).trim())); return; }
    const slashMap: Record<string, Mode> = { '/advisor': 'advisor', '/deepsleep': 'deepsleep', '/coding': 'coding', '/ide': 'IDE', '/helping': 'helping', '/goal': 'goal' };
    if (slashMap[v]) { switchMode(slashMap[v]); return; }
    if (v === '/resume') { svcRef.current?.send({ type: 'resume', session: id }); return; }
    if (v === '/pause') { svcRef.current?.send({ type: 'pause', session: id }); return; }
    if (v === '/wake') { svcRef.current?.send({ type: 'list_reminders', session: id }); return; }
    if (v.startsWith('/goal')) {
      const g = v.replace(/^\/goal\s*/i, '').trim();
      if (g) patch(key, (x) => ({ ...x, goal: g }));
      appendUser(key, g ? `/goal ${g}` : v);
      svcRef.current?.send({ type: 'submit_round', session: id, text: v });
      return;
    }
    if (active.running) {
      if (queueRef.current.length >= 5) {
        announce(t('a11y.queueFull'), true);
        return;
      }
      queueRef.current.push(v);
      setQueued(queueRef.current.length);
      return;
    }
    if (guard()) return;
    appendUser(key, v);
    if (fromSummon || m === 'IDE') svcRef.current?.send({ type: 'switch_mode', session: id, mode: 'helping' });
    svcRef.current?.send({ type: 'submit_round', session: id, text: v });
  }, [newSession, switchMode, guard, active.running, announce, openSettings, patch]);

  const confirm = useCallback((b: ButtonSpec) => {
    const s = sessionsRef.current.find((x) => x.key === activeRef.current);
    if (!s || s.id == null) return;
    svcRef.current?.send({ type: 'confirm', session: s.id, id: b.id, choice: b.choice });
    patch(s.key, (x) => ({ ...x, items: x.items.filter((i) => !(i.kind === 'buttons' && i.buttons?.some((q) => q.id === b.id))) }));
    setError(null);
  }, [patch]);

  const addAnnotation = (a: Omit<Annotation, 'id'>) =>
    patch(activeKey, (s) => ({ ...s, annotations: [...s.annotations, { ...a, id: `a${Date.now()}${Math.random()}` }] }));

  const submitAnnotations = useCallback(() => {
    const s = sessionsRef.current.find((x) => x.key === activeRef.current);
    if (!s || s.id == null || !s.annotations.length) return;
    const id = s.id, key = s.key;
    s.annotations.forEach((a) => svcRef.current?.send({
      type: 'annotate', session: id, target: `${a.start}:${a.end}:${a.span.slice(0, 120)}`,
      note: a.note, classification: a.kind,
    }));
    svcRef.current?.send({ type: 'pause', session: id });
    patch(key, (x) => ({ ...x, handoff: 1 }));
    handoffEndsAt.current = Date.now() + 2100;
    [2, 3, 4].forEach((step, i) => window.setTimeout(() => patch(key, (x) => ({ ...x, handoff: step })), 650 * (i + 1)));
    window.setTimeout(() => {
      handoffEndsAt.current = 0;
      switchMode('deepsleep', 'advisor-handoff');
    }, 2100);
  }, [switchMode, patch]);

  const onWake = () => { if (active.id != null) svcRef.current?.send({ type: 'list_reminders', session: active.id }); };
  // P1 — the "continue working" button asks the kernel to switch (never setMode).
  const onResumeFromSleep = () => { switchMode('coding'); };
  // P3 — the wake card's "resume session" also restarts the paused loop.
  const onResumeSession = () => {
    if (active.id != null) svcRef.current?.send({ type: 'resume', session: active.id });
    switchMode('coding');
  };

  const summonAt = useCallback((pos: { x: number; y: number }) => {
    const s = sessionsRef.current.find((x) => x.key === activeRef.current);
    if (s && dormant(s.mode)) setSummon(pos);
    else {
      const el = document.querySelector('[data-composer] textarea') as HTMLTextAreaElement | null;
      el?.focus();
      // Never let the chord look like a no-op in a mode that already has a composer.
      announce(t('a11y.composerFocused'));
    }
  }, [announce]);

  // -------------------------------------------------------------------------
  // Workspace IO
  // -------------------------------------------------------------------------
  const openFile = useCallback(async (path: string, keepView = false) => {
    const r = (await sendIo({ op: 'fs.read', path })) as { content?: string; truncated?: boolean };
    setOpenFiles((prev) => prev.some((f) => f.path === path) ? prev : [...prev, { path, content: r?.content ?? '', dirty: false, readOnly: !!r?.truncated }]);
    setActivePath(path);
    if (!keepView) setActiveView('files');
  }, [sendIo, setOpenFiles, setActivePath]);

  // Saves and edits apply across every group holding the path — the model is
  // shared, so a buffer is dirty (or clean) in all panes at once.
  const onSave = useCallback((path: string, content: string) => {
    if (groupsRef.current.some((g) => g.files.some((f) => f.path === path && f.readOnly))) return;
    void sendIo({ op: 'fs.write', path, content });
    setGroups((prev) => prev.map((g) => ({ ...g, files: g.files.map((f) => f.path === path ? { ...f, content, dirty: false } : f) })));
  }, [sendIo]);
  const autoSaveTimers = useRef(new Map<string, number>());
  const onContentChange = useCallback((path: string, content: string) => {
    setGroups((prev) => prev.map((g) => ({ ...g, files: g.files.map((f) => f.path === path ? { ...f, content, dirty: true } : f) })));
    if (!readSettings().autoSave) return;
    const prevTimer = autoSaveTimers.current.get(path);
    if (prevTimer) window.clearTimeout(prevTimer);
    autoSaveTimers.current.set(path, window.setTimeout(() => {
      autoSaveTimers.current.delete(path);
      const f = groupsRef.current.flatMap((g) => g.files).find((x) => x.path === path);
      if (f && f.dirty && !f.readOnly) onSave(path, f.content);
    }, 1000));
  }, [onSave]);

  const [savePrompt, setSavePrompt] = useState<{ name: string; count: number; onSave: () => void; onDiscard: () => void } | null>(null);
  useDismissable('save-prompt', savePrompt !== null, () => setSavePrompt(null), { modal: true });

  const saveAllDirty = useCallback(() => {
    for (const g of groupsRef.current) for (const f of g.files) {
      if (f.dirty && !f.readOnly) onSave(f.path, f.content);
    }
  }, [onSave]);

  // Await every write before a workspace switch so buffers land in the old root.
  const saveAllDirtyAsync = useCallback(async () => {
    const writes: Promise<unknown>[] = [];
    for (const g of groupsRef.current) for (const f of g.files) {
      if (f.dirty && !f.readOnly) writes.push(sendIo({ op: 'fs.write', path: f.path, content: f.content }));
    }
    await Promise.all(writes);
    setGroups((prev) => prev.map((g) => ({ ...g, files: g.files.map((f) => f.dirty ? { ...f, dirty: false } : f) })));
  }, [sendIo]);

  const guardDirty = useCallback((proceed: () => void) => {
    const dirty = groupsRef.current.flatMap((g) => g.files.filter((f) => f.dirty && !f.readOnly));
    if (!dirty.length) { proceed(); return; }
    setSavePrompt({
      name: dirty[0].path.split('/').pop() ?? dirty[0].path,
      count: dirty.length,
      onSave: () => { void saveAllDirtyAsync().then(() => { setSavePrompt(null); proceed(); }); },
      onDiscard: () => { setSavePrompt(null); proceed(); },
    });
  }, [saveAllDirtyAsync]);

  const closePathsNow = useCallback((groupId: string, paths: string[]) => {
    const set = new Set(paths);
    const closing = groupsRef.current.find((g) => g.id === groupId);
    if (closing) {
      for (const f of closing.files) {
        if (!set.has(f.path)) continue;
        closedTabs.current = closedTabs.current.filter((p) => p !== f.path);
        closedTabs.current.push(f.path);
      }
      // A bounded stack: the oldest entries are the least likely to be wanted.
      if (closedTabs.current.length > 20) closedTabs.current = closedTabs.current.slice(-20);
    }
    let next = groupsRef.current.map((g) => {
      if (g.id !== groupId) return g;
      const rest = g.files.filter((f) => !set.has(f.path));
      let ap = g.activePath;
      if (ap && set.has(ap)) ap = rest.length ? rest[rest.length - 1].path : null;
      return { ...g, files: rest, activePath: ap };
    });
    if (next.length > 1) {
      const kept = next.filter((g) => g.files.length > 0);
      if (kept.length < next.length) {
        next = kept.length ? kept : [{ ...next[0], files: [], activePath: null }];
        setSplitDir(null);
        if (!next.some((g) => g.id === activeGroupIdRef.current)) setActiveGroupId(next[0].id);
      }
    }
    setGroups(next);
  }, []);

  // Closing a dirty buffer asks first (Save / Don't Save / Cancel).
  const closePaths = useCallback((groupId: string, paths: string[]) => {
    const g = groupsRef.current.find((x) => x.id === groupId);
    const dirty = g ? g.files.filter((f) => paths.includes(f.path) && f.dirty && !f.readOnly).map((f) => f.path) : [];
    if (dirty.length) {
      setSavePrompt({
        name: dirty[0].split('/').pop() ?? dirty[0],
        count: dirty.length,
        onSave: () => {
          for (const p of dirty) {
            const f = groupsRef.current.flatMap((x) => x.files).find((y) => y.path === p);
            if (f) onSave(p, f.content);
          }
          closePathsNow(groupId, paths);
          setSavePrompt(null);
        },
        onDiscard: () => { closePathsNow(groupId, paths); setSavePrompt(null); },
      });
      return;
    }
    closePathsNow(groupId, paths);
  }, [closePathsNow, onSave]);

  /** Ctrl+Shift+T: reopen the newest closed editor that is not already open. */
  const reopenEditor = useCallback(() => {
    while (closedTabs.current.length) {
      const path = closedTabs.current.pop()!;
      if (groupsRef.current.some((g) => g.files.some((f) => f.path === path))) continue;
      void openFile(path, true);
      return;
    }
    announce(t('a11y.nothingToReopen'));
  }, [announce, openFile]);

  /** Drag a tab onto another: same group only, the active tab never changes. */
  const moveTab = useCallback((groupId: string, from: string, to: string) => {
    setGroups((prev) => prev.map((g) => {
      if (g.id !== groupId) return g;
      const i = g.files.findIndex((f) => f.path === from);
      const j = g.files.findIndex((f) => f.path === to);
      if (i < 0 || j < 0 || i === j) return g;
      const files = [...g.files];
      const [moved] = files.splice(i, 1);
      files.splice(j, 0, moved);
      return { ...g, files };
    }));
  }, []);

  /** Ctrl+= / Ctrl+- / Ctrl+0 zoom the editor text without opening settings. */
  const zoomEditor = useCallback((delta: number) => {
    const size = readSettings().editorFontSize;
    const next = Math.min(32, Math.max(8, size + delta));
    if (next === size) return;
    writeSettings({ editorFontSize: next });
    announce(t('a11y.zoom', { n: next }));
  }, [announce]);

  const splitEditor = useCallback((dir: 'row' | 'column') => {
    const prev = groupsRef.current;
    if (prev.length > 1) { setSplitDir(dir); return; }
    const active = prev.find((g) => g.id === activeGroupIdRef.current) ?? prev[0];
    const id = `g${++groupSeq.current}`;
    const copy: EditorGroup = {
      id,
      files: active.activePath ? active.files.filter((f) => f.path === active.activePath) : [],
      activePath: active.activePath,
    };
    setGroups([...prev, copy]);
    setActiveGroupId(id);
    setSplitDir(dir);
    setSplitRatio(0.5);
  }, []);

  const closeGroup = useCallback((id: string) => {
    const prev = groupsRef.current;
    if (prev.length <= 1) return;
    const closing = prev.find((g) => g.id === id);
    const other = prev.find((g) => g.id !== id);
    if (!closing || !other) return;
    const merged = [...other.files];
    for (const f of closing.files) if (!merged.some((x) => x.path === f.path)) merged.push(f);
    setGroups([{ ...other, files: merged, activePath: other.activePath ?? closing.activePath }]);
    setActiveGroupId(other.id);
    setSplitDir(null);
  }, []);

  const openToSide = useCallback(async (path: string) => {
    const prev = groupsRef.current;
    const activeId = activeGroupIdRef.current;
    let targetId: string;
    let next = prev;
    if (prev.length > 1) {
      targetId = (prev.find((g) => g.id !== activeId) ?? prev[0]).id;
    } else {
      targetId = `g${++groupSeq.current}`;
      next = [...prev, { id: targetId, files: [], activePath: null }];
      setSplitDir('row');
      setSplitRatio(0.5);
    }
    const r = (await sendIo({ op: 'fs.read', path })) as { content?: string; truncated?: boolean };
    next = next.map((g) => {
      if (g.id !== targetId) return g;
      const files = g.files.some((f) => f.path === path) ? g.files
        : [...g.files, { path, content: r?.content ?? '', dirty: false, readOnly: !!r?.truncated }];
      return { ...g, files, activePath: path };
    });
    setGroups(next);
    setActiveGroupId(targetId);
  }, [sendIo]);

  const closeOthers = useCallback((groupId: string, path: string) => {
    const g = groupsRef.current.find((x) => x.id === groupId);
    if (g) closePaths(groupId, g.files.filter((f) => f.path !== path).map((f) => f.path));
  }, [closePaths]);
  const closeToRight = useCallback((groupId: string, path: string) => {
    const g = groupsRef.current.find((x) => x.id === groupId);
    if (!g) return;
    const i = g.files.findIndex((f) => f.path === path);
    if (i >= 0) closePaths(groupId, g.files.slice(i + 1).map((f) => f.path));
  }, [closePaths]);
  const revealInExplorer = useCallback((path: string) => {
    setActiveView('files');
    window.dispatchEvent(new CustomEvent('pristem:reveal', { detail: path }));
  }, []);

  const onOpenFolder = (path: string) => {
    void sendIo({ op: 'fs.openFolder', path });
  };

  const listDir = useCallback(async (path: string): Promise<FileEntry[]> => {
    if (!caps.fsListPath) return [];
    const r = (await sendIo({ op: 'fs.list', path })) as { files?: FileEntry[]; ok?: boolean } | undefined;
    if (r?.ok === false) throw new Error('fs.list failed');
    return r?.files ?? [];
  }, [sendIo, caps.fsListPath]);

  // "New File" from the welcome screen routes to the tree's inline creator.
  const createFile = useCallback(() => {
    setActiveView('files');
    window.dispatchEvent(new CustomEvent('pristem:tree-new-file'));
  }, []);

  const refreshWorkspace = useCallback(() => {
    void sendIo({ op: 'fs.list' }).then((r) => {
      const res = r as { files?: FileEntry[]; protocol?: string } | undefined;
      if (res?.files) setFiles(res.files);
      if (res?.protocol) setProtocol(res.protocol);
    });
  }, [sendIo]);

  const onCreate = useCallback(async (parent: string, name: string, isDir: boolean) => {
    const path = parent ? `${parent}/${name}` : name;
    if (isDir) {
      const r = (await sendIo({ op: 'fs.mkdir', path })) as { ok?: boolean } | undefined;
      if (!r?.ok) { setError('commandFailed'); return false; }
    } else {
      const r = (await sendIo({ op: 'fs.write', path, content: '' })) as { ok?: boolean } | undefined;
      if (r?.ok === false) { setError('commandFailed'); return false; }
      await openFile(path);
    }
    refreshWorkspace();
    return true;
  }, [sendIo, openFile, refreshWorkspace]);

  const onRename = useCallback(async (from: string, to: string) => {
    const r = (await sendIo({ op: 'fs.rename', from, to })) as { ok?: boolean } | undefined;
    if (!r?.ok) { setError('commandFailed'); return false; }
    const remap = (p: string) => p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p;
    for (const g of groupsRef.current) for (const f of g.files) {
      const np = remap(f.path);
      if (np !== f.path) renameModel(f.path, np);
    }
    setGroups((prev) => prev.map((g) => ({
      ...g,
      files: g.files.map((f) => ({ ...f, path: remap(f.path) })),
      activePath: g.activePath ? remap(g.activePath) : g.activePath,
    })));
    refreshWorkspace();
    return true;
  }, [sendIo, refreshWorkspace]);

  const onCopy = useCallback(async (from: string, to: string) => {
    const r = (await sendIo({ op: 'fs.copy', from, to })) as { ok?: boolean } | undefined;
    if (!r?.ok) { setError('commandFailed'); return false; }
    refreshWorkspace();
    return true;
  }, [sendIo, refreshWorkspace]);

  const deleteFile = useCallback(async (path: string) => {
    const r = (await sendIo({ op: 'fs.delete', path })) as { ok?: boolean } | undefined;
    if (!r?.ok) { setError('commandFailed'); return false; }
    const gone = (p: string) => p === path || p.startsWith(path + '/');
    let next = groupsRef.current.map((g) => {
      const rest = g.files.filter((f) => !gone(f.path));
      let ap = g.activePath;
      if (ap && gone(ap)) ap = rest.length ? rest[rest.length - 1].path : null;
      return { ...g, files: rest, activePath: ap };
    });
    if (next.length > 1) {
      const kept = next.filter((g) => g.files.length > 0);
      if (kept.length < next.length) {
        next = kept.length ? kept : [{ ...next[0], files: [], activePath: null }];
        setSplitDir(null);
        if (!next.some((g) => g.id === activeGroupIdRef.current)) setActiveGroupId(next[0].id);
      }
    }
    setGroups(next);
    refreshWorkspace();
    return true;
  }, [sendIo, refreshWorkspace]);

  // Tree entries plus the recursive index, so nested Cargo.toml / package.json
  // are visible to task detection.
  const allFiles = useMemo<FileEntry[]>(() => {
    const seen = new Set(files.map((f) => f.path));
    return [...files, ...fileIndex.filter((p) => !seen.has(p)).map((p) => ({
      name: p.split('/').pop() ?? p, path: p, dir: false,
    }))];
  }, [files, fileIndex]);

  const runTask = useCallback((task: Task) => {
    setActivityOpen(true);
    setActivityTab('terminal');
    recordOutput({ instance: 0, source: 'shell', text: `[task] ${task.command}` });
    void sendIo({ op: 'term.run', command: task.command, instance: 0 });
    announce(t('task.started', { command: task.command }));
  }, [sendIo, announce]);

  const runTests = useCallback(() => {
    const command = testCommand(allFiles);
    if (!command) { announce(t('task.noTests'), true); return; }
    runTask({ id: 'run.tests', label: t('tree.runTests'), command, source: 'test' });
  }, [allFiles, runTask, announce]);

  const runActiveFile = useCallback(() => {
    const task = activeFileTask(allFiles, activePath);
    if (!task) { announce(t('task.noRunner'), true); return; }
    runTask(task);
  }, [allFiles, activePath, runTask, announce]);

  const [taskPicker, setTaskPicker] = useState<Task[] | null>(null);
  useDismissable('task-picker', taskPicker !== null, () => setTaskPicker(null), { modal: true });

  const openTaskPicker = useCallback(() => {
    const load = async () => {
      let pkg = '';
      if (allFiles.some((f) => f.path === 'package.json')) {
        const r = (await sendIo({ op: 'fs.read', path: 'package.json' })) as { content?: string } | undefined;
        pkg = r?.content ?? '';
      }
      setTaskPicker(detectTasks(allFiles, pkg, activePath));
    };
    void load();
  }, [allFiles, activePath, sendIo]);

  const stopTask = useCallback(() => {
    void sendIo({ op: 'term.interrupt', instance: 0 });
    announce(t('task.stopped'));
  }, [sendIo, announce]);

  /**
   * The folder picker. The native dialog is the main path; the paste dialog
   * is the fallback. Both are real (D-2, UX §5.2).
   */
  const restoreWorkspace = useCallback(async (r: string) => {
    const snap = readWorkspaceState(r);
    if (!snap) return;
    restoringRef.current = true;
    try {
      if (snap.sizes) setSizes({
        left: clampSize('left', snap.sizes.left ?? DEFAULT_SIZES.left),
        right: clampSize('right', snap.sizes.right ?? DEFAULT_SIZES.right),
        activity: clampSize('activity', snap.sizes.activity ?? DEFAULT_SIZES.activity),
      });
      const restored: EditorGroup[] = [];
      for (const g of snap.groups ?? []) {
        const files: OpenFile[] = [];
        for (const p of g.paths ?? []) {
          const res = (await sendIo({ op: 'fs.read', path: p })) as { content?: string; truncated?: boolean };
          if (!res || (res.content ?? '').includes('(unreadable or outside workspace)')) continue;
          files.push({ path: p, content: res.content ?? '', dirty: false, readOnly: !!res.truncated });
        }
        const activePath = g.activePath && files.some((f) => f.path === g.activePath)
          ? g.activePath : (files[files.length - 1]?.path ?? null);
        restored.push({ id: g.id, files, activePath });
      }
      const nonEmpty = restored.filter((g) => g.files.length > 0).slice(0, 2);
      const finalGroups: EditorGroup[] = nonEmpty.length ? nonEmpty : [{ id: 'g1', files: [], activePath: null }];
      setGroups(finalGroups);
      setActiveGroupId(finalGroups.some((g) => g.id === snap.activeGroupId) ? snap.activeGroupId : finalGroups[0].id);
      setSplitDir(finalGroups.length === 2 ? (snap.splitDir ?? 'row') : null);
      setSplitRatio(typeof snap.splitRatio === 'number' ? snap.splitRatio : 0.5);
      if (typeof snap.activityOpen === 'boolean') setActivityOpen(snap.activityOpen);
      if (snap.activityTab) setActivityTab(snap.activityTab as ActivityTab);
      if (snap.activeView) setActiveView(snap.activeView as ActiveView);
      if (snap.expanded?.length) {
        setExpandedDirs(snap.expanded);
        setTreeRestore({ paths: snap.expanded, nonce: ++treeRestoreSeq.current });
      }
    } finally {
      window.setTimeout(() => { restoringRef.current = false; }, 0);
    }
  }, [sendIo]);
  restoreRef.current = restoreWorkspace;

  const doOpenFolder = useCallback(async () => {
    if (capsKnown && !caps.pickFolder) { setPathDialogOpen(true); return; }
    const r = (await sendIo({ op: 'fs.pickFolder' })) as
      { ok?: boolean; cancelled?: boolean; root?: string; error?: string } | undefined;
    if (r?.cancelled) return;                              // cancelling is not an error
    if (r?.ok === false) { setPathDialogOpen(true); return; }
    if (r?.root) {
      setRoot(r.root);
      pushRecent(r.root);
      setRecent(readRecent());
      void restoreWorkspace(r.root);
      void sendIo({ op: 'fs.list' }).then((res) => {
        const rr = res as { files?: FileEntry[] } | undefined;
        if (rr?.files) setFiles(rr.files);
        setWorkspaceReady(true);
      });
    }
  }, [sendIo, caps, capsKnown, restoreWorkspace]);
  const openFolder = useCallback(() => { guardDirty(() => { void doOpenFolder(); }); }, [guardDirty, doOpenFolder]);

  const doOpenFolderByPath = useCallback(async (path: string): Promise<string | null> => {
    const r = (await sendIo({ op: 'fs.openFolder', path })) as
      { ok?: boolean; root?: string; error?: string } | undefined;
    if (r?.ok === false) {
      const err = String(r.error ?? '');
      if (/permission|denied/i.test(err)) return t('pathDialog.err.permission');
      return t('pathDialog.err.notDir');
    }
    if (r?.root) {
      setRoot(r.root);
      pushRecent(r.root);
      setRecent(readRecent());
      void restoreWorkspace(r.root);
      void sendIo({ op: 'fs.list' }).then((res) => {
        const rr = res as { files?: FileEntry[] } | undefined;
        if (rr?.files) setFiles(rr.files);
        setWorkspaceReady(true);
      });
      setActiveView('files');
    }
    return null;
  }, [sendIo, restoreWorkspace]);
  const openFolderByPath = useCallback((path: string): Promise<string | null> => {
    const dirty = groupsRef.current.flatMap((g) => g.files.filter((f) => f.dirty && !f.readOnly));
    if (!dirty.length) return doOpenFolderByPath(path);
    setSavePrompt({
      name: dirty[0].path.split('/').pop() ?? dirty[0].path,
      count: dirty.length,
      onSave: () => { void saveAllDirtyAsync().then(() => { setSavePrompt(null); void doOpenFolderByPath(path); }); },
      onDiscard: () => { setSavePrompt(null); void doOpenFolderByPath(path); },
    });
    return Promise.resolve(null);
  }, [doOpenFolderByPath, saveAllDirtyAsync]);

  const doCloseWorkspace = useCallback(() => {
    setRoot(''); setFiles([]);
    disposeAllModels();
    setGroups([{ id: 'g1', files: [], activePath: null }]);
    setActiveGroupId('g1'); setSplitDir(null); setSplitRatio(0.5);
    setSizes({ ...DEFAULT_SIZES }); setExpandedDirs([]); setTreeRestore(null);
    setWorkspaceReady(true); setError(null);
    setActiveView('files');
    setSearch(''); setFileIndex([]);
  }, []);
  const closeWorkspace = () => guardDirty(doCloseWorkspace);
  const cloneRepo = (url: string) => {
    // The clone runs in the terminal; the user opens the folder afterwards
    // from Recent (no timed guess).
    void sendIo({ op: 'term.run', command: `git clone ${url}`, instance: 0 });
  };
  const newProject = async () => {
    // Pick the parent folder with the same native dialog as "open folder", then
    // scaffold a real directory tree there. Never invent a path from the
    // current root: with no workspace that produced `/pristem-project`.
    const picked = (await sendIo({ op: 'fs.pickFolder', select: true })) as
      { ok?: boolean; path?: string; error?: string } | undefined;
    if (!picked?.ok || !picked.path) return;
    const made = (await sendIo({ op: 'fs.newProject', parent: picked.path })) as
      { ok?: boolean; path?: string; error?: string } | undefined;
    if (!made?.ok || !made.path) {
      announce(made?.error ?? t('pathDialog.err.notDir'));
      return;
    }
    const err = await openFolderByPath(made.path);
    if (err) announce(err);
  };
  const jumpToLine = (line: number) => window.dispatchEvent(new CustomEvent('pristem:jump-line', { detail: line }));
  const focusTerminal = useCallback(() => {
    setActivityOpen(true);
    setActivityTab('terminal');
    // The component owns the active instance; the first ping covers an already
    // mounted terminal, the second one covers the expand/mount frame.
    const ping = () => window.dispatchEvent(new Event('pristem:terminal-focus'));
    window.setTimeout(ping, 0);
    window.setTimeout(ping, 150);
  }, []);

  const switchProvider = useCallback((id: string) => {
    const s = sessionsRef.current.find((x) => x.key === activeRef.current);
    if (!s || s.id == null) return;
    setPendingProvider(id);
    svcRef.current?.send({ type: 'set_provider', session: s.id, provider: id });
  }, []);

  // Recursive file index (fs.files) — powers quick-open + tree name filter.
  const reloadIndex = useCallback(() => {
    if (!caps.fsSearch) { setFileIndex([]); return; }
    void sendIo({ op: 'fs.files', limit: 4000 }).then((r) => {
      const res = r as { files?: string[] } | undefined;
      if (res?.files) setFileIndex(res.files);
    });
  }, [sendIo, caps.fsSearch]);

  useEffect(() => { reloadIndex(); }, [root, reloadIndex]);
  useEffect(() => {
    const onChanged = () => reloadIndex();
    window.addEventListener('pristem:fs-changed', onChanged);
    return () => window.removeEventListener('pristem:fs-changed', onChanged);
  }, [reloadIndex]);

  // The composer bar acts on real state only: workspace, endpoints, kernel modes.
  const composerCtx = useMemo<ComposerContext>(() => ({
    root,
    recent: recent.map((r) => ({ label: r.label, root: r.root })),
    files: fileIndex,
    providers: (providers ?? []).map((p) => ({ id: p.id, label: p.id, model: p.model, keyPresent: p.key_present })),
    currentProvider: active.providerId ?? providers?.find((p) => p.is_default)?.id ?? null,
    pendingProvider,
    permission,
    slash: [
      { token: '/goal', label: t('modeName.goal') },
      { token: '/coding', label: t('modeName.coding') },
      { token: '/helping', label: t('modeName.helping') },
      { token: '/advisor', label: t('modeName.advisor') },
      { token: '/deepsleep', label: t('modeName.deepsleep') },
      { token: '/ide', label: t('modeName.IDE') },
      { token: '/resume', label: t('ai.slash.resume') },
      { token: '/pause', label: t('ai.slash.pause') },
      { token: '/wake', label: t('ai.slash.wake') },
    ],
    onOpenFolder: openFolder,
    onOpenWorkspace: (r) => { void openFolderByPath(r); },
    onSwitchProvider: switchProvider,
    onSwitchMode: switchMode,
    onPermission: setComposerPermission,
  }), [root, recent, fileIndex, providers, active.providerId, pendingProvider, permission,
    openFolder, openFolderByPath, switchProvider, switchMode, setComposerPermission]);

  // After a workspace-wide replace, re-read every open buffer from disk and
  // refresh the shared models silently (no dirty flag from a disk refresh).
  const reloadOpenFiles = useCallback(() => {
    const paths = Array.from(new Set(groupsRef.current.flatMap((g) => g.files.map((f) => f.path))));
    void Promise.all(paths.map(async (p) => {
      const r = (await sendIo({ op: 'fs.read', path: p })) as { content?: string; truncated?: boolean };
      return { path: p, content: r?.content ?? '', truncated: !!r?.truncated };
    })).then((rows) => {
      const byPath = new Map(rows.map((r) => [r.path, r]));
      for (const r of rows) setModelContent(r.path, r.content);
      setGroups((prev) => prev.map((g) => ({
        ...g,
        files: g.files.map((f) => {
          const r = byPath.get(f.path);
          return r ? { ...f, content: r.content, dirty: false, readOnly: r.truncated } : f;
        }),
      })));
    });
  }, [sendIo]);

  // Problems rows ask to open a path before jumping to its line.
  useEffect(() => {
    const onOpenPath = (e: Event) => {
      const p = (e as CustomEvent<string>).detail;
      if (p) void openFile(p);
    };
    window.addEventListener('pristem:open-path', onOpenPath);
    return () => window.removeEventListener('pristem:open-path', onOpenPath);
  }, [openFile]);

  // -------------------------------------------------------------------------
  // Commands — one table behind the palette and the IDE menu bar (UX §2.3).
  // -------------------------------------------------------------------------
  const commands = buildCommands({
    sessionId: active.id,
    hasWorkspace: !noWorkspace,
    hasActiveFile: !!activePath,
    canRunActiveFile: !!activeFileTask(allFiles, activePath),
    newSession: () => newSession(),
    closeSession: () => closeTab(activeKey),
    restoreSession: () => loadLastSession(),
    setView: setActiveView,
    openOutline: () => window.dispatchEvent(new Event('pristem:outline-open')),
    openFolder: () => { void openFolder(); },
    newFile: () => void createFile(),
    quickOpen: () => { setPalette('file'); setPaletteQuery(''); },
    closeWorkspace: () => closeWorkspace(),
    save: () => window.dispatchEvent(new Event('pristem:save-request')),
    saveAll: () => { saveAllDirty(); announce(t('a11y.savedAll')); },
    closeEditor: () => { if (activePath) closePaths(activeGroupIdRef.current, [activePath]); },
    reopenEditor: () => reopenEditor(),
    split: (dir) => splitEditor(dir),
    toggleWordWrap: () => writeSettings({ editorWordWrap: !readSettings().editorWordWrap }),
    toggleMinimap: () => writeSettings({ editorMinimap: !readSettings().editorMinimap }),
    openSettings: (section) => openSettings(section),
    kernel: (req) => {
      const id = active.id;
      if (id == null) return;
      if (req === 'wake') { svcRef.current?.send({ type: 'list_reminders', session: id }); return; }
      svcRef.current?.send({ type: req, session: id });
    },
    switchMode: (m) => switchMode(m),
    switchLang: () => setLang(getLang() === 'zh-CN' ? 'en-US' : 'zh-CN'),
    focusTerminal: () => focusTerminal(),
    openActivity: (tab) => { setActivityOpen(true); setActivityTab(tab); },
    runActiveFile: () => runActiveFile(),
    runTests: () => runTests(),
    openTaskPicker: () => openTaskPicker(),
    stopTask: () => stopTask(),
    canMultiTerminal: caps.termInstance,
  });
  const paletteItems: PaletteItem[] = commands.map(({ id, label, group, keys, run }) => ({ id, label, group, keys, run }));
  const menus = buildMenus(commands);

  const fileItems = useMemo<PaletteItem[]>(() => {
    const paths = fileIndex.length ? fileIndex : files.filter((f) => !f.dir).map((f) => f.path);
    return paths.slice(0, 400).map((p) => ({
      id: `file:${p}`, label: p, run: () => { void openFile(p); },
    }));
  }, [fileIndex, files, openFile]);

  const fullView = mode === 'advisor' || mode === 'goal';
  const showRight = mode === 'coding' && !aiCollapsed;
  const showDock = mode === 'helping';
  /** Sessions belong to the modes that actually hold a conversation. */
  const canSessions = mode === 'coding' || mode === 'helping' || mode === 'goal';
  const sessionsColumn = sessionsOpen && (mode === 'helping' || showRight);

  const onResize = useCallback((kind: SizeKind, value: number) => {
    setSizes((prev) => ({ ...prev, [kind]: clampSize(kind, value) }));
  }, []);
  const onResetSize = useCallback((kind: SizeKind) => {
    setSizes((prev) => ({ ...prev, [kind]: DEFAULT_SIZES[kind] }));
  }, []);
  const leftW = showDock ? Math.max(sizes.left, 336) : sizes.left;
  /** The project column adapts its own chrome to its width, not the window's. */
  const railClass = leftW < 216 ? 'rail-tighter' : leftW < 248 ? 'rail-tight' : '';
  const wsStyle = {
    '--left-w': `${leftW}px`,
    // The AI column keeps its own width; the session column adds to it, and the
    // extra `--ai-grow` makes the conversation panel take a little more from the
    // editor instead of shrinking by the whole session width.
    '--right-base': showRight ? `${Math.max(sizes.right, 300)}px` : '0px',
    '--activity-h': activityOpen ? `${sizes.activity}px` : '8px',
  } as CSSProperties;

  useEffect(() => {
    if (!root || !workspaceReady || restoringRef.current) return;
    writeWorkspaceState(root, {
      expanded: expandedDirs,
      groups: groups.map((g) => ({ id: g.id, paths: g.files.map((f) => f.path), activePath: g.activePath })),
      activeGroupId, splitDir, splitRatio, activityOpen, activityTab, activeView, sizes,
    });
  }, [root, workspaceReady, expandedDirs, groups, activeGroupId, splitDir, splitRatio, activityOpen, activityTab, activeView, sizes]);

  const realSource = openFiles.find((f) => f.path === activePath)?.content?.slice(0, 1400);
  const sourceIsSample = !realSource;
  const reviewSource = realSource ?? REVIEW_SOURCE;
  const onDrag = () => { void sendIo({ op: 'window.drag' }); };
  const onWindow = (op: 'window.minimize' | 'window.maximize' | 'window.close') => { void sendIo({ op }); };

  const conn: ConnState = svc?.preview ? 'off'
    : active.id == null ? 'connecting' : 'ok';

  const aiActions = {
    onExport: () => {
      const md = active.items.map((i) => `**${i.kind}**  ${i.text ?? i.output ?? ''}`).join('\n\n');
      if (!md.trim()) { announce(t('a11y.nothingToExport')); return; }
      const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
      const a = document.createElement('a'); a.href = url; a.download = 'pristem-session.md'; a.click();
      URL.revokeObjectURL(url);
    },
    onCopy: (text: string) => { if (text) void writeClipboard(text); },
    onRegenerate: (text: string) => { setSuggestion(text); },
    onEdit: (text: string) => { setSuggestion(text); },
    onStop: () => {
      queueRef.current = []; setQueued(0);
      patch(activeKey, (s) => ({ ...s, running: false }));
      announce(t('ai.stopped'));
    },
  };

  const welcomeOverlay = noWorkspace ? (
    <Welcome
      onOpenFolder={() => { void openFolder(); }}
      onNewProject={capsKnown && caps.pickFolder ? () => { void newProject(); } : undefined}
      onClone={cloneRepo}
      onNewFile={() => void createFile()}
      onOpenRecent={(p) => { void openFolderByPath(p); }}
    />
  ) : undefined;

  const fileTree = (
    <FileTree
      files={files}
      root={root}
      activePath={activePath}
      filter={search}
      onOpen={(p) => void openFile(p)}
      onOpenFolder={() => { void openFolder(); }}
      onPastePath={() => setPathDialogOpen(true)}
      onRefresh={refreshWorkspace}
      onDelete={deleteFile}
      onRunTests={runTests}
      onCreate={onCreate}
      onRename={onRename}
      onCopy={onCopy}
      canExpand={caps.fsListPath}
      canMkdir={caps.fsMkdir}
      canRename={caps.fsRename}
      canCopy={caps.fsCopy}
      listDir={listDir}
      index={fileIndex}
      restore={treeRestore}
      onExpandedChange={setExpandedDirs}
      openEditors={openFiles.map((f) => ({ path: f.path, dirty: f.dirty }))}
      onActivateEditor={(p) => {
        setGroups((prev) => prev.map((g) => g.id === activeGroupIdRef.current ? { ...g, activePath: p } : g));
        window.setTimeout(() => window.dispatchEvent(new Event('pristem:editor-focus')), 0);
      }}
      onCloseEditor={(p) => closePaths(activeGroupIdRef.current, [p])}
    />
  );

  const sidePanel = activeView === 'files' ? fileTree
    : activeView === 'search' ? (
      <SearchPanel sendIo={sendIo}
        openPaths={openFiles.map((f) => f.path)}
        activePath={activePath}
        onOpen={(p, line) => { void openFile(p, true); window.setTimeout(() => jumpToLine(line), 300); }}
        onReplaced={reloadOpenFiles} />
    )
      : noWorkspace
        ? (
          <section className="pane side-panel">
            <div className="pane-head"><span className="eyebrow">{t('activity.git')}</span></div>
            <EmptyState variant="zero" title={t('welcome.title')} desc={t('welcome.desc')} icon={<EMPTY_ICONS.folder size={18} />} compact
              actions={[{ label: t('common.openFolder'), onClick: () => { void openFolder(); }, primary: true }]} />
          </section>
        )
        : <GitPanel sendIo={sendIo} onOpenFolder={() => { void openFolder(); }} onFocusTerminal={focusTerminal} />;

  // -------------------------------------------------------------------------
  // Keyboard map (UX §7.1) — every row has a real behaviour.
  // -------------------------------------------------------------------------
  useEffect(() => {
    let atHeld = false;
    let atAt = 0;
    const isEditableTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el || !el.tagName) return false;
      return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable ||
        !!el.closest('.monaco-editor') || !!el.closest('.xterm') || !!el.closest('.xterm-helper-textarea');
    };
    const down = (e: KeyboardEvent) => {
      if (e.key === '@' && e.shiftKey) { atHeld = true; atAt = performance.now(); }
      if (e.key === 'Escape') {
        // One Escape closes the topmost overlay only (UX §7.3).
        if (overlayStack.pop()) return;
        setOutlineOpen(false);
        return;
      }
      if (menuBarRef.current?.handleKey(e)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const workspaceActive = modeRef.current !== 'deepsleep' && modeRef.current !== 'goal';
      if (workspaceActive && e.altKey && !ctrl && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        writeSettings({ editorWordWrap: !readSettings().editorWordWrap });
        return;
      }
      if (ctrl && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault(); setPalette('command'); setPaletteQuery(''); return;
      }
      if (ctrl && (e.key === ',' || e.key === '，')) { e.preventDefault(); openSettings('appearance'); return; }
      if (!workspaceActive && ctrl) { e.preventDefault(); return; }
      if (ctrl && e.shiftKey && (e.key === 'E' || e.key === 'e')) { e.preventDefault(); setActiveView('files'); return; }
      if (ctrl && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); setActiveView('search'); return; }
      if (ctrl && e.shiftKey && (e.key === 'H' || e.key === 'h')) { e.preventDefault(); setActiveView('search'); window.setTimeout(() => window.dispatchEvent(new Event('pristem:focus-replace')), 60); return; }
      if (ctrl && e.shiftKey && (e.key === 'G' || e.key === 'g')) { e.preventDefault(); setActiveView('git'); return; }
      if (ctrl && e.shiftKey && (e.key === 'O' || e.key === 'o')) { e.preventDefault(); window.dispatchEvent(new Event('pristem:outline-open')); return; }
      if (ctrl && !e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault(); setPalette('file'); setPaletteQuery(''); return;
      }
      if (ctrl && (e.key === 'B' || e.key === 'b')) {
        e.preventDefault();
        if (modeRef.current === 'coding') setAiCollapsed((v) => !v);
        return;
      }
      if (ctrl && (e.key === '`' || e.key === '~')) {
        e.preventDefault();
        // Press again while the terminal already has focus → collapse the strip.
        const inTerminal = !!(document.activeElement as HTMLElement | null)?.closest?.('.terminal-pane');
        if (activityOpen && activityTab === 'terminal' && inTerminal) { setActivityOpen(false); return; }
        focusTerminal();
        return;
      }
      if (ctrl && e.shiftKey && (e.key === 'S' || e.key === 's')) {
        e.preventDefault();
        saveAllDirty();
        announce(t('a11y.savedAll'));
        return;
      }
      if (ctrl && (e.key === 'S' || e.key === 's')) {
        e.preventDefault();
        if (modeRef.current === 'deepsleep' || modeRef.current === 'goal') return;
        const target = openFiles.find((o) => o.path === activePath);
        if (!target) { announce(t('a11y.noOpenFile')); return; }
        if (!target.dirty) { announce(t('a11y.alreadySaved')); return; }
        window.dispatchEvent(new Event('pristem:save-request'));
        return;
      }
      if (ctrl && (e.key === 'G' || e.key === 'g')) {
        e.preventDefault();
        window.dispatchEvent(new Event('pristem:jump-line-open'));
        return;
      }
      if (ctrl && e.code === 'Backslash') {
        e.preventDefault();
        splitEditor(e.shiftKey ? 'column' : 'row');
        return;
      }
      if (ctrl && (e.key === 'Tab' || e.code === 'Tab')) {
        e.preventDefault();
        const g = groupsRef.current.find((x) => x.id === activeGroupIdRef.current) ?? groupsRef.current[0];
        if (!g || g.files.length < 2) return;
        const i = g.files.findIndex((f) => f.path === g.activePath);
        const next = g.files[(i + (e.shiftKey ? -1 : 1) + g.files.length) % g.files.length];
        setGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, activePath: next.path } : x)));
        window.setTimeout(() => window.dispatchEvent(new Event('pristem:editor-focus')), 0);
        return;
      }
      if (ctrl && (e.key === 'W' || e.key === 'w')) {
        e.preventDefault();
        if (activePath) closePaths(activeGroupIdRef.current, [activePath]);
        return;
      }
      if (ctrl && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault();
        reopenEditor();
        return;
      }
      if (workspaceActive && ctrl && (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd')) {
        e.preventDefault();
        zoomEditor(1);
        return;
      }
      if (workspaceActive && ctrl && (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract')) {
        e.preventDefault();
        zoomEditor(-1);
        return;
      }
      if (workspaceActive && ctrl && (e.key === '0' || e.code === 'Numpad0')) {
        e.preventDefault();
        // ponytail: zoom edits the same value as the settings font size, so reset
        // returns to the default rather than a remembered pre-zoom size.
        writeSettings({ editorFontSize: 13 });
        announce(t('a11y.zoom', { n: 13 }));
        return;
      }
      const isF2 = e.code === 'F2' || e.key === 'F2';
      if (isF2) { e.preventDefault(); setModeMenuOpen((v) => !v); return; }
      const isF1 = e.key === 'F1' || e.code === 'F1';
      // Order-independent chord: Shift+F1 works alone, and a recently pressed @ still counts.
      if (isF1 && (atHeld || e.shiftKey || performance.now() - atAt < 1500)) {
        e.preventDefault();
        window.dispatchEvent(new Event('pristem:remove-at'));
        summonAt({ ...pointer.current });
        return;
      }
      if (atHeld && e.key.toLowerCase() === 's' && !ctrl && !isEditableTarget(e.target)) {
        e.preventDefault();
        window.dispatchEvent(new Event('pristem:remove-at'));
        loadLastSession();
      }
    };
    const up = (e: KeyboardEvent) => { if (e.key === '@' || e.code === 'Digit2') atHeld = false; };
    const move = (e: MouseEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      const now = performance.now();
      if (now - ptrWrite.current.t < 32) return;
      ptrWrite.current.t = now;
      // Local pointer reaction for tagged surfaces: --px/--py are -1..1 from the
      // element centre, --mx/--my are 0..1 inside it. Always live — the LIVING
      // freeze only pauses the ambient layer, never direct manipulation.
      const host = (e.target as Element | null)?.closest?.('[data-pointer]') as HTMLElement | null;
      if (host) {
        const r = host.getBoundingClientRect();
        const px = clamp(((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -1, 1);
        const py = clamp(((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1, -1, 1);
        host.style.setProperty('--px', px.toFixed(2));
        host.style.setProperty('--py', py.toFixed(2));
        host.style.setProperty('--mx', ((px + 1) / 2).toFixed(2));
        host.style.setProperty('--my', ((py + 1) / 2).toFixed(2));
      }
      if (livingRef.current?.pointerFrozen()) return;
      const nx = clamp((e.clientX / window.innerWidth) * 2 - 1, -1, 1);
      const ny = clamp((e.clientY / window.innerHeight) * 2 - 1, -1, 1);
      const qx = quantize(nx, 0.02), qy = quantize(ny, 0.02);
      if (qx !== ptrWrite.current.x) { appShellRef.current?.style.setProperty('--ptr-x', String(qx)); ptrWrite.current.x = qx; }
      if (qy !== ptrWrite.current.y) { appShellRef.current?.style.setProperty('--ptr-y', String(qy)); ptrWrite.current.y = qy; }
    };
    const onVisibility = () => {
      if (document.hidden) document.documentElement.dataset.living = 'paused';
      else delete document.documentElement.dataset.living;
    };
    const onQuickOpen = () => { setPalette('file'); setPaletteQuery(''); };
    const onSaveAll = () => { saveAllDirty(); announce(t('a11y.savedAll')); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('mousemove', move);
    window.addEventListener('pristem:quick-open', onQuickOpen);
    window.addEventListener('pristem:save-all-request', onSaveAll);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('pristem:quick-open', onQuickOpen);
      window.removeEventListener('pristem:save-all-request', onSaveAll);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadLastSession, summonAt, announce, focusTerminal, openSettings, openFiles, activePath, splitEditor, closePaths, saveAllDirty, activityOpen, activityTab, reopenEditor, zoomEditor]);

  return (
    <div className={`app-shell mode-${mode.toLowerCase()} ${svc?.preview ? 'is-preview' : ''}`} ref={appShellRef} aria-label="pristem">
      <TitleBar
        mode={mode}
        modeMenuOpen={modeMenuOpen}
        onToggleModeMenu={() => setModeMenuOpen((v) => !v)}
        modeState={modeSwitch}
        onSwitchMode={switchMode}
        onRetrySwitch={retrySwitch}
        onRecover={recoverSwitch}
        root={root}
        search={search}
        onSearch={setSearch}
        onWindow={onWindow}
        onDrag={onDrag}
        onPalette={(m) => { setPalette(m); setPaletteQuery(m === 'file' ? '' : search); }}
        haloRef={haloRef}
        sessionSwitcher={
          canSessions ? (
            <SessionToggle
              open={sessionsOpen}
              count={sessions.length}
              label={active.label}
              onToggle={() => setSessionsOpen((v) => !v)}
            />
          ) : undefined
        }
        menubar={<MenuBar ref={menuBarRef} menus={menus} onCompact={() => { setPalette('command'); setPaletteQuery(''); }} />}
      />

      {!fullView && (
        <main className="workbench" id="pristem-workbench" role="main">
          <div
            className={`workspace ${showRight ? 'has-right' : ''} ${sessionsColumn ? 'has-sessions' : ''} ${showDock ? 'has-dock' : ''} ${activityOpen ? '' : 'activity-collapsed'} ${railClass}`}
            ref={workspaceRef}
            style={wsStyle}
          >
            <div className="left-column">
              <ActivityRail active={activeView} onChange={setActiveView} onOpenSettings={() => openSettings('appearance')} />
              <div className="left-main">
                <div className={`left-body ${showDock ? 'has-dock' : ''}`}>
                  {showDock ? fileTree : sidePanel}
                  {showDock && (
                    <AiPanel variant="dock" mode={mode} items={active.items} running={active.running}
                      onSend={(v) => submit(v)} onConfirm={confirm}
                      onEscalate={() => switchMode('coding')} onDismiss={() => switchMode('IDE')}
                      onExport={aiActions.onExport} onCopy={aiActions.onCopy}
                      onRegenerate={aiActions.onRegenerate} onEdit={aiActions.onEdit} onStop={aiActions.onStop}
                      queued={queued} suggestionText={suggestion} onConsumeSuggestion={() => setSuggestion(null)}
                      blocked={noWorkspace} usage={active.usage} providerName={active.providerModel} composer={composerCtx} />
                  )}
                </div>
              </div>
            </div>
            <EditorArea
              groups={groups} splitDir={splitDir} activeGroupId={activeGroupId} splitRatio={splitRatio}
              onActivateGroup={setActiveGroupId} onSplitResize={setSplitRatio}
              renderPane={(g, isActive) => (
                <EditorPane
                  openFiles={g.files} activePath={g.activePath}
                  onContentChange={onContentChange} onSave={onSave}
                  onClose={(p) => closePaths(g.id, [p])}
                  onActivate={(p) => { setActiveGroupId(g.id); setGroups((prev) => prev.map((x) => x.id === g.id ? { ...x, activePath: p } : x)); }}
                  onAtSummon={summonAt} summonEnabled={isDormant}
                  overlay={groups.length === 1 ? welcomeOverlay : undefined}
                  onNewFile={() => void createFile()} onOpenFolder={() => { void openFolder(); }}
                  outline={parseOutline(g.files.find((f) => f.path === g.activePath)?.content ?? '')}
                  onProblems={setProblems}
                  isActive={isActive} canSplit={groups.length < 2} isSplit={groups.length > 1}
                  onSplitRight={() => splitEditor('row')} onSplitDown={() => splitEditor('column')}
                  onCloseGroup={() => closeGroup(g.id)} onReveal={revealInExplorer}
                  onOpenToSide={(p) => { void openToSide(p); }}
                  onCloseToRight={(p) => closeToRight(g.id, p)} onCloseOthers={(p) => closeOthers(g.id, p)}
                  onReorder={(from, to) => moveTab(g.id, from, to)}
                />
              )}
            />
            <TerminalPane sendIo={sendIo} canMultiInstance={caps.termInstance} ptyAvailable={caps.pty} capsKnown={capsKnown} problems={problems}
              defaultInstances={defaultInstances}
              activityOpen={activityOpen} onActivityOpenChange={setActivityOpen}
              tab={activityTab} onTabChange={setActivityTab} />
            {sessionsColumn && (
              <SessionPanel
                sessions={sessions.map((s) => ({
                  key: s.key, label: s.label, mode: s.mode, id: s.id,
                  running: s.running, updatedAt: s.updatedAt,
                }))}
                activeKey={activeKey}
                onActivate={activateTab}
                onNew={() => newSession()}
                onClose={closeTab}
                onCollapse={() => setSessionsOpen(false)}
              />
            )}
            {showRight && (
              <AiPanel variant="right" mode={mode} items={active.items} running={active.running}
                onSend={(v) => submit(v)} onConfirm={confirm} onCollapse={() => setAiCollapsed(true)}
                onExport={aiActions.onExport} onCopy={aiActions.onCopy}
                onRegenerate={aiActions.onRegenerate} onEdit={aiActions.onEdit} onStop={aiActions.onStop}
                queued={queued} suggestionText={suggestion} onConsumeSuggestion={() => setSuggestion(null)}
                blocked={noWorkspace} usage={active.usage} providerName={active.providerModel} composer={composerCtx} />
            )}
            {mode === 'coding' && aiCollapsed && (
              <button className="reopen-ai" onClick={() => setAiCollapsed(false)} aria-label={t('ai.reopen')} title={t('ai.reopen')} data-ai="true">
                <PanelRightOpen size={15} />
              </button>
            )}
            <Separators
              workspaceRef={workspaceRef} sizes={sizes} showRight={showRight} showDock={showDock}
              activityOpen={activityOpen} onResize={onResize} onReset={onResetSize}
            />
          </div>
        </main>
      )}

      {mode === 'advisor' && (
        <AdvisorCanvas source={reviewSource} annotations={active.annotations} onAdd={addAnnotation}
          onSubmit={submitAnnotations} handoff={active.handoff} items={active.items}
          sourceIsSample={sourceIsSample} />
      )}
      {mode === 'deepsleep' && (
        <DeepsleepView items={active.items} briefing={active.wakeBriefing}
          onResume={onResumeFromSleep} onResumeSession={onResumeSession} onWake={onWake}
          onDismissBriefing={() => patch(activeKey, (s) => ({ ...s, wakeBriefing: null, wakePending: false }))} />
      )}
      {mode === 'goal' && (
        <GoalView items={active.items} goal={active.goal} running={active.running} onSend={(v) => submit(v)}
          sessions={sessions.map((s) => ({
            key: s.key, label: s.label, mode: s.mode, id: s.id,
            running: s.running, updatedAt: s.updatedAt,
          }))}
          activeKey={activeKey}
          sessionsOpen={sessionsOpen}
          onNewSession={() => newSession()}
          onActivate={activateTab}
          onClose={closeTab}
          onToggleSessions={() => setSessionsOpen((v) => !v)} />
      )}

      <StatusBar
        sessionLabel={`${active.label} ${active.id == null ? t('status.connecting') : `#${active.id}`}`}
        conn={conn}
        onRetryConnection={retryConnection}
        protocol={protocol}
        a11yRef={a11yRef}
        alertRef={alertRef}
      />

      {error && (
        <div className="toast-stack" data-pop="global-error">
          <ErrorCard code={error} compact detail={error}
            onRetry={() => {
              if (error === 'noWorkspace') { setError(null); setPathDialogOpen(true); }
              else setError(null);
            }} />
        </div>
      )}

      {taskPicker && (
        <div className="task-picker" data-pop="task-picker" role="dialog" aria-modal="true" aria-label={t('task.picker')}>
          <div className="task-picker-head">{t('task.picker')}</div>
          {taskPicker.length === 0 ? (
            <div className="task-picker-empty">{t('task.empty')}</div>
          ) : taskPicker.map((task) => (
            <button key={task.id} type="button" onClick={() => { setTaskPicker(null); runTask(task); }}>
              <span className="task-label">{task.label}</span>
              <span className="task-command">{task.command}</span>
            </button>
          ))}
        </div>
      )}

      {palette && (
        <CommandPalette
          mode={palette}
          items={palette === 'file' ? fileItems : paletteItems}
          initialQuery={paletteQuery}
          onClose={() => { setPalette(null); setPaletteQuery(''); }}
        />
      )}

      {pathDialogOpen && (
        <PathDialog
          open
          noNative={capsKnown && !caps.pickFolder}
          onClose={() => setPathDialogOpen(false)}
          onSubmit={openFolderByPath}
        />
      )}

      {settingsOpen && (
        <SettingsPage
          protocol={protocol}
          sendIo={sendIo}
          currentProvider={active.providerId ?? providers?.find((p) => p.is_default)?.id ?? null}
          pendingProvider={pendingProvider}
          onSwitchProvider={switchProvider}
          capabilities={caps}
          hasActiveSession={active.id != null}
          recent={recent}
          onRemoveRecent={(r) => { removeRecent(r); setRecent(readRecent()); }}
          onClearRecent={() => { clearRecent(); setRecent(readRecent()); }}
          onOpenWorkspace={(r) => { void openFolderByPath(r); setSettingsOpen(false); }}
          onExport={aiActions.onExport}
          onClearSession={() => patch(activeKey, (s) => ({ ...s, items: [] }))}
          onClose={() => setSettingsOpen(false)}
          initialSection={settingsSection}
          commandRows={commands.map(({ label, keys }) => ({ label, keys }))}
        />
      )}

      {guideOpen && (
        <Onboarding
          root={root}
          sendIo={sendIo}
          onPickFolder={openFolder}
          onOpenPath={openFolderByPath}
          onDone={finishGuide}
          onOpenSettings={() => { finishGuide(); openSettings('providers'); }}
        />
      )}

      {summon && isDormant && (
        <Summon x={summon.x} y={summon.y} onSend={(v) => { setSummon(null); submit(v, true); }} onClose={() => setSummon(null)} />
      )}

      {savePrompt && (
        <SavePromptDialog
          name={savePrompt.name}
          count={savePrompt.count}
          onSave={savePrompt.onSave}
          onDiscard={savePrompt.onDiscard}
          onCancel={() => setSavePrompt(null)}
        />
      )}
    </div>
  );
}
