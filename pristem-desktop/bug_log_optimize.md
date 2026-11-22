# pristem desktop — deferred issues / test caveats

## 2026-11-20 · IDE parity gaps that remain deferred — OPEN (deliberate)

The VS Code / JetBrains comparison landed git staging, editor navigation commands, reopen-closed,
tab reordering, format on save, editor zoom and the Open Editors list. These were evaluated and
left out on purpose; they need a separate design pass rather than a stub:

- **Terminal split panes** and **terminal scrollback search** (xterm has no built-in search
  addon here and no new npm dependencies are allowed, so search would need a buffer scan).
- **Zen / distraction-free mode**: hides the titlebar, rail and status bar, which needs a
  documented escape hatch and a narrow-window contract.
- **Search history** and a **TODO/bookmarks panel**: small, but they add state to the search
  and activity surfaces that the current design brief does not describe.
- **Local history** (JetBrains): requires a snapshot store inside `.pristem`, plus retention.
- **Git push / pull / stash / branch switching**: network operations interact with the owner's
  VPN (flaky) and need progress + cancel semantics; the terminal already covers them.
- **Preview / pinned tabs** and **per-hunk staging**: both change the tab and diff models
  rather than adding a control.

## 2026-11-20 · the git commit message was silently edited — CLOSED

- **Symptom**: a commit message containing `"`, `` ` `` or `$` came out with those characters
  removed; `$` and backticks are not shell metacharacters in `cmd.exe`, so the sanitizer only
  damaged the user's text. Paths were stripped the same way before reaching `git diff`.
- **Cause**: the git panel built one command string and `proc.exec` ran it through
  `cmd /C`.
- **Fix**: `proc.exec` takes an optional `args` array and then runs the program directly. The
  panel passes `['commit', '-m', message]` and `['diff', '--', path]`, so nothing is re-parsed.
  Verified by `_git-selfcheck.cjs` committing `fix: keep "quotes" and $HOME` and comparing
  `git log -1 --format=%s`.

## 2026-11-20 · Monaco shows red squiggles on every import — OPEN

- **Symptom**: opening `workspace.tsx` paints a red diagnostic underline under every `import`
  line, as if every module were missing.
- **Cause**: Monaco's TypeScript worker runs without the repo's `tsconfig.json` / module
  resolution, so bare and relative imports cannot be resolved. The files are real; the diagnostics
  are a project-context artefact.
- **Suggested fix**: register a compiler-options object for the TS worker (`moduleResolution:
  NodeJs`, `paths`, `allowJs`) and fall back to `setDiagnosticsOptions({ noSemanticValidation:
  true })` when the workspace has no `tsconfig.json`. Not needed for the visual pass; logged so it
  is not mistaken for a syntax-colour problem.


## 2026-11-19 · the app forced the workspace to its own source folder — CLOSED

- **Symptom**: starting pristem opened `D:\projects\pristem` (the app's own repository) as the
  workspace, whatever folder the user had opened before; the tree showed the repository and the
  terminal started there.
- **Cause**: the windowed launch used the repository root as the initial workspace. The headless
  mode needs it (the suites' relative paths assume it), but the desktop app must not: it now
  reopens the workspace it last had (`%APPDATA%\pristem\workspace.txt`) and starts on the
  welcome screen when there is none. A folder that was moved or deleted does not resurrect as a
  broken root.
- **Note**: the report came from a window that was still running a **stale binary** — the fix was
  in `main.rs` but the exe had not been relinked yet. `pristem.cmd` only rebuilds when the binary
  is missing, so a stale window can survive a source change; check the exe's timestamp before
  chasing a behaviour that the source already changed.
- **Regression tests**: `io::tests::a_missing_store_means_no_workspace`,
  `io::tests::a_moved_workspace_does_not_resurrect`,
  `io::tests::the_store_round_trips_the_workspace`,
  `io::tests::shell_cwd_is_not_the_apps_own_folder`.

## 2026-11-18 · ConPTY never activated: every shell died in console init — CLOSED

- **Symptom**: every terminal reported `[PTY 不可用 …]` — `powershell produced no output within
  2500 ms; cmd produced no output within 1500 ms`, or `exited with 0xc0000142` — so the app
  always ran the degraded pipe shell.
- **Cause 1**: `UpdateProcThreadAttribute(PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, …)` was given
  `&hpc`, the *address* of the handle. The attribute value is the HPCON itself; conhost received
  an invalid handle and every shell died during console init with `STATUS_DLL_INIT_FAILED`
  (`0xC0000142`). This looked like "Windows PowerShell 5.1 cannot run under a pseudoconsole",
  which sent the earlier investigation the wrong way.
- **Cause 2** (only visible once the first was fixed, when `cargo test` ran the spawn): the child
  was created without `STARTF_USESTDHANDLES`. When the host's own stdio is redirected — a pipe,
  a log file, the test harness — Windows copies those handles into the shell, so cmd wrote its
  prompt into the host's stdout while the terminal tab stayed blank and typed keystrokes went
  nowhere. Reproduced by running the service with `-RedirectStandardOutput`.
- **Fix**: pass `hpc as *const c_void`; set `STARTF_USESTDHANDLES` with the (zeroed) std handles so
  conhost wires the child to the pseudo console. `CREATE_NO_WINDOW` stays off the PTY path.
- **Evidence**: headless `term.open` returns `kind: "pty"` for `auto`, `pwsh` resolution gives
  `powershell.exe`, and a typed `echo` echoes with ANSI color — with and without redirected host
  stdio. Shell tests 31/31, main 191/191, terminal 6/6, effects 35/35, explorer 23/23,
  search 19/19, phase4 14/14.
- **Regression tests**: `term::tests::conpty_echo_roundtrip` (which now fails if either the
  HPCON value or `STARTF_USESTDHANDLES` regresses), `term::tests::the_pipe_fallback_runs_the_requested_shell`,
  `term::tests::a_shell_that_cannot_run_under_conpty_is_reported`.

## 2026-11-18 · the terminal typed into a void, lost colors and ignored the shell setting — CLOSED

- **Symptom**: in an environment without ConPTY the terminal showed nothing while typing, only
  ran a command after Enter, printed no colors, and always opened `cmd.exe` — the
  `Terminal shell` setting seemed to do nothing.
- **Cause**: three separate gaps, all on the degraded path:
  1. The pipe fallback had **no echo**. A pipe has no console, and cmd/PowerShell do not echo
     what they read, so xterm (which never echoes locally) showed a blank screen until the
     command produced output.
  2. The pipe fallback **hard-coded `cmd.exe`** (`pipe_spawn` ignored the requested profile),
     and the ConPTY retry chain swapped the requested shell for `cmd.exe` silently.
  3. A pipe has no console either, so there is no VT: cmd cannot colorize, and the child
     inherited a non-terminal environment that makes most tools drop their colors.
- **Fix**:
  - The **host echoes the keystrokes** for pipe sessions (printable characters, backspace,
    Enter), so a degraded terminal still behaves like a terminal.
  - The pipe fallback **honours the requested shell**: cmd.exe speaks the OEM code page in both
    directions; PowerShell is hosted through a generated UTF-8 REPL bootstrap
    (`%APPDATA%\pristem\terminal\repl.ps1`), because PowerShell's own redirected-stdin reader
    decodes UTF-16LE and prefixes every line with `U+FEFF` — which makes it reject *every*
    command ("not recognized"). The bootstrap owns stdin as UTF-8, evaluates one line at a time
    and pins `[Console]::OutputEncoding` to UTF-8 so results and localized errors decode alike.
  - `TERM`, `COLORTERM`, `FORCE_COLOR`, `CLICOLOR_FORCE` and `GIT_CONFIG_*` are set for the
    child, so tools still colorize; PowerShell 7 additionally gets ANSI through
    `$PSStyle.OutputRendering = 'Ansi'`. cmd.exe's own output stays monochrome — that needs a
    real console.
  - The first-paint probe now waits 2.5 s (1.5 s for the cmd retry) instead of 1.2 s, and
    reports the child's exit code, so a slow machine is not silently demoted to pipe mode.
    A machine without ConPTY is detected once per process and remembered.
  - **The 1.2 s probe was the real cause of the reported symptoms**: on this machine PowerShell
    paints in ~0.4 s, but a slower start was misread as "no pseudoconsole", so a *working* PTY
    was demoted to the pipe fallback — which is exactly what took away the colors, the local
    echo and the user's shell. Measured after the change: the session opens in ~0.36 s and
    reports `kind: "pty"`.
  - The pseudoconsole is **no longer nudged with an Enter on start**. conhost paints the first
    frame on its own; the nudge now only fires if nothing painted within 1 s (older builds wait
    for input). Nudging unconditionally printed a **second prompt** in every session — the
    "many `PS D:\projects\pristem>` lines" the user reported.
  - A shell that dies *inside* a pseudoconsole is only skipped for the PTY path — the pipe
    fallback still runs it, so the user's choice of shell survives the degradation instead of
    turning into cmd.exe.
  - `shell.capabilities` no longer hard-codes `pty: true`; it reports what the shell knows.
    `term.open` returns a `note` explaining the degradation, and the UI shows it and marks a
    pipe session with a dot on its tab.
- **Regression tests**: `term::tests::echo_*`, `term::tests::utf8_codec_*`,
  `term::tests::oem_codec_*`, `term::tests::pipe_session_echoes_and_runs_the_requested_shell`,
  `term::tests::a_shell_that_cannot_run_under_conpty_is_reported`,
  `term::tests::explicit_profile_resolves_to_that_shell` plus the visual suites
  (191/191, effects 35/35, explorer 23/23, search 19/19, phase4 14/14, terminal 6/6, smoke 15/15).

## 2026-11-17 · "Canceled: Canceled" page error — CLOSED

- **Cause**: Monaco cancels in-flight language work when a text model is disposed (file
  rename/close) and Chromium surfaced the cancellation as an unhandled rejection. A stack
  captured from the explorer suite pointed at Monaco's `TextModel.dispose`.
- **Fix**: `main.tsx` prevents the default only for rejections whose message starts with
  `Canceled`; every other rejection still surfaces. Explorer then passed three runs in a row.

## 2026-11-17 · AI edit approval is UI-only — OPEN (designed, not enforced)

- The composer offers ask / automatic / unrestricted and persists the choice, and says the
  approval gateway is not wired. Enforcing it needs a blocking approval at the kernel tool
  boundary (write/exec) with a confirm round-trip. Tracked in `task_plan.md` Phase 13.
- A real Plan mode is also still in design; the composer shows a disabled placeholder.

## 2026-11-17 · add-model dialog clipped above the viewport — CLOSED

- **Symptom**: the provider picker and form opened partly off-screen (observed `y = -549`),
  and the underlying settings page showed through the dialog.
- **Cause**: `.settings-page` runs `empty-part` with `animation-fill-mode: both`. The final
  `translateY(0)` keeps a transform on the page, which makes it the containing block for
  every `position: fixed` descendant. Scrolling the page then pushed the backdrop above the
  viewport.
- **Fix**: the entrance animation uses `fill-mode: backwards`; dialogs use an opaque surface,
  a stronger backdrop and a scrollable flex viewport. Nav jumps are instant so a dialog can
  never open while the page is still smooth-scrolling.
- **Verification**: `check.cjs` asserts the picker box stays inside the window and that
  opening the form does not move the page.

## 2026-11-17 · suites talked to the desktop app on 8787 — CLOSED

- **Symptom**: a suite could fail reconnect/mode checks only while the desktop app was open,
  with worker slots exhausted.
- **Cause**: the shell binds 8787 and falls back to a random port; suites hard-coded 8787, so
  they drove the open desktop instance while their own service idled on another port.
- **Fix**: `--port <n>` on the shell and `PR_URL` in every suite. Each suite now owns a
  dedicated port.

## 2026-11-13 · mode switch click race under Playwright (test-only) — CLOSED 2026-11-17

- **Symptom**: `check.cjs` occasionally timed out at `pickMode()` with
  `locator resolved to <button aria-disabled="true">` and
  `element was detached from the DOM, retrying`.
- **Repro**: repeated runs against one long-lived headless service could fail at an
  arbitrary `helping → advisor` / `coding → goal` switch as worker slots accumulated.
- **Fix**: pending state is rendered only on the target row, failed switches are retryable
  without reload, and deepsleep recovery uses fresh kernel-owned transitions. The effects
  helper retries transient automation clicks and uses the visible recovery action.
- **Verification**: main suite passed 160/160, including same-mode reselection, failed-switch
  retry, two-step deepsleep recovery, and all six-mode transitions. Effects passed 35/35.
  A fresh service per suite remains required because the kernel has four worker slots.

## 2026-11-13 · content search is root-only — CLOSED 2026-11-15

- **Symptom**: the explorer filter and the search panel only covered root-level
  files; files inside collapsed folders were not found by name or content.
- **Fix**: `fs.search` / `fs.replace` / `fs.files` are bounded recursive walks in
  `shell/src/io.rs` (skip list, no symlink follow, 4000-file / 512 KiB-per-file
  caps). The search panel, quick open (`Ctrl+P`) and the tree name filter all use
  them. Verified by `.visual-check/_search-selfcheck.cjs` (nested hits,
  include/exclude, regex, Replace All, `.pristem/trash` exclusion,
  quick-open nested file).

## 2026-11-15 · Git diff view was permanently empty — CLOSED

- **Symptom**: clicking a changed file in the Git panel never showed a diff.
- **Cause**: `openDiff` dispatched its command after the event listener had been
  removed, and `state.diff` was never set; the panel also drove git through the
  terminal with a `cmd &` sentinel, which breaks under a PowerShell PTY.
- **Fix**: the panel now issues sequential `proc.exec` calls
  (`rev-parse` → `status --short` → `branch --show-current` → `log --oneline -8`)
  and `git diff -- <path>` populates the diff view. `proc.exec` merges stderr,
  so failures are visible. Git no longer depends on the user's shell at all.

## 2026-11-15 · powershell.exe 0xC0000142 under ConPTY — mitigated

- **Symptom**: opening the terminal showed a Windows hard-error dialog
  (`powershell.exe — 应用程序无法正常启动 (0xc0000142)`) and the terminal never painted.
- **Cause**: on this machine Windows PowerShell 5.1 fails DLL init when hosted by a
  pseudoconsole. The old 150 ms probe treated a dialog-blocked process as "alive", so the
  session was accepted but produced no output.
- **Mitigation**: `SetErrorMode` at startup suppresses the dialog; the spawn now nudges the
  pseudoconsole with one Enter, requires first output within 1.2 s, kills a silent child and
  retries `cmd.exe` under ConPTY, then the pipe fallback. A shell that failed once is skipped
  for the rest of the process, and the UI queues keystrokes typed before `term.open` resolves.
  `term.open` reports `kind: pty|pipe` plus the real shell, so the tab never lies. The pipe
  fallback decodes output as the OEM code page (GBK here) and implements Ctrl+C by
  terminating the shell's children (`term.interrupt`), keeping the shell and cwd.
  Regression test: `term::tests::missing_shell_falls_back_to_cmd`, plus
  `.visual-check/_terminal-selfcheck.cjs` (independent cwd, Ctrl+C, kill).
- **Environment note**: inside a restrictive job object (this automation sandbox) conhost
  cannot start, so every shell uses the pipe fallback; a desktop launch gets real ConPTY.
- **Not fixed**: PowerShell 5.1 itself. Install `pwsh` to get a PowerShell prompt; `auto`
  prefers it.

## 2026-11-15 · desktop still falls back to the pipe shell — CLOSED 2026-11-17

- **Symptom**: an earlier desktop launch fell back after Windows PowerShell 5.1 failed DLL
  init, and the `cmd.exe` ConPTY retry also appeared to fail.
- **Resolution**: the native memory workload opened three terminals and the owned process
  tree contained three distinct `cmd.exe` / `conhost.exe` pairs. This confirms real ConPTY on
  a desktop launch; the pipe fallback remains confined to restrictive automation job objects
  or an actually unavailable shell.
- **Remaining environment limit**: Windows PowerShell 5.1 itself is not fixed. Install `pwsh`
  for a PowerShell prompt; `auto` prefers it and otherwise reports the real fallback shell.

## Known limits (accepted, documented)

- `run.stop` / Ctrl+C terminate the shell's child processes (`term.interrupt`). The shell and
  cwd survive; a child that traps termination cannot be asked nicely (no CTRL_C_EVENT reaches
  a pseudoconsole child on this Windows build).
- External filesystem changes are detected by a bounded 1.5s polling watcher; the tree and
  clean open buffers refresh automatically, while dirty buffers remain protected. The explorer
  suite verifies an external write without a manual refresh.
- No `.gitignore` awareness in `fs.search` / `fs.files`; the fixed `skip()` list
  covers build dirs, `node_modules`, `.git`, `.pristem`.
- `fs.read` truncates at 400k chars; the UI marks such files read-only (the
  response also reports `truncated: true`), so a save can never destroy the tail.
- Non-Windows terminals use a piped shell (`// ponytail: not a real PTY`).
