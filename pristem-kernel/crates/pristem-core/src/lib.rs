//! # pristem-core — the kernel logic plane (§4 / §6).
//!
//! `SessionManager` owns session lifecycle and the cross-session singletons; `ModeRouter`
//! is a six-state machine whose every entry fires a context firewall; `AgentLoop` runs the
//! round loop:
//!
//! ```text
//! assemble ─▶ complete ─▶ parse_calls ─▶ validate_calls ─▶ execute ─▶ render ─▶ gate
//! ```
//!
//! All capability lives here. `pristem-ipc` knows this crate; nothing here knows `ipc`.
//! Round events are emitted through the core-owned [`RoundObserver`] trait so the client
//! protocol can map them without creating a dependency cycle.

pub mod agent_loop;
pub mod executor;
pub mod mode;
pub mod session;
pub mod workspace;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use pristem_deepsleep::DeepsleepConfig;
use pristem_defense::{GatePolicy, TestSetPolicy, TokenTier};
use pristem_plugin::MountPolicy;
use pristem_provider::ProviderConfig;
use serde::{Deserialize, Serialize};

pub use agent_loop::{AgentLoop, RoundOutcome};
pub use executor::{BackgroundJobs, Executor};
pub use mode::{ContextFirewall, Mode, ModeError, ModeRouter, TransitionRule};
pub use session::{Kernel, Session, SessionId, SessionManager, SharedState};
pub use workspace::{WorkspaceError, WorkspaceRegistry, WriteOutcome, WRITE_CONFLICT_MESSAGE};

fn default_dot() -> PathBuf {
    PathBuf::from(".")
}
fn default_sigdb() -> PathBuf {
    PathBuf::from("sigdb")
}
fn default_slots() -> usize {
    4
}
fn default_rounds() -> usize {
    12
}
fn default_true() -> bool {
    true
}

/// `config/kernel.json`. Every section is optional so a partial override file works.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct KernelConfig {
    #[serde(default)]
    pub schema: String,
    #[serde(default = "default_dot")]
    pub workspace_root: PathBuf,
    #[serde(default = "default_sigdb")]
    pub sigdb_dir: PathBuf,
    #[serde(default)]
    pub token_tier: TokenTier,
    #[serde(default = "default_slots")]
    pub worker_slots: usize,
    #[serde(default = "default_rounds")]
    pub max_rounds: usize,
    #[serde(default = "default_true")]
    pub passive_validation: bool,
    #[serde(default)]
    pub provider: ProviderConfig,
    #[serde(default)]
    pub gate: GatePolicy,
    #[serde(default)]
    pub test_set: TestSetPolicy,
    #[serde(default)]
    pub plugin_policy: MountPolicy,
    #[serde(default)]
    pub deepsleep: DeepsleepConfig,
}

impl Default for KernelConfig {
    fn default() -> Self {
        Self {
            schema: "pristem.kernel/v1".into(),
            workspace_root: PathBuf::from("."),
            sigdb_dir: PathBuf::from("sigdb"),
            token_tier: TokenTier::Default,
            worker_slots: 4,
            max_rounds: 12,
            passive_validation: true,
            provider: ProviderConfig::default(),
            gate: GatePolicy::default(),
            test_set: TestSetPolicy::default(),
            plugin_policy: MountPolicy::default(),
            deepsleep: DeepsleepConfig::default(),
        }
    }
}

impl KernelConfig {
    pub fn from_json(json: &str) -> Result<Self, KernelError> {
        serde_json::from_str(json).map_err(|e| KernelError::Config(e.to_string()))
    }

    /// Relative paths inside the config are resolved against the *workspace root* (the
    /// parent of the config directory), not the process CWD — vital because `cargo test`
    /// runs each test binary with a different CWD.
    pub fn load(path: &Path) -> Result<Self, KernelError> {
        let text = std::fs::read_to_string(path).map_err(|e| KernelError::Io(e.to_string()))?;
        let mut cfg = Self::from_json(&text)?;
        let base = path.parent().unwrap_or(Path::new(".")).join("..");
        if cfg.workspace_root.is_relative() {
            cfg.workspace_root = base.join(&cfg.workspace_root);
        }
        if cfg.sigdb_dir.is_relative() {
            cfg.sigdb_dir = base.join(&cfg.sigdb_dir);
        }
        Ok(cfg)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum KernelError {
    #[error("config error: {0}")]
    Config(String),
    #[error("io error: {0}")]
    Io(String),
    #[error("sigdb error: {0}")]
    Sigdb(String),
    #[error("plugin host error: {0}")]
    Plugin(String),
    #[error("provider error: {0}")]
    Provider(String),
    #[error("workspace error: {0}")]
    Workspace(String),
    #[error(transparent)]
    Mode(#[from] ModeError),
    #[error("unknown session {0}")]
    UnknownSession(SessionId),
    #[error("no session slots available (worker_slots exhausted)")]
    SlotsExhausted,
}

impl From<pristem_defense::SigdbError> for KernelError {
    fn from(e: pristem_defense::SigdbError) -> Self {
        Self::Sigdb(e.to_string())
    }
}
impl From<pristem_provider::ProviderError> for KernelError {
    fn from(e: pristem_provider::ProviderError) -> Self {
        Self::Provider(e.to_string())
    }
}
impl From<WorkspaceError> for KernelError {
    fn from(e: WorkspaceError) -> Self {
        Self::Workspace(e.to_string())
    }
}
impl From<pristem_plugin::PluginHostError> for KernelError {
    fn from(e: pristem_plugin::PluginHostError) -> Self {
        Self::Plugin(e.to_string())
    }
}

/// Core-owned round events. `pristem-ipc` maps these into wire events; the kernel never
/// imports an IPC type.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RoundEvent {
    /// Whole model utterance, emitted once the round's completion is parsed.
    Speech(String),
    /// One streamed fragment, emitted only when `provider.stream` is on. Renderers that
    /// don't handle it still get the final `Answer`.
    SpeechDelta(String),
    Call {
        tool: String,
        verdict: String,
    },
    Result {
        tool: String,
        status: String,
        output: String,
    },
    Intercepted {
        sig_ids: Vec<String>,
        position: String,
        /// Needed by the IPC button/confirmation round-trip (human release, dial 3).
        quarantine_ids: Vec<u64>,
    },
    MissingReminder {
        lines: Vec<String>,
        reject: bool,
    },
    DigestRequested {
        reason: String,
    },
    Answer(String),
    /// One provider completion's token accounting. Emitted after each model reply;
    /// observers accumulate across the (possibly multi-step) round.
    Usage {
        input_tokens: u64,
        output_tokens: u64,
        cached_tokens: u64,
    },
    ModeChanged {
        from: String,
        to: String,
    },
    Error(String),
}

pub trait RoundObserver: Send + Sync {
    fn on_event(&self, event: RoundEvent);
}

/// A no-op observer for headless / bench use.
pub struct NoopObserver;
impl RoundObserver for NoopObserver {
    fn on_event(&self, _event: RoundEvent) {}
}

/// Collects round events; used by tests, the protocol probes and the CLI's `--once` mode.
#[derive(Clone, Default)]
pub struct RecordingObserver {
    pub events: Arc<std::sync::Mutex<Vec<RoundEvent>>>,
}
impl RecordingObserver {
    pub fn snapshot(&self) -> Vec<RoundEvent> {
        self.events.lock().map(|e| e.clone()).unwrap_or_default()
    }
}
impl RoundObserver for RecordingObserver {
    fn on_event(&self, event: RoundEvent) {
        if let Ok(mut e) = self.events.lock() {
            e.push(event);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shipped_kernel_config_deserializes_completely() {
        let json = include_str!("../../../config/kernel.json");
        let cfg = KernelConfig::from_json(json).unwrap();
        assert_eq!(cfg.schema, "pristem.kernel/v1");
        assert_eq!(cfg.token_tier, TokenTier::Default);
        assert_eq!(cfg.worker_slots, 4);
        assert!(cfg.passive_validation);
        assert_eq!(cfg.plugin_policy.rules.len(), 6);
        assert_eq!(cfg.deepsleep.same_class_error_threshold, 2);
    }

    #[test]
    fn partial_config_uses_safe_defaults() {
        let cfg = KernelConfig::from_json(r#"{"token_tier":"above_unlimited"}"#).unwrap();
        assert_eq!(cfg.token_tier, TokenTier::AboveUnlimited);
        assert_eq!(cfg.max_rounds, 12);
        assert_eq!(cfg.provider.default, "openai-chat");
    }

    #[test]
    fn load_resolves_relative_paths_against_the_config_parent_parent() {
        let cfg_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../config/kernel.json");
        let cfg = KernelConfig::load(&cfg_path).unwrap();
        assert!(
            cfg.workspace_root.is_absolute() || cfg.workspace_root.to_string_lossy().contains("..")
        );
        let sigdb = cfg.sigdb_dir.join("signatures.json");
        assert!(sigdb.exists(), "sigdb must resolve to {}", sigdb.display());
    }
}
