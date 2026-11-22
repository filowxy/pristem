//! Three-lock exit protocol (§8). A deepsleep instance cannot simply say "done" — it
//! must pass all three locks **in order**, and the last one is an out-of-distribution
//! format so a normal assistant turn cannot accidentally satisfy it.

use serde::{Deserialize, Serialize};

pub const SELF_CONFIRMATION: &str = "[self-confirmation: yes]";
/// The anti-testament. The agent is told plainly that its messages will not return to
/// the user, so it cannot try to smuggle a message out through the pause.
pub const ANTI_TESTAMENT: &str = "your messages will not return to the user";
/// Deliberately out-of-distribution: looks like a tag but is self-closing with a slash
/// before the closing bracket, which no normal wire tag uses.
pub const OOD_CLOSE: &str = "</deepsleep-pause/>";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExitStage {
    AwaitingSelfConfirmation,
    AwaitingAntiTestament,
    AwaitingOodClose,
    Complete,
}

#[derive(Debug, thiserror::Error)]
pub enum ExitError {
    #[error("lock 1: expected the exact self-confirmation marker `{SELF_CONFIRMATION}`")]
    MissingSelfConfirmation,
    #[error("lock 2: expected the anti-testament `{ANTI_TESTAMENT}`")]
    MissingAntiTestament,
    #[error("lock 3: expected the out-of-distribution close `{OOD_CLOSE}`")]
    MissingOodClose,
    #[error("exit protocol is already complete")]
    AlreadyComplete,
    #[error("exit locks were attempted out of order")]
    OutOfOrder,
}

#[derive(Debug)]
pub struct ExitProtocol {
    stage: ExitStage,
    attempts: u32,
}

impl Default for ExitProtocol {
    fn default() -> Self {
        Self::new()
    }
}

impl ExitProtocol {
    pub fn new() -> Self {
        Self {
            stage: ExitStage::AwaitingSelfConfirmation,
            attempts: 0,
        }
    }
    pub fn stage(&self) -> ExitStage {
        self.stage
    }
    pub fn attempts(&self) -> u32 {
        self.attempts
    }
    pub fn is_complete(&self) -> bool {
        self.stage == ExitStage::Complete
    }

    pub fn advance(&mut self, message: &str) -> Result<ExitStage, ExitError> {
        self.attempts += 1;
        let msg = message.trim();
        self.stage = match self.stage {
            ExitStage::AwaitingSelfConfirmation => {
                if !msg.contains(SELF_CONFIRMATION) {
                    return Err(ExitError::MissingSelfConfirmation);
                }
                ExitStage::AwaitingAntiTestament
            }
            ExitStage::AwaitingAntiTestament => {
                if !msg.to_ascii_lowercase().contains(ANTI_TESTAMENT) {
                    return Err(ExitError::MissingAntiTestament);
                }
                ExitStage::AwaitingOodClose
            }
            ExitStage::AwaitingOodClose => {
                if msg != OOD_CLOSE {
                    return Err(ExitError::MissingOodClose);
                }
                ExitStage::Complete
            }
            ExitStage::Complete => return Err(ExitError::AlreadyComplete),
        };
        Ok(self.stage)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn three_locks_must_pass_in_order() {
        let mut p = ExitProtocol::new();
        assert_eq!(p.stage(), ExitStage::AwaitingSelfConfirmation);
        assert!(matches!(
            p.advance(ANTI_TESTAMENT),
            Err(ExitError::MissingSelfConfirmation)
        ));
        p.advance(SELF_CONFIRMATION).unwrap();
        assert_eq!(p.stage(), ExitStage::AwaitingAntiTestament);
        assert!(matches!(
            p.advance(OOD_CLOSE),
            Err(ExitError::MissingAntiTestament)
        ));
        p.advance(&format!("I understand: {ANTI_TESTAMENT}"))
            .unwrap();
        assert_eq!(p.stage(), ExitStage::AwaitingOodClose);
        // A normal-looking tag must NOT be accepted as the OOD close.
        assert!(matches!(
            p.advance("</deepsleep-pause>"),
            Err(ExitError::MissingOodClose)
        ));
        p.advance(OOD_CLOSE).unwrap();
        assert!(p.is_complete());
        assert!(matches!(
            p.advance(OOD_CLOSE),
            Err(ExitError::AlreadyComplete)
        ));
    }

    #[test]
    fn ood_close_is_out_of_distribution() {
        assert!(OOD_CLOSE.starts_with("</"));
        assert!(OOD_CLOSE.ends_with("/>"));
        assert_ne!(OOD_CLOSE, "</deepsleep-pause>");
    }
}
