import type { RefObject } from 'react';
import type { Mode } from '../types';

/**
 * The LIVING layer is no longer a second brand graphic. It is a halo attached
 * to the title-bar prism and nothing else (DESIGN §2.1, §5.3).
 *
 * The prism is the only graphic; the halo is only light.
 */
export function LivingCore({
  coreRef,
  mode,
}: {
  coreRef: RefObject<HTMLSpanElement | null>;
  mode: Mode;
}) {
  // 0 档：整个智能体表面不存在。
  if (mode === 'IDE') return null;
  return <span className="living-halo" ref={coreRef} aria-hidden="true" />;
}
