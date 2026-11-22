//! Read registry (§7): which files which session has **truly** read. Powers re-read
//! interception (`held`) and changed-marking.
//!
//! Per-session trust by default: session B does NOT inherit session A's reads.
//! Cross-session inheritance is a config flag, default off.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::RwLock;

use pristem_defense::{ChangedStatus, FileStamp, SessionId};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReadRecord {
    pub stamp: FileStamp,
    pub reads: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReadDecision {
    /// Do the read.
    Proceed,
    /// Re-read interception: this session already holds the identical content, so the
    /// read is suppressed and the result carries `held`.
    Held { path: PathBuf, note: String },
}

#[derive(Default)]
pub struct ReadRegistry {
    inner: RwLock<BTreeMap<SessionId, BTreeMap<PathBuf, ReadRecord>>>,
    inherit_across_sessions: AtomicBool,
}

impl ReadRegistry {
    pub fn new(inherit_across_sessions: bool) -> Self {
        Self {
            inner: RwLock::new(BTreeMap::new()),
            inherit_across_sessions: AtomicBool::new(inherit_across_sessions),
        }
    }

    pub fn set_cross_session_inheritance(&self, on: bool) {
        self.inherit_across_sessions.store(on, Ordering::Relaxed);
    }

    pub fn inherits(&self) -> bool {
        self.inherit_across_sessions.load(Ordering::Relaxed)
    }

    pub fn has_read(&self, session: SessionId, path: &Path) -> bool {
        self.inner
            .read()
            .ok()
            .and_then(|m| m.get(&session).map(|p| p.contains_key(path)))
            .unwrap_or(false)
    }

    pub fn stamp(&self, session: SessionId, path: &Path) -> Option<FileStamp> {
        self.inner
            .read()
            .ok()?
            .get(&session)?
            .get(path)
            .map(|r| r.stamp)
    }

    pub fn on_read_intent(
        &self,
        session: SessionId,
        path: &Path,
        current: FileStamp,
    ) -> ReadDecision {
        let held = |note: String| ReadDecision::Held {
            path: path.to_path_buf(),
            note,
        };
        let guard = match self.inner.read() {
            Ok(g) => g,
            Err(_) => return ReadDecision::Proceed,
        };
        if let Some(rec) = guard.get(&session).and_then(|p| p.get(path)) {
            if rec.stamp == current {
                return held("already read in this session; content unchanged".into());
            }
            return ReadDecision::Proceed;
        }
        if self.inherits() {
            for (other, paths) in guard.iter() {
                if *other == session {
                    continue;
                }
                if let Some(rec) = paths.get(path) {
                    if rec.stamp == current {
                        return held(format!(
                            "inherited read from {other}; cross-session inheritance is on"
                        ));
                    }
                }
            }
        }
        ReadDecision::Proceed
    }

    pub fn record(&self, session: SessionId, path: &Path, stamp: FileStamp) {
        if let Ok(mut guard) = self.inner.write() {
            let entry = guard
                .entry(session)
                .or_default()
                .entry(path.to_path_buf())
                .or_insert(ReadRecord { stamp, reads: 0 });
            entry.stamp = stamp;
            entry.reads += 1;
        }
    }

    /// Passive re-validation result. Returns `Some` only when a previously-read file has
    /// actually changed since that read — this is what rides in the tool result as
    /// `changed` (`[TA 12:58]`).
    pub fn mark_changed(
        &self,
        session: SessionId,
        path: &Path,
        new_stamp: FileStamp,
    ) -> Option<ChangedStatus> {
        let mut guard = self.inner.write().ok()?;
        let rec = guard.get_mut(&session)?.get_mut(path)?;
        if rec.stamp == new_stamp {
            return None;
        }
        let old = rec.stamp;
        rec.stamp = new_stamp;
        Some(ChangedStatus {
            path: path.to_path_buf(),
            observed_from: old,
            observed_to: new_stamp,
            note: "file changed since this session read it".into(),
        })
    }

    pub fn known_paths(&self, session: SessionId) -> Vec<PathBuf> {
        self.inner
            .read()
            .map(|m| {
                m.get(&session)
                    .map(|p| p.keys().cloned().collect())
                    .unwrap_or_default()
            })
            .unwrap_or_default()
    }

    pub fn forget_session(&self, session: SessionId) {
        if let Ok(mut guard) = self.inner.write() {
            guard.remove(&session);
        }
    }

    pub fn sessions(&self) -> Vec<SessionId> {
        self.inner
            .read()
            .map(|m| m.keys().copied().collect())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path() -> &'static Path {
        Path::new("src/lib.rs")
    }

    #[test]
    fn per_session_trust_is_the_default() {
        let r = ReadRegistry::new(false);
        let a = SessionId(1);
        let b = SessionId(2);
        let stamp = FileStamp::of(b"same");
        r.record(a, path(), stamp);
        assert!(matches!(
            r.on_read_intent(a, path(), stamp),
            ReadDecision::Held { .. }
        ));
        assert_eq!(r.on_read_intent(b, path(), stamp), ReadDecision::Proceed);
        assert!(!r.has_read(b, path()));
    }

    #[test]
    fn inheritance_is_a_flag_not_a_default() {
        let r = ReadRegistry::new(true);
        r.record(SessionId(1), path(), FileStamp::of(b"x"));
        assert!(matches!(
            r.on_read_intent(SessionId(2), path(), FileStamp::of(b"x")),
            ReadDecision::Held { .. }
        ));
        r.set_cross_session_inheritance(false);
        assert_eq!(
            r.on_read_intent(SessionId(2), path(), FileStamp::of(b"x")),
            ReadDecision::Proceed
        );
    }

    #[test]
    fn changed_marking_only_fires_on_real_change() {
        let r = ReadRegistry::new(false);
        let s = SessionId(1);
        r.record(s, path(), FileStamp::of(b"v1"));
        assert!(r.mark_changed(s, path(), FileStamp::of(b"v1")).is_none());
        let c = r.mark_changed(s, path(), FileStamp::of(b"v2")).unwrap();
        assert_eq!(c.observed_from, FileStamp::of(b"v1"));
        assert_eq!(c.observed_to, FileStamp::of(b"v2"));
        assert!(r.mark_changed(s, path(), FileStamp::of(b"v2")).is_none());
    }

    #[test]
    fn closing_a_session_drops_its_trust() {
        let r = ReadRegistry::new(false);
        let s = SessionId(7);
        r.record(s, path(), FileStamp::of(b"x"));
        r.forget_session(s);
        assert!(!r.has_read(s, path()));
        assert!(r.sessions().is_empty());
    }
}
