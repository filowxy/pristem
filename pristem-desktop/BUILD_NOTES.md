# pristem desktop — first pass build notes

## Stack decision (and why)

The owner removed the Tauri requirement and clarified that HTML is **not** mandated either.
Chosen on merit, not by default:

- **Native desktop window** via `tao` + `wry` (the same WebView2 binding Tauri uses), built
  directly with the Rust kernel in-process. This is **not** Tauri, **not** Electron, and
  **not a browser tab**. One Rust process, no Node runtime, no permanent JS↔Rust bridge.
- Why a WebView-rendered UI layer was still chosen: Monaco and xterm.js were hard
  constraints in the original brief and cannot be embedded in a pure-widget toolkit. The
  *window* is native; the UI layer is a rendering surface only.
- Verified on this machine: WebView2 Runtime 156/157 present, `tao 0.37` + `wry 0.57`
  compile and link on the `x86_64-pc-windows-gnullvm` / `rust-lld` host. **No MSVC C++
  Build Tools / Windows SDK are installed**, which is exactly why Tauri's official Windows
  prerequisite path was not usable here.
- Memory: a system WebView shell keeps the client well under the <1 GB budget; there is
  no second Chromium and no Node process.

## Architecture

```
WebView (React, rendering only)
   │  POST /api/request   → ClientRequest JSON (pristem.ipc/v0.3)
   │  GET  /api/events    ← ServerEvent JSON frames (SSE)
   ▼
Rust shell (tao/wry window + tiny HTTP/SSE transport)
   ▼
pristem_ipc::IpcServer → pristem_core::SessionManager / ModeRouter / AgentLoop
```

Mode is **never set by the UI**. Every transition is a `switch_mode` request; the UI only
re-renders on the kernel's `mode_changed` event. The kernel's 6×6 transition table is
authoritative (e.g. `helping → deepsleep` is forbidden; `deepsleep` entry emits a
`buttons` confirmation that the UI answers with `confirm`).

The transport is chosen at bootstrap: if **any** configured endpoint can authenticate
(`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`), the shell wires `CurlTransport` and the window talks
to the real API; with no key it falls back to the offline `DemoTransport` implementing
`pristem_provider::Transport`, so the **real** round loop still runs (tool calls → five gates
→ executor → answer gate → streamed `speech/call/result/answer` events). The startup line
prints which one is active. Endpoint list, switching and streaming:
`pristem-kernel/PROVIDERS.md`.

`ServerEvent::SpeechDelta` now exists for streamed model output; the UI renders `speech`
whole today and ignores the deltas, so enabling `provider.stream` is a kernel-side switch
until the renderer grows a typing state.

## Open it (the normal way)

Double-click **pristem** on the Desktop or in the Start Menu — no terminal, no build step
assumed. Both shortcuts are installed by `launch\install-shortcuts.ps1` and target
`wscript.exe` + `launch\pristem-launch.vbs`, so the console-subsystem binary never flashes a
black window. Every entry point funnels into one script:

| entry | what it does |
|---|---|
| `pristem.cmd` (project root) | open the window; build UI + shell first if nothing is built yet |
| `pristem.cmd build` | close a running window, rebuild renderer + shell, open |
| `pristem.cmd serve` | headless service on `127.0.0.1:8787` (what `smoke.mjs` / `.visual-check` drive) |
| `pristem.cmd help` | the above, in the terminal |

Two failure modes the launcher absorbs, so opening never depends on a dev shell:

- **runtime DLLs** — cargo injects `<sysroot>\bin` only for `cargo run`. A bare double-click of
  `target\debug\pristem-desktop.exe` dies silently (exit 127) unless `libunwind.dll` and
  `std-*.dll` sit next to it. The script stages both on first open and again after
  `cargo clean` / a fresh clone.
- **stale or missing build** — no exe or no `ui\dist` triggers a one-time build instead of a
  blank window; a non-zero exit from the app surfaces as a message box (a hidden launch has
  nowhere to print).

Reinstall or remove the shortcuts:

```bash
powershell -ExecutionPolicy Bypass -File launch\install-shortcuts.ps1          # desktop + start menu
powershell -ExecutionPolicy Bypass -File launch\install-shortcuts.ps1 -Remove
```

Icons: `python pristem-desktop\assets\make-app-icon.py` derives `assets\pristem.ico` (shortcuts,
16→256) and `assets\icon_128.rgba` (the tao window icon, `include_bytes!`d by the shell) from
`assets\pristem-icon-taskbar.png`. The gnullvm link has no Win32 resource section, so the exe
itself carries no icon — `with_window_icon` is what puts the mark in the taskbar / Alt-Tab.

`pristem.cmd`, the `.vbs` and the `.ps1` are **ASCII + CRLF on purpose**: cmd.exe misparses
LF-only batch files and mangles UTF-8 punctuation, and Windows PowerShell 5.1 reads a BOM-less
`.ps1` as ANSI. Keep them ASCII if you edit them.

Each launch is its own process and its own kernel instance — double-clicking twice opens two
windows. Deliberate for now (no single-instance arbitration); flagged rather than invented.

## Run (dev workflow)

```bash
cd pristem-desktop/ui
pnpm install
pnpm build

cd ../shell
bash scripts/gen-advapi32-import.sh   # one-time, see toolchain note below
cargo run                             # native desktop window (default)
# or
cargo run -- --no-window              # headless service → http://127.0.0.1:8787
```

`--no-window` serves the same UI to a browser, which is useful for inspection; the
deliverable itself is the native window. If you run `target/debug/*.exe` directly instead
of `cargo run`, put `<rustc --print sysroot>/bin` on PATH (the gnullvm std DLLs live
there) — or just use `pristem.cmd`, which stages them for you.

### Toolchain note (gnullvm, no MSVC)

`webview2-com-sys`/`tao` link `advapi32`, but the `x86_64-pc-windows-gnullvm` sysroot
ships import libs for kernel32/user32/ws2_32/etc. and **not** `libadvapi32.a`. Rather
than install Visual Studio Build Tools, `scripts/gen-advapi32-import.sh` derives that
single import library from the system `C:/Windows/System32/advapi32.dll` export table
using the LLVM tools already inside the Rust toolchain. `shell/.cargo/config.toml` adds
the generated `native-lib/` directory to the linker search path. Nothing in the user's
Rust installation is modified.

### Demo-only service data

The cross-session REMINDER store is seeded at bootstrap with three "committed rules" so
`list_reminders` has real content to present as the deepsleep wake briefing. Production
gets those rules from the deepsleep digestion engine; this seed is explicitly a shell-side
demo fixture, not UI logic.

## Six modes — what is implemented

| mode | layout |
|---|---|
| `coding` | file tree + Monaco + xterm + AI chat docked **right** (resizable/collapsible). Visible execution flow, follow-ups queue mid-run. |
| `IDE` | pure IDE. **Zero** `[data-ai]` elements mounted; AI event handling is dropped before any state accumulates (architectural dormancy, not CSS hiding). AI column width collapses to 0. |
| `helping` | conversation docked in the **lower half of the file tree column** (50/50 split), not a side drawer. Escalate → coding, dismiss → IDE. |
| `advisor` | full-screen review canvas; select a span → classify (question / correction / reference / tool-call error) + note; annotations render on the spans and in a light rail. No analysis panels. Submitting the batch plays the designed advisor → deepsleep handoff and always enters deepsleep. |
| `deepsleep` | quiet night state, breathing indicator only, low-prominence log, "session archived". Wake briefing appears as a deliberate overlay on `reminder`, with "Resume session" (pause ≠ terminate). |
| `goal` | pure intent chat, no file tree / editor / terminal anywhere. `/goal` pins a goal card. Tool calls and results are **not** rendered. |

Multi-session = **tabs** (chosen once, kept global). Sessions share one workspace root and
the same open-file state.

## Keyboard contract

| binding | implementation |
|---|---|
| `shift+@` held + `F1` | summon anywhere. Opens the near-cursor floating panel when AI is dormant; focuses the composer when AI is already present. |
| `shift+@` held + `S` | load last session (previous tab, else the most recently closed session). |
| `F2` / `Fn+F2` | opens the status-bar mode switcher. Captured as `code === 'F2'`, `key === 'F2'`, and the common laptop media equivalents (`AudioVolumeDown`, `VolumeDown`, `AudioVolumeMute`). |
| `@` | **plain text everywhere**. The `@` keydown is never `preventDefault`ed. In IDE mode a *lone* `@` at a word start summons; if the next typed character is a word character (`@Mod`, `@SubscribeEvent`) the pending summon is cancelled and the `@` stays plain text. When a summon does fire, the triggering `@` is removed from the editor. |

Global hotkeys are capped at exactly three. Everything else is slash commands or clicks.

## OPEN QUESTIONS / assumptions — flagged, not invented

1. **goal mode file work** — owner left this unanswered. Implemented as: **nothing floats;
   file work is silent** (`call` / `result` events are dropped in goal mode). Flagged in the
   goal composer UI as well.
2. **`F2` action** — the brief requires capturing F2 and Fn+F2 equivalently but does not
   say what F2 does. Assigned the least-semantic action: open the global mode switcher.
   No mode semantics were invented.
3. **`/goal`** — `pristem.ipc/v0.3` has no set-goal request. The UI keeps the goal text as
   presentation state and also sends the raw `/goal …` message through `submit_round`.
   No kernel semantics were added.
4. **"load last session"** — there is no archive-load request in the IPC schema. Implemented
   as tab restore / reopen of the last closed session's mode. Flagged here.
5. **Wake briefing** — no dedicated event exists. Mapped to `list_reminders` → `reminder`
   (`lines` = committed rules), which keeps the UI a pure renderer.

## Protocol gaps found while wiring (for the kernel team)

- `pristem.ipc/v0.3` covers session / mode / round / buttons / reminders only. **File tree,
  file read+write and terminal execution have no request type.** These are implemented as a
  clearly namespaced `io:*` channel owned by the shell, not as kernel semantics. The WebView
  still performs zero file writes itself.
- No `open folder` picker request; the explorer currently uses a path input.
- No deepsleep-completion / wake event, no archive enumeration, no goal setter, no
  annotation-batch commit (annotations are sent one `annotate` at a time + `pause` +
  `switch_mode`).

## Kernel behaviours observed while wiring (for the kernel team)

- `switch_mode → deepsleep` emits a `buttons` confirmation **before** consulting the
  6×6 transition table. The table is only enforced when the user confirms
  (`helping → deepsleep` is rejected at that point). The confirmation id is not bound to
  the mode that produced it, so a stale confirmation can later be applied from a
  different mode. Worth tightening on the kernel side.
- `worker_slots` defaults to 4. The client closes sessions when a tab is closed, but
  rapid tab churn (or protocol probes that forget to close) can hit `SlotsExhausted`.
  Flagged, not changed — that's service policy, not UI.

## Shell-owned IO surface (IDE sweep, 2026-11-15)

All of this lives on the `io` channel (`POST /api/io`, events on `/api/events`); the kernel
never sees it. `shell/src/io.rs`, `shell/src/term.rs`.

### Terminal: real ConPTY (`shell/src/term.rs`)

- Windows uses `CreatePseudoConsole` + `STARTUPINFOEXW`/`PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE`
  → `CreateProcessW` with `EXTENDED_STARTUPINFO_PRESENT`; cwd = workspace root. The GNU
  sysroot ships every import lib except `advapi32`; `shell/native-lib/libadvapi32.a` is
  generated locally and picked up by `shell/.cargo/config.toml` (`-L native=…`). **Build from
  `shell/`**, otherwise cargo does not read that config and lld fails on `-ladvapi32`
  (mio pulls `Win32_Security`, so the dep is not removable).
- Shell probe order (`shellProfile: auto`): `pwsh` (via `where.exe`) → `powershell.exe` →
  `cmd.exe`. The response carries the real short name, which the tab uses.
- **First paint is the health check.** A hosted shell that dies during console init stays
  "alive" while a system dialog blocks it, so the spawn nudges the pseudoconsole with one
  Enter, waits up to 2.5 s for output, kills the child (closing the dialog), retries with
  `cmd.exe` under ConPTY (1.5 s), and only then drops to the pipe fallback. `SetErrorMode` at
  startup keeps the hard-error dialog from ever appearing.
  Two spawn details decide whether this path works at all:
  - `UpdateProcThreadAttribute(PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE)` must receive the **HPCON
    value**. Handing it `&hpc` gives conhost an invalid handle: every shell dies with
    `0xC0000142`, which looks exactly like "this shell cannot run under a pseudoconsole".
  - The child is created with `STARTF_USESTDHANDLES` and null std handles. Without the flag,
    a host with redirected stdio (a log file, a pipe, `cargo test`) passes those handles to
    the shell; the tab paints blank and typing goes nowhere while the shell writes into the
    host's stdout.
  `CREATE_NO_WINDOW` is not used: with a valid pseudoconsole attribute the child is attached to
  it, and the flag would make conhost skip initialization.
  A shell that failed once is remembered for the rest of the process, so later tabs open
  instantly. The UI queues keystrokes typed before `term.open` resolves. `term.open` reports
  `kind: "pty" | "pipe"` plus the real `shell`/`path`, so the tab never claims a shell it does
  not have.
  **Note**: when the host runs inside a restrictive job object (the automation sandbox this
  was verified in), conhost cannot start and every shell degrades to the pipe fallback; a
  desktop launch (`pristem.cmd`, Start Menu) gets the real ConPTY path. Install PowerShell 7
  (`pwsh`) if you want a newer PowerShell — `auto` prefers it, and Windows PowerShell 5.1 also
  works under ConPTY once the two details above are right.
- `Drop`/`kill_all` → `TerminateProcess` → `ClosePseudoConsole` → close pipes. Window close
  kills sessions first, so no stray `conhost.exe` remains.
- **Ctrl+C is `term.interrupt`, not a byte.** Writing 0x03 to the ConPTY input pipe lands in
  the line buffer as text instead of raising `CTRL_C_EVENT`, so the shell enumerates the
  session's descendants (Toolhelp) and terminates them deepest-first — the shell process and
  its cwd survive. The xterm host intercepts Ctrl+C without a selection and calls this op;
  `run.stop` uses the same path.
- The pipe fallback decodes child output with `MultiByteToWideChar(CP_OEMCP)` (GBK on this
  machine) instead of UTF-8-as-is, so Chinese prompts and tool output are readable.
- Non-Windows and restrictive job objects fall back to a persistent piped shell
  (`// ponytail: not a real PTY`) — real prompt, persistent cwd, no ANSI/full-screen apps.

### Ops

| op | shape | notes |
|---|---|---|
| `term.open` | `{instance, cols, rows, shell?}` → `{ok, shell}` | idempotent; real shell name |
| `term.write` | `{instance, data}` | raw bytes, no newline appended |
| `term.input` | alias of `term.write` | kept for old call sites |
| `term.resize` | `{instance, cols, rows}` | clamped 20×5 … 400×200 |
| `term.run` | `{instance, command}` | lazy-open, then writes `command + "\r"` |
| `term.interrupt` | `{instance}` | Ctrl+C: terminate the shell's descendants, keep the shell (and its cwd) alive |
| `term.kill` | `{instance}` | terminates process, closes PTY |
| `proc.exec` | `{command, timeout?}` → `{ok, stdout, code}` | one-shot `cmd /C` (`sh -c`), stdout+stderr merged, 10s default, 256 KiB cap — Git panel's only dependency |
| `fs.mkdir` | `{path}` | error `exists` when present |
| `fs.rename` | `{from, to}` | both through `resolve`; root and `.pristem` rejected |
| `fs.search` | `{query, caseSensitive, wholeWord, regex, include, exclude, limit}` | recursive from root, `.pristem` skipped, symlinks not followed, 512 KiB/file, 4000 files, 500 hits |
| `fs.replace` | same + `replacement` | literal mode uses `NoExpand` (`$` safe) |
| `fs.files` | `{limit?}` → `{files:[paths]}` | recursive index for quick open + tree filter |
| `shell.capabilities` | — | `pickFolder, termInstance, fsListPath, pty, procExec, fsMkdir, fsRename, fsSearch` |

`fs.read` now reports `truncated: true` at the 400k-char cap; the UI opens such files
read-only instead of silently letting a save destroy the tail.

## Verification performed

- `scripts/smoke.mjs` — **15/15** protocol checks: session_opened, six-mode transitions
  (including the forbidden `helping → deepsleep` rejection), confirmation round-trip,
  annotation → digest, wake briefing, full round stream (`speech/call/result/answer/
  finished`), and service IO file listing.
- `.visual-check/check.cjs` — **116/116** runtime checks driving the real WebView2 page:
  real shell prompt + `cd` persistence, terminal collapse/expand, fs write/read round-trip,
  IDE renders **zero** `[data-ai]` elements with the right column collapsed to `0px`, the
  IDE-only `.menubar` (five menus, shortcut labels, Esc), the task picker, `@Mod` stays
  plain text, a lone `@` summons near the cursor and sending enters helping, helping's dock
  is exactly half the project column, advisor span annotation, deepsleep quiet state + wake
  briefing + resume, goal has no codebase surfaces, and no uncaught page errors.
- `.visual-check/_effects-selfcheck.cjs` **35/35**, `_explorer-selfcheck.cjs` **18/18**
  (depth-4 expansion, context-menu create/rename/delete-to-trash, keyboard nav),
  `_search-selfcheck.cjs` **14/14** (nested hits, include/exclude, regex error, Replace All,
  `.pristem` exclusion, Ctrl+P nested file), `_phase4-selfcheck.cjs` **13/13** (split shared
  models, dirty guard, truncation guard, refresh restore, 6×3 overflow matrix).
  Run each suite against a **fresh** service: the kernel allows 4 worker slots and reloads
  consume them.
- `cargo test` in `shell/` — 31/31 (ConPTY echo round-trip and resize/kill, the PTY
  degradation report, the pipe fallback running the requested shell, codecs, `resolve` escape,
  `glob_match`, `skip`, `proc.exec` stdout+stderr and timeout).

## Known limits of this first pass

- `run.stop` writes `\u0003` to terminal instance 0. A ConPTY session turns that into a
  Ctrl+C; the piped fallback cannot deliver signals, so a running task there keeps going
  until it exits.
- No filesystem watcher: `fs.changed` fires after our own ops; external edits need Refresh.
- No `.gitignore` support in search/index; only a fixed `skip()` list (build dirs,
  `node_modules`, `.git`, `.pristem`).
- The demo provider is scripted/offline; answers are representative, not model-generated.
- Window dragging uses `window.drag` → `tao::Window::drag_window` with decorations off.
- CLI client deliberately **not** built (explicitly a later phase).

## Verification hooks

`window.__pristemDormantCheck()` returns `true` only when no `[data-ai="true"]` element is
in the DOM. The app also logs a warning if any AI element is ever rendered while dormant.
