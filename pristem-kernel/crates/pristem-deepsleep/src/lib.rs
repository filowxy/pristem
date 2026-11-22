//! # pristem-deepsleep — clean-instance engine, staging queue, wake briefing (§8).
//!
//! Trigger criteria are **code-enforced**: same-class error ×2 OR user correction ×3
//! forces invocation. Same-class detection = mechanical signature hash + the implicit
//! mining channel; advisor classification stays out of the critical path.
//!
//! The three-lock exit protocol, promotion-gated SOLO.md channel and wake briefing are
//! all separate types so none of them can be bypassed by "just writing a file".

pub mod clean_instance;
pub mod exit;
pub mod solo;
pub mod staging;
pub mod trigger;
pub mod wake;

use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

pub use clean_instance::{CleanInstance, DigestConfig, DigestError, MIN_EVALUATION_TOKENS};
pub use exit::{ExitProtocol, ANTI_TESTAMENT, OOD_CLOSE, SELF_CONFIRMATION};
pub use solo::{SoloChannel, SoloError};
pub use staging::{
    IntakeChannel, PortableStagingStore, StagingError, StagingKind, StagingQueue, StagingRecord,
    StagingStatus, StagingStore,
};
pub use trigger::{signature_hash, TriggerEngine, TriggerThresholds, TriggerVerdict};
pub use wake::WakeBriefing;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeepsleepConfig {
    #[serde(default)]
    pub digest_model: Option<String>,
    #[serde(default = "default_same_class")]
    pub same_class_error_threshold: u32,
    #[serde(default = "default_corrections")]
    pub user_correction_threshold: u32,
    #[serde(default = "default_solo_path")]
    pub solo_path: PathBuf,
    #[serde(default = "default_true")]
    pub promotion_required: bool,
    #[serde(default)]
    pub persist_solo: bool,
}

fn default_same_class() -> u32 {
    2
}
fn default_corrections() -> u32 {
    3
}
fn default_solo_path() -> PathBuf {
    PathBuf::from("SOLO.md")
}
fn default_true() -> bool {
    true
}

impl Default for DeepsleepConfig {
    fn default() -> Self {
        Self {
            digest_model: None,
            same_class_error_threshold: 2,
            user_correction_threshold: 3,
            solo_path: PathBuf::from("SOLO.md"),
            promotion_required: true,
            persist_solo: false,
        }
    }
}

pub struct DeepsleepEngine {
    pub config: DeepsleepConfig,
    pub queue: Arc<StagingQueue>,
    pub solo: Arc<SoloChannel>,
    pub trigger: Arc<TriggerEngine>,
}

impl DeepsleepEngine {
    pub fn new(config: DeepsleepConfig, store: Arc<dyn StagingStore>) -> Self {
        let queue = Arc::new(StagingQueue::new(store));
        let solo = Arc::new(SoloChannel::new(
            config.solo_path.clone(),
            config.promotion_required,
            config.persist_solo,
        ));
        let trigger = Arc::new(TriggerEngine::new(TriggerThresholds {
            same_class_error: config.same_class_error_threshold,
            user_correction: config.user_correction_threshold,
        }));
        Self {
            config,
            queue,
            solo,
            trigger,
        }
    }

    pub fn in_memory(config: DeepsleepConfig) -> Self {
        Self::new(config, Arc::new(PortableStagingStore::in_memory()))
    }

    /// A config-level digest-model override is a human decision; the runtime
    /// `switch_tier` guard (self-run evaluation cost) applies only to blind switches.
    fn digest_config(&self) -> DigestConfig {
        match &self.config.digest_model {
            Some(m) => DigestConfig {
                model: Some(m.clone()),
                evaluation_budget_tokens: MIN_EVALUATION_TOKENS,
            },
            None => DigestConfig::default(),
        }
    }

    pub fn spawn_clean_instance(&self, _main_model: &str) -> CleanInstance {
        CleanInstance::spawn(
            format!("deepsleep-{}", self.trigger.correction_count()),
            self.queue.clone(),
            self.solo.clone(),
            "deepsleep-digestion",
            self.digest_config(),
        )
    }

    pub fn exit_protocol(&self) -> ExitProtocol {
        ExitProtocol::new()
    }

    pub fn wake(&self, new_rules: Vec<String>, changed_files: Vec<PathBuf>) -> WakeBriefing {
        WakeBriefing::new(new_rules, changed_files)
    }

    /// Ingest a staged item and evaluate the force-invocation criteria in one step.
    pub fn ingest(&self, rec: &StagingRecord) -> TriggerVerdict {
        self.trigger.record(rec)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_section_of_kernel_json_deserializes() {
        let json = include_str!("../../../config/kernel.json");
        let v: serde_json::Value = serde_json::from_str(json).unwrap();
        let cfg: DeepsleepConfig = serde_json::from_value(v["deepsleep"].clone()).unwrap();
        assert_eq!(cfg.same_class_error_threshold, 2);
        assert_eq!(cfg.user_correction_threshold, 3);
        assert!(cfg.promotion_required);
        assert_eq!(cfg.solo_path, PathBuf::from("SOLO.md"));
        assert!(cfg.digest_model.is_none());
    }

    #[test]
    fn engine_wires_queue_solo_trigger_and_digest_default() {
        let engine = DeepsleepEngine::in_memory(DeepsleepConfig::default());
        let instance = engine.spawn_clean_instance("gpt-4o");
        assert_eq!(instance.digest_model("gpt-4o"), "gpt-4o");
        assert_eq!(instance.context_len(), 1);
        assert!(!engine.solo.is_promoted());
        assert_eq!(engine.trigger.thresholds().same_class_error, 2);
    }

    #[test]
    fn config_level_digest_override_is_honoured() {
        let cfg = DeepsleepConfig {
            digest_model: Some("cheap-digest".into()),
            ..Default::default()
        };
        let engine = DeepsleepEngine::in_memory(cfg);
        assert_eq!(
            engine.spawn_clean_instance("gpt-4o").digest_model("gpt-4o"),
            "cheap-digest"
        );
    }

    #[test]
    fn end_to_end_force_invocation_then_three_lock_exit() {
        let engine = DeepsleepEngine::in_memory(DeepsleepConfig::default());
        let a = engine
            .queue
            .intake_implicit("Error E42 at a.rs:1", "")
            .unwrap();
        assert!(matches!(engine.ingest(&a), TriggerVerdict::Idle));
        let b = engine
            .queue
            .intake_implicit("Error E42 at b.rs:9", "")
            .unwrap();
        assert!(matches!(
            engine.ingest(&b),
            TriggerVerdict::ForceInvoke { .. }
        ));

        let instance = engine.spawn_clean_instance("gpt-4o");
        assert_eq!(instance.explore("error").unwrap().len(), 2);
        // writes are gated until a human / wake briefing promotes the channel
        assert!(instance.write_solo("new rule").is_err());
        let mut briefing = engine.wake(vec!["new rule".into()], vec![PathBuf::from("SOLO.md")]);
        assert!(briefing.brief_for(&instance).contains("SOLO.md"));
        engine.solo.promote();
        instance.write_solo("new rule").unwrap();
        briefing.commit();

        let mut exit = engine.exit_protocol();
        exit.advance(SELF_CONFIRMATION).unwrap();
        exit.advance(ANTI_TESTAMENT).unwrap();
        exit.advance(OOD_CLOSE).unwrap();
        assert!(exit.is_complete());
        engine.trigger.reset();
        assert_eq!(engine.trigger.correction_count(), 0);
    }
}
