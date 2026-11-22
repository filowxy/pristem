//! Shell IO adapter. NOTE: `pristem.ipc/v0.3` (O2) has no fs/terminal requests —
//! session/round/mode only. These ops are therefore a clearly namespaced `io:*`
//! channel owned by the shell, NOT kernel semantics. Flagged in BUILD_NOTES.md.
//! The WebView itself never touches the filesystem.

use std::{
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    time::Duration,
};

use serde_json::{json, Value};

use crate::{models, term::{self, ShellProfile}, AppState, WindowOp};

// Hide build/VCS payloads and the internal trash. Other dotfiles and
// dot-directories stay user-visible (`.screenshots`, `.workbuddy`, ...).
fn skip(name: &str) -> bool {
    matches!(name, "target" | "node_modules" | ".git" | "dist" | ".pristem")
}

fn rel(root: &Path, p: &Path) -> String {
    p.strip_prefix(root)
        .unwrap_or(p)
        .to_string_lossy()
        .replace('\\', "/")
}

// ---------------------------------------------------------------------------
// Clipboard. The WebView can be denied navigator.clipboard inside WebView2,
// so copy/paste in the terminal goes through the shell instead.
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn clipboard_read() -> Option<String> {
    use windows_sys::Win32::System::{
        DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard},
        Memory::{GlobalLock, GlobalUnlock},
    };
    const CF_UNICODETEXT: u32 = 13;
    unsafe {
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return None;
        }
        let handle = GetClipboardData(CF_UNICODETEXT);
        let text = if handle.is_null() {
            String::new()
        } else {
            let ptr = GlobalLock(handle) as *const u16;
            let mut out = String::new();
            if !ptr.is_null() {
                let mut len = 0usize;
                while *ptr.add(len) != 0 { len += 1; }
                out = String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len));
                GlobalUnlock(handle);
            }
            out
        };
        CloseClipboard();
        Some(text)
    }
}

#[cfg(windows)]
fn clipboard_write(text: &str) -> bool {
    use windows_sys::Win32::System::{
        DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData},
        Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
    };
    const CF_UNICODETEXT: u32 = 13;
    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let hmem = GlobalAlloc(GMEM_MOVEABLE, wide.len() * 2);
        if hmem.is_null() {
            return false;
        }
        let dst = GlobalLock(hmem) as *mut u16;
        if dst.is_null() {
            return false;
        }
        std::ptr::copy_nonoverlapping(wide.as_ptr(), dst, wide.len());
        GlobalUnlock(hmem);
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return false;
        }
        EmptyClipboard();
        let ok = !SetClipboardData(CF_UNICODETEXT, hmem).is_null();
        CloseClipboard();
        ok
    }
}

#[cfg(not(windows))]
fn clipboard_read() -> Option<String> { None }
#[cfg(not(windows))]
fn clipboard_write(_text: &str) -> bool { false }

/// Direct children of `dir`, paths relative to the workspace root.
/// No flattening: the tree renders one level per expansion and `fs.list?path`
/// serves each nested level.
fn list_dir(root: &Path, dir: &Path) -> Vec<Value> {
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(dir) else { return out };
    let mut dirs: Vec<(String, String)> = Vec::new();
    let mut files: Vec<(String, String)> = Vec::new();

    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if skip(&name) { continue; }
        let p = e.path();
        let r = rel(root, &p);
        if p.is_dir() { dirs.push((name, r)); } else { files.push((name, r)); }
    }
    dirs.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    files.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));

    for (name, r) in dirs {
        out.push(json!({ "name": name, "path": r, "dir": true }));
    }
    for (name, r) in files {
        out.push(json!({ "name": name, "path": r, "dir": false }));
    }
    out
}

/// The workspace the real window last had open. Headless runs never read or
/// write it, so the suites keep the repository root they were started with.
fn workspace_path() -> PathBuf {
    models::app_dir().join("workspace.txt")
}

fn read_workspace(path: &Path) -> Option<PathBuf> {
    let text = fs::read_to_string(path).ok()?;
    let dir = PathBuf::from(text.trim());
    dir.is_dir().then_some(dir)
}

fn write_workspace(path: &Path, root: &Path) {
    if let Some(dir) = path.parent() { let _ = fs::create_dir_all(dir); }
    let _ = fs::write(path, root.to_string_lossy().as_bytes());
}

pub fn last_workspace() -> Option<PathBuf> {
    read_workspace(&workspace_path())
}

fn remember_workspace(st: &AppState, root: &Path) {
    if !st.headless { write_workspace(&workspace_path(), root); }
}

/// A terminal needs a real directory. With no workspace the profile is the
/// honest start — the app's own folder is not the user's project.
fn shell_cwd(root: &Path) -> PathBuf {
    if !root.as_os_str().is_empty() { return root.to_path_buf(); }
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
}

fn resolve(root: &Path, p: &str) -> Option<PathBuf> {
    // No workspace means no relative paths: `root.join(p)` would otherwise land
    // in the process cwd (the app's own folder) and look like a real save.
    if root.as_os_str().is_empty() {
        return None;
    }
    let raw = Path::new(p);
    if raw.components().any(|c| matches!(c, Component::ParentDir)) {
        return None;
    }
    let candidate = if raw.is_absolute() { raw.to_path_buf() } else { root.join(raw) };
    if !candidate.starts_with(root) { return None; }
    Some(candidate)
}

/// Scaffold `<parent>/pristem-project` (uniquified) with a README and return its
/// path. The parent is a folder the user picked in the native dialog, so it is
/// outside `resolve`'s workspace boundary by design.
fn fs_new_project(req: &Value) -> Value {
    let parent = req.get("parent").and_then(|v| v.as_str()).unwrap_or("");
    if parent.is_empty() {
        return json!({ "ok": false, "error": "no parent folder" });
    }
    let parent = PathBuf::from(parent);
    if !parent.is_dir() {
        return json!({ "ok": false, "error": "parent is not a directory" });
    }
    let mut dir = parent.join("pristem-project");
    let mut n = 2;
    while dir.exists() && n < 100 {
        dir = parent.join(format!("pristem-project-{n}"));
        n += 1;
    }
    match fs::create_dir_all(&dir) {
        Ok(()) => {
            let _ = fs::write(dir.join("README.md"), "# pristem-project\n");
            json!({ "ok": true, "path": dir.to_string_lossy().replace('\\', "/") })
        }
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

/// Build the process for `proc.exec`. An argument array runs the program directly,
/// with no shell: the git panel passes paths and commit messages there, and those
/// must never reach `cmd.exe` parsing (quoting a message loses characters, and an
/// unquoted `&` runs a second command).
fn proc_command(command: &str, args: &[String]) -> Command {
    if !args.is_empty() {
        let mut c = Command::new(command);
        c.args(args);
        return c;
    }
    if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.args(["/C", command]);
        c
    } else {
        let mut c = Command::new("sh");
        c.args(["-c", command]);
        c
    }
}

/// One-shot command for tooling (git panel). Unlike the PTY terminals this is a
/// plain request/response: stdout+stderr merged, bounded time and output. The
/// command comes from the local UI — same trust boundary as `term.run`.
fn proc_exec(command: &str, args: &[String], root: &Path, timeout_ms: u64) -> Value {
    let mut cmd = proc_command(command, args);
    cmd.current_dir(root).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return json!({ "ok": false, "error": format!("spawn failed: {e}") }),
    };
    const CAP: u64 = 256 * 1024;
    let buf = Arc::new(Mutex::new(String::new()));
    let mut readers = Vec::new();
    let pipes: Vec<Box<dyn Read + Send>> = {
        let mut v: Vec<Box<dyn Read + Send>> = Vec::new();
        if let Some(o) = child.stdout.take() { v.push(Box::new(o)); }
        if let Some(e) = child.stderr.take() { v.push(Box::new(e)); }
        v
    };
    for pipe in pipes {
        let buf = buf.clone();
        readers.push(std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = pipe.take(CAP).read_to_end(&mut bytes);
            if let Ok(mut b) = buf.lock() {
                let room = (CAP as usize).saturating_sub(b.len());
                b.push_str(&String::from_utf8_lossy(&bytes[..bytes.len().min(room)]));
            }
        }));
    }
    let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms.clamp(100, 30_000));
    let mut timed_out = false;
    let code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code().unwrap_or(-1),
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    timed_out = true;
                    break -1;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(_) => break -1,
        }
    };
    // On timeout a grandchild may still hold the pipes; don't block on join.
    if !timed_out {
        for r in readers { let _ = r.join(); }
    }
    let stdout = buf.lock().map(|b| b.clone()).unwrap_or_default();
    if timed_out {
        json!({ "ok": false, "error": "timeout", "stdout": stdout, "code": code })
    } else {
        json!({ "ok": true, "stdout": stdout, "code": code })
    }
}

/// The workspace root and the internal trash are never created/renamed/deleted.
fn protected(root: &Path, full: &Path) -> bool {
    full == root || full.starts_with(root.join(".pristem"))
}

fn fs_mkdir(root: &Path, p: &str) -> Value {
    let Some(full) = resolve(root, p) else {
        return json!({ "ok": false, "error": "outside workspace" });
    };
    if protected(root, &full) { return json!({ "ok": false, "error": "protected path" }); }
    if full.exists() { return json!({ "ok": false, "error": "exists" }); }
    match fs::create_dir(&full) {
        Ok(()) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "error": format!("{e}") }),
    }
}

fn fs_rename(root: &Path, from: &str, to: &str) -> Value {
    let Some(src) = resolve(root, from) else {
        return json!({ "ok": false, "error": "outside workspace" });
    };
    let Some(dst) = resolve(root, to) else {
        return json!({ "ok": false, "error": "outside workspace" });
    };
    if protected(root, &src) || protected(root, &dst) {
        return json!({ "ok": false, "error": "protected path" });
    }
    if !src.exists() { return json!({ "ok": false, "error": "missing source" }); }
    if dst.exists() { return json!({ "ok": false, "error": "exists" }); }
    if let Some(parent) = dst.parent() { let _ = fs::create_dir_all(parent); }
    match fs::rename(&src, &dst) {
        Ok(()) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "error": format!("{e}") }),
    }
}

fn copy_tree(src: &Path, dst: &Path) -> std::io::Result<()> {
    if src.is_dir() {
        fs::create_dir_all(dst)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            copy_tree(&entry.path(), &dst.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        if let Some(parent) = dst.parent() { fs::create_dir_all(parent)?; }
        fs::copy(src, dst).map(|_| ())
    }
}

fn fs_copy(root: &Path, from: &str, to: &str) -> Value {
    let Some(src) = resolve(root, from) else {
        return json!({ "ok": false, "error": "outside workspace" });
    };
    let Some(dst) = resolve(root, to) else {
        return json!({ "ok": false, "error": "outside workspace" });
    };
    if protected(root, &src) || protected(root, &dst) {
        return json!({ "ok": false, "error": "protected path" });
    }
    if !src.exists() { return json!({ "ok": false, "error": "missing source" }); }
    if dst.exists() { return json!({ "ok": false, "error": "exists" }); }
    if dst.starts_with(&src) { return json!({ "ok": false, "error": "into itself" }); }
    match copy_tree(&src, &dst) {
        Ok(()) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "error": format!("{e}") }),
    }
}

/// Hand-rolled glob: `*` matches within a path segment, `**` crosses segments,
/// `?` matches one non-`/` character. Literals compare case-insensitively
/// (Windows-friendly). Paths use `/` separators (see `rel`).
fn glob_match(pat: &str, path: &str) -> bool {
    fn m(p: &[u8], s: &[u8]) -> bool {
        if p.is_empty() { return s.is_empty(); }
        match p[0] {
            b'*' => {
                if p.len() >= 2 && p[1] == b'*' {
                    let rest = if p.len() >= 3 && p[2] == b'/' { &p[3..] } else { &p[2..] };
                    (0..=s.len()).any(|i| m(rest, &s[i..]))
                } else {
                    let rest = &p[1..];
                    for i in 0..=s.len() {
                        if m(rest, &s[i..]) { return true; }
                        if i < s.len() && s[i] == b'/' { break; }
                    }
                    false
                }
            }
            b'?' => !s.is_empty() && s[0] != b'/' && m(&p[1..], &s[1..]),
            c => {
                !s.is_empty()
                    && (s[0] == c || (c as char).eq_ignore_ascii_case(&(s[0] as char)))
                    && m(&p[1..], &s[1..])
            }
        }
    }
    m(pat.as_bytes(), path.as_bytes())
}

/// Depth-first file walk. Skips build/VCS/trash dirs, never follows symlinks,
/// bounded by `file_limit`. `visit` returns false to stop early. Returns
/// (files scanned, truncated-by-limit).
fn walk_files(root: &Path, file_limit: usize, mut visit: impl FnMut(&Path, &str) -> bool) -> (usize, bool) {
    let mut stack = vec![root.to_path_buf()];
    let mut scanned = 0;
    let mut truncated = false;
    while let Some(dir) = stack.pop() {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        let mut entries: Vec<_> = rd.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let name = e.file_name().to_string_lossy().to_string();
            if skip(&name) { continue; }
            let p = e.path();
            let Ok(meta) = fs::symlink_metadata(&p) else { continue };
            if meta.file_type().is_symlink() { continue; }
            if meta.is_dir() { stack.push(p); continue; }
            if !meta.is_file() { continue; }
            if scanned >= file_limit { truncated = true; break; }
            scanned += 1;
            let r = rel(root, &p);
            if !visit(&p, &r) { return (scanned, truncated); }
        }
        if truncated { break; }
    }
    (scanned, truncated)
}

const BIN_EXT: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "pdf", "zip", "gz", "tar",
    "exe", "dll", "so", "dylib", "bin", "woff", "woff2", "ttf", "eot", "mp3",
    "mp4", "wav", "avi", "mov", "class", "jar", "pyc", "o", "a", "lib",
];

fn is_binary(path: &Path, bytes: &[u8]) -> bool {
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        if BIN_EXT.contains(&ext.to_lowercase().as_str()) { return true; }
    }
    bytes.iter().take(4096).any(|&b| b == 0)
}

fn build_regex(query: &str, case_sensitive: bool, whole_word: bool, regex_mode: bool) -> Result<regex::Regex, String> {
    let mut pat = if regex_mode { query.to_string() } else { regex::escape(query) };
    if whole_word { pat = format!(r"\b(?:{pat})\b"); }
    if !case_sensitive { pat = format!("(?i){pat}"); }
    regex::Regex::new(&pat).map_err(|_| "invalid regex".to_string())
}

fn globs(s: &str) -> Vec<&str> {
    s.split(',').map(|g| g.trim()).filter(|g| !g.is_empty()).collect()
}

/// Optional exact-path scope (search in open editors). Relative `/` paths.
fn path_scope(req: &Value) -> Option<Vec<String>> {
    req.get("paths")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str()).map(str::to_string).collect())
}

fn fs_search(root: &Path, req: &Value) -> Value {
    let query = req.get("query").and_then(|v| v.as_str()).unwrap_or("");
    if query.is_empty() {
        return json!({ "ok": true, "hits": [], "truncated": false, "scanned": 0, "files": 0 });
    }
    let case_sensitive = req.get("caseSensitive").and_then(|v| v.as_bool()).unwrap_or(false);
    let whole_word = req.get("wholeWord").and_then(|v| v.as_bool()).unwrap_or(false);
    let regex_mode = req.get("regex").and_then(|v| v.as_bool()).unwrap_or(false);
    let include = req.get("include").and_then(|v| v.as_str()).unwrap_or("");
    let exclude = req.get("exclude").and_then(|v| v.as_str()).unwrap_or("");
    let hit_limit = req.get("limit").and_then(|v| v.as_u64()).unwrap_or(500) as usize;
    let re = match build_regex(query, case_sensitive, whole_word, regex_mode) {
        Ok(r) => r,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    let inc = globs(include);
    let exc = globs(exclude);
    let scoped = path_scope(req);
    let mut hits: Vec<Value> = Vec::new();
    let mut files_with_hits = 0;
    let mut hit_truncated = false;
    let (scanned, walk_trunc) = walk_files(root, 4000, |full, relp| {
        if let Some(paths) = &scoped {
            if !paths.iter().any(|p| p == relp) { return true; }
        }
        if !inc.is_empty() && !inc.iter().any(|g| glob_match(g, relp)) { return true; }
        if exc.iter().any(|g| glob_match(g, relp)) { return true; }
        let Ok(bytes) = fs::read(full) else { return true };
        if bytes.len() > 512 * 1024 || is_binary(full, &bytes) { return true; }
        let text = String::from_utf8_lossy(&bytes);
        let mut file_hit = false;
        for (idx, line) in text.lines().enumerate() {
            for mat in re.find_iter(line) {
                file_hit = true;
                let column = line[..mat.start()].chars().count() + 1;
                let snippet: String = line.trim().chars().take(200).collect();
                hits.push(json!({ "path": relp, "line": idx + 1, "column": column, "snippet": snippet }));
                if hits.len() >= hit_limit { hit_truncated = true; break; }
            }
            if hit_truncated { break; }
        }
        if file_hit { files_with_hits += 1; }
        !hit_truncated
    });
    json!({ "ok": true, "hits": hits, "truncated": hit_truncated || walk_trunc, "scanned": scanned, "files": files_with_hits })
}

fn fs_replace(root: &Path, req: &Value) -> Value {
    let query = req.get("query").and_then(|v| v.as_str()).unwrap_or("");
    if query.is_empty() {
        return json!({ "ok": true, "files": 0, "replacements": 0, "truncated": false });
    }
    let replacement = req.get("replacement").and_then(|v| v.as_str()).unwrap_or("");
    let case_sensitive = req.get("caseSensitive").and_then(|v| v.as_bool()).unwrap_or(false);
    let whole_word = req.get("wholeWord").and_then(|v| v.as_bool()).unwrap_or(false);
    let regex_mode = req.get("regex").and_then(|v| v.as_bool()).unwrap_or(false);
    let include = req.get("include").and_then(|v| v.as_str()).unwrap_or("");
    let exclude = req.get("exclude").and_then(|v| v.as_str()).unwrap_or("");
    let re = match build_regex(query, case_sensitive, whole_word, regex_mode) {
        Ok(r) => r,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    let inc = globs(include);
    let exc = globs(exclude);
    let scoped = path_scope(req);
    let mut files_changed = 0;
    let mut total = 0;
    let (_scanned, walk_trunc) = walk_files(root, 4000, |full, relp| {
        if let Some(paths) = &scoped {
            if !paths.iter().any(|p| p == relp) { return true; }
        }
        if !inc.is_empty() && !inc.iter().any(|g| glob_match(g, relp)) { return true; }
        if exc.iter().any(|g| glob_match(g, relp)) { return true; }
        let Ok(bytes) = fs::read(full) else { return true };
        if bytes.len() > 512 * 1024 || is_binary(full, &bytes) { return true; }
        let text = String::from_utf8_lossy(&bytes);
        let count = re.find_iter(&text).count();
        if count == 0 { return true; }
        // Literal mode must not interpret `$1`/`$&` in the replacement.
        let new = if regex_mode {
            re.replace_all(&text, replacement)
        } else {
            re.replace_all(&text, regex::NoExpand(replacement))
        };
        if fs::write(full, new.as_bytes()).is_ok() {
            files_changed += 1;
            total += count;
        }
        true
    });
    json!({ "ok": true, "files": files_changed, "replacements": total, "truncated": walk_trunc })
}

fn fs_files(root: &Path, limit: usize) -> Value {
    let mut paths: Vec<String> = Vec::new();
    let (_scanned, trunc) = walk_files(root, limit, |_full, relp| { paths.push(relp.to_string()); true });
    json!({ "ok": true, "files": paths, "truncated": trunc })
}

/// Cheap fingerprint of the workspace tree (path + size + mtime). External
/// edits change it; a no-op scan does not.
fn tree_signature(root: &Path) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut rows: Vec<(String, u64, u128)> = Vec::new();
    let (_scanned, _trunc) = walk_files(root, 4000, |full, relp| {
        if let Ok(md) = fs::metadata(full) {
            let mtime = md
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            rows.push((relp.to_string(), md.len(), mtime));
        }
        true
    });
    rows.sort_by(|a, b| a.0.cmp(&b.0));
    let mut h = std::collections::hash_map::DefaultHasher::new();
    root.to_string_lossy().hash(&mut h);
    rows.hash(&mut h);
    h.finish()
}

/// Poll-based external-change watcher. The PTY/IO channel already owns every
/// write the shell makes; this covers edits from other tools and git.
/// ponytail: 1.5 s poll over at most 4000 files — upgrade to
/// ReadDirectoryChangesW if a very large workspace makes the scan visible.
pub fn spawn_watcher(st: Arc<AppState>) {
    std::thread::spawn(move || {
        let mut last: Option<u64> = None;
        loop {
            std::thread::sleep(Duration::from_millis(1500));
            let root = st.root.lock().map(|r| r.clone()).unwrap_or_default();
            let signature = tree_signature(&root);
            if last.map(|prev| prev != signature).unwrap_or(false) {
                st.bus.emit("io", json!({ "type": "fs.changed", "path": "" }));
            }
            last = Some(signature);
        }
    });
}

pub fn handle(req: Value, st: &std::sync::Arc<AppState>) -> Value {
    let op = req.get("op").and_then(|v| v.as_str()).unwrap_or("");
    match op {
        "fs.list" => {
            let root = st.root.lock().map(|r| r.clone()).unwrap_or_default();
            let p = req.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let dir = if p.is_empty() {
                root.clone()
            } else {
                resolve(&root, p).filter(|d| d.is_dir()).unwrap_or_else(|| root.clone())
            };
            json!({
                "files": list_dir(&root, &dir),
                "root": root.to_string_lossy().replace('\\', "/"),
                "path": rel(&root, &dir),
            })
        }
        "shell.capabilities" => {
            // The pseudoconsole answer is what the shell knows, never a
            // hard-coded "yes": a restrictive job object or an old Windows
            // build genuinely has no PTY. The answer is never probed on
            // demand — on a machine without ConPTY the probe costs seconds and
            // the UI must not wait for it. A terminal session reports the
            // truth as soon as it opens.
            let (known, available) = term::conpty_status();
            json!({
                "ok": true,
                "capabilities": {
                    // The native picker needs a window; never claim it in --no-window.
                    "pickFolder": !st.headless, "termInstance": true, "fsListPath": true,
                    "pty": if known { available } else { true },
                    "procExec": true, "fsMkdir": true, "fsRename": true,
                    "fsSearch": true, "fsCopy": true,
                },
            })
        }
        "fs.read" => {
            let root = st.root.lock().map(|r| r.clone()).unwrap_or_default();
            let p = req.get("path").and_then(|v| v.as_str()).unwrap_or("");
            match resolve(&root, p).and_then(|full| fs::read_to_string(&full).ok()) {
                Some(content) => {
                    let truncated = content.chars().count() > 400_000;
                    json!({
                        "content": content.chars().take(400_000).collect::<String>(),
                        "truncated": truncated,
                    })
                }
                None => json!({
                    "content": format!("// {p}\n// (unreadable or outside workspace)\n"),
                    "truncated": false,
                }),
            }
        }
        "fs.write" => {
            let root = st.root.lock().map(|r| r.clone()).unwrap_or_default();
            let p = req.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let content = req.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let ok = resolve(&root, p)
                .map(|full| {
                    if let Some(parent) = full.parent() { let _ = fs::create_dir_all(parent); }
                    fs::write(&full, content).is_ok()
                })
                .unwrap_or(false);
            if ok { st.bus.emit("io", json!({ "type": "fs.changed", "path": p })); }
            json!({ "ok": ok })
        }
        "fs.delete" => {
            let root = st.root.lock().map(|r| r.clone()).unwrap_or_default();
            let p = req.get("path").and_then(|v| v.as_str()).unwrap_or("");
            // Deletion never unlinks: the target is renamed into the workspace
            // trash (N4). The workspace root and the trash itself are immutable.
            let ok = resolve(&root, p)
                .filter(|full| full != &root && full.exists())
                .filter(|full| !full.starts_with(root.join(".pristem")))
                .map(|full| {
                    let trash = root.join(".pristem").join("trash");
                    if fs::create_dir_all(&trash).is_err() { return false; }
                    let name = full
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| "item".into());
                    let stamp = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis())
                        .unwrap_or(0);
                    fs::rename(&full, trash.join(format!("{stamp}-{name}"))).is_ok()
                })
                .unwrap_or(false);
            if ok { st.bus.emit("io", json!({ "type": "fs.changed", "path": p })); }
            json!({ "ok": ok })
        }
        "fs.mkdir" => {
            let root = st.root.lock().map(|r| r.clone()).unwrap_or_default();
            let p = req.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let r = fs_mkdir(&root, p);
            if r.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
                st.bus.emit("io", json!({ "type": "fs.changed", "path": p }));
            }
            r
        }
        "fs.rename" => {
            let root = st.root.lock().map(|r| r.clone()).unwrap_or_default();
            let from = req.get("from").and_then(|v| v.as_str()).unwrap_or("");
            let to = req.get("to").and_then(|v| v.as_str()).unwrap_or("");
            let r = fs_rename(&root, from, to);
            if r.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
                st.bus.emit("io", json!({ "type": "fs.changed", "path": from }));
            }
            r
        }
        "fs.copy" => {
            let root = st.root.lock().map(|r| r.clone()).unwrap_or_default();
            let from = req.get("from").and_then(|v| v.as_str()).unwrap_or("");
            let to = req.get("to").and_then(|v| v.as_str()).unwrap_or("");
            let r = fs_copy(&root, from, to);
            if r.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
                st.bus.emit("io", json!({ "type": "fs.changed", "path": to }));
            }
            r
        }
        "fs.search" => {
            let root = st.root.lock().map(|r| r.clone()).unwrap_or_default();
            fs_search(&root, &req)
        }
        "fs.replace" => {
            let root = st.root.lock().map(|r| r.clone()).unwrap_or_default();
            let r = fs_replace(&root, &req);
            if r.get("files").and_then(|v| v.as_u64()).unwrap_or(0) > 0 {
                st.bus.emit("io", json!({ "type": "fs.changed", "path": "" }));
            }
            r
        }
        "fs.files" => {
            let root = st.root.lock().map(|r| r.clone()).unwrap_or_default();
            let limit = req.get("limit").and_then(|v| v.as_u64()).unwrap_or(4000) as usize;
            fs_files(&root, limit)
        }
        "models.get" => models::describe(
            &st.kernel_cfg,
            &st.runtime_models,
            &st.runtime_default,
            st.demo,
        ),
        "models.save" => models::save(&req),
        "fs.pickFolder" => {
            // A real native folder picker (Windows: IFileOpenDialog through rfd).
            // No window means no dialog: say so instead of quietly reopening the
            // current root, which looked like "the button entered the same folder".
            if st.headless {
                return json!({ "ok": false, "error": "native folder picker needs a window" });
            }
            let start = st.root.lock().map(|r| r.clone()).unwrap_or_default();
            let mut dialog = rfd::FileDialog::new()
                .set_title(if req.get("select").and_then(|v| v.as_bool()).unwrap_or(false) {
                    "选择文件夹"
                } else {
                    "打开文件夹"
                });
            if start.is_dir() {
                dialog = dialog.set_directory(&start);
            }
            let Some(dir) = dialog.pick_folder() else {
                return json!({ "ok": true, "cancelled": true });
            };
            let shown = dir.to_string_lossy().replace('\\', "/");
            // `select: true` only returns the path (the new-project flow needs a
            // parent directory, not a workspace switch).
            if req.get("select").and_then(|v| v.as_bool()).unwrap_or(false) {
                return json!({ "ok": true, "path": shown });
            }
            if let Ok(mut guard) = st.root.lock() { *guard = dir.clone(); }
            remember_workspace(st, &dir);
            st.bus.emit("io", json!({ "type": "workspace", "root": shown }));
            json!({ "ok": true, "root": shown, "files": list_dir(&dir, &dir) })
        }
        "fs.newProject" => fs_new_project(&req),
        "fs.closeFolder" => {
            if let Ok(mut guard) = st.root.lock() { *guard = PathBuf::new(); }
            if !st.headless { let _ = fs::remove_file(workspace_path()); }
            st.bus.emit("io", json!({ "type": "workspace", "root": "" }));
            json!({ "ok": true })
        }
        "fs.openFolder" => {
            let p = req.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let root = if p.is_empty() {
                st.root.lock().map(|r| r.clone()).unwrap_or_default()
            } else {
                PathBuf::from(p)
            };
            if root.is_dir() {
                if let Ok(mut guard) = st.root.lock() { *guard = root.clone(); }
                if !p.is_empty() { remember_workspace(st, &root); }
                st.bus.emit("io", json!({ "type": "workspace", "root": root.to_string_lossy().replace('\\', "/") }));
                json!({ "ok": true, "files": list_dir(&root, &root) })
            } else {
                json!({ "ok": false, "error": "not a directory" })
            }
        }
        "term.open" => {
            let root = st.root.lock().map(|r| r.clone()).unwrap_or_default();
            let instance = req.get("instance").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let cols = req.get("cols").and_then(|v| v.as_u64()).unwrap_or(80) as u16;
            let rows = req.get("rows").and_then(|v| v.as_u64()).unwrap_or(24) as u16;
            let profile = ShellProfile::parse(req.get("shell").and_then(|v| v.as_str()).unwrap_or("auto"));
            let cwd = shell_cwd(&root);
            match st.term.open(instance, cwd, cols, rows, profile, st.bus.clone()) {
                Ok(info) => json!({
                    "ok": true,
                    "shell": info.name,
                    "path": info.path,
                    // "pty" or "pipe": the UI shows which one it got.
                    "kind": info.kind,
                    // Why the session is degraded; empty for a real PTY.
                    "note": info.note,
                }),
                Err(e) => json!({ "ok": false, "error": e }),
            }
        }
        "term.write" | "term.input" => {
            let instance = req.get("instance").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let data = req.get("data").and_then(|v| v.as_str()).unwrap_or("");
            match st.term.write(instance, data.as_bytes()) {
                Ok(()) => json!({ "ok": true }),
                Err(e) => json!({ "ok": false, "error": e }),
            }
        }
        "clipboard.read" => match clipboard_read() {
            Some(text) => json!({ "ok": true, "text": text }),
            None => json!({ "ok": false, "error": "clipboard unavailable" }),
        },
        "clipboard.write" => {
            let text = req.get("text").and_then(|v| v.as_str()).unwrap_or("");
            json!({ "ok": clipboard_write(text) })
        }
        "term.interrupt" => {
            let instance = req.get("instance").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            match st.term.interrupt(instance) {
                Ok(killed) => json!({ "ok": true, "killed": killed }),
                Err(e) => json!({ "ok": false, "error": e }),
            }
        }
        "term.resize" => {
            let instance = req.get("instance").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let cols = req.get("cols").and_then(|v| v.as_u64()).unwrap_or(80) as u16;
            let rows = req.get("rows").and_then(|v| v.as_u64()).unwrap_or(24) as u16;
            match st.term.resize(instance, cols, rows) {
                Ok(()) => json!({ "ok": true }),
                Err(e) => json!({ "ok": false, "error": e }),
            }
        }
        "term.kill" => {
            let instance = req.get("instance").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            st.term.kill(instance);
            json!({ "ok": true })
        }
        "term.run" => {
            let root = st.root.lock().map(|r| r.clone()).unwrap_or_default();
            let cmd = req.get("command").and_then(|v| v.as_str()).unwrap_or("");
            let instance = req.get("instance").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let profile = ShellProfile::parse(req.get("shell").and_then(|v| v.as_str()).unwrap_or("auto"));
            // Lazy-open for callers that never mounted a terminal (clone, tests).
            match st.term.open(instance, shell_cwd(&root), 80, 24, profile, st.bus.clone()) {
                Ok(_) => match st.term.write(instance, format!("{cmd}\r").as_bytes()) {
                    Ok(()) => json!({ "ok": true }),
                    Err(e) => json!({ "ok": false, "error": e }),
                },
                Err(e) => json!({ "ok": false, "error": e }),
            }
        }
        "proc.exec" => {
            let root = st.root.lock().map(|r| r.clone()).unwrap_or_default();
            if root.as_os_str().is_empty() {
                return json!({ "ok": false, "error": "no workspace" });
            }
            let command = req.get("command").and_then(|v| v.as_str()).unwrap_or("");
            let args: Vec<String> = req.get("args").and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
                .unwrap_or_default();
            let timeout = req.get("timeout").and_then(|v| v.as_u64()).unwrap_or(10_000);
            proc_exec(command, &args, &root, timeout)
        }
        "window.minimize" => { st.window_op(WindowOp::Minimize); json!({ "ok": true }) }
        "window.maximize" => { st.window_op(WindowOp::Maximize); json!({ "ok": true }) }
        "window.close" => { st.window_op(WindowOp::Close); json!({ "ok": true }) }
        "window.drag" => { st.window_op(WindowOp::Drag); json!({ "ok": true }) }
        _ => json!({ "ok": false, "error": "unknown io op" }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_store_means_no_workspace() {
        // The app must never fall back to its own source folder: a fresh
        // install starts on the welcome screen, not on the repository.
        let store = std::env::temp_dir().join(format!("pristem-no-store-{}.txt", std::process::id()));
        let _ = fs::remove_file(&store);
        assert!(read_workspace(&store).is_none());
    }

    #[test]
    fn a_moved_workspace_does_not_resurrect() {
        let base = std::env::temp_dir().join(format!("pristem-ws-moved-{}", std::process::id()));
        let gone = base.join("moved-away");
        let _ = fs::create_dir_all(&gone);
        let store = base.join("workspace.txt");
        write_workspace(&store, &gone);
        let _ = fs::remove_dir_all(&gone);
        assert!(read_workspace(&store).is_none(), "a deleted folder must not come back");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn the_store_round_trips_the_workspace() {
        let base = std::env::temp_dir().join(format!("pristem-ws-roundtrip-{}", std::process::id()));
        let dir = base.join("project");
        let _ = fs::create_dir_all(&dir);
        let store = base.join("workspace.txt");
        write_workspace(&store, &dir);
        assert_eq!(read_workspace(&store).as_deref(), Some(dir.as_path()));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn shell_cwd_is_not_the_apps_own_folder() {
        // With no workspace the terminal starts in the user's home, never in
        // the app's source tree.
        let home = shell_cwd(Path::new(""));
        assert!(home.is_dir(), "the fallback cwd must exist: {}", home.display());
        assert!(!home.to_string_lossy().contains("pristem-desktop"));
    }

    #[test]
    fn skip_hides_build_and_trash() {
        for n in ["target", "node_modules", ".git", "dist", ".pristem"] {
            assert!(skip(n), "{n} must be hidden");
        }
        for n in [".screenshots", ".workbuddy", "src", ".env"] {
            assert!(!skip(n), "{n} must stay visible");
        }
    }

    #[test]
    fn resolve_blocks_escape() {
        let root = Path::new("C:/ws");
        assert!(resolve(root, "../outside").is_none());
        assert!(resolve(root, "a/../../outside").is_none());
        assert!(resolve(root, "C:/other/file").is_none());
        assert!(resolve(root, "src/main.rs").is_some());
        assert!(resolve(root, "C:/ws/src/main.rs").is_some());
    }

    #[test]
    fn resolve_refuses_an_empty_root() {
        // No workspace: a relative write must fail instead of landing in the cwd.
        assert!(resolve(Path::new(""), "pristem-project/README.md").is_none());
    }

    #[test]
    fn new_project_scaffolds_and_uniquifies() {
        let parent = std::env::temp_dir().join(format!("pristem-newproj-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&parent);
        std::fs::create_dir_all(&parent).unwrap();
        let first = fs_new_project(&json!({ "parent": parent.to_string_lossy() }));
        assert_eq!(first["ok"], true, "{first}");
        let dir = PathBuf::from(first["path"].as_str().unwrap());
        assert!(dir.join("README.md").is_file());
        let second = fs_new_project(&json!({ "parent": parent.to_string_lossy() }));
        assert_eq!(second["ok"], true, "{second}");
        assert_ne!(first["path"], second["path"], "a second project must not overwrite the first");
        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn proc_exec_captures_stdout_and_stderr() {
        let root = std::env::temp_dir();
        let cmd = if cfg!(windows) { "echo OUT_PROBE & echo ERR_PROBE 1>&2" } else { "echo OUT_PROBE; echo ERR_PROBE 1>&2" };
        let r = proc_exec(cmd, &[], &root, 8000);
        assert_eq!(r["ok"], true);
        let out = r["stdout"].as_str().unwrap_or("");
        assert!(out.contains("OUT_PROBE"), "stdout missing: {out}");
        assert!(out.contains("ERR_PROBE"), "stderr missing: {out}");
    }

    #[test]
    fn proc_exec_timeout_kills() {
        let root = std::env::temp_dir();
        let cmd = if cfg!(windows) { "ping -n 6 127.0.0.1 >NUL" } else { "sleep 6" };
        let start = std::time::Instant::now();
        let r = proc_exec(cmd, &[], &root, 300);
        assert_eq!(r["ok"], false);
        assert_eq!(r["error"], "timeout");
        assert!(start.elapsed() < Duration::from_secs(4), "timeout not enforced");
    }

    #[test]
    fn proc_command_uses_args_without_a_shell() {
        let shell = proc_command("git status", &[]);
        #[cfg(windows)]
        assert_eq!(shell.get_program(), "cmd");
        #[cfg(not(windows))]
        assert_eq!(shell.get_program(), "sh");
        let direct = proc_command("git", &["status".to_string()]);
        assert_eq!(direct.get_program(), "git");
    }

    #[test]
    fn proc_exec_args_reach_the_program() {
        let root = std::env::temp_dir();
        let (prog, args): (&str, Vec<String>) = if cfg!(windows) {
            ("cmd", ["/C", "echo", "ARG_OK"].iter().map(|s| s.to_string()).collect())
        } else {
            ("sh", ["-c", "echo ARG_OK"].iter().map(|s| s.to_string()).collect())
        };
        let r = proc_exec(prog, &args, &root, 8000);
        assert_eq!(r["ok"], true);
        assert!(r["stdout"].as_str().unwrap_or("").contains("ARG_OK"));
    }

    #[test]
    fn mkdir_and_rename_roundtrip() {
        let root = std::env::temp_dir().join(format!("pristem-fs-{}", std::process::id()));
        let _ = fs::create_dir_all(&root);
        assert_eq!(fs_mkdir(&root, "sub")["ok"], true);
        assert!(root.join("sub").is_dir());
        assert_eq!(fs_mkdir(&root, "sub")["error"], "exists");
        assert_eq!(fs_mkdir(&root, ".pristem/trash")["ok"], false);
        assert_eq!(fs_mkdir(&root, "../escape")["ok"], false);

        fs::write(root.join("sub/a.txt"), "hi").unwrap();
        assert_eq!(fs_rename(&root, "sub/a.txt", "sub/b.txt")["ok"], true);
        assert!(root.join("sub/b.txt").exists());
        assert!(!root.join("sub/a.txt").exists());

        fs::write(root.join("sub/c.txt"), "x").unwrap();
        assert_eq!(fs_rename(&root, "sub/b.txt", "sub/c.txt")["error"], "exists");
        assert_eq!(fs_rename(&root, "sub/b.txt", "../escape.txt")["ok"], false);
        assert_eq!(fs_rename(&root, "sub", "sub2")["ok"], true);
        assert!(root.join("sub2/b.txt").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn copy_roundtrip_and_guards() {
        let root = std::env::temp_dir().join(format!("pristem-copy-{}", std::process::id()));
        let _ = fs::create_dir_all(root.join("src/nested"));
        fs::write(root.join("src/nested/a.txt"), "hello").unwrap();
        fs::write(root.join("plain.txt"), "plain").unwrap();

        assert_eq!(fs_copy(&root, "plain.txt", "copy.txt")["ok"], true);
        assert_eq!(fs::read_to_string(root.join("copy.txt")).unwrap(), "plain");
        assert_eq!(fs_copy(&root, "plain.txt", "copy.txt")["error"], "exists");

        assert_eq!(fs_copy(&root, "src", "dst")["ok"], true);
        assert_eq!(fs::read_to_string(root.join("dst/nested/a.txt")).unwrap(), "hello");
        assert_eq!(fs_copy(&root, "src", "src/inside")["error"], "into itself");
        assert_eq!(fs_copy(&root, "src", "../escape")["ok"], false);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn tree_signature_tracks_external_writes() {
        let root = std::env::temp_dir().join(format!("pristem-watch-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("a.txt"), "one").unwrap();
        let first = tree_signature(&root);
        fs::write(root.join("b.txt"), "two").unwrap();
        let second = tree_signature(&root);
        assert_ne!(first, second, "a new file must change the fingerprint");
        let stable = tree_signature(&root);
        assert_eq!(second, stable, "an unchanged tree must hash the same");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn glob_match_cases() {
        assert!(glob_match("*.rs", "main.rs"));
        assert!(!glob_match("*.rs", "src/main.rs"));
        assert!(glob_match("**/*.rs", "src/main.rs"));
        assert!(glob_match("**/*.rs", "a/b/c/main.rs"));
        assert!(glob_match("**/*.rs", "main.rs"));
        assert!(glob_match("src/**", "src/a/b.rs"));
        assert!(glob_match("src/*.rs", "src/main.rs"));
        assert!(!glob_match("src/*.rs", "src/sub/main.rs"));
        assert!(glob_match("?.rs", "a.rs"));
        assert!(!glob_match("?.rs", "ab.rs"));
        assert!(glob_match("*.RS", "main.rs")); // case-insensitive literal
        assert!(!glob_match("*.rs", "main.txt"));
    }

    #[test]
    fn search_replace_and_files() {
        let root = std::env::temp_dir().join(format!("pristem-search-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("src/deep")).unwrap();
        fs::create_dir_all(root.join(".pristem/trash")).unwrap();
        fs::create_dir_all(root.join("node_modules")).unwrap();
        fs::write(root.join("src/deep/a.rs"), "fn needle() {}\n// needle again\n").unwrap();
        fs::write(root.join("src/b.txt"), "a needle here\n").unwrap();
        fs::write(root.join("top.md"), "needle at root\n").unwrap();
        fs::write(root.join(".pristem/trash/x.txt"), "needle in trash\n").unwrap();
        fs::write(root.join("node_modules/y.js"), "needle in deps\n").unwrap();
        fs::write(root.join("bin.dat"), b"needle\0binary").unwrap();

        // Recursive search finds nested hits, never trash / deps / binary.
        let r = fs_search(&root, &json!({ "query": "needle" }));
        assert_eq!(r["ok"], true);
        let hits = r["hits"].as_array().unwrap();
        let paths: Vec<&str> = hits.iter().map(|h| h["path"].as_str().unwrap()).collect();
        assert!(paths.contains(&"src/deep/a.rs"));
        assert!(paths.contains(&"src/b.txt"));
        assert!(paths.contains(&"top.md"));
        assert!(!paths.iter().any(|p| p.starts_with(".pristem")));
        assert!(!paths.iter().any(|p| p.starts_with("node_modules")));
        assert!(!paths.iter().any(|p| *p == "bin.dat"));
        assert_eq!(r["files"], 3);

        // include / exclude globs.
        let r = fs_search(&root, &json!({ "query": "needle", "include": "**/*.rs" }));
        assert_eq!(r["files"], 1);
        let r = fs_search(&root, &json!({ "query": "needle", "exclude": "src/**" }));
        assert_eq!(r["files"], 1); // only top.md

        // invalid regex is reported, not panicked.
        let r = fs_search(&root, &json!({ "query": "(unclosed", "regex": true }));
        assert_eq!(r["ok"], false);
        assert_eq!(r["error"], "invalid regex");

        // literal replace does not interpret `$` in the replacement.
        let r = fs_replace(&root, &json!({ "query": "needle", "replacement": "$1x" }));
        assert_eq!(r["ok"], true);
        assert!(r["replacements"].as_u64().unwrap() >= 4);
        let after = fs::read_to_string(root.join("top.md")).unwrap();
        assert!(after.contains("$1x"), "literal $ injected: {after}");
        assert!(!after.contains("needle"));

        // file index powers quick open; trash/deps excluded.
        let r = fs_files(&root, 4000);
        let files = r["files"].as_array().unwrap();
        let names: Vec<&str> = files.iter().map(|f| f.as_str().unwrap()).collect();
        assert!(names.contains(&"src/deep/a.rs"));
        assert!(!names.iter().any(|p| p.starts_with(".pristem")));
        assert!(!names.iter().any(|p| p.starts_with("node_modules")));

        let _ = fs::remove_dir_all(&root);
    }
}