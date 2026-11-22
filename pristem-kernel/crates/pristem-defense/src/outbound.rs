//! Outbound check (checkpoint 3): the answer gate + a secret re-scan before anything leaves.
//!
//! The gate's STRENGTH is tiered by token level `[TA 12:58]`:
//!
//! | token tier | gate behavior |
//! |---|---|
//! | above `unlimited` | hard reject — session must add missing lines before answering |
//! | at/below `unlimited` | user-configurable |
//! | at/below `default` | never rejects (pass-through) |
//!
//! The six-tier constitution couples to the gate here; strictness is a policy dial, not a
//! constant. `[CHURN: exact tier mapping]` — `GatePolicy::strength_for` is the only place
//! that must change when the mapping is ratified.

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::inbound::{InboundScanner, ScanOutcome};
use crate::model::{InterceptPosition, SessionId, TokenTier};

/// Dependency inversion: the REMINDER store lives in `pristem-harness`, which depends on
/// this crate. The gate therefore consumes a trait, and `core` wires the concrete store.
pub trait ReminderSource: Send + Sync {
    fn required_lines(&self, session: SessionId) -> Vec<String>;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ConfigurableMode {
    #[default]
    Reject,
    Warn,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GatePolicy {
    pub configurable_mode: ConfigurableMode,
}

impl Default for GatePolicy {
    fn default() -> Self {
        Self {
            configurable_mode: ConfigurableMode::Reject,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GateStrength {
    NeverReject,
    Configurable(ConfigurableMode),
    HardReject,
}

impl GateStrength {
    pub fn rejects(self) -> bool {
        match self {
            Self::NeverReject => false,
            Self::Configurable(ConfigurableMode::Reject) | Self::HardReject => true,
            Self::Configurable(ConfigurableMode::Warn) => false,
        }
    }
}

impl GatePolicy {
    pub fn strength_for(&self, tier: TokenTier) -> GateStrength {
        match tier {
            TokenTier::Micro | TokenTier::Standard | TokenTier::Default => {
                GateStrength::NeverReject
            }
            TokenTier::Extended | TokenTier::Unlimited => {
                GateStrength::Configurable(self.configurable_mode)
            }
            TokenTier::AboveUnlimited => GateStrength::HardReject,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AnswerVerdict {
    Pass,
    Missing {
        lines: Vec<String>,
        strength: GateStrength,
        /// false means "pass-through with a warning", true means "must not answer yet".
        reject: bool,
    },
}

impl AnswerVerdict {
    pub fn must_not_answer(&self) -> bool {
        matches!(self, Self::Missing { reject: true, .. })
    }
}

#[derive(Clone)]
pub struct AnswerGate {
    policy: GatePolicy,
}

impl AnswerGate {
    pub fn new(policy: GatePolicy) -> Self {
        Self { policy }
    }
    pub fn policy(&self) -> &GatePolicy {
        &self.policy
    }

    pub fn check(
        &self,
        answer: &str,
        session: SessionId,
        tier: TokenTier,
        reminders: &dyn ReminderSource,
    ) -> AnswerVerdict {
        let strength = self.policy.strength_for(tier);
        let missing: Vec<String> = reminders
            .required_lines(session)
            .into_iter()
            .filter(|line| !answer.contains(line.trim()))
            .collect();
        if missing.is_empty() {
            return AnswerVerdict::Pass;
        }
        // At/below `default` the gate NEVER rejects, even when lines are missing. It still
        // reports the gap, so the harness can surface it without blocking the answer.
        AnswerVerdict::Missing {
            lines: missing,
            strength,
            reject: strength.rejects(),
        }
    }
}

#[derive(Clone)]
pub struct OutboundCheck {
    scanner: Arc<InboundScanner>,
    gate: Arc<AnswerGate>,
}

impl OutboundCheck {
    pub fn new(scanner: Arc<InboundScanner>, gate: Arc<AnswerGate>) -> Self {
        Self { scanner, gate }
    }

    pub fn scan(&self, answer: &str) -> ScanOutcome {
        self.scanner.scan(answer, InterceptPosition::ModelOutput)
    }

    pub fn full_check(
        &self,
        answer: &str,
        session: SessionId,
        tier: TokenTier,
        reminders: &dyn ReminderSource,
    ) -> OutboundVerdict {
        let scanned = self.scan(answer);
        let gate = self.gate.check(&scanned.text, session, tier, reminders);
        OutboundVerdict {
            answer: scanned.text,
            blocked: scanned.intercepted,
            gate,
        }
    }
}

#[derive(Clone, Debug)]
pub struct OutboundVerdict {
    pub answer: String,
    pub blocked: bool,
    pub gate: AnswerVerdict,
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixed(Vec<String>);
    impl ReminderSource for Fixed {
        fn required_lines(&self, _: SessionId) -> Vec<String> {
            self.0.clone()
        }
    }

    #[test]
    fn tier_mapping_follows_the_ratified_table() {
        let p = GatePolicy::default();
        for t in [TokenTier::Micro, TokenTier::Standard, TokenTier::Default] {
            assert_eq!(p.strength_for(t), GateStrength::NeverReject);
        }
        assert_eq!(
            p.strength_for(TokenTier::Unlimited),
            GateStrength::Configurable(ConfigurableMode::Reject)
        );
        assert_eq!(
            p.strength_for(TokenTier::AboveUnlimited),
            GateStrength::HardReject
        );
    }

    #[test]
    fn hard_reject_forces_missing_lines_before_answering() {
        let gate = AnswerGate::new(GatePolicy::default());
        let src = Fixed(vec!["REMINDER: keep version 0.3.0 verbatim".into()]);
        let session = SessionId(1);
        assert!(!gate
            .check("done", session, TokenTier::Default, &src)
            .must_not_answer());
        assert!(gate
            .check("done", session, TokenTier::AboveUnlimited, &src)
            .must_not_answer());
        assert_eq!(
            gate.check(
                "REMINDER: keep version 0.3.0 verbatim — done",
                session,
                TokenTier::AboveUnlimited,
                &src
            ),
            AnswerVerdict::Pass
        );
    }

    #[test]
    fn configurable_mode_is_a_user_dial() {
        let lenient = GatePolicy {
            configurable_mode: ConfigurableMode::Warn,
        };
        assert!(!lenient.strength_for(TokenTier::Unlimited).rejects());
        assert!(GatePolicy::default()
            .strength_for(TokenTier::Unlimited)
            .rejects());
    }
}
