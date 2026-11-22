import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { t } from '../i18n';
import { readRecent } from './Panels';
import { trapFocus } from './overlayStack';
import { readClipboard } from '../service';

/**
 * Path paste fallback for "open folder" (UX §5.3). Used when the shell does
 * not expose `fs.pickFolder`, and always reachable as the secondary link.
 */
export function PathDialog({
  open,
  noNative,
  onClose,
  onSubmit,
}: {
  open: boolean;
  noNative: boolean;
  onClose: () => void;
  /** Resolves with an i18n error key, or null on success. */
  onSubmit: (path: string) => Promise<string | null>;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setValue('');
    setError(null);
    setBusy(false);
    window.requestAnimationFrame(() => input.current?.focus());
  }, [open]);

  if (!open) return null;

  const recent = readRecent().slice(0, 5);

  const validate = (raw: string): string | null => {
    const v = raw.trim();
    if (!v) return t('pathDialog.err.empty');
    if (!/^(\/|\\\\|[A-Za-z]:)/.test(v)) return t('pathDialog.err.relative');
    if (v.split(/[\\/]/).includes('..')) return t('pathDialog.err.parent');
    return null;
  };

  const submit = async (raw: string) => {
    const problem = validate(raw);
    if (problem) { setError(problem); input.current?.focus(); return; }
    setBusy(true);
    const failure = await onSubmit(raw.trim());
    setBusy(false);
    if (failure) { setError(failure); return; }
    onClose();
  };

  const paste = async () => {
    try {
      const text = await readClipboard();
      setValue(text.trim());
      setError(null);
    } catch {
      setError(t('pathDialog.err.clipboard'));
    }
  };

  return (
    <div
      className="path-dialog-backdrop"
      onPointerDown={(e) => { if (e.target === e.currentTarget) return; }}
      role="presentation"
    >
      <div
        className="path-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('pathDialog.title')}
        ref={box}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
          trapFocus(box.current, e);
        }}
      >
        <div className="path-dialog-head">
          <span className="path-dialog-title">{t('pathDialog.title')}</span>
          <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {noNative && <p className="path-dialog-note">{t('pathDialog.noNative')}</p>}

        <div className="path-dialog-row">
          <input
            ref={input}
            className="path-dialog-input"
            aria-label={t('pathDialog.pathLabel')}
            placeholder={t('pathDialog.placeholder')}
            value={value}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? 'path-dialog-error' : undefined}
            onChange={(e) => { setValue(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(value); } }}
          />
          <button type="button" className="secondary-btn" style={{ height: 28, padding: '0 10px' }} onClick={() => void paste()}>
            {t('pathDialog.paste')}
          </button>
        </div>

        {error && <p className="path-dialog-error" id="path-dialog-error">{error}</p>}

        <div className="path-dialog-recent">
          <span className="path-dialog-recent-head">{t('pathDialog.recent')}</span>
          {recent.length === 0 ? (
            <span className="path-dialog-empty">{t('pathDialog.recentEmpty')}</span>
          ) : (
            recent.map((r) => (
              <button key={r.root} type="button" onClick={() => void submit(r.root)}>
                <span>{r.label}</span>
                <code>{r.root}</code>
              </button>
            ))
          )}
        </div>

        <div className="path-dialog-actions">
          <button type="button" className="secondary-btn" onClick={onClose}>{t('pathDialog.cancel')}</button>
          <button type="button" className="primary-btn" disabled={busy} onClick={() => void submit(value)}>
            {t('pathDialog.open')}
          </button>
        </div>
      </div>
    </div>
  );
}
