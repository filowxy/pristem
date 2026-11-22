//! Trigger criteria (§8), **code-enforced**: same-class error ×2 OR user correction ×3
//! → force-invocation.
//!
//! Same-class detection = **signature hash (mechanical, in-kernel)** + the
//! **implicit-mining channel (model-side)**. Advisor classification is deliberately NOT
//! in the critical path `[TA: advisor stays thin]`.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::RwLock;

use pristem_defense::fnv1a;
use serde::{Deserialize, Serialize};

use crate::staging::{IntakeChannel, StagingKind, StagingRecord};

/// Mechanical in-kernel normalisation: digits collapse to `#`, punctuation to a single
/// space, everything is case-folded, then FNV-1a. Two stack traces of the same error
/// class with different paths/line numbers therefore hash identically.
pub fn signature_hash(error: &str) -> String {
    let mut norm = String::with_capacity(error.len());
    let mut last_space = true;
    for c in error.chars() {
        if c.is_ascii_digit() {
            norm.push('#');
            last_space = false;
        } else if c.is_alphanumeric() || c == '_' {
            norm.push(c.to_ascii_lowercase());
            last_space = false;
        } else if matches!(c, '/' | '\\' | '.' | ':' | '-') {
            // Kept inside the token so path-like tokens can be collapsed as a whole.
            norm.push(c);
            last_space = false;
        } else if !last_space {
            norm.push(' ');
            last_space = true;
        }
    }
    let collapsed: Vec<String> = norm
        .split_whitespace()
        .map(|t| {
            let path_like = t.contains('/')
                || t.contains('\\')
                || t.contains(".rs")
                || t.contains(".py")
                || t.contains(".js")
                || t.starts_with("0x");
            if path_like {
                "<path>".to_string()
            } else {
                t.to_string()
            }
        })
        .collect();
    format!("{:016x}", fnv1a(collapsed.join(" ").as_bytes()))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TriggerThresholds {
    pub same_class_error: u32,
    pub user_correction: u32,
}

impl Default for TriggerThresholds {
    fn default() -> Self {
        Self {
            same_class_error: 2,
            user_correction: 3,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TriggerVerdict {
    Idle,
    ForceInvoke {
        reason: String,
        evidence: Vec<String>,
    },
}

#[derive(Default)]
struct State {
    classes: BTreeMap<String, Vec<String>>,
    corrections: Vec<String>,
}

pub struct TriggerEngine {
    thresholds: TriggerThresholds,
    state: RwLock<State>,
    /// Kept as an atomic as well so the counter is honest even if the lock is contended.
    correction_counter: AtomicU32,
}

impl Default for TriggerEngine {
    fn default() -> Self {
        Self::new(TriggerThresholds::default())
    }
}

impl TriggerEngine {
    pub fn new(thresholds: TriggerThresholds) -> Self {
        Self {
            thresholds,
            state: RwLock::new(State::default()),
            correction_counter: AtomicU32::new(0),
        }
    }

    pub fn thresholds(&self) -> TriggerThresholds {
        self.thresholds
    }

    pub fn record(&self, rec: &StagingRecord) -> TriggerVerdict {
        // Advisor stays thin: its classification never drives force-invocation.
        if rec.channel == IntakeChannel::AdvisorStructured {
            return TriggerVerdict::Idle;
        }
        let snippet: String = rec.body.chars().take(120).collect();

        if rec.kind == StagingKind::UserCorrection {
            let mut state = match self.state.write() {
                Ok(s) => s,
                Err(_) => return TriggerVerdict::Idle,
            };
            state.corrections.push(snippet);
            let n = self.correction_counter.fetch_add(1, Ordering::Relaxed) + 1;
            if n >= self.thresholds.user_correction {
                return TriggerVerdict::ForceInvoke {
                    reason: format!(
                        "user correction x{n} reached the x{} threshold",
                        self.thresholds.user_correction
                    ),
                    evidence: state.corrections.clone(),
                };
            }
            return TriggerVerdict::Idle;
        }

        if rec.kind != StagingKind::SameClassError {
            return TriggerVerdict::Idle;
        }

        // Model-side implicit mining supplies a class hash; otherwise the kernel hashes
        // mechanically. Either way the DECISION is in-kernel, not model-side.
        let class = if rec.channel == IntakeChannel::ImplicitMining && !rec.class_hash.is_empty() {
            rec.class_hash.clone()
        } else {
            signature_hash(&rec.body)
        };
        let mut state = match self.state.write() {
            Ok(s) => s,
            Err(_) => return TriggerVerdict::Idle,
        };
        let bucket = state.classes.entry(class.clone()).or_default();
        bucket.push(snippet);
        let n = bucket.len() as u32;
        if n >= self.thresholds.same_class_error {
            return TriggerVerdict::ForceInvoke {
                reason: format!(
                    "same-class error x{n} reached the x{} threshold (class {class})",
                    self.thresholds.same_class_error
                ),
                evidence: bucket.clone(),
            };
        }
        TriggerVerdict::Idle
    }

    pub fn class_counts(&self) -> BTreeMap<String, u32> {
        self.state
            .read()
            .map(|s| {
                s.classes
                    .iter()
                    .map(|(k, v)| (k.clone(), v.len() as u32))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn correction_count(&self) -> u32 {
        self.correction_counter.load(Ordering::Relaxed)
    }

    /// Called after digestion so the next accumulation starts clean.
    pub fn reset(&self) {
        if let Ok(mut s) = self.state.write() {
            s.classes.clear();
            s.corrections.clear();
        }
        self.correction_counter.store(0, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::staging::{StagingKind, StagingStatus};

    fn rec(kind: StagingKind, channel: IntakeChannel, hash: &str, body: &str) -> StagingRecord {
        StagingRecord {
            id: 0,
            channel,
            kind,
            class_hash: hash.into(),
            body: body.into(),
            created_at: 0,
            status: StagingStatus::Pending,
        }
    }
    fn same_class(body: &str) -> StagingRecord {
        rec(
            StagingKind::SameClassError,
            IntakeChannel::ImplicitMining,
            "",
            body,
        )
    }

    #[test]
    fn signature_hash_is_mechanical_and_path_insensitive() {
        let a = signature_hash("Error E42 at src/main.rs:17: file not found");
        let b = signature_hash("error e42 at src/other.rs:99: file not found");
        // Digits, file names and line numbers normalise away; the class is identical.
        assert_eq!(a, b);
        assert_ne!(a, signature_hash("a completely different failure"));
    }

    #[test]
    fn two_same_class_errors_force_invocation() {
        let e = TriggerEngine::default();
        assert_eq!(
            e.record(&same_class("Error E42 at a.rs:1")),
            TriggerVerdict::Idle
        );
        let v = e.record(&same_class("Error E42 at b.rs:99"));
        assert!(matches!(v, TriggerVerdict::ForceInvoke { .. }));
        assert!(!e.class_counts().is_empty());
    }

    #[test]
    fn three_user_corrections_force_invocation() {
        let e = TriggerEngine::default();
        for i in 1..3 {
            assert_eq!(
                e.record(&rec(
                    StagingKind::UserCorrection,
                    IntakeChannel::ImproveInline,
                    "",
                    &format!("no, wrong {i}")
                )),
                TriggerVerdict::Idle
            );
        }
        assert!(matches!(
            e.record(&rec(
                StagingKind::UserCorrection,
                IntakeChannel::ImproveInline,
                "",
                "no, wrong 3"
            )),
            TriggerVerdict::ForceInvoke { .. }
        ));
        assert_eq!(e.correction_count(), 3);
        e.reset();
        assert_eq!(e.correction_count(), 0);
    }

    #[test]
    fn advisor_classification_is_not_in_the_critical_path() {
        let e = TriggerEngine::default();
        for _ in 0..10 {
            assert_eq!(
                e.record(&rec(
                    StagingKind::Annotation,
                    IntakeChannel::AdvisorStructured,
                    "hallucination",
                    "bad line"
                )),
                TriggerVerdict::Idle
            );
        }
        assert!(e.class_counts().is_empty());
        assert_eq!(e.correction_count(), 0);
    }

    #[test]
    fn implicit_mining_supplies_a_model_side_class_hash() {
        let e = TriggerEngine::default();
        let r = rec(
            StagingKind::SameClassError,
            IntakeChannel::ImplicitMining,
            "model-class-7",
            "text a",
        );
        e.record(&r);
        assert_eq!(e.class_counts().get("model-class-7"), Some(&1));
    }
}
