/**
 * Per-root workspace memory (plan 4d). Layout sizes, open groups, split, tree
 * expansion and activity state survive a refresh. Storage is keyed by root so
 * two projects never share a layout. Writes are debounced; closing a workspace
 * clears memory but keeps the stored snapshot for the next open.
 */
export interface WorkspaceSnapshot {
  expanded: string[];
  groups: { id: string; paths: string[]; activePath: string | null }[];
  activeGroupId: string;
  splitDir: 'row' | 'column' | null;
  splitRatio: number;
  activityOpen: boolean;
  activityTab: string;
  activeView: string;
  sizes: { left: number; right: number; activity: number };
}

export type SizeKind = 'left' | 'right' | 'activity';

export const DEFAULT_SIZES = { left: 268, right: 360, activity: 176 };
export const SIZE_LIMITS: Record<SizeKind, [number, number]> = {
  left: [200, 460],
  // The AI panel needs room for its composer chips; below this the bar wraps.
  right: [300, 560],
  activity: [120, 520],
};

export function clampSize(kind: SizeKind, value: number): number {
  const [min, max] = SIZE_LIMITS[kind];
  return Math.max(min, Math.min(max, Math.round(value)));
}

const keyFor = (root: string) => `pristem.ws:${root}`;
const timers = new Map<string, number>();

export function readWorkspaceState(root: string): WorkspaceSnapshot | null {
  if (!root) return null;
  try {
    const raw = localStorage.getItem(keyFor(root));
    if (!raw) return null;
    return JSON.parse(raw) as WorkspaceSnapshot;
  } catch {
    return null;
  }
}

export function writeWorkspaceState(root: string, snap: WorkspaceSnapshot): void {
  if (!root) return;
  const prev = timers.get(root);
  if (prev) window.clearTimeout(prev);
  timers.set(root, window.setTimeout(() => {
    timers.delete(root);
    try { localStorage.setItem(keyFor(root), JSON.stringify(snap)); } catch { /* ignore */ }
  }, 300));
}

export function clearWorkspaceState(root: string): void {
  if (!root) return;
  const prev = timers.get(root);
  if (prev) window.clearTimeout(prev);
  timers.delete(root);
  try { localStorage.removeItem(keyFor(root)); } catch { /* ignore */ }
}