//! Wake briefing (§8): re-invocation is the new-rules commit point, and the briefing is
//! the **ONLY** channel through which the sleeping agent learns its files changed.
//!
//! `changed_files` is deliberately private with no accessor: there is no other API in
//! this crate that can leak file-change knowledge to a clean instance.

use std::path::PathBuf;

use crate::clean_instance::CleanInstance;

#[derive(Debug, Clone)]
pub struct WakeBriefing {
    pub new_rules: Vec<String>,
    changed_files: Vec<PathBuf>,
    pub committed: bool,
}

impl WakeBriefing {
    pub fn new(new_rules: Vec<String>, changed_files: Vec<PathBuf>) -> Self {
        Self {
            new_rules,
            changed_files,
            committed: false,
        }
    }

    /// The only reader. Ties the briefing to a specific clean instance so the knowledge
    /// cannot be replayed into an unrelated context.
    pub fn brief_for(&self, instance: &CleanInstance) -> String {
        let mut out = format!(
            "[pristem:wake-briefing instance={}]\nnew-rules commit point: {} rule(s)\n",
            instance.tag(),
            self.new_rules.len()
        );
        for (i, r) in self.new_rules.iter().enumerate() {
            out.push_str(&format!("rule#{}: {r}\n", i + 1));
        }
        out.push_str(&format!("changed-files: {}\n", self.changed_files.len()));
        for p in &self.changed_files {
            out.push_str(&format!("- {}\n", p.display()));
        }
        out
    }

    /// Commit the new rules. Returns the committed list; a second commit is a no-op.
    pub fn commit(&mut self) -> Vec<String> {
        self.committed = true;
        self.new_rules.clone()
    }

    pub fn changed_file_count(&self) -> usize {
        self.changed_files.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::solo::SoloChannel;
    use crate::staging::StagingQueue;
    use std::sync::Arc;

    fn instance() -> CleanInstance {
        CleanInstance::spawn(
            "sleep-9",
            Arc::new(StagingQueue::in_memory()),
            Arc::new(SoloChannel::new("SOLO.md", false, false)),
            "digest",
            Default::default(),
        )
    }

    #[test]
    fn briefing_is_the_only_channel_for_changed_files() {
        let mut b = WakeBriefing::new(
            vec!["preserve version numbers verbatim".into()],
            vec![PathBuf::from("SOLO.md"), PathBuf::from("AGENTS.md")],
        );
        let brief = b.brief_for(&instance());
        assert!(brief.contains("SOLO.md"));
        assert!(brief.contains("preserve version numbers verbatim"));
        assert_eq!(b.changed_file_count(), 2);
        assert!(!b.committed);
        assert_eq!(b.commit().len(), 1);
        assert!(b.committed);
    }
}
