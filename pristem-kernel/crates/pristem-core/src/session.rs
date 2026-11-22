//! Session manager (§4) and the composition root.
//!
//! `SharedState` holds the cross-session singletons — REMINDER store, archives / staging
//! queue, read registry, sig DB, plugin host, provider registry. Every session gets one
//! OS thread-pool slot (`tokio::sync::Semaphore` permit held for the session's lifetime).
//!
//! Client-agnostic: CLI and desktop both enter through `pristem-ipc`; nothing in this
//! module branches on client kind, and all six modes exist in the kernel.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use pristem_advisor::AdvisorBridge;
use pristem_deepsleep::DeepsleepEngine;
use pristem_defense::{
    AnswerGate, CallValidator, DefensePipeline, InterceptionPolicy, SignatureDb,
};
use pristem_harness::HarnessServices;
use pristem_plugin::PluginHost;
use pristem_provider::{install_builtins, ProviderConfig, ProviderRegistry, Transport};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

pub use pristem_defense::SessionId;

use crate::agent_loop::AgentLoop;
use crate::executor::BackgroundJobs;
use crate::mode::{ContextFirewall, Mode, ModeRouter};
use crate::workspace::WorkspaceRegistry;
use crate::{KernelConfig, KernelError, RoundEvent, RoundObserver, RoundOutcome};

pub const DEFAULT_AGENTS_MD: &str = "\
# AGENTS.md
You are pristem, a resident agent. Obey the active mode's tool table and output tags.
Tool calls use <call tool=\"...\" .../>; finish with <answer>...</answer>.
Never claim a file changed unless the tool result carries a `changed:` status line.";

/// The cross-session singletons. Constructed once by `SessionManager::new`.
pub struct SharedState {
    pub config: KernelConfig,
    pub harness: Arc<HarnessServices>,
    pub defense: Arc<DefensePipeline>,
    pub workspace: Arc<WorkspaceRegistry>,
    pub providers: Arc<ProviderRegistry>,
    pub plugin_host: Arc<PluginHost>,
    pub deepsleep: Arc<DeepsleepEngine>,
    pub advisor: Arc<AdvisorBridge>,
    pub jobs: Arc<BackgroundJobs>,
    pub agents_md: String,
    pub sigdb_version: String,
}

pub struct Session {
    pub id: SessionId,
    pub mode: Mutex<ModeRouter>,
    pub created_at: u64,
    /// Held for the session's whole lifetime: one slot per active session.
    _slot: OwnedSemaphorePermit,
}

pub struct SessionManager {
    pub shared: Arc<SharedState>,
    sessions: RwLock<BTreeMap<SessionId, Arc<Session>>>,
    slots: Arc<Semaphore>,
    next: AtomicU64,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn build_shared(
    config: KernelConfig,
    transport: Arc<dyn Transport>,
) -> Result<Arc<SharedState>, KernelError> {
    let db = SignatureDb::load_from_path(&config.sigdb_dir.join("signatures.json"))?;
    let sigdb_version = db.version();
    let policy_json = std::fs::read_to_string(config.sigdb_dir.join("interception-policy.json"))
        .map_err(|e| KernelError::Io(e.to_string()))?;
    let policy = InterceptionPolicy::from_json(&policy_json)
        .map_err(|e| KernelError::Config(e.to_string()))?;

    let validator = CallValidator::new(config.workspace_root.clone(), config.test_set.clone())
        .with_signature_db(db.clone());
    let defense = Arc::new(DefensePipeline::new(
        db,
        policy,
        validator,
        AnswerGate::new(config.gate.clone()),
    )?);
    let workspace = Arc::new(WorkspaceRegistry::new(
        config.workspace_root.clone(),
        config.test_set.clone(),
    )?);
    let plugin_host = Arc::new(PluginHost::new(config.plugin_policy.clone())?);
    let providers = Arc::new(install_builtins(&config.provider, transport, &plugin_host)?);
    let deepsleep = Arc::new(DeepsleepEngine::in_memory(config.deepsleep.clone()));
    let advisor = Arc::new(AdvisorBridge::new(deepsleep.queue.clone()));
    let agents_md = std::fs::read_to_string(config.workspace_root.join("AGENTS.md"))
        .unwrap_or_else(|_| DEFAULT_AGENTS_MD.to_string());

    Ok(Arc::new(SharedState {
        config,
        harness: Arc::new(HarnessServices::new()),
        defense,
        workspace,
        providers,
        plugin_host,
        deepsleep,
        advisor,
        jobs: Arc::new(BackgroundJobs::default()),
        agents_md,
        sigdb_version,
    }))
}

impl SessionManager {
    pub fn new(
        config: KernelConfig,
        transport: Arc<dyn Transport>,
    ) -> Result<Arc<Self>, KernelError> {
        let slots = config.worker_slots.max(1);
        let shared = build_shared(config, transport)?;
        Ok(Arc::new(Self {
            shared,
            sessions: RwLock::new(BTreeMap::new()),
            slots: Arc::new(Semaphore::new(slots)),
            next: AtomicU64::new(0),
        }))
    }

    pub fn session(&self, id: SessionId) -> Result<Arc<Session>, KernelError> {
        self.sessions
            .read()
            .map_err(|_| KernelError::Config("session lock poisoned".into()))?
            .get(&id)
            .cloned()
            .ok_or(KernelError::UnknownSession(id))
    }

    pub async fn open(&self, initial: Mode) -> Result<SessionId, KernelError> {
        let slot = self
            .slots
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| KernelError::SlotsExhausted)?;
        let id = SessionId(self.next.fetch_add(1, Ordering::Relaxed) + 1);
        let session = Arc::new(Session {
            id,
            mode: Mutex::new(ModeRouter::new(initial)),
            created_at: now(),
            _slot: slot,
        });
        self.sessions
            .write()
            .map_err(|_| KernelError::Config("session lock poisoned".into()))?
            .insert(id, session);
        Ok(id)
    }

    pub fn close(&self, id: SessionId) -> Result<(), KernelError> {
        self.sessions
            .write()
            .map_err(|_| KernelError::Config("session lock poisoned".into()))?
            .remove(&id)
            .ok_or(KernelError::UnknownSession(id))?;
        self.shared.harness.registry.forget_session(id);
        self.shared.harness.reminders.clear(id);
        Ok(())
    }

    pub fn mode(&self, id: SessionId) -> Result<Mode, KernelError> {
        Ok(self
            .session(id)?
            .mode
            .lock()
            .map_err(|_| KernelError::Config("mode lock poisoned".into()))?
            .current())
    }

    pub fn switch_mode(&self, id: SessionId, to: Mode) -> Result<ContextFirewall, KernelError> {
        let session = self.session(id)?;
        let firewall = session
            .mode
            .lock()
            .map_err(|_| KernelError::Config("mode lock poisoned".into()))?
            .switch(to)?;
        Ok(firewall)
    }

    pub fn active_sessions(&self) -> usize {
        self.sessions.read().map(|s| s.len()).unwrap_or(0)
    }

    pub async fn submit(
        &self,
        id: SessionId,
        text: &str,
        observer: &dyn RoundObserver,
    ) -> Result<RoundOutcome, KernelError> {
        let mode = self.mode(id)?;
        let loop_engine = AgentLoop::new(self.shared.clone(), id, mode);
        let outcome = loop_engine.run(text, observer).await;
        // First-writer-wins claims are round-scoped.
        self.shared.workspace.end_round();
        outcome
    }

    /// Switch the endpoint the next round will talk to. Every configured provider is
    /// registered at bootstrap, so this never re-reads config or re-builds a client.
    pub fn set_provider(&self, id: &str) -> Result<String, KernelError> {
        self.shared.providers.set_default(id)?;
        Ok(self.default_provider_id())
    }

    pub fn default_provider_id(&self) -> String {
        self.shared.providers.default_id()
    }

    pub fn provider_infos(&self) -> Vec<pristem_provider::ProviderInfo> {
        self.shared.providers.describe()
    }
}

/// Composition-root helpers.
pub struct Kernel;

impl Kernel {
    /// Load `config/kernel.json` relative to the crate manifest, not the process CWD.
    pub fn bootstrap(transport: Arc<dyn Transport>) -> Result<Arc<SessionManager>, KernelError> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../config/kernel.json");
        SessionManager::new(KernelConfig::load(&path)?, transport)
    }

    pub fn with_config(
        config: KernelConfig,
        transport: Arc<dyn Transport>,
    ) -> Result<Arc<SessionManager>, KernelError> {
        SessionManager::new(config, transport)
    }

    /// Deterministic config for tests / protocol probes / benches: temp workspace, real
    /// shipped sigdb, and a stub key so BYOK resolves without any environment secret.
    pub fn test_config() -> KernelConfig {
        let provider = ProviderConfig {
            api_key: Some("stub-key".into()),
            ..Default::default()
        };
        KernelConfig {
            workspace_root: std::env::temp_dir()
                .join(format!("pristem-kernel-test-{}", std::process::id())),
            sigdb_dir: Path::new(env!("CARGO_MANIFEST_DIR")).join("../../sigdb"),
            provider,
            worker_slots: 8,
            ..Default::default()
        }
    }
}

/// Convenience observer that forwards core events into a closure (used by IPC).
pub struct FnObserver<F>(pub F)
where
    F: Fn(RoundEvent) + Send + Sync;

impl<F> RoundObserver for FnObserver<F>
where
    F: Fn(RoundEvent) + Send + Sync,
{
    fn on_event(&self, event: RoundEvent) {
        (self.0)(event)
    }
}
