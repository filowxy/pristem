/**
 * Purely local settings (language, type scale, motion, editor and terminal
 * preferences). The kernel has no configuration write API yet, so anything
 * that needs the kernel is either disabled or marked "this session only"
 * (UX §3.3).
 */
export type MotionMode = 'system' | 'reduced' | 'full';
export type CursorStyle = 'block' | 'underline' | 'bar';
export type ShellProfileId = 'auto' | 'pwsh' | 'powershell' | 'cmd';
/** How the agent's edits are gated: ask first, ask only for new surfaces, or no restriction. */
export type ComposerPermission = 'ask' | 'auto' | 'open';

export interface LocalSettings {
  baseFont: number;
  motion: MotionMode;
  living: boolean;
  editorFontSize: number;
  tabSize: number;
  autoSave: boolean;
  formatOnSave: boolean;
  editorMinimap: boolean;
  editorWordWrap: boolean;
  cursorStyle: CursorStyle;
  breathe: boolean;
  pointerFollow: boolean;
  livingIntensity: number;
  defaultInstances: 1 | 2 | 3;
  shellProfile: ShellProfileId;
  terminalFontSize: number;
  permission: ComposerPermission;
}

const KEY = 'pristem.local';

const DEFAULTS: LocalSettings = {
  baseFont: 13,
  motion: 'system',
  living: true,
  editorFontSize: 13,
  tabSize: 4,
  autoSave: false,
  formatOnSave: false,
  editorMinimap: true,
  editorWordWrap: false,
  cursorStyle: 'block',
  breathe: true,
  pointerFollow: true,
  livingIntensity: 100,
  defaultInstances: 1,
  shellProfile: 'auto',
  terminalFontSize: 12,
  permission: 'open',
};

let current: LocalSettings = { ...DEFAULTS };
try {
  const raw = localStorage.getItem(KEY);
  if (raw) current = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<LocalSettings>) };
} catch { /* storage unavailable */ }

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
current.baseFont = clampInt(current.baseFont, 11, 18, DEFAULTS.baseFont);
current.editorFontSize = clampInt(current.editorFontSize, 8, 32, DEFAULTS.editorFontSize);
current.tabSize = clampInt(current.tabSize, 1, 8, DEFAULTS.tabSize);
current.terminalFontSize = clampInt(current.terminalFontSize, 8, 32, DEFAULTS.terminalFontSize);

const listeners = new Set<() => void>();

export function readSettings(): LocalSettings { return current; }

export function writeSettings(patch: Partial<LocalSettings>): void {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* ignore */ }
  listeners.forEach((l) => l());
  syncSettingsToRoot(current);
}

export function subscribeSettings(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Mirror the visual settings onto the document root. */
export function syncSettingsToRoot(s: LocalSettings = current): void {
  const root = document.documentElement;
  const scale = s.baseFont / 13;
  const set = (name: string, px: number) => root.style.setProperty(name, `${px * scale}px`);
  // Every readable token follows the user's base size, not just four of them.
  // Keeping one scale function here is what makes typography consistent when
  // the preference changes (DESIGN §3.3).
  const readable: Record<string, number> = {
    '--fs-hero': 34, '--fs-display': 26, '--fs-title': 20, '--fs-subtitle': 15,
    '--fs-body': 13, '--fs-body-sm': 12, '--fs-label': 11, '--fs-micro': 10,
    '--fs-eyebrow': 10, '--fs-mono': 11.5, '--fs-mono-xs': 10, '--fs-num': 20,
  };
  for (const [name, px] of Object.entries(readable)) set(name, px);
  if (s.motion === 'reduced') root.dataset.motion = 'reduced';
  else if (s.motion === 'full') root.dataset.motion = 'full';
  else delete root.dataset.motion;
  if (s.living && s.breathe) delete root.dataset.living;
  else root.dataset.living = 'off';
  root.dataset.pointer = s.pointerFollow ? 'on' : 'off';
}

syncSettingsToRoot(current);
