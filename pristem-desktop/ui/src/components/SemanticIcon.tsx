/**
 * Semantic icon set — the Figma "Icons" reference translated into pristem's
 * 24px stroke language. Each icon animates the verb it stands for:
 * folder opens, pencil writes, backspace retracts, command traces its loop,
 * copy pulls a sheet out, export lifts its arrow.
 *
 * Pure SVG + CSS (see `styles.css` §semantic icons), no runtime state.
 */
export type SemanticIconName =
  | 'folder'
  | 'pencil'
  | 'backspace'
  | 'command'
  | 'copy'
  | 'export'
  | 'trash'
  | 'flask'
  | 'refresh'
  | 'send'
  | 'gear'
  | 'search';

export function SemanticIcon({
  name,
  size = 18,
  open = false,
  className = '',
}: {
  name: SemanticIconName;
  size?: number;
  open?: boolean;
  className?: string;
}) {
  const cls = `si si-${name}${open ? ' is-open' : ''}${className ? ' ' + className : ''}`;
  return (
    <svg
      className={cls}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === 'folder' && (
        <>
          <path
            className="si-folder-body"
            d="M3.5 8.5A2.5 2.5 0 0 1 6 6h3.7l2 2H18a2.5 2.5 0 0 1 2.5 2.5v6A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z"
          />
          <path className="si-folder-flap" d="M3.5 10.5h17" />
        </>
      )}
      {name === 'pencil' && (
        <>
          <path
            className="si-pencil-body"
            d="M4 20l1.2-4.1L16.8 4.3a2.05 2.05 0 0 1 2.9 2.9L8.1 18.8z"
          />
          <path className="si-pencil-tip" d="M14.2 6.9l2.9 2.9" />
          <path className="si-pencil-line" d="M3.5 22h8" />
        </>
      )}
      {name === 'backspace' && (
        <>
          <path
            className="si-back-body"
            d="M8.6 6H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8.6L2.8 12z"
          />
          <path className="si-back-x" d="M12.2 9.4l5.2 5.2M17.4 9.4l-5.2 5.2" />
        </>
      )}
      {name === 'command' && (
        <path
          className="si-command-loop"
          d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"
        />
      )}
      {name === 'copy' && (
        <>
          <path
            className="si-copy-front"
            d="M5 15H4.5A2.5 2.5 0 0 1 2 12.5v-8A2.5 2.5 0 0 1 4.5 2H13a2.5 2.5 0 0 1 2.5 2.5V5"
          />
          <rect className="si-copy-back" x="8" y="8" width="13" height="13" rx="2.5" />
        </>
      )}
      {name === 'export' && (
        <>
          <path className="si-export-tray" d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
          <path className="si-export-arrow" d="M12 15V3M7.5 7.5L12 3l4.5 4.5" />
        </>
      )}
      {name === 'trash' && (
        <>
          <g className="si-trash-lid">
            <path d="M4 7h16" />
            <path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" />
          </g>
          <path className="si-trash-body" d="M6 7l1 12a2 2 0 0 0 2 1.8h6a2 2 0 0 0 2-1.8L18 7" />
          <path className="si-trash-body" d="M10 11v6M14 11v6" />
        </>
      )}
      {name === 'flask' && (
        <>
          <path
            className="si-flask-body"
            d="M9.5 3h5M10.5 3v5.1L5.6 17.5A2.3 2.3 0 0 0 7.7 21h8.6a2.3 2.3 0 0 0 2.1-3.5L13.5 8.1V3"
          />
          <path className="si-flask-liquid" d="M8 15h8" />
          <circle className="si-flask-bubble b1" cx="10" cy="17" r="1" />
          <circle className="si-flask-bubble b2" cx="13.6" cy="18" r="1.15" />
          <circle className="si-flask-bubble b3" cx="12" cy="14.4" r=".85" />
        </>
      )}
      {name === 'refresh' && (
        <>
          <path className="si-refresh-arc" d="M20 12a8 8 0 1 1-2.34-5.66" />
          <path className="si-refresh-arrow" d="M20 4v5h-5" />
        </>
      )}
      {name === 'send' && (
        <g className="si-send-plane">
          <path d="M3.5 11.5L20.5 3.5l-5 17-4.2-7.2z" />
          <path d="M11.3 13.3l9.2-9.8" />
        </g>
      )}
      {name === 'gear' && (
        <path
          className="si-gear-body"
          d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        />
      )}
      {name === 'search' && (
        <>
          <circle className="si-search-lens" cx="11" cy="11" r="7" />
          <path className="si-search-handle" d="M16.2 16.2L21 21" />
        </>
      )}
    </svg>
  );
}

/** Drop-in EMPTY_ICONS adapters (same `size` prop as the lucide icons). */
export function FolderIcon({ size = 18 }: { size?: number }) {
  return <SemanticIcon name="folder" size={size} />;
}
