# AGENTS.md — pristem

Guidance for coding agents working in this repository. Read this before touching code. For agent and won't be check by user.

## Finder
D:\projects\pristem\FINDER.md is the finder of this codebase, for new sections to quickly know about pristem's code structure. Old sections should always update it after changing codebase structure.

## What this is

`pristem` is a desktop agent client. The name "Pristem" is the combination of prism and system.
One Rust process owns everything:

```
pristem-desktop/shell   native tao/wry window + HTTP/SSE transport + shell-owned IO
pristem-desktop/ui      React/Monaco/xterm renderer (rendering only, no build-time bridge)
pristem-kernel          kernel crates (modes, agent loop, providers, IPC types)
```

- Mode semantics are **kernel-owned**. The UI sends `switch_mode` and only re-renders on `mode_changed`.
- Files, terminal and git go through the shell-owned `io` channel (`POST /api/io`), never the kernel.
- `pristem.cmd` is the single entry point (`build`, `serve`, `help`).

## Build, test, run

Run every command from the directory named below.

```bash
# renderer (tsc --noEmit + vite)
cd pristem-desktop/ui && pnpm build

# shell — MUST run from shell/, not with --manifest-path from the repo root:
# shell/.cargo/config.toml supplies the locally generated advapi32 import lib.
cd pristem-desktop/shell && cargo build && cargo test
```

Headless service for E2E (port 8787):

```bash
pristem.cmd serve
# or: pristem-desktop/shell/target/debug/pristem-desktop.exe --no-window
```

E2E suites (Playwright + Edge, `playwright-core` lives in `pristem-desktop/.visual-check`):

| suite | checks |
|---|---|
| `.visual-check/check.cjs` | 218 — modes, layout, narrow window, project-column chrome, terminal, menu bar, tasks, settings, guide, IDE invariants |
| `.visual-check/_git-selfcheck.cjs` | 12 — staging, unstaging, staged-only commit, diff colouring, discard |
| `.visual-check/_effects-selfcheck.cjs` | 35 — motion, empty states, icon behaviour |
| `.visual-check/_explorer-selfcheck.cjs` | 23 — depth, context menu, trash, keyboard nav, clipboard |
| `.visual-check/_search-selfcheck.cjs` | 19 — recursive search/replace, quick open |
| `.visual-check/_phase4-selfcheck.cjs` | 14 — split editor, dirty/truncation guards, persistence, matrix |
| `.visual-check/_terminal-selfcheck.cjs` | 6 — independent cwd, Ctrl+C, kill |
| `.visual-check/_desktop-selfcheck.cjs` | 5 — real WebView2 over CDP: UI renders, session toggle opens, native folder dialog appears and cancels |
| `pristem-desktop/scripts/smoke.mjs` | 15 — protocol/kernel round-trip |

Every suite needs a **fresh** service: the kernel allows 4 worker slots and page reloads consume
them. Give each run its own port and point the suite at it — never at the desktop instance's
8787:

```powershell
$svc = Start-Process pristem-desktop/shell/target/debug/pristem-desktop.exe -ArgumentList '--no-window','--port','8790' -PassThru
$env:PR_URL = 'http://127.0.0.1:8790/'
node pristem-desktop/.visual-check/check.cjs
Stop-Process -Id $svc.Id
```

**Drive the UI, not the kernel.** A suite proves what a user can do, so it must open and close
things through visible controls (simulated clicks, typing, shortcuts). `fetch('/api/request', …)`
(`open_session`, `close_session`, `switch_mode`, …) is reserved for the protocol smoke test and
for the pages that mock the whole stream; never use it to reach a state the UI is supposed to
reach, because a control that only works through the kernel is not working. The same rule caught
the titlebar drag swallowing the session toggle's click: the DOM click passed, the real window
drag did not. When a test needs a new session, click `+`/`会话`; when it needs to close one,
click the card's close button.

**The desktop suite proves the real thing.** `_desktop-selfcheck.cjs` launches the windowed app
with `PR_DEBUG_PORT`, attaches to the actual WebView2 over CDP, clicks the real controls, and
detects the native folder dialog through Win32. It is the only suite that can prove native
dialogs and window-drag behaviour; the headless suites prove the fallback branch
(`pickFolder: false`). A test that only asserts the headless branch must not be the only evidence
for a feature the desktop exposes.

## Invariants (do not break)

- Six-mode matrix and the kernel's transition table.
- One mode switcher only: the titlebar button (`TitleBar` renders the menu). The composer has
  no mode chip and the status bar has no mode button; `F2` and the palette still switch modes.
- The titlebar behaves like Windows chrome: drag starts only after the pointer moves 4px
  (never on mousedown), buttons/inputs are excluded, and a double-click on the bar toggles
  maximize/restore. Starting the native move loop on mousedown swallows clicks and
  double-clicks — that is how the session toggle once stopped opening.
- Sessions are a column (`SessionPanel`): beside the conversation in coding/helping, and the
  right column of the goal view. Opening it adds `--sessions-w`; when the AI panel is present it
  also grows `--right-w` by `--ai-grow`, so the conversation panel takes a little of the editor's
  width instead of losing the whole session column. Advisor, IDE and deepsleep have no session
  surface — advisor has no model conversation at all.
- IDE mode renders **zero** `[data-ai="true"]` elements.
- Chrome status is a **labelled block**, never a colour-only dot: the session toggle and the
  run-state pill each carry text that changes with the state. The transport badge renders
  **only when it is not healthy** (connecting / offline / demo) — a working connection adds no
  copy, because "kernel connected" is noise. No `.conn-dot`, `.session-switcher .tab-dot` or
  `.running-pill i`.
- `@`/`Shift+@+F1` summon contract; exactly one window-level keydown listener in `App.tsx`.
- Delete means move to `.pristem/trash` (never unlink).
- No new npm dependencies. Rust deps only what `shell/Cargo.lock` already contains.
- Every new i18n key lands in **both** dictionaries in `ui/src/i18n.ts`.
- Code comments in English, no comment noise. Intentional shortcuts get a `ponytail:` comment
  naming the ceiling.
- Static L2 checks must stay green: no `.title-menus` / `.title-menu-btn`, no hard-coded
  protocol literal in `ui/src`, terminal `instance` stays a number.

## Workspace / filesystem facts

- `fs.pickFolder` is a **real native folder dialog** (`rfd`, already a dependency). `--no-window`
  has no dialog and reports `capabilities.pickFolder = false`; the UI then shows the paste-path
  dialog. Never alias the picker to `fs.openFolder`: returning the current root looked like the
  button "entered" the same folder, and the false capability hid the fallback.
- `fs.pickFolder { select: true }` returns `path` without switching the workspace — that is how
  "new project" gets a parent folder. `fs.newProject { parent }` scaffolds
  `<parent>/pristem-project(-n)` with a README and returns the created path.
- `resolve()` rejects an **empty root**; a relative write without a workspace must fail, never
  fall back to the process cwd (the app's own folder).
- `noWorkspace` means `root === ''`. An opened but empty folder is still a workspace; the tree
  root shows "未打开文件夹" when there is none.
- The **windowed** app reopens the workspace it last had (`%APPDATA%\pristem\workspace.txt`, the
  VS Code habit) and starts on the welcome screen when there is none. It must **never** fall back
  to the app's own source folder — a forced workspace over the user's project is the bug this
  rule exists to prevent. Headless (`--no-window`) runs deliberately use the repository root so
  the suites keep deterministic relative paths, and they never write the store.
- A folder that was moved or deleted must not resurrect as a broken root: `read_workspace`
  returns `None` unless the path still is a directory.

## Terminal facts
- Windows uses ConPTY (`shell/src/term.rs`). The spawn waits for the **first paint within 2.5 s**;
  a shell that never paints is killed, retried once as `cmd.exe` (1.5 s), then served by the piped
  fallback. `SetErrorMode` at startup suppresses any system error dialog. A shell that dies
  *inside* a pseudoconsole is skipped for the PTY path only — the pipe fallback still runs it, so
  the user's shell choice survives the degradation.
- The old **1.2 s** first-paint budget was too short: PowerShell paints in ~0.4 s on a healthy
  machine, but a slower start was misread as "no PTY" and demoted the session to the pipe
  fallback — which cost the user colors, the local echo and their shell. A budget that misreads a
  working PTY is worse than a slow start.
- The pseudoconsole is **not** nudged with an Enter on start. conhost paints the first frame on
  its own; the nudge (sent only if nothing painted within 1 s) is for older builds that wait for
  input. Nudging unconditionally printed a **second prompt** in every session.
- Two spawn details are load-bearing, both edit `term.rs` only:
  - `UpdateProcThreadAttribute(PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, …)` takes the **HPCON value**.
    Passing `&hpc` (its address) makes every shell die in console init with `0xC0000142`; the
    first-paint probe then degrades to a pipe. If a terminal reports `0xC0000142` for *every*
    shell, check this first.
  - The child is created with `STARTF_USESTDHANDLES` and null std handles. Without it, a host
    whose own stdio is redirected (a pipe, a log file, `cargo test`) has those handles copied
    into the shell, so the tab paints blank and typing goes nowhere while the shell writes into
    the host's stdout. Never diagnose that as "ConPTY unavailable".
- `term.open` returns `kind: "pty" | "pipe"` plus the real `shell`/`path` and a `note` that
  explains any degradation. The UI shows the note and marks a pipe session with a dot on its tab.
- xterm only changes columns through `fit()`; the terminal host is measured by a
  `ResizeObserver`, so window, separator and session-column changes reach `term.resize`. Without
  it the shell stayed at the first 80×24 measurement and long output wrapped early.
- `+` in the terminal strip adds a tab with the saved `shellProfile`; the arrow beside it opens
  a shell menu (`auto` / `pwsh` / `powershell` / `cmd`) and applies that choice to the new tab
  only — it never rewrites the setting.
- **Ctrl+C is `term.interrupt`**, not a `0x03` byte: it terminates the shell's descendants and
  keeps the shell and its cwd. xterm intercepts Ctrl+C (no selection) and calls it; `run.stop`
  uses the same op.
- The pipe fallback is a *degraded but usable* terminal, not a broken one:
  - The **host echoes the keystrokes** — a pipe has no console to do it.
  - The **requested shell is honoured**: `cmd.exe` speaks the OEM code page (GBK here) in both
    directions; PowerShell is hosted through a generated UTF-8 REPL bootstrap
    (`%APPDATA%\pristem\terminal\repl.ps1`), because its own redirected-stdin reader prefixes
    every line with `U+FEFF` and then rejects every command.
  - `TERM`/`COLORTERM`/`GIT_CONFIG_*` are set so tools still colorize; the shell's own colors
    need a real console (PowerShell 7 gets them through `$PSStyle.OutputRendering`).
- In restrictive job objects (automation sandboxes) ConPTY is unavailable and everything runs
  through this fallback; a desktop launch gets real ConPTY. `shell.capabilities` reports what the
  shell *knows* — it never probes on demand, because the probe costs seconds on a machine
  without ConPTY.

## Source control / editor facts

- `proc.exec` accepts either a command string (run through the shell) or `command` + `args`
  (run directly, no shell). The git panel always uses `args`: paths and commit messages must
  never be parsed by `cmd.exe`. The old string form stripped `"`, `` ` `` and `$` from commit
  messages — a silent edit of the user's text.
- The git panel groups staged and worktree changes, commits **only staged** content, and asks
  twice before discarding. Untracked and staged-new files are discarded through `.pristem/trash`,
  never unlinked. Refreshes keep the previous rows visible (no loading blank).
- Editor navigation is Monaco's own: F12 definition, Shift+F12 references, Alt+F12 peek,
  Ctrl+Shift+L occurrences, fold/unfold all. Rename is **Shift+F6** because `F2` is the app's
  mode switcher.
- `Ctrl+Shift+T` reopens the newest of the last 20 closed editors. Tabs reorder by drag within
  a group; the Explorer lists open editors above the tree.
- `Ctrl+=` / `Ctrl+-` / `Ctrl+0` zoom the editor by rewriting `editorFontSize` (8–32). Format
  on save runs Monaco's `editor.action.formatDocument` before writing the buffer.

## Where things live

| area | file |
|---|---|
| commands + menu layout (single table for palette and menu bar) | `ui/src/commands.ts` |
| task detection / Run menu | `ui/src/tasks.ts` |
| workspace UI: tree, editor panes, terminal | `ui/src/workspace.tsx` |
| app shell, layout, persistence wiring | `ui/src/App.tsx`, `ui/src/workspaceState.ts` |
| shared Monaco models | `ui/src/editorModels.ts` |
| panels (search, git, output, problems) | `ui/src/components/Panels.tsx` |
| shell IO ops | `shell/src/io.rs` |
| terminal registry | `shell/src/term.rs` |
| HTTP/SSE | `shell/src/server.rs` |

Design/behaviour docs: `DESIGN_SYSTEM.md` (appendix A′ lists the 2026-11 token pass),
`UX_SPEC.md` (§8.5 is the 760–1040px degradation table), `BUILD_NOTES.md`,
`bug_log_optimize.md` (deferred issues and known limits). A repository-wide file map for new
sections lives at `FINDER.md` in the repo root.

## Narrow window (760–1040px)
- Minimum inner size is **760×560** (`shell/src/main.rs`). The layout is not a mobile design;
  only the column form changes: ≤1040 the console column is capped at 320px, ≤880 it leaves the
  grid and covers the work area right of the tree (`grid-area: auto` + `left: var(--left-w)`),
  the titlebar search capsule collapses to its lens (focus expands it) and the session chip hides.
- The cap only changes `--right-w`; the user's saved width is never rewritten. No horizontal
  page scroll at 760/880/1040/1440 — `check.cjs` asserts the narrow rules.
- An absolutely positioned grid child is positioned against its **grid area**; that is why the
  overlay sets `grid-area: auto` before `left/right`. Without it the panel collapses to 1px.
