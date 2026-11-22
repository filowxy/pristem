# Progress log

## 2026-11-21 · healthy status is silent

- The status bar announced "内核已连接" on every frame. A working transport is the default, not
  news; the label is gone (key removed from both dictionaries).
- `ConnectionBadge` now renders only the exceptions — connecting, offline with retry, offline
  fixture. Retry still proves itself by the offline badge disappearing.
- Contract updated in `AGENTS.md`; the main suite asserts a healthy connection adds no copy
  (218/218).

## 2026-11-20 · VS Code / JetBrains parity pass

- Source control is no longer read-only: staged and worktree groups, per-file stage/unstage,
  stage/unstage all, two-step discard (untracked and staged-new go to `.pristem/trash`),
  staged-only commit, coloured diff and visible action errors. Refreshes keep the old rows
  instead of blanking the panel.
- `proc.exec` gained a `command` + `args` form and the git panel always uses it: git no longer
  runs through `cmd.exe`, and the old sanitizer that deleted `"`, backticks and `$` from commit
  messages is gone. `_git-selfcheck.cjs` commits `fix: keep "quotes" and $HOME` and compares
  `git log -1 --format=%s`.
- Editor navigation is exposed, not reimplemented: F12 definition, Shift+F12 references,
  Alt+F12 peek, Shift+F6 rename (F2 stays the mode switcher), Ctrl+Shift+L occurrences and
  fold/unfold all, in the Edit menu and palette.
- Ctrl+Shift+T reopens the last closed editor (bounded stack of 20); tabs reorder by drag;
  the explorer lists open editors above the tree.
- Ctrl+= / Ctrl+- / Ctrl+0 zoom the editor and persist `editorFontSize`; format on save runs
  Monaco's formatter before writing. Both have settings rows.
- New suite `_git-selfcheck.cjs` creates a temp repository, opens it through the visible folder
  control and drives stage → unstage → stage-all → commit → diff → discard.
- Gates: renderer build; shell 39/39; main 218/218; git 12/12; effects 35/35; explorer 23/23;
  search 19/19; phase 4 14/14; terminal 6/6; protocol 15/15.
- One explorer run reported 22/23 because `__p2__` fixtures from the previous run were still
  present; the immediate rerun on the same build passed 23/23 without a production change.

## 2026-11-18 · the terminal follows the pane width

- xterm was measured once at mount; nothing re-ran `fit()` on window or panel resizes, so the
  PTY stayed at the first ~80×24 size and long lines wrapped early even in a wider window.
- The terminal host now has a `ResizeObserver` (one per session, disconnected on close/unmount)
  that re-fits, so `term.resize` reaches the shell on every layout change.
- Regression: `terminal: the PTY follows the pane width` — 1024 → 1440 sends `term.resize`
  growing from 52 to 110 columns. Main 201/201.

## 2026-11-18 · a desktop suite that proves the real UI

- The headless suites asserted the branch the test environment happened to take (`pickFolder:
  false`), so the native picker and window-drag behaviour had no real evidence.
- New `_desktop-selfcheck.cjs` launches the windowed binary with `PR_DEBUG_PORT`, attaches to the
  actual WebView2 over CDP, clicks the real controls, and finds the native folder dialog through
  Win32 (`#32770`, caption "打开文件夹"), then cancels it with `WM_CLOSE`.
- It proves: the window renders, the session toggle opens the panel in the real webview, the
  native folder dialog appears, and cancelling keeps the workspace unchanged. 5/5.
- The shell only opens the CDP port when `PR_DEBUG_PORT` is set; normal launches keep it closed.

## 2026-11-18 · real folder picker, real new project, no cwd fallback

- `fs.pickFolder` was an alias of `fs.openFolder`: with no path it returned the current root, so
  "open folder" silently reopened the app's own folder and never showed a dialog. `capabilities`
  still claimed `pickFolder: true`, so the paste-path fallback never appeared.
- The op is now a real native dialog (`rfd`, already a dependency): cancel → `cancelled`, choose →
  that folder becomes the workspace; `select: true` returns a path without switching. Headless
  (`--no-window`) reports `pickFolder: false` and the UI opens the paste-path dialog instead.
- "New project" no longer builds `${root}/pristem-project` (which became `/pristem-project` when
  there was no workspace): it picks a parent through the native dialog, scaffolds
  `<parent>/pristem-project(-n)` with a README, and opens the created path. The action is hidden
  when the shell has no picker.
- Generalised: `resolve()` refuses an empty root (relative writes no longer land in the process
  cwd), `noWorkspace` means `root === ''` (an empty folder is still a workspace), and the tree
  root says "未打开文件夹" instead of "WORKSPACE".
- Gates: shell 33/33 (empty-root + scaffold tests), main 200/200, effects 35/35, phase 4 14/14.

## 2026-11-18 · standard titlebar behavior (drag threshold + double-click)

- The titlebar started the native window move on every mousedown, which swallowed clicks and
  double-clicks: buttons inside it could not open, and double-click could never maximize.
- Now the drag starts only after the pointer travels 4px, buttons/inputs are excluded, and a
  double-click on the titlebar background toggles maximize/restore. A plain click does nothing.
- Regressions: plain click sends no `window.drag`; a 40px drag sends exactly one; a double-click
  sends `window.maximize` and no drag. Main 198/198.

## 2026-11-18 · the session toggle opened the window drag, not the panel

- Clicking the titlebar session toggle did nothing in the desktop app: the titlebar is the
  native window-drag surface and the toggle did not stop `mousedown`, so the drag swallowed the
  click. Headless clicks passed because no real window drag exists there.
- The toggle now stops `mousedown` like every other titlebar control; the suite asserts the
  click sends **zero** `window.drag` io ops and opens the panel (`sessions: the titlebar toggle
  clicks instead of dragging the window`).
- Tests now follow the rule "drive the UI, not the kernel": session cleanup clicks the cards'
  close buttons instead of posting `close_session`, so a control that only works through the
  kernel fails the suite instead of passing it. Documented in `AGENTS.md`.
- Gates: main 195/195.

## 2026-11-18 · one mode switcher, sessions as a real panel

- Mode switching had three doors (titlebar button, composer chip, status bar). Only the titlebar
  remains: `TitleBar` now renders the mode menu itself, the composer bar has three chips
  (workspace / permission / model), and the status bar keeps just the session label, connection
  state, protocol and language.
- The session dropdown became a column (`SessionPanel`) between the editor and the conversation
  panel: header bar with count, search, new and collapse; cards show status (completed /
  running / connecting) with the last-activity time; the active card carries the rainbow
  spectrum accent (the one `--spectrum` definition), not the old blue.
- The panel follows the conversation: coding (before the right AI panel), helping (right edge of
  the workbench), and goal (full-height column beside the goal chat; the old history chip is
  gone). Advisor, IDE and deepsleep expose no session surface — advisor has no model
  conversation, only the review canvas and the annotation handoff.
- The panel squeezes the conversation panel: `--sessions-w: 232px` and, when an AI panel is
  present, the AI column grows by `--ai-grow` (120px; 64/40 on narrow windows), so the editor
  loses less than the panel width (measured at 1440: AI 360→480, editor 812→460).
- `SessionState` gained `updatedAt`, refreshed by `patch`, so card times stay honest.
- Gates: main 194/194, effects 35/35, phase 4 14/14.

## 2026-11-18 · per-tab shell picker beside the terminal "+"

- A small arrow now sits next to `+` in the terminal strip. It opens a menu (auto / pwsh /
  Windows PowerShell / cmd) and launches the new tab with that shell; the saved
  `shellProfile` stays untouched, and `auto` keeps following the setting.
- The choice is stored per tab in the terminal component, so `term.open` receives it directly;
  closing a tab drops the override. The popover is fixed-positioned and clamped to the window
  because `.term-tabs` scrolls.
- Regression: main suite gained "the arrow launches a tab with the chosen shell" (menu has four
  entries, stays inside the viewport, and the new tab is named `cmd`). 192/192.

## 2026-11-18 · real ConPTY works, including hosts with redirected stdio

- `term.rs` passed the *address* of the HPCON to `UpdateProcThreadAttribute`, so conhost got an
  invalid handle and every shell died in console init (`0xC0000142`) — the app always fell back
  to the pipe terminal. Passing the handle value fixes the spawn; `auto` now opens PowerShell
  (pwsh → powershell → cmd) as a real PTY and the tab shows colors and echoes.
- The child is also created with `STARTF_USESTDHANDLES` and null std handles. Without it, a host
  whose stdio is redirected (log file, pipe, `cargo test`) leaks those handles into the shell:
  the tab stays blank and typing appears to go nowhere. Verified both with a hidden service and
  with `-RedirectStandardOutput`.
- Tests: `conpty_echo_roundtrip` now exercises the real PTY; the old "shell died under ConPTY"
  test was split into the honest PTY-degradation report and a direct pipe-fallback check.
- Shell 31/31; main 191/191; terminal 6/6; effects 35/35; explorer 23/23; search 19/19;
  phase 4 14/14.

## 2026-11-17 · AI panel floor, summon chord, caret mapping

- The right column could be resized below its usable width because `onResize` skipped
  `clampSize`; the panel had no CSS floor either. Now clamped 300–560 and the CSS variable
  floors at 300. At 300px the composer wraps to two rows (bar height 56, overflow 0, send
  visible).
- The AI panel's empty state no longer says "press Shift+@+F1 to summon the agent" from
  inside the agent panel; it documents `@` files and `/` commands instead.
- Summon chord is order-independent: Shift+F1 alone works, or F1 within 1.5s of `@`. In a
  mode that already has a composer it focuses the composer and announces it instead of
  appearing to do nothing.
- Editor caret: webfonts loaded after Monaco measured glyph widths, so clicks mapped to a
  stale column. `remeasureFonts()` now runs when `document.fonts.ready` resolves. Regression
  clicks 4px past the last glyph and asserts the caret lands within 2px (measured 0.8px).
- Results: main 191/191, effects 35/35, explorer 23/23, search 19/19, phase 4 14/14,
  terminal 6/6, protocol 15/15.

## 2026-11-17 · overlay audit + redundant-label cleanup

- Audited every overlay at 1024×683 with a script that opens each menu/dialog and checks its
  box against the viewport. Offenders: the composer mode menu and the command palette.
- Command palette and task picker were centred with `left: 50% + translateX(-50%)`, but their
  `pop-in` animation (fill: both) replaced that transform, so they started at the centre and
  ran off the right edge. Centred with `left/right: 0; margin: auto` instead.
- All composer popovers now anchor to the composer's right edge, so no chip's menu can leave
  the panel. Re-ran the audit: zero offenders.
- Removed redundant labels: the composer model menu no longer repeats "密钥已保存" on every
  usable row; settings rows show a key badge only when it is actionable (missing, or an env
  key). Built-in rows no longer repeat the protocol id or the adapter name.
- Root-caused the intermittent explorer "Canceled" page error to Monaco model disposal and
  suppressed exactly that rejection reason in `main.tsx`.
- Results: main 186/186, effects 35/35, explorer 23/23 (3 consecutive), search 19/19,
  phase 4 14/14, terminal 6/6, protocol 15/15.

## 2026-11-17 · model menu by model, dialogs inside small windows

- The composer model menu showed raw endpoint ids (`openai-chat`, …) because App passed the
  adapter id as the label. Rows now lead with the **model** (`claude-sonnet-4-5`, `gpt-4o`,
  `gpt-4.1`) and show the provider plus key state underneath.
- The menu is right-anchored to the last chip, so it no longer runs past the window edge
  (verified at 1024×683 and 1440×900).
- The model form is capped to `calc(100vh - 64px)` and scrolls inside the dialog; at
  1024×683 it measures 619px instead of 1110px.
- Results: main 183/183, effects 35/35, explorer 23/23, search 19/19, phase 4 14/14,
  terminal 6/6, protocol 15/15.

## 2026-11-17 · native restore glyph

- The custom titlebar always drew the maximize square. The shell now pushes
  `pristem:window-state` after a maximize toggle and on resized-to-maximized transitions;
  the titlebar swaps to the Windows restore glyph and its aria-label follows.
- Main suite 182/182 (two new titlebar checks).

## 2026-11-17 · composer bar

- Replaced the two-control composer foot with a real bar: add-file, workspace switcher,
  permission level, mode, model, send. `@` mentions files, `/` lists real commands.
- Permission levels (ask / automatic / unrestricted) persist in local settings; the menu
  states that the approval gateway is not wired yet.
- Mode menu excludes goal (start it with `/goal`) and marks IDE as "no AI"; Plan is a
  disabled placeholder describing the intended flow.
- Provider list is prefetched at session start, so the model menu works before settings has
  ever been opened.
- Fixed a workspace-name false positive in the brand check and a transient explorer
  "Canceled" page error (now records stacks; passed on rerun).
- Results: main 180/180, effects 35/35, explorer 23/23, search 19/19, phase 4 14/14,
  terminal 6/6, protocol 15/15.

## 2026-11-17 · model depth, provider library, first-run guide

- Kernel: per-endpoint `EndpointTuning` (Top P, reasoning name/value, context window,
  tool-round cap, image flag), endpoint temperature, context trimming, and adapter support
  in both OpenAI formats. Anthropic sends Top P only.
- Shell: catalogue persists/validates the fields, merges partial edits (setting a key no
  longer wipes tuning), and exposes them to the UI.
- Renderer: 25 provider presets, advanced model parameters, product names in the list,
  opaque scrollable dialogs, first-run guide (workspace + API key, once), settings
  scroll-spy, and recent workspaces that open instead of deleting on click.
- Fixed the real dialog bug: `.settings-page` kept a transform from its entrance animation
  and therefore positioned fixed dialogs relative to the scrolled page (y = -549).
- Suite isolation: `--port` on the shell and `PR_URL` in every suite. Earlier "fresh"
  services had silently attached to the owner's desktop app on 8787 and exhausted its slots.
- Final results on an isolated instance: main 171/171, effects 35/35, explorer 23/23,
  search 19/19, phase 4 14/14, terminal 6/6, protocol 15/15; kernel provider/core and shell
  tests green (18 shell tests).

## 2026-11-17 · final verification closed

- Renderer `pnpm build` passed. Shell `cargo build` passed and all 16 Rust tests passed.
- Fresh-service matrix: main 160/160, effects 35/35, explorer 23/23, search 19/19,
  phase 4 editor/persistence 14/14, terminal 6/6, protocol smoke 15/15. No uncaught page
  errors were reported.
- Updated stale effects expectations to the current `view-seg-item` rail and the design's
  single 12s deepsleep halo. Replaced unreliable raw mouse coordinates with Playwright's
  visibility-aware hover; the same tilt assertion then passed. No production code was changed
  for these test-only failures.
- Synchronized `bug_log_optimize.md`: mode-switch recovery is closed, native ConPTY is
  confirmed by three cmd/conhost pairs, and the external-write polling watcher is documented.

## 2026-11-17 · missing-function and memory acceptance closed

- Reproduced the WebView2 clipboard gap by removing `navigator.clipboard`: explorer Copy
  Path failed to replace the native clipboard sentinel. Added shared native-shell clipboard
  helpers and routed file tree, editor tabs, terminal, AI transcripts, goal messages, error
  details, and path dialogs through them. Renderer build passed; explorer passed 23/23.
- Sampled the real native process tree during active editor/terminal creation, not only at
  rest. Eight editors and three terminals peaked at 897.2MB and settled at 871.7MB; startup
  was 734.2MB and renderer JS heap 32.7MB. Memory acceptance passes without optimization.
- One sampler wrapper rejected a blank `Start-Process.ExitCode` despite successful workload
  output. The revised wrapper preserved and emitted the valid measurements; no application
  failure occurred.

## 2026-11-17 · visual finishing closed

- Fixed the two measured narrow-layout defects: settings now keeps 16px gutters and the
  coding titlebar no longer overflows at 640px.
- Added regressions for both geometry fixes and for reselecting the current mode. The
  earlier one-off disabled Advisor click did not reproduce; no production mode change
  was made without evidence.
- Fresh screenshots confirm the existing visual language remains intact in coding,
  deepsleep, and narrow settings. Main suite passed 160/160 with no uncaught page errors.

## 2026-11-16 · finishing pass — context recovery

- Read both `hand-of/ofUI.md` and `hand-of/offunction.md`, plus the detailed Qoder
  findings log. The function hand-off supersedes the stale Phase 3–7 pending states:
  implementation exists, but the latest full E2E matrix has not yet been verified.
- UI priorities carried forward: raw i18n fallback, failed mode-switch latch, calm
  deepsleep states/animation, single pending indicator, left-rail clarity, toast/status
  placement, connection recovery, keyboard/mode gating, and responsive polish.
- Memory acceptance added: measure the actual desktop process tree and keep it below
  1 GB without removing Monaco/xterm functionality.
- `session-catchup.py` was unavailable at the skill's advertised path; continuing from
  the repository planning files and hand-offs instead.

## 2026-11-16 · current-build baseline

- Renderer build and Rust shell build passed; Rust tests passed 16/16.
- Fresh-service E2E results: main 136/136, explorer 22/22, search 19/19,
  phase 4 editor/persistence 14/14, effects 35/35, terminal 6/6, protocol smoke 15/15.
- The explorer cut/paste failure was stale `__p2__` / `__p2dir__` fixture state, not a
  production file-operation regression. The suite now removes those fixtures before setup
  and reports source/destination listings on failure. No production explorer change needed.
- The previously reported explorer `element is inert` failure did not reproduce.
- Automation used the expected piped terminal fallback; desktop ConPTY remains a separate
  environment limitation recorded in the hand-off.

## 2026-11-16 · UI reliability closed, visual pass started

- Main suite passes 157/157 with no uncaught page errors. New coverage proves real
  disconnected-to-connected retry, failed mode-switch retry, two-step recovery through
  coding into deepsleep, one target-row pending indicator, and null/empty/normal/overflow
  wake briefings.
- Fixed a multi-client session-isolation bug: unknown broadcast session events no longer
  replace the active session; only a locally pending open consumes `session_opened`.
- Removed the duplicate offline toast and the clipping ancestor that made the status-bar
  retry menu pointer-inaccessible.
- Phase 10 uses `DESIGN_SYSTEM.md`, `UX_SPEC.md`, the current ModelSettings/command
  palette/editor implementation, and fresh screenshots as references. Older screenshots
  mix UI generations and are not authoritative on their own.

## 2026-11-15 · session 1 — IDE sweep (phases 1–5 of the original plan)

- Real ConPTY terminal, file management, recursive search, split editor, persistence,
  menu bar, commands, tasks.
- Terminal spawn hardened: `0xC0000142` dialog suppressed, first-paint probe, cmd retry,
  pipe fallback with OEM decoding, `term.interrupt` for Ctrl+C, no leaked console windows.
- Docs updated (`BUILD_NOTES.md`, `UX_SPEC.md`, `DESIGN_SYSTEM.md`, `bug_log_optimize.md`)
  and `AGENTS.md` created.
- Gates (fresh service per suite):

| suite | result |
|---|---|
| `cargo build` / `cargo test` | clean / 12 passed |
| `pnpm --dir ui build` | ok |
| `check.cjs` | 117/117 |
| `_effects-selfcheck.cjs` | 35/35 |
| `_explorer-selfcheck.cjs` | 18/18 |
| `_search-selfcheck.cjs` | 14/14 |
| `_phase4-selfcheck.cjs` | 14/14 |
| `_terminal-selfcheck.cjs` | 5/5 |
| `scripts/smoke.mjs` | 15/15 |

## 2026-11-15 · session 2 — terminal input / copy / paste

Reported: cannot type or copy/paste in the terminal.

- Root cause of "cannot type": focus stayed on the tab button; tab switch focused the
  **previous** hidden terminal (stale closure). Fixed focus for tab switch, `+`, tab close,
  activity-strip segment, host padding, and `Ctrl+\`` / palette focus.
- Copy/paste now goes through the shell (`clipboard.read` / `clipboard.write`, Win32
  `OpenClipboard`) with `navigator.clipboard` as fallback; added `Ctrl+Shift+C`,
  `Ctrl+Insert`, `Ctrl+Shift+V`, `Shift+Insert`, right-click copy/paste, and CR
  normalization for multi-line paste.
- Tests added: `check.cjs` focus assertions (new tab typeable, tab switch typeable),
  `_terminal-selfcheck.cjs` clipboard round-trip.

Current gates after this session:

| suite | result |
|---|---|
| `cargo build` / `cargo test` | clean / 12 passed |
| `pnpm --dir ui build` | ok |
| `check.cjs` | 119/119 |
| `_terminal-selfcheck.cjs` | 6/6 |

Remaining work: Phase 2 (`Ctrl+\`` toggle, terminal clear, `term.new` command), then the
Phase 3 audit list in `findings.md`.

## 2026-11-15 · session 2 — Phase 2 closed

- `Ctrl+\`` toggles the activity strip (collapse when the terminal already has focus).
- Terminal header gained a `clear` action; `term.new` is back in the command table and is
  dispatched to the terminal component (`pristem:terminal-new`), gated on `caps.termInstance`.
- Planning files created (`task_plan.md`, `findings.md`, `progress.md`) and the Phase 3
  audit captured there.

| suite | result |
|---|---|
| `check.cjs` | 122/122 |
| `_effects-selfcheck.cjs` | 35/35 |
| `_explorer-selfcheck.cjs` | 18/18 |
| `_search-selfcheck.cjs` | 14/14 |
| `_phase4-selfcheck.cjs` | 14/14 |
| `_terminal-selfcheck.cjs` | 6/6 |
| `scripts/smoke.mjs` | 15/15 |
| `cargo test` | 12/12 |

Flake fixed: the empty-state hover assertion now retries with a 1px nudge (headless
sometimes drops the first synthetic hover).

Phase 3 is captured in `findings.md` (drag-and-drop move, scrollback search, copy-on-select,
watcher, `.gitignore`, replace preview, >2 split groups, terminal profiles, git write ops,
shortcut-table update, scroll-to-bottom affordance). Nothing there is started.
