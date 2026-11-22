//! Mount points and the permission spectrum (O1's drawing, expressed in code).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// The first four are configurable; the last six are **sealed** — "plugins may add senses
/// and tools, never a soul".
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MountPoint {
    ProviderAdapter,
    Tool,
    RouterPolicy,
    Ui,
    LanguageAnalyzer,
    Encoder,
    RoundLoop,
    DefensePipeline,
    AnswerGate,
    SignatureDb,
    SoloChannel,
    ArchiveWrite,
}

impl MountPoint {
    pub fn is_sealed(self) -> bool {
        matches!(
            self,
            Self::RoundLoop
                | Self::DefensePipeline
                | Self::AnswerGate
                | Self::SignatureDb
                | Self::SoloChannel
                | Self::ArchiveWrite
        )
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ProviderAdapter => "provider_adapter",
            Self::Tool => "tool",
            Self::RouterPolicy => "router_policy",
            Self::Ui => "ui",
            Self::LanguageAnalyzer => "language_analyzer",
            Self::Encoder => "encoder",
            Self::RoundLoop => "round_loop",
            Self::DefensePipeline => "defense_pipeline",
            Self::AnswerGate => "answer_gate",
            Self::SignatureDb => "signature_db",
            Self::SoloChannel => "solo_channel",
            Self::ArchiveWrite => "archive_write",
        }
    }
    pub const CONFIGURABLE: [Self; 6] = [
        Self::ProviderAdapter,
        Self::Tool,
        Self::RouterPolicy,
        Self::Ui,
        Self::LanguageAnalyzer,
        Self::Encoder,
    ];
    pub const SEALED: [Self; 6] = [
        Self::RoundLoop,
        Self::DefensePipeline,
        Self::AnswerGate,
        Self::SignatureDb,
        Self::SoloChannel,
        Self::ArchiveWrite,
    ];
}

/// `[TA]` in-process is reserved for provider adapters, language analyzers and encoders.
pub const IN_PROCESS_ALLOWLIST: [MountPoint; 3] = [
    MountPoint::ProviderAdapter,
    MountPoint::LanguageAnalyzer,
    MountPoint::Encoder,
];

/// A continuum, not tiers: `distance()` is how far the plugin must sit from the kernel's
/// logic plane. A policy sets the *floor*; mounting farther out is always allowed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Isolation {
    InProcess,
    #[default]
    OutOfProcess,
    Forbidden,
}

impl Isolation {
    pub fn distance(self) -> u8 {
        match self {
            Self::InProcess => 0,
            Self::OutOfProcess => 1,
            Self::Forbidden => 2,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InProcess => "in_process",
            Self::OutOfProcess => "out_of_process",
            Self::Forbidden => "forbidden",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MountRule {
    pub point: MountPoint,
    pub isolation: Isolation,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MountPolicy {
    pub default_isolation: Isolation,
    pub rules: Vec<MountRule>,
}

impl Default for MountPolicy {
    fn default() -> Self {
        Self {
            default_isolation: Isolation::OutOfProcess,
            rules: vec![
                MountRule {
                    point: MountPoint::ProviderAdapter,
                    isolation: Isolation::InProcess,
                },
                MountRule {
                    point: MountPoint::LanguageAnalyzer,
                    isolation: Isolation::InProcess,
                },
                MountRule {
                    point: MountPoint::Encoder,
                    isolation: Isolation::InProcess,
                },
                MountRule {
                    point: MountPoint::Tool,
                    isolation: Isolation::OutOfProcess,
                },
                MountRule {
                    point: MountPoint::RouterPolicy,
                    isolation: Isolation::OutOfProcess,
                },
                MountRule {
                    point: MountPoint::Ui,
                    isolation: Isolation::OutOfProcess,
                },
            ],
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum MountPolicyError {
    #[error("sealed mount point `{0}` cannot be configured; it is permanently forbidden")]
    SealedAttempt(String),
    #[error(
        "in-process is reserved for provider adapters / language analyzers / encoders, not `{0}`"
    )]
    InProcessNotAllowed(String),
}

impl MountPolicy {
    pub fn validate(&self) -> Result<(), MountPolicyError> {
        for rule in &self.rules {
            if rule.point.is_sealed() && rule.isolation != Isolation::Forbidden {
                return Err(MountPolicyError::SealedAttempt(rule.point.as_str().into()));
            }
            if rule.isolation == Isolation::InProcess && !IN_PROCESS_ALLOWLIST.contains(&rule.point)
            {
                return Err(MountPolicyError::InProcessNotAllowed(
                    rule.point.as_str().into(),
                ));
            }
        }
        Ok(())
    }

    /// The closest isolation permitted at this mount point.
    pub fn limit_for(&self, point: MountPoint) -> Isolation {
        if point.is_sealed() {
            return Isolation::Forbidden;
        }
        self.rules
            .iter()
            .find(|r| r.point == point)
            .map(|r| r.isolation)
            .unwrap_or(self.default_isolation)
    }

    pub fn as_map(&self) -> BTreeMap<MountPoint, Isolation> {
        MountPoint::CONFIGURABLE
            .iter()
            .chain(MountPoint::SEALED.iter())
            .map(|p| (*p, self.limit_for(*p)))
            .collect()
    }
}

/// Every provider adapter implements this: "Provider IS a plugin" `[TA]`. Built-ins are
/// merely the adapters shipped by default.
pub trait Plugin: Send + Sync {
    fn descriptor(&self) -> PluginDescriptor;
    fn name(&self) -> String {
        self.descriptor().name
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PluginDescriptor {
    pub name: String,
    pub point: MountPoint,
    pub isolation: Isolation,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sealed_points_are_forbidden_even_if_config_disagrees() {
        let mut p = MountPolicy::default();
        p.rules.push(MountRule {
            point: MountPoint::RoundLoop,
            isolation: Isolation::InProcess,
        });
        assert!(matches!(
            p.validate(),
            Err(MountPolicyError::SealedAttempt(_))
        ));
        // The hard-coded limit still wins even on an unvalidated policy.
        assert_eq!(p.limit_for(MountPoint::RoundLoop), Isolation::Forbidden);
        assert_eq!(p.limit_for(MountPoint::AnswerGate), Isolation::Forbidden);
        assert_eq!(p.limit_for(MountPoint::SoloChannel), Isolation::Forbidden);
        assert_eq!(p.limit_for(MountPoint::ArchiveWrite), Isolation::Forbidden);
    }

    #[test]
    fn in_process_is_an_allowlist_not_a_default() {
        let mut p = MountPolicy::default();
        p.validate().unwrap();
        assert_eq!(
            p.limit_for(MountPoint::ProviderAdapter),
            Isolation::InProcess
        );
        assert_eq!(p.limit_for(MountPoint::Tool), Isolation::OutOfProcess);
        p.rules.push(MountRule {
            point: MountPoint::Ui,
            isolation: Isolation::InProcess,
        });
        assert!(matches!(
            p.validate(),
            Err(MountPolicyError::InProcessNotAllowed(_))
        ));
    }

    #[test]
    fn spectrum_means_farther_out_is_always_allowed() {
        assert!(Isolation::InProcess.distance() < Isolation::OutOfProcess.distance());
        assert!(Isolation::OutOfProcess.distance() < Isolation::Forbidden.distance());
    }
}
