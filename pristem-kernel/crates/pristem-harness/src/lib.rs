//! # pristem-harness — cross-session singletons (§7) and the `[CHURN]` wire protocol.
//!
//! Everything in this crate is shared by every session: the read registry, the
//! compression executor, the REMINDER store and the skill loader. `SessionManager` owns
//! exactly one `HarnessServices` and hands out `Arc`s.
//!
//! The wire protocol (system prompt shape, angle-tag tool calls, square-bracket results,
//! status-line vocabulary, edit ladder, REMINDER semantics) is still being iterated on
//! the experiment bench. It is therefore isolated behind [`protocol::Protocol`]: swapping
//! the protocol is a single assignment in `HarnessServices::with_protocol`, with no
//! changes to `pristem-core`.

pub mod compression;
pub mod protocol;
pub mod registry;
pub mod reminder;
pub mod skill;

use std::sync::Arc;

use pristem_defense::{SessionId, ToolResult};
pub use protocol::{AngleTagProtocol, ParsedReply, Prompt, PromptContext, PromptMessage, Protocol};

/// Cross-session singletons. Cheap to clone: every field is an `Arc`.
#[derive(Clone)]
pub struct HarnessServices {
    pub protocol: Arc<dyn Protocol>,
    pub registry: Arc<registry::ReadRegistry>,
    pub compressor: Arc<dyn compression::Compressor>,
    pub reminders: Arc<reminder::ReminderStore>,
    pub skills: Arc<skill::SkillLoader>,
}

impl Default for HarnessServices {
    fn default() -> Self {
        Self::new()
    }
}

impl HarnessServices {
    pub fn new() -> Self {
        Self {
            protocol: Arc::new(AngleTagProtocol),
            registry: Arc::new(registry::ReadRegistry::new(false)),
            compressor: Arc::new(compression::ExtractiveCompressor::default()),
            reminders: Arc::new(reminder::ReminderStore::default()),
            skills: Arc::new(skill::SkillLoader::default()),
        }
    }

    /// The `[CHURN]` swap point.
    pub fn with_protocol(mut self, protocol: Arc<dyn Protocol>) -> Self {
        self.protocol = protocol;
        self
    }

    pub fn assemble(&self, ctx: &PromptContext) -> Prompt {
        self.protocol.assemble(ctx)
    }
    pub fn parse_calls(&self, reply: &str) -> ParsedReply {
        self.protocol.parse_calls(reply)
    }
    pub fn render_results(&self, results: &[ToolResult]) -> String {
        self.protocol.render_results(results)
    }
    pub fn required_lines(&self, session: SessionId) -> Vec<String> {
        self.reminders.required_lines(session)
    }
    pub fn skill_descriptors(&self) -> Vec<skill::SkillDescriptor> {
        self.skills.descriptors()
    }
}
