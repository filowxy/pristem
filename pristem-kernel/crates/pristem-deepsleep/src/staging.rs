//! Staging queue (§8, `[K3]`): three intake channels unify into ONE store, shared with
//! archives.
//!
//! The ratified design calls for SQLite + FTS5. This host is `x86_64-pc-windows-gnullvm`
//! with `rust-lld` and cannot link bundled SQLite's Windows import libraries
//! (`advapi32`/`ole32`/`oleaut32`), so the scaffold ships a **portable default backend**
//! behind [`StagingStore`]: an append-only JSONL store with an in-memory inverted index
//! that implements FTS5-style `MATCH` (AND of lowercased terms). A `rusqlite`-backed
//! `impl StagingStore` drops in without changing a single caller — that seam is exactly
//! why the foundation is "buildable today and upgradable tomorrow".
//!
//! The three intake channels: `/improve` inline, advisor structured, implicit mining.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntakeChannel {
    ImproveInline,
    AdvisorStructured,
    ImplicitMining,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StagingKind {
    SameClassError,
    UserCorrection,
    Improvement,
    Annotation,
    Archive,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StagingStatus {
    Pending,
    Digested,
    Promoted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StagingRecord {
    pub id: u64,
    pub channel: IntakeChannel,
    pub kind: StagingKind,
    pub class_hash: String,
    pub body: String,
    pub created_at: u64,
    pub status: StagingStatus,
}

#[derive(Debug, thiserror::Error)]
pub enum StagingError {
    #[error("staging store io error: {0}")]
    Io(String),
    #[error("staging record {0} not found")]
    NotFound(u64),
    #[error("staging store lock poisoned")]
    LockPoisoned,
    #[error("json error: {0}")]
    Json(String),
}

pub trait StagingStore: Send + Sync {
    fn insert(&self, rec: &StagingRecord) -> Result<u64, StagingError>;
    fn all(&self) -> Result<Vec<StagingRecord>, StagingError>;
    fn by_class(&self, hash: &str) -> Result<Vec<StagingRecord>, StagingError>;
    /// FTS5 `MATCH` semantics: whitespace-separated terms, AND-combined, case-folded.
    fn search(&self, query: &str) -> Result<Vec<StagingRecord>, StagingError>;
    fn set_status(&self, id: u64, status: StagingStatus) -> Result<(), StagingError>;
    fn store_path(&self) -> PathBuf;
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn terms(text: &str) -> Vec<String> {
    text.to_ascii_lowercase()
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

#[derive(Default)]
struct StoreInner {
    records: BTreeMap<u64, StagingRecord>,
    index: BTreeMap<String, BTreeSet<u64>>,
    next_id: u64,
}

/// Portable FTS-equivalent backend. `None` path means pure in-memory (used by tests and
/// by the default engine); a `Some(path)` persists to an append-only JSONL file.
pub struct PortableStagingStore {
    path: Option<PathBuf>,
    inner: RwLock<StoreInner>,
}

impl PortableStagingStore {
    pub fn in_memory() -> Self {
        Self::open(None).expect("in-memory store cannot fail")
    }

    pub fn open(path: Option<&Path>) -> Result<Self, StagingError> {
        let mut inner = StoreInner::default();
        if let Some(p) = path {
            if p.exists() {
                let text =
                    std::fs::read_to_string(p).map_err(|e| StagingError::Io(e.to_string()))?;
                for line in text.lines().filter(|l| !l.trim().is_empty()) {
                    let rec: StagingRecord = serde_json::from_str(line)
                        .map_err(|e| StagingError::Json(e.to_string()))?;
                    inner.next_id = inner.next_id.max(rec.id + 1);
                    for t in terms(&rec.body) {
                        inner.index.entry(t).or_default().insert(rec.id);
                    }
                    inner.records.insert(rec.id, rec);
                }
            } else if let Some(parent) = p.parent() {
                std::fs::create_dir_all(parent).map_err(|e| StagingError::Io(e.to_string()))?;
            }
        }
        Ok(Self {
            path: path.map(Path::to_path_buf),
            inner: RwLock::new(inner),
        })
    }

    fn persist(&self, inner: &StoreInner) -> Result<(), StagingError> {
        let Some(p) = &self.path else { return Ok(()) };
        let mut buf = String::new();
        for rec in inner.records.values() {
            buf.push_str(
                &serde_json::to_string(rec).map_err(|e| StagingError::Json(e.to_string()))?,
            );
            buf.push('\n');
        }
        std::fs::write(p, buf).map_err(|e| StagingError::Io(e.to_string()))
    }
}

impl StagingStore for PortableStagingStore {
    fn insert(&self, rec: &StagingRecord) -> Result<u64, StagingError> {
        let mut inner = self.inner.write().map_err(|_| StagingError::LockPoisoned)?;
        let id = inner.next_id + 1;
        inner.next_id = id;
        let mut stored = rec.clone();
        stored.id = id;
        if stored.created_at == 0 {
            stored.created_at = now();
        }
        for t in terms(&stored.body) {
            inner.index.entry(t).or_default().insert(id);
        }
        inner.records.insert(id, stored);
        self.persist(&inner)?;
        Ok(id)
    }

    fn all(&self) -> Result<Vec<StagingRecord>, StagingError> {
        Ok(self
            .inner
            .read()
            .map_err(|_| StagingError::LockPoisoned)?
            .records
            .values()
            .cloned()
            .collect())
    }

    fn by_class(&self, hash: &str) -> Result<Vec<StagingRecord>, StagingError> {
        Ok(self
            .inner
            .read()
            .map_err(|_| StagingError::LockPoisoned)?
            .records
            .values()
            .filter(|r| r.class_hash == hash)
            .cloned()
            .collect())
    }

    fn search(&self, query: &str) -> Result<Vec<StagingRecord>, StagingError> {
        let inner = self.inner.read().map_err(|_| StagingError::LockPoisoned)?;
        let query_terms = terms(query);
        if query_terms.is_empty() {
            return Ok(inner.records.values().cloned().collect());
        }
        let sets: Vec<&BTreeSet<u64>> = query_terms
            .iter()
            .filter_map(|t| inner.index.get(t))
            .collect();
        if sets.len() != query_terms.len() {
            return Ok(Vec::new());
        }
        let mut ids: Vec<u64> = sets[0]
            .iter()
            .filter(|id| sets.iter().all(|s| s.contains(*id)))
            .copied()
            .collect();
        ids.sort_unstable();
        Ok(ids
            .into_iter()
            .filter_map(|id| inner.records.get(&id).cloned())
            .collect())
    }

    fn set_status(&self, id: u64, status: StagingStatus) -> Result<(), StagingError> {
        let mut inner = self.inner.write().map_err(|_| StagingError::LockPoisoned)?;
        let rec = inner
            .records
            .get_mut(&id)
            .ok_or(StagingError::NotFound(id))?;
        rec.status = status;
        self.persist(&inner)
    }

    fn store_path(&self) -> PathBuf {
        self.path
            .clone()
            .unwrap_or_else(|| PathBuf::from(":memory:"))
    }
}

/// The single queue. Archives use the SAME store (`[K3]`), just a different `kind`.
#[derive(Clone)]
pub struct StagingQueue {
    store: Arc<dyn StagingStore>,
}

impl StagingQueue {
    pub fn new(store: Arc<dyn StagingStore>) -> Self {
        Self { store }
    }
    pub fn in_memory() -> Self {
        Self::new(Arc::new(PortableStagingStore::in_memory()))
    }
    pub fn store(&self) -> &Arc<dyn StagingStore> {
        &self.store
    }

    pub fn enqueue(
        &self,
        channel: IntakeChannel,
        kind: StagingKind,
        class_hash: impl Into<String>,
        body: impl Into<String>,
    ) -> Result<StagingRecord, StagingError> {
        let rec = StagingRecord {
            id: 0,
            channel,
            kind,
            class_hash: class_hash.into(),
            body: body.into(),
            created_at: now(),
            status: StagingStatus::Pending,
        };
        let id = self.store.insert(&rec)?;
        let mut rec = rec;
        rec.id = id;
        Ok(rec)
    }

    /// Channel 1: `/improve` inline.
    pub fn intake_improve(&self, note: &str) -> Result<StagingRecord, StagingError> {
        self.enqueue(
            IntakeChannel::ImproveInline,
            StagingKind::Improvement,
            "improve",
            note,
        )
    }

    /// Channel 2: advisor structured. Classification is stored but deliberately NOT
    /// used by the trigger critical path (`[TA: advisor stays thin]`).
    pub fn intake_advisor(
        &self,
        note: &str,
        classification: Option<&str>,
    ) -> Result<StagingRecord, StagingError> {
        let body = match classification {
            Some(c) => format!("{note}\n[classification: {c}]"),
            None => note.to_string(),
        };
        self.enqueue(
            IntakeChannel::AdvisorStructured,
            StagingKind::Annotation,
            "annotation",
            body,
        )
    }

    /// Channel 3: implicit mining (model-side same-class hints).
    pub fn intake_implicit(
        &self,
        body: &str,
        class_hint: &str,
    ) -> Result<StagingRecord, StagingError> {
        self.enqueue(
            IntakeChannel::ImplicitMining,
            StagingKind::SameClassError,
            class_hint,
            body,
        )
    }

    /// `[K3]` archives share the store with staging.
    pub fn archive(&self, body: &str) -> Result<StagingRecord, StagingError> {
        self.enqueue(
            IntakeChannel::ImplicitMining,
            StagingKind::Archive,
            "archive",
            body,
        )
    }

    pub fn search(&self, query: &str) -> Result<Vec<StagingRecord>, StagingError> {
        self.store.search(query)
    }
    pub fn by_class(&self, hash: &str) -> Result<Vec<StagingRecord>, StagingError> {
        self.store.by_class(hash)
    }
    pub fn all(&self) -> Result<Vec<StagingRecord>, StagingError> {
        self.store.all()
    }
    pub fn pending(&self) -> Result<Vec<StagingRecord>, StagingError> {
        Ok(self
            .all()?
            .into_iter()
            .filter(|r| r.status == StagingStatus::Pending)
            .collect())
    }
    pub fn mark_digested(&self, id: u64) -> Result<(), StagingError> {
        self.store.set_status(id, StagingStatus::Digested)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn three_intake_channels_unify_in_one_store() {
        let q = StagingQueue::in_memory();
        q.intake_improve("make the gate stricter").unwrap();
        q.intake_advisor("this line is wrong", Some("hallucination"))
            .unwrap();
        q.intake_implicit("error E42 again", "hash-e42").unwrap();
        assert_eq!(q.all().unwrap().len(), 3);
        let channels: BTreeSet<_> = q.all().unwrap().into_iter().map(|r| r.channel).collect();
        assert_eq!(channels.len(), 3);
    }

    #[test]
    fn fts_match_is_and_combined_and_case_folded() {
        let q = StagingQueue::in_memory();
        q.archive("Agent loop defence overhead measured at 3 percent")
            .unwrap();
        q.archive("Wake briefing changed files list").unwrap();
        assert_eq!(q.search("agent loop").unwrap().len(), 1);
        assert_eq!(q.search("AGENT LOOP").unwrap().len(), 1);
        assert_eq!(q.search("agent briefing").unwrap().len(), 0);
        assert_eq!(q.search("").unwrap().len(), 2);
    }

    #[test]
    fn archives_use_the_same_store_and_status_transitions() {
        let q = StagingQueue::in_memory();
        let a = q.archive("output chain v0.3.0").unwrap();
        assert_eq!(q.store().store_path(), PathBuf::from(":memory:"));
        q.mark_digested(a.id).unwrap();
        assert_eq!(q.pending().unwrap().len(), 0);
        assert_eq!(
            q.by_class("archive").unwrap()[0].status,
            StagingStatus::Digested
        );
    }

    #[test]
    fn jsonl_backend_reloads_and_rebuilds_the_index() {
        let dir = std::env::temp_dir().join(format!("pristem-staging-{}", std::process::id()));
        let path = dir.join("queue.jsonl");
        let _ = std::fs::remove_file(&path);
        {
            let store = Arc::new(PortableStagingStore::open(Some(&path)).unwrap());
            let q = StagingQueue::new(store);
            q.archive("persistent archive token").unwrap();
        }
        let store = Arc::new(PortableStagingStore::open(Some(&path)).unwrap());
        let q = StagingQueue::new(store);
        assert_eq!(q.search("persistent token").unwrap().len(), 1);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir(&dir);
    }
}
