# Findings — IDE experience audit

## 2026-11-20 · VS Code / JetBrains gap matrix

Sources: VS Code user-interface, basic-editing, code-navigation, custom-layout, source
control, terminal and keybinding docs plus the `microsoft/vscode` README; JetBrains
IDEA 2026.3 features, Search Everywhere, Recent Files, editor basics, navigation,
refactoring, Local History, TODO and Bookmarks help pages.

Already present (verified in code, not assumed): find/replace in file, multi-cursor
(Monaco defaults), folding, sticky scroll, minimap, word wrap, go to line, symbol
outline, breadcrumbs (path only), split editor (max two groups), tab context menu
(close/others/right/reveal/copy path/open to side), Ctrl+Tab cycling, auto save,
explorer create/rename/delete-to-trash/cut/copy/paste/drag-move, recursive search with
case/word/regex/include/exclude/scope and replace preview, quick open, file watcher,
terminal tabs + shell picker + interrupt, settings for font/tab size, command palette.

Missing, and in scope for Phase 23:
- Source control is read-only plus "commit everything": no staging model, no discard,
  no per-file actions. `git add -A && git commit -m "…"` also strips `"`, `` ` `` and
  `$` from the message — a silent data change, and `$`/backticks are not shell
  metacharacters in cmd anyway.
- No Go to Definition / References / Peek / Rename / Select All Occurrences / Fold All.
  Monaco ships these; they were simply never exposed. `F2` is the app's mode switch,
  so rename uses `Shift+F6` (JetBrains key, no conflict).
- No Reopen Closed Editor; tabs cannot be reordered by drag.
- No format on save; font size only changes through settings (no editor zoom).
- No Open Editors section in the explorer.

Missing, deferred (written to `bug_log_optimize.md`): terminal split panes and
scrollback search, zen mode, search history, TODO/bookmarks panels, local history,
Git push/pull/stash/branch switching, preview/pinned tabs, per-hunk staging.

What the comparison changed: most navigation gaps were **exposure**, not capability —
Monaco already ships definition/references/peek/rename/occurrences/fold, so the fix is
a command table and an action map, not a language service. Source control was the one
area with a genuinely missing model (there was no index state at all), and the commit
path was also the only place where user text crossed a shell. Tab niceties (reopen,
reorder) and preferences (format on save, zoom) were small local state additions.

## 2026-11-17 · panel width, summon chord, caret mapping

- `onResize` forwarded raw pixel widths, bypassing `clampSize`; the AI column could therefore
  be dragged below the 280 limit. It is clamped in state now and floored again in the CSS
  variable, so a stale snapshot cannot reproduce the narrow panel.
- At the 300px floor the composer's four chips do not fit on one row; the bar wraps and the
  send button stays visible (measured bar height 56, horizontal overflow 0).
- The summon chord required holding `@` at the moment F1 arrived. With F1 first, or after
  releasing 2, nothing happened. Shift+F1 now works on its own and a recent `@` still counts;
  active modes focus the composer and announce it.
- The caret looked offset when clicking a line end: IBM Plex Mono arrives after Monaco caches
  character widths, so click→column mapping used the fallback font's metrics. Re-measuring
  when fonts are ready fixed it; a click past the last glyph now lands within 1px of the end.

## 2026-11-17 · overlay overflow audit

- Two overlays used `left: 50%` + `translateX(-50%)` and an entrance animation with
  `fill-mode: both`. The animation's own `transform` replaces the centring transform, so
  both opened with their left edge at the viewport centre (palette measured x=512 in a
  1024px window). `left: 0; right: 0; margin: 0 auto` centres them without a transform.
- Composer popovers were anchored per chip; the mode chip sat close enough to the edge to
  overflow. They now anchor to the composer's right edge, which is always inside the panel.
- The model menu repeated "密钥已保存" on every row; a functioning key is the default state,
  so only missing keys (and env-sourced keys) now carry a badge. Built-in rows also no longer
  repeat the protocol id or the adapter name.
- Measured: zero overlays outside the viewport at 1024×683 across four composer menus,
  `@`/`/` suggestions, session popover, five menu-bar menus, palette, settings, model picker
  and model form.

## 2026-11-17 · composer bar

- The old composer exposed only a context popover whose chips were never sent with the
  message. It was removed; `@` mentions are the real context path.
- Mode switching from the bar reuses the kernel-owned `switch_mode`; no reload happens.
  Provider switching reuses `set_provider`. Only new endpoints/keys need a restart because
  the kernel registry is built at bootstrap.
- Goal is a mode but belongs to the `/goal` command surface, so the bar's mode menu omits
  it and says so. IDE is tagged "no AI"; Plan stays a documented placeholder.
- The bar fits the 360px right panel (measured clientWidth 337 = scrollWidth 337).

## 2026-11-17 · model depth + first-run guide (Phase 12)

- The clipped add-model dialog was not a height bug: `.settings-page` animates with
  `empty-part` and `animation-fill-mode: both`, so the final `translateY(0)` kept a transform
  and made the page a containing block for every `position: fixed` dialog inside it. With a
  scrolled page the dialog landed at `y = -549`. `fill-mode: backwards` removes the retained
  transform.
- The nav was a last-click selection, so the highlighted row and the visible section drifted
  apart. It now derives from scroll position, with an at-bottom rule for the short final
  section, and nav jumps are instant so a dialog cannot open mid-scroll.
- Enhanced model rows: the built-in endpoints report raw adapter ids as labels, and the
  missing-key pill used the decorative-only `--text-4` tier. Rows now show product names and
  the pill uses `--text-3`.
- Clicking a recent workspace in settings used to delete it from the list. It now opens the
  workspace, and removal has its own button.
- Test isolation finding: the desktop app owns 8787. Suites started "fresh" services that
  fell back to a random port while the browser kept talking to the desktop app, exhausting
  its four worker slots. The shell now accepts `--port`; every suite reads `PR_URL`.
- Kernel tuning is real end-to-end: context-window trimming, per-endpoint temperature,
  Top P, reasoning (chat/reasoning.effort), tool-round cap. Anthropic sends Top P but not the
  reasoning field (its API needs a thinking budget instead).

## 2026-11-17 · hands-on model/settings audit

- Native window driven through UI Automation. The add-model picker exceeded the window
  height, so `place-items: center` pushed its header and first presets above y=0.
- The dialog surface was translucent enough that the demo banner, model rows and the add
  button remained readable through it, and the backdrop did not separate the dialog from
  the page.
- Opening the form re-rendered the page at `外观与动态` while `模型与连接` stayed active:
  the nav is a manual selection, not a scroll position, so the two drift apart.
- Built-in rows show the adapter id twice and use the dim `--text-3/4` palette for their
  primary name; there is no Google, xAI, Mistral, Groq or local-runtime preset, and the
  Anthropic preset leaves the URL empty while placeholders name DeepSeek.
- Owner chose full kernel support for the picture-2 parameter set, and a first-run guide
  that only appears until setup is completed.

## 2026-11-17 · final verification evidence

- Renderer build passed; shell build and 16/16 Rust tests passed.
- Fresh-service results: main 160/160, effects 35/35, explorer 23/23, search 19/19,
  phase 4 14/14, terminal 6/6, protocol 15/15. Every browser suite reported no uncaught
  page errors.
- The effects failures were stale test contracts, not production regressions: the horizontal
  rail selector is `view-seg-item`, deepsleep permits only its 12s halo to loop, and synthetic
  hover needs Playwright's visibility-aware action. The corrected suite passes 35/35.

## 2026-11-17 · clipboard and memory acceptance

- WebView2 can expose no `navigator.clipboard`; before the fix, explorer Copy Path left a
  shell clipboard sentinel unchanged. Shared `readClipboard` / `writeClipboard` helpers now
  route every identified copy/paste surface through native shell IO with browser fallback.
  The failing-first explorer regression passed with the full suite at 23/23.
- Native CDP workload opened eight editors and three terminals while sampling the complete
  owned process tree every 100ms. Startup was 734.2MB, settled loaded state 871.7MB, and
  active peak 897.2MB (126.8MB below 1GB); renderer JS heap was 32.7MB.
- Peak breakdown included the Rust shell at 28.6MB, WebView2 browser at 94.2MB, GPU at
  445.3MB, renderer at 220.0MB, utility processes, and three cmd/conhost pairs. No bundle,
  dependency, or rendering optimization is justified by these measurements.

## 2026-11-17 · visual finishing evidence

- Fresh `44-settings-640.png` shows 16px side gutters, a single-column section nav, and
  usable settings controls without horizontal clipping. Coding and deepsleep retain the
  established density, horizontal rail, top-right toast placement, and calm sleep view.
- Main suite passed 160/160 after adding narrow-titlebar, narrow-settings, and same-mode
  reselection checks. An earlier Advisor click timeout was transient and not reproducible;
  the follow-up run found no pending row and completed every transition.

## 2026-11-16 · reliability findings resolved

- `t()` now falls back through both dictionaries; no raw unavailable-content key remains.
- Failed mode switches only block in-flight states and can be retried without reload.
  Forbidden helping-to-deepsleep recovery goes through coding with fresh kernel requests.
- Unknown session-scoped broadcasts are ignored; pending local opens alone consume an
  otherwise unknown `session_opened`. A second client cannot steal the main page's session.
- Offline retry has one home in the status bar. Removing `.status-group-right` overflow
  clipping made its menu clickable; the duplicate global toast is gone.
- Null, empty, normal, and five-rule-capped wake briefings all have explicit rendering and
  regression coverage. Deepsleep retains one calm 12-second halo animation.
- Main suite evidence: 157/157. Older screenshots predate parts of this work; capture the
  current build before making visual decisions.

## 2026-11-16 · finishing-pass hand-off reconciliation

- Function hand-off reports Phases 3–7 implemented: model management, editor/terminal
  quick wins, file copy/move, search scopes/preview, and polling filesystem watcher.
  These are verification-pending until the full matrix runs on the current build.
- UI P0: `t()` can expose the literal `common.contentUnavailable` key; deepsleep also
  lacks its `modeHint.deepsleep` translation. Re-read current source before editing.
- UI P0: a failed mode switch can latch `phase: 'failed'`, preventing every later legal
  switch until reload. A new user intent must be able to start after failure.
- UI P1/P2 candidates: wake briefing empty/null/overflow states, sleep-log separator and
  excessive infinite animations, duplicate pending copy, vertical icon-only rail,
  bottom-right toasts, IDE status duplication, connection retry, responsive titlebar,
  and editor shortcuts leaking into dormant modes. Each requires current-source/live
  confirmation because the hand-off predates concurrent edits.
- Explicit exclusions: system prompts, unfinished overall section design, kernel/Mode
  Router edits, owner-deferred git write operations and terminal profiles, new npm deps.
- Planning recovery script was not present at `C:\Users\ASUS\.trae-cn\skills\plan-plus\scripts\session-catchup.py`.
- Baseline: renderer build passed; Rust 16/16; main UI suite 136/136. Explorer initially
  failed only cut+paste. Its fixture did not remove pre-existing `__p2__`/`__p2dir__`,
  so stale files can change copy naming and make paste hit an existing destination.
  The suite now moves old fixtures to trash before setup and reports source/target names.

Date: 2026-11-15. Evidence is from the code in `pristem-desktop/` and runs against a fresh
headless service on 8787.

## Terminal (fixed in Phase 1–2)

| # | Finding | Evidence | Status |
|---|---|---|---|
| T1 | Tab switch focused the **previous** terminal | `focusActive` closed over the old `activeId`; the shown host is `display:none` for the old id | fixed — focus by id |
| T2 | `+` never focused the new shell | `addInstance` only called `setActiveId` | fixed |
| T3 | Closing a tab left focus on a removed node | `closeInstance` never moved focus | fixed |
| T4 | `Ctrl+C` was intercepted even with a selection, and copied nothing without a selection | custom handler returned `true` only for selections (native copy, unreliable in WebView2) | fixed — shell clipboard |
| T5 | Paste depended on `navigator.clipboard` (WebView2 may deny) | no shell clipboard existed | fixed — `clipboard.read/write` |
| T6 | `Ctrl+Insert` / `Shift+Insert` / `Ctrl+Shift+V` / right-click did nothing | no key handling | fixed |
| T7 | Multi-line paste reached the PTY with LF | xterm `paste` sends text verbatim | fixed — CR normalization |
| T8 | Clicking the **Terminal** segment of the activity strip did not focus xterm | `onTabChange(v)` only | fixed |
| T9 | Clicking the `.term-host` padding did not focus xterm | no mouse handler on the host | fixed |
| T10 | `Ctrl+\`` / palette focus targeted the first host (could be hidden) with a one-shot 30 ms timer | `document.querySelector('.term-host ...')` in `App.tsx` | fixed — `pristem:terminal-focus` event, active id, two pings |
| T11 | `Ctrl+\`` never collapses the strip | spec says focus / press again to collapse | fixed — toggle + focus regression |
| T12 | No `clear` action in the terminal header | xterm has `clear()` | fixed — header action |
| T13 | `term.new` vanished from the command table in the Phase 5 rewrite | `commands.ts` has no `term.new` | fixed — command restored |
| T14 | No terminal scrollback search | needs `@xterm/addon-search` (new npm dep) | deferred (owner rule) |
| T15 | No copy-on-select | opinionated default | deferred |
| T16 | `Ctrl+C` sent 0x03 is not a signal on this Windows build | direct probe: cmd received the text `\u0003` | fixed — `term.interrupt` |

## Terminal spawning / environment

- The "Windows PowerShell 5.1 fails DLL init (`0xC0000142`)" theory was wrong. The spawn passed
  `&hpc` (the address) to `UpdateProcThreadAttribute` instead of the HPCON value, so conhost
  received an invalid handle and *every* shell died during console init. With the value passed,
  Windows PowerShell 5.1 hosts fine inside a pseudoconsole.
- A second spawn requirement only shows up when the host's stdio is redirected (a log file, a
  pipe, `cargo test`): Windows copies the host's std handles into the child unless
  `STARTF_USESTDHANDLES` is declared. Then the shell paints into the host's stdout while the
  terminal tab stays blank and typing goes nowhere. Declaring the flag with null handles fixes
  it; without this the unit tests and any redirected `pristem.cmd serve` were broken.
- With both fixed, `term.open` returns `kind: "pty"` in this environment, `auto` resolves to
  `powershell`, and typed commands echo with ANSI color.
- In restrictive job objects conhost cannot run at all, so every shell is `kind: "pipe"`. The
  pipe fallback decodes OEM (GBK) output and supports Ctrl+C via the same child-kill path.
- `term.open` reports `shell` / `path` / `kind`, so the tab cannot lie about the shell.

## Other IDE gaps (historical audit; final status)

G1–G7, G9, G14, and G15 are implemented and verified by the final matrix. G10–G13 remain
explicitly deferred as recorded in `task_plan.md`; the table below preserves the original audit.

| # | Area | Gap | Impact | Cost |
|---|---|---|---|---|
| G1 | Explorer | No drag-and-drop move | medium | `fs.rename` exists; needs drop targets + optimistic tree update |
| G2 | Explorer | No copy/cut/paste of files | medium | needs clipboard-of-paths + `fs.rename` |
| G3 | Search | No replace preview; only "replace N in M files?" | medium | requires per-file diff or at least per-file counts (already returned) |
| G4 | Search | No "search in selection" / open-editors-only | low | filter scope on the client |
| G5 | Editor | No format-document / organize-imports | medium | Monaco built-ins exist; needs keybindings + wiring |
| G6 | Editor | Tab overflow has no dropdown list | low | CSS + popover |
| G7 | Editor | No `Ctrl+Tab` next/previous tab | low | global key handling |
| G8 | Layout | Right AI column exists only in coding (by design); IDE has no panel toggle for it | none | — |
| G9 | Filesystem | No external watcher; `fs.changed` is self-owned only | medium | needs a polling or ReadDirectoryChangesW loop |
| G10 | Search/index | No `.gitignore` support (fixed skip list) | medium | would need an ignore parser |
| G11 | Terminal | Profiles limited to auto/pwsh/powershell/cmd | low | owner deferred |
| G12 | Terminal | No multi-line paste warning | low | confirm when `\n` count > 1 |
| G13 | Git | No stage/unstage/discard; commit is `add -A` | medium | owner deferred write ops |
| G14 | Shortcuts | Help page table lags the new terminal keys | low | update `SettingsPage` key table |
| G15 | Terminal | Scroll-to-bottom affordance missing while scrolled up | low | xterm viewport scroll listener + button |

## Constraints that shape the fixes

- No new npm dependencies (Monaco/xterm only).
- Rust uses only crates already in `shell/Cargo.lock`; new `windows-sys` **features** are OK
  (no download, kernel32/user32 already linked).
- Every new i18n key in both dictionaries.
- IDE mode keeps zero `[data-ai="true"]` elements; mode semantics stay kernel-owned.
- Suites need a fresh service (kernel `worker_slots = 4`).
