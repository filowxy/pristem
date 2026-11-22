//! Mode router (§4): a six-state machine per session. Transitions fire **context
//! firewalls** on entry: tool-table swap, output-tag allowlist, context partition reset
//! (the mode-cross-contamination guard).
//!
//! O5 (six-mode transition table formal pass) is closed here with an explicit 6×6 table.
//! The three CLI-visible modes are a **client-side** presentation choice only: the kernel
//! supports all six and cannot tell which client connected (`[TA §13.1]`).

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Coding,
    Ide,
    Helping,
    Advisor,
    Deepsleep,
    Goal,
}

impl Mode {
    pub const ALL: [Self; 6] = [
        Self::Coding,
        Self::Ide,
        Self::Helping,
        Self::Advisor,
        Self::Deepsleep,
        Self::Goal,
    ];

    /// §1: CLI renders these three; desktop renders all six. Kernel-enforced capability
    /// is identical — this is purely a client menu, and `pristem-ipc` never branches on
    /// client kind.
    pub const CLI_VISIBLE: [Self; 3] = [Self::Goal, Self::Coding, Self::Deepsleep];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Coding => "coding",
            Self::Ide => "IDE",
            Self::Helping => "helping",
            Self::Advisor => "advisor",
            Self::Deepsleep => "deepsleep",
            Self::Goal => "goal",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|m| m.as_str().eq_ignore_ascii_case(s))
    }

    pub fn tool_allowlist(self) -> BTreeSet<String> {
        let names: &[&str] = match self {
            Self::Coding => &[
                "read",
                "search",
                "write",
                "edit",
                "delete",
                "exec",
                "reminder",
                "skill-load",
                "improve",
            ],
            Self::Goal => &[
                "read",
                "search",
                "write",
                "edit",
                "delete",
                "exec",
                "reminder",
                "skill-load",
                "improve",
                "pause",
            ],
            Self::Ide => &[
                "read",
                "search",
                "write",
                "edit",
                "delete",
                "exec",
                "reminder",
                "skill-load",
            ],
            Self::Helping => &["read", "search", "reminder", "skill-load"],
            Self::Advisor => &["read", "search", "pause", "reminder"],
            Self::Deepsleep => &["read", "search", "solo", "pause", "reminder"],
        };
        names.iter().map(|s| (*s).to_string()).collect()
    }

    /// `[CHURN]` output-tag allowlist lives with the protocol, but each mode narrows it.
    pub fn output_tags(self) -> Vec<String> {
        let mut tags = vec!["answer".to_string(), "call".to_string()];
        match self {
            Self::Advisor => tags.push("annotation".into()),
            Self::Deepsleep => tags.push("solo".into()),
            _ => {}
        }
        tags
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContextFirewall {
    pub mode: Mode,
    pub tool_table: BTreeSet<String>,
    pub output_tags: Vec<String>,
    /// A monotonically increasing partition id. On every mode entry the round context is
    /// partitioned afresh, so state from the previous mode cannot bleed in.
    pub partition_id: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TransitionRule {
    pub allowed: bool,
    pub note: &'static str,
}

#[derive(Debug, thiserror::Error)]
pub enum ModeError {
    #[error("mode transition {from} -> {to} is forbidden: {note}")]
    ForbiddenTransition {
        from: String,
        to: String,
        note: &'static str,
    },
}

/// O5 formal pass: every ordered pair gets an explicit rule. Deepsleep entry is
/// restricted (it needs a clean instance), and deepsleep exit is the wake-briefing
/// commit point, so it only opens into coding / goal.
pub fn transition_table() -> BTreeMap<(Mode, Mode), TransitionRule> {
    let mut table = BTreeMap::new();
    for from in Mode::ALL {
        for to in Mode::ALL {
            let (allowed, note) = if from == to {
                (true, "no-op: same mode")
            } else if to == Mode::Deepsleep {
                (
                    matches!(from, Mode::Goal | Mode::Coding | Mode::Advisor),
                    "deepsleep entry requires a clean-instance handoff",
                )
            } else if from == Mode::Deepsleep {
                (
                    matches!(to, Mode::Coding | Mode::Goal),
                    "wake briefing is the new-rules commit point",
                )
            } else {
                (true, "free transition with context firewall")
            };
            table.insert((from, to), TransitionRule { allowed, note });
        }
    }
    table
}

pub struct ModeRouter {
    current: Mode,
    partition_seq: u64,
    table: BTreeMap<(Mode, Mode), TransitionRule>,
}

impl ModeRouter {
    pub fn new(initial: Mode) -> Self {
        Self {
            current: initial,
            partition_seq: 1,
            table: transition_table(),
        }
    }
    pub fn current(&self) -> Mode {
        self.current
    }
    pub fn table(&self) -> &BTreeMap<(Mode, Mode), TransitionRule> {
        &self.table
    }

    pub fn firewall(&self) -> ContextFirewall {
        ContextFirewall {
            mode: self.current,
            tool_table: self.current.tool_allowlist(),
            output_tags: self.current.output_tags(),
            partition_id: self.partition_seq,
        }
    }

    /// Applies the firewall on ENTRY: tool-table swap, output-tag allowlist, context
    /// partition reset. Returns the new firewall so the round loop can pick it up.
    pub fn switch(&mut self, to: Mode) -> Result<ContextFirewall, ModeError> {
        let rule = self
            .table
            .get(&(self.current, to))
            .copied()
            .unwrap_or(TransitionRule {
                allowed: false,
                note: "unlisted transition",
            });
        if !rule.allowed {
            return Err(ModeError::ForbiddenTransition {
                from: self.current.as_str().into(),
                to: to.as_str().into(),
                note: rule.note,
            });
        }
        if self.current != to {
            self.partition_seq += 1;
        }
        self.current = to;
        Ok(self.firewall())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn six_modes_and_three_cli_modes() {
        assert_eq!(Mode::ALL.len(), 6);
        assert_eq!(Mode::CLI_VISIBLE.len(), 3);
        assert!(Mode::CLI_VISIBLE.contains(&Mode::Goal));
        assert!(Mode::CLI_VISIBLE.contains(&Mode::Coding));
        assert!(Mode::CLI_VISIBLE.contains(&Mode::Deepsleep));
        assert!(Mode::ALL.contains(&Mode::Ide));
    }

    #[test]
    fn transition_table_is_a_formal_6x6() {
        let table = transition_table();
        assert_eq!(table.len(), 36);
        assert!(!table[&(Mode::Helping, Mode::Deepsleep)].allowed);
        assert!(!table[&(Mode::Ide, Mode::Deepsleep)].allowed);
        assert!(table[&(Mode::Advisor, Mode::Deepsleep)].allowed);
        assert!(!table[&(Mode::Deepsleep, Mode::Ide)].allowed);
        assert!(table[&(Mode::Deepsleep, Mode::Coding)].allowed);
    }

    #[test]
    fn every_mode_entry_swaps_the_tool_table_and_resets_the_partition() {
        let mut r = ModeRouter::new(Mode::Coding);
        let first = r.firewall();
        assert!(first.tool_table.contains("write"));
        let helping = r.switch(Mode::Helping).unwrap();
        assert_eq!(helping.partition_id, first.partition_id + 1);
        assert!(
            !helping.tool_table.contains("write"),
            "context firewall swapped the tool table"
        );
        assert!(helping.tool_table.contains("read"));
        assert_eq!(r.current(), Mode::Helping);
    }

    #[test]
    fn forbidden_transition_does_not_mutate_the_router() {
        let mut r = ModeRouter::new(Mode::Helping);
        let err = r.switch(Mode::Deepsleep).unwrap_err();
        assert!(matches!(err, ModeError::ForbiddenTransition { .. }));
        assert_eq!(r.current(), Mode::Helping);
        assert_eq!(r.firewall().partition_id, 1);
    }

    #[test]
    fn deepsleep_uses_solo_not_arbitrary_writes() {
        let r = ModeRouter::new(Mode::Deepsleep);
        let fw = r.firewall();
        assert!(fw.tool_table.contains("solo"));
        assert!(!fw.tool_table.contains("write"));
    }
}
