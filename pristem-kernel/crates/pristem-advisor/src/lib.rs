//! # pristem-advisor — deliberately THIN `[TA: "不要做太厚"]`.
//!
//! Three jobs and nothing else:
//! 1. **Pause semantics** — the agent loop suspends, it is not killed.
//! 2. **Annotation ingestion** into the deepsleep staging queue.
//! 3. **Auto-chain** into deepsleep digestion (a signal, not a forced invocation).
//!
//! Annotation structure stays minimal — classification at most. Advisor classification is
//! deliberately NOT in the trigger critical path (§8), so this crate never imports
//! `TriggerEngine` and never decides that deepsleep *must* run.

use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use pristem_deepsleep::{IntakeChannel, StagingQueue, StagingRecord};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Annotation {
    pub target: String,
    pub note: String,
    /// Classification at most. Stored as text in the staged record; never used to
    /// decide force-invocation.
    pub classification: Option<String>,
}

impl Annotation {
    pub fn new(target: impl Into<String>, note: impl Into<String>) -> Self {
        Self {
            target: target.into(),
            note: note.into(),
            classification: None,
        }
    }
    pub fn classified(mut self, class: impl Into<String>) -> Self {
        self.classification = Some(class.into());
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdvisorState {
    Running,
    Paused { since: u64 },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AdvisorSignal {
    None,
    /// Auto-chain: core hands digestion to deepsleep. This is NOT a force-invocation.
    DigestRequested {
        staged_id: u64,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum AdvisorError {
    #[error("annotation has an empty target")]
    EmptyTarget,
    #[error("annotation has an empty note")]
    EmptyNote,
    #[error("staging error: {0}")]
    Staging(String),
    #[error("advisor state lock poisoned")]
    LockPoisoned,
}

impl From<pristem_deepsleep::StagingError> for AdvisorError {
    fn from(e: pristem_deepsleep::StagingError) -> Self {
        Self::Staging(e.to_string())
    }
}

pub struct AdvisorBridge {
    state: RwLock<AdvisorState>,
    queue: Arc<StagingQueue>,
}

impl AdvisorBridge {
    pub fn new(queue: Arc<StagingQueue>) -> Self {
        Self {
            state: RwLock::new(AdvisorState::Running),
            queue,
        }
    }

    pub fn queue(&self) -> &Arc<StagingQueue> {
        &self.queue
    }

    /// Suspend the loop. The loop object and its context remain alive.
    pub fn pause(&self) -> Result<AdvisorState, AdvisorError> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let mut state = self.state.write().map_err(|_| AdvisorError::LockPoisoned)?;
        *state = AdvisorState::Paused { since: now };
        Ok(*state)
    }

    pub fn resume(&self) -> Result<AdvisorState, AdvisorError> {
        let mut state = self.state.write().map_err(|_| AdvisorError::LockPoisoned)?;
        *state = AdvisorState::Running;
        Ok(*state)
    }

    pub fn state(&self) -> AdvisorState {
        self.state
            .read()
            .map(|s| *s)
            .unwrap_or(AdvisorState::Running)
    }
    pub fn is_paused(&self) -> bool {
        matches!(self.state(), AdvisorState::Paused { .. })
    }

    /// Ingest an annotation into staging and auto-chain into deepsleep digestion.
    pub fn annotate(&self, a: Annotation) -> Result<AdvisorSignal, AdvisorError> {
        if a.target.trim().is_empty() {
            return Err(AdvisorError::EmptyTarget);
        }
        if a.note.trim().is_empty() {
            return Err(AdvisorError::EmptyNote);
        }
        let note = format!("[target: {}]\n{}", a.target, a.note);
        let rec: StagingRecord = self
            .queue
            .intake_advisor(&note, a.classification.as_deref())?;
        Ok(AdvisorSignal::DigestRequested { staged_id: rec.id })
    }

    /// Recent advisor annotations, for the desktop annotation surface.
    pub fn staged_annotations(&self) -> Vec<StagingRecord> {
        self.queue
            .all()
            .unwrap_or_default()
            .into_iter()
            .filter(|r| r.channel == IntakeChannel::AdvisorStructured)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pristem_deepsleep::TriggerEngine;

    fn bridge() -> AdvisorBridge {
        AdvisorBridge::new(Arc::new(StagingQueue::in_memory()))
    }

    #[test]
    fn pause_suspends_without_dropping_the_loop() {
        let b = bridge();
        assert_eq!(b.state(), AdvisorState::Running);
        assert!(matches!(b.pause().unwrap(), AdvisorState::Paused { .. }));
        assert!(b.is_paused());
        // State survives: the same bridge object holds it, nothing was killed.
        assert_eq!(b.resume().unwrap(), AdvisorState::Running);
        assert!(!b.is_paused());
    }

    #[test]
    fn annotation_ingests_into_staging_and_signals_digestion() {
        let b = bridge();
        let signal = b
            .annotate(
                Annotation::new("src/lib.rs:42", "this version is wrong")
                    .classified("hallucination"),
            )
            .unwrap();
        assert!(matches!(signal, AdvisorSignal::DigestRequested { .. }));
        let staged = b.staged_annotations();
        assert_eq!(staged.len(), 1);
        assert!(staged[0].body.contains("hallucination"));
        assert!(staged[0].body.contains("src/lib.rs:42"));
    }

    #[test]
    fn advisor_stays_out_of_the_trigger_critical_path() {
        let b = bridge();
        let trigger = TriggerEngine::default();
        for i in 0..10 {
            b.annotate(Annotation::new("x", format!("note {i}")).classified("wrong"))
                .unwrap();
        }
        for rec in b.staged_annotations() {
            assert!(matches!(
                trigger.record(&rec),
                pristem_deepsleep::TriggerVerdict::Idle
            ));
        }
        assert!(trigger.class_counts().is_empty());
        assert_eq!(trigger.correction_count(), 0);
    }

    #[test]
    fn empty_annotations_are_rejected_before_staging() {
        let b = bridge();
        assert!(matches!(
            b.annotate(Annotation::new("", "x")),
            Err(AdvisorError::EmptyTarget)
        ));
        assert!(matches!(
            b.annotate(Annotation::new("x", "")),
            Err(AdvisorError::EmptyNote)
        ));
        assert!(b.staged_annotations().is_empty());
    }
}
