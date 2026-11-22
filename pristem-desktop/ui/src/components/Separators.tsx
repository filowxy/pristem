import { type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { clampSize, SIZE_LIMITS, type SizeKind } from '../workspaceState';
import { t } from '../i18n';

/**
 * Three draggable layout separators (plan 4d). Positions ride the workspace CSS
 * vars so they track the grid exactly; dragging writes the var live and reports
 * the clamped size upward for persistence. Double-click resets, arrows nudge
 * ±16px. Hidden below 900px via CSS.
 */
export function Separators({
  workspaceRef, sizes, showRight, showDock, activityOpen, onResize, onReset,
}: {
  workspaceRef: RefObject<HTMLDivElement | null>;
  sizes: { left: number; right: number; activity: number };
  showRight: boolean;
  showDock: boolean;
  activityOpen: boolean;
  onResize: (kind: SizeKind, value: number) => void;
  onReset: (kind: SizeKind) => void;
}) {
  const effLeft = showDock ? Math.max(sizes.left, 336) : sizes.left;
  const current: Record<SizeKind, number> = { left: effLeft, right: sizes.right, activity: sizes.activity };

  const startDrag = (kind: SizeKind) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const ws = workspaceRef.current;
    if (!ws) return;
    e.preventDefault();
    const rect = ws.getBoundingClientRect();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    ws.classList.add('is-resizing');
    const move = (ev: PointerEvent) => {
      const v = kind === 'left' ? ev.clientX - rect.left
        : kind === 'right' ? rect.right - ev.clientX
        : rect.bottom - ev.clientY;
      onResize(kind, clampSize(kind, v));
    };
    const up = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId);
      ws.classList.remove('is-resizing');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const onKey = (kind: SizeKind) => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    let delta = 0;
    if (kind === 'left') delta = e.key === 'ArrowRight' ? 16 : e.key === 'ArrowLeft' ? -16 : 0;
    else if (kind === 'right') delta = e.key === 'ArrowLeft' ? 16 : e.key === 'ArrowRight' ? -16 : 0;
    else delta = e.key === 'ArrowUp' ? 16 : e.key === 'ArrowDown' ? -16 : 0;
    if (!delta) return;
    e.preventDefault();
    onResize(kind, clampSize(kind, current[kind] + delta));
  };

  const sep = (kind: SizeKind, orientation: 'vertical' | 'horizontal', label: string) => (
    <div
      className={`ws-separator ws-sep-${kind}`}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={current[kind]}
      aria-valuemin={SIZE_LIMITS[kind][0]}
      aria-valuemax={SIZE_LIMITS[kind][1]}
      tabIndex={0}
      onPointerDown={startDrag(kind)}
      onDoubleClick={() => onReset(kind)}
      onKeyDown={onKey(kind)}
    />
  );

  return (
    <>
      {sep('left', 'vertical', t('separator.left'))}
      {showRight && sep('right', 'vertical', t('separator.right'))}
      {activityOpen && sep('activity', 'horizontal', t('separator.activity'))}
    </>
  );
}