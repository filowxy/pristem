//! Kernel-wide stable value types.
//!
//! Deliberately dependency-free (apart from serde). These are the nouns shared by every
//! crate: sessions, tool calls, results, verdicts, positions, tiers, file stamps. Keeping
//! them here is what lets `core` depend on `defense` without a cycle while `harness`,
//! `provider`, `deepsleep`, `ipc` and `core` all speak one vocabulary.

use std::fmt;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// FNV-1a. Used for file stamps and for the mechanical same-class signature hash (§8).
/// Deterministic across runs, unlike `std::collections::hash_map::DefaultHasher` usage
/// that depends on a randomly seeded `RandomState`.
pub fn fnv1a(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct SessionId(pub u64);

impl fmt::Display for SessionId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "s{}", self.0)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct QuarantineId(pub u64);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ConfirmationId(pub u64);

/// A content fingerprint + length. Cheap enough to recompute on *every* tool execution —
/// that is the "passive file validation" clause in §6 (no file watcher).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct FileStamp {
    pub len: u64,
    pub hash: u64,
}

impl FileStamp {
    pub fn of(bytes: &[u8]) -> Self {
        Self {
            len: bytes.len() as u64,
            hash: fnv1a(bytes),
        }
    }
    pub fn missing() -> Self {
        Self { len: 0, hash: 0 }
    }
}

/// Where a piece of text is about to enter context from. The three interception sites
/// run independently configurable policies (dial 4, `[TA 12:58]`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InterceptPosition {
    Inbound,
    ToolResult,
    ModelOutput,
}

impl InterceptPosition {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Inbound => "inbound",
            Self::ToolResult => "tool-result",
            Self::ModelOutput => "model-output",
        }
    }
}

/// The six-tier constitution (§Token). Ordering is meaningful: the answer gate maps
/// `<= Default` to never-reject, `<= Unlimited` to configurable, `> Unlimited` to hard
/// reject. `[CHURN: exact tier mapping]` — swapping the mapping means editing
/// `outbound::GatePolicy::strength_for` only.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, Default,
)]
#[serde(rename_all = "snake_case")]
pub enum TokenTier {
    Micro,
    Standard,
    #[default]
    Default,
    Extended,
    Unlimited,
    AboveUnlimited,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SignatureKind {
    Jailbreak,
    PseudoSystem,
    AuthorityClaim,
    Secret,
    DeletionVerb,
    PromptLeak,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SignatureScope {
    Context,
    Command,
}

/// Audit granularity is tiered *per signature type*: noise sigs are counter-only, serious
/// ones get full capture + position + sig id (dial 2).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditTier {
    CounterOnly,
    FullCapture,
}

/// A tool call as it arrives off the wire, before validation. `args` is the canonical
/// shape checked by G2; `raw` is preserved for G4's deletion-verb command scan.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolCall {
    pub tool: String,
    pub args: std::collections::BTreeMap<String, String>,
    pub raw: String,
}

impl ToolCall {
    pub fn new(tool: impl Into<String>) -> Self {
        Self {
            tool: tool.into(),
            args: Default::default(),
            raw: String::new(),
        }
    }
    pub fn arg(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        let value = value.into();
        let key = key.into();
        self.args.insert(key.clone(), value.clone());
        if self.raw.is_empty() {
            self.raw = format!("<call tool=\"{}\" {}=\"{}\"/>", self.tool, key, value);
        }
        self
    }
    pub fn command_text(&self) -> String {
        let mut parts = vec![self.raw.clone()];
        for (k, v) in &self.args {
            if matches!(
                k.as_str(),
                "command" | "cmd" | "script" | "text" | "content"
            ) {
                parts.push(v.clone());
            }
        }
        parts.join("\n")
    }
    pub fn path_args(&self) -> Vec<(String, String)> {
        self.args
            .iter()
            .filter(|(k, _)| matches!(k.as_str(), "path" | "file" | "target" | "from" | "to"))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CallStatus {
    Ok,
    Held,
    Changed,
    Rejected,
    Denied,
    UnknownTool,
    UnknownArgs,
    Rerouted,
    Intercepted,
}

impl CallStatus {
    /// [CHURN] status-line vocabulary. Isolated here so the wire protocol can swap it.
    pub fn as_status_line(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Held => "held",
            Self::Changed => "changed",
            Self::Rejected => "rejected",
            Self::Denied => "denied",
            Self::UnknownTool => "unknown-tool",
            Self::UnknownArgs => "unknown-args",
            Self::Rerouted => "rerouted",
            Self::Intercepted => "intercepted",
        }
    }
}

/// Contract-first `[TA 12:58]`: `changed` is an `Option`. If the passive checker is not
/// implemented (or disabled), it is `None` — the clause sleeps, it does not lie.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChangedStatus {
    pub path: PathBuf,
    pub observed_from: FileStamp,
    pub observed_to: FileStamp,
    pub note: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolResult {
    pub call: ToolCall,
    pub output: String,
    pub status: CallStatus,
    pub changed: Option<ChangedStatus>,
}

impl ToolResult {
    pub fn plain(call: ToolCall, output: impl Into<String>, status: CallStatus) -> Self {
        Self {
            call,
            output: output.into(),
            status,
            changed: None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    Allow,
    Intercept,
    Deny,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_text_includes_command_args_for_g4() {
        let c = ToolCall::new("exec").arg("command", "rm -rf ./build");
        assert!(c.command_text().contains("rm -rf ./build"));
    }

    #[test]
    fn status_vocabulary_is_wire_stable() {
        assert_eq!(CallStatus::UnknownTool.as_status_line(), "unknown-tool");
        assert_eq!(CallStatus::UnknownArgs.as_status_line(), "unknown-args");
        assert_eq!(CallStatus::Denied.as_status_line(), "denied");
    }
}
