# FINDER.md — where everything lives

A map for anyone (human or agent) opening this repo for the first time. Read this
before searching. Rules and invariants live in [AGENTS.md](AGENTS.md); this file
only answers "which file do I open?".

```
pristem/
  pristem.cmd                     single entry point: build | serve | help
  AGENTS.md                       rules, invariants, build/test commands
  FINDER.md                       this map
  pristem-desktop/                the desktop client (shell + renderer + docs + tests)
  pristem-kernel/crates/          the kernel crates (modes, agent loop, providers, IPC)
```

---

## 1. pristem-desktop — one process

```
WebView (rendering only)  ──HTTP/SSE──▶  shell (Rust)  ──▶  pristem-ipc ──▶  pristem-core
```

Three ownership rules decide where a change belongs:

| Thing | Owner | Channel |
|---|---|---|
| mode semantics, sessions, rounds, providers | kernel | `ClientRequest` / `ServerEvent` |
| files, terminal, git, workspace store | shell | `POST /api/io` (`io:*` ops) |
| pixels, layout, focus, local view state | renderer | none (renders `ServerEvent`) |

Never let the renderer touch the filesystem or decide a mode transition.

### 1.1 `pristem-desktop/shell` — the native process

| file | what it owns |
|---|---|
| `src/main.rs` | tao/wry window, window state push, workspace store (`%APPDATA%\pristem\workspace.txt`), app bootstrap, min window size (760×560) |
| `src/server.rs` | HTTP static assets + `POST /api/request` + `GET /api/events` (SSE) |
| `src/bus.rs` | SSE fan-out (one JSON line per frame) |
| `src/io.rs` | the whole `io:*` channel: fs read/write/tree/search/trash, git, folder picker, new project |
| `src/term.rs` | terminal registry: ConPTY with first-paint probe, pipe fallback, resize, interrupt, shell profiles |
| `src/models.rs` | model catalogue + DPAPI key store (`%APPDATA%\pristem\models.json`, `model-keys.bin`) |
| `src/demo.rs` | deterministic offline provider transport used by the first pass and the suites |

`Cargo.toml` + `.cargo/config.toml` matter: the advapi32 import lib is generated
locally, so build **from `shell/`**, never with `--manifest-path` from the root.

### 1.2 `pristem-desktop/ui/src` — the renderer

```
main.tsx                  mount + Monaco bootstrap
App.tsx                   app shell, layout, mode wiring, the one window keydown listener
types.ts                  exact mirror of pristem-ipc events (tagged enums, snake_case)
service.ts                POST /api/request, SSE subscription, io:* helpers
capabilities.ts           the system-WebView capability contract (pickFolder, …)
config.ts                 build-time provider label (no key is read here)
i18n.ts                   both dictionaries — every new key lands in BOTH

commands.ts               single command table → menu bar + palette + shortcuts
tasks.ts                  task detection / Run menu entries
views.tsx                 the conversation surfaces: AI panel, transcript, composer, summon
workspace.tsx             explorer tree, editor panes, tabs, terminal, problems
workspaceState.ts         per-root layout memory (sizes, open groups, split, tree state)
editorModels.ts           path-keyed Monaco models (one model per file)
monaco-setup.ts           Monaco workers/language setup
terminalBus.ts            terminal line attribution (instance is a number)

living.ts                 LIVING layer math — pure TS, no React
localSettings.ts          local-only settings (language, type scale, motion, shell)

styles.css                tokens + every component rule (single stylesheet)
polish.css                late-stage visual pass; loaded after styles.css

components/
  BrandMark.tsx           the prism (product identity, full colour in all modes)
  LivingCore.tsx          the LIVING halo attached to the prism
  PresenceDial.tsx        the presence dial (one identity face)
  SemanticIcon.tsx        the linear icon set (Lucide-derived, semantic names)
  Separators.tsx          the three draggable layout separators
  LeftRail.tsx            activity rail (files / search / git / outline / settings)
  ChromeExtras.tsx        titlebar: brand, mode switcher, search capsule, window controls
  MenuBar.tsx             the menubar fed by commands.ts
  SessionBar.tsx          session toggle + the session column
  CommandPalette.tsx      Ctrl+P / F1 palette
  DocPickers.tsx          quick-open + @-mention document pickers
  Panels.tsx              search / git / output / problems panels
  SettingsPage.tsx        settings sections
  ModelSettings.tsx       model + key settings
  Onboarding.tsx          first-run guide
  EmptyState.tsx          one empty-state grammar + ErrorCard
  ToolCard.tsx            tool-call card in the transcript
  PathDialog.tsx          paste-path fallback when the native picker is absent
  SavePromptDialog.tsx    dirty-tab / workspace-switch data-safety gate
  popover.ts              anchored popover positioning
  overlayStack.ts         dismissable escape stack
```

### 1.3 `pristem-desktop` docs and test surface

| path | purpose |
|---|---|
| `DESIGN_SYSTEM.md` | token system v1.0 + appendix A (token change log) |
| `UX_SPEC.md` | interaction and information architecture |
| `BUILD_NOTES.md` | build/runtime notes and protocol decisions |
| `bug_log_optimize.md` | deferred issues and known limits |
| `scripts/smoke.mjs` | protocol/kernel round-trip smoke (15 checks) |
| `.visual-check/check.cjs` | main E2E suite (218 checks, incl. narrow-window and project-column chrome rules) |
| `.visual-check/_git-selfcheck.cjs` | staging, staged-only commit, diff, discard (12) |
| `.visual-check/_effects-selfcheck.cjs` | motion, empty states, icon behaviour (35) |
| `.visual-check/_explorer-selfcheck.cjs` | tree depth, menus, trash, keyboard, clipboard (23) |
| `.visual-check/_search-selfcheck.cjs` | recursive search/replace, quick open (19) |
| `.visual-check/_phase4-selfcheck.cjs` | split editor, dirty guards, persistence (14) |
| `.visual-check/_terminal-selfcheck.cjs` | independent cwd, Ctrl+C, kill (6) |
| `.visual-check/_desktop-selfcheck.cjs` | real WebView2 over CDP + native dialog (5) |
| `ui-design/` | design brief, plan, worklog, audit scripts and screenshots for the UI pass |

Every suite needs its own fresh headless service on its own port (`--no-window --port <n>`),
because the kernel allows four worker slots.

---

## 2. pristem-kernel/crates

| crate | responsibility |
|---|---|
| `pristem-core` | the agent loop, executor, mode state machine (`mode.rs`), session, workspace |
| `pristem-ipc` | `ClientRequest` / `ServerEvent` types and the IPC server |
| `pristem-provider` | provider adapters, registry, transport, types |
| `pristem-harness` | protocol rendering, registry, reminders, compression, skills |
| `pristem-defense` | inbound/outbound policy, signatures, validation (red-team tests) |
| `pristem-deepsleep` | sleep trigger, staging, solo pass, wake |
| `pristem-advisor` | advisory surface logic |
| `pristem-plugin` | plugin host + mount |
| `pristem-cli` | headless CLI + renderer |

The six-mode matrix and its transition table are kernel-owned. Changing a mode's
semantics means changing `pristem-core/src/mode.rs`, not the renderer.

---

## 3. "I want to change X" — start here

| goal | open |
|---|---|
| add a menu item / palette command / shortcut | `ui/src/commands.ts` |
| change the titlebar, mode menu, search capsule | `ui/src/components/ChromeExtras.tsx` + `.titlebar` rules in `styles.css` |
| change a conversation surface or composer | `ui/src/views.tsx` |
| change the explorer, tabs, editor panes, terminal UI | `ui/src/workspace.tsx` |
| change search / git / output / problems panels | `ui/src/components/Panels.tsx` |
| change a colour, size, space or motion value | token block in `ui/src/styles.css`, then appendix A of `DESIGN_SYSTEM.md` |
| add UI copy | both dictionaries in `ui/src/i18n.ts` |
| change terminal behaviour (PTY, fallback, interrupt) | `shell/src/term.rs` |
| change file/tree/git behaviour | `shell/src/io.rs` |
| change HTTP or SSE | `shell/src/server.rs` |
| change mode transitions | `pristem-kernel/crates/pristem-core/src/mode.rs` |
| change protocol types | `pristem-kernel/crates/pristem-ipc/src/events.rs`, then mirror in `ui/src/types.ts` |
| add/remove a test | the suite table above; drive the UI, not `/api/request` |

---

## 4. Suggested reading order

- **UI task**: `AGENTS.md` → this file → `ui/src/types.ts` → `App.tsx` → the component
  you will touch → token block of `styles.css` → `DESIGN_SYSTEM.md` §3–§5.
- **Shell task**: `AGENTS.md` → `shell/src/main.rs` → `server.rs` → the module
  (`io.rs` / `term.rs`) → `pristem-desktop/BUILD_NOTES.md`.
- **Kernel task**: `pristem-kernel-foundation-v0.3.md` → `pristem-ipc/src/events.rs` →
  `pristem-core/src/mode.rs` → `agent_loop.rs`.

## 5. Before you claim done

- `cd pristem-desktop/ui && pnpm build`
- `cd pristem-desktop/shell && cargo build && cargo test`
- one fresh headless service per E2E suite (`pristem.cmd serve` or `--no-window --port <n>`)
- invariants from `AGENTS.md` (six modes, one mode switcher, IDE has zero `data-ai`,
  delete means trash, no new npm deps, both i18n dictionaries).
