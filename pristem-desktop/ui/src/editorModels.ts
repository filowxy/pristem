/**
 * Path-keyed shared Monaco models (DESIGN §8.4). One ITextModel per file,
 * reference-counted across editor groups so a split view edits the SAME buffer
 * live. Panes acquire on open / release on close; the registry disposes a model
 * only when the last holder lets go. External writes (reload after a workspace
 * replace) go through `setModelContent`, which is silent so the buffer is not
 * marked dirty by a disk refresh.
 */
import { monaco, languageFor } from './monaco-setup';

const models = new Map<string, monaco.editor.ITextModel>();
const refs = new Map<string, number>();
let silent = 0;

/** True while an external (non-user) write is in flight — panes skip onContentChange. */
export function isSilent(): boolean { return silent > 0; }

export function runSilent<T>(fn: () => T): T {
  silent++;
  try { return fn(); } finally { silent--; }
}

const uriFor = (path: string) => monaco.Uri.parse(`file:///${path}`);

/** Borrow a model for `path`, creating it from `content` on first use. */
export function acquireModel(path: string, content: string): monaco.editor.ITextModel {
  let m = models.get(path);
  if (!m) {
    m = monaco.editor.createModel(content, languageFor(path), uriFor(path));
    models.set(path, m);
    refs.set(path, 0);
  }
  refs.set(path, (refs.get(path) ?? 0) + 1);
  return m;
}

/** The live model for `path`, if any pane holds it. */
export function peekModel(path: string): monaco.editor.ITextModel | undefined {
  return models.get(path);
}

/** Give back one borrow; dispose the model when the last holder releases. */
export function releaseModel(path: string): void {
  const n = (refs.get(path) ?? 0) - 1;
  if (n > 0) { refs.set(path, n); return; }
  refs.delete(path);
  const m = models.get(path);
  if (m) { m.dispose(); models.delete(path); }
}

/** Refresh a buffer from disk without flagging it dirty (post-replace reload). */
export function setModelContent(path: string, content: string): void {
  const m = models.get(path);
  if (!m || m.getValue() === content) return;
  runSilent(() => m.setValue(content));
}

/** Move a buffer to a new path, preserving its content. Refs reset so the
 *  panes' open/close diff re-borrows the new path exactly once each. */
export function renameModel(from: string, to: string): void {
  const m = models.get(from);
  if (!m || from === to) return;
  const content = m.getValue();
  m.dispose();
  models.delete(from);
  refs.delete(from);
  if (!models.has(to)) {
    models.set(to, monaco.editor.createModel(content, languageFor(to), uriFor(to)));
    refs.set(to, 0);
  }
}

/** Drop every model (workspace close). */
export function disposeAllModels(): void {
  models.forEach((m) => m.dispose());
  models.clear();
  refs.clear();
}