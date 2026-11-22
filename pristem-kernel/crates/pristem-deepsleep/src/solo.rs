//! The SOLO.md channel (§8). A clean instance writes **only** through `edit_solo`, and
//! only after promotion. There is deliberately no generic write method on this type.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::RwLock;

#[derive(Debug, thiserror::Error)]
pub enum SoloError {
    #[error("SOLO.md channel is promotion-gated: the clean instance cannot write until a human or a wake briefing promotes it")]
    NotPromoted,
    #[error("solo channel io error: {0}")]
    Io(String),
    #[error("solo channel lock poisoned")]
    LockPoisoned,
}

pub struct SoloChannel {
    path: PathBuf,
    promoted: AtomicBool,
    content: RwLock<String>,
    persist: bool,
}

impl SoloChannel {
    /// `promotion_required = false` is the test-only bypass; the shipped config keeps it
    /// `true`. `persist = false` keeps the channel in memory (used by unit tests).
    pub fn new(path: impl Into<PathBuf>, promotion_required: bool, persist: bool) -> Self {
        Self {
            path: path.into(),
            promoted: AtomicBool::new(!promotion_required),
            content: RwLock::new(String::new()),
            persist,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
    pub fn is_promoted(&self) -> bool {
        self.promoted.load(Ordering::Relaxed)
    }

    /// Promotion is an explicit human / wake-briefing action, never model-driven.
    pub fn promote(&self) {
        self.promoted.store(true, Ordering::Relaxed);
    }
    pub fn demote(&self) {
        self.promoted.store(false, Ordering::Relaxed);
    }

    /// The ONLY write path available to a clean instance.
    pub fn edit_solo(&self, text: &str) -> Result<(), SoloError> {
        if !self.is_promoted() {
            return Err(SoloError::NotPromoted);
        }
        *self.content.write().map_err(|_| SoloError::LockPoisoned)? = text.to_string();
        if self.persist {
            if let Some(parent) = self.path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| SoloError::Io(e.to_string()))?;
            }
            std::fs::write(&self.path, text).map_err(|e| SoloError::Io(e.to_string()))?;
        }
        Ok(())
    }

    pub fn read(&self) -> String {
        self.content.read().map(|c| c.clone()).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn promotion_gate_blocks_until_explicitly_opened() {
        let solo = SoloChannel::new("SOLO.md", true, false);
        assert!(!solo.is_promoted());
        assert!(matches!(
            solo.edit_solo("rule"),
            Err(SoloError::NotPromoted)
        ));
        assert!(solo.read().is_empty());
        solo.promote();
        solo.edit_solo("rule: never guess a version").unwrap();
        assert_eq!(solo.read(), "rule: never guess a version");
        solo.demote();
        assert!(matches!(
            solo.edit_solo("again"),
            Err(SoloError::NotPromoted)
        ));
    }
}
