import type { CSSProperties } from 'react';

/** The prism is product identity. It is full-colour in ALL six modes. */
export const BRAND_ICON = '/pristem-icon.png';
export const BRAND_ICON_SM = '/pristem-icon-sm.png';

export function BrandMark({
  size = 20,
  className = '',
  style,
  title,
}: {
  size?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  return (
    <img
      className={`brand-prism ${className}`.trim()}
      src={size <= 19 ? BRAND_ICON_SM : BRAND_ICON}
      alt=""
      aria-hidden="true"
      draggable={false}
      width={size}
      height={size}
      title={title}
      style={{ width: size, height: size, objectFit: 'contain', ...style }}
    />
  );
}
