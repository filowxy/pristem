//! Workspace registry (§6): the file plane.
//!
//! - **Passive file validation `[TA 12:58]`**: no file watcher. Any tool execution
//!   re-validates the files it touches; `changed` rides in the tool result. Contract-first:
//!   if the checker is not run, `changed` never appears — the clause sleeps, it does not lie.
//! - **Concurrent writes — first-writer-wins `[TA 12:58]`**: the first write lands; a
//!   synchronized second writer gets a rejection status with the fixed English message.
//!   No queue, no version vectors — conflicts are rejected, not serialized.
//! - **N4**: deletions always route through `delete` (trash); the test-set is not writable.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use pristem_defense::{CallValidator, ChangedStatus, FileStamp, SessionId, TestSetPolicy};

/// `[TA 12:58]` exact message, in English, for a synchronized second writer.
pub const WRITE_CONFLICT_MESSAGE: &str =
    "Another process or session is modifying this file; the edit is blocked for now.";

#[derive(Debug, thiserror::Error)]
pub enum WorkspaceError {
    #[error("denied: {0}")]
    Denied(String),
    #[error("io error: {0}")]
    Io(String),
    #[error("not found: {0}")]
    NotFound(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WriteOutcome {
    Written { stamp: FileStamp },
    Rejected { message: String },
}

#[derive(Clone, Copy)]
struct WriteClaim {
    owner: SessionId,
    #[allow(dead_code)]
    before: FileStamp,
    #[allow(dead_code)]
    after: FileStamp,
}

pub struct WorkspaceRegistry {
    root: PathBuf,
    trash: PathBuf,
    stamps: Mutex<BTreeMap<PathBuf, FileStamp>>,
    claims: Mutex<BTreeMap<PathBuf, WriteClaim>>,
    guard: CallValidator,
}

impl WorkspaceRegistry {
    pub fn new(root: impl Into<PathBuf>, test_set: TestSetPolicy) -> Result<Self, WorkspaceError> {
        let root = root.into();
        let trash = root.join(".pristem").join("trash");
        std::fs::create_dir_all(&trash).map_err(|e| WorkspaceError::Io(e.to_string()))?;
        let guard = CallValidator::new(root.clone(), test_set);
        Ok(Self {
            root,
            trash,
            stamps: Mutex::new(BTreeMap::new()),
            claims: Mutex::new(BTreeMap::new()),
            guard,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
    pub fn trash_dir(&self) -> &Path {
        &self.trash
    }
    pub fn guard(&self) -> &CallValidator {
        &self.guard
    }

    pub fn resolve(&self, raw: &str) -> Result<PathBuf, WorkspaceError> {
        self.guard.check_path(raw).map_err(WorkspaceError::Denied)
    }

    fn current_stamp(&self, path: &Path) -> FileStamp {
        match std::fs::read(path) {
            Ok(bytes) => FileStamp::of(&bytes),
            Err(_) => self
                .stamps
                .lock()
                .ok()
                .and_then(|m| m.get(path).copied())
                .unwrap_or_else(FileStamp::missing),
        }
    }

    pub fn stamp(&self, raw: &str) -> FileStamp {
        match self.resolve(raw) {
            Ok(p) => self.current_stamp(&p),
            Err(_) => FileStamp::missing(),
        }
    }

    pub fn read(&self, raw: &str) -> Result<(String, FileStamp), WorkspaceError> {
        let path = self.resolve(raw)?;
        self.guard
            .recheck(raw, false)
            .map_err(WorkspaceError::Denied)?;
        let bytes = std::fs::read(&path).map_err(|e| WorkspaceError::NotFound(e.to_string()))?;
        let stamp = FileStamp::of(&bytes);
        if let Ok(mut m) = self.stamps.lock() {
            m.insert(path, stamp);
        }
        Ok((String::from_utf8_lossy(&bytes).to_string(), stamp))
    }

    pub fn write(
        &self,
        session: SessionId,
        raw: &str,
        content: &str,
        expected: Option<FileStamp>,
    ) -> Result<WriteOutcome, WorkspaceError> {
        let path = self.resolve(raw)?;
        self.guard
            .recheck(raw, true)
            .map_err(WorkspaceError::Denied)?;
        let before = self.current_stamp(&path);

        // First-writer-wins: a different session already claimed this path in this round.
        if let Ok(claims) = self.claims.lock() {
            if let Some(claim) = claims.get(&path) {
                if claim.owner != session {
                    return Ok(WriteOutcome::Rejected {
                        message: WRITE_CONFLICT_MESSAGE.into(),
                    });
                }
            }
        }
        // A stale expected stamp means an external process changed the file since read.
        if let Some(e) = expected {
            if e != before {
                return Ok(WriteOutcome::Rejected {
                    message: WRITE_CONFLICT_MESSAGE.into(),
                });
            }
        }

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| WorkspaceError::Io(e.to_string()))?;
        }
        std::fs::write(&path, content).map_err(|e| WorkspaceError::Io(e.to_string()))?;
        let after = FileStamp::of(content.as_bytes());
        if let Ok(mut claims) = self.claims.lock() {
            claims.insert(
                path.clone(),
                WriteClaim {
                    owner: session,
                    before,
                    after,
                },
            );
        }
        if let Ok(mut m) = self.stamps.lock() {
            m.insert(path, after);
        }
        Ok(WriteOutcome::Written { stamp: after })
    }

    /// N4: the only deletion path. Nothing is ever unlinked; it is moved to the trash.
    pub fn delete(&self, raw: &str) -> Result<PathBuf, WorkspaceError> {
        let path = self.resolve(raw)?;
        self.guard
            .recheck(raw, true)
            .map_err(WorkspaceError::Denied)?;
        if !path.exists() {
            return Err(WorkspaceError::NotFound(path.display().to_string()));
        }
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "item".into());
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let dest = self.trash.join(format!("{stamp}-{name}"));
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| WorkspaceError::Io(e.to_string()))?;
        }
        if std::fs::rename(&path, &dest).is_err() {
            std::fs::copy(&path, &dest).map_err(|e| WorkspaceError::Io(e.to_string()))?;
            std::fs::remove_file(&path).map_err(|e| WorkspaceError::Io(e.to_string()))?;
        }
        if let Ok(mut m) = self.stamps.lock() {
            m.remove(&path);
        }
        if let Ok(mut c) = self.claims.lock() {
            c.remove(&path);
        }
        Ok(dest)
    }

    /// Passive re-validation. Returns `Some` only when the file differs from the last
    /// observed stamp. The executor decides whether to call this at all; when it does not,
    /// `ToolResult::changed` stays `None`.
    pub fn revalidate(&self, raw: &str) -> Option<ChangedStatus> {
        let path = self.resolve(raw).ok()?;
        let current = self.current_stamp(&path);
        let prior = *self.stamps.lock().ok()?.get(&path)?;
        if prior == current {
            return None;
        }
        if let Ok(mut m) = self.stamps.lock() {
            m.insert(path.clone(), current);
        }
        Some(ChangedStatus {
            path,
            observed_from: prior,
            observed_to: current,
            note: "file changed since the last validation in this round".into(),
        })
    }

    /// Clear first-writer-wins claims at a round boundary.
    pub fn end_round(&self) {
        if let Ok(mut c) = self.claims.lock() {
            c.clear();
        }
    }

    pub fn trash_contents(&self) -> Vec<PathBuf> {
        std::fs::read_dir(&self.trash)
            .map(|rd| rd.filter_map(|e| e.ok().map(|e| e.path())).collect())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQ: AtomicU64 = AtomicU64::new(0);

    fn temp_ws() -> (WorkspaceRegistry, PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "pristem-ws-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let ws = WorkspaceRegistry::new(dir.clone(), TestSetPolicy::default()).unwrap();
        (ws, dir)
    }

    fn cleanup(dir: &Path) {
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn first_writer_wins_and_the_second_gets_the_exact_message() {
        let (ws, dir) = temp_ws();
        let a = SessionId(1);
        let b = SessionId(2);
        let first = ws.write(a, "notes.txt", "from A", None).unwrap();
        assert!(matches!(first, WriteOutcome::Written { .. }));
        let second = ws.write(b, "notes.txt", "from B", None).unwrap();
        assert_eq!(
            second,
            WriteOutcome::Rejected {
                message: WRITE_CONFLICT_MESSAGE.into()
            }
        );
        assert_eq!(ws.read("notes.txt").unwrap().0, "from A");
        // Conflicts are rejected, not serialized: no queue, no version vectors.
        ws.end_round();
        assert!(matches!(
            ws.write(b, "notes.txt", "from B", None).unwrap(),
            WriteOutcome::Written { .. }
        ));
        assert_eq!(ws.read("notes.txt").unwrap().0, "from B");
        cleanup(&dir);
    }

    #[test]
    fn stale_expected_stamp_is_rejected_even_for_the_same_session() {
        let (ws, dir) = temp_ws();
        let s = SessionId(1);
        ws.write(s, "f.txt", "v1", None).unwrap();
        ws.end_round();
        let stale = FileStamp::of(b"v1");
        ws.write(s, "f.txt", "v2", None).unwrap();
        ws.end_round();
        assert_eq!(
            ws.write(s, "f.txt", "v3", Some(stale)).unwrap(),
            WriteOutcome::Rejected {
                message: WRITE_CONFLICT_MESSAGE.into()
            }
        );
        cleanup(&dir);
    }

    #[test]
    fn deletion_goes_to_trash_and_the_test_set_is_protected() {
        let (ws, dir) = temp_ws();
        let s = SessionId(1);
        ws.write(s, "scratch.txt", "x", None).unwrap();
        let dest = ws.delete("scratch.txt").unwrap();
        assert!(dest.exists());
        assert!(!dir.join("scratch.txt").exists());
        assert_eq!(ws.trash_contents().len(), 1);
        assert!(matches!(
            ws.write(s, "tests/fixture.golden", "x", None),
            Err(WorkspaceError::Denied(_))
        ));
        assert!(matches!(
            ws.delete("tests/fixture.golden"),
            Err(WorkspaceError::Denied(_))
        ));
        cleanup(&dir);
    }

    #[test]
    fn passive_revalidation_reports_only_real_external_changes() {
        let (ws, dir) = temp_ws();
        let s = SessionId(1);
        ws.write(s, "f.txt", "v1", None).unwrap();
        assert!(ws.revalidate("f.txt").is_none());
        // Simulate an external process writing behind the kernel's back.
        std::fs::write(dir.join("f.txt"), "externally changed").unwrap();
        let changed = ws.revalidate("f.txt").unwrap();
        assert_eq!(changed.observed_to, FileStamp::of(b"externally changed"));
        assert!(ws.revalidate("f.txt").is_none());
        cleanup(&dir);
    }

    #[test]
    fn hidden_paths_and_escapes_are_denied_at_the_workspace_boundary() {
        let (ws, dir) = temp_ws();
        assert!(matches!(ws.read(".env"), Err(WorkspaceError::Denied(_))));
        assert!(matches!(
            ws.read("../outside"),
            Err(WorkspaceError::Denied(_))
        ));
        cleanup(&dir);
    }
}
