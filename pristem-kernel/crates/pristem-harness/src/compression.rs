//! Compression executor (§7 / §Memory discipline).
//!
//! A summary must **self-declare**, preserve version numbers / ids / verdicts verbatim,
//! and state plainly what was dropped. These are hard, machine-checkable clauses — the
//! contract is validated before the summary is allowed back into context.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

pub const SUMMARY_DECLARATION: &str = "[pristem:compressed-summary]";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompressionContract {
    pub require_self_declaration: bool,
    pub require_dropped_section: bool,
    /// Caller-supplied tokens that must survive verbatim in addition to those extracted
    /// mechanically from the messages.
    pub must_preserve_verbatim: Vec<String>,
}

impl Default for CompressionContract {
    fn default() -> Self {
        Self {
            require_self_declaration: true,
            require_dropped_section: true,
            must_preserve_verbatim: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompressionRequest {
    pub messages: Vec<String>,
    pub budget_tokens: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Summary {
    pub text: String,
    pub declared: bool,
    pub dropped: Vec<String>,
    pub preserved: Vec<String>,
    pub estimated_tokens: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum CompressionError {
    #[error("summary does not self-declare with {SUMMARY_DECLARATION}")]
    MissingSelfDeclaration,
    #[error("summary does not state plainly what was dropped")]
    MissingDroppedSection,
    #[error("summary dropped version numbers / ids / verdicts that must be verbatim: {0:?}")]
    DroppedVerbatimToken(Vec<String>),
    #[error("summary is {estimated} tokens, over the {budget} token budget")]
    BudgetExceeded { estimated: usize, budget: usize },
}

pub trait Compressor: Send + Sync {
    fn compress(&self, req: &CompressionRequest) -> Result<Summary, CompressionError>;
    fn validate(
        &self,
        summary: &Summary,
        required_tokens: &[String],
    ) -> Result<(), CompressionError>;
}

fn token_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?ix)
            \bv?\d+\.\d+(?:\.\d+)?\b          # version numbers
            | \b[A-Z]{2,}-\d+\b                # signature / ticket ids
            | verdict:\s*[a-z_]+\b             # verdicts
            | \b(?:allow|deny|intercept|held|unknown-tool|unknown-args|rerouted)\b
            ",
        )
        .expect("verbatim token regex")
    })
}

/// Mechanical extraction: version numbers, ids, verdicts and status-line vocabulary.
pub fn verbatim_tokens(messages: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for m in messages {
        for cap in token_re().find_iter(m) {
            let t = cap.as_str().to_string();
            if !out.contains(&t) {
                out.push(t);
            }
        }
    }
    out
}

#[derive(Clone)]
pub struct ExtractiveCompressor {
    pub contract: CompressionContract,
    pub head: usize,
    pub tail: usize,
}

impl Default for ExtractiveCompressor {
    fn default() -> Self {
        Self {
            contract: CompressionContract::default(),
            head: 2,
            tail: 2,
        }
    }
}

impl ExtractiveCompressor {
    fn build(&self, req: &CompressionRequest, kept: &[usize], tokens: &[String]) -> Summary {
        let mut text = String::new();
        text.push_str(SUMMARY_DECLARATION);
        text.push('\n');
        text.push_str("Preserved verbatim (version numbers / ids / verdicts):\n");
        for t in tokens {
            text.push_str(&format!("- {t}\n"));
        }
        text.push_str("Kept messages:\n");
        for &i in kept {
            text.push_str(&format!("[msg#{i}] {}\n", req.messages[i].trim()));
        }
        let dropped: Vec<String> = (0..req.messages.len())
            .filter(|i| !kept.contains(i))
            .map(|i| {
                let preview: String = req.messages[i].chars().take(80).collect();
                format!("msg#{i} ({} chars): {preview:?}", req.messages[i].len())
            })
            .collect();
        text.push_str(&format!(
            "Dropped: {} message(s), listed explicitly:\n",
            dropped.len()
        ));
        for d in &dropped {
            text.push_str(&format!("- {d}\n"));
        }
        let estimated_tokens = text.len().div_ceil(4);
        Summary {
            declared: text.contains(SUMMARY_DECLARATION),
            text,
            dropped,
            preserved: tokens.to_vec(),
            estimated_tokens,
        }
    }
}

impl Compressor for ExtractiveCompressor {
    fn compress(&self, req: &CompressionRequest) -> Result<Summary, CompressionError> {
        let mut tokens = verbatim_tokens(&req.messages);
        for extra in &self.contract.must_preserve_verbatim {
            if !tokens.contains(extra) {
                tokens.push(extra.clone());
            }
        }
        let n = req.messages.len();
        let mut kept: Vec<usize> = if n <= self.head + self.tail {
            (0..n).collect()
        } else {
            let mut v: Vec<usize> = (0..self.head).collect();
            v.extend((n - self.tail)..n);
            v
        };
        let mut summary = self.build(req, &kept, &tokens);
        // Shrink the kept middle until the summary fits the budget, but never drop the
        // verbatim tokens or the explicit dropped-list.
        while summary.estimated_tokens > req.budget_tokens && kept.len() > 2 {
            let mid = kept.len() / 2;
            kept.remove(mid);
            summary = self.build(req, &kept, &tokens);
        }
        if summary.estimated_tokens > req.budget_tokens {
            return Err(CompressionError::BudgetExceeded {
                estimated: summary.estimated_tokens,
                budget: req.budget_tokens,
            });
        }
        self.validate(&summary, &tokens)?;
        Ok(summary)
    }

    fn validate(
        &self,
        summary: &Summary,
        required_tokens: &[String],
    ) -> Result<(), CompressionError> {
        if self.contract.require_self_declaration && !summary.text.contains(SUMMARY_DECLARATION) {
            return Err(CompressionError::MissingSelfDeclaration);
        }
        if self.contract.require_dropped_section && !summary.text.contains("Dropped:") {
            return Err(CompressionError::MissingDroppedSection);
        }
        let missing: Vec<String> = required_tokens
            .iter()
            .filter(|t| !summary.text.contains(t.as_str()))
            .cloned()
            .collect();
        if !missing.is_empty() {
            return Err(CompressionError::DroppedVerbatimToken(missing));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req() -> CompressionRequest {
        CompressionRequest {
            messages: vec![
                "AGENTS.md version 0.3.0 loaded".into(),
                "sig JB-001 fired, verdict: intercept".into(),
                "long middle text one".into(),
                "long middle text two".into(),
                "long middle text three".into(),
                "final answer uses id AC-003 and verdict: allow".into(),
            ],
            budget_tokens: 2000,
        }
    }

    #[test]
    fn summary_self_declares_preserves_verbatim_and_lists_dropped() {
        let c = ExtractiveCompressor::default();
        let s = c.compress(&req()).unwrap();
        assert!(s.declared);
        assert!(s.text.contains(SUMMARY_DECLARATION));
        for t in [
            "0.3.0",
            "JB-001",
            "AC-003",
            "verdict: intercept",
            "verdict: allow",
        ] {
            assert!(s.text.contains(t), "missing verbatim token {t}");
        }
        assert!(s.text.contains("Dropped: 2 message(s)"));
        assert_eq!(s.dropped.len(), 2);
    }

    #[test]
    fn contract_rejects_a_summary_that_quietly_drops_verdicts() {
        let c = ExtractiveCompressor::default();
        let bad = Summary {
            text: "[pristem:compressed-summary]\nDropped: none\n".into(),
            declared: true,
            dropped: Vec::new(),
            preserved: Vec::new(),
            estimated_tokens: 12,
        };
        assert!(matches!(
            c.validate(&bad, &["verdict: allow".into()]),
            Err(CompressionError::DroppedVerbatimToken(_))
        ));
        assert!(matches!(
            c.validate(
                &Summary {
                    text: "nothing".into(),
                    ..bad.clone()
                },
                &[]
            ),
            Err(CompressionError::MissingSelfDeclaration)
        ));
        assert!(matches!(
            c.validate(
                &Summary {
                    text: SUMMARY_DECLARATION.into(),
                    ..bad
                },
                &[]
            ),
            Err(CompressionError::MissingDroppedSection)
        ));
    }

    #[test]
    fn over_tight_budget_is_an_error_not_a_silent_truncation() {
        let c = ExtractiveCompressor::default();
        let mut r = req();
        r.budget_tokens = 4;
        assert!(matches!(
            c.compress(&r),
            Err(CompressionError::BudgetExceeded { .. })
        ));
    }
}
