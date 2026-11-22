//! # pristem-defense — the antivirus layer (§5) and the kernel's stable value types.
//!
//! This crate is deliberately the **bottom** of the dependency graph. Everything that
//! crosses a trust boundary (a tool call, a tool result, a session id, a token tier, a
//! file stamp) is defined here, because §3 declares defense's API *stable* while the
//! protocol-bearing crates are `[CHURN]`. Colocating the primitives here keeps the
//! 8-crate layout exact and avoids introducing a ninth "types" crate or a cycle.
//!
//! Three checkpoints on every round, one shared signature database:
//!
//! ```text
//! inbound scan ──▶ call validation ──▶ outbound check
//! (user msgs,      (G1..G5, §6)        (REMINDER completeness
//!  tool results,                        + secret re-scan)
//!  file content)
//! ```
//!
//! Interception handling exposes four orthogonal dials `[TA 12:58]`: model visibility,
//! audit granularity, human-release recovery, and position sensitivity. See
//! [`policy::InterceptionPolicy`].

pub mod inbound;
pub mod model;
pub mod outbound;
pub mod policy;
pub mod signature;
pub mod validate;

use std::sync::Arc;

pub use inbound::{AuditEntry, AuditLog, InboundScanner, Quarantine, QuarantineItem, ScanOutcome};
pub use outbound::{
    AnswerGate, AnswerVerdict, ConfigurableMode, GatePolicy, GateStrength, OutboundCheck,
    OutboundVerdict, ReminderSource,
};
pub use policy::{
    AuditPolicy, InterceptionPolicy, ModelVisibility, RecoveryMode, SitePolicies, SitePolicy,
};
pub use signature::{
    SigdbError, SigdbFile, Signature, SignatureDb, SignatureHit, UpdateReport, Version,
};
pub use validate::{
    canonical_tools, CallDecision, CallValidator, Gate, GateVerdict, TestSetPolicy, ToolSpec,
};

pub use model::*;

/// The three checkpoints as one object. Cheap to clone; all state is `Arc`-backed.
#[derive(Clone)]
pub struct DefensePipeline {
    inbound: Arc<InboundScanner>,
    validator: Arc<CallValidator>,
    outbound: Arc<OutboundCheck>,
    gate: Arc<AnswerGate>,
}

impl DefensePipeline {
    pub fn new(
        db: SignatureDb,
        policy: InterceptionPolicy,
        validator: CallValidator,
        gate: AnswerGate,
    ) -> Result<Self, SigdbError> {
        let quarantine = Quarantine::default();
        let inbound = Arc::new(InboundScanner::new(
            db.clone(),
            policy.clone(),
            quarantine.clone(),
        ));
        let gate = Arc::new(gate);
        let outbound = Arc::new(OutboundCheck::new(inbound.clone(), gate.clone()));
        Ok(Self {
            inbound,
            validator: Arc::new(validator),
            outbound,
            gate,
        })
    }

    /// Checkpoint 1. User messages, tool results and file content all pass through here
    /// before entering model context. `position` selects the independently configured
    /// interception policy (dial 4).
    pub fn scan_inbound(&self, text: &str, position: InterceptPosition) -> ScanOutcome {
        self.inbound.scan(text, position)
    }

    /// Human release (dial 3): released items replay into the next round, they are not
    /// silently dropped or re-scanned into context without an explicit release.
    pub fn release(&self, id: model::QuarantineId) -> Result<(), DefenseError> {
        self.inbound
            .quarantine()
            .release(id)
            .map(|_| ())
            .ok_or(DefenseError::UnknownQuarantineId(id.0))
    }

    pub fn drain_released(&self) -> Vec<String> {
        self.inbound.replay_released()
    }

    pub fn quarantine(&self) -> &Quarantine {
        self.inbound.quarantine()
    }

    pub fn scanner(&self) -> &InboundScanner {
        &self.inbound
    }

    /// Checkpoint 2. Five gates per tool call. Nothing has run yet when this returns.
    pub fn validate_calls(&self, calls: &[ToolCall]) -> Vec<GateVerdict> {
        calls.iter().map(|c| self.validator.validate(c)).collect()
    }

    /// Context firewall (§4): on entry to a mode the tool table is swapped, so a tool
    /// outside the mode's allowlist genuinely fails G1 rather than being filtered later.
    pub fn validate_calls_for_mode(
        &self,
        calls: &[ToolCall],
        allowed: &std::collections::BTreeSet<String>,
    ) -> Vec<GateVerdict> {
        let restricted = self.validator.restricted_to(allowed);
        calls.iter().map(|c| restricted.validate(c)).collect()
    }

    pub fn validator(&self) -> &CallValidator {
        &self.validator
    }

    /// Checkpoint 3a. Secret / jailbreak re-scan immediately before anything leaves.
    pub fn scan_outbound(&self, answer: &str) -> ScanOutcome {
        self.outbound.scan(answer)
    }

    /// Checkpoint 3b. REMINDER completeness gate whose strength is tiered by token level.
    pub fn answer_gate(
        &self,
        answer: &str,
        session: SessionId,
        tier: TokenTier,
        reminders: &dyn outbound::ReminderSource,
    ) -> AnswerVerdict {
        self.gate.check(answer, session, tier, reminders)
    }

    pub fn signature_db(&self) -> &SignatureDb {
        self.inbound.db()
    }

    pub fn audit_log(&self) -> Vec<inbound::AuditEntry> {
        self.inbound.audit_log().snapshot()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum DefenseError {
    #[error("unknown quarantine id {0}")]
    UnknownQuarantineId(u64),
    #[error(transparent)]
    Sigdb(#[from] SigdbError),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_tier_ordering_drives_the_gate() {
        assert!(model::TokenTier::Default < model::TokenTier::Extended);
        assert!(model::TokenTier::Unlimited < model::TokenTier::AboveUnlimited);
    }

    #[test]
    fn fingerprint_is_stable_and_content_sensitive() {
        let a = model::FileStamp::of(b"hello");
        let b = model::FileStamp::of(b"hello");
        let c = model::FileStamp::of(b"hellp");
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a.len, 5);
    }
}
