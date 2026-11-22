# Task plan — IDE experience gaps + model settings

## Goal

Finish pristem as a polished, reliable desktop client. Reconcile both 2026-11-16
hand-offs, close the remaining UI/usability gaps, complete only missing functionality
that is already supported by the existing architecture, and keep total process memory
below 1 GB. System prompts and the still-designed overall section functionality are
explicitly out of scope. Every phase ends green: `cargo test`, `pnpm build`, targeted
runtime checks, and the `.visual-check` suites on a fresh service.

## Phase 1 — Terminal input, copy/paste, focus  [complete]

See `progress.md` session 2. Gates: `check.cjs` 122/122, `_terminal-selfcheck.cjs` 6/6.

## Phase 2 — Remaining terminal/layout gaps  [complete]

`Ctrl+\`` toggle, terminal `clear`, `term.new` restored.

## Phase 3 — Settings + model management  [complete]

Owner-reported issues (2026-11-15):

1. "密钥已就绪" shown although no key was typed — demo mode injects a stub key into
   every endpoint, and the UI reads kernel `key_present`. Fix: the shell reports
   `demo` from its own bootstrap state and the settings list shows real key sources.
2. "模型与连接" is full of dead rows (`传输状态`, disabled `重新连接`, static BYOK) and a
   long provider table. Rebuild as a compact model manager:
   - current model card, status chip (live / offline demo / no key)
   - endpoint rows: id, adapter · model, base URL, key pill, switch / delete
   - "添加模型" opens a provider picker (Trae-style grid) then a form
     (API format, base URL, model id, display name, API key, show/hide)
   - keys are DPAPI-encrypted at `%APPDATA%\pristem\model-keys.bin`; endpoints live in
     `%APPDATA%\pristem\models.json`; the shell merges both into the kernel config at
     bootstrap. Changes take effect after restart (banner states this).
3. Editor font size / Tab width become number inputs with VSCode-like limits, not
   fixed segmented choices (base font too).
4. Delete the static AI seed suggestions ("解释这个文件 / 找出潜在缺陷 / 写一个测试").
   Audit neighbouring settings/AI rows for the same static-dead pattern.
5. Menu bar visible in every mode (was IDE-only); update the `5a` regression assertion.

## Phase 4 — Editor/terminal quick wins (G5/G6/G7/G14/G15)  [complete]

- G5 format document + organize imports (Monaco built-ins via the command table).
- G6 tab-overflow dropdown when `.editor-tabs` scrolls.
- G7 `Ctrl+Tab` / `Ctrl+Shift+Tab` cycle editor tabs.
- G14 help shortcut table catches up with the real key map.
- G15 terminal scroll-to-bottom affordance.

## Phase 5 — File operations (G1/G2)  [complete]

- Drag-and-drop move in the explorer (`fs.rename`, optimistic tree update).
- Copy / cut / paste of files and folders (internal path clipboard + `fs.rename`).

## Phase 6 — Search enhancements (G3/G4)  [complete]

- Replace preview: per-file counts before applying.
- Scope filters: current file / open editors.

## Phase 7 — External filesystem watcher (G9)  [complete]

The implemented bounded 1.5 s polling watcher emits `fs.changed`; the tree and clean
open buffers refresh without a manual reload. Dirty buffers remain protected.

## Phase 8 — Current-build baseline and regression repair  [complete]

- Build renderer and shell; run Rust unit tests.
- Run every E2E suite against a fresh service owned by this session.
- Fix reproducible regressions at their shared root; do not weaken assertions.
- Record actual counts and the explorer inert/ConPTY outcomes.

## Phase 9 — UI reliability and interaction contract  [complete]

- Fix i18n fallback and missing deepsleep hint.
- Make failed mode switching recoverable without reload; retain kernel-owned semantics.
- Correct confirmed wake/sleep empty states, separators, pending/status duplication,
  connection recovery, and mode-gated shortcut gaps.
- Add focused regression assertions for each non-trivial fix.

## Phase 10 — Visual finishing and responsive polish  [complete]

- Use `DESIGN_SYSTEM.md`, `UX_SPEC.md`, and existing ModelSettings/command palette/editor
  interactions as references; do not invent a second visual language.
- Improve left-rail legibility, titlebar/settings/toast layout, deepsleep calmness,
  spacing, motion, and narrow-window behavior with low-density changes.
- Preserve six-mode spatial honesty and IDE's zero-AI-element invariant.

## Phase 11 — Missing-function audit and memory acceptance  [complete]

- Audit visible controls and primary flows for dead ends; implement only gaps supported
  by existing shell/kernel capabilities and not explicitly deferred.
- Measure renderer + shell + child process working set during representative workloads;
  optimize actual hotspots if the total approaches/exceeds 1 GB.
- Finish with the complete build/test matrix and update all planning/hand-off state.
- Final gates passed: renderer build; shell build + 16/16 Rust tests; main 160/160;
  effects 35/35; explorer 23/23; search 19/19; phase 4 14/14; terminal 6/6; protocol 15/15.

## Phase 12 — Model provider depth, first-run guide, settings navigation  [complete]

Owner hands-on review (2026-11-17, native window) confirmed:

- Add-model picker is taller than the window; its header and first presets are clipped
  above the viewport.
- The dialog surface lets the settings page show through (banner, rows, buttons).
- Nav highlight and visible section desynchronise: opening the form jumped the page back
  to `外观与动态` while `模型与连接` stayed highlighted.
- Built-in endpoints repeat raw adapter ids (`openai-chat openai-chat`) and the list reads
  as disabled; Anthropic has no default URL while placeholders still say `deepseek-chat`.
- No Google/xAI/Mistral/Groq/Ollama presets, no first-run guide, recent-project rows look
  like plain text.

Scope decided by the owner:

1. Full kernel support for per-endpoint temperature, output token ceiling, Top P,
   reasoning effort (parameter name + value), context-window trimming, tool-round cap and
   an image-input capability flag.
2. A full-screen first-run guide for choosing a workspace and adding a provider key, shown
   only until it is completed.
3. Fix modal clipping/translucency, provider naming, presets, and settings scroll-spy.

Implemented:

- Kernel `EndpointTuning` (Top P, reasoning parameter + value, context window, tool-round
  cap, image flag) on `ProviderEndpoint` / `ProviderConfig`; provider trait exposes
  `temperature()` and `tuning()`; the loop trims history to the context budget, honours the
  per-endpoint temperature and tool-round cap, and both OpenAI adapters send Top P and
  reasoning (`reasoning_effort` for chat, `reasoning.effort` for Responses).
- Shell catalogue persists the same fields, validates bounded numbers and safe parameter
  names, merges on partial edits (the key-only dialog no longer wipes tuning), and reports
  them to the UI.
- Renderer: 25 provider presets (OpenAI, Anthropic, Google, xAI, Mistral, Groq, OpenRouter,
  DeepSeek, Together, Perplexity, Fireworks, Cerebras, Ollama, LM Studio, CN providers),
  advanced parameter block, product names in the list, opaque scrollable dialogs, and a
  first-run guide shown only until completed.
- Settings nav is a real scroll position (instant jump + scroll-spy) and recent workspaces
  are rows with an explicit remove action instead of a click-to-delete row.
- Root cause of the clipped dialog: `.settings-page` kept a `transform` from its entrance
  animation (`fill-mode: both`), making it the containing block for fixed dialogs.
- Suite isolation: `--port` for the shell and `PR_URL` for every suite, so an open desktop
  instance on 8787 no longer absorbs test sessions.

Verification: main 171/171, effects 35/35, explorer 23/23, search 19/19, phase 4 14/14,
terminal 6/6, protocol 15/15, Rust kernel and shell tests green.

## Phase 13 — Composer bar (workspace · permission · mode · model · @ / /)  [complete]

Reference: the owner's Trae-style input bar. Implemented in the AI composer:

- `+` inserts an `@` file mention and opens the workspace file list.
- `@` opens a file mention picker (name, path, "file" badge); Enter/Tab picks, arrows move.
- `/` opens the real command list (`/goal`, mode switches, `/resume`, `/pause`, `/wake`).
- Workspace chip: current folder, native folder picker and recent workspaces.
- Permission chip: ask / automatic / unrestricted, persisted locally. The approval gateway
  is not enforced by the kernel yet and the menu says so.
- Mode chip: IDE (tagged "no AI"), deepsleep, helping, advisor, coding. Goal is entered with
  `/goal`; a disabled Plan placeholder documents the intended design.
- Model chip: live endpoint switch through `set_provider`; the provider list is prefetched at
  session start so the menu is never empty.

Deferred here: kernel-enforced edit approval, the Plan mode itself, and live registration of
newly added endpoints (the registry is built at bootstrap; switching existing ones is live).

## Phase 14 — Native window chrome fidelity  [complete]

- The maximize control never changed state: a maximized window still showed the single
  square. The shell now pushes `pristem:window-state` (maximize toggle + resized transitions)
  and the titlebar renders the Windows restore glyph with a matching aria-label.
- Gate: main suite 182/182, including both glyph states.

## Phase 15 — Overlay overflow audit + redundancy cleanup  [complete]

- Swept every popover/dialog at 1024×683. Command palette and task picker were pushed off the
  right edge because their `pop-in` animation replaced the centring transform; both now use
  auto margins. Composer menus anchor to the composer's right edge instead of each chip.
- Removed redundant rows: no "密钥已保存" on usable models, no protocol id/adapter name on
  built-in settings rows; key badges appear only for actionable states.
- Suppressed Monaco's exact "Canceled" rejection on model disposal (root cause of the
  intermittent explorer noise).
- Gates: main 186/186, effects 35/35, explorer 23/23 ×3, search 19/19, phase 4 14/14,
  terminal 6/6, protocol 15/15.

## Phase 16 — AI panel floor, summon chord, editor caret  [complete]

- Right column is clamped in state and in CSS (300–560); the composer wraps instead of
  overflowing at the floor.
- The AI panel empty state no longer advertises the summon chord; it documents `@` and `/`.
- Summon is order-independent (Shift+F1, or F1 shortly after `@`) and gives feedback when the
  current mode already has a composer.
- Monaco re-measures fonts once webfonts are ready, so a click at a line end lands at the end.
- Gates: main 191/191, effects 35/35, explorer 23/23, search 19/19, phase 4 14/14,
  terminal 6/6, protocol 15/15.

## Phase 22 — terminal columns follow the pane  [complete]

- xterm only re-measures when `fit()` runs; it ran once at mount, so the PTY stayed near
  the first 80×24 measurement and long output (cargo warnings, build logs) wrapped early no
  matter how wide the window or the terminal pane became.
- One `ResizeObserver` per terminal host now calls `fit()` on any host resize (window,
  separator, session column open/close); it disconnects on tab close and on unmount.
- Regression: `terminal: the PTY follows the pane width` listens for `term.resize` at
  1024×683 then 1440×900 and asserts `wide > narrow` (52 → 110 columns).
- Gates: main 201/201.

## Phase 21 — prove the desktop, not the branch  [complete]

- Tests no longer stop at the headless branch: `_desktop-selfcheck.cjs` launches the windowed
  app with `PR_DEBUG_PORT`, drives the real WebView2 over CDP, clicks the session toggle, and
  detects the native folder dialog through Win32 before cancelling it.
- `AGENTS.md` records the rule that a headless-only assertion is not evidence for a feature the
  desktop exposes.
- Gates: desktop 5/5, main 200/200, shell 33/33.

## Phase 20 — native folder picker + honest workspace states  [complete]

- `fs.pickFolder` was aliased to `fs.openFolder` (returned the current root, claimed the capability)
  so "open folder" never showed a dialog; it now uses the native `rfd` picker, supports
  `select: true` for a parent-only pick, and reports `pickFolder: false` under `--no-window`.
- "New project" scaffolds `<picked parent>/pristem-project(-n)` via `fs.newProject` and opens it;
  it is hidden when no native picker exists.
- `resolve()` rejects an empty root; `noWorkspace` means `root === ''`; the tree root says
  "未打开文件夹" instead of "WORKSPACE".
- Gates: shell 33/33, main 200/200, effects 35/35, phase 4 14/14.

## Phase 19 — click, don't drag; test through the UI  [complete]

- The titlebar started the native move loop on every mousedown, swallowing clicks and
  double-clicks: controls inside it (the session toggle) could not open, and double-click could
  never maximize. Drag now starts only after 4px of pointer travel, interactive targets are
  excluded, and a double-click on the bar toggles maximize/restore.
- Regressions: plain click sends no `window.drag`, a 40px drag sends exactly one, a double-click
  sends `window.maximize` and no drag.
- Session cleanup in the suites now clicks the panel's close buttons instead of posting
  `close_session`; `AGENTS.md` records the rule that E2E drives visible controls, with kernel
  requests reserved for the protocol smoke test and mocked streams.
- Gates: main 198/198.

## Phase 18 — one mode switcher + session panel  [complete]

- The titlebar button is the only mode switcher; the mode menu moved into `TitleBar`, the
  composer chip and the status-bar button are gone. Status bar keeps session label, connection,
  protocol, language.
- Sessions are a panel column: coding (beside the right AI panel), helping (right edge) and goal
  (full-height column next to the goal chat; its old history chip is gone). Advisor, IDE and
  deepsleep have no session surface because they have no model conversation. Header bar with
  count, search, new and collapse; cards carry status + time; the active card uses the spectrum
  accent.
- The panel takes `--sessions-w: 232px` and, when an AI panel is present, grows the AI column by
  `--ai-grow`, so the conversation panel takes a little of the editor rather than losing the
  full panel width.
- Gates: main 194/194, effects 35/35, phase 4 14/14.

## Phase 17 — ConPTY actually activates  [complete]

- Root causes: the pseudoconsole attribute was handed the HPCON's address instead of its value
  (every shell died with `0xC0000142`), and the child was created without
  `STARTF_USESTDHANDLES`, so a host with redirected stdio leaked its handles into the shell
  (blank tab, invisible typing).
- `term.open` now returns `kind: "pty"` with PowerShell under `auto`; typing echoes with color.
- One terminal test was replaced by two honest ones (PTY degradation report, pipe fallback runs
  the requested shell).
- The arrow beside `+` opens a shell menu for the next tab (auto / pwsh / powershell / cmd)
  without rewriting the saved setting; the main suite checks the menu and the resulting tab.
- Gates: shell 31/31, main 192/192, terminal 6/6, effects 35/35, explorer 23/23, search 19/19,
  phase 4 14/14.

## Phase 23 — VS Code / JetBrains parity gaps  [complete]

Owner request (2026-11-20): compare pristem with the public VS Code and JetBrains
feature surface and add what is missing. Gap matrix in `findings.md`.

Scope (whole features, no stubs):

1. Git panel parity — staged / unstaged / untracked groups, per-file stage, unstage,
   discard, stage-all, unstage-all, commit only what is staged, coloured diff, action
   errors. Shell `proc.exec` gains an argument-array form so git never goes through
   `cmd /C` (this also removes the silent commit-message sanitation bug).
2. Editor navigation and refactor commands — Go to Definition, Find References,
   Peek Definition, Rename Symbol, Select All Occurrences, Fold/Unfold All, wired to
   Monaco's own actions and exposed in the Edit menu and palette.
3. Tabs — Reopen Closed Editor (Ctrl+Shift+T, bounded stack) and drag-to-reorder.
4. Editor preferences — Format on Save toggle and keyboard zoom (Ctrl+= / Ctrl+- /
   Ctrl+0), applied live to the current Monaco instance.
5. Explorer — Open Editors section above the tree (dirty dots, activate, close).

Deferred with reasons (recorded in `bug_log_optimize.md`): terminal split panes,
terminal scrollback search, zen mode, search history, TODO/bookmarks panels,
local history, Git push/pull/stash/branch switching, preview and pinned tabs,
per-hunk staging.

Delivered:
- Shell `proc.exec` argument form; the git panel no longer goes through `cmd.exe` (it also
  stopped silently deleting `"`, `` ` `` and `$` from commit messages).
- Git panel: staged / changes groups, per-file stage and unstage, stage-all / unstage-all,
  two-step discard (untracked and staged-new go to trash), staged-only commit, coloured diff,
  visible action errors, no blanking refresh.
- Edit menu + palette: go to definition (F12), references (Shift+F12), peek (Alt+F12),
  rename (Shift+F6), select all occurrences, fold/unfold all — all Monaco actions.
- Reopen closed editor (`Ctrl+Shift+T`, 20 entries), tab drag reordering.
- Format on save (setting) and editor zoom (`Ctrl+=` / `Ctrl+-` / `Ctrl+0`).
- Explorer "Open Editors" section above the tree.

Gates: renderer build; shell 39/39; main 218/218; git 12/12; effects 35/35;
explorer 23/23; search 19/19; phase 4 14/14; terminal 6/6; protocol 15/15.

## Deferred / owner decisions

- G11 terminal profiles: the per-tab shell picker covers shell choice; custom profiles
  (env vars, extra args) remain deferred. G13 git write ops (owner deferred).
- G10 `.gitignore` search support (needs an ignore parser).
- G12 multi-line paste warning (annoyance > value).

## Decisions

- Clipboard is a shell capability, not a browser permission.
- `Ctrl+C` never sends 0x03; it interrupts the shell's children and keeps cwd.
- Model keys never leave the user profile in plaintext: DPAPI (CurrentUser) blob;
  the kernel receives the key only in memory at bootstrap. The UI only ever receives
  `key_present`, never key material.
- Custom model endpoints are app-level (`%APPDATA%\pristem\models.json`), not written
  into the repository's `pristem-kernel/config/kernel.json`.
- No new npm dependencies; Rust uses only crates already in `Cargo.lock`
  (plus `windows-sys` features, which add no download).

## Errors encountered

| error | tries | resolution |
|---|---|---|
| `-ladvapi32` link failure | 1 | build from `shell/` so `.cargo/config.toml` finds `native-lib/libadvapi32.a` |
| empty Windows Terminal window on the desktop | 2 | ConPTY spawn left `CREATE_NO_WINDOW` off the PTY path (see Phase 17) |
| every shell `0xC0000142` / never a PTY | 4 | HPCON was passed by address, not by value (Phase 17); then `STARTF_USESTDHANDLES` was missing for hosts with redirected stdio |
| `Ctrl+C` did nothing in the PTY | 2 | not a signal path on this build → `term.interrupt` |
| `kind: "pipe"` in automation | 2 | sandbox job object blocks conhost; pipe fallback is expected there |
| planning catch-up script missing | 1 | recovered from repository planning files and both hand-offs |
| large phase-status edit did not match | 1 | switched to smaller exact edits after re-reading current plan |
| inline Node visual-capture quoting failed | 1 | moved the throwaway capture script to the temp directory |
| temp capture could not resolve `playwright-core` | 1 | used the existing `.visual-check/node_modules` absolute module path |
| direct headless exe initially exited before listening | 1 | required runtime DLLs were present and a later direct launch worked; exact initial cause unproven |
| Advisor menu row was disabled during one main-suite run | 1 | added a same-mode regression and reran; failure did not reproduce, full suite passed 160/160 without a speculative fix |
| native memory workload initially found no visible Monaco editor | 2 | the native profile had no open editor; open a tree file before measuring the loaded workspace |
| memory sampler rejected a blank `Start-Process.ExitCode` after successful workload output | 1 | preserve the sampled measurements and judge the workload by its emitted result instead of the unavailable property |
| final effects run failed search empty-state and deepsleep ambient checks | 1 | main passed 160/160; updated stale rail selectors and aligned ambient assertion with the one-loop design contract |
| corrected effects run still missed the empty-icon synthetic hover | 1 | used Playwright's visibility-aware `hover()` with the same tilt assertion; effects passed 35/35 |
| git status/diff unavailable in the workspace | 1 | this checkout has no `.git` metadata; use current-source inspection and runtime evidence |
| bug log was not at the repository-root path | 1 | found and updated `pristem-desktop/bug_log_optimize.md` |
| headless suites silently attached to the owner's desktop app on 8787 | 2 | added `--port` to the shell and `PR_URL` to every suite; isolated instances now own their port |
| add-model dialog opened at y=-549 when the settings page was scrolled | 1 | `.settings-page` retained a transform from `empty-part` (`fill-mode: both`), making it the fixed-dialog containing block; switched to `backwards` and made nav jumps instant |
| scroll-spy missed the last section at the page bottom | 1 | at-bottom check selects the last rendered section |
| new shell binary in a temp target exited immediately | 1 | copied the staged Rust runtime DLLs (`libunwind.dll`, `std-*.dll`) next to it |
