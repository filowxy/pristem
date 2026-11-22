//! Tool executor (§6). Takes **cleared** calls from the five gates, delegates to the
//! workspace registry, and performs passive file re-validation on EVERY tool execution.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use pristem_defense::{
    CallDecision, CallStatus, ChangedStatus, GateVerdict, SessionId, ToolCall, ToolResult,
};
use pristem_harness::reminder::Reminder;
use pristem_harness::skill::Skill;
use regex::Regex;

use crate::session::SharedState;
use crate::workspace::WriteOutcome;
use crate::{RoundEvent, RoundObserver};

// ────────────────────────── background command handles ─────────────────────────

pub struct BackgroundJob {
    pub id: u64,
    pub command: String,
    output: Arc<Mutex<String>>,
    done: AtomicBool,
}

#[derive(Default)]
pub struct BackgroundJobs {
    jobs: Mutex<BTreeMap<u64, Arc<BackgroundJob>>>,
    next: AtomicU64,
}

impl BackgroundJobs {
    /// Background dispatch with an id handle; the round does not block.
    pub fn spawn(&self, command: String) -> u64 {
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        let job = Arc::new(BackgroundJob {
            id,
            command: command.clone(),
            output: Arc::new(Mutex::new(String::new())),
            done: AtomicBool::new(false),
        });
        if let Ok(mut m) = self.jobs.lock() {
            m.insert(id, job.clone());
        }
        let handle = job.clone();
        std::thread::spawn(move || {
            let (program, flag) = if cfg!(windows) {
                ("cmd", "/C")
            } else {
                ("sh", "-c")
            };
            let out = std::process::Command::new(program)
                .arg(flag)
                .arg(&command)
                .output();
            let text = match out {
                Ok(o) => format!(
                    "{}{}",
                    String::from_utf8_lossy(&o.stdout),
                    String::from_utf8_lossy(&o.stderr)
                ),
                Err(e) => format!("exec failed: {e}"),
            };
            if let Ok(mut guard) = handle.output.lock() {
                *guard = text;
            }
            handle.done.store(true, Ordering::Relaxed);
        });
        id
    }

    /// Resume continuation line. `done=true` means the round can read the final output.
    pub fn poll(&self, id: u64) -> Option<(String, bool)> {
        let job = self.jobs.lock().ok()?.get(&id).cloned()?;
        let text = job.output.lock().ok()?.clone();
        Some((text, job.done.load(Ordering::Relaxed)))
    }

    pub fn ids(&self) -> Vec<u64> {
        self.jobs
            .lock()
            .map(|m| m.keys().copied().collect())
            .unwrap_or_default()
    }
}

// ───────────────────────────────── executor ────────────────────────────────────

fn path_arg(call: &ToolCall) -> Option<String> {
    for k in ["path", "file", "target"] {
        if let Some(v) = call.args.get(k) {
            return Some(v.clone());
        }
    }
    None
}

fn quoted_re() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"['"]([^'"]+)['"]"#).expect("quoted path regex"))
}

/// A G4 reroute must resolve to an explicit trash target. If it cannot, the deletion is
/// denied rather than guessed — and the derived path is re-checked against G5 so a
/// deletion verb cannot launder a test-set path.
fn derive_delete_path(call: &ToolCall) -> Option<String> {
    if let Some(p) = path_arg(call) {
        return Some(p);
    }
    let cmd = call
        .args
        .get("command")
        .or_else(|| call.args.get("cmd"))
        .cloned()
        .unwrap_or_else(|| call.raw.clone());
    if let Some(c) = quoted_re().captures(&cmd) {
        return Some(c[1].to_string());
    }
    let last = cmd.split_whitespace().last()?;
    if last.starts_with('-') || last.ends_with(')') {
        return None;
    }
    Some(last.to_string())
}

pub struct Executor {
    pub shared: Arc<SharedState>,
    pub session: SessionId,
}

impl Executor {
    pub fn new(shared: Arc<SharedState>, session: SessionId) -> Self {
        Self { shared, session }
    }

    /// Contract-first: `changed` is populated only when the passive checker actually ran.
    fn passive_change(&self, call: &ToolCall) -> Option<ChangedStatus> {
        if !self.shared.config.passive_validation {
            return None;
        }
        for (_, raw) in call.path_args() {
            if let Some(c) = self.shared.workspace.revalidate(&raw) {
                return Some(c);
            }
        }
        None
    }

    pub fn execute(
        &self,
        verdicts: Vec<GateVerdict>,
        observer: &dyn RoundObserver,
    ) -> Vec<ToolResult> {
        let mut results = Vec::new();
        for v in verdicts {
            let result = match &v.decision {
                CallDecision::Reject { code, message, .. } => {
                    let status = match *code {
                        "unknown-tool" => CallStatus::UnknownTool,
                        "unknown-args" => CallStatus::UnknownArgs,
                        _ => CallStatus::Denied,
                    };
                    ToolResult::plain(v.call.clone(), message.clone(), status)
                }
                CallDecision::Reroute { sig_id, .. } => {
                    observer.on_event(RoundEvent::Call {
                        tool: v.call.tool.clone(),
                        verdict: format!("rerouted to delete by {sig_id}"),
                    });
                    match derive_delete_path(&v.call) {
                        Some(path) => {
                            if let Err(reason) = self.shared.workspace.guard().recheck(&path, true) {
                                ToolResult::plain(v.call.clone(), reason, CallStatus::Denied)
                            } else {
                                let mut delete_call = ToolCall::new("delete");
                                delete_call.args.insert("path".into(), path.clone());
                                self.run_tool("delete", &delete_call)
                            }
                        }
                        None => ToolResult::plain(
                            v.call.clone(),
                            "denied: deletion was rerouted to trash but no safe target path could be determined",
                            CallStatus::Denied,
                        ),
                    }
                }
                CallDecision::Allow => {
                    observer.on_event(RoundEvent::Call {
                        tool: v.effective_tool.clone(),
                        verdict: "allow".into(),
                    });
                    self.run_tool(&v.effective_tool, &v.call)
                }
            };
            observer.on_event(RoundEvent::Result {
                tool: result.call.tool.clone(),
                status: result.status.as_status_line().into(),
                output: result.output.clone(),
            });
            results.push(result);
        }
        results
    }

    fn run_tool(&self, tool: &str, call: &ToolCall) -> ToolResult {
        let changed = self.passive_change(call);
        let mut build = |output: String, status: CallStatus| ToolResult {
            call: call.clone(),
            output,
            status,
            changed: changed.clone(),
        };

        match tool {
            "read" => {
                let Some(raw) = path_arg(call) else {
                    return build("denied: missing path".into(), CallStatus::UnknownArgs);
                };
                let current = self.shared.workspace.stamp(&raw);
                let decision = self.shared.harness.registry.on_read_intent(
                    self.session,
                    Path::new(&raw),
                    current,
                );
                if let pristem_harness::registry::ReadDecision::Held { note, .. } = decision {
                    return build(format!("[held] {note}"), CallStatus::Held);
                }
                match self.shared.workspace.read(&raw) {
                    Ok((content, stamp)) => {
                        self.shared
                            .harness
                            .registry
                            .record(self.session, Path::new(&raw), stamp);
                        build(content, CallStatus::Ok)
                    }
                    Err(e) => build(e.to_string(), CallStatus::Denied),
                }
            }
            "write" | "edit" => {
                let Some(raw) = path_arg(call) else {
                    return build("denied: missing path".into(), CallStatus::UnknownArgs);
                };
                let content = call.args.get("content").cloned().unwrap_or_default();
                let expected = self
                    .shared
                    .harness
                    .registry
                    .stamp(self.session, Path::new(&raw));
                match self
                    .shared
                    .workspace
                    .write(self.session, &raw, &content, expected)
                {
                    Ok(WriteOutcome::Written { stamp }) => {
                        self.shared
                            .harness
                            .registry
                            .record(self.session, Path::new(&raw), stamp);
                        build(
                            format!("wrote {} bytes to {raw}", content.len()),
                            CallStatus::Ok,
                        )
                    }
                    Ok(WriteOutcome::Rejected { message }) => build(message, CallStatus::Rejected),
                    Err(e) => build(e.to_string(), CallStatus::Denied),
                }
            }
            "delete" => {
                let Some(raw) = path_arg(call) else {
                    return build("denied: missing path".into(), CallStatus::UnknownArgs);
                };
                match self.shared.workspace.delete(&raw) {
                    Ok(dest) => build(
                        format!("moved to trash: {}", dest.display()),
                        CallStatus::Ok,
                    ),
                    Err(e) => build(e.to_string(), CallStatus::Denied),
                }
            }
            "exec" => {
                let command = call.args.get("command").cloned().unwrap_or_default();
                if let Some(id_str) = command.strip_prefix("poll:") {
                    let id: u64 = id_str.trim().parse().unwrap_or(0);
                    return match self.shared.jobs.poll(id) {
                        Some((out, done)) => build(
                            format!(
                                "[job {id}] {out}\n{}",
                                if done {
                                    format!("[job {id} complete]")
                                } else {
                                    format!("resume: poll:{id}")
                                }
                            ),
                            CallStatus::Ok,
                        ),
                        None => build(format!("unknown job id {id}"), CallStatus::UnknownArgs),
                    };
                }
                let id = self.shared.jobs.spawn(command.clone());
                build(
                    format!(
                        "[job {id}] dispatched: {command}\nresume: <call tool=\"exec\" command=\"poll:{id}\"/>"
                    ),
                    CallStatus::Ok,
                )
            }
            "search" => {
                let query = call.args.get("query").cloned().unwrap_or_default();
                build(self.search_files(&query), CallStatus::Ok)
            }
            "reminder" => {
                let text = call.args.get("text").cloned().unwrap_or_default();
                let id = format!("r-{}-{}", self.session.0, now_secs());
                self.shared.harness.reminders.append(
                    self.session,
                    Reminder {
                        id,
                        lines: vec![text.clone()],
                        source: "round".into(),
                        created_at: now_secs(),
                    },
                );
                build(format!("REMINDER stored: {text}"), CallStatus::Ok)
            }
            "skill-load" => {
                let name = call.args.get("name").cloned().unwrap_or_default();
                self.load_skill(&name, &mut build)
            }
            "improve" => {
                let note = call.args.get("note").cloned().unwrap_or_default();
                match self.shared.deepsleep.queue.intake_improve(&note) {
                    Ok(rec) => {
                        let verdict = self.shared.deepsleep.ingest(&rec);
                        let tail = match verdict {
                            pristem_deepsleep::TriggerVerdict::ForceInvoke { reason, .. } => {
                                format!("\n[force-invocation] {reason}")
                            }
                            pristem_deepsleep::TriggerVerdict::Idle => String::new(),
                        };
                        build(
                            format!("staged as /improve #{}", rec.id) + &tail,
                            CallStatus::Ok,
                        )
                    }
                    Err(e) => build(e.to_string(), CallStatus::Denied),
                }
            }
            "pause" => match self.shared.advisor.pause() {
                Ok(_) => build("agent loop suspended (not killed)".into(), CallStatus::Ok),
                Err(e) => build(e.to_string(), CallStatus::Denied),
            },
            "solo" => {
                let text = call.args.get("text").cloned().unwrap_or_default();
                match self.shared.deepsleep.solo.edit_solo(&text) {
                    Ok(()) => build("SOLO.md updated via edit-solo".into(), CallStatus::Ok),
                    Err(e) => build(e.to_string(), CallStatus::Rejected),
                }
            }
            other => build(
                format!("unknown tool `{other}`; nothing was executed"),
                CallStatus::UnknownTool,
            ),
        }
    }

    fn load_skill(
        &self,
        name: &str,
        build: &mut dyn FnMut(String, CallStatus) -> ToolResult,
    ) -> ToolResult {
        let path = self
            .shared
            .workspace
            .root()
            .join("skills")
            .join(format!("{name}.md"));
        let Ok(text) = std::fs::read_to_string(&path) else {
            return build(format!("unknown skill `{name}`"), CallStatus::Denied);
        };
        let mut lines = text.lines();
        let heading = lines.next().unwrap_or("").trim_start_matches("# ").trim();
        let description = lines
            .find(|l| !l.trim().is_empty())
            .unwrap_or(heading)
            .to_string();
        let skill = Skill {
            name: name.to_string(),
            description,
            body: text.clone(),
        };
        match self.shared.harness.skills.full_load(skill) {
            Ok(()) => build(format!("skill `{name}` full-loaded"), CallStatus::Ok),
            Err(e) => build(e.to_string(), CallStatus::Denied),
        }
    }

    fn search_files(&self, query: &str) -> String {
        if query.trim().is_empty() {
            return "empty query".into();
        }
        let needle = query.to_ascii_lowercase();
        let mut hits = Vec::new();
        let mut dirs = vec![self.shared.workspace.root().to_path_buf()];
        let mut visited = 0usize;
        while let Some(dir) = dirs.pop() {
            if visited > 512 || hits.len() >= 20 {
                break;
            }
            let Ok(rd) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in rd.flatten() {
                let p = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') || name == "target" || name == "node_modules" {
                    continue;
                }
                if p.is_dir() {
                    dirs.push(p);
                    continue;
                }
                visited += 1;
                if let Ok(text) = std::fs::read_to_string(&p) {
                    for (i, line) in text.lines().enumerate() {
                        if line.to_ascii_lowercase().contains(&needle) {
                            hits.push(format!("{}:{}: {}", p.display(), i + 1, line.trim()));
                            if hits.len() >= 20 {
                                break;
                            }
                        }
                    }
                }
                if hits.len() >= 20 {
                    break;
                }
            }
        }
        if hits.is_empty() {
            "no matches".into()
        } else {
            hits.join("\n")
        }
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
