//! Clean instance (§8): fresh context, deepsleep system prompt + skill, explores the
//! agent's output chains and archives, and writes ONLY via `edit-solo` to SOLO.md.

use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};

use crate::solo::{SoloChannel, SoloError};
use crate::staging::{StagingError, StagingKind, StagingQueue, StagingRecord};

pub const DEEPSLEEP_SYSTEM_PROMPT: &str = "\
You are a clean pristem deepsleep instance. Your context is fresh: you did not produce the \
output chains you are about to inspect. Explore the archives and the agent's output chains, \
derive durable rules, and write ONLY through edit-solo to SOLO.md. Do not attempt to send \
messages back to the user.";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstanceMessage {
    pub role: String,
    pub content: String,
}

/// Digest model `[TA 12:58]`: defaults to the SAME model as the main conversation
/// (context-format match). Switching tiers is weighed against self-run model evaluation
/// cost — token burn and uncertain accuracy — so it is not allowed blind.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct DigestConfig {
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub evaluation_budget_tokens: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum DigestError {
    #[error("refusing to switch digest tier blind: self-run model evaluation needs >= {required} tokens, only {provided} budgeted (token burn, uncertain accuracy)")]
    InsufficientEvaluation { required: u64, provided: u64 },
    #[error("digest model override is empty")]
    EmptyModel,
}

pub const MIN_EVALUATION_TOKENS: u64 = 50_000;

impl DigestConfig {
    pub fn digest_model(&self, main_model: &str) -> String {
        self.model.clone().unwrap_or_else(|| main_model.to_string())
    }

    /// Overriding is allowed, but only when the caller has budgeted a self-run model
    /// evaluation first. "Do not switch blind."
    pub fn switch_tier(
        &mut self,
        model: &str,
        evaluation_budget_tokens: u64,
    ) -> Result<(), DigestError> {
        if model.trim().is_empty() {
            return Err(DigestError::EmptyModel);
        }
        if evaluation_budget_tokens < MIN_EVALUATION_TOKENS {
            return Err(DigestError::InsufficientEvaluation {
                required: MIN_EVALUATION_TOKENS,
                provided: evaluation_budget_tokens,
            });
        }
        self.model = Some(model.to_string());
        self.evaluation_budget_tokens = evaluation_budget_tokens;
        Ok(())
    }
}

pub struct CleanInstance {
    tag: String,
    context: RwLock<Vec<InstanceMessage>>,
    queue: Arc<StagingQueue>,
    solo: Arc<SoloChannel>,
    digest: DigestConfig,
    skill: String,
}

impl CleanInstance {
    /// Fresh context every time. The deepsleep prompt and skill are the only seed.
    pub fn spawn(
        tag: impl Into<String>,
        queue: Arc<StagingQueue>,
        solo: Arc<SoloChannel>,
        skill: impl Into<String>,
        digest: DigestConfig,
    ) -> Self {
        let skill = skill.into();
        let seed = format!("{DEEPSLEEP_SYSTEM_PROMPT}\n\n[skill: {skill}]");
        Self {
            tag: tag.into(),
            context: RwLock::new(vec![InstanceMessage {
                role: "system".into(),
                content: seed,
            }]),
            queue,
            solo,
            digest,
            skill,
        }
    }

    pub fn tag(&self) -> &str {
        &self.tag
    }
    pub fn skill(&self) -> &str {
        &self.skill
    }
    pub fn context(&self) -> Vec<InstanceMessage> {
        self.context.read().map(|c| c.clone()).unwrap_or_default()
    }
    pub fn context_len(&self) -> usize {
        self.context.read().map(|c| c.len()).unwrap_or(0)
    }
    pub fn note(&self, role: &str, content: &str) {
        if let Ok(mut c) = self.context.write() {
            c.push(InstanceMessage {
                role: role.into(),
                content: content.into(),
            });
        }
    }

    /// Explore output chains AND archives through the shared store's FTS search.
    pub fn explore(&self, query: &str) -> Result<Vec<StagingRecord>, StagingError> {
        let mut found = self.queue.search(query)?;
        let archives: Vec<StagingRecord> = self
            .queue
            .all()?
            .into_iter()
            .filter(|r| {
                r.kind == StagingKind::Archive
                    && r.body
                        .to_ascii_lowercase()
                        .contains(&query.to_ascii_lowercase())
            })
            .collect();
        for a in archives {
            if !found.iter().any(|r| r.id == a.id) {
                found.push(a);
            }
        }
        Ok(found)
    }

    /// The ONLY write available to a clean instance.
    pub fn write_solo(&self, text: &str) -> Result<(), SoloError> {
        self.solo.edit_solo(text)
    }

    pub fn digest_model(&self, main_model: &str) -> String {
        self.digest.digest_model(main_model)
    }
    pub fn digest_config(&self) -> &DigestConfig {
        &self.digest
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn instance() -> CleanInstance {
        CleanInstance::spawn(
            "sleep-1",
            Arc::new(StagingQueue::in_memory()),
            Arc::new(SoloChannel::new("SOLO.md", true, false)),
            "deepsleep-digestion",
            DigestConfig::default(),
        )
    }

    #[test]
    fn clean_instance_starts_with_a_fresh_context() {
        let i = instance();
        assert_eq!(i.context_len(), 1);
        assert!(i.context()[0]
            .content
            .contains("clean pristem deepsleep instance"));
        assert_eq!(i.skill(), "deepsleep-digestion");
    }

    #[test]
    fn digest_defaults_to_the_main_model_and_refuses_blind_tier_switches() {
        let i = instance();
        assert_eq!(i.digest_model("gpt-4o"), "gpt-4o");
        let mut cfg = DigestConfig::default();
        assert!(matches!(
            cfg.switch_tier("cheap-model", 100),
            Err(DigestError::InsufficientEvaluation { .. })
        ));
        cfg.switch_tier("cheap-model", MIN_EVALUATION_TOKENS)
            .unwrap();
        assert_eq!(cfg.digest_model("gpt-4o"), "cheap-model");
    }

    #[test]
    fn exploration_reads_the_shared_store_and_writes_are_promotion_gated() {
        let queue = Arc::new(StagingQueue::in_memory());
        queue
            .archive("output chain: hallucinated version 0.9.9")
            .unwrap();
        let solo = Arc::new(SoloChannel::new("SOLO.md", true, false));
        let i = CleanInstance::spawn(
            "sleep-2",
            queue,
            solo.clone(),
            "digest",
            DigestConfig::default(),
        );
        assert_eq!(i.explore("hallucinated").unwrap().len(), 1);
        assert!(matches!(i.write_solo("rule"), Err(SoloError::NotPromoted)));
        solo.promote();
        i.write_solo("rule: preserve version numbers").unwrap();
        assert_eq!(solo.read(), "rule: preserve version numbers");
    }
}
