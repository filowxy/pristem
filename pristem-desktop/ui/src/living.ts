// ---------------------------------------------------------------------------
// LIVING dynamic layer — frozen v1.4. Pure TypeScript, zero React, zero state.
// The ONLY authoritative driver is the kernel's ServerEvent stream. Every write
// is a dirty-write of one CSS variable on one node (.app-shell).
// ---------------------------------------------------------------------------
import type { Mode, ServerEvent } from './types';
import { normalizeMode } from './types';
import { t } from './i18n';
import { readSettings } from './localSettings';

export type SignalKind = 'flow' | 'settle' | 'gate' | 'stop' | 'await' | 'reset';

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const quantize = (v: number, step: number): number => Math.round(v / step) * step;

/** Public event → signal map. `call`/`result` are refined by verdict/status. */
export const EVENT_MAP: Record<string, SignalKind> = {
  speech: 'flow',
  call: 'flow',
  result: 'flow',
  answer: 'settle',
  reminder: 'settle',
  digest_requested: 'settle',
  missing_reminder: 'gate',
  intercepted: 'stop',
  error: 'stop',
  buttons: 'await',
  mode_changed: 'reset',
  session_opened: 'reset',
  session_closed: 'reset',
  finished: 'reset',
  usage: 'settle',
  providers: 'settle',
  provider_changed: 'settle',
};

interface SignalSpec {
  hue: number;
  gain: number;
  decay: number;
  severity: number;
}

/** flow / settle / gate / stop / await — the five signatures. */
export const SIGNALS: Record<Exclude<SignalKind, 'reset'>, SignalSpec> = {
  flow: { hue: 12, gain: 0.10, decay: 800, severity: 1 },
  settle: { hue: 18, gain: 0.15, decay: 1600, severity: 2 },
  gate: { hue: -36, gain: 0.20, decay: 1200, severity: 3 },
  stop: { hue: -54, gain: 0.30, decay: 1600, severity: 4 },
  await: { hue: 6, gain: 0.10, decay: 8000, severity: 1 },
};

export interface ModePolicy {
  enabled: boolean;
  pulse: boolean;
  only: string[] | null;
}

export const MODE_POLICY: Record<Mode, ModePolicy> = {
  IDE: { enabled: false, pulse: false, only: null },
  deepsleep: { enabled: true, pulse: false, only: null },
  helping: { enabled: true, pulse: true, only: null },
  advisor: { enabled: true, pulse: false, only: null },
  coding: { enabled: true, pulse: true, only: null },
  goal: { enabled: true, pulse: true, only: ['answer', 'buttons'] },
};

const RESET_TYPES = new Set(['mode_changed', 'session_opened', 'session_closed', 'finished']);
const MERGE_MS = 100;

function classify(ev: ServerEvent): Exclude<SignalKind, 'reset'> | null {
  switch (ev.type) {
    case 'speech': return 'flow';
    case 'call': return ev.verdict === 'denied' ? 'gate' : 'flow';
    case 'result': return ev.status === 'blocked' ? 'gate' : 'flow';
    case 'answer':
    case 'reminder':
    case 'usage':
    case 'providers':
    case 'provider_changed':
    case 'digest_requested': return 'settle';
    case 'missing_reminder': return 'gate';
    case 'intercepted':
    case 'error': return 'stop';
    case 'buttons': return 'await';
    default: return null;
  }
}

export interface LivingSignal {
  onKernelEvent(ev: ServerEvent): void;
  shouldPulse(): boolean;
  beginPulse(duration: number): void;
  pointerFrozen(): boolean;
  /** Re-apply the user's intensity preference without waiting for an event. */
  refresh(): void;
  dispose(): void;
}

type HostRef = { current: HTMLElement | null };

export function createLivingSignal(hostRef: HostRef, getMode?: () => Mode): LivingSignal {
  const written = new Map<string, string>();
  let gain = 0;
  let hue = 0;
  let decayTimer: number | null = null;
  let mergeTimer: number | null = null;
  let pulseTimer: number | null = null;
  let pulseUntil = 0;
  let pending: { kind: Exclude<SignalKind, 'reset'>; type: string }[] = [];
  let pendingPulse = false;
  let lastAnnounce = { cat: '', at: 0 };
  let disposed = false;

  const mode = (): Mode => (getMode ? getMode() : 'coding');

  // Single-node dirty-write. No per-frame setProperty, no React state.
  const write = (name: string, value: string) => {
    const el = hostRef.current;
    if (!el || written.get(name) === value) return;
    el.style.setProperty(name, value);
    written.set(name, value);
  };

  const sync = () => {
    const intensity = clamp(readSettings().livingIntensity / 100, 0, 1);
    write('--living-gain', String(quantize(clamp(gain, 0, 1) * intensity, 0.05)));
    write('--living-hue', `${quantize(clamp(hue, -120, 120), 3)}deg`);
  };

  const clearDecay = () => {
    if (decayTimer !== null) { window.clearTimeout(decayTimer); decayTimer = null; }
  };

  const reset = () => {
    clearDecay();
    if (mergeTimer !== null) { window.clearTimeout(mergeTimer); mergeTimer = null; }
    pending = [];
    pendingPulse = false;
    gain = 0;
    hue = 0;
    if (MODE_POLICY[mode()].enabled) {
      sync();
      write('--living-pulse', '0');
    }
  };

  // Screen reader: two live regions — one for progress, one for
  // interruptions. The text says WHAT happened, never WHO
  // (DESIGN §2.4 #17, UX §8.1).
  const announce = (ev: ServerEvent) => {
    const root = hostRef.current;
    if (!root) return;
    const polite = root.querySelector('.sr-only[role="status"]');
    const assertive = root.querySelector('.sr-only[role="alert"]');
    let cat = '';
    let text = '';
    let urgent = false;
    let windowMs = 500;
    switch (ev.type) {
      case 'speech':
      case 'call':
      case 'result': cat = 'running'; text = t('a11y.executing'); break;
      case 'answer': cat = 'answer'; text = t('a11y.answered'); break;
      case 'finished': cat = 'finished'; text = t('a11y.finished'); break;
      case 'usage':
        cat = 'usage'; windowMs = 1500;
        text = t('a11y.usage', { in: ev.input_tokens, out: ev.output_tokens });
        break;
      case 'mode_changed':
        cat = 'mode:' + ev.to;
        text = t('mode.announce', { mode: t('modeName.' + normalizeMode(ev.to)) });
        break;
      case 'providers':
        cat = 'providers'; windowMs = 1500;
        text = t('a11y.providers', { n: ev.providers.length });
        break;
      case 'provider_changed':
        cat = 'provider'; text = t('a11y.providerChanged', { model: ev.model }); break;
      case 'intercepted': cat = 'intercepted'; text = t('a11y.intercepted'); urgent = true; break;
      case 'error':
        cat = 'error'; text = t('a11y.error', { msg: String(ev.message).slice(0, 80) }); urgent = true; break;
      case 'buttons': cat = 'buttons'; text = t('a11y.awaitingConfirm'); urgent = true; break;
      default: return;
    }
    const now = Date.now();
    if (cat === lastAnnounce.cat && now - lastAnnounce.at < windowMs) return;
    lastAnnounce = { cat, at: now };
    const el = urgent ? assertive : polite;
    if (el) el.textContent = text;
  };
  // 100ms merge window: keep the highest-severity signature.
  const flush = () => {
    mergeTimer = null;
    if (!pending.length) return;
    let best = pending[0];
    for (const p of pending) {
      if (SIGNALS[p.kind].severity > SIGNALS[best.kind].severity) best = p;
    }
    pending = [];
    const m = mode();
    const policy = MODE_POLICY[m];
    if (!policy.enabled) return;
    // goal drives ONLY the ::after band pulse; no gain / hue / pulse variables.
    if (m === 'goal') return;
    const spec = SIGNALS[best.kind];
    gain = clamp(gain + spec.gain, 0, 1);
    hue = clamp(hue + spec.hue, -120, 120);
    sync();
    clearDecay();
    decayTimer = window.setTimeout(() => {
      decayTimer = null;
      gain = 0;
      hue = 0;
      sync();
      write('--living-pulse', '0');
    }, spec.decay);
  };

  const onKernelEvent = (ev: ServerEvent) => {
    if (disposed) return;
    announce(ev);
    if (RESET_TYPES.has(ev.type)) {
      // `finished` arrives in the SAME SSE burst as the round it closes (measured:
      // all frames land within ~82ms). Cancelling the 100ms merge here would make
      // the whole dynamic layer inert. Let the merged signature render once; its
      // one-shot decay timeout is the "all zero" reset for that round.
      if (ev.type === 'finished' && pending.length && mergeTimer !== null) return;
      reset();
      return;
    }
    const m = mode();
    const policy = MODE_POLICY[m];
    if (!policy.enabled) return;
    if (policy.only && !policy.only.includes(ev.type)) return;
    const kind = classify(ev);
    if (!kind) return;
    pendingPulse = true;
    pending.push({ kind, type: ev.type });
    if (mergeTimer === null) mergeTimer = window.setTimeout(flush, MERGE_MS);
  };

  const pointerFrozen = () => Date.now() < pulseUntil;

  const shouldPulse = () =>
    !disposed && pendingPulse && MODE_POLICY[mode()].pulse && !pointerFrozen();

  const beginPulse = (duration: number) => {
    pendingPulse = false;
    pulseUntil = Date.now() + duration;
    write('--living-pulse', '1');
    if (pulseTimer !== null) window.clearTimeout(pulseTimer);
    pulseTimer = window.setTimeout(() => {
      pulseTimer = null;
      write('--living-pulse', '0');
    }, duration);
  };

  const dispose = () => {
    disposed = true;
    clearDecay();
    if (mergeTimer !== null) window.clearTimeout(mergeTimer);
    if (pulseTimer !== null) window.clearTimeout(pulseTimer);
    mergeTimer = null;
    pulseTimer = null;
    pending = [];
    pendingPulse = false;
    written.clear();
  };

  const refresh = () => {
    if (!disposed && MODE_POLICY[mode()].enabled) sync();
  };

  return { onKernelEvent, shouldPulse, beginPulse, pointerFrozen, refresh, dispose };
}
