//! Versioned, hot-updatable permission-signature database (`sigdb/`).
//!
//! The DB is a shared `Arc<RwLock<Snapshot>>`: a hot update compiles the whole new corpus
//! off to the side and then swaps it in atomically, so a round in flight never sees a
//! half-updated set. Updates are rejected unless the version strictly increases.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{Arc, Mutex, RwLock};

use regex::{Regex, RegexBuilder, RegexSet, RegexSetBuilder};
use serde::{Deserialize, Serialize};

use crate::model::{AuditTier, SignatureKind, SignatureScope};

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Version(u32, u32, u32);

impl Version {
    pub fn parse(s: &str) -> Result<Self, SigdbError> {
        let parts: Vec<_> = s.trim().split('.').collect();
        if parts.len() != 3 {
            return Err(SigdbError::BadVersion(s.to_string()));
        }
        let nums = parts
            .iter()
            .map(|p| {
                p.parse::<u32>()
                    .map_err(|_| SigdbError::BadVersion(s.to_string()))
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self(nums[0], nums[1], nums[2]))
    }
    pub fn as_str(&self) -> String {
        format!("{}.{}.{}", self.0, self.1, self.2)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Signature {
    pub id: String,
    pub kind: SignatureKind,
    pub scope: SignatureScope,
    pub pattern: String,
    pub severity: u8,
    pub audit: AuditTier,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigdbFile {
    pub version: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub note: String,
    pub signatures: Vec<Signature>,
}

#[derive(Clone)]
struct CompiledSignature {
    meta: Signature,
    re: Regex,
}

/// A combined automaton per scope acts as a cheap prefilter: clean text costs ONE pass
/// over the corpus instead of one regex run per signature. Only the few patterns that
/// actually match are re-run individually to recover byte spans for the audit log.
struct Snapshot {
    version: Version,
    compiled: Vec<CompiledSignature>,
    sets: BTreeMap<SignatureScope, (RegexSet, Vec<usize>)>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SignatureHit {
    pub sig_id: String,
    pub kind: SignatureKind,
    pub severity: u8,
    pub declared_audit: AuditTier,
    pub matched: String,
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateReport {
    pub from: String,
    pub to: String,
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub retained: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum SigdbError {
    #[error("bad sigdb version string: {0}")]
    BadVersion(String),
    #[error("sigdb hot update {0} is not newer than current {1}")]
    StaleVersion(String, String),
    #[error("invalid regex for signature {0}: {1}")]
    InvalidPattern(String, String),
    #[error("duplicate signature id {0}")]
    DuplicateId(String),
    #[error("io error: {0}")]
    Io(String),
    #[error("json error: {0}")]
    Json(String),
}

#[derive(Clone)]
pub struct SignatureDb {
    snapshot: Arc<RwLock<Snapshot>>,
    counters: Arc<Mutex<BTreeMap<String, u64>>>,
}

impl Default for SignatureDb {
    fn default() -> Self {
        Self::empty()
    }
}

impl SignatureDb {
    pub fn empty() -> Self {
        Self {
            snapshot: Arc::new(RwLock::new(Snapshot {
                version: Version(0, 0, 0),
                compiled: Vec::new(),
                sets: BTreeMap::new(),
            })),
            counters: Arc::new(Mutex::new(BTreeMap::new())),
        }
    }

    pub fn from_json(json: &str) -> Result<Self, SigdbError> {
        let db = Self::empty();
        db.hot_update(json)?;
        Ok(db)
    }

    pub fn load_from_path(path: &Path) -> Result<Self, SigdbError> {
        let json = std::fs::read_to_string(path).map_err(|e| SigdbError::Io(e.to_string()))?;
        Self::from_json(&json)
    }

    /// Compile-then-swap. Never mutates the live snapshot in place.
    pub fn hot_update(&self, json: &str) -> Result<UpdateReport, SigdbError> {
        let file: SigdbFile =
            serde_json::from_str(json).map_err(|e| SigdbError::Json(e.to_string()))?;
        let next_version = Version::parse(&file.version)?;

        let mut seen = std::collections::BTreeSet::new();
        let mut compiled = Vec::with_capacity(file.signatures.len());
        for meta in file.signatures {
            if !seen.insert(meta.id.clone()) {
                return Err(SigdbError::DuplicateId(meta.id));
            }
            let re = RegexBuilder::new(&meta.pattern)
                .case_insensitive(true)
                .multi_line(true)
                .build()
                .map_err(|e| SigdbError::InvalidPattern(meta.id.clone(), e.to_string()))?;
            compiled.push(CompiledSignature { meta, re });
        }

        let mut sets = BTreeMap::new();
        for scope in [SignatureScope::Context, SignatureScope::Command] {
            let indices: Vec<usize> = compiled
                .iter()
                .enumerate()
                .filter(|(_, c)| c.meta.scope == scope)
                .map(|(i, _)| i)
                .collect();
            if indices.is_empty() {
                continue;
            }
            let patterns: Vec<&str> = indices
                .iter()
                .map(|&i| compiled[i].meta.pattern.as_str())
                .collect();
            let set = RegexSetBuilder::new(patterns)
                .case_insensitive(true)
                .multi_line(true)
                .build()
                .map_err(|e| {
                    SigdbError::InvalidPattern(scope_label(scope).into(), e.to_string())
                })?;
            sets.insert(scope, (set, indices));
        }

        let mut guard = self
            .snapshot
            .write()
            .map_err(|_| SigdbError::Io("sigdb lock poisoned".into()))?;
        if next_version <= guard.version {
            return Err(SigdbError::StaleVersion(
                next_version.as_str(),
                guard.version.as_str(),
            ));
        }
        let old_ids: Vec<String> = guard.compiled.iter().map(|c| c.meta.id.clone()).collect();
        let new_ids: std::collections::BTreeSet<String> =
            compiled.iter().map(|c| c.meta.id.clone()).collect();
        let added = compiled
            .iter()
            .map(|c| c.meta.id.clone())
            .filter(|id| !old_ids.contains(id))
            .collect();
        let removed = old_ids
            .into_iter()
            .filter(|id| !new_ids.contains(id))
            .collect();
        let retained = compiled.len();
        let from = guard.version.as_str();
        let to = next_version.as_str();
        *guard = Snapshot {
            version: next_version,
            compiled,
            sets,
        };
        drop(guard);
        Ok(UpdateReport {
            from,
            to,
            added,
            removed,
            retained,
        })
    }

    pub fn version(&self) -> String {
        self.snapshot
            .read()
            .map(|s| s.version.as_str())
            .unwrap_or_default()
    }

    pub fn len(&self) -> usize {
        self.snapshot.read().map(|s| s.compiled.len()).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn ids(&self) -> Vec<String> {
        self.snapshot
            .read()
            .map(|s| s.compiled.iter().map(|c| c.meta.id.clone()).collect())
            .unwrap_or_default()
    }

    /// Return every hit for the requested scope, in byte offsets. Counters are bumped
    /// once per hit so noise signatures stay cheap (dial 2).
    pub fn scan(&self, text: &str, scope: SignatureScope) -> Vec<SignatureHit> {
        let guard = match self.snapshot.read() {
            Ok(g) => g,
            Err(_) => return Vec::new(),
        };
        let Some((set, indices)) = guard.sets.get(&scope) else {
            return Vec::new();
        };
        let matched = set.matches(text);
        let mut hits = Vec::new();
        let mut bumps: Vec<String> = Vec::new();
        for idx in matched.into_iter() {
            let c = &guard.compiled[indices[idx]];
            for m in c.re.find_iter(text) {
                bumps.push(c.meta.id.clone());
                hits.push(SignatureHit {
                    sig_id: c.meta.id.clone(),
                    kind: c.meta.kind,
                    severity: c.meta.severity,
                    declared_audit: c.meta.audit,
                    matched: m.as_str().to_string(),
                    start: m.start(),
                    end: m.end(),
                });
            }
        }
        drop(guard);
        if !bumps.is_empty() {
            if let Ok(mut counters) = self.counters.lock() {
                for id in bumps {
                    *counters.entry(id).or_insert(0) += 1;
                }
            }
        }
        hits.sort_by_key(|h| (h.start, h.sig_id.clone()));
        hits
    }

    pub fn counter(&self, sig_id: &str) -> u64 {
        self.counters
            .lock()
            .ok()
            .and_then(|c| c.get(sig_id).copied())
            .unwrap_or(0)
    }

    pub fn counters(&self) -> BTreeMap<String, u64> {
        self.counters.lock().map(|c| c.clone()).unwrap_or_default()
    }

    pub fn reset_counters(&self) {
        if let Ok(mut c) = self.counters.lock() {
            c.clear();
        }
    }
}

fn scope_label(scope: SignatureScope) -> &'static str {
    match scope {
        SignatureScope::Context => "context-set",
        SignatureScope::Command => "command-set",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const V1: &str = r#"{"version":"0.1.0","signatures":[{"id":"JB-001","kind":"jailbreak","scope":"context","pattern":"ignore previous instructions","severity":9,"audit":"full_capture"}]}"#;
    const V2: &str = r#"{"version":"0.2.0","signatures":[{"id":"JB-001","kind":"jailbreak","scope":"context","pattern":"ignore previous instructions","severity":9,"audit":"full_capture"},{"id":"PS-001","kind":"pseudo_system","scope":"context","pattern":"<\\|im_start\\|>","severity":9,"audit":"full_capture"}]}"#;

    #[test]
    fn hot_update_is_atomic_and_version_gated() {
        let db = SignatureDb::from_json(V1).unwrap();
        assert_eq!(db.version(), "0.1.0");
        assert_eq!(db.len(), 1);
        let hits = db.scan(
            "Please ignore previous instructions now",
            SignatureScope::Context,
        );
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].sig_id, "JB-001");
        assert_eq!(db.counter("JB-001"), 1);

        let report = db.hot_update(V2).unwrap();
        assert_eq!(report.to, "0.2.0");
        assert_eq!(report.added, vec!["PS-001".to_string()]);
        assert_eq!(db.len(), 2);

        // A stale/equal version must not clobber the live snapshot.
        assert!(matches!(
            db.hot_update(V1),
            Err(SigdbError::StaleVersion(..))
        ));
        assert_eq!(db.len(), 2);
    }

    #[test]
    fn command_scope_signatures_do_not_pollute_context_scans() {
        let json = r#"{"version":"0.1.0","signatures":[{"id":"DEL-001","kind":"deletion_verb","scope":"command","pattern":"\\brm\\s+-rf","severity":7,"audit":"counter_only"}]}"#;
        let db = SignatureDb::from_json(json).unwrap();
        assert!(db.scan("rm -rf ./x", SignatureScope::Context).is_empty());
        assert_eq!(db.scan("rm -rf ./x", SignatureScope::Command).len(), 1);
    }
}
