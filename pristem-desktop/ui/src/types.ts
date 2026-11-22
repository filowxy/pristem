// Exact mirror of `pristem-ipc` (crates/pristem-ipc/src/events.rs), protocol
// The shell-reported protocol revision. Tagged enums, snake_case. The UI NEVER invents mode
// semantics: it sends ClientRequest and only re-renders when a ServerEvent
// arrives.
//
// Hard constraints honoured here (DESIGN_SYSTEM.md 附录 B′):
//   D-3  the terminal instance field is the number field named `instance`.
//   D-4  `usage` carries exactly { session, input_tokens, output_tokens,
//        cached_tokens, elapsed_ms, tool_calls } — no provider / model.
//   D-5  the protocol version is never hard-coded here; it arrives with the
//        `fs.list` response.

export type Mode = 'coding' | 'IDE' | 'helping' | 'advisor' | 'deepsleep' | 'goal';

/** Mode menu order: ascending presence (IDE 0 … goal 5). */
export const ALL_MODES: Mode[] = ['IDE', 'deepsleep', 'helping', 'advisor', 'coding', 'goal'];

export function normalizeMode(s: string): Mode {
  const found = ALL_MODES.find((m) => m.toLowerCase() === s.toLowerCase());
  return found ?? 'coding';
}

export type ClientKind = 'cli' | 'desktop';

export interface ButtonSpec {
  id: number;
  label: string;
  choice: string;
  uri: string;
}

export type ClientRequest =
  | { type: 'open_session'; mode: string }
  | { type: 'close_session'; session: number }
  | { type: 'switch_mode'; session: number; mode: string }
  | { type: 'submit_round'; session: number; text: string }
  | { type: 'confirm'; session: number; id: number; choice: string }
  | { type: 'release_quarantine'; session: number; id: number }
  | { type: 'list_reminders'; session: number }
  | { type: 'list_modes'; client: ClientKind }
  | { type: 'annotate'; session: number; target: string; note: string; classification: string | null }
  | { type: 'pause'; session: number }
  | { type: 'resume'; session: number }
  | { type: 'list_providers'; client: ClientKind }
  | { type: 'set_provider'; session: number; provider: string };

/** `ProviderInfo` — mirrors pristem-ipc. Never carries key material. */
export interface ProviderInfo {
  id: string;
  adapter: string;
  model: string;
  api_key_env: string;
  base_url: string | null;
  key_present: boolean;
  is_default: boolean;
}

export type ServerEvent =
  | { type: 'session_opened'; session: number; mode: string }
  | { type: 'session_closed'; session: number }
  | { type: 'mode_changed'; session: number; from: string; to: string }
  | { type: 'speech'; session: number; text: string }
  | { type: 'call'; session: number; tool: string; verdict: string }
  | { type: 'result'; session: number; tool: string; status: string; output: string }
  | { type: 'answer'; session: number; text: string }
  | { type: 'intercepted'; session: number; sig_ids: string[]; position: string }
  | { type: 'missing_reminder'; session: number; lines: string[]; reject: boolean }
  | { type: 'digest_requested'; session: number; reason: string }
  | { type: 'reminder'; session: number; lines: string[] }
  | { type: 'buttons'; session: number; prompt: string; buttons: ButtonSpec[] }
  | { type: 'finished'; session: number; outcome: string }
  | { type: 'error'; message: string }
  // D-4 — exactly six payload fields, no provider / model.
  | { type: 'usage'; session: number; input_tokens: number; output_tokens: number; cached_tokens: number; elapsed_ms: number; tool_calls: number }
  | { type: 'providers'; providers: ProviderInfo[] }
  | { type: 'provider_changed'; session: number; provider: string; model: string };

export type IoRequest =
  | { op: 'fs.list'; path?: string }
  | { op: 'fs.read'; path: string }
  | { op: 'fs.write'; path: string; content: string }
  | { op: 'fs.delete'; path: string }
  | { op: 'fs.mkdir'; path: string }
  | { op: 'fs.rename'; from: string; to: string }
  | { op: 'fs.copy'; from: string; to: string }
  | { op: 'fs.search'; query: string; caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean; include?: string; exclude?: string; paths?: string[]; limit?: number }
  | { op: 'fs.replace'; query: string; replacement: string; caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean; include?: string; exclude?: string; paths?: string[] }
  | { op: 'fs.files'; limit?: number }
  | { op: 'fs.openFolder'; path: string }
  | { op: 'fs.pickFolder'; select?: boolean }
  | { op: 'fs.newProject'; parent: string }
  | { op: 'term.open'; instance: number; cols?: number; rows?: number; shell?: string }
  | { op: 'term.write'; instance: number; data: string }
  | { op: 'term.input'; instance: number; data: string }
  | { op: 'term.resize'; instance: number; cols: number; rows: number }
  | { op: 'term.run'; command: string; instance?: number; shell?: string }
  | { op: 'term.interrupt'; instance?: number }
  | { op: 'term.kill'; instance?: number }
  | { op: 'clipboard.read' }
  | { op: 'clipboard.write'; text: string }
  | { op: 'proc.exec'; command: string; args?: string[]; timeout?: number }
  | { op: 'shell.capabilities' }
  | { op: 'models.get' }
  | {
      op: 'models.save'; id: string; adapter: string; model: string; label?: string;
      base_url?: string; apiKey?: string; makeDefault?: boolean; delete?: boolean;
      temperature?: number | null; top_p?: number | null; max_output_tokens?: number | null;
      context_window?: number | null; max_tool_rounds?: number | null;
      supports_images?: boolean | null; reasoning_param?: string | null;
      reasoning_effort?: string | null;
    }
  | { op: 'window.minimize' }
  | { op: 'window.maximize' }
  | { op: 'window.close' }
  | { op: 'window.drag' };

/** One settings-page model row. Never carries key material. */
export interface ModelInfo {
  id: string;
  label: string;
  adapter: string;
  model: string;
  base_url: string | null;
  source: 'builtin' | 'custom';
  key_present: boolean;
  key_source: 'stored' | 'env' | 'none';
  key_env: string;
  /** The running kernel registered this endpoint (pre-restart additions are false). */
  runtime: boolean;
  temperature?: number | null;
  max_output_tokens?: number | null;
  top_p?: number | null;
  context_window?: number | null;
  max_tool_rounds?: number | null;
  supports_images?: boolean | null;
  reasoning_param?: string | null;
  reasoning_effort?: string | null;
}

export interface ModelsState {
  ok?: boolean;
  models: ModelInfo[];
  default: string;
  pending_default: string | null;
  demo: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  dir: boolean;
}

/** Shell capability probe (UX_SPEC 附录 B · B-9). */
export interface ShellCapabilities {
  pickFolder: boolean;
  termInstance: boolean;
  fsListPath: boolean;
  /** A real PTY backend is available (ConPTY on Windows). */
  pty: boolean;
  /** One-shot request/response command execution (git panel). */
  procExec: boolean;
  /** Create a directory. */
  fsMkdir: boolean;
  /** Rename/move a file or directory. */
  fsRename: boolean;
  /** Duplicate a file or directory tree. */
  fsCopy: boolean;
  /** Recursive content search / replace / file index. */
  fsSearch: boolean;
}

export interface IoEvent {
  type: 'term.output' | 'term.done' | 'fs.changed' | 'workspace';
  data?: string;
  code?: number;
  root?: string;
  path?: string;
  /** D-3 — instance routing for terminal output. Defaults to 0 when absent. */
  instance?: number;
}

export type StreamEnvelope =
  | { channel: 'kernel'; payload: ServerEvent }
  | { channel: 'io'; payload: IoEvent };

export interface TranscriptItem {
  uid: string;
  kind:
    | 'speech'
    | 'call'
    | 'result'
    | 'answer'
    | 'intercepted'
    | 'missing'
    | 'digest'
    | 'reminder'
    | 'buttons'
    | 'system'
    | 'user';
  text?: string;
  tool?: string;
  verdict?: string;
  status?: string;
  output?: string;
  lines?: string[];
  buttons?: ButtonSpec[];
  prompt?: string;
  sigIds?: string[];
  position?: string;
  reject?: boolean;
  ts: number;
}

export interface Annotation {
  id: string;
  span: string;
  start: number;
  end: number;
  kind: 'question' | 'correction' | 'reference' | 'tool-call error';
  note: string;
}

export interface SessionState {
  key: string;
  label: string;
  id: number | null;
  mode: Mode;
  /** Last activity, shown as the time on the session card. */
  updatedAt: number;
  items: TranscriptItem[];
  goal: string | null;
  annotations: Annotation[];
  wakeBriefing: string[] | null;
  wakePending: boolean;
  running: boolean;
  handoff: number;
  archived: boolean;
  /** Cumulative usage, summed per session from `usage` events. Null = never seen. */
  usage: UsageTotals | null;
  /** Provider id currently in force (from `provider_changed`). */
  providerId: string | null;
  providerModel: string | null;
}

/** D-4 — the exact shape of one `usage` event. */
export interface UsageTotals {
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  elapsed_ms: number;
  tool_calls: number;
}

export const dormant = (m: Mode) => m === 'IDE';

// Presence is a dial, not a boolean. Used for the dial component only.
export const PRESENCE: Record<Mode, number> = {
  IDE: 0,
  deepsleep: 1,
  helping: 2,
  advisor: 3,
  coding: 4,
  goal: 5,
};

/** The Git panel keeps a reserved channel so it never pollutes a user terminal. */
export const GIT_INSTANCE = 9000;
