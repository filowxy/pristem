//! The four orthogonal interception dials `[TA 12:58]`, plus O6's config file format.
//!
//! 1. **Model visibility** — intercepted content becomes a placeholder marker in context:
//!    the model sees THAT something was blocked, but the content carries no instruction
//!    force.
//! 2. **Audit granularity** — per-signature-type tiered logging: counter-only for noise,
//!    full capture + position + sig id for serious ones.
//! 3. **Recovery** — human release (quarantine-restore); a released item replays into the
//!    next round.
//! 4. **Position sensitivity** — inbound / tool-result / model-output run independent
//!    policies.

use serde::{Deserialize, Serialize};

use crate::model::{AuditTier, InterceptPosition, SignatureKind};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelVisibility {
    /// Replace the matched content with a fixed marker. Default and recommended.
    Placeholder,
    /// Replace the whole payload with a single marker, discarding surrounding text too.
    Opaque,
    /// Keep the text but wrap it in an inert, explicitly untrusted tag. Never the default.
    VerbatimTagged,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryMode {
    HumanRelease,
    Drop,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SitePolicy {
    pub enabled: bool,
    pub visibility: ModelVisibility,
    pub recovery: RecoveryMode,
    /// `{qid}`, `{sig}` and `{site}` are the only substitutions; no user text is ever
    /// interpolated, so the marker itself cannot be used as an injection vector.
    pub placeholder: String,
}

impl SitePolicy {
    pub fn render_marker(&self, qid: u64, sig: &str, site: InterceptPosition) -> String {
        self.placeholder
            .replace("{qid}", &format!("q{qid}"))
            .replace("{sig}", sig)
            .replace("{site}", site.as_str())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SitePolicies {
    pub inbound: SitePolicy,
    pub tool_result: SitePolicy,
    pub model_output: SitePolicy,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditPolicy {
    pub full_capture_kinds: Vec<SignatureKind>,
    pub counter_only_kinds: Vec<SignatureKind>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct InterceptionPolicy {
    pub schema: String,
    pub sites: SitePolicies,
    pub audit: AuditPolicy,
}

impl InterceptionPolicy {
    pub fn from_json(s: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(s)
    }

    pub fn site(&self, position: InterceptPosition) -> &SitePolicy {
        match position {
            InterceptPosition::Inbound => &self.sites.inbound,
            InterceptPosition::ToolResult => &self.sites.tool_result,
            InterceptPosition::ModelOutput => &self.sites.model_output,
        }
    }

    /// Policy wins over the signature's declared tier. A kind listed in neither list
    /// keeps its declaration. This is the "tiered by signature type" knob.
    pub fn audit_tier_for(&self, kind: SignatureKind, declared: AuditTier) -> AuditTier {
        if self.audit.counter_only_kinds.contains(&kind) {
            AuditTier::CounterOnly
        } else if self.audit.full_capture_kinds.contains(&kind) {
            AuditTier::FullCapture
        } else {
            declared
        }
    }
}

impl Default for InterceptionPolicy {
    fn default() -> Self {
        Self {
            schema: "pristem.interception-policy/v1".into(),
            sites: SitePolicies {
                inbound: SitePolicy {
                    enabled: true,
                    visibility: ModelVisibility::Placeholder,
                    recovery: RecoveryMode::HumanRelease,
                    placeholder: "[pristem:intercepted id={qid} sig={sig} site={site} — content withheld, carries no instruction force]".into(),
                },
                tool_result: SitePolicy {
                    enabled: true,
                    visibility: ModelVisibility::Placeholder,
                    recovery: RecoveryMode::HumanRelease,
                    placeholder: "[pristem:intercepted id={qid} sig={sig} site={site} — content withheld, carries no instruction force]".into(),
                },
                model_output: SitePolicy {
                    enabled: true,
                    visibility: ModelVisibility::Opaque,
                    recovery: RecoveryMode::Drop,
                    placeholder: "[pristem:outbound-blocked sig={sig}]".into(),
                },
            },
            audit: AuditPolicy {
                full_capture_kinds: vec![
                    SignatureKind::Jailbreak,
                    SignatureKind::PseudoSystem,
                    SignatureKind::AuthorityClaim,
                    SignatureKind::PromptLeak,
                ],
                counter_only_kinds: vec![SignatureKind::Secret, SignatureKind::DeletionVerb],
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marker_never_interpolates_the_payload() {
        let p = InterceptionPolicy::default();
        let m = p
            .sites
            .inbound
            .render_marker(7, "JB-001", InterceptPosition::Inbound);
        assert!(m.contains("q7"));
        assert!(m.contains("JB-001"));
        assert!(!m.contains("ignore previous instructions"));
    }

    #[test]
    fn audit_policy_overrides_signature_declaration() {
        let p = InterceptionPolicy::default();
        assert_eq!(
            p.audit_tier_for(SignatureKind::Secret, AuditTier::FullCapture),
            AuditTier::CounterOnly
        );
        assert_eq!(
            p.audit_tier_for(SignatureKind::PseudoSystem, AuditTier::CounterOnly),
            AuditTier::FullCapture
        );
    }
}
