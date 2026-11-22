//! `[CHURN]` wire protocol. Everything in this module is expected to be swapped as the
//! system prompt / edit ladder / status-line vocabulary is iterated on the experiment
//! bench. `pristem-core` only knows the [`Protocol`] trait.
//!
//! Default implementation: angle-tag tool calls, square-bracket result blocks with
//! status lines, and an explicit SPLIT POINT marker injected by `assemble`.

use std::sync::OnceLock;

use pristem_defense::{ToolCall, ToolResult};
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::skill::SkillDescriptor;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PromptMessage {
    pub role: String,
    pub content: String,
}

impl PromptMessage {
    pub fn new(role: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: role.into(),
            content: content.into(),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct PromptContext {
    pub mode: String,
    /// SPLIT POINT injection: the immutable constitution lands above this marker, live
    /// round state below. `[CHURN]`
    pub split_point: Option<String>,
    pub agents_md: String,
    pub skills: Vec<SkillDescriptor>,
    pub messages: Vec<PromptMessage>,
    pub reminders: Vec<String>,
    pub output_tags: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Prompt {
    pub system: String,
    pub messages: Vec<PromptMessage>,
    pub injected_split_point: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedReply {
    pub speech: String,
    pub calls: Vec<ToolCall>,
    pub answer: Option<String>,
}

/// The swappable seam. A protocol change lands entirely in a new implementation of this
/// trait; the agent loop is untouched.
pub trait Protocol: Send + Sync {
    fn name(&self) -> &str;
    fn assemble(&self, ctx: &PromptContext) -> Prompt;
    fn parse_calls(&self, reply: &str) -> ParsedReply;
    fn render_results(&self, results: &[ToolResult]) -> String;
    fn output_tags(&self) -> Vec<String>;
    fn split_point_marker(&self) -> &str;
}

pub const SPLIT_POINT_MARKER: &str = "<!-- pristem:split-point -->";

fn call_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"<call\s+([^>]*?)\s*/?>"#).expect("call regex"))
}
fn attr_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"([A-Za-z_][A-Za-z0-9_-]*)="([^"]*)""#).expect("attr regex"))
}
fn answer_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"(?s)<answer>(.*?)</answer>"#).expect("answer regex"))
}

#[derive(Debug, Default, Clone, Copy)]
pub struct AngleTagProtocol;

impl Protocol for AngleTagProtocol {
    fn name(&self) -> &str {
        "angle-tag/v0"
    }

    fn split_point_marker(&self) -> &str {
        SPLIT_POINT_MARKER
    }

    fn output_tags(&self) -> Vec<String> {
        vec!["answer".into(), "call".into()]
    }

    fn assemble(&self, ctx: &PromptContext) -> Prompt {
        let mut system = format!("[pristem:mode {}]\n", ctx.mode);
        system.push_str(ctx.agents_md.trim());
        system.push('\n');
        if !ctx.skills.is_empty() {
            system.push_str("[skills]\n");
            for s in &ctx.skills {
                system.push_str(&format!("- {}: {}\n", s.name, s.description));
            }
        }
        // SPLIT POINT injection: everything above is constitution, everything below is
        // live round state. A protocol swap can reposition this without touching core.
        system.push_str(self.split_point_marker());
        system.push('\n');
        if !ctx.reminders.is_empty() {
            system.push_str("[reminders]\n");
            for r in &ctx.reminders {
                system.push_str(r);
                system.push('\n');
            }
        }
        if let Some(sp) = &ctx.split_point {
            system.push_str("[split-point-context]\n");
            system.push_str(sp);
            system.push('\n');
        }
        if !ctx.output_tags.is_empty() {
            system.push_str(&format!("[output-tags] {}\n", ctx.output_tags.join(", ")));
        }
        Prompt {
            system,
            messages: ctx.messages.clone(),
            injected_split_point: ctx.split_point.clone(),
        }
    }

    fn parse_calls(&self, reply: &str) -> ParsedReply {
        let answer = answer_re()
            .captures(reply)
            .map(|c| c[1].trim().to_string())
            .filter(|s| !s.is_empty());

        let mut calls = Vec::new();
        for cap in call_re().captures_iter(reply) {
            let attrs = &cap[1];
            let mut tool = String::new();
            let mut args = std::collections::BTreeMap::new();
            for a in attr_re().captures_iter(attrs) {
                let key = a[1].to_string();
                let value = a[2].to_string();
                if key == "tool" {
                    tool = value;
                } else {
                    args.insert(key, value);
                }
            }
            if tool.is_empty() {
                continue;
            }
            calls.push(ToolCall {
                tool,
                args,
                raw: cap[0].to_string(),
            });
        }

        let mut speech = call_re().replace_all(reply, "").to_string();
        speech = answer_re().replace_all(&speech, "").to_string();
        ParsedReply {
            speech: speech.trim().to_string(),
            calls,
            answer,
        }
    }

    fn render_results(&self, results: &[ToolResult]) -> String {
        if results.is_empty() {
            return "[round:no-tool-results]\n".into();
        }
        let mut out = String::new();
        for r in results {
            let args: Vec<String> = r
                .call
                .args
                .iter()
                .map(|(k, v)| format!("{k}=\"{v}\""))
                .collect();
            out.push_str(&format!("[{} {}]\n", r.call.tool, args.join(" ")));
            // [CHURN] status-line vocabulary. Note there is NO `changed:` line at all
            // when the passive checker did not run: the clause sleeps, it does not lie.
            out.push_str(&format!("status: {}\n", r.status.as_status_line()));
            if let Some(c) = &r.changed {
                out.push_str(&format!(
                    "changed: yes — {} ({} → {}) {}\n",
                    c.path.display(),
                    c.observed_from.hash,
                    c.observed_to.hash,
                    c.note
                ));
            }
            let body = r.output.trim_end();
            if !body.is_empty() {
                out.push_str(body);
                out.push('\n');
            }
            out.push_str(&format!("[/{}]\n", r.call.tool));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pristem_defense::{CallStatus, ChangedStatus, FileStamp};

    #[test]
    fn parses_angle_tag_calls_and_strips_speech() {
        let p = AngleTagProtocol;
        let parsed = p.parse_calls(
            "Let me read that.\n<call tool=\"read\" path=\"src/lib.rs\"/>\n<answer>done</answer>",
        );
        assert_eq!(parsed.speech, "Let me read that.");
        assert_eq!(parsed.calls.len(), 1);
        assert_eq!(parsed.calls[0].tool, "read");
        assert_eq!(parsed.calls[0].args["path"], "src/lib.rs");
        assert_eq!(parsed.answer.as_deref(), Some("done"));
    }

    #[test]
    fn split_point_is_injected_above_live_state() {
        let p = AngleTagProtocol;
        let prompt = p.assemble(&PromptContext {
            mode: "coding".into(),
            agents_md: "# AGENTS.md\nbe careful".into(),
            split_point: Some("session context below".into()),
            skills: vec![SkillDescriptor {
                name: "deepsleep".into(),
                description: "digest".into(),
            }],
            reminders: vec!["REMINDER: preserve v0.3.0".into()],
            messages: Vec::new(),
            output_tags: p.output_tags(),
        });
        let split = prompt.system.find(SPLIT_POINT_MARKER).unwrap();
        let agents = prompt.system.find("# AGENTS.md").unwrap();
        let reminder = prompt.system.find("[reminders]").unwrap();
        assert!(agents < split);
        assert!(split < reminder);
        assert_eq!(
            prompt.injected_split_point.as_deref(),
            Some("session context below")
        );
    }

    #[test]
    fn changed_line_appears_only_when_the_checker_ran() {
        let p = AngleTagProtocol;
        let call = ToolCall::new("read").arg("path", "src/lib.rs");
        let plain = p.render_results(&[ToolResult::plain(call.clone(), "body", CallStatus::Ok)]);
        assert!(plain.contains("status: ok"));
        assert!(
            !plain.contains("changed:"),
            "contract-first: no checker, no changed line"
        );

        let with_check = p.render_results(&[ToolResult {
            call,
            output: "body".into(),
            status: CallStatus::Changed,
            changed: Some(ChangedStatus {
                path: "src/lib.rs".into(),
                observed_from: FileStamp::of(b"a"),
                observed_to: FileStamp::of(b"b"),
                note: "external edit".into(),
            }),
        }]);
        assert!(with_check.contains("changed: yes"));
        assert!(with_check.contains("status: changed"));
        assert!(with_check.contains("[/read]"));
    }

    #[test]
    fn output_tag_allowlist_is_protocol_owned() {
        assert_eq!(AngleTagProtocol.output_tags(), vec!["answer", "call"]);
    }
}
