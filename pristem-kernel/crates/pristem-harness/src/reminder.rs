//! REMINDER store (§7): the answer gate's data source, **cross-session visible**.
//!
//! Global reminders are seen by every session; per-session reminders are private. The
//! gate consumes the combined `required_lines` through `ReminderSource`, so this crate
//! implements the trait defined in `pristem-defense` (dependency inversion).

use std::collections::BTreeMap;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

use pristem_defense::{ReminderSource, SessionId};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reminder {
    pub id: String,
    pub lines: Vec<String>,
    pub source: String,
    pub created_at: u64,
}

impl Reminder {
    pub fn new(id: impl Into<String>, lines: &[&str], source: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            lines: lines.iter().map(|s| (*s).to_string()).collect(),
            source: source.into(),
            created_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
        }
    }
}

#[derive(Default)]
pub struct ReminderStore {
    global: RwLock<Vec<Reminder>>,
    per_session: RwLock<BTreeMap<SessionId, Vec<Reminder>>>,
}

impl ReminderStore {
    pub fn set_global(&self, reminder: Reminder) {
        if let Ok(mut g) = self.global.write() {
            g.retain(|r| r.id != reminder.id);
            g.push(reminder);
        }
    }

    pub fn append(&self, session: SessionId, reminder: Reminder) {
        if let Ok(mut m) = self.per_session.write() {
            let entry = m.entry(session).or_default();
            entry.retain(|r| r.id != reminder.id);
            entry.push(reminder);
        }
    }

    pub fn clear(&self, session: SessionId) {
        if let Ok(mut m) = self.per_session.write() {
            m.remove(&session);
        }
    }

    pub fn clear_all(&self) {
        if let Ok(mut g) = self.global.write() {
            g.clear();
        }
        if let Ok(mut m) = self.per_session.write() {
            m.clear();
        }
    }

    pub fn required_lines(&self, session: SessionId) -> Vec<String> {
        let mut out = Vec::new();
        if let Ok(g) = self.global.read() {
            for r in g.iter() {
                for l in &r.lines {
                    if !l.trim().is_empty() && !out.contains(l) {
                        out.push(l.clone());
                    }
                }
            }
        }
        if let Ok(m) = self.per_session.read() {
            if let Some(rs) = m.get(&session) {
                for r in rs {
                    for l in &r.lines {
                        if !l.trim().is_empty() && !out.contains(l) {
                            out.push(l.clone());
                        }
                    }
                }
            }
        }
        out
    }

    /// Cross-session visibility for the IPC REMINDER presentation surface.
    pub fn all_visible(&self) -> Vec<Reminder> {
        let mut out = self.global.read().map(|g| g.clone()).unwrap_or_default();
        if let Ok(m) = self.per_session.read() {
            for rs in m.values() {
                out.extend(rs.iter().cloned());
            }
        }
        out
    }

    pub fn count(&self) -> usize {
        let g = self.global.read().map(|g| g.len()).unwrap_or(0);
        let p = self
            .per_session
            .read()
            .map(|m| m.values().map(Vec::len).sum::<usize>())
            .unwrap_or(0);
        g + p
    }
}

impl ReminderSource for ReminderStore {
    fn required_lines(&self, session: SessionId) -> Vec<String> {
        ReminderStore::required_lines(self, session)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn global_reminders_are_visible_to_every_session() {
        let store = ReminderStore::default();
        store.set_global(Reminder::new(
            "g1",
            &["REMINDER: preserve v0.3.0"],
            "system",
        ));
        store.append(
            SessionId(1),
            Reminder::new("s1", &["REMINDER: check gate"], "round-2"),
        );
        let a = store.required_lines(SessionId(1));
        let b = store.required_lines(SessionId(2));
        assert_eq!(a.len(), 2);
        assert_eq!(b, vec!["REMINDER: preserve v0.3.0".to_string()]);
        assert_eq!(store.all_visible().len(), 2);
    }

    #[test]
    fn clearing_one_session_does_not_touch_global_or_others() {
        let store = ReminderStore::default();
        store.set_global(Reminder::new("g", &["G"], "system"));
        store.append(SessionId(1), Reminder::new("a", &["A"], "x"));
        store.append(SessionId(2), Reminder::new("b", &["B"], "x"));
        store.clear(SessionId(1));
        assert_eq!(store.required_lines(SessionId(1)), vec!["G".to_string()]);
        assert_eq!(store.required_lines(SessionId(2)).len(), 2);
    }
}
