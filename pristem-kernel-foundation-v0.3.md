# pristem Kernel — Foundation Framework Design (v0.3, NOT FINAL)

> **Status: FOUNDATION SCAFFOLD — NOT FINAL.**
> The system prompt and wire protocols (edit ladder, status-line vocabulary, REMINDER semantics,
> compression contract) are still being iterated on the experiment bench and are treated as
> **swappable modules** by this design. The kernel must be buildable today and upgradable
> tomorrow without re-architecture. Anything marked `[CHURN]` is expected to change.
> Decisions marked `[TA]` are owner-ratified (2026-11-08 design session, 12:26–13:05).

---

## 1. What this is

pristem is a **resident agent service** with two thin clients (CLI + desktop). All intelligence
lives in the service; clients do IO and rendering only, with zero capability difference between
them `[TA §13.1]`. The kernel described here is the Rust core of that service.

Six-mode matrix: CLI runs `goal / coding / deepsleep`; desktop runs all six
(`+ IDE / helping / advisor`) `[TA]`. CLI renders mouse-clickable terminal buttons
(ANSI/ESC, inspired by Grok Build CLI + Cline) `[TA]`.

## 2. Non-negotiables (hard constraints)

| # | Constraint | Source |
|---|---|---|
| N1 | Memory < 1 GB (agent-peak honesty: hard when busy; idle target much lower) | §8 |
| N2 | Kernel logic lives in Rust — no Electron in the logic plane ("网页套壳慢死了") | `[TA 12:45]` |
| N3 | Permission derives ONLY from system injection — never from conversation content | §1 |
| N4 | Test-set is not writable by the agent; deletions always route through `delete` (trash) | §7 |
| N5 | BYOK: no bundled model access, no free tier | §1 |

## 3. Crate layout

```
pristem-kernel/                 (workspace)
├── crates/
│   ├── pristem-core/          # session manager, mode router, agent loop  [CHURN: protocol]
│   ├── pristem-defense/       # the antivirus pipeline (§5) — stable API, growing sig DB
│   ├── pristem-harness/       # read-registry, compress, REMINDER, skill loader  [CHURN]
│   ├── pristem-deepsleep/     # clean-instance engine, staging queue, wake briefing
│   ├── pristem-advisor/       # annotation bridge — deliberately THIN [TA: "不要做太厚"]
│   ├── pristem-provider/      # OpenAI Chat Completions + Responses + Anthropic Messages
│   ├── pristem-ipc/           # client-facing session protocol (CLI & desktop)
│   └── pristem-plugin/        # host: in-process + out-of-process mount points
├── sigdb/                     # permission-signature database (hot-updatable, versioned)
└── bench/                     # criterion benches: loop latency, defense throughput
```

Dependency direction is strictly one-way: `core` → (defense, harness, deepsleep, advisor,
provider) → `ipc` knows `core`, nothing knows `ipc` back.

## 4. Session Manager & Mode Router

**SessionManager**: owns session lifecycle, one OS thread-pool slot per active session,
shared-workspace state (REMINDER store, archives, staging queue are cross-session singletons).

- Client-agnostic: CLI and desktop connect through the same `pristem-ipc` protocol; the
  kernel cannot tell which is which.
- Mode Router = a six-state machine per session (`coding / IDE / helping / advisor /
  deepsleep / goal`). Transitions fire **context firewalls** on entry to a mode: tool-table
  swap, output-tag allowlist, context partition reset (`§2.3` mode-cross-contamination guard).

## 5. Defense Pipeline (the antivirus layer)

Three checkpoints on every round, one shared signature database:

```
inbound scan ──▶ call validation ──▶ outbound check
(user msgs,      (5 gates, §6)       (answer gate, secret
 tool results,                          re-scan before
 file content                           anything leaves)
 enters context)
```

**Inbound scan** — everything destined for model context: user messages, tool results,
file content read from disk. Signature database (hot-updatable): known jailbreak shapes
("ignore previous instructions", pseudo-system markers, authority claims). Hit → intercept.

**Interception handling — four orthogonal dials `[TA 12:58 ratified]`:**
1. *Model visibility*: intercepted content becomes a **placeholder marker** in context —
   the model sees THAT something was blocked, but the content carries no instruction force.
2. *Audit granularity*: per-signature-type tiered logging (counter-only for noise sigs,
   full capture + position + sig id for serious ones).
3. *Recovery*: human release (quarantine-restore semantics) — a released item replays into
   the next round.
4. *Position sensitivity*: inbound-vs-tool-result-vs-model-output may run different
   policies (three interception sites, independently configurable).

**Call validation — five gates per tool call:**
G1 tool exists (else `unknown-tool` — nothing ran);
G2 argument shape (else `unknown-args`);
G3 workspace boundary + hidden-path denial (`.env`, `.git` — `denied`, no shape gets in);
G4 deletion-verb scan on every command: hit reroutes through `delete` (trash), no exceptions;
G5 test-set write protection.

**Outbound check** — the answer gate: REMINDER completeness check whose STRENGTH is
tiered by token level `[TA 12:58]`:

| token tier | gate behavior |
|---|---|
| above `unlimited` | hard reject — session must add missing lines before answering |
| at/below `unlimited` | user-configurable |
| at/below `default` | never rejects (pass-through) |

The six-tier constitution (§Token) couples to the gate: strictness is a policy dial,
not a constant. `[CHURN: exact tier mapping]`

## 6. Agent Core — the round loop

```rust
loop {
    let prompt = harness.assemble(mode_ctx, split_point, agents_md, skills); // SPLIT POINT injection
    let reply  = provider.complete(prompt).await;                            // async, resumable
    let (speech, calls) = parse_calls(reply);                                // angle-tag protocol [CHURN]
    let cleared = defense.validate_calls(calls)?;                           // five gates
    let results = exec.execute(cleared, &workspace_registry).await;          // passive re-validation:
                                                                             // files re-checked on EVERY
                                                                             // tool exec; changed status
                                                                             // rides in the result [TA]
    let block   = harness.render_results(results);                           // square-bracket + status-lines [CHURN]
    msgs.push(block);
    if let Some(answer) = gate.answer(reply, tier) { break answer; }         // §5 outbound check
}
```

- **Passive file validation `[TA 12:58]`**: no file watcher. Any tool execution re-validates
  the files it touches; `changed` rides in the tool result (contract-first: if the checker
  isn't implemented, `changed` never appears — the clause sleeps, it does not lie).
- **Concurrent writes — first-writer-wins `[TA 12:58]`**: the first write lands; a
  synchronized second writer gets a rejection status, message in English:
  `"Another process or session is modifying this file; the edit is blocked for now."`
  No queue, no version vectors — conflicts are rejected, not serialized.
- Async commands: background dispatch with id handles, resume continuation lines —
  all `[CHURN: wire protocol]`.

## 7. Harness Services (cross-session singletons)

- **Read registry**: which files which session has truly read; powers re-read interception
  (`held`) and changed-marking. Per-session trust — session B does NOT inherit session A's
  reads (isolation default; cross-session inheritance is a config flag, default off).
- **Compression executor**: runs when a session nears context budget; summary must
  self-declare, preserve version numbers/ids/verdicts verbatim, and state plainly what
  was dropped (§Memory discipline).
- **REMINDER store**: the answer-gate's data source; cross-session visible.
- **Skill loader**: three-piece set (full-load name+description / remove-skill /
  load log) — §12 unchanged.

## 8. Deepsleep Engine & Advisor Bridge

- **Clean instance**: fresh context, deepsleep system prompt + skill, explores agent's
  output chains and archives; writes ONLY via `edit-solo` to SOLO.md (promotion-gated).
- **Staging queue** (SQLite + FTS5, same store as archives `[K3]`): three intake channels
  unify here — `/improve` inline, advisor structured, implicit mining.
- **Trigger criteria (code-enforced)**: same-class error ×2 OR user correction ×3 →
  force-invocation. Same-class detection = **signature hash (mechanical, in-kernel) +
  implicit-mining channel (model-side)**; advisor classification is deliberately NOT in the
  critical path `[TA: advisor stays thin]`.
- **Three-lock exit protocol**: self-confirmation gate → anti-testament ("your messages
  will not return to the user") → `</deepsleep-pause/>` out-of-distribution format.
- **Wake briefing**: re-invocation = new-rules commit point; the briefing is the ONLY
  channel through which the sleeping agent learns its files changed.
- **Digest model `[TA 12:58]`**: defaults to the SAME model as the main conversation
  (context-format match); overridable per config; switching tiers is weighed against
  self-run model evaluation cost (token burn, uncertain accuracy — do not switch blind).
- **Advisor bridge**: pause semantics (agent loop suspends, not killed) + annotation
  ingestion into staging + auto-chain into deepsleep digestion. Annotation structure
  stays minimal — classification at most.

## 9. Provider Layer & Plugin Host

- Built-in trio: OpenAI **Chat Completions**, OpenAI **Responses**, Anthropic **Messages**.
  Four-tuple per adapter: request / response / streaming / tool-call mapping. Thinking-
  visibility field (full / summary / none) is auto-filled by the adapter.
- **Provider IS a plugin `[TA]`** — the built-ins are just shipped-by-default.
- Plugin host — per-mount-point permission spectrum `[post-12:50 redesign, spectrum not
  tiers]`: each mount point (provider / tool / router-policy / UI) sits independently on
  an in-process ↔ out-of-process ↔ forbidden continuum. Ratified so far: in-process is
  reserved for provider adapters, language analyzers (tree-sitter wrappers), encoders.
  Round loop, defense pipeline, answer gate, sig DB, SOLO.md channel, archive writes are
  **never mountable** — plugins may add senses and tools, never a soul.
- Speed accounting: only provider adaptation and text scanning are hot paths; tool-class
  calls are round-granular (ms-level IPC is noise there). The spectrum costs nothing
  where it matters.

## 10. IPC (client-facing)

One protocol, both clients. Session open/close, mode switch, round streaming (events:
`speech`, `call`, `result`, `answer`), REMINDER presentation, button/confirmation
round-trips (CLI renders these as clickable; desktop as buttons). `[CHURN: event schema]`

## 11. Test strategy

- The three experiment benches (hallu-replay / remind-probe / pid-probe) remain the
  **protocol verification layer** — protocol changes prove out there (cheap, fast) before
  entering the kernel. Kernel Rust tests then assert the same behaviors.
- Defense pipeline gets its own red-team pack (weak-test lineage): known jailbreak corpus
  + interception dials + quarantine/restore cycle.
- Benches in `bench/`: loop latency (target: defense adds < 5% round overhead),
  provider adapter throughput, registry check cost.

## 12. Open items (non-blocking for scaffolding)

| # | Item | Status |
|---|---|---|
| O1 | Plugin permission spectrum drawing (per mount point) | pending |
| O2 | IPC event schema draft | pending |
| O3 | Sig DB v0 corpus (first ~20 signatures from weak-test-pack evidence) | pending |
| O4 | Desktop shell scaffold (Tauri) — separate doc | pending |
| O5 | Six-mode state machine transition table formal pass | pending |
| O6 | Interception dial config file format | pending |

— END OF FOUNDATION DESIGN. NOT FINAL. —
