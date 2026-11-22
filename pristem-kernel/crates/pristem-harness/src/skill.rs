//! Skill loader — the three-piece set from §12 (unchanged): full-load with name +
//! description, remove-skill, and a load log.

use std::collections::BTreeMap;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub body: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillDescriptor {
    pub name: String,
    pub description: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum LoadLogEntry {
    FullLoad {
        name: String,
        at: u64,
    },
    Remove {
        name: String,
        at: u64,
    },
    Rejected {
        name: String,
        reason: String,
        at: u64,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum SkillError {
    #[error("skill name is empty")]
    EmptyName,
    #[error("skill `{0}` has no description — full-load requires name + description")]
    MissingDescription(String),
}

#[derive(Default)]
pub struct SkillLoader {
    loaded: RwLock<BTreeMap<String, Skill>>,
    log: RwLock<Vec<LoadLogEntry>>,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl SkillLoader {
    /// Piece 1: full-load. Both name and description are mandatory.
    pub fn full_load(&self, skill: Skill) -> Result<(), SkillError> {
        if skill.name.trim().is_empty() {
            return Err(SkillError::EmptyName);
        }
        if skill.description.trim().is_empty() {
            return Err(SkillError::MissingDescription(skill.name));
        }
        if let Ok(mut log) = self.log.write() {
            log.push(LoadLogEntry::FullLoad {
                name: skill.name.clone(),
                at: now(),
            });
        }
        if let Ok(mut loaded) = self.loaded.write() {
            loaded.insert(skill.name.clone(), skill);
        }
        Ok(())
    }

    /// Piece 2: remove-skill.
    pub fn remove_skill(&self, name: &str) -> bool {
        let removed = self
            .loaded
            .write()
            .map(|mut m| m.remove(name).is_some())
            .unwrap_or(false);
        if removed {
            if let Ok(mut log) = self.log.write() {
                log.push(LoadLogEntry::Remove {
                    name: name.into(),
                    at: now(),
                });
            }
        }
        removed
    }

    /// Piece 3: the load log.
    pub fn load_log(&self) -> Vec<LoadLogEntry> {
        self.log.read().map(|l| l.clone()).unwrap_or_default()
    }

    pub fn descriptors(&self) -> Vec<SkillDescriptor> {
        self.loaded
            .read()
            .map(|m| {
                m.values()
                    .map(|s| SkillDescriptor {
                        name: s.name.clone(),
                        description: s.description.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn body(&self, name: &str) -> Option<String> {
        self.loaded.read().ok()?.get(name).map(|s| s.body.clone())
    }

    pub fn len(&self) -> usize {
        self.loaded.read().map(|m| m.len()).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn three_piece_set_full_load_remove_log() {
        let loader = SkillLoader::default();
        loader
            .full_load(Skill {
                name: "deepsleep".into(),
                description: "clean-instance digestion".into(),
                body: "rules".into(),
            })
            .unwrap();
        assert_eq!(loader.len(), 1);
        assert_eq!(loader.body("deepsleep").as_deref(), Some("rules"));
        assert_eq!(loader.descriptors()[0].name, "deepsleep");
        assert!(loader.remove_skill("deepsleep"));
        assert!(!loader.remove_skill("deepsleep"));
        let log = loader.load_log();
        assert!(matches!(log[0], LoadLogEntry::FullLoad { .. }));
        assert!(matches!(log[1], LoadLogEntry::Remove { .. }));
        assert_eq!(log.len(), 2);
    }

    #[test]
    fn description_is_mandatory() {
        let loader = SkillLoader::default();
        let err = loader
            .full_load(Skill {
                name: "x".into(),
                description: "  ".into(),
                body: String::new(),
            })
            .unwrap_err();
        assert!(matches!(err, SkillError::MissingDescription(_)));
        assert_eq!(loader.len(), 0);
    }
}
