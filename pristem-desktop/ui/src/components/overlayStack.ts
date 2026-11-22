import { useEffect } from 'react';

interface Layer {
  id: string;
  close: () => void;
  modal: boolean;
  returnFocus: HTMLElement | null;
}

interface LayerOptions {
  modal?: boolean;
  returnFocus?: HTMLElement | null;
}

const stack: Layer[] = [];

function workbench(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.workbench');
}

/** A modal layer makes everything below it inert for pointer and keyboard. */
function syncInert() {
  const wb = workbench();
  if (!wb) return;
  const modal = stack.some((l) => l.modal);
  if (modal) wb.setAttribute('inert', '');
  else wb.removeAttribute('inert');
}

export const overlayStack = {
  push(id: string, close: () => void, options: LayerOptions = {}) {
    const i = stack.findIndex((l) => l.id === id);
    if (i >= 0) stack.splice(i, 1);
    stack.push({
      id,
      close,
      modal: options.modal ?? false,
      returnFocus: options.returnFocus ?? null,
    });
    syncInert();
  },
  pop(id?: string): boolean {
    if (id) {
      const i = stack.findIndex((l) => l.id === id);
      if (i < 0) return false;
      const [l] = stack.splice(i, 1);
      l.close();
      restoreFocus(l);
      syncInert();
      return true;
    }
    const l = stack.pop();
    if (!l) return false;
    l.close();
    restoreFocus(l);
    syncInert();
    return true;
  },
  remove(id: string) {
    const i = stack.findIndex((l) => l.id === id);
    if (i >= 0) stack.splice(i, 1);
    syncInert();
  },
  top(): string | null { return stack.length ? stack[stack.length - 1].id : null; },
  count(): number { return stack.length; },
  clear() { stack.length = 0; syncInert(); },
};

/** H-8: a closed overlay returns the focus to the element that opened it. */
function restoreFocus(layer: Layer) {
  const el = layer.returnFocus;
  if (!el) return;
  if (!el.isConnected) return;
  window.requestAnimationFrame(() => {
    try { el.focus({ preventScroll: true }); } catch { /* element gone */ }
  });
}

/** One document-level pointerdown capture listener for the whole app. */
let installed = false;
export function installOutsideDismiss() {
  if (installed) return () => undefined;
  installed = true;
  const handler = (e: PointerEvent) => {
    if (stack.length === 0) return;
    const top = stack[stack.length - 1];
    if (top.modal) return; // modal layers only close through Esc or a button
    const target = e.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function') return;
    if (target.closest('[data-pop]') || target.closest('[data-pop-trigger]')) return;
    overlayStack.pop();
  };
  document.addEventListener('pointerdown', handler, { capture: true, passive: true });
  return () => {
    document.removeEventListener('pointerdown', handler, { capture: true });
    installed = false;
  };
}

/** Register one dismissable layer. Escape is handled by the global keydown. */
export function useDismissable(
  id: string,
  open: boolean,
  onClose: () => void,
  options: LayerOptions = {},
) {
  const modal = options.modal ?? false;
  useEffect(() => {
    if (!open) { overlayStack.remove(id); return; }
    const returnFocus = options.returnFocus ?? (document.activeElement as HTMLElement | null);
    overlayStack.push(id, onClose, { modal, returnFocus });
    return () => overlayStack.remove(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, open, modal]);
}

export const layerProps = (id: string) => ({ 'data-pop': id, 'data-pop-trigger': id });

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** H-8: Tab cycles inside a modal overlay and never escapes to the layer below. */
export function trapFocus(container: HTMLElement | null, e: React.KeyboardEvent) {
  if (!container || e.key !== 'Tab') return;
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (n) => n.offsetParent !== null || n === document.activeElement,
  );
  if (nodes.length === 0) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (e.shiftKey && (active === first || !container.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !container.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}
