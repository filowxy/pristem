import type {
  ClientRequest,
  IoEvent,
  IoRequest,
  ServerEvent,
  StreamEnvelope,
} from './types';

// ---------------------------------------------------------------------------
// Transport. The UI only ever does two things: send a ClientRequest and render
// ServerEvents. There is no model call, no file write and no mode decision here.
//
// In production the Rust shell (tao + wry) serves this endpoint in-process and
// forwards straight into `pristem_ipc::IpcServer`. When the shell is not running
// we use `DisconnectedService`, which emits NOTHING: fabricating kernel events
// made the UI look like a working agent while no kernel existed.
// ---------------------------------------------------------------------------

export interface Service {
  readonly preview: boolean;
  send(req: ClientRequest): Promise<void>;
  io<T = unknown>(req: IoRequest): Promise<T>;
  onEnvelope(cb: (e: StreamEnvelope) => void): () => void;
  /** Resolves once the event stream is actually open — no lost session_opened. */
  ready(): Promise<void>;
  close(): void;
}

class HttpService implements Service {
  readonly preview = false;
  private es: EventSource | null = null;
  private open: Promise<void> = Promise.resolve();

  async send(req: ClientRequest): Promise<void> {
    await fetch('/api/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
  }

  async io<T>(req: IoRequest): Promise<T> {
    const r = await fetch('/api/io', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    return (await r.json()) as T;
  }

  onEnvelope(cb: (e: StreamEnvelope) => void): () => void {
    const es = new EventSource('/api/events');
    this.es = es;
    this.open = new Promise<void>((resolve) => {
      const done = () => resolve();
      es.addEventListener('open', done, { once: true });
      window.setTimeout(done, 2500); // don't wed the UI if SSE is unavailable
    });
    const handler = (ev: MessageEvent<string>) => {
      try {
        cb(JSON.parse(ev.data) as StreamEnvelope);
      } catch {
        /* ignore malformed frame */
      }
    };
    es.addEventListener('message', handler as EventListener);
    return () => es.removeEventListener('message', handler as EventListener);
  }

  ready(): Promise<void> {
    return this.open;
  }

  close() {
    this.es?.close();
  }
}

/** Offline stand-in. Never fabricates sessions, events or file contents. */
class DisconnectedService implements Service {
  readonly preview = true;
  private listeners = new Set<(e: StreamEnvelope) => void>();
  onEnvelope(cb: (e: StreamEnvelope) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  ready(): Promise<void> { return Promise.resolve(); }
  close(): void { this.listeners.clear(); }
  send(_req: ClientRequest): Promise<void> { return Promise.resolve(); }
  io<T>(req: IoRequest): Promise<T> {
    if (req.op === 'fs.list') return Promise.resolve({ files: [], root: '' } as T);
    if (req.op === 'fs.read') return Promise.resolve({ content: '' } as T);
    return Promise.resolve({ ok: false, error: 'kernel disconnected' } as T);
  }
}

let cached: Service | null = null;

export function resetService(): void { cached = null; }

export async function getService(): Promise<Service> {
  if (cached) return cached;
  try {
    const ctl = new AbortController();
    const t = window.setTimeout(() => ctl.abort(), 900);
    const r = await fetch('/api/ping', { signal: ctl.signal });
    window.clearTimeout(t);
    if (r.ok) {
      cached = new HttpService();
      return cached;
    }
  } catch {
    /* no shell running — use the offline stand-in */
  }
  cached = new DisconnectedService();
  return cached;
}

// WebView2 can deny browser clipboard permission; the native shell is authoritative.
export async function writeClipboard(text: string): Promise<void> {
  try {
    const r = await (await getService()).io<{ ok?: boolean }>({ op: 'clipboard.write', text });
    if (r.ok) return;
  } catch { /* try the browser fallback */ }
  try { await navigator.clipboard?.writeText(text); } catch { /* clipboard unavailable */ }
}

export async function readClipboard(): Promise<string> {
  try {
    const r = await (await getService()).io<{ ok?: boolean; text?: string }>({ op: 'clipboard.read' });
    if (r.ok) return r.text ?? '';
  } catch { /* try the browser fallback */ }
  if (navigator.clipboard) return navigator.clipboard.readText();
  throw new Error('clipboard unavailable');
}
