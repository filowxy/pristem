//! Wire event schema (§10 / O2 draft filled for the scaffold). `[CHURN: event schema]`.
//!
//! One protocol, both clients. Session open/close, mode switch, round streaming
//! (`speech` / `call` / `result` / `answer`), REMINDER presentation, and button /
//! confirmation round-trips. CLI renders buttons as ANSI/ESC-clickable; desktop as real
//! buttons. The schema carries no client identifier, so the kernel cannot tell which
//! client connected — the only client-specific data is a *self-declared* kind inside
//! `ListModes`, used purely to choose which menu to draw.

use pristem_core::Mode;
use pristem_provider::ProviderInfo;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClientKind {
    Cli,
    Desktop,
}

impl ClientKind {
    /// Presentation only: CLI draws three modes, desktop draws all six. All six modes
    /// exist in the kernel with zero capability difference `[TA §13.1]`.
    pub fn visible_modes(self) -> Vec<Mode> {
        match self {
            Self::Cli => Mode::CLI_VISIBLE.to_vec(),
            Self::Desktop => Mode::ALL.to_vec(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ButtonSpec {
    pub id: u64,
    pub label: String,
    pub choice: String,
    /// OSC 8 hyperlink target for the CLI; desktop may ignore it and use `choice`.
    pub uri: String,
}

impl ButtonSpec {
    pub fn new(id: u64, session: u64, label: &str, choice: &str) -> Self {
        Self {
            id,
            label: label.into(),
            choice: choice.into(),
            uri: format!("pristem://confirm/{session}/{id}/{choice}"),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientRequest {
    OpenSession {
        mode: String,
    },
    CloseSession {
        session: u64,
    },
    SwitchMode {
        session: u64,
        mode: String,
    },
    SubmitRound {
        session: u64,
        text: String,
    },
    /// Button / confirmation round-trip.
    Confirm {
        session: u64,
        id: u64,
        choice: String,
    },
    /// Human release of a quarantined item (dial 3).
    ReleaseQuarantine {
        session: u64,
        id: u64,
    },
    ListReminders {
        session: u64,
    },
    /// Client self-declares its kind to draw its own mode menu.
    ListModes {
        client: ClientKind,
    },
    Annotate {
        session: u64,
        target: String,
        note: String,
        classification: Option<String>,
    },
    Pause {
        session: u64,
    },
    Resume {
        session: u64,
    },
    /// Switch which configured endpoint the agent loop talks to. Takes effect on the next
    /// round; every provider in the map is already registered at bootstrap.
    SetProvider {
        session: u64,
        provider: String,
    },
    /// Which endpoints exist, with model + key *presence* only.
    ListProviders {
        client: ClientKind,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerEvent {
    SessionOpened {
        session: u64,
        mode: String,
    },
    SessionClosed {
        session: u64,
    },
    ModeChanged {
        session: u64,
        from: String,
        to: String,
    },
    Speech {
        session: u64,
        text: String,
    },
    /// One streamed fragment of model output. Clients that only render `speech` may ignore
    /// it — the final `answer` still arrives whole.
    SpeechDelta {
        session: u64,
        text: String,
    },
    Call {
        session: u64,
        tool: String,
        verdict: String,
    },
    Result {
        session: u64,
        tool: String,
        status: String,
        output: String,
    },
    Answer {
        session: u64,
        text: String,
    },
    Intercepted {
        session: u64,
        sig_ids: Vec<String>,
        position: String,
    },
    MissingReminder {
        session: u64,
        lines: Vec<String>,
        reject: bool,
    },
    DigestRequested {
        session: u64,
        reason: String,
    },
    Reminder {
        session: u64,
        lines: Vec<String>,
    },
    Buttons {
        session: u64,
        prompt: String,
        buttons: Vec<ButtonSpec>,
    },
    Finished {
        session: u64,
        outcome: String,
    },
    /// One round's cost and duration. Emitted once per round, right before `finished`.
    Usage {
        session: u64,
        input_tokens: u64,
        output_tokens: u64,
        cached_tokens: u64,
        /// Wall-clock from `submit_round` to this event.
        elapsed_ms: u64,
        /// Number of `call` events in this round (including calls denied by the gate).
        tool_calls: u32,
    },
    /// Acknowledge a provider switch (also emitted for the initial default).
    ProviderChanged {
        session: u64,
        provider: String,
        model: String,
    },
    Providers {
        providers: Vec<ProviderInfo>,
    },
    Error {
        /// Session the failure belongs to. `0` means "unknown session" — an error
        /// raised before a session existed (e.g. `open_session` on an unknown mode).
        #[serde(default)]
        session: u64,
        message: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_protocol_both_clients_no_capability_difference() {
        assert_eq!(ClientKind::Cli.visible_modes().len(), 3);
        assert_eq!(ClientKind::Desktop.visible_modes().len(), 6);
        // Every CLI mode also exists for desktop; the restriction is a menu only.
        assert!(ClientKind::Cli
            .visible_modes()
            .iter()
            .all(|m| ClientKind::Desktop.visible_modes().contains(m)));
    }

    #[test]
    fn event_schema_is_internally_tagged_and_buttons_carry_a_uri() {
        let ev = ServerEvent::Answer {
            session: 1,
            text: "ok".into(),
        };
        let json = serde_json::to_string(&ev).unwrap();
        assert!(json.contains("\"type\":\"answer\""));
        let req: ClientRequest =
            serde_json::from_str(r#"{"type":"list_modes","client":"cli"}"#).unwrap();
        assert_eq!(
            req,
            ClientRequest::ListModes {
                client: ClientKind::Cli
            }
        );
        let b = ButtonSpec::new(7, 1, "Release", "release");
        assert_eq!(b.uri, "pristem://confirm/1/7/release");
    }
}
