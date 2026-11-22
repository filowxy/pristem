import { useEffect, useRef } from 'react';
import { t } from '../i18n';
import { trapFocus } from './overlayStack';

/**
 * Data-safety gate (plan 4b). Shown before closing dirty tabs or switching the
 * workspace root. Save writes every dirty buffer, then runs the deferred action;
 * Don't Save discards; Cancel leaves everything untouched.
 */
export function SavePromptDialog({
  name,
  count,
  onSave,
  onDiscard,
  onCancel,
}: {
  name: string;
  count: number;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    window.requestAnimationFrame(() => primary.current?.focus());
  }, []);

  const many = count > 1;
  const title = many ? t('editor.unsavedMany', { n: count }) : t('editor.unsavedTitle', { name });

  return (
    <div className="save-prompt-backdrop" role="presentation">
      <div
        className="save-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-prompt-title"
        ref={box}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
          trapFocus(box.current, e);
        }}
      >
        <p className="save-prompt-title" id="save-prompt-title">{title}</p>
        <div className="save-prompt-actions">
          <button type="button" className="secondary-btn" onClick={onCancel}>{t('common.cancel')}</button>
          <button type="button" className="secondary-btn" onClick={onDiscard}>
            {many ? t('editor.discardAll') : t('editor.dontSave')}
          </button>
          <button type="button" className="primary-btn" ref={primary} onClick={onSave}>
            {many ? t('common.saveAll') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}