/** Shared viewport clamping for every floating layer (no 5th grid row, ever). */
export function clampPos(x: number, y: number, w: number, h: number) {
  const vw = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 900 : window.innerHeight;
  return {
    left: Math.max(8, Math.min(x, vw - w - 8)),
    top: Math.max(8, Math.min(y, vh - h - 8)),
  };
}
