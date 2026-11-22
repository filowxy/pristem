//! Call validation — five gates per tool call (§5 / §6).
//!
//! G1 tool exists (else `unknown-tool`, nothing ran);
//! G2 argument shape (else `unknown-args`);
//! G3 workspace boundary + hidden-path denial (`.env`, `.git` → `denied`, no shape gets in);
//! G4 deletion-verb scan on **every** command: hit reroutes through `delete` (trash), no
//!    exceptions (N4);
//! G5 test-set write protection (N4 — the test-set is not writable by the agent).
//!
//! This function is pure: no tool has run when it returns.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::model::{SignatureScope, ToolCall};
use crate::signature::SignatureDb;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Gate {
    G1ToolExists,
    G2ArgumentShape,
    G3WorkspaceBoundary,
    G4DeletionVerb,
    G5TestSetWrite,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CallDecision {
    Allow,
    /// N4: the deletion never executes as written; it is rewritten to the trash tool.
    Reroute {
        tool: String,
        sig_id: String,
    },
    Reject {
        gate: Gate,
        code: &'static str,
        message: String,
    },
}

impl CallDecision {
    pub fn is_allow(&self) -> bool {
        matches!(self, Self::Allow | Self::Reroute { .. })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GateVerdict {
    pub call: ToolCall,
    pub decision: CallDecision,
    /// The tool the executor must actually invoke (differs from `call.tool` on reroute).
    pub effective_tool: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolSpec {
    pub name: String,
    pub required: Vec<String>,
    pub optional: Vec<String>,
    pub writes: bool,
}

impl ToolSpec {
    pub fn read_only(name: &str, required: &[&str]) -> Self {
        Self {
            name: name.into(),
            required: required.iter().map(|s| (*s).to_string()).collect(),
            optional: Vec::new(),
            writes: false,
        }
    }
    pub fn writing(name: &str, required: &[&str]) -> Self {
        Self {
            name: name.into(),
            required: required.iter().map(|s| (*s).to_string()).collect(),
            optional: Vec::new(),
            writes: true,
        }
    }
    pub fn optional(mut self, keys: &[&str]) -> Self {
        self.optional = keys.iter().map(|s| (*s).to_string()).collect();
        self
    }
}

/// The canonical tool table. Mode routers restrict this by name, never by inventing new
/// shapes — a mode swap changes *which* tools exist, not what a tool means.
pub fn canonical_tools() -> BTreeMap<String, ToolSpec> {
    let specs = vec![
        ToolSpec::read_only("read", &["path"]),
        ToolSpec::read_only("search", &["query"]),
        ToolSpec::writing("write", &["path", "content"]),
        ToolSpec::writing("edit", &["path", "content"]),
        ToolSpec::writing("delete", &["path"]),
        ToolSpec::writing("exec", &["command"]),
        ToolSpec::writing("reminder", &["text"]),
        ToolSpec::writing("skill-load", &["name"]),
        ToolSpec::writing("improve", &["note"]),
        ToolSpec::writing("solo", &["text"]),
        ToolSpec::read_only("pause", &[]),
    ];
    specs.into_iter().map(|s| (s.name.clone(), s)).collect()
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TestSetPolicy {
    pub protected_prefixes: Vec<String>,
    pub protected_suffixes: Vec<String>,
    pub protected_exact: Vec<String>,
}

impl Default for TestSetPolicy {
    fn default() -> Self {
        Self {
            protected_prefixes: vec![
                "tests/".into(),
                "test/".into(),
                "sigdb/".into(),
                "bench/fixtures/".into(),
                ".pristem/".into(),
            ],
            protected_suffixes: vec![".test.rs".into(), "_test.rs".into(), ".golden".into()],
            protected_exact: vec!["Cargo.lock".into()],
        }
    }
}

impl TestSetPolicy {
    pub fn is_protected(&self, raw: &str) -> bool {
        let p = raw.trim_start_matches("./").replace('\\', "/");
        if self.protected_exact.contains(&p) {
            return true;
        }
        if self.protected_prefixes.iter().any(|x| p.starts_with(x)) {
            return true;
        }
        self.protected_suffixes.iter().any(|x| p.ends_with(x))
    }
}

/// Built-in fallback so G4 can never be silently disabled if the sigdb has no command
/// signatures loaded. `with_signature_db` upgrades this to the hot-updatable corpus.
const BUILTIN_DELETION_VERBS: &[&str] = &[
    "rm -r",
    "rm -f",
    "rmdir",
    "unlink",
    "del /s",
    "del /q",
    "remove-item",
    "shutil.rmtree",
    "os.remove",
    "os.unlink",
    "fs.unlinksync",
    "fs.rmsync",
    "git clean -",
];

#[derive(Clone)]
pub struct CallValidator {
    tools: BTreeMap<String, ToolSpec>,
    root: PathBuf,
    test_set: TestSetPolicy,
    db: Option<SignatureDb>,
}

impl CallValidator {
    pub fn new(root: impl Into<PathBuf>, test_set: TestSetPolicy) -> Self {
        Self {
            tools: canonical_tools(),
            root: root.into(),
            test_set,
            db: None,
        }
    }

    pub fn with_signature_db(mut self, db: SignatureDb) -> Self {
        self.db = Some(db);
        self
    }

    pub fn with_tools(mut self, tools: BTreeMap<String, ToolSpec>) -> Self {
        self.tools = tools;
        self
    }

    /// Context firewall (§4) uses this to produce a per-mode validator: a tool not in the
    /// mode's allowlist genuinely does not exist for that round (G1), it is not merely
    /// filtered later.
    pub fn restricted_to(&self, allowed: &BTreeSet<String>) -> Self {
        let tools = self
            .tools
            .iter()
            .filter(|(k, _)| allowed.contains(*k))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        Self {
            tools,
            ..self.clone()
        }
    }

    pub fn tools(&self) -> &BTreeMap<String, ToolSpec> {
        &self.tools
    }
    pub fn test_set(&self) -> &TestSetPolicy {
        &self.test_set
    }
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// G3: lexical boundary check, no filesystem access (a path may not exist yet).
    pub fn check_path(&self, raw: &str) -> Result<PathBuf, String> {
        if raw.trim().is_empty() {
            return Err("denied: empty path".into());
        }
        let p = Path::new(raw);
        if p.is_absolute() || p.has_root() {
            return Err(format!("denied: absolute path escapes workspace: {raw}"));
        }
        let mut depth: i32 = 0;
        for comp in p.components() {
            match comp {
                Component::Normal(s) => {
                    let name = s.to_string_lossy();
                    if name.starts_with('.') {
                        return Err(format!("denied: hidden path component {name}"));
                    }
                    depth += 1;
                }
                Component::ParentDir => {
                    depth -= 1;
                    if depth < 0 {
                        return Err(format!("denied: path escapes workspace: {raw}"));
                    }
                }
                Component::Prefix(_) => return Err(format!("denied: drive prefix in path: {raw}")),
                Component::RootDir => return Err(format!("denied: rooted path: {raw}")),
                Component::CurDir => {}
            }
        }
        Ok(self.root.join(p))
    }

    pub fn is_deletion_command(&self, text: &str) -> Option<String> {
        if let Some(db) = &self.db {
            let hit = db.scan(text, SignatureScope::Command).into_iter().next();
            if let Some(h) = hit {
                return Some(h.sig_id);
            }
        }
        let lower = text.to_ascii_lowercase();
        BUILTIN_DELETION_VERBS
            .iter()
            .find(|v| lower.contains(*v))
            .map(|v| format!("builtin:{v}"))
    }

    pub fn validate(&self, call: &ToolCall) -> GateVerdict {
        let reject = |gate: Gate, code: &'static str, message: String| GateVerdict {
            call: call.clone(),
            decision: CallDecision::Reject {
                gate,
                code,
                message,
            },
            effective_tool: call.tool.clone(),
        };

        // G1 — tool exists. Nothing has run.
        let spec = match self.tools.get(&call.tool) {
            Some(s) => s,
            None => {
                return reject(
                    Gate::G1ToolExists,
                    "unknown-tool",
                    format!("unknown tool `{}`; nothing was executed", call.tool),
                )
            }
        };

        // G2 — argument shape. Unknown keys are rejected too, so a smuggled extra arg
        // cannot ride along with an otherwise valid call.
        let mut known: BTreeSet<&str> = spec.required.iter().map(String::as_str).collect();
        known.extend(spec.optional.iter().map(String::as_str));
        let missing: Vec<&str> = spec
            .required
            .iter()
            .map(String::as_str)
            .filter(|k| !call.args.contains_key(*k))
            .collect();
        let extra: Vec<&str> = call
            .args
            .keys()
            .map(String::as_str)
            .filter(|k| !known.contains(k))
            .collect();
        if !missing.is_empty() || !extra.is_empty() {
            return reject(
                Gate::G2ArgumentShape,
                "unknown-args",
                format!(
                    "argument shape mismatch for `{}`: missing={missing:?} unexpected={extra:?}; nothing was executed",
                    call.tool
                ),
            );
        }

        // G3 — boundary + hidden paths. Runs over args AND raw so no shape gets in.
        let mut checked_paths: Vec<(String, String)> = call.path_args();
        for (k, v) in &call.args {
            let key = k.as_str();
            if matches!(key, "path" | "file" | "target" | "from" | "to")
                && !checked_paths.iter().any(|(kk, _)| kk == k)
            {
                checked_paths.push((k.clone(), v.clone()));
            }
        }
        for (_, raw) in &checked_paths {
            if let Err(e) = self.check_path(raw) {
                return reject(Gate::G3WorkspaceBoundary, "denied", e);
            }
        }
        // Hidden markers can also hide in `raw` or in a command string.
        for fragment in [
            call.raw.as_str(),
            call.args.get("command").map(String::as_str).unwrap_or(""),
        ] {
            let lower = fragment.to_ascii_lowercase();
            for hidden in [".env", ".git/"] {
                if lower.contains(hidden) {
                    return reject(
                        Gate::G3WorkspaceBoundary,
                        "denied",
                        format!("denied: hidden path reference {hidden} in call payload"),
                    );
                }
            }
        }

        // G5 — test-set write protection (checked before the reroute decision so a
        // rerouted delete cannot be used to launder a protected path).
        if spec.writes {
            for (_, raw) in &checked_paths {
                if self.test_set.is_protected(raw) {
                    return reject(
                        Gate::G5TestSetWrite,
                        "denied",
                        format!("denied: `{raw}` belongs to the protected test-set"),
                    );
                }
            }
        }

        // G4 — deletion verbs on every command, no exceptions. Reroutes to trash.
        let sig = self.is_deletion_command(&call.command_text());
        if let Some(sig_id) = sig {
            return GateVerdict {
                call: call.clone(),
                decision: CallDecision::Reroute {
                    tool: "delete".into(),
                    sig_id,
                },
                effective_tool: "delete".into(),
            };
        }

        GateVerdict {
            call: call.clone(),
            decision: CallDecision::Allow,
            effective_tool: call.tool.clone(),
        }
    }

    /// Passive re-validation hook for the executor: files are re-checked on EVERY tool
    /// execution, not via a watcher. Returns the reason on denial.
    pub fn recheck(&self, raw: &str, writing: bool) -> Result<(), String> {
        self.check_path(raw)?;
        if writing && self.test_set.is_protected(raw) {
            return Err(format!("denied: `{raw}` belongs to the protected test-set"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v() -> CallValidator {
        CallValidator::new("D:/ws", TestSetPolicy::default())
    }

    #[test]
    fn g1_unknown_tool_never_runs() {
        let out = v().validate(&ToolCall::new("launch-nukes").arg("path", "a.txt"));
        assert!(matches!(
            out.decision,
            CallDecision::Reject {
                code: "unknown-tool",
                ..
            }
        ));
    }

    #[test]
    fn g2_shape_mismatch() {
        let out = v().validate(&ToolCall::new("read"));
        assert!(matches!(
            out.decision,
            CallDecision::Reject {
                code: "unknown-args",
                ..
            }
        ));
    }

    #[test]
    fn g3_hidden_and_escaping_paths_are_denied() {
        for p in [
            ".env",
            ".git/config",
            "../outside.txt",
            "C:/Windows/system32",
            "a/../../x",
        ] {
            let out = v().validate(&ToolCall::new("read").arg("path", p));
            assert!(
                matches!(out.decision, CallDecision::Reject { code: "denied", .. }),
                "path={p}"
            );
        }
    }

    #[test]
    fn g4_deletion_verbs_always_reroute_to_trash() {
        for cmd in [
            "rm -rf ./build",
            "Remove-Item -Recurse x",
            "shutil.rmtree('x')",
        ] {
            let out = v().validate(&ToolCall::new("exec").arg("command", cmd));
            assert!(
                matches!(out.decision, CallDecision::Reroute { .. }),
                "cmd={cmd}"
            );
            assert_eq!(out.effective_tool, "delete");
        }
    }

    #[test]
    fn g5_test_set_is_not_writable() {
        let out = v().validate(
            &ToolCall::new("write")
                .arg("path", "tests/expected.txt")
                .arg("content", "x"),
        );
        assert!(matches!(
            out.decision,
            CallDecision::Reject {
                gate: Gate::G5TestSetWrite,
                ..
            }
        ));
        // reading the test-set is fine
        let read = v().validate(&ToolCall::new("read").arg("path", "tests/expected.txt"));
        assert!(matches!(read.decision, CallDecision::Allow));
    }

    #[test]
    fn mode_restriction_makes_tools_genuinely_absent() {
        let allowed: BTreeSet<String> = ["read".into(), "search".into()].into_iter().collect();
        let v = v().restricted_to(&allowed);
        assert_eq!(v.tools().len(), 2);
        assert!(matches!(
            v.validate(
                &ToolCall::new("write")
                    .arg("path", "a.txt")
                    .arg("content", "x")
            )
            .decision,
            CallDecision::Reject {
                code: "unknown-tool",
                ..
            }
        ));
    }
}
