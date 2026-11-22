import type { CSSProperties } from 'react';
import { t } from '../i18n';

export type DialSize = 'sm' | 'md';

/**
 * The one presence dial. The status bar and the mode menu use this exact
 * component, so the geometry can never drift apart (DESIGN §6.1 / E2).
 *
 * 5 cells, filled from the LEFT, one cell per presence step (1..5).
 *   sm → 23 × 10px   md → 28 × 12px
 */
export function PresenceDial({
  level,
  size = 'sm',
  current = true,
  className = '',
  label,
}: {
  level: number;
  size?: DialSize;
  current?: boolean;
  className?: string;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(5, Math.round(level)));
  const style = { '--level': clamped } as CSSProperties;
  return (
    <span
      className={`dial dial-${size} ${current ? 'is-current' : ''} ${className}`.trim()}
      data-level={clamped}
      role="img"
      aria-label={label ?? `${t('dial.aria')} ${clamped}/5`}
      style={style}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={`dial-cell ${i <= clamped ? 'on' : ''} ${current && i === clamped ? 'is-current' : ''}`} />
      ))}
    </span>
  );
}
