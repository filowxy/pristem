import type { ReactNode } from 'react';
import { FileWarning, SearchX, AlertTriangle, ListTree } from 'lucide-react';
import { BrandMark } from './BrandMark';
import { FolderIcon } from './SemanticIcon';
import { t } from '../i18n';
import { writeClipboard } from '../service';

export type EmptyVariant = 'first' | 'zero' | 'loading' | 'error' | 'noresult';

export interface EmptyAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

/** The functional icon that replaces the prism in every non-`first` empty state. */
export const EMPTY_ICONS = {
  folder: FolderIcon,
  folderPlain: FolderIcon,
  file: FileWarning,
  search: SearchX,
  error: AlertTriangle,
  outline: ListTree,
} as const;

export type EmptyIconName = keyof typeof EMPTY_ICONS;

/**
 * One empty-state grammar for every nullable surface (DESIGN §8.10).
 * Never carries data-ai. The prism is opt-in and may appear at most once.
 */
export function EmptyState({
  variant = 'zero',
  title,
  desc,
  actions = [],
  query,
  compact = false,
  icon,
  brandMark = false,
  children,
}: {
  variant?: EmptyVariant;
  title: string;
  desc?: string;
  actions?: EmptyAction[];
  query?: string;
  compact?: boolean;
  icon?: ReactNode;
  brandMark?: boolean;
  children?: ReactNode;
}) {
  // G11 — every surface offers at most two actions (one for `noresult`).
  const limit = variant === 'noresult' ? 1 : 2;
  const shown = actions.slice(0, limit);
  const showText = variant !== 'loading';

  return (
    <div className={`empty-state ${compact ? 'is-compact' : ''}`} data-v={variant} aria-live="polite">
      {variant === 'loading' ? (
        <>
          {icon ? <span className="empty-icon" data-pointer aria-hidden="true">{icon}</span> : null}
          <div className="skeleton" aria-hidden="true"><i /><i /><i /></div>
        </>
      ) : (
        <>
          {brandMark && variant === 'first' ? (
            <span className="empty-icon" data-pointer aria-hidden="true"><BrandMark size={28} /></span>
          ) : icon ? (
            <span className="empty-icon" data-pointer aria-hidden="true">{icon}</span>
          ) : null}
          {showText && <span className="empty-title">{title}</span>}
          {desc && <span className="empty-desc">{desc}</span>}
          {variant === 'noresult' && query && <code className="empty-query">{query}</code>}
          {children}
          {shown.length > 0 && (
            <div className="empty-actions">
              {shown.map((a, i) => (
                <button
                  key={`${a.label}:${i}`}
                  type="button"
                  className={a.primary ? 'primary-btn' : 'text-btn'}
                  onClick={a.onClick}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export type ErrorCode =
  | 'noWorkspace' | 'kernelDisconnected' | 'modeRejected' | 'fileReadFailed'
  | 'notGitRepo' | 'commandFailed' | 'sseInterrupted';

/** Actionable error surface: title, reason, retry, copyable detail. */
export function ErrorCard({
  code,
  onRetry,
  detail,
  compact = false,
}: {
  code: ErrorCode;
  onRetry: () => void;
  detail?: string;
  compact?: boolean;
}) {
  return (
    <div className={`error-card ${compact ? 'is-compact' : ''}`} role="alert" data-code={code}>
      <span className="error-title">{t(`error.${code}.title`)}</span>
      <span className="error-reason">{t(`error.${code}.reason`)}</span>
      <div className="error-actions">
        <button type="button" className="primary-btn small" onClick={onRetry}>{t('common.retry')}</button>
        {detail && (
          <button
            type="button"
            className="text-btn"
            onClick={() => { void writeClipboard(detail); }}
          >
            {t('common.copyDetails')}
          </button>
        )}
      </div>
      {detail && (
        <details className="error-detail">
          <summary>{t('error.detail')}</summary>
          <pre>{detail}</pre>
        </details>
      )}
    </div>
  );
}
