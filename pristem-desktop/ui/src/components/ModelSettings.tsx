import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Check, Eye, EyeOff, KeyRound, Plus, Trash2, X } from 'lucide-react';
import { t } from '../i18n';
import { useDismissable } from './overlayStack';
import type { IoRequest, ModelInfo, ModelsState } from '../types';

export interface ProviderPreset {
  id: string;
  labelKey: string;
  adapter: string;
  base: string;
  model: string;
  local?: boolean;
}

// A preset only pre-fills the wire format, base URL and a placeholder model id;
// the key always comes from the user. Every value stays editable in the form.
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'custom', labelKey: 'models.custom', adapter: 'openai-chat', base: '', model: '' },
  { id: 'openai', labelKey: 'models.provider.openai', adapter: 'openai-chat', base: 'https://api.openai.com/v1', model: 'gpt-4o' },
  { id: 'anthropic', labelKey: 'models.provider.anthropic', adapter: 'anthropic-messages', base: 'https://api.anthropic.com', model: 'claude-sonnet-4-5' },
  { id: 'google', labelKey: 'models.provider.google', adapter: 'openai-chat', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-pro' },
  { id: 'xai', labelKey: 'models.provider.xai', adapter: 'openai-chat', base: 'https://api.x.ai/v1', model: 'grok-4' },
  { id: 'mistral', labelKey: 'models.provider.mistral', adapter: 'openai-chat', base: 'https://api.mistral.ai/v1', model: 'mistral-large-latest' },
  { id: 'groq', labelKey: 'models.provider.groq', adapter: 'openai-chat', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { id: 'openrouter', labelKey: 'models.provider.openrouter', adapter: 'openai-chat', base: 'https://openrouter.ai/api/v1', model: '' },
  { id: 'deepseek', labelKey: 'models.provider.deepseek', adapter: 'openai-chat', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'together', labelKey: 'models.provider.together', adapter: 'openai-chat', base: 'https://api.together.xyz/v1', model: '' },
  { id: 'perplexity', labelKey: 'models.provider.perplexity', adapter: 'openai-chat', base: 'https://api.perplexity.ai', model: 'sonar-pro' },
  { id: 'fireworks', labelKey: 'models.provider.fireworks', adapter: 'openai-chat', base: 'https://api.fireworks.ai/inference/v1', model: '' },
  { id: 'cerebras', labelKey: 'models.provider.cerebras', adapter: 'openai-chat', base: 'https://api.cerebras.ai/v1', model: '' },
  { id: 'ollama', labelKey: 'models.provider.ollama', adapter: 'openai-chat', base: 'http://localhost:11434/v1', model: 'llama3.2', local: true },
  { id: 'lmstudio', labelKey: 'models.provider.lmstudio', adapter: 'openai-chat', base: 'http://localhost:1234/v1', model: '', local: true },
  { id: 'volcengine', labelKey: 'models.provider.volcengine', adapter: 'openai-chat', base: 'https://ark.cn-beijing.volces.com/api/v3', model: '' },
  { id: 'dashscope', labelKey: 'models.provider.dashscope', adapter: 'openai-chat', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: '' },
  { id: 'bigmodel', labelKey: 'models.provider.bigmodel', adapter: 'openai-chat', base: 'https://open.bigmodel.cn/api/paas/v4', model: '' },
  { id: 'kimi', labelKey: 'models.provider.kimi', adapter: 'openai-chat', base: 'https://api.moonshot.cn/v1', model: '' },
  { id: 'kimi-global', labelKey: 'models.provider.kimiGlobal', adapter: 'openai-chat', base: 'https://api.moonshot.ai/v1', model: '' },
  { id: 'minimax', labelKey: 'models.provider.minimax', adapter: 'openai-chat', base: 'https://api.minimax.chat/v1', model: '' },
  { id: 'minimax-global', labelKey: 'models.provider.minimaxGlobal', adapter: 'openai-chat', base: 'https://api.minimaxi.com/v1', model: '' },
  { id: 'siliconflow', labelKey: 'models.provider.siliconflow', adapter: 'openai-chat', base: 'https://api.siliconflow.cn/v1', model: '' },
  { id: 'zai', labelKey: 'models.provider.zai', adapter: 'openai-chat', base: 'https://api.z.ai/api/paas/v4', model: '' },
  { id: 'hunyuan', labelKey: 'models.provider.hunyuan', adapter: 'openai-chat', base: 'https://api.hunyuan.cloud.tencent.com/v1', model: '' },
  { id: 'ppio', labelKey: 'models.provider.ppio', adapter: 'openai-chat', base: 'https://api.ppinfra.com/v3/openai', model: '' },
];

const ADAPTERS = ['openai-chat', 'openai-responses', 'anthropic-messages'] as const;

const adapterLabel = (id: string) => id === 'openai-responses'
  ? t('models.adapter.openaiResponses')
  : id === 'anthropic-messages'
    ? t('models.adapter.anthropic')
    : t('models.adapter.openaiChat');

const BUILTIN_LABEL: Record<string, string> = {
  'openai-chat': 'models.provider.openaiChat',
  'openai-responses': 'models.provider.openaiResponses',
  'anthropic-messages': 'models.provider.anthropic',
};

/** Built-in endpoints arrive with a protocol id as their label; show a product name. */
const rowLabel = (m: ModelInfo) => {
  if (m.source === 'custom' && m.label) return m.label;
  const key = BUILTIN_LABEL[m.id];
  return key ? t(key) : (m.label || m.id);
};

const MODEL_PLACEHOLDER: Record<string, string> = {
  'openai-chat': 'gpt-4o',
  'openai-responses': 'gpt-4.1',
  'anthropic-messages': 'claude-sonnet-4-5',
};

const BASE_PLACEHOLDER: Record<string, string> = {
  'openai-chat': 'https://api.openai.com/v1',
  'openai-responses': 'https://api.openai.com/v1',
  'anthropic-messages': 'https://api.anthropic.com',
};

const tokenLabel = (n: number) => n >= 1_000_000 ? `${Math.round(n / 1_000_000)}M` : `${Math.round(n / 1000)}k`;

export const slug = (s: string) => s
  .toLowerCase()
  .replace(/[^a-z0-9._-]+/g, '-')
  .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
  .slice(0, 48);

interface FormState {
  id: string;
  preset: string;
  adapter: string;
  base: string;
  model: string;
  label: string;
  apiKey: string;
  makeDefault: boolean;
  editing: boolean;
  temperature: string;
  topP: string;
  maxOutputTokens: string;
  contextWindow: string;
  maxToolRounds: string;
  supportsImages: 'default' | 'yes' | 'no';
  reasoningParam: string;
  reasoningEffort: string;
}

const num = (v: string) => (v.trim() === '' ? null : Number(v.trim()));

export function ModelSettings({
  sendIo,
  hasActiveSession,
  currentProvider,
  pendingProvider,
  onSwitchProvider,
}: {
  sendIo: (r: IoRequest) => Promise<unknown>;
  hasActiveSession: boolean;
  currentProvider: string | null;
  pendingProvider: string | null;
  onSwitchProvider: (id: string) => void;
}) {
  const [state, setState] = useState<ModelsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [keyFor, setKeyFor] = useState<ModelInfo | null>(null);
  const [keyValue, setKeyValue] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = (await sendIo({ op: 'models.get' })) as ModelsState | undefined;
      if (!r?.ok) {
        setError(t('models.loadFailed'));
        setState(null);
      } else {
        setState(r);
      }
    } catch {
      setError(t('models.loadFailed'));
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [sendIo]);

  useEffect(() => { void load(); }, [load]);

  useDismissable('model-picker', picker, () => setPicker(false));
  useDismissable('model-form', !!form, () => { setForm(null); setFormError(null); });
  useDismissable('model-key', !!keyFor, () => { setKeyFor(null); setKeyValue(''); setShowKey(false); });

  const openNew = (preset: ProviderPreset) => {
    const base = state?.models ?? [];
    let id = preset.id === 'custom' ? '' : preset.id;
    if (id && base.some((m) => m.source === 'custom' && m.id === id)) {
      let n = 2;
      while (base.some((m) => m.source === 'custom' && m.id === `${preset.id}-${n}`)) n += 1;
      id = `${preset.id}-${n}`;
    }
    setPicker(false);
    setFormError(null);
    setForm({
      id,
      preset: preset.id,
      adapter: preset.adapter,
      base: preset.base,
      model: '',
      label: preset.id === 'custom' ? '' : t(preset.labelKey),
      apiKey: '',
      makeDefault: base.length === 0,
      editing: false,
      temperature: '',
      topP: '',
      maxOutputTokens: '',
      contextWindow: '',
      maxToolRounds: '',
      supportsImages: 'default',
      reasoningParam: '',
      reasoningEffort: '',
    });
    // preventScroll stops the settings page from jumping to a section behind the dialog.
    window.requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true }));
  };

  const openEdit = (m: ModelInfo) => {
    setFormError(null);
    setForm({
      id: m.id,
      preset: m.id,
      adapter: m.adapter,
      base: m.base_url ?? '',
      model: m.model,
      label: m.label,
      apiKey: '',
      makeDefault: state?.pending_default === m.id,
      editing: true,
      temperature: m.temperature == null ? '' : String(m.temperature),
      topP: m.top_p == null ? '' : String(m.top_p),
      maxOutputTokens: m.max_output_tokens == null ? '' : String(m.max_output_tokens),
      contextWindow: m.context_window == null ? '' : String(m.context_window),
      maxToolRounds: m.max_tool_rounds == null ? '' : String(m.max_tool_rounds),
      supportsImages: m.supports_images === true ? 'yes' : m.supports_images === false ? 'no' : 'default',
      reasoningParam: m.reasoning_param ?? '',
      reasoningEffort: m.reasoning_effort ?? '',
    });
  };

  const submitForm = async () => {
    if (!form || saving) return;
    const id = form.id || slug(form.label) || slug(form.model);
    const model = form.model.trim();
    if (!/^[a-z0-9][a-z0-9._-]{0,47}$/.test(id)) { setFormError(t('models.invalidId')); return; }
    if (!model) { setFormError(t('models.invalidModel')); return; }
    const base = form.base.trim().replace(/\/+$/, '');
    if (base && !/^https?:\/\//i.test(base)) { setFormError(t('models.invalidUrl')); return; }
    const numeric = [form.temperature, form.topP, form.maxOutputTokens, form.contextWindow, form.maxToolRounds];
    if (numeric.some((v) => v.trim() !== '' && !Number.isFinite(Number(v)))) {
      setFormError(t('models.invalidNumber'));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const r = (await sendIo({
        op: 'models.save', id, adapter: form.adapter, model,
        label: form.label.trim().slice(0, 64),
        base_url: base || undefined,
        apiKey: form.apiKey.trim() || undefined,
        makeDefault: form.makeDefault,
        temperature: num(form.temperature),
        top_p: num(form.topP),
        max_output_tokens: num(form.maxOutputTokens),
        context_window: num(form.contextWindow),
        max_tool_rounds: num(form.maxToolRounds),
        supports_images: form.supportsImages === 'default' ? null : form.supportsImages === 'yes',
        reasoning_param: form.reasoningParam.trim() || null,
        reasoning_effort: form.reasoningEffort.trim() || null,
      })) as { ok?: boolean; error?: string } | undefined;
      if (!r?.ok) { setFormError(r?.error ?? t('models.saveFailed')); return; }
      setForm(null);
      setNotice(t('models.saved'));
      await load();
    } finally {
      setSaving(false);
    }
  };

  const submitKey = async () => {
    if (!keyFor || !keyValue.trim()) return;
    setSaving(true);
    try {
      const r = (await sendIo({
        op: 'models.save', id: keyFor.id, adapter: keyFor.adapter, model: keyFor.model,
        label: keyFor.label, base_url: keyFor.base_url ?? undefined,
        apiKey: keyValue.trim(),
      })) as { ok?: boolean; error?: string } | undefined;
      if (!r?.ok) { setError(r?.error ?? t('models.saveFailed')); return; }
      setKeyFor(null);
      setKeyValue('');
      setShowKey(false);
      setNotice(t('models.saved'));
      await load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (m: ModelInfo) => {
    if (confirmDelete !== m.id) {
      setConfirmDelete(m.id);
      return;
    }
    setConfirmDelete(null);
    const r = (await sendIo({
      op: 'models.save', id: m.id, adapter: m.adapter, model: m.model, delete: true,
    })) as { ok?: boolean } | undefined;
    if (!r?.ok) { setError(t('models.saveFailed')); return; }
    setNotice(t('models.saved'));
    await load();
  };

  const set = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const presetOf = (id: string) => PROVIDER_PRESETS.find((p) => p.id === id);
  const activePreset = form ? presetOf(form.preset) : undefined;
  const rows = state?.models ?? [];

  return (
    <div className="model-settings">
      {state?.demo && (
        <div className="model-banner is-demo" role="status">
          <span className="model-banner-dot" />
          <span>{t('models.demoBanner')}</span>
        </div>
      )}
      {notice && <div className="model-banner is-ok" role="status"><Check size={13} />{notice}</div>}
      {error && (
        <div className="model-banner is-error" role="alert">
          <span>{error}</span>
          <button type="button" className="text-btn" onClick={() => void load()}>{t('models.retry')}</button>
        </div>
      )}

      <div className="model-list" role="list" aria-label={t('models.list')}>
        {loading && !state ? (
          <span className="settings-value is-loading">{t('empty.loading')}</span>
        ) : rows.map((m) => {
          const isCurrent = m.id === (currentProvider ?? state?.default);
          const isPending = m.id === pendingProvider;
          const pendingDefault = state?.pending_default === m.id && m.id !== state?.default;
          return (
            <div className={`model-row ${isCurrent ? 'is-current' : ''}`} key={m.id} role="listitem">
              <span className="model-mono" aria-hidden="true">{rowLabel(m).slice(0, 1).toUpperCase()}</span>
              <div className="model-main">
                <div className="model-title">
                  <span className="model-name">{rowLabel(m)}</span>
                  {m.source === 'custom' && m.id !== rowLabel(m) && <span className="model-id">{m.id}</span>}
                  {isCurrent && <span className="settings-chip">{t('models.chip.current')}</span>}
                  {isPending && <span className="settings-chip">{t('models.chip.nextRound')}</span>}
                  {pendingDefault && <span className="settings-chip">{t('models.chip.nextStart')}</span>}
                  {!m.runtime && <span className="settings-chip">{t('models.chip.restart')}</span>}
                </div>
                <div className="model-meta">
                  {m.source === 'custom' && (
                    <>
                      <span>{adapterLabel(m.adapter)}</span>
                      <span>·</span>
                    </>
                  )}
                  <span className="model-mono">{m.model}</span>
                  {m.base_url && <code>{m.base_url}</code>}
                  {m.context_window ? (
                    <span className="model-cap">{t('models.contextChip', { n: tokenLabel(m.context_window) })}</span>
                  ) : null}
                  {m.supports_images === true && <span className="model-cap">{t('models.imageChip')}</span>}
                </div>
              </div>
              {/* A working key needs no badge; only actionable states are shown. */}
              {m.key_source === 'env' && (
                <span className="model-key is-ok" title={t('models.keyEnv', { env: m.key_env })}>
                  <KeyRound size={11} />
                  {t('models.keyEnvShort')}
                </span>
              )}
              {!m.key_present && (
                <span className="model-key is-missing">
                  <KeyRound size={11} />
                  {t('models.keyMissing')}
                </span>
              )}
              <div className="model-actions">
                {!isCurrent && m.runtime && m.key_present && (
                  <button type="button" className="secondary-btn" disabled={!hasActiveSession || !!isPending} onClick={() => onSwitchProvider(m.id)}>
                    {isPending ? t('models.switching') : t('models.use')}
                  </button>
                )}
                <button type="button" className="icon-btn" title={t('models.setKey')} aria-label={t('models.setKey')} onClick={() => { setKeyFor(m); setKeyValue(''); }}>
                  <KeyRound size={13} />
                </button>
                {m.source === 'custom' && (
                  <>
                    <button type="button" className="text-btn" onClick={() => openEdit(m)}>{t('models.edit')}</button>
                    <button
                      type="button"
                      className={`icon-btn ${confirmDelete === m.id ? 'is-danger' : ''}`}
                      title={confirmDelete === m.id ? t('models.confirmDelete') : t('models.delete')}
                      aria-label={t('models.delete')}
                      onClick={() => void remove(m)}
                    >
                      {confirmDelete === m.id ? <Check size={13} /> : <Trash2 size={13} />}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button type="button" className="secondary-btn model-add" onClick={() => setPicker(true)}>
        <Plus size={13} /> {t('models.add')}
      </button>
      <p className="model-note">{t('models.restartNote')}</p>

      {picker && (
        <div
          className="model-modal-backdrop"
          data-pop="model-picker"
          role="presentation"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setPicker(false); } }}
        >
          <div className="model-modal model-picker" role="dialog" aria-modal="true" aria-label={t('models.addTitle')}>
            <div className="model-modal-head">
              <span>{t('models.addTitle')}</span>
              <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={() => setPicker(false)}><X size={14} /></button>
            </div>
            <p className="model-modal-desc">{t('models.pickProvider')}</p>
            <div className="model-picker-grid">
              {PROVIDER_PRESETS.map((p) => (
                <button type="button" className="model-preset" key={p.id} onClick={() => openNew(p)}>
                  <span className="model-mono">{p.id === 'custom' ? <Box size={14} /> : t(p.labelKey).slice(0, 1).toUpperCase()}</span>
                  <span>{p.id === 'custom' ? t('models.custom') : t(p.labelKey)}</span>
                  {p.local && <span className="model-local">{t('models.local')}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {form && (
        <div
          className="model-modal-backdrop"
          data-pop="model-form"
          role="presentation"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setForm(null); setFormError(null); } }}
        >
          <div className="model-modal model-form" role="dialog" aria-modal="true" aria-label={t('models.addTitle')} ref={formRef}>
            <div className="model-modal-head">
              <span>{form.editing ? t('models.editTitle') : t('models.addTitle')}</span>
              <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={() => setForm(null)}><X size={14} /></button>
            </div>

            <label className="model-field">
              <span>{t('models.adapter')}</span>
              <select
                value={form.adapter}
                onChange={(e) => set({ adapter: e.target.value })}
              >
                {ADAPTERS.map((a) => <option key={a} value={a}>{adapterLabel(a)}</option>)}
              </select>
            </label>

            <label className="model-field">
              <span>{t('models.baseUrl')}</span>
              <input
                value={form.base}
                placeholder={BASE_PLACEHOLDER[form.adapter] ?? 'https://api.example.com/v1'}
                onChange={(e) => set({ base: e.target.value })}
              />
              <small>{t('models.baseUrlHint')}</small>
            </label>

            <label className="model-field">
              <span>{t('models.modelId')} *</span>
              <input
                value={form.model}
                placeholder={activePreset?.model || MODEL_PLACEHOLDER[form.adapter] || 'model-id'}
                onChange={(e) => set({ model: e.target.value })}
              />
              <small>{t('models.modelIdHint')}</small>
            </label>

            <label className="model-field">
              <span>{t('models.label')}</span>
              <input
                value={form.label}
                maxLength={64}
                placeholder={t('models.labelHint')}
                onChange={(e) => set({ label: e.target.value })}
              />
              <small className="model-counter">{form.label.length}/64</small>
            </label>

            <label className="model-field">
              <span>{t('models.apiKey')}{!form.editing ? ' *' : ''}</span>
              <span className="model-key-input">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={form.apiKey}
                  autoComplete="off"
                  placeholder={t('models.apiKeyHint')}
                  onChange={(e) => set({ apiKey: e.target.value })}
                />
                <button type="button" className="icon-btn" aria-label={showKey ? t('models.hideKey') : t('models.showKey')} onClick={() => setShowKey((v) => !v)}>
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </span>
              <small>{form.editing ? t('models.keyKeepNote') : t('models.apiKeyNote')}</small>
            </label>

            <div className="model-advanced">
              <div className="model-advanced-title">{t('models.advanced')}</div>
              <p className="model-advanced-hint">{t('models.advancedHint')}</p>

              <div className="model-field">
                <span>{t('models.contextWindow')}</span>
                <span className="model-number-row">
                  <input
                    inputMode="numeric"
                    value={form.contextWindow}
                    placeholder="128000"
                    onChange={(e) => set({ contextWindow: e.target.value })}
                  />
                  {[128_000, 256_000, 512_000, 1_000_000].map((n) => (
                    <button type="button" key={n} className="model-chip" onClick={() => set({ contextWindow: String(n) })}>
                      {tokenLabel(n)}
                    </button>
                  ))}
                </span>
                <small>{t('models.contextWindowHint')}</small>
              </div>

              <div className="model-field">
                <span>{t('models.outputTokens')}</span>
                <span className="model-number-row">
                  <input
                    inputMode="numeric"
                    value={form.maxOutputTokens}
                    placeholder="8192"
                    onChange={(e) => set({ maxOutputTokens: e.target.value })}
                  />
                  {[4_096, 16_384, 32_768, 131_072].map((n) => (
                    <button type="button" key={n} className="model-chip" onClick={() => set({ maxOutputTokens: String(n) })}>
                      {tokenLabel(n)}
                    </button>
                  ))}
                </span>
              </div>

              <label className="model-field">
                <span>{t('models.toolRounds')}</span>
                <input
                  inputMode="numeric"
                  value={form.maxToolRounds}
                  placeholder="12"
                  onChange={(e) => set({ maxToolRounds: e.target.value })}
                />
                <small>{t('models.toolRoundsHint')}</small>
              </label>

              <div className="model-field">
                <span>{t('models.imageSupport')}</span>
                <div className="settings-seg" role="group">
                  {(['default', 'yes', 'no'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={form.supportsImages === v ? 'is-on' : undefined}
                      onClick={() => set({ supportsImages: v })}
                    >
                      {v === 'default' ? t('models.imageSupport.default')
                        : v === 'yes' ? t('models.imageSupport.yes')
                          : t('models.imageSupport.no')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="model-field">
                <span>{t('models.reasoning')}</span>
                <span className="model-number-row">
                  <input
                    value={form.reasoningParam}
                    placeholder="reasoning_effort"
                    onChange={(e) => set({ reasoningParam: e.target.value })}
                  />
                  <input
                    value={form.reasoningEffort}
                    placeholder="high"
                    onChange={(e) => set({ reasoningEffort: e.target.value })}
                  />
                </span>
                <small>{t('models.reasoningHint')}</small>
                <span className="model-number-row">
                  {['low', 'medium', 'high', 'minimal'].map((v) => (
                    <button type="button" key={v} className="model-chip" onClick={() => set({ reasoningEffort: v })}>
                      {v}
                    </button>
                  ))}
                </span>
              </div>

              <div className="model-field">
                <span>{t('models.sampling')}</span>
                <span className="model-number-row">
                  <label className="model-inline model-inline-first">
                    <span>{t('models.temperature')}</span>
                    <small>{t('models.temperatureHint')}</small>
                  </label>
                  <input
                    inputMode="decimal"
                    value={form.temperature}
                    placeholder="0.2"
                    aria-label={t('models.temperature')}
                    onChange={(e) => set({ temperature: e.target.value })}
                  />
                </span>
                <span className="model-number-row">
                  <label className="model-inline model-inline-first">
                    <span>{t('models.topP')}</span>
                    <small>{t('models.topPHint')}</small>
                  </label>
                  <input
                    inputMode="decimal"
                    value={form.topP}
                    placeholder="1"
                    aria-label={t('models.topP')}
                    onChange={(e) => set({ topP: e.target.value })}
                  />
                </span>
              </div>
            </div>

            <label className="model-check">
              <input
                type="checkbox"
                checked={form.makeDefault}
                onChange={(e) => set({ makeDefault: e.target.checked })}
              />
              <span>{t('models.makeDefault')}</span>
            </label>

            {formError && <div className="model-form-error" role="alert">{formError}</div>}

            <div className="model-modal-actions">
              <button type="button" className="text-btn" onClick={() => setForm(null)}>{t('common.cancel')}</button>
              <button type="button" className="primary-btn small" disabled={saving} onClick={() => void submitForm()}>
                {saving ? t('models.saving') : t('models.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {keyFor && (
        <div
          className="model-modal-backdrop"
          data-pop="model-key"
          role="presentation"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setKeyFor(null); } }}
        >
          <div className="model-modal model-key-dialog" role="dialog" aria-modal="true" aria-label={t('models.setKey')}>
            <div className="model-modal-head">
              <span>{t('models.setKey')} · {rowLabel(keyFor)}</span>
              <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={() => setKeyFor(null)}><X size={14} /></button>
            </div>
            <label className="model-field">
              <span>{t('models.apiKey')}</span>
              <span className="model-key-input">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={keyValue}
                  autoComplete="off"
                  autoFocus
                  placeholder={t('models.apiKeyHint')}
                  onChange={(e) => setKeyValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void submitKey(); }}
                />
                <button type="button" className="icon-btn" aria-label={showKey ? t('models.hideKey') : t('models.showKey')} onClick={() => setShowKey((v) => !v)}>
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </span>
              <small>{t('models.keyReplaceNote')}</small>
            </label>
            <div className="model-modal-actions">
              <button type="button" className="text-btn" onClick={() => setKeyFor(null)}>{t('common.cancel')}</button>
              <button type="button" className="primary-btn small" disabled={saving || !keyValue.trim()} onClick={() => void submitKey()}>
                {saving ? t('models.saving') : t('models.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
