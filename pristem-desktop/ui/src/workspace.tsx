import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ReactNode } from 'react';
import {
  Braces, ChevronDown, ChevronRight, ChevronsDownUp, Eraser, File, FileCode2, FileText,
  Image, ListTree, MoreHorizontal, Plus, TerminalSquare, X,
} from 'lucide-react';
import { SemanticIcon } from './components/SemanticIcon';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { monaco } from './monaco-setup';
import { acquireModel, peekModel, releaseModel, isSilent as isModelSilent } from './editorModels';
import { EmptyState, EMPTY_ICONS } from './components/EmptyState';
import { OutputPanel } from './components/Panels';
import { t, useI18n } from './i18n';
import { isSilent, recordOutput } from './terminalBus';
import { readSettings, subscribeSettings, type ShellProfileId } from './localSettings';
import { useDismissable, layerProps } from './components/overlayStack';
import type { FileEntry, IoEvent, IoRequest } from './types';
import type { OutlineSymbol } from './components/Panels';
import { readClipboard, writeClipboard } from './service';

export interface Problem {
  severity: 'error' | 'warning' | 'info';
  message: string;
  path: string;
  line: number;
  column: number;
}

// ---------------------------------------------------------------------------
// File tree — lazy per-level listing at arbitrary depth, with a context menu,
// inline create/rename, and roving-tabindex keyboard nav (DESIGN §8.6).
// ---------------------------------------------------------------------------

function treeIcon(f: FileEntry, isOpen: boolean, size = 14) {
  if (f.dir) return <SemanticIcon name="folder" size={size} open={isOpen} className="ico-dir" />;
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(ext)) {
    return <Image size={size} strokeWidth={1.75} className="ico-img" />;
  }
  if (['json', 'toml', 'yaml', 'yml'].includes(ext)) {
    return <Braces size={size} strokeWidth={1.75} className="ico-config" />;
  }
  if (['ps1', 'cmd', 'bat', 'vbs', 'sh'].includes(ext)) {
    return <TerminalSquare size={size} strokeWidth={1.75} className="ico-script" />;
  }
  if (['rs', 'ts', 'tsx', 'js', 'jsx', 'py', 'sql', 'css', 'scss', 'html', 'c', 'cpp', 'h', 'go', 'java'].includes(ext)) {
    return <FileCode2 size={size} strokeWidth={1.75} className="ico-code" />;
  }
  if (['md', 'txt', 'log', 'lock', 'cfg', 'ini'].includes(ext)) {
    return <FileText size={size} strokeWidth={1.75} className="ico-doc" />;
  }
  return <File size={size} strokeWidth={1.75} className="ico-file" />;
}

type EditState =
  | { kind: 'create'; parent: string; isDir: boolean }
  | { kind: 'rename'; entry: FileEntry };

const parentOf = (p: string) => { const i = p.lastIndexOf('/'); return i > 0 ? p.slice(0, i) : ''; };
const escAttr = (p: string) => p.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Inline name editor for create/rename. Enter commits, Esc/blur cancels. */
function TreeNameInput({ initial, onCommit, onCancel }: {
  initial: string; onCommit: (name: string) => void; onCancel: () => void;
}) {
  const [val, setVal] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { const el = ref.current; if (el) { el.focus(); el.select(); } }, []);
  const validate = (n: string) => {
    const s = n.trim();
    if (!s) return t('tree.nameRequired');
    if (/[\\/:*?"<>|]/.test(s) || s === '.' || s === '..') return t('tree.invalidName');
    return null;
  };
  const commit = () => {
    const e = validate(val);
    if (e) { setErr(e); ref.current?.focus(); return; }
    done.current = true;
    onCommit(val.trim());
  };
  return (
    <div className="tree-row is-editing">
      <input
        ref={ref}
        className="tree-name-input"
        value={val}
        aria-label={t('common.rename')}
        aria-invalid={err ? true : undefined}
        onChange={(e) => { setVal(e.target.value); if (err) setErr(null); }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); done.current = true; onCancel(); }
        }}
        onBlur={() => { if (!done.current) onCancel(); }}
      />
      {err && <span className="tree-name-err" role="alert">{err}</span>}
    </div>
  );
}

export function FileTree({
  files,
  root,
  activePath,
  filter,
  onOpen,
  onOpenFolder,
  onPastePath,
  onRefresh,
  onDelete,
  onRunTests,
  onCreate,
  onRename,
  onCopy,
  canExpand,
  canMkdir,
  canRename,
  canCopy,
  listDir,
  index,
  restore,
  onExpandedChange,
  openEditors,
  onActivateEditor,
  onCloseEditor,
}: {
  files: FileEntry[];
  root: string;
  activePath: string | null;
  filter: string;
  onOpen: (p: string) => void;
  onOpenFolder: () => void;
  onPastePath: () => void;
  onRefresh: () => void;
  onDelete?: (p: string) => Promise<boolean> | boolean | void;
  onRunTests?: () => void;
  onCreate?: (parent: string, name: string, isDir: boolean) => Promise<boolean>;
  onRename?: (from: string, to: string) => Promise<boolean>;
  onCopy?: (from: string, to: string) => Promise<boolean>;
  canExpand: boolean;
  canMkdir: boolean;
  canRename: boolean;
  canCopy: boolean;
  listDir: (path: string) => Promise<FileEntry[]>;
  index?: string[];
  restore?: { paths: string[]; nonce: number } | null;
  onExpandedChange?: (paths: string[]) => void;
  /** Open buffers of the active editor group, listed above the tree. */
  openEditors?: { path: string; dirty: boolean }[];
  onActivateEditor?: (path: string) => void;
  onCloseEditor?: (path: string) => void;
}) {
  const [children, setChildren] = useState<Record<string, FileEntry[]>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({ __root__: true });
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [pendingDel, setPendingDel] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: FileEntry | null } | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [focusPath, setFocusPath] = useState<string>('__root__');
  const [clip, setClip] = useState<{ mode: 'copy' | 'cut'; path: string } | null>(null);
  const [dragPath, setDragPath] = useState<string | null>(null);
  const dragPathRef = useRef<string | null>(null);
  dragPathRef.current = dragPath;
  const [dropPath, setDropPath] = useState<string | null>(null);
  const [openEditorsOpen, setOpenEditorsOpen] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const delTimer = useRef<number | null>(null);
  const testTimer = useRef<number | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const openRef = useRef(open); openRef.current = open;
  const childrenRef = useRef(children); childrenRef.current = children;
  useI18n();
  useDismissable('tree-menu', !!menu, () => setMenu(null));

  const shortRoot = root
    ? (root.split(/[\\/]/).filter(Boolean).pop() ?? root)
    : t('welcome.noFolder');
  const needle = filter.trim().toLowerCase().replace(/^[>/]\s*/, '');
  const shown = useMemo(() => {
    if (!needle) return files;
    if (index && index.length) {
      return index
        .filter((p) => (p.split('/').pop() ?? p).toLowerCase().includes(needle))
        .slice(0, 200)
        .map((p) => ({ name: p.split('/').pop() ?? p, path: p, dir: false }));
    }
    return files.filter((f) => f.name.toLowerCase().includes(needle));
  }, [files, needle, index]);

  const reloadDir = async (dir: string) => {
    setLoading((l) => ({ ...l, [dir]: true }));
    setErrors((er) => ({ ...er, [dir]: false }));
    try {
      const list = await listDir(dir);
      setChildren((c) => ({ ...c, [dir]: list }));
    } catch {
      setErrors((er) => ({ ...er, [dir]: true }));
    } finally {
      setLoading((l) => ({ ...l, [dir]: false }));
    }
  };

  const toggle = async (f: FileEntry) => {
    if (open[f.path]) { setOpen((o) => ({ ...o, [f.path]: false })); return; }
    setOpen((o) => ({ ...o, [f.path]: true }));
    if (!childrenRef.current[f.path]) await reloadDir(f.path);
  };

  const focusEl = (p: string) => {
    const el = sectionRef.current?.querySelector<HTMLElement>(`[data-tree-path="${escAttr(p)}"]`);
    el?.focus();
  };

  // Re-list expanded dirs whenever the shell reports a filesystem change.
  useEffect(() => {
    const onChanged = () => {
      Object.keys(openRef.current)
        .filter((k) => k !== '__root__' && openRef.current[k])
        .forEach((dir) => { void reloadDir(dir); });
    };
    window.addEventListener('pristem:fs-changed', onChanged);
    return () => window.removeEventListener('pristem:fs-changed', onChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listDir]);

  // Report expanded dirs upward so the workspace snapshot can persist them.
  useEffect(() => {
    onExpandedChange?.(Object.keys(open).filter((k) => k !== '__root__' && open[k]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Restore: expand each saved dir and its ancestors level-by-level (plan 4d).
  useEffect(() => {
    if (!restore || !restore.paths.length) return;
    let cancelled = false;
    const dirs = new Set<string>();
    for (const p of restore.paths) {
      const parts = p.split('/').filter(Boolean);
      let acc = '';
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        dirs.add(acc);
      }
      dirs.add(p);
    }
    const ordered = Array.from(dirs).sort((a, b) => a.split('/').length - b.split('/').length);
    void (async () => {
      for (const d of ordered) {
        if (cancelled) return;
        setOpen((o) => ({ ...o, [d]: true }));
        if (!childrenRef.current[d]) await reloadDir(d);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restore?.nonce]);

  // Reveal: expand ancestors level-by-level, then scroll the row into view.
  useEffect(() => {
    const onReveal = async (e: Event) => {
      const path = (e as CustomEvent).detail as string;
      if (!path) return;
      const parts = path.split('/').filter(Boolean);
      let acc = '';
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        setOpen((o) => ({ ...o, [acc]: true }));
        if (!childrenRef.current[acc]) await reloadDir(acc);
      }
      setFocusPath(path);
      window.requestAnimationFrame(() => {
        const el = sectionRef.current?.querySelector<HTMLElement>(`[data-tree-path="${escAttr(path)}"]`);
        el?.scrollIntoView({ block: 'nearest' });
        el?.focus();
      });
    };
    window.addEventListener('pristem:reveal', onReveal);
    return () => window.removeEventListener('pristem:reveal', onReveal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listDir]);

  // Welcome-screen "New File" routes here so creation is always inline.
  useEffect(() => {
    const onNew = () => startCreate('', false);
    window.addEventListener('pristem:tree-new-file', onNew);
    return () => window.removeEventListener('pristem:tree-new-file', onNew);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const askDelete = async (p: string) => {
    if (pendingDel === p) {
      setPendingDel(null);
      const ok = await onDelete?.(p);
      if (ok !== false) {
        setChildren((c) => Object.fromEntries(
          Object.entries(c).map(([dir, list]) => [
            dir, list.filter((e) => e.path !== p && !e.path.startsWith(p + '/')),
          ]),
        ));
      }
      return;
    }
    setPendingDel(p);
    if (delTimer.current) window.clearTimeout(delTimer.current);
    delTimer.current = window.setTimeout(() => setPendingDel(null), 3200);
  };

  const runTests = () => {
    onRunTests?.();
    setTesting(true);
    if (testTimer.current) window.clearTimeout(testTimer.current);
    testTimer.current = window.setTimeout(() => setTesting(false), 2600);
  };

  const startCreate = (parent: string, isDir: boolean) => {
    setMenu(null);
    if (parent) {
      setOpen((o) => ({ ...o, [parent]: true }));
      if (!childrenRef.current[parent]) void reloadDir(parent);
    }
    setEditing({ kind: 'create', parent, isDir });
  };

  const startRename = (entry: FileEntry) => {
    setMenu(null);
    setEditing({ kind: 'rename', entry });
  };

  const notify = (msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3200);
  };

  const uniqueCopyName = (name: string, existing: Set<string>) => {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot) : '';
    const stem = ext ? name.slice(0, -ext.length) : name;
    let candidate = `${stem} copy${ext}`;
    let n = 2;
    while (existing.has(candidate)) { candidate = `${stem} copy ${n}${ext}`; n += 1; }
    return candidate;
  };

  const targetDirFor = (entry: FileEntry | null) => (!entry ? '' : entry.dir ? entry.path : parentOf(entry.path));

  const pasteInto = async (dir: string) => {
    if (!clip) return;
    const isCut = clip.mode === 'cut';
    if (isCut ? (!canRename || !onRename) : (!canCopy || !onCopy)) {
      notify(t('tree.opUnavailable'));
      return;
    }
    let list: FileEntry[];
    try {
      list = await listDir(dir);
    } catch {
      notify(t('tree.pasteFailed'));
      return;
    }
    const name = clip.path.split('/').pop() ?? clip.path;
    const existing = new Set(list.map((e) => e.name));
    let targetName = name;
    if (!isCut) targetName = uniqueCopyName(name, existing);
    else if (existing.has(name)) { notify(t('tree.pasteExists')); return; }
    if (dir === clip.path || dir.startsWith(clip.path + '/')) { notify(t('tree.moveIntoSelf')); return; }
    const to = dir ? `${dir}/${targetName}` : targetName;
    const ok = isCut ? await onRename?.(clip.path, to) : await onCopy?.(clip.path, to);
    if (ok === false) { notify(t('tree.pasteFailed')); return; }
    if (isCut) setClip(null);
    if (dir) { setOpen((o) => ({ ...o, [dir]: true })); await reloadDir(dir); }
    const oldParent = parentOf(clip.path);
    if (isCut && oldParent) await reloadDir(oldParent);
    setMenu(null);
  };

  const moveInto = async (dir: string) => {
    const src = dragPathRef.current;
    setDragPath(null);
    setDropPath(null);
    if (!src || !canRename || !onRename) return;
    if (dir === src || dir.startsWith(src + '/')) { notify(t('tree.moveIntoSelf')); return; }
    if (dir === parentOf(src)) return;
    let list: FileEntry[];
    try {
      list = await listDir(dir);
    } catch {
      notify(t('tree.moveFailed'));
      return;
    }
    const name = src.split('/').pop() ?? src;
    if (list.some((e) => e.name === name)) { notify(t('tree.pasteExists')); return; }
    const to = dir ? `${dir}/${name}` : name;
    const ok = await onRename(src, to);
    if (ok === false) { notify(t('tree.moveFailed')); return; }
    if (dir) { setOpen((o) => ({ ...o, [dir]: true })); await reloadDir(dir); }
    const oldParent = parentOf(src);
    if (oldParent) await reloadDir(oldParent);
  };

  const commitCreate = async (name: string) => {
    if (!editing || editing.kind !== 'create') return;
    const { parent, isDir } = editing;
    setEditing(null);
    const ok = await onCreate?.(parent, name, isDir);
    if (ok !== false && parent) await reloadDir(parent);
  };

  const commitRename = async (entry: FileEntry, name: string) => {
    setEditing(null);
    if (name === entry.name) return;
    const parent = parentOf(entry.path);
    const to = parent ? `${parent}/${name}` : name;
    const ok = await onRename?.(entry.path, to);
    if (ok === false) return;
    setChildren((c) => {
      const next = { ...c };
      if (next[parent]) next[parent] = next[parent].map((e) => e.path === entry.path ? { ...e, name, path: to } : e);
      if (entry.dir && next[entry.path]) { next[to] = next[entry.path]; delete next[entry.path]; }
      return next;
    });
    if (entry.dir) setOpen((o) => {
      const n = { ...o };
      if (n[entry.path]) { n[to] = n[entry.path]; delete n[entry.path]; }
      return n;
    });
  };

  const openMenu = (e: React.MouseEvent, entry: FileEntry | null) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 210),
      y: Math.min(e.clientY, window.innerHeight - 280),
      entry,
    });
  };

  // Flattened visible rows for roving-tabindex keyboard navigation.
  const navNodes = useMemo(() => {
    const out: { path: string; entry: FileEntry | null; depth: number }[] = [
      { path: '__root__', entry: null, depth: -1 },
    ];
    const walk = (list: FileEntry[], depth: number) => {
      for (const f of list) {
        out.push({ path: f.path, entry: f, depth });
        if (f.dir && open[f.path]) walk(children[f.path] ?? [], depth + 1);
      }
    };
    if (open.__root__ !== false) walk(shown, 0);
    return out;
  }, [shown, open, children]);

  const onTreeKey = (e: React.KeyboardEvent) => {
    if (editing) return;
    const idx = navNodes.findIndex((n) => n.path === focusPath);
    const cur = navNodes[idx] ?? navNodes[0];
    const move = (p: string) => { setFocusPath(p); focusEl(p); };
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (e.key === 'c' || e.key === 'x' || e.key === 'v')) {
      if (e.key === 'v') {
        e.preventDefault();
        void pasteInto(targetDirFor(cur.entry));
        return;
      }
      if (!cur.entry) return;
      if (e.key === 'c' && canCopy) {
        e.preventDefault();
        setClip({ mode: 'copy', path: cur.path });
        notify(t('tree.copied'));
        return;
      }
      if (e.key === 'x' && canRename) {
        e.preventDefault();
        setClip({ mode: 'cut', path: cur.path });
        notify(t('tree.cutDone'));
        return;
      }
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); if (idx < navNodes.length - 1) move(navNodes[idx + 1].path); break;
      case 'ArrowUp': e.preventDefault(); if (idx > 0) move(navNodes[idx - 1].path); break;
      case 'Home': e.preventDefault(); move(navNodes[0].path); break;
      case 'End': e.preventDefault(); move(navNodes[navNodes.length - 1].path); break;
      case 'ArrowRight':
        e.preventDefault();
        if (cur.entry?.dir) {
          if (!open[cur.path]) void toggle(cur.entry);
          else if (idx < navNodes.length - 1 && navNodes[idx + 1].depth > cur.depth) move(navNodes[idx + 1].path);
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (cur.entry?.dir && open[cur.path]) setOpen((o) => ({ ...o, [cur.path]: false }));
        else move(cur.entry ? (parentOf(cur.path) || '__root__') : '__root__');
        break;
      case 'Enter':
        e.preventDefault();
        if (cur.entry) { if (cur.entry.dir) void toggle(cur.entry); else onOpen(cur.path); }
        break;
      case 'F2':
        e.preventDefault();
        if (cur.entry && canRename && onRename) startRename(cur.entry);
        break;
      case 'Delete':
        e.preventDefault();
        if (cur.entry && onDelete) void askDelete(cur.path);
        break;
    }
  };

  const renderNode = (f: FileEntry, depth: number): ReactNode => {
    const isRenaming = editing?.kind === 'rename' && editing.entry.path === f.path;
    const showDel = onDelete && !isRenaming && (!f.dir || pendingDel === f.path);
    return (
      <div key={f.path}>
        <div
          className={`tree-row ${f.name.startsWith('.') ? 'is-hidden' : ''} ${dropPath === f.path ? 'is-drop' : ''} ${clip?.mode === 'cut' && clip.path === f.path ? 'is-cut' : ''}`}
          draggable={canRename && !isRenaming}
          onDragStart={(e) => {
            dragPathRef.current = f.path;
            setDragPath(f.path);
            e.dataTransfer.setData('text/plain', f.path);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragEnd={() => { setDragPath(null); setDropPath(null); }}
          onDragOver={f.dir ? (e) => {
            const src = dragPathRef.current;
            if (!src || !canRename) return;
            if (src === f.path || f.path.startsWith(src + '/')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDropPath(f.path);
          } : undefined}
          onDragLeave={() => { if (dropPath === f.path) setDropPath(null); }}
          onDrop={f.dir ? (e) => { e.preventDefault(); void moveInto(f.path); } : undefined}
          onContextMenu={(e) => openMenu(e, f)}
        >
          {isRenaming ? (
            <TreeNameInput
              initial={f.name}
              onCommit={(name) => void commitRename(f, name)}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <button
              className={`tree-item ${f.dir ? 'is-dir' : ''} ${activePath === f.path ? 'is-active' : ''}`}
              data-tree-path={f.path}
              role="treeitem"
              tabIndex={focusPath === f.path ? 0 : -1}
              title={f.path}
              aria-expanded={f.dir ? !!open[f.path] : undefined}
              aria-selected={activePath === f.path}
              onClick={() => { setFocusPath(f.path); if (f.dir) void toggle(f); else onOpen(f.path); }}
              onFocus={() => setFocusPath(f.path)}
            >
              <span className="tree-caret-slot">
                {f.dir && canExpand && (
                  <ChevronRight size={12} className={`tree-caret ${open[f.path] ? 'rot' : ''}`} />
                )}
              </span>
              {treeIcon(f, !!open[f.path])}
              <span>{f.name}</span>
              {f.dir && !canExpand && (
                <span className="tree-depth" title={t('terminal.oneLevelTitle')}>{t('terminal.oneLevelOnly')}</span>
              )}
            </button>
          )}
          {showDel && (
            pendingDel === f.path ? (
              <button
                type="button"
                className="tree-del is-confirm"
                title={t('tree.confirmDelete')}
                onClick={() => void askDelete(f.path)}
              >
                {t('tree.confirmDelete')}
              </button>
            ) : (
              <button
                type="button"
                className="tree-del"
                title={t('common.delete')}
                aria-label={t('common.delete')}
                onClick={() => void askDelete(f.path)}
              >
                <SemanticIcon name="trash" size={13} />
              </button>
            )
          )}
        </div>
        {f.dir && open[f.path] && (
          <div className="tree-children" role="group">
            {editing?.kind === 'create' && editing.parent === f.path && (
              <TreeNameInput
                initial=""
                onCommit={(name) => void commitCreate(name)}
                onCancel={() => setEditing(null)}
              />
            )}
            {loading[f.path] && <div className="tree-loading" role="status">{t('tree.loading')}</div>}
            {errors[f.path] && (
              <div className="tree-error" role="alert">
                <span>{t('tree.loadError')}</span>
                <button type="button" onClick={() => void reloadDir(f.path)}>{t('common.retry')}</button>
              </div>
            )}
            {(children[f.path] ?? []).map((c) => renderNode(c, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const menuParent = menu ? (menu.entry ? (menu.entry.dir ? menu.entry.path : parentOf(menu.entry.path)) : '') : '';

  return (
    <section className="pane filetree" aria-label={t('editor.explorer')} ref={sectionRef}>
      <div className="pane-head" role="status">
        <span className="eyebrow">{t('editor.explorer')}</span>
        {needle && <span className="match-count">{t('editor.matches', { n: shown.length })}</span>}
        <button type="button" className="icon-btn" title={t('common.newFile')} aria-label={t('common.newFile')} onClick={() => startCreate('', false)}>
          <Plus size={14} />
        </button>
        <button type="button" className="icon-btn" title={t('common.newFolder')} aria-label={t('common.newFolder')} onClick={() => startCreate('', true)} disabled={!canMkdir}>
          <SemanticIcon name="folder" size={14} />
        </button>
        <button type="button" className="icon-btn" title={t('common.openFolder')} aria-label={t('common.openFolder')} onClick={onOpenFolder}>
          <SemanticIcon name="folder" size={14} />
        </button>
        <button type="button" className="icon-btn" title={t('common.refresh')} aria-label={t('common.refresh')} onClick={onRefresh}>
          <SemanticIcon name="refresh" size={14} />
        </button>
        <button type="button" className="icon-btn" title={t('tree.collapseAll')} aria-label={t('tree.collapseAll')} onClick={() => setOpen({ __root__: true })}>
          <ChevronsDownUp size={14} />
        </button>
        {onRunTests && (
          <button type="button" className="icon-btn" title={t('tree.runTests')} aria-label={t('tree.runTests')} onClick={runTests}>
            <SemanticIcon name="flask" size={14} className={testing ? 'is-testing' : ''} />
          </button>
        )}
        <button type="button" className="icon-btn" title={t('pathDialog.alsoPaste')} aria-label={t('pathDialog.alsoPaste')} onClick={onPastePath}>
          <MoreHorizontal size={14} />
        </button>
      </div>
      {openEditors && openEditors.length > 0 && (
        <div className="open-editors">
          <button
            type="button"
            className="open-editors-head"
            aria-expanded={openEditorsOpen}
            onClick={() => setOpenEditorsOpen((v) => !v)}
          >
            {openEditorsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <span>{t('editor.openEditors')}</span>
            <span className="open-editors-count">{openEditors.length}</span>
          </button>
          {openEditorsOpen && (
            <div className="open-editors-list" role="list">
              {openEditors.map((f) => (
                <div key={f.path} className={`open-editor-row ${f.path === activePath ? 'is-active' : ''}`} role="listitem">
                  <button
                    type="button"
                    className="open-editor-main"
                    title={f.path}
                    onClick={() => onActivateEditor?.(f.path)}
                  >
                    {treeIcon({ name: f.path.split(/[\\/]/).pop() ?? f.path, path: f.path, dir: false }, false, 12)}
                    <span>{f.path.split(/[\\/]/).pop()}</span>
                    {f.dirty && <i className="dirty-dot" />}
                  </button>
                  {onCloseEditor && (
                    <button
                      type="button"
                      className="icon-btn open-editor-close"
                      aria-label={`${t('editor.tabClose')} ${f.path}`}
                      onClick={() => onCloseEditor(f.path)}
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <button
        className={`tree-root ${dropPath === '' ? 'is-drop' : ''}`}
        data-tree-path="__root__"
        role="treeitem"
        tabIndex={focusPath === '__root__' ? 0 : -1}
        aria-expanded={open.__root__ !== false}
        onClick={() => setOpen((o) => ({ ...o, __root__: !o.__root__ }))}
        onFocus={() => setFocusPath('__root__')}
        onContextMenu={(e) => openMenu(e, null)}
        onDragOver={(e) => {
          if (!dragPathRef.current || !canRename) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDropPath('');
        }}
        onDragLeave={() => { if (dropPath === '') setDropPath(null); }}
        onDrop={(e) => { e.preventDefault(); void moveInto(''); }}
      >
        {open.__root__ ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span>{shortRoot.toUpperCase()}</span>
      </button>
      {open.__root__ !== false && (
        <div
          className="tree-list"
          role="tree"
          aria-label={t('editor.explorer')}
          onKeyDown={onTreeKey}
          onContextMenu={(e) => { if (e.target === e.currentTarget) openMenu(e, null); }}
          onDragOver={(e) => {
            if (e.target !== e.currentTarget || !dragPathRef.current || !canRename) return;
            e.preventDefault();
            setDropPath('');
          }}
          onDragLeave={(e) => { if (e.target === e.currentTarget && dropPath === '') setDropPath(null); }}
          onDrop={(e) => { if (e.target !== e.currentTarget) return; e.preventDefault(); void moveInto(''); }}
        >
          {notice && <div className="tree-notice" role="status">{notice}</div>}
          {editing?.kind === 'create' && editing.parent === '' && (
            <TreeNameInput
              initial=""
              onCommit={(name) => void commitCreate(name)}
              onCancel={() => setEditing(null)}
            />
          )}
          {shown.length === 0 && !editing ? (
            <EmptyState
              variant={needle ? 'noresult' : 'zero'}
              title={needle ? t('editor.treeNoMatch') : t('editor.treeNoFiles')}
              desc={needle ? t('editor.treeNoMatchDesc') : t('editor.treeNoFilesDesc')}
              query={needle || undefined}
              icon={<EMPTY_ICONS.folder size={18} />}
              compact
              actions={[
                { label: t('common.openFolder'), onClick: onOpenFolder, primary: true },
                ...(needle ? [] : [{ label: t('common.newFile'), onClick: () => startCreate('', false), primary: false }]),
              ]}
            />
          ) : shown.map((f) => renderNode(f, 0))}
        </div>
      )}
      {menu && (
        <div
          className="tab-context-menu tree-context-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          aria-label={t('editor.explorer')}
          {...layerProps('tree-menu')}
        >
          <button type="button" role="menuitem" disabled={!onCreate} onClick={() => startCreate(menuParent, false)}>{t('common.newFile')}</button>
          <button type="button" role="menuitem" disabled={!canMkdir || !onCreate} onClick={() => startCreate(menuParent, true)}>{t('common.newFolder')}</button>
          <button type="button" role="menuitem" disabled={!menu.entry || !canRename || !onRename} onClick={() => menu.entry && startRename(menu.entry)}>{t('common.rename')}</button>
          <button type="button" role="menuitem" disabled={!menu.entry || !canCopy} onClick={() => { if (menu.entry) { setClip({ mode: 'copy', path: menu.entry.path }); notify(t('tree.copied')); } setMenu(null); }}>{t('tree.copy')}</button>
          <button type="button" role="menuitem" disabled={!menu.entry || !canRename} onClick={() => { if (menu.entry) { setClip({ mode: 'cut', path: menu.entry.path }); notify(t('tree.cutDone')); } setMenu(null); }}>{t('tree.cut')}</button>
          <button type="button" role="menuitem" disabled={!clip || (clip.mode === 'cut' ? !canRename : !canCopy)} onClick={() => void pasteInto(menuParent)}>{t('tree.paste')}</button>
          <button type="button" role="menuitem" disabled={!menu.entry || !onDelete} onClick={() => { if (menu.entry) { void askDelete(menu.entry.path); setMenu(null); } }}>{t('common.delete')}</button>
          <button type="button" role="menuitem" disabled={!menu.entry} onClick={() => { if (menu.entry) void writeClipboard(menu.entry.path); setMenu(null); }}>{t('common.copyPath')}</button>
          <button type="button" role="menuitem" disabled={!menu.entry} onClick={() => { if (menu.entry) window.dispatchEvent(new CustomEvent('pristem:reveal', { detail: menu.entry.path })); setMenu(null); }}>{t('tree.reveal')}</button>
          <button type="button" role="menuitem" onClick={() => { onRefresh(); if (menu.entry?.dir) void reloadDir(menu.entry.path); setMenu(null); }}>{t('common.refresh')}</button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Monaco editor.
// ---------------------------------------------------------------------------

export interface OpenFile {
  path: string;
  content: string;
  dirty: boolean;
  readOnly?: boolean;
}

interface DocStatusInfo {
  cursor?: { line: number; col: number };
  language?: string;
  eol?: string;
  indent?: number;
}

export function EditorPane({
  openFiles, activePath, onContentChange, onSave, onClose, onActivate,
  onAtSummon, summonEnabled, overlay, onNewFile, onOpenFolder,
  outline, onProblems,
  isActive = true, canSplit = false, isSplit = false,
  onSplitRight, onSplitDown, onCloseGroup, onReveal, onOpenToSide,
  onCloseToRight, onCloseOthers, onReorder,
}: {
  openFiles: OpenFile[];
  activePath: string | null;
  onContentChange: (path: string, content: string) => void;
  onSave: (path: string, content: string) => void;
  onClose: (path: string) => void;
  onActivate: (path: string) => void;
  onAtSummon: (pos: { x: number; y: number }) => void;
  summonEnabled: boolean;
  overlay?: ReactNode;
  onNewFile?: () => void;
  onOpenFolder?: () => void;
  outline: OutlineSymbol[];
  onProblems?: (p: Problem[]) => void;
  isActive?: boolean;
  canSplit?: boolean;
  isSplit?: boolean;
  onSplitRight?: () => void;
  onSplitDown?: () => void;
  onCloseGroup?: () => void;
  onReveal?: (path: string) => void;
  onOpenToSide?: (path: string) => void;
  onCloseToRight?: (path: string) => void;
  onCloseOthers?: (path: string) => void;
  onReorder?: (from: string, to: string) => void;
}) {
  useI18n();
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const acquired = useRef<Set<string>>(new Set());
  const viewStates = useRef(new Map<string, monaco.editor.IEditorViewState | null>());
  const prevPath = useRef<string | null>(null);
  const filesRef = useRef(openFiles);
  filesRef.current = openFiles;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const pathsKey = openFiles.map((f) => f.path).join('\n');
  const pendingAt = useRef<{ line: number; column: number; timer: number } | null>(null);
  const removing = useRef(false);
  const suppress = useRef(false);
  const callbacks = useRef({ onContentChange, onSave, onAtSummon, summonEnabled });
  callbacks.current = { onContentChange, onSave, onAtSummon, summonEnabled };

  // Borrow shared models for every open tab; release the ones that closed.
  useEffect(() => {
    const want = new Set(filesRef.current.map((f) => f.path));
    for (const p of Array.from(acquired.current)) {
      if (!want.has(p)) { releaseModel(p); acquired.current.delete(p); }
    }
    for (const f of filesRef.current) {
      if (!acquired.current.has(f.path)) { acquireModel(f.path, f.content); acquired.current.add(f.path); }
    }
  }, [pathsKey]);
  useEffect(() => () => {
    for (const p of acquired.current) releaseModel(p);
    acquired.current.clear();
  }, []);

  const [status, setStatus] = useState<DocStatusInfo>({});
  useEffect(() => {
    if (!isActive) return;
    window.dispatchEvent(new CustomEvent('pristem:doc-status', { detail: status }));
  }, [status, isActive]);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState('');
  const [jumpError, setJumpError] = useState<string | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const jumpInput = useRef<HTMLInputElement>(null);

  const cancelPending = () => {
    if (pendingAt.current) window.clearTimeout(pendingAt.current.timer);
    pendingAt.current = null;
  };

  const deletePendingAt = () => {
    if (!pendingAt.current || !editor.current) return;
    const { line, column } = pendingAt.current;
    const model = editor.current.getModel();
    if (!model) return;
    removing.current = true;
    model.applyEdits([
      { range: new monaco.Range(line, column, line, column + 1), text: '' },
    ]);
    removing.current = false;
    cancelPending();
  };

  const summon = () => {
    if (!pendingAt.current || !editor.current || !host.current) return;
    const { line, column } = pendingAt.current;
    const pos = editor.current.getScrolledVisiblePosition({ lineNumber: line, column });
    const box = host.current.getBoundingClientRect();
    deletePendingAt();
    onAtSummonRef.current({
      x: box.left + (pos?.left ?? 40),
      y: box.top + (pos?.top ?? 40) + (pos?.height ?? 20) + 6,
    });
  };

  const onAtSummonRef = useRef(onAtSummon);
  onAtSummonRef.current = onAtSummon;
  const onProblemsRef = useRef(onProblems);
  onProblemsRef.current = onProblems;
  const dragTab = useRef<string | null>(null);

  /**
   * Saving goes through Monaco's formatter when "format on save" is on. The
   * action applies edits to the model, so the saved text is read after it settles.
   */
  const saveCurrent = () => {
    const ed = editor.current;
    const model = ed?.getModel();
    if (!ed || !model) return;
    const path = model.uri.path.replace(/^\//, '');
    const write = () => callbacks.current.onSave(path, model.getValue());
    const action = ed.getAction('editor.action.formatDocument');
    if (readSettings().formatOnSave && action?.isSupported()) {
      void action.run().then(write, write);
      return;
    }
    write();
  };

  useEffect(() => {
    if (!host.current) return;
    const settings = readSettings();
    const ed = monaco.editor.create(host.current, {
      theme: 'pristem-dark',
      automaticLayout: true,
      fontFamily: 'IBM Plex Mono, Cascadia Code, Consolas, monospace',
      fontSize: settings.editorFontSize,
      tabSize: settings.tabSize,
      lineHeight: 22,
      minimap: { enabled: settings.editorMinimap, scale: 1, renderCharacters: false, maxColumn: 80 },
      wordWrap: settings.editorWordWrap ? 'on' : 'off',
      scrollBeyondLastLine: false,
      padding: { top: 20, bottom: 24 },
      renderLineHighlight: 'line',
      lineNumbersMinChars: 3,
      glyphMargin: false,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      overviewRulerLanes: 0,
      bracketPairColorization: { enabled: false },
      matchBrackets: 'always',
      guides: { indentation: true, bracketPairs: false },
      folding: true,
      showFoldingControls: 'always',
      stickyScroll: { enabled: true },
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
    });
    editor.current = ed;

    const cursorSub = ed.onDidChangeCursorPosition((e) => {
      const model = ed.getModel();
      setStatus({
        cursor: { line: e.position.lineNumber, col: e.position.column },
        language: model?.getLanguageId(),
        eol: model?.getEOL() === '\r\n' ? 'CRLF' : 'LF',
        indent: model?.getOptions().tabSize,
      });
    });

    const sub = ed.onDidChangeModelContent((e) => {
      if (removing.current || suppress.current || isModelSilent()) return;
      const model = ed.getModel();
      if (!model) return;
      const path = model.uri.path.replace(/^\//, '');
      callbacks.current.onContentChange(path, model.getValue());

      if (!callbacks.current.summonEnabled) return;
      for (const change of e.changes) {
        const { text, range } = change;
        if (text === '@' && range.startColumn >= 1) {
          const before =
            range.startColumn <= 1
              ? ''
              : model.getValueInRange(
                  new monaco.Range(
                    range.startLineNumber,
                    range.startColumn - 1,
                    range.startLineNumber,
                    range.startColumn,
                  ),
                );
          const atWordStart = before === '' || /\s/.test(before);
          if (!atWordStart) continue;
          cancelPending();
          const timer = window.setTimeout(() => {
            if (pendingAt.current) summonRef.current();
          }, 440);
          pendingAt.current = { line: range.startLineNumber, column: range.startColumn, timer };
        } else if (pendingAt.current) {
          if (/^[A-Za-z0-9_@./-]/.test(text)) {
            cancelPending(); // @Mod, @SubscribeEvent — plain text, never a shortcut
          } else if (text.length > 0) {
            summonRef.current();
          }
        }
      }
    });

    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveCurrent());
    // Monaco-scoped commands forward to the global handlers — no second
    // implementation of "quick open" or "go to line" (UX §7.1).
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => {
      window.dispatchEvent(new Event('pristem:quick-open'));
    });
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG, () => {
      window.dispatchEvent(new Event('pristem:jump-line-open'));
    });
    // Formatting and import organisation stay Monaco actions — the menu and the
    // palette only forward the request.
    ed.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => {
      ed.getAction('editor.action.formatDocument')?.run();
    });
    ed.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyO, () => {
      ed.getAction('editor.action.organizeImports')?.run();
    });
    // F2 is the app's mode switch, so rename uses the JetBrains key instead.
    ed.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F6, () => {
      ed.getAction('editor.action.rename')?.run();
    });

    // Monaco diagnostics → the "problems" tab (UX §4.2).
    let problemTimer: number | null = null;
    const markersSub = monaco.editor.onDidChangeMarkers(() => {
      if (problemTimer !== null) window.clearTimeout(problemTimer);
      problemTimer = window.setTimeout(() => {
        problemTimer = null;
        const all = monaco.editor.getModelMarkers({});
        const rows: Problem[] = all.map((m) => ({
          severity: m.severity === monaco.MarkerSeverity.Error ? 'error'
            : m.severity === monaco.MarkerSeverity.Warning ? 'warning' : 'info',
          message: m.message,
          path: m.resource?.path?.replace(/^\//, '') ?? '',
          line: m.startLineNumber,
          column: m.startColumn,
        }));
        onProblemsRef.current?.(rows);
      }, 200);
    });

    const onJump = (e: Event) => {
      if (!isActiveRef.current) return;
      const line = (e as CustomEvent<number>).detail;
      if (typeof line !== 'number') return;
      ed.revealLineInCenter(line);
      ed.setPosition({ lineNumber: line, column: 1 });
      ed.focus();
    };
    const onRemoveAt = () => { if (isActiveRef.current) deletePendingAtRef.current(); };
    const onSaveReq = () => {
      if (!isActiveRef.current) return;
      saveCurrent();
    };
    const pushDocStatus = () => {
      const model = ed.getModel();
      if (!model) return;
      const pos = ed.getPosition();
      setStatus({
        cursor: { line: pos?.lineNumber ?? 1, col: pos?.column ?? 1 },
        language: model.getLanguageId(),
        eol: model.getEOL() === '\r\n' ? 'CRLF' : 'LF',
        indent: model.getOptions().tabSize,
      });
    };
    const onSetLanguage = (e: Event) => {
      if (!isActiveRef.current) return;
      const model = ed.getModel();
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (!model || !id) return;
      monaco.editor.setModelLanguage(model, id);
      pushDocStatus();
    };
    const onSetIndent = (e: Event) => {
      if (!isActiveRef.current) return;
      const model = ed.getModel();
      const size = (e as CustomEvent<{ size: number }>).detail?.size;
      if (!model || !size) return;
      model.updateOptions({ tabSize: size });
      ed.updateOptions({ tabSize: size });
      pushDocStatus();
    };
    const onSetEol = (e: Event) => {
      if (!isActiveRef.current) return;
      const model = ed.getModel();
      const eol = (e as CustomEvent<{ eol: string }>).detail?.eol;
      if (!model || !eol) return;
      model.setEOL(eol === 'CRLF' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF);
      pushDocStatus();
    };
    // Menu/palette commands drive Monaco's own actions — never reimplemented.
    const onEditorAction = (e: Event) => {
      if (!isActiveRef.current) return;
      const action = (e as CustomEvent<{ action?: string }>).detail?.action;
      if (action === 'undo' || action === 'redo') ed.trigger('pristem-menu', action, null);
      else if (action === 'find') ed.getAction('actions.find')?.run();
      else if (action === 'replace') ed.getAction('editor.action.startFindReplaceAction')?.run();
      else if (action === 'format') ed.getAction('editor.action.formatDocument')?.run();
      else if (action === 'organizeImports') ed.getAction('editor.action.organizeImports')?.run();
      else if (action === 'definition') ed.getAction('editor.action.revealDefinition')?.run();
      else if (action === 'references') ed.getAction('editor.action.findReferences')?.run();
      else if (action === 'peekDefinition') ed.getAction('editor.action.peekDefinition')?.run();
      else if (action === 'rename') ed.getAction('editor.action.rename')?.run();
      else if (action === 'selectAllOccurrences') ed.getAction('editor.action.selectHighlights')?.run();
      else if (action === 'foldAll') ed.getAction('editor.foldAll')?.run();
      else if (action === 'unfoldAll') ed.getAction('editor.unfoldAll')?.run();
    };
    const onFocusEditor = () => { if (isActiveRef.current) ed.focus(); };
    window.addEventListener('pristem:editor-action', onEditorAction);
    window.addEventListener('pristem:editor-focus', onFocusEditor);
    window.addEventListener('pristem:jump-line', onJump);
    window.addEventListener('pristem:remove-at', onRemoveAt);
    window.addEventListener('pristem:save-request', onSaveReq);
    window.addEventListener('pristem:editor-set-language', onSetLanguage);
    window.addEventListener('pristem:editor-set-indent', onSetIndent);
    window.addEventListener('pristem:editor-set-eol', onSetEol);
    const ro = new ResizeObserver(() => ed.layout());
    ro.observe(host.current);

    return () => {
      window.removeEventListener('pristem:jump-line', onJump);
      window.removeEventListener('pristem:editor-action', onEditorAction);
      window.removeEventListener('pristem:editor-focus', onFocusEditor);
      window.removeEventListener('pristem:remove-at', onRemoveAt);
      window.removeEventListener('pristem:save-request', onSaveReq);
      window.removeEventListener('pristem:editor-set-language', onSetLanguage);
      window.removeEventListener('pristem:editor-set-indent', onSetIndent);
      window.removeEventListener('pristem:editor-set-eol', onSetEol);
      ro.disconnect();
      sub.dispose();
      cursorSub.dispose();
      markersSub.dispose();
      if (problemTimer !== null) window.clearTimeout(problemTimer);
      const last = ed.getModel();
      if (last && prevPath.current) viewStates.current.set(prevPath.current, ed.saveViewState());
      ed.dispose();
      editor.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summonRef = useRef(summon);
  summonRef.current = summon;
  const deletePendingAtRef = useRef(deletePendingAt);
  deletePendingAtRef.current = deletePendingAt;

  // Editor preferences from the settings page.
  useEffect(() => subscribeSettings(() => {
    const s = readSettings();
    const ed = editor.current;
    if (!ed) return;
    ed.updateOptions({
      fontSize: s.editorFontSize,
      tabSize: s.tabSize,
      minimap: { enabled: s.editorMinimap },
      wordWrap: s.editorWordWrap ? 'on' : 'off',
    });
  }), []);

  useEffect(() => {
    const ed = editor.current;
    if (!ed) return;
    if (!activePath) {
      if (ed.getModel()) {
        if (prevPath.current) viewStates.current.set(prevPath.current, ed.saveViewState());
        suppress.current = true;
        ed.setModel(null);
        suppress.current = false;
        prevPath.current = null;
      }
      return;
    }
    const model = peekModel(activePath);
    if (!model) return;
    if (ed.getModel() !== model) {
      if (prevPath.current) viewStates.current.set(prevPath.current, ed.saveViewState());
      suppress.current = true;
      ed.setModel(model);
      suppress.current = false;
      const vs = viewStates.current.get(activePath);
      if (vs) ed.restoreViewState(vs as monaco.editor.ICodeEditorViewState);
      prevPath.current = activePath;
    }
    const file = filesRef.current.find((f) => f.path === activePath);
    ed.updateOptions({ readOnly: !!file?.readOnly });
    // The document status strip always has a first reading (DESIGN §9.5 F10).
    const pos = ed.getPosition();
    setStatus({
      cursor: { line: pos?.lineNumber ?? 1, col: pos?.column ?? 1 },
      language: model.getLanguageId(),
      eol: model.getEOL() === '\r\n' ? 'CRLF' : 'LF',
      indent: model.getOptions().tabSize,
    });
  }, [activePath, pathsKey]);

  const segments = (activePath ?? '').split(/[\\/]/).filter(Boolean);
  const [tabMenu, setTabMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!tabMenu) return;
    const close = () => setTabMenu(null);
    document.addEventListener('pointerdown', close, { once: true });
    return () => document.removeEventListener('pointerdown', close);
  }, [tabMenu]);

  useEffect(() => {
    const openJump = () => {
      setJumpValue('');
      setJumpError(null);
      setJumpOpen(true);
      window.requestAnimationFrame(() => jumpInput.current?.focus());
    };
    window.addEventListener('pristem:jump-line-open', openJump);
    return () => window.removeEventListener('pristem:jump-line-open', openJump);
  }, []);

  const jump = () => {
    const n = Number(jumpValue.trim());
    if (!jumpValue.trim() || !Number.isFinite(n) || n < 1) {
      setJumpError(t('jumpLine.invalid'));
      return;
    }
    const model = editor.current?.getModel();
    const lines = model?.getLineCount() ?? 0;
    if (lines && n > lines) {
      setJumpError(t('jumpLine.outOfRange'));
      return;
    }
    const ed = editor.current;
    if (ed) {
      ed.revealLineInCenter(n);
      ed.setPosition({ lineNumber: n, column: 1 });
      ed.focus();
    }
    setJumpOpen(false);
  };

  const jumpRect = useMemo(() => {
    const el = host.current;
    if (!el) return { left: 24, top: 200 };
    const r = el.getBoundingClientRect();
    return { left: r.left + 12, top: Math.max(80, r.bottom - 220) };
  }, [jumpOpen]);

  const tabsRef = useRef<HTMLDivElement>(null);
  const [tabsMenu, setTabsMenu] = useState(false);
  const [tabsOverflow, setTabsOverflow] = useState(false);
  useDismissable('tab-overflow', tabsMenu, () => setTabsMenu(false));
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const measure = () => setTabsOverflow(el.scrollWidth > el.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pathsKey]);
  useEffect(() => {
    const el = tabsRef.current?.querySelector<HTMLElement>('.editor-tab.is-active');
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activePath, pathsKey]);

  const activeFile = openFiles.find((f) => f.path === activePath);

  return (
    <section className="pane editor-pane">
      <div className={`editor-tabs ${tabsOverflow ? 'has-overflow' : ''}`} ref={tabsRef}>
        {openFiles.map((f) => (
          <button
            key={f.path}
            className={`editor-tab ${f.path === activePath ? 'is-active' : ''}`}
            draggable
            onDragStart={(e) => {
              dragTab.current = f.path;
              e.dataTransfer.setData('text/plain', f.path);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              if (!dragTab.current || dragTab.current === f.path) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(e) => {
              e.preventDefault();
              const from = dragTab.current;
              dragTab.current = null;
              if (from && from !== f.path) onReorder?.(from, f.path);
            }}
            onDragEnd={() => { dragTab.current = null; }}
            onClick={() => onActivate(f.path)}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onClose(f.path); } }}
            onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
            onContextMenu={(e) => { e.preventDefault(); setTabMenu({ path: f.path, x: e.clientX, y: e.clientY }); }}
          >
            {treeIcon({ name: f.path.split(/[\\/]/).pop() ?? f.path, path: f.path, dir: false }, false, 12)}
            <span>{f.path.split(/[\\/]/).pop()}</span>
            {f.dirty && <i className="dirty-dot" />}
            <span
              className="tab-close"
              role="button"
              tabIndex={0}
              aria-label={`${t('editor.tabClose')} ${f.path}`}
              onClick={(e) => { e.stopPropagation(); onClose(f.path); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onClose(f.path); }
              }}
            ><X size={11} /></span>
          </button>
        ))}
      </div>
      {tabsOverflow && (
        <>
          <button
            type="button"
            className="tabs-overflow-btn"
            data-pop-trigger="tab-overflow"
            aria-haspopup="menu"
            aria-expanded={tabsMenu}
            aria-label={t('editor.allTabs')}
            title={t('editor.allTabs')}
            onClick={() => setTabsMenu((v) => !v)}
          >
            <ChevronDown size={13} />
          </button>
          {tabsMenu && (
            <div className="tab-overflow-pop" data-pop="tab-overflow" role="menu" aria-label={t('editor.allTabs')}>
              {openFiles.map((f) => (
                <button
                  type="button"
                  role="menuitem"
                  key={f.path}
                  className={`tab-overflow-item ${f.path === activePath ? 'is-active' : ''}`}
                  onClick={() => {
                    onActivate(f.path);
                    setTabsMenu(false);
                    window.setTimeout(() => window.dispatchEvent(new Event('pristem:editor-focus')), 0);
                  }}
                >
                  {treeIcon({ name: f.path.split(/[\\/]/).pop() ?? f.path, path: f.path, dir: false }, false, 12)}
                  <span>{f.path.split(/[\\/]/).pop()}</span>
                  {f.dirty && <i className="dirty-dot" />}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <div className="doc-strip">
        {segments.map((s, i) => {
          const acc = segments.slice(0, i + 1).join('/');
          const target = i === segments.length - 1 ? (activePath ?? acc) : acc;
          return (
            <span key={`${s}:${i}`} className="breadcrumb-segment">
              {i > 0 && <ChevronRight size={11} />}
              <button type="button" onClick={() => onReveal?.(target)}>{s}</button>
            </span>
          );
        })}
        <button
          type="button"
          data-pop-trigger="outline-pop"
          aria-label={t('outline.button')}
          title={t('outline.title')}
          onClick={() => setOutlineOpen((v) => !v)}
        >
          <ListTree size={13} /> {t('outline.button')}
        </button>
        <span style={{ flex: 1 }} />
        {status.cursor && <span>{t('editor.cursorLn', { line: status.cursor.line, col: status.cursor.col })}</span>}
        {status.language && <span>{status.language}</span>}
        {status.eol && <span>{status.eol}</span>}
        {status.indent != null && <span>{t('editor.indent', { n: status.indent })}</span>}
      </div>

      <div className="monaco-host" ref={host} />
      {activeFile?.readOnly && (
        <div className="editor-readonly-note" role="status">{t('editor.readOnlyNotice')}</div>
      )}
      {!activePath && !overlay && (
        <div className="editor-empty">
          <EmptyState
            variant="first"
            title={t('editor.emptyTitle')}
            desc={t('editor.emptyDesc')}
            icon={<EMPTY_ICONS.file size={18} />}
            actions={[
              { label: t('common.openFolder'), onClick: () => onOpenFolder?.(), primary: true },
              { label: t('common.newFile'), onClick: () => onNewFile?.() },
            ]}
          />
          <div className="kbd-row">
            <div className="kbd-line"><span>{t('editor.chatHint')}</span><span className="kbd">⇧ @ + F1</span></div>
            <div className="kbd-line"><span>{t('editor.openHint')}</span><span className="kbd">Ctrl + P</span></div>
          </div>
        </div>
      )}
      {overlay}

      {outlineOpen && (
        <div
          className="outline-pop"
          data-pop="outline-pop"
          role="menu"
          aria-label={t('outline.title')}
          style={{ left: 16, top: 62 }}
          onKeyDown={(e) => { if (e.key === 'Escape') setOutlineOpen(false); }}
        >
          <div className="outline-pop-head">{t('outline.title')}</div>
          {outline.length === 0 ? (
            <span className="outline-pop-head">{t('editor.noSymbols')}</span>
          ) : (
            outline.slice(0, 200).map((s, i) => (
              <button
                type="button"
                key={`${s.name}:${i}`}
                className="outline-item"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('pristem:jump-line', { detail: s.line }));
                  setOutlineOpen(false);
                }}
              >
                <span className="outline-name">{s.name}</span><span className="outline-line">{s.line}</span>
              </button>
            ))
          )}
        </div>
      )}

      {jumpOpen && (
        <div className="jump-line-pop" style={jumpRect} data-pop="jump-line-pop" role="dialog" aria-label={t('jumpLine.title')}>
          <span className="jump-line-title">{t('jumpLine.title')}</span>
          <div className="jump-line-row">
            <input
              ref={jumpInput}
              value={jumpValue}
              inputMode="numeric"
              aria-label={t('jumpLine.title')}
              aria-invalid={jumpError ? 'true' : undefined}
              onChange={(e) => { setJumpValue(e.target.value.replace(/[^\d]/g, '')); setJumpError(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); jump(); }
                if (e.key === 'Escape') { e.preventDefault(); setJumpOpen(false); }
              }}
            />
            <button type="button" className="primary-btn small" onClick={jump}>{t('jumpLine.go')}</button>
          </div>
          {jumpError && <p className="jump-line-error">{jumpError}</p>}
        </div>
      )}

      {tabMenu && (
        <div className="tab-context-menu" data-pop="tab-menu" style={{ left: tabMenu.x, top: tabMenu.y }}>
          <button type="button" onClick={() => { onClose(tabMenu.path); setTabMenu(null); }}>{t('editor.tabClose')}</button>
          <button type="button" onClick={() => { onCloseOthers?.(tabMenu.path); setTabMenu(null); }}>{t('editor.tabCloseOthers')}</button>
          <button type="button" onClick={() => { onCloseToRight?.(tabMenu.path); setTabMenu(null); }}>{t('editor.tabCloseRight')}</button>
          <button type="button" onClick={() => { onReveal?.(tabMenu.path); setTabMenu(null); }}>{t('editor.revealInExplorer')}</button>
          {onOpenToSide && (
            <button type="button" onClick={() => { onOpenToSide(tabMenu.path); setTabMenu(null); }}>{t('editor.openToSide')}</button>
          )}
          {canSplit && onSplitRight && (
            <button type="button" onClick={() => { onSplitRight(); setTabMenu(null); }}>{t('editor.splitRight')}</button>
          )}
          {canSplit && onSplitDown && (
            <button type="button" onClick={() => { onSplitDown(); setTabMenu(null); }}>{t('editor.splitDown')}</button>
          )}
          {isSplit && onCloseGroup && (
            <button type="button" onClick={() => { onCloseGroup(); setTabMenu(null); }}>{t('editor.closeGroup')}</button>
          )}
          <button type="button" onClick={() => { void writeClipboard(tabMenu.path); setTabMenu(null); }}>{t('common.copyPath')}</button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Editor area — one or two groups side by side (or stacked) with a draggable
// splitter. Groups share path-keyed models, so a file open in both edits live.
// ---------------------------------------------------------------------------

export interface EditorGroup {
  id: string;
  files: OpenFile[];
  activePath: string | null;
}

export function EditorArea({
  groups, splitDir, activeGroupId, splitRatio, onActivateGroup, onSplitResize, renderPane,
}: {
  groups: EditorGroup[];
  splitDir: 'row' | 'column' | null;
  activeGroupId: string;
  splitRatio: number;
  onActivateGroup: (id: string) => void;
  onSplitResize: (frac: number) => void;
  renderPane: (g: EditorGroup, isActive: boolean) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const two = groups.length > 1 && splitDir !== null;

  const move = (e: ReactPointerEvent) => {
    if (!dragging.current || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const frac = splitDir === 'column'
      ? (e.clientY - r.top) / Math.max(1, r.height)
      : (e.clientX - r.left) / Math.max(1, r.width);
    onSplitResize(Math.min(0.8, Math.max(0.2, frac)));
  };
  const stop = (e: ReactPointerEvent) => {
    dragging.current = false;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  const style = two
    ? (splitDir === 'column'
      ? { gridTemplateRows: `${splitRatio}fr 4px ${1 - splitRatio}fr` }
      : { gridTemplateColumns: `${splitRatio}fr 4px ${1 - splitRatio}fr` })
    : undefined;

  return (
    <div className={`editor-area ${two ? `is-split is-${splitDir}` : ''}`} ref={ref} style={style}>
      {groups.map((g, i) => (
        <Fragment key={g.id}>
          {i > 0 && two && (
            <div
              className="editor-splitter"
              role="separator"
              aria-orientation={splitDir === 'column' ? 'horizontal' : 'vertical'}
              onPointerDown={(e) => { dragging.current = true; (e.currentTarget as Element).setPointerCapture(e.pointerId); }}
              onPointerMove={move}
              onPointerUp={stop}
              onPointerCancel={stop}
            />
          )}
          <div
            className={`editor-group ${g.id === activeGroupId ? 'is-active' : ''}`}
            onPointerDown={() => onActivateGroup(g.id)}
          >
            {renderPane(g, g.id === activeGroupId)}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// xterm.js terminal — real PTY sessions owned by the shell (ConPTY on Windows).
// The UI never emulates a prompt: every keystroke goes straight to the shell.
// ---------------------------------------------------------------------------

export type ActivityTab = 'terminal' | 'output' | 'problems';

/** What the arrow next to "+" can launch. "auto" keeps the saved preference. */
const SHELL_CHOICES: { id: ShellProfileId; key: string }[] = [
  { id: 'auto', key: 'terminal.shell.auto' },
  { id: 'pwsh', key: 'terminal.shell.pwsh' },
  { id: 'powershell', key: 'terminal.shell.powershell' },
  { id: 'cmd', key: 'terminal.shell.cmd' },
];

interface TermState {
  term: Terminal;
  fit: FitAddon;
  opened: boolean;
  exited: boolean;
  unavailable: boolean;
  shell: string;
  /** "pty" for a real pseudoconsole, "pipe" for the degraded fallback. */
  kind: string;
  /** Why the session is degraded; empty for a real PTY. */
  note: string;
}

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function TerminalPane({
  sendIo,
  canMultiInstance,
  ptyAvailable,
  capsKnown,
  problems,
  defaultInstances = 1,
  activityOpen,
  onActivityOpenChange,
  tab,
  onTabChange,
}: {
  sendIo: (r: IoRequest) => Promise<unknown>;
  canMultiInstance: boolean;
  ptyAvailable: boolean;
  capsKnown: boolean;
  problems: Problem[];
  defaultInstances?: number;
  activityOpen: boolean;
  onActivityOpenChange: (v: boolean) => void;
  tab: ActivityTab;
  onTabChange: (v: ActivityTab) => void;
}) {
  useI18n();
  const [ids, setIds] = useState<number[]>([]);
  const [names, setNames] = useState<Record<number, string>>({});
  const [activeId, setActiveId] = useState(0);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const [renaming, setRenaming] = useState<number | null>(null);
  const [scrolledUp, setScrolledUp] = useState<Record<number, boolean>>({});
  const states = useRef(new Map<number, TermState>());
  /** Per-tab shell override chosen from the arrow menu; absent = saved default. */
  const shells = useRef(new Map<number, ShellProfileId>());
  const [shellMenu, setShellMenu] = useState<{ left: number; top: number } | null>(null);
  useDismissable('term-shell-menu', !!shellMenu, () => setShellMenu(null));
  const hosts = useRef(new Map<number, HTMLDivElement>());
  /** Keeps xterm's cols/rows in sync with the host's real size. */
  const resizers = useRef(new Map<number, ResizeObserver>());
  /** Keystrokes typed before `term.open` resolved, per instance. */
  const pending = useRef(new Map<number, string[]>());
  const renamed = useRef(new Set<number>());
  const nextId = useRef(1);
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const openSession = (id: number, state: TermState) => {
    const settings = readSettings();
    try { state.fit.fit(); } catch { /* host not measurable yet */ }
    void sendIo({
      op: 'term.open', instance: id,
      cols: state.term.cols || 80, rows: state.term.rows || 24,
      shell: shells.current.get(id) ?? settings.shellProfile,
    }).then((r) => {
      const res = r as { ok?: boolean; shell?: string; kind?: string; note?: string; error?: string } | undefined;
      if (res?.ok && res.shell) {
        state.opened = true;
        state.shell = res.shell;
        state.kind = res.kind ?? 'pty';
        state.note = res.note ?? '';
        if (!renamed.current.has(id)) setNames((n) => ({ ...n, [id]: res.shell! }));
        try { state.fit.fit(); } catch { /* ignore */ }
        // A degraded session has to say so: the shell reports what it had to
        // give up, and the terminal shows it instead of silently behaving
        // worse than the user expects.
        if (state.kind === 'pipe') {
          state.term.write(`\x1b[38;2;180;112;110m[${t('terminal.pipeMode', { shell: res.shell })}]\x1b[0m\r\n`);
        }
        if (state.note) {
          state.term.write(`\x1b[38;2;140;150;160m[${state.note}]\x1b[0m\r\n`);
        }
        // Keystrokes typed while the shell was starting are not lost.
        const queued = pending.current.get(id);
        pending.current.delete(id);
        for (const d of queued ?? []) void sendIo({ op: 'term.write', instance: id, data: d });
      } else {
        state.exited = true;
        pending.current.delete(id);
        state.term.write(`\x1b[38;2;180;112;110m[${t('terminal.ptyUnavailable')}: ${res?.error ?? 'unknown'}]\x1b[0m\r\n`);
      }
      bump();
    });
  };

  // ── instance creation ───────────────────────────────────────────────────
  useLayoutEffect(() => {
    for (const id of Array.from(hosts.current.keys())) {
      const existing = states.current.get(id);
      if (existing) {
        // The capability probe can land after mount — retry once it arrives.
        if (existing.unavailable && ptyAvailable) {
          existing.unavailable = false;
          existing.term.reset();
          openSession(id, existing);
        }
        continue;
      }
      // Wait for the capability probe so we never flash a false "unavailable".
      if (!capsKnown) continue;
      const el = hosts.current.get(id);
      if (!el) continue;
      const settings = readSettings();
      const term = new Terminal({
        fontFamily: 'IBM Plex Mono, Cascadia Code, Consolas, monospace',
        fontSize: settings.terminalFontSize,
        lineHeight: 1.5,
        cursorStyle: settings.cursorStyle,
        cursorBlink: false,
        cursorInactiveStyle: 'outline',
        convertEol: true,
        theme: {
          background: '#000000',
          foreground: '#D8DEE9',
          cursor: '#FFFFFF',
          cursorAccent: '#000000',
          selectionBackground: '#7FB2FF33',
          black: '#0A0A0A',
          red: '#FF6B6B',
          green: '#9CE0A5',
          yellow: '#F2C879',
          blue: '#7FB2FF',
          magenta: '#D183FF',
          cyan: '#7FE3DB',
          white: '#E6E6E6',
          brightBlack: '#5F6672',
          brightRed: '#FF9A9A',
          brightGreen: '#C3F0C8',
          brightYellow: '#FFE0A3',
          brightBlue: '#A8C8FF',
          brightMagenta: '#E5B3FF',
          brightCyan: '#B0F2EC',
          brightWhite: '#FFFFFF',
        },
        scrollback: 2000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(el);
      const state: TermState = { term, fit, opened: false, exited: false, unavailable: false, shell: '', kind: '', note: '' };
      states.current.set(id, state);

      // A web font that lands after the first fit widens the cell, so the
      // rendered grid ends a few columns past the host (visible as clipped
      // text on narrow panes). Fit once more when the font set settles.
      void document.fonts?.ready.then(() => {
        if (!state.opened) return;
        try { state.fit.fit(); } catch { /* hidden or detached */ }
      });

      term.onData((d) => {
        if (state.exited) return;
        if (!state.opened) {
          const q = pending.current.get(id) ?? [];
          q.push(d);
          pending.current.set(id, q);
          return;
        }
        void sendIo({ op: 'term.write', instance: id, data: d });
      });
      const copySelection = async (t: Terminal) => {
        const sel = t.getSelection();
        if (!sel) return;
        await writeClipboard(sel);
        t.clearSelection();
      };
      const pasteInto = async (t: Terminal) => {
        let text = '';
        try { text = await readClipboard(); } catch { /* clipboard unavailable */ }
        // A PTY needs Enter (CR), not LF, for multi-line pastes.
        if (text) t.paste(text.replace(/\r?\n/g, '\r'));
      };

      // Ctrl+C without a selection is an interrupt, not a copy. With a
      // selection it copies through the shell (never through browser
      // permissions). Ctrl+Shift+C/V and Ctrl+Insert / Shift+Insert mirror
      // the usual terminal keys.
      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== 'keydown') return true;
        const key = e.key.toLowerCase();
        const copyKey = (e.ctrlKey && e.shiftKey && key === 'c') || (e.ctrlKey && e.key === 'Insert');
        if (copyKey) { void copySelection(term); return false; }
        const pasteKey = (e.ctrlKey && e.shiftKey && key === 'v') || (e.shiftKey && e.key === 'Insert');
        if (pasteKey) { void pasteInto(term); return false; }
        if (!e.ctrlKey || key !== 'c') return true;
        if (term.hasSelection()) { void copySelection(term); return false; }
        if (!state.opened || state.exited) return false;
        void sendIo({ op: 'term.interrupt', instance: id });
        return false;
      });
      // Right-click: copy a selection, otherwise paste (Windows terminal habit).
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (term.hasSelection()) void copySelection(term);
        else void pasteInto(term);
      });
      // Clicking the padding around the canvas must focus the terminal too.
      el.addEventListener('mousedown', (e) => {
        if (e.target === el) term.focus();
      });
      term.onResize(({ cols, rows }) => {
        if (state.opened && !state.exited) void sendIo({ op: 'term.resize', instance: id, cols, rows });
      });
      const updateScroll = () => {
        const viewport = el.querySelector<HTMLElement>('.xterm-viewport');
        const buf = term.buffer.active;
        const up = viewport
          ? viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 4
          : buf.viewportY < buf.baseY;
        setScrolledUp((prev) => (prev[id] === up ? prev : { ...prev, [id]: up }));
      };
      term.onScroll(updateScroll);
      el.querySelector('.xterm-viewport')?.addEventListener('scroll', updateScroll);

      if (!ptyAvailable) {
        // No pseudoconsole here: the shell still runs in pipe mode. Keep the
        // session live and say so instead of leaving the user with a dead pane.
        state.unavailable = true;
        term.write(`\x1b[38;2;180;112;110m[${t('terminal.ptyUnavailable')}]\x1b[0m\r\n`);
        bump();
      }
      openSession(id, state);
      // xterm only learns its size from fit(); without observing the host it
      // stayed at the first 80x24 measurement, so a wider window or a closed
      // session column never gave the shell more columns.
      const ro = new ResizeObserver(() => {
        if (!state.opened) return;
        window.requestAnimationFrame(() => {
          try { state.fit.fit(); } catch { /* hidden or detached */ }
        });
      });
      ro.observe(el);
      resizers.current.set(id, ro);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, sendIo, ptyAvailable, capsKnown]);

  // ── shell events ────────────────────────────────────────────────────────
  useEffect(() => {
    const onEvent = (e: Event) => {
      const io = (e as CustomEvent<IoEvent>).detail;
      const instance = io.instance ?? 0;
      const state = states.current.get(instance);
      if (!state || isSilent(instance)) return;
      if (io.type === 'term.output' && io.data) {
        state.term.write(io.data);
        for (const l of String(io.data).split(/\r?\n/)) {
          const text = l.replace(ANSI_RE, '').trim();
          if (text) recordOutput({ instance, source: 'shell', text });
        }
      }
      if (io.type === 'term.done') {
        state.exited = true;
        state.term.write(`\r\n\x1b[38;2;107;119;132m${t('terminal.exited')}\x1b[0m\r\n`);
        bump();
      }
    };
    window.addEventListener('pristem:term', onEvent);
    return () => window.removeEventListener('pristem:term', onEvent);
  }, []);

  // ── lifecycle ───────────────────────────────────────────────────────────
  useEffect(() => {
    setIds((prev) => {
      if (prev.length) return prev;
      const count = canMultiInstance ? Math.max(1, defaultInstances) : 1;
      const list = Array.from({ length: count }, (_, i) => i);
      nextId.current = Math.max(nextId.current, count);
      setNames((n) => {
        const next = { ...n };
        for (const id of list) next[id] = t('terminal.starting');
        return next;
      });
      return list;
    });
    bump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultInstances, canMultiInstance]);

  // Sessions survive a mode switch (the registry keeps them); only explicit
  // tab close or window close kills the shell process.
  useEffect(() => () => {
    resizers.current.forEach((ro) => ro.disconnect());
    resizers.current.clear();
    states.current.forEach((s) => s.term.dispose());
    states.current.clear();
  }, []);

  // Live settings: font size and cursor style apply without a restart.
  useEffect(() => subscribeSettings(() => {
    const s = readSettings();
    states.current.forEach((st) => {
      st.term.options.fontSize = s.terminalFontSize;
      st.term.options.cursorStyle = s.cursorStyle;
      try { st.fit.fit(); } catch { /* ignore */ }
    });
  }), []);

  // Re-fit when the strip expands or the active tab changes — the host kept
  // its DOM while collapsed, so the session never died.
  useEffect(() => {
    if (!activityOpen || tab !== 'terminal') return;
    const raf = requestAnimationFrame(() => {
      const s = states.current.get(activeId);
      if (s) { try { s.fit.fit(); } catch { /* ignore */ } }
    });
    return () => cancelAnimationFrame(raf);
  }, [activityOpen, tab, activeId]);

  // `Ctrl+`` and the palette's "focus terminal" ask for focus from outside the
  // component; only the terminal knows which instance is active.
  useEffect(() => {
    const onFocus = () => {
      const el = hosts.current.get(activeIdRef.current);
      el?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus();
    };
    window.addEventListener('pristem:terminal-focus', onFocus);
    return () => window.removeEventListener('pristem:terminal-focus', onFocus);
  }, []);

  const addInstance = (shell?: ShellProfileId) => {
    if (!canMultiInstance) return;
    const id = nextId.current++;
    if (shell && shell !== 'auto') {
      shells.current.set(id, shell);
    } else {
      shells.current.delete(id);
    }
    setIds((prev) => [...prev, id]);
    setNames((n) => ({ ...n, [id]: t('terminal.starting') }));
    setActiveId(id);
    bump();
    // The new tab must be typeable immediately — the click left focus on the
    // `+` button, so the xterm textarea would never see the keys.
    window.setTimeout(() => focusTerm(id), 0);
  };
  // Palette / command-table "new terminal" (single owner: this component).
  const addRef = useRef(addInstance);
  addRef.current = addInstance;
  useEffect(() => {
    const onNew = () => addRef.current();
    window.addEventListener('pristem:terminal-new', onNew);
    return () => window.removeEventListener('pristem:terminal-new', onNew);
  }, []);

  const closeInstance = (id: number) => {
    const s = states.current.get(id);
    if (s) { s.term.dispose(); states.current.delete(id); }
    resizers.current.get(id)?.disconnect();
    resizers.current.delete(id);
    hosts.current.delete(id);
    renamed.current.delete(id);
    shells.current.delete(id);
    void sendIo({ op: 'term.kill', instance: id });
    const rest = ids.filter((x) => x !== id);
    const nextIds = rest.length ? rest : [0];
    setIds(nextIds);
    let nextActive = activeId;
    if (nextIds.length === 1 && !rest.length) {
      setNames((n) => ({ ...n, 0: t('terminal.starting') }));
      setActiveId(0);
      nextActive = 0;
    } else if (id === activeId) {
      setActiveId(nextIds[0]);
      nextActive = nextIds[0];
    }
    bump();
    if (nextActive !== id) window.setTimeout(() => focusTerm(nextActive), 0);
  };

  const renameInstance = (id: number, name: string) => {
    const v = name.trim();
    const ok = v && v.length <= 24 && !/[\x00-\x1f]/.test(v);
    if (ok) renamed.current.add(id);
    const fallback = states.current.get(id)?.shell || t('terminal.starting');
    setNames((n) => ({ ...n, [id]: ok ? v : fallback }));
    setRenaming(null);
  };

  const focusTerm = (id: number) => {
    const el = hosts.current.get(id);
    el?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus();
  };
  const focusActive = () => focusTerm(activeId);

  return (
    <section className={`pane terminal-pane ${activityOpen ? '' : 'is-collapsed'}`}>
      {!activityOpen && (
        <button
          type="button"
          className="activity-handle"
          aria-label={t('terminal.expand')}
          onClick={() => onActivityOpenChange(true)}
        >
          <ChevronRight size={12} />
        </button>
      )}
      <div className="terminal-body" style={{ display: activityOpen ? undefined : 'none' }}>
      <div className="activity-head">
        <div className="panel-tabs" role="tablist" aria-label={t('activity.output')}>
          {(['terminal', 'output', 'problems'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={tab === v}
              className={`panel-tab ${tab === v ? 'is-active' : ''}`}
              onClick={() => {
                onTabChange(v);
                if (v === 'terminal') window.setTimeout(() => focusTerm(activeId), 0);
              }}
            >
              {v === 'terminal' ? t('editor.terminal') : v === 'output' ? t('activity.output') : t('activity.problems')}
              {v === 'problems' && problems.length > 0 && <span className="panel-tab-badge">{problems.length}</span>}
            </button>
          ))}
        </div>

        {tab === 'terminal' && (
          <button
            type="button"
            className="icon-btn term-clear"
            aria-label={t('terminal.clear')}
            title={t('terminal.clear')}
            onClick={() => { states.current.get(activeId)?.term.clear(); focusTerm(activeId); }}
          >
            <Eraser size={13} />
          </button>
        )}
        <button
          type="button"
          className="icon-btn activity-toggle"
          aria-label={t('terminal.collapse')}
          title={t('terminal.collapse')}
          onClick={() => onActivityOpenChange(false)}
        >
          <ChevronRight size={13} style={{ transform: 'rotate(90deg)' }} />
        </button>
      </div>

      {tab === 'terminal' && (
        <div className="term-tabs" role="tablist" aria-label={t('terminal.instanceCount', { n: ids.length })}>
          {ids.map((id) => {
            const exited = states.current.get(id)?.exited ?? false;
            const kind = states.current.get(id)?.kind ?? '';
            const note = states.current.get(id)?.note ?? '';
            const name = names[id] ?? t('terminal.starting');
            const starting = name === t('terminal.starting');
            return (
              <span
                key={id}
                role="tab"
                aria-selected={id === activeId}
                className={`term-tab ${id === activeId ? 'is-active' : ''} ${exited ? 'is-exited' : ''} ${starting ? 'is-starting' : ''}`}
                title={note ? `${name} — ${note}` : name}
              >
                {renaming === id ? (
                  <input
                    className="term-tab-rename"
                    defaultValue={name}
                    autoFocus
                    onBlur={(e) => renameInstance(id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') renameInstance(id, (e.target as HTMLInputElement).value);
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="term-tab-name"
                    onClick={() => { setActiveId(id); window.setTimeout(() => focusTerm(id), 0); }}
                    onDoubleClick={() => setRenaming(id)}
                  >
                    {name}
                  </button>
                )}
                {kind === 'pipe' && (
                  <span
                    className="term-tab-badge"
                    title={note || t('terminal.pipeBadge')}
                  >
                    {t('terminal.pipeBadge')}
                  </span>
                )}
                {ids.length > 1 && (
                  <button
                    type="button"
                    className="tab-x"
                    aria-label={t('terminal.closeInstance', { name })}
                    onClick={() => closeInstance(id)}
                  >
                    <X size={11} />
                  </button>
                )}
              </span>
            );
          })}
          {canMultiInstance && (
            <>
              <button
                type="button"
                className="term-tab-add"
                aria-label={t('terminal.newInstance')}
                title={t('terminal.newInstance')}
                onClick={() => addInstance()}
              >
                <Plus size={13} />
              </button>
              <button
                type="button"
                className="term-tab-more"
                data-pop-trigger="term-shell-menu"
                aria-haspopup="menu"
                aria-expanded={!!shellMenu}
                aria-label={t('terminal.newWith')}
                title={t('terminal.newWith')}
                onClick={(e) => {
                  if (shellMenu) { setShellMenu(null); return; }
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setShellMenu({
                    left: Math.max(6, Math.min(r.left, window.innerWidth - 210)),
                    top: r.bottom + 4,
                  });
                }}
              >
                <ChevronDown size={11} />
              </button>
            </>
          )}
        </div>
      )}

      {shellMenu && (
        <div
          className="term-shell-pop"
          data-pop="term-shell-menu"
          role="menu"
          aria-label={t('terminal.newWith')}
          style={{ left: shellMenu.left, top: shellMenu.top }}
        >
          {SHELL_CHOICES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="menuitem"
              onClick={() => { setShellMenu(null); addInstance(c.id); }}
            >
              {t(c.key)}
            </button>
          ))}
        </div>
      )}

      <div className="term-views" hidden={tab !== 'terminal'}>
        {ids.map((id) => (
          <div
            key={id}
            className="term-host"
            style={{ display: id === activeId ? undefined : 'none' }}
            ref={(el) => { if (el) hosts.current.set(id, el); else hosts.current.delete(id); }}
          />
        ))}
      </div>
      {tab === 'output' && <OutputPanel onFocusTerminal={focusActive} />}
      {tab === 'problems' && <ProblemsSlot problems={problems} />}
      </div>
      {tab === 'terminal' && activityOpen && scrolledUp[activeId] && (
        <button
          type="button"
          className="term-jump-bottom"
          aria-label={t('terminal.scrollBottom')}
          onClick={() => {
            states.current.get(activeId)?.term.scrollToBottom();
            focusTerm(activeId);
          }}
        >
          <ChevronDown size={13} /> {t('terminal.scrollBottom')}
        </button>
      )}
    </section>
  );
}

function ProblemsSlot({ problems }: { problems: Problem[] }) {
  if (problems.length === 0) {
    return (
      <div className="problems-panel">
        <EmptyState
          variant="zero" title={t('problems.empty')} desc={t('problems.emptyDesc')}
          icon={<EMPTY_ICONS.file size={18} />}
        />
      </div>
    );
  }
  return (
    <div className="problems-panel">
      {problems.slice(0, 200).map((p, i) => (
        <button
          type="button"
          key={`${p.path}:${p.line}:${p.column}:${i}`}
          className="problem-row"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('pristem:open-path', { detail: p.path }));
            setTimeout(() => window.dispatchEvent(new CustomEvent('pristem:jump-line', { detail: p.line })), 300);
          }}
        >
          <span className={`problem-sev ${p.severity}`}>
            {p.severity === 'error' ? t('problems.severity.error')
              : p.severity === 'warning' ? t('problems.severity.warning') : t('problems.severity.info')}
          </span>
          <span>
            <span className="problem-msg">{p.message}</span>
            <span className="problem-loc"> {p.path}:{p.line}:{p.column}</span>
          </span>
        </button>
      ))}
      {problems.length > 200 && <span className="partial-note">{t('problems.shownFirst', { n: 200 })}</span>}
    </div>
  );
}
