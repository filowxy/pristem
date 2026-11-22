import { useState } from 'react';
import { Check, FolderOpen, KeyRound } from 'lucide-react';
import { BrandMark } from './BrandMark';
import { PROVIDER_PRESETS, slug } from './ModelSettings';
import { t } from '../i18n';
import type { IoRequest } from '../types';

const GUIDE_PROVIDERS = ['openai', 'anthropic', 'google', 'deepseek', 'openrouter', 'custom'];

/**
 * First-run guide: choose a workspace, then connect one model. Shown only while
 * `pristem.guide.done` is unset; finishing or skipping writes that flag.
 */
export function Onboarding({
  root,
  sendIo,
  onPickFolder,
  onOpenPath,
  onDone,
  onOpenSettings,
}: {
  root: string;
  sendIo: (r: IoRequest) => Promise<unknown>;
  onPickFolder: () => void;
  onOpenPath: (path: string) => Promise<string | null>;
  onDone: () => void;
  onOpenSettings: () => void;
}) {
  const [step, setStep] = useState(0);
  const [path, setPath] = useState('');
  const [pathError, setPathError] = useState<string | null>(null);
  const [providerId, setProviderId] = useState('openai');
  const [model, setModel] = useState('');
  const [base, setBase] = useState('');
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const preset = PROVIDER_PRESETS.find((p) => p.id === providerId) ?? PROVIDER_PRESETS[0];

  const openPath = async () => {
    const value = path.trim();
    if (!value) return;
    setPathError(null);
    const failure = await onOpenPath(value);
    if (failure) setPathError(failure);
    else setPath('');
  };

  const saveModel = async () => {
    if (saving) return;
    const modelId = model.trim();
    if (!modelId) { setError(t('models.invalidModel')); return; }
    if (!key.trim()) { setError(t('guide.keyPlaceholder')); return; }
    if (providerId === 'custom' && !/^https?:\/\//i.test(base.trim())) {
      setError(t('models.invalidUrl'));
      return;
    }
    const id = providerId === 'custom' ? slug(label) || slug(modelId) : providerId;
    setSaving(true);
    setError(null);
    try {
      const r = (await sendIo({
        op: 'models.save',
        id,
        adapter: preset.adapter,
        model: modelId,
        label: providerId === 'custom' ? (label.trim() || modelId) : t(preset.labelKey),
        base_url: (providerId === 'custom' ? base.trim() : preset.base) || undefined,
        apiKey: key.trim(),
        makeDefault: true,
      })) as { ok?: boolean; error?: string } | undefined;
      if (!r?.ok) { setError(r?.error ?? t('models.saveFailed')); return; }
      setStep(2);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="guide-overlay" role="dialog" aria-modal="true" aria-label={t('guide.title')}>
      <div className="guide-card">
        <header className="guide-head">
          <BrandMark size={26} />
          <div className="guide-heading">
            <h1>{t('guide.title')}</h1>
            <p>{t('guide.subtitle')}</p>
          </div>
          <button type="button" className="text-btn guide-skip" onClick={onDone}>{t('guide.skip')}</button>
        </header>

        <ol className="guide-steps" aria-label={t('guide.stepOf', { n: step + 1 })}>
          {[t('guide.stepWorkspace'), t('guide.stepModel')].map((label, i) => (
            <li key={label} className={i === step ? 'is-current' : i < step ? 'is-done' : undefined}>
              <span>{i < step ? <Check size={11} /> : i + 1}</span>
              {label}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <section className="guide-body">
            <p className="guide-desc">{t('guide.workspaceDesc')}</p>
            <div className="guide-current">
              <span>{root ? t('guide.currentWorkspace') : t('guide.noWorkspace')}</span>
              {root && <code>{root}</code>}
            </div>
            <div className="guide-row">
              <button type="button" className="primary-btn small" onClick={onPickFolder}>
                <FolderOpen size={13} /> {t('guide.chooseFolder')}
              </button>
              <span className="guide-or">/</span>
              <input
                className="guide-input"
                value={path}
                placeholder={t('guide.pathPlaceholder')}
                onChange={(e) => { setPath(e.target.value); setPathError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') void openPath(); }}
              />
              <button type="button" className="secondary-btn" disabled={!path.trim()} onClick={() => void openPath()}>
                {t('guide.openPath')}
              </button>
            </div>
            {pathError && <div className="model-form-error" role="alert">{pathError}</div>}
            <footer className="guide-actions">
              <button type="button" className="primary-btn small" disabled={!root} onClick={() => setStep(1)}>
                {t('guide.next')}
              </button>
            </footer>
          </section>
        )}

        {step === 1 && (
          <section className="guide-body">
            <p className="guide-desc">{t('guide.modelDesc')}</p>
            <div className="guide-providers">
              {GUIDE_PROVIDERS.map((id) => {
                const p = PROVIDER_PRESETS.find((x) => x.id === id);
                if (!p) return null;
                return (
                  <button
                    key={id}
                    type="button"
                    className={`guide-provider ${providerId === id ? 'is-on' : ''}`}
                    onClick={() => { setProviderId(id); setModel(''); setError(null); }}
                  >
                    {id === 'custom' ? t('models.custom') : t(p.labelKey)}
                  </button>
                );
              })}
            </div>

            {providerId === 'custom' && (
              <>
                <label className="model-field">
                  <span>{t('models.baseUrl')}</span>
                  <input value={base} placeholder="https://api.example.com/v1" onChange={(e) => setBase(e.target.value)} />
                </label>
                <label className="model-field">
                  <span>{t('models.label')}</span>
                  <input value={label} maxLength={64} onChange={(e) => setLabel(e.target.value)} />
                </label>
              </>
            )}

            <label className="model-field">
              <span>{t('guide.modelId')}</span>
              <input
                value={model}
                placeholder={preset.model || 'model-id'}
                onChange={(e) => setModel(e.target.value)}
              />
            </label>

            <label className="model-field">
              <span>{t('guide.apiKey')}</span>
              <span className="model-key-input">
                <input
                  type="password"
                  value={key}
                  autoComplete="off"
                  placeholder={t('guide.keyPlaceholder')}
                  onChange={(e) => setKey(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void saveModel(); }}
                />
                <KeyRound size={13} className="guide-key-icon" />
              </span>
            </label>

            {error && <div className="model-form-error" role="alert">{error}</div>}

            <footer className="guide-actions">
              <button type="button" className="text-btn" onClick={() => setStep(0)}>{t('guide.back')}</button>
              <button type="button" className="primary-btn small" disabled={saving} onClick={() => void saveModel()}>
                {saving ? t('models.saving') : t('guide.saveAndFinish')}
              </button>
            </footer>
          </section>
        )}

        {step === 2 && (
          <section className="guide-body guide-done">
            <span className="guide-done-mark"><Check size={18} /></span>
            <h2>{t('guide.done')}</h2>
            <p className="guide-desc">{t('guide.savedHint')}</p>
            <footer className="guide-actions">
              <button type="button" className="text-btn" onClick={onOpenSettings}>{t('provider.title')}</button>
              <button type="button" className="primary-btn small" onClick={onDone}>{t('guide.finish')}</button>
            </footer>
          </section>
        )}
      </div>
    </div>
  );
}
