//! Real terminal sessions. Windows: ConPTY via windows-sys (already in Cargo.lock,
//! offline-safe), with a persistent piped-shell fallback when the hosted process
//! cannot initialize (e.g. inside a restrictive job object). Other platforms: a
//! pipe-based fallback, explicitly not a PTY. Sessions are owned by the shell,
//! never by the kernel — `io:*` channel only.
//!
//! Two rules shape this file:
//!
//!   * A degraded session still has to behave like a terminal. A pipe has no
//!     console, so the console cannot echo the keystrokes or colorize the
//!     output: the host echoes the input itself, and the requested shell is
//!     honoured instead of being swapped for cmd.exe behind the user's back.
//!   * Every degradation is reported. The session carries the reason, the UI
//!     shows it, and the capability probe answers the truth instead of a
//!     hard-coded "yes".

use std::{
    collections::HashMap,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};

use serde_json::json;

use crate::bus::Bus;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShellProfile {
    Auto,
    Pwsh,
    PowerShell,
    Cmd,
}

impl ShellProfile {
    pub fn parse(s: &str) -> Self {
        match s {
            "pwsh" => Self::Pwsh,
            "powershell" => Self::PowerShell,
            "cmd" => Self::Cmd,
            _ => Self::Auto,
        }
    }
}

#[derive(Clone, Debug)]
pub struct ShellInfo {
    pub name: String,
    pub path: String,
    /// "pty" for a real pseudoconsole, "pipe" for the degraded fallback.
    pub kind: &'static str,
    /// Why the session is degraded. Empty when the session is a real PTY.
    pub note: String,
}

impl ShellInfo {
    fn candidate(name: &str, path: String) -> Self {
        Self { name: name.to_string(), path, kind: "pty", note: String::new() }
    }
}

/// Resolve a profile to an ordered list of concrete shells. Auto probes
/// pwsh → powershell → cmd; an explicit profile resolves to that shell alone
/// (falling back to cmd.exe only when it does not exist on this machine).
fn resolve_shell(profile: ShellProfile) -> Vec<ShellInfo> {
    let find_pwsh = || -> Option<String> {
        let out = std::process::Command::new("where.exe")
            .arg("pwsh")
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let first = String::from_utf8_lossy(&out.stdout)
            .lines()
            .next()?
            .trim()
            .to_string();
        if first.is_empty() { None } else { Some(first) }
    };
    let sysroot = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    let powershell = format!("{sysroot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    let cmd = cmd_shell();

    let mut chain: Vec<ShellInfo> = match profile {
        ShellProfile::Pwsh => vec![ShellInfo::candidate("pwsh", find_pwsh().unwrap_or_default())],
        ShellProfile::PowerShell => vec![ShellInfo::candidate("powershell", powershell)],
        ShellProfile::Cmd => vec![cmd.clone()],
        ShellProfile::Auto => vec![
            ShellInfo::candidate("pwsh", find_pwsh().unwrap_or_default()),
            ShellInfo::candidate("powershell", powershell),
            cmd.clone(),
        ],
    };
    chain.retain(|s| !s.path.is_empty() && Path::new(&s.path).exists());
    if chain.is_empty() {
        chain.push(cmd);
    }
    chain
}

fn cmd_shell() -> ShellInfo {
    let sysroot = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    ShellInfo::candidate("cmd", format!("{sysroot}\\System32\\cmd.exe"))
}

/// Shells that already failed the first-paint probe in this process. Retrying
/// a known-bad shell costs the probe window on every terminal tab.
fn broken_shells() -> &'static Mutex<Vec<String>> {
    static BROKEN: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
    BROKEN.get_or_init(|| Mutex::new(Vec::new()))
}

fn mark_broken(name: &str) {
    if let Ok(mut list) = broken_shells().lock() {
        if !list.iter().any(|n| n == name) {
            list.push(name.to_string());
        }
    }
}

fn is_broken(name: &str) -> bool {
    broken_shells().lock().map(|l| l.iter().any(|n| n == name)).unwrap_or(false)
}

/// Shells that started but died inside a pseudoconsole. The binary itself is
/// usable, so only the PTY path skips them — the pipe fallback may still run
/// the user's shell of choice.
fn pty_broken_shells() -> &'static Mutex<Vec<String>> {
    static BROKEN: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
    BROKEN.get_or_init(|| Mutex::new(Vec::new()))
}

fn mark_pty_broken(name: &str) {
    if let Ok(mut list) = pty_broken_shells().lock() {
        if !list.iter().any(|n| n == name) {
            list.push(name.to_string());
        }
    }
}

fn is_pty_broken(name: &str) -> bool {
    pty_broken_shells().lock().map(|l| l.iter().any(|n| n == name)).unwrap_or(false)
}

/// Whether this process can host a pseudoconsole at all. The answer depends on
/// the environment (job object, Windows build), not on the session, and finding
/// out costs a process spawn — so it is learned from the first session and
/// remembered.
fn conpty_state() -> &'static Mutex<(bool, bool)> {
    static STATE: OnceLock<Mutex<(bool, bool)>> = OnceLock::new();
    // (known, available)
    STATE.get_or_init(|| Mutex::new((false, false)))
}

/// What the shell knows about the pseudoconsole: (known, available).
///
/// The answer is never probed on demand: on a machine without ConPTY the
/// probe costs seconds, and the UI must not wait for it. A session reports
/// the truth as soon as it opens.
pub fn conpty_status() -> (bool, bool) {
    conpty_state().lock().map(|s| *s).unwrap_or((false, false))
}

fn set_conpty_unavailable() {
    if let Ok(mut state) = conpty_state().lock() {
        *state = (true, false);
    }
}

pub struct TermRegistry {
    sessions: Mutex<HashMap<u32, Arc<TermSession>>>,
}

impl TermRegistry {
    pub fn new() -> Self {
        Self { sessions: Mutex::new(HashMap::new()) }
    }

    /// Idempotent: an alive session is returned as-is.
    pub fn open(
        &self,
        instance: u32,
        root: PathBuf,
        cols: u16,
        rows: u16,
        profile: ShellProfile,
        bus: Bus,
    ) -> Result<ShellInfo, String> {
        if let Ok(map) = self.sessions.lock() {
            if let Some(s) = map.get(&instance) {
                if !s.torn_down.load(Ordering::SeqCst) {
                    return Ok(ShellInfo {
                        name: s.shell.clone(),
                        path: String::new(),
                        kind: s.kind,
                        note: s.note.clone(),
                    });
                }
            }
        }
        let candidates = resolve_shell(profile);
        let session = TermSession::spawn(instance, root, cols, rows, &candidates, bus)?;
        let info = ShellInfo {
            name: session.shell.clone(),
            path: session.path.clone(),
            kind: session.kind,
            note: session.note.clone(),
        };
        if let Ok(mut map) = self.sessions.lock() {
            map.insert(instance, Arc::new(session));
        }
        Ok(info)
    }

    pub fn write(&self, instance: u32, data: &[u8]) -> Result<(), String> {
        let s = self.get(instance)?;
        s.write(data)
    }

    pub fn resize(&self, instance: u32, cols: u16, rows: u16) -> Result<(), String> {
        let s = self.get(instance)?;
        s.resize(cols, rows)
    }

    /// Foreground interrupt: terminate the shell's child processes. A byte
    /// 0x03 on the ConPTY input pipe is not delivered as CTRL_C_EVENT on every
    /// Windows build (it lands in the line buffer as text), so Ctrl+C is
    /// implemented as "kill the children, keep the shell and its cwd".
    pub fn interrupt(&self, instance: u32) -> Result<u32, String> {
        let s = self.get(instance)?;
        s.interrupt()
    }

    pub fn kill(&self, instance: u32) {
        let s = self.sessions.lock().ok().and_then(|mut m| m.remove(&instance));
        if let Some(s) = s {
            s.shutdown();
        }
    }

    pub fn kill_all(&self) {
        let all: Vec<Arc<TermSession>> = self
            .sessions
            .lock()
            .map(|mut m| m.drain().map(|(_, v)| v).collect())
            .unwrap_or_default();
        for s in all {
            s.shutdown();
        }
    }

    fn get(&self, instance: u32) -> Result<Arc<TermSession>, String> {
        self.sessions
            .lock()
            .ok()
            .and_then(|m| m.get(&instance).cloned())
            .filter(|s| !s.torn_down.load(Ordering::SeqCst))
            .ok_or_else(|| "no such terminal session".to_string())
    }
}

impl Drop for TermRegistry {
    fn drop(&mut self) {
        self.kill_all();
    }
}

// ---------------------------------------------------------------------------
// Wire encoding
// ---------------------------------------------------------------------------

/// How a shell's byte stream is encoded. A Windows console is not UTF-8:
/// cmd.exe speaks the OEM code page, and PowerShell speaks UTF-16LE when its
/// stdin is redirected — which is why pipe mode hosts PowerShell through a
/// UTF-8 REPL bootstrap instead of its own console host.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Wire {
    /// The OEM code page (e.g. GBK on a Chinese Windows).
    Oem,
    /// UTF-8.
    Utf8,
}

/// Streaming decoder: a multi-byte character may straddle two reads, so the
/// incomplete tail is carried into the next chunk.
pub struct Codec {
    wire: Wire,
    carry: Vec<u8>,
}

impl Codec {
    pub fn new(wire: Wire) -> Self {
        Self { wire, carry: Vec::new() }
    }

    pub fn decode(&mut self, bytes: &[u8]) -> String {
        match self.wire {
            Wire::Utf8 => {
                let mut buf = std::mem::take(&mut self.carry);
                buf.extend_from_slice(bytes);
                match String::from_utf8(buf) {
                    Ok(s) => strip_bom(&s),
                    Err(e) => {
                        let utf8_error = e.utf8_error();
                        let valid = utf8_error.valid_up_to();
                        let truncated = utf8_error.error_len().is_none();
                        let buf = e.into_bytes();
                        let mut out = String::from_utf8_lossy(&buf[..valid]).into_owned();
                        let rest = &buf[valid..];
                        if truncated {
                            // Truncated sequence at the end: keep it for the
                            // next chunk instead of writing a replacement char.
                            self.carry = rest.to_vec();
                        } else {
                            out.push_str(&String::from_utf8_lossy(rest));
                        }
                        strip_bom(&out)
                    }
                }
            }
            Wire::Oem => {
                let mut buf = std::mem::take(&mut self.carry);
                buf.extend_from_slice(bytes);
                // cmd.exe writes a UTF-8 BOM in front of its error text; it is
                // noise in a terminal that decodes the OEM code page. A partial
                // BOM waits for its remaining bytes.
                if buf.starts_with(&[0xef, 0xbb, 0xbf]) {
                    buf.drain(..3);
                } else if buf.len() < 3 && (buf == [0xef] || buf == [0xef, 0xbb]) {
                    self.carry = buf;
                    return String::new();
                }
                // A DBCS character is two bytes; a trailing lead byte belongs
                // to the next chunk.
                let mut cut = buf.len();
                if let Some(&last) = buf.last() {
                    if last >= 0x81 {
                        cut -= 1;
                        self.carry = buf[cut..].to_vec();
                    }
                }
                let text = imp::oem_to_utf8(&buf[..cut]);
                strip_bom(&text)
            }
        }
    }
}

/// Drop a leading byte-order mark: cmd.exe writes one on stderr, and it is
/// noise in the terminal.
fn strip_bom(s: &str) -> String {
    s.strip_prefix('\u{feff}').map(|t| t.to_string()).unwrap_or_else(|| s.to_string())
}

/// The host-side echo of a pipe-backed session.
///
/// A pipe has no console: nothing echoes the keystrokes, so without this the
/// user types into a void and only sees the result after Enter. The host
/// echoes what was typed, tracks the line for backspace, and leaves the
/// control characters to the shell.
#[derive(Default)]
struct EchoState {
    line: String,
    pending: Vec<u8>,
}

impl EchoState {
    /// Split typed bytes into (bytes for the shell, text for the terminal).
    fn split(&mut self, data: &[u8]) -> (Vec<u8>, String) {
        let mut buf = std::mem::take(&mut self.pending);
        buf.extend_from_slice(data);
        let mut forward = Vec::with_capacity(buf.len());
        let mut echo = String::new();
        let mut i = 0;
        while i < buf.len() {
            let b = buf[i];
            match b {
                b'\r' | b'\n' => {
                    echo.push_str("\r\n");
                    self.line.clear();
                    forward.push(b'\n');
                    i += 1;
                }
                0x08 | 0x7f => {
                    if self.line.pop().is_some() {
                        echo.push_str("\u{8} \u{8}");
                    }
                    forward.push(b);
                    i += 1;
                }
                b'\t' => {
                    echo.push('\t');
                    self.line.push('\t');
                    forward.push(b);
                    i += 1;
                }
                0x03 => {
                    // Ctrl+C is the shell's business: it decides what to echo.
                    forward.push(b);
                    i += 1;
                }
                0x00..=0x1f => {
                    forward.push(b);
                    i += 1;
                }
                0x20..=0x7e => {
                    echo.push(b as char);
                    self.line.push(b as char);
                    forward.push(b);
                    i += 1;
                }
                _ => {
                    let len = utf8_len(b);
                    if len == 0 || i + len > buf.len() {
                        // Incomplete sequence: keep it for the next chunk.
                        self.pending = buf[i..].to_vec();
                        break;
                    }
                    match std::str::from_utf8(&buf[i..i + len]) {
                        Ok(s) => {
                            if let Some(ch) = s.chars().next() {
                                echo.push(ch);
                                self.line.push(ch);
                            }
                            forward.extend_from_slice(&buf[i..i + len]);
                        }
                        Err(_) => {
                            forward.push(b);
                        }
                    }
                    i += len;
                }
            }
        }
        (forward, echo)
    }
}

fn utf8_len(lead: u8) -> usize {
    match lead {
        0xc2..=0xdf => 2,
        0xe0..=0xef => 3,
        0xf0..=0xf4 => 4,
        _ => 0,
    }
}

/// A pipe-backed session: the shell process plus everything the host has to
/// take over from the missing console (echo, wire codec, output pump).
pub struct PipeSession {
    pub child: Mutex<std::process::Child>,
    pub input: Mutex<std::process::ChildStdin>,
    echo: Mutex<EchoState>,
    bus: Bus,
    instance: u32,
    wire: Wire,
}

impl PipeSession {
    pub fn new(
        child: std::process::Child,
        input: std::process::ChildStdin,
        bus: Bus,
        instance: u32,
        wire: Wire,
    ) -> Self {
        Self {
            child: Mutex::new(child),
            input: Mutex::new(input),
            echo: Mutex::new(EchoState::default()),
            bus,
            instance,
            wire,
        }
    }

    /// Write to the shell, echoing the typed characters into the terminal.
    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        let (forward, echo) = self.echo.lock().map_err(|_| "echo lock".to_string())?.split(data);
        if !echo.is_empty() {
            self.bus.emit(
                "io",
                json!({ "type": "term.output", "instance": self.instance, "data": echo }),
            );
        }
        let bytes = match self.wire {
            Wire::Utf8 => forward,
            Wire::Oem => imp::utf8_to_oem(&String::from_utf8_lossy(&forward)),
        };
        self.input
            .lock()
            .map_err(|_| "stdin lock".to_string())?
            .write_all(&bytes)
            .map_err(|e| format!("write failed: {e}"))
    }

    pub fn shutdown(&self) {
        if let Ok(mut c) = self.child.lock() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

// ---------------------------------------------------------------------------
// Windows: ConPTY with a piped-shell fallback
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod imp {
    use super::*;
    use std::ffi::c_void;
    use std::io::Read;
    use std::os::windows::process::CommandExt;
    use std::process::{ChildStderr, ChildStdout, Command, Stdio};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, HANDLE, TRUE, WAIT_TIMEOUT},
        Security::SECURITY_ATTRIBUTES,
        Storage::FileSystem::{ReadFile, WriteFile},
        System::Console::{
            ClosePseudoConsole, CreatePseudoConsole, ResizePseudoConsole, COORD, HPCON,
        },
        System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
        System::Pipes::{CreatePipe, PeekNamedPipe},
        System::Threading::{
            CreateProcessW, DeleteProcThreadAttributeList, InitializeProcThreadAttributeList,
            OpenProcess, TerminateProcess, UpdateProcThreadAttribute, WaitForSingleObject,
            CREATE_NO_WINDOW, EXTENDED_STARTUPINFO_PRESENT, LPPROC_THREAD_ATTRIBUTE_LIST,
            PROCESS_INFORMATION, PROCESS_TERMINATE, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
            STARTF_USESTDHANDLES, STARTUPINFOEXW,
        },
    };

    /// How long the first paint may take before the pseudoconsole is judged
    /// unusable. The old 1.2 s was short enough to misjudge a slow machine
    /// (cold antivirus, spinning disk) and silently degrade a working PTY to
    /// the pipe fallback; the cost of waiting is paid once per process.
    const FIRST_PAINT_BUDGET: std::time::Duration = std::time::Duration::from_millis(2500);
    /// cmd.exe paints in milliseconds, so its retry gets a tighter budget.
    const RETRY_BUDGET: std::time::Duration = std::time::Duration::from_millis(1500);
    /// When the pseudoconsole still has not painted by then, it gets a bare
    /// Enter: some conhost builds only draw after the first input.
    const NUDGE_AFTER: std::time::Duration = std::time::Duration::from_millis(1000);

    const CP_OEMCP: u32 = 1;

    /// Windows HANDLEs are process-wide, thread-safe references; moving the raw
    /// value between threads is sound as long as close happens exactly once
    /// (guarded by `torn_down`).
    struct SendHandle(HANDLE);
    unsafe impl Send for SendHandle {}
    unsafe impl Sync for SendHandle {}

    /// Why a pseudoconsole attempt failed. The distinction decides whether
    /// another shell may still work or the whole PTY path is dead.
    pub enum PtyFailure {
        /// The environment cannot host a pseudoconsole at all.
        NoConPty(String),
        /// The shell could not be started at all (missing or broken image).
        ShellMissing(String),
        /// The shell started but died inside the pseudoconsole. The binary is
        /// fine — it only refuses to live in a pseudoconsole, so the pipe
        /// fallback can still run it.
        ShellUnderPty(String),
    }

    enum Inner {
        Pty { input: SendHandle, output: SendHandle, hpc: SendHandle, process: SendHandle },
        Pipe { pipe: PipeSession },
    }

    pub struct TermSession {
        inner: Inner,
        pub torn_down: AtomicBool,
        pub shell: String,
        pub path: String,
        pub kind: &'static str,
        pub note: String,
        pid: u32,
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// The piped fallback has no console, so its child writes in the OEM code
    /// page (e.g. GBK). Decode it instead of producing mojibake.
    pub fn oem_to_utf8(bytes: &[u8]) -> String {
        use windows_sys::Win32::Globalization::MultiByteToWideChar;
        unsafe {
            let n = MultiByteToWideChar(
                CP_OEMCP,
                0,
                bytes.as_ptr(),
                bytes.len() as i32,
                std::ptr::null_mut(),
                0,
            );
            if n <= 0 {
                return String::from_utf8_lossy(bytes).to_string();
            }
            let mut out = vec![0u16; n as usize];
            let written = MultiByteToWideChar(
                CP_OEMCP,
                0,
                bytes.as_ptr(),
                bytes.len() as i32,
                out.as_mut_ptr(),
                n,
            );
            if written <= 0 {
                return String::from_utf8_lossy(bytes).to_string();
            }
            out.truncate(written as usize);
            String::from_utf16_lossy(&out)
        }
    }

    /// Encode UTF-8 text into the OEM code page, so a command typed with
    /// non-ASCII characters reaches cmd.exe as the characters it expects.
    pub fn utf8_to_oem(text: &str) -> Vec<u8> {
        use windows_sys::Win32::Globalization::WideCharToMultiByte;
        let wide: Vec<u16> = text.encode_utf16().collect();
        if wide.is_empty() {
            return Vec::new();
        }
        unsafe {
            let n = WideCharToMultiByte(
                CP_OEMCP,
                0,
                wide.as_ptr(),
                wide.len() as i32,
                std::ptr::null_mut(),
                0,
                std::ptr::null(),
                std::ptr::null_mut(),
            );
            if n <= 0 {
                return text.as_bytes().to_vec();
            }
            let mut out = vec![0u8; n as usize];
            let written = WideCharToMultiByte(
                CP_OEMCP,
                0,
                wide.as_ptr(),
                wide.len() as i32,
                out.as_mut_ptr(),
                n,
                std::ptr::null(),
                std::ptr::null_mut(),
            );
            out.truncate(written.max(0) as usize);
            out
        }
    }

    /// Child process ids of `root`, breadth-first (parents before children).
    /// Returns `Err` with a diagnostic when the snapshot itself fails.
    fn descendants(root: u32) -> Result<Vec<u32>, String> {
        let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snap == windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE {
            return Err(format!("snapshot failed: {}", unsafe { GetLastError() }));
        }
        let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut pairs: Vec<(u32, u32)> = Vec::new();
        unsafe {
            if Process32FirstW(snap, &mut entry) == TRUE {
                loop {
                    pairs.push((entry.th32ProcessID, entry.th32ParentProcessID));
                    if Process32NextW(snap, &mut entry) != TRUE {
                        break;
                    }
                }
            }
            CloseHandle(snap);
        }
        let mut out: Vec<u32> = Vec::new();
        let mut frontier = vec![root];
        while let Some(parent) = frontier.pop() {
            for (pid, ppid) in &pairs {
                if *ppid == parent && *pid != parent && !out.contains(pid) {
                    out.push(*pid);
                    frontier.push(*pid);
                }
            }
        }
        Ok(out)
    }

    /// The pipe-mode REPL bootstrap for PowerShell.
    ///
    /// PowerShell's console host cannot run over a pipe: it decodes redirected
    /// stdin as UTF-16LE and prefixes every line with U+FEFF, so every command
    /// fails with "not recognized". This bootstrap owns the stdin stream
    /// itself (UTF-8) and evaluates one line at a time, which gives
    /// PowerShell a real prompt over a pipe. Pinning the output encoding to
    /// UTF-8 makes the results *and* the localized error text UTF-8.
    const REPL_BOOTSTRAP: &str = r#"$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}
try { if (Get-Variable PSStyle -ErrorAction SilentlyContinue) { $PSStyle.OutputRendering = 'Ansi' } } catch {}
$reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.UTF8Encoding]::new($false))
while ($true) {
  Write-Host ("PS " + (Get-Location).Path + "> ") -NoNewline
  $line = $reader.ReadLine()
  if ($null -eq $line) { break }
  try { Invoke-Expression $line } catch { Write-Host ($_ | Out-String) }
}
"#;

    /// Where the bootstrap lives. It is a static asset of the shell, not of the
    /// workspace, so it goes to the app data directory next to the model
    /// catalogue.
    fn repl_script_path() -> PathBuf {
        let base = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir)
            .join("pristem")
            .join("terminal");
        let path = base.join("repl.ps1");
        let current = std::fs::read_to_string(&path).ok();
        if current.as_deref() != Some(REPL_BOOTSTRAP) {
            if std::fs::create_dir_all(&base).is_ok() {
                let _ = std::fs::write(&path, REPL_BOOTSTRAP);
            }
        }
        path
    }

    /// Environment hints for a pipe-backed shell. The pipe is not a terminal,
    /// so the tools that colorize only when they see one have to be told.
    fn apply_color_env(cmd: &mut Command) {
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("FORCE_COLOR", "1");
        cmd.env("CLICOLOR_FORCE", "1");
        // git only colorizes for a terminal. Ask it explicitly — through the
        // environment, so the user's own git config is never touched.
        cmd.env("GIT_CONFIG_COUNT", "1");
        cmd.env("GIT_CONFIG_KEY_0", "color.ui");
        cmd.env("GIT_CONFIG_VALUE_0", "always");
    }

    impl TermSession {
        pub fn spawn(
            instance: u32,
            root: PathBuf,
            cols: u16,
            rows: u16,
            candidates: &[ShellInfo],
            bus: Bus,
        ) -> Result<Self, String> {
            // The pseudoconsole is the real terminal. Try the requested shell
            // first, then cmd.exe (the combination that works everywhere),
            // and only then fall back to a pipe. A shell that already failed is
            // skipped for the rest of the process, so later tabs open instantly.
            let primary = candidates.first().cloned().unwrap_or_else(cmd_shell);
            let cmd = cmd_shell();
            let mut notes: Vec<String> = Vec::new();

            // A machine without ConPTY is learned once and remembered: the
            // probe costs seconds, and every later tab would pay it again.
            let (known, available) = super::conpty_status();
            if known && !available {
                notes.push("this environment cannot host a pseudoconsole".to_string());
            } else {
                let mut attempts: Vec<(&str, &ShellInfo, std::time::Duration)> =
                    vec![(primary.name.as_str(), &primary, FIRST_PAINT_BUDGET)];
                if cmd.name != primary.name {
                    attempts.push((cmd.name.as_str(), &cmd, RETRY_BUDGET));
                }
                let mut env_failed = false;
                for (name, shell, budget) in attempts {
                    if super::is_broken(name) {
                        notes.push(format!("{name} was already known to be unusable here"));
                        continue;
                    }
                    if super::is_pty_broken(name) {
                        notes.push(format!("{name} cannot run inside a pseudoconsole"));
                        continue;
                    }
                    match pty_spawn(instance, root.clone(), cols, rows, shell, bus.clone(), budget) {
                        Ok(mut s) => {
                            if !notes.is_empty() {
                                s.note = notes.join("; ");
                            }
                            return Ok(s);
                        }
                        Err(PtyFailure::ShellMissing(e)) => {
                            notes.push(format!("{name}: {e}"));
                            super::mark_broken(name);
                        }
                        Err(PtyFailure::ShellUnderPty(e)) => {
                            notes.push(format!("{name}: {e}"));
                            super::mark_pty_broken(name);
                        }
                        Err(PtyFailure::NoConPty(e)) => {
                            notes.push(format!("{name}: {e}"));
                            env_failed = true;
                        }
                    }
                }
                // Only now is the environment ruled out: a single silent shell
                // does not prove that the pseudoconsole itself is gone.
                if env_failed {
                    super::set_conpty_unavailable();
                }
            }

            // Pipe fallback: the user's shell still gets to run, with the
            // console duties the host has to take over. If that shell cannot
            // start at all, walk the same chain the PTY path used instead of
            // retrying a missing image (which would fail the whole spawn).
            let pipe_shell = candidates
                .iter()
                .cloned()
                .chain(std::iter::once(cmd.clone()))
                .find(|s| {
                    !super::is_broken(&s.name)
                        && !s.path.is_empty()
                        && Path::new(&s.path).is_file()
                })
                .unwrap_or_else(|| primary.clone());
            let mut pipe_note = format!(
                "PTY unavailable — {} runs in pipe mode: no ANSI colors from the shell itself, no full-screen programs, one command per line",
                pipe_shell.name
            );
            if !notes.is_empty() {
                pipe_note = format!("{} ({})", pipe_note, notes.join("; "));
            }
            let session = pipe_spawn(instance, root, &pipe_shell, bus.clone())?;
            let mut s = session;
            s.note = pipe_note;
            Ok(s)
        }

        pub fn write(&self, data: &[u8]) -> Result<(), String> {
            if self.torn_down.load(Ordering::SeqCst) {
                return Err("terminal closed".into());
            }
            match &self.inner {
                Inner::Pty { input, .. } => unsafe {
                    let mut written: u32 = 0;
                    let ok = WriteFile(
                        input.0,
                        data.as_ptr(),
                        data.len() as u32,
                        &mut written,
                        std::ptr::null_mut(),
                    );
                    if ok != TRUE {
                        return Err(format!("WriteFile failed: {}", GetLastError()));
                    }
                    Ok(())
                },
                Inner::Pipe { pipe } => pipe.write(data),
            }
        }

        pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
            if self.torn_down.load(Ordering::SeqCst) {
                return Err("terminal closed".into());
            }
            match &self.inner {
                Inner::Pty { hpc, .. } => {
                    let (cols, rows) = clamp_size(cols, rows);
                    let hr = unsafe {
                        ResizePseudoConsole(hpc.0 as HPCON, COORD { X: cols as i16, Y: rows as i16 })
                    };
                    if hr < 0 {
                        return Err(format!("ResizePseudoConsole failed: 0x{hr:08x}"));
                    }
                    Ok(())
                }
                Inner::Pipe { .. } => Ok(()), // pipes have no window size
            }
        }

        /// Ctrl+C: kill the shell's descendants (the foreground command) and
        /// leave the shell — and therefore its cwd — alive. Writing 0x03 to the
        /// ConPTY input pipe is not delivered as CTRL_C_EVENT here (it lands in
        /// the line buffer as text), so this is the honest implementation.
        pub fn interrupt(&self) -> Result<u32, String> {
            if self.torn_down.load(Ordering::SeqCst) {
                return Err("terminal closed".into());
            }
            let kids = descendants(self.pid)?;
            if kids.is_empty() {
                // Pipe shells have no console: the byte is the only fallback.
                if matches!(self.inner, Inner::Pipe { .. }) {
                    self.write(b"\x03")?;
                }
                return Ok(0);
            }
            // Deepest first: a grandchild holds the console read loop.
            let killed = kids.len() as u32;
            for pid in kids.into_iter().rev() {
                unsafe {
                    let h = OpenProcess(PROCESS_TERMINATE, 0, pid);
                    if !h.is_null() {
                        TerminateProcess(h, 1);
                        CloseHandle(h);
                    }
                }
            }
            Ok(killed)
        }

        pub fn shutdown(&self) {
            if self.torn_down.swap(true, Ordering::SeqCst) {
                return;
            }
            match &self.inner {
                Inner::Pty { input, output, hpc, process } => unsafe {
                    TerminateProcess(process.0, 0);
                    CloseHandle(process.0);
                    CloseHandle(input.0);
                    // Close the PTY before the pipes: conhost exits, the output
                    // pipe's write end drops, and the reader sees EOF on its own.
                    ClosePseudoConsole(hpc.0 as HPCON);
                    CloseHandle(output.0);
                },
                Inner::Pipe { pipe } => pipe.shutdown(),
            }
        }
    }

    fn pty_spawn(
        instance: u32,
        root: PathBuf,
        cols: u16,
        rows: u16,
        shell: &ShellInfo,
        bus: Bus,
        budget: std::time::Duration,
    ) -> Result<TermSession, PtyFailure> {
        let (cols, rows) = clamp_size(cols, rows);
        unsafe {
            let mut input_read: HANDLE = std::ptr::null_mut();
            let mut input_write: HANDLE = std::ptr::null_mut();
            let mut output_read: HANDLE = std::ptr::null_mut();
            let mut output_write: HANDLE = std::ptr::null_mut();
            let sa = SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: std::ptr::null_mut(),
                bInheritHandle: 0,
            };
            if CreatePipe(&mut input_read, &mut input_write, &sa, 0) != TRUE {
                return Err(PtyFailure::NoConPty(format!(
                    "CreatePipe(input) failed: {}",
                    GetLastError()
                )));
            }
            if CreatePipe(&mut output_read, &mut output_write, &sa, 0) != TRUE {
                CloseHandle(input_read);
                CloseHandle(input_write);
                return Err(PtyFailure::NoConPty(format!(
                    "CreatePipe(output) failed: {}",
                    GetLastError()
                )));
            }

            let mut hpc: HPCON = 0;
            let hr = CreatePseudoConsole(
                COORD { X: cols as i16, Y: rows as i16 },
                input_read,
                output_write,
                0,
                &mut hpc,
            );
            if hr < 0 {
                CloseHandle(input_read);
                CloseHandle(output_write);
                CloseHandle(input_write);
                CloseHandle(output_read);
                return Err(PtyFailure::NoConPty(format!(
                    "CreatePseudoConsole failed: 0x{hr:08x}"
                )));
            }

            let mut si: STARTUPINFOEXW = std::mem::zeroed();
            si.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
            // Without this, a host whose own stdio is redirected (a pipe, a log
            // file, `cargo test`) has those handles copied into the child, so the
            // shell writes there instead of into the pseudoconsole: the tab shows
            // a blank screen while typing goes nowhere. Declaring the three
            // handles explicitly — all null — stops the copy and lets conhost
            // wire them to the pseudo console.
            si.StartupInfo.dwFlags |= STARTF_USESTDHANDLES;
            let mut size: usize = 0;
            InitializeProcThreadAttributeList(std::ptr::null_mut(), 1, 0, &mut size);
            // PROC_THREAD_ATTRIBUTE_LIST must be MEMORY_ALLOCATION_ALIGNMENT (16) aligned.
            let attr_layout = std::alloc::Layout::from_size_align(size.max(1), 16).unwrap();
            let attr_ptr = std::alloc::alloc_zeroed(attr_layout);
            let attr_list = attr_ptr as LPPROC_THREAD_ATTRIBUTE_LIST;
            if InitializeProcThreadAttributeList(attr_list, 1, 0, &mut size) != TRUE {
                std::alloc::dealloc(attr_ptr, attr_layout);
                CloseHandle(input_read);
                CloseHandle(output_write);
                ClosePseudoConsole(hpc);
                CloseHandle(input_write);
                CloseHandle(output_read);
                return Err(PtyFailure::NoConPty(format!(
                    "InitializeProcThreadAttributeList failed: {}",
                    GetLastError()
                )));
            }
            if UpdateProcThreadAttribute(
                attr_list,
                0,
                PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE as usize,
                // The attribute value is the HPCON itself, not its address. Passing
                // &hpc hands conhost an invalid handle, so every shell dies during
                // console init with 0xC0000142.
                hpc as *const c_void,
                std::mem::size_of::<HPCON>(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            ) != TRUE
            {
                DeleteProcThreadAttributeList(attr_list);
                std::alloc::dealloc(attr_ptr, attr_layout);
                CloseHandle(input_read);
                CloseHandle(output_write);
                ClosePseudoConsole(hpc);
                CloseHandle(input_write);
                CloseHandle(output_read);
                return Err(PtyFailure::NoConPty(format!(
                    "UpdateProcThreadAttribute failed: {}",
                    GetLastError()
                )));
            }
            si.lpAttributeList = attr_list;

            let mut cmdline = wide(&format!("\"{}\"", shell.path));
            if shell.name == "cmd" {
                // UTF-8 output: the console code page is OEM (e.g. GBK) and the
                // reader decodes UTF-8, so without this all non-ASCII text is
                // mojibake.
                cmdline = wide(&format!("\"{}\" /K \"chcp 65001>nul\"", shell.path));
            } else if shell.name == "powershell" || shell.name == "pwsh" {
                // No profile: an embedded terminal must not depend on (or be
                // broken by) the user's PowerShell profile.
                cmdline = wide(&format!("\"{}\" -NoLogo -NoProfile", shell.path));
            }
            let cwd = wide(&root.to_string_lossy());
            let mut pi: PROCESS_INFORMATION = std::mem::zeroed();
            let ok = CreateProcessW(
                std::ptr::null(),
                cmdline.as_mut_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                0,
                // EXTENDED_STARTUPINFO_PRESENT alone: the pseudoconsole attribute is what
                // attaches conhost. Adding CREATE_NO_WINDOW here makes conhost skip
                // initialization, so the child never paints (no output, no colors).
                EXTENDED_STARTUPINFO_PRESENT,
                std::ptr::null(),
                cwd.as_ptr(),
                &si.StartupInfo,
                &mut pi,
            );
            DeleteProcThreadAttributeList(attr_list);
            std::alloc::dealloc(attr_ptr, attr_layout);
            if ok != TRUE {
                let err = GetLastError();
                CloseHandle(input_read);
                CloseHandle(output_write);
                ClosePseudoConsole(hpc);
                CloseHandle(input_write);
                CloseHandle(output_read);
                return Err(PtyFailure::ShellMissing(format!("CreateProcessW failed: {err}")));
            }
            CloseHandle(pi.hThread);
            // Close the PTY-owned ends only after the child has been created.
            CloseHandle(input_read);
            CloseHandle(output_write);

            // Probe for the first paint. A hosted process that fails DLL init
            // (0xC0000142) can stay "alive" while a modal system dialog blocks
            // it, so an exit-only probe is not enough: no output within the
            // window means the session is unusable → kill it (this also closes
            // the dialog) and let the caller fall back.
            //
            // conhost paints the first frame on its own (cmd within ~0.4 s),
            // so a nudge straight away would only cost every session a
            // duplicated prompt. Older builds wait for input; the nudge is
            // therefore sent only when the paint is late.
            let started = std::time::Instant::now();
            let deadline = started + budget;
            let mut first_paint = false;
            let mut nudged = false;
            let mut peek_buf = [0u8; 1];
            let mut exited: Option<u32> = None;
            loop {
                let mut avail: u32 = 0;
                let mut got: u32 = 0;
                if PeekNamedPipe(
                    output_read,
                    peek_buf.as_mut_ptr() as *mut c_void,
                    1,
                    &mut got,
                    &mut avail,
                    std::ptr::null_mut(),
                ) != TRUE
                {
                    eprintln!("[term] PeekNamedPipe failed: {}", GetLastError());
                    break; // pipe closed
                }
                if avail > 0 {
                    first_paint = true;
                    break;
                }
                if WaitForSingleObject(pi.hProcess, 0) != WAIT_TIMEOUT {
                    let mut code: u32 = 0;
                    windows_sys::Win32::System::Threading::GetExitCodeProcess(pi.hProcess, &mut code);
                    exited = Some(code);
                    break;
                }
                if !nudged && started.elapsed() >= NUDGE_AFTER {
                    let mut cr_written: u32 = 0;
                    WriteFile(
                        input_write,
                        b"\r".as_ptr(),
                        1,
                        &mut cr_written,
                        std::ptr::null_mut(),
                    );
                    nudged = true;
                }
                if std::time::Instant::now() >= deadline {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            if !first_paint {
                TerminateProcess(pi.hProcess, 0);
                CloseHandle(pi.hProcess);
                ClosePseudoConsole(hpc);
                CloseHandle(input_write);
                CloseHandle(output_read);
                return Err(match exited {
                    // The child died on its own inside the pseudoconsole: the
                    // binary may still be fine over a pipe.
                    Some(code) => PtyFailure::ShellUnderPty(format!(
                        "{} exited with 0x{code:08x}",
                        shell.name
                    )),
                    // Alive but silent: the pseudoconsole itself never painted.
                    None => PtyFailure::NoConPty(format!(
                        "{} produced no output within {} ms",
                        shell.name,
                        budget.as_millis()
                    )),
                });
            }

            let done_emitted = Arc::new(AtomicBool::new(false));
            let session = TermSession {
                inner: Inner::Pty {
                    input: SendHandle(input_write),
                    output: SendHandle(output_read),
                    hpc: SendHandle(hpc as HANDLE),
                    process: SendHandle(pi.hProcess),
                },
                torn_down: AtomicBool::new(false),
                shell: shell.name.clone(),
                path: shell.path.clone(),
                kind: "pty",
                note: String::new(),
                pid: pi.dwProcessId,
            };

            // Reader thread: drain the PTY output until EOF/error.
            let out = SendHandle(output_read);
            let done_flag = done_emitted;
            std::thread::spawn(move || {
                // Capture the whole SendHandle (Send), not the raw field.
                let _ = &out;
                let mut buf = [0u8; 4096];
                loop {
                    let mut n: u32 = 0;
                    let ok = ReadFile(
                        out.0,
                        buf.as_mut_ptr(),
                        buf.len() as u32,
                        &mut n,
                        std::ptr::null_mut(),
                    );
                    if ok != TRUE || n == 0 {
                        break;
                    }
                    let data = String::from_utf8_lossy(&buf[..n as usize]).to_string();
                    bus.emit("io", json!({ "type": "term.output", "instance": instance, "data": data }));
                }
                if !done_flag.swap(true, Ordering::SeqCst) {
                    bus.emit("io", json!({ "type": "term.done", "instance": instance, "code": 0 }));
                }
            });

            Ok(session)
        }
    }

    /// Spawn the requested shell without a console.
    ///
    /// cmd.exe reads commands from a pipe line by line and prints a prompt, so
    /// it works as it is. PowerShell cannot (its redirected-stdin reader
    /// prefixes every line with U+FEFF), so it is hosted through the UTF-8
    /// REPL bootstrap, which also gives the session a prompt.
    pub fn pipe_spawn(
        instance: u32,
        root: PathBuf,
        shell: &ShellInfo,
        bus: Bus,
    ) -> Result<TermSession, String> {
        let mut cmd = Command::new(&shell.path);
        let wire = match shell.name.as_str() {
            "powershell" | "pwsh" => {
                cmd.arg("-NoLogo")
                    .arg("-NoProfile")
                    .arg("-File")
                    .arg(repl_script_path());
                Wire::Utf8
            }
            _ => {
                cmd.arg("/Q");
                Wire::Oem
            }
        };
        apply_color_env(&mut cmd);
        let mut child = cmd
            .current_dir(&root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("pipe spawn failed: {e}"))?;
        let input = child.stdin.take().ok_or("no stdin")?;
        let pid = child.id();
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stderr = child.stderr.take();
        let session = TermSession {
            inner: Inner::Pipe {
                pipe: PipeSession::new(child, input, bus.clone(), instance, wire),
            },
            torn_down: AtomicBool::new(false),
            shell: shell.name.clone(),
            path: shell.path.clone(),
            kind: "pipe",
            note: String::new(),
            pid,
        };
        pump_stdout(instance, stdout, wire, bus.clone());
        if let Some(stderr) = stderr {
            pump_stderr(instance, stderr, wire, bus.clone());
        }
        Ok(session)
    }

    fn pump_stdout(instance: u32, mut stdout: ChildStdout, wire: Wire, bus: Bus) {
        std::thread::spawn(move || {
            let mut codec = Codec::new(wire);
            let mut buf = [0u8; 4096];
            loop {
                match stdout.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let data = codec.decode(&buf[..n]);
                        if !data.is_empty() {
                            bus.emit(
                                "io",
                                json!({ "type": "term.output", "instance": instance, "data": data }),
                            );
                        }
                    }
                }
            }
        });
    }

    fn pump_stderr(instance: u32, mut stderr: ChildStderr, wire: Wire, bus: Bus) {
        std::thread::spawn(move || {
            let mut codec = Codec::new(wire);
            let mut buf = [0u8; 4096];
            loop {
                match stderr.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let data = codec.decode(&buf[..n]);
                        if !data.is_empty() {
                            bus.emit(
                                "io",
                                json!({ "type": "term.output", "instance": instance, "data": data }),
                            );
                        }
                    }
                }
            }
        });
    }
}

// ---------------------------------------------------------------------------
// Non-Windows fallback
// ---------------------------------------------------------------------------

// ponytail: pipe-based fallback, not a real PTY. Shipping target is Windows;
// colors and job control are not guaranteed here.
#[cfg(not(windows))]
mod imp {
    use super::*;
    use std::io::{Read, Write};
    use std::process::{Command, Stdio};

    pub struct TermSession {
        pipe: PipeSession,
        pub torn_down: AtomicBool,
        pub shell: String,
        pub path: String,
        pub kind: &'static str,
        pub note: String,
    }

    impl TermSession {
        pub fn spawn(
            instance: u32,
            root: PathBuf,
            _cols: u16,
            _rows: u16,
            candidates: &[ShellInfo],
            bus: Bus,
        ) -> Result<Self, String> {
            let shell = candidates.first().cloned().unwrap_or_else(|| ShellInfo {
                name: "sh".into(),
                path: std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into()),
                kind: "pipe",
                note: String::new(),
            });
            let shell_path = if Path::new(&shell.path).exists() {
                shell.path.clone()
            } else {
                std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
            };
            let mut child = Command::new(&shell_path)
                .arg("-i")
                .current_dir(&root)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("spawn failed: {e}"))?;
            let input = child.stdin.take().ok_or("no stdin")?;
            let mut stdout = child.stdout.take().ok_or("no stdout")?;
            let stderr = child.stderr.take();
            let pid = child.id();
            let name = if shell.path == shell_path { shell.name.clone() } else { "sh".into() };
            let session = Self {
                pipe: PipeSession::new(child, input, bus.clone(), instance, Wire::Utf8),
                torn_down: AtomicBool::new(false),
                shell: name,
                path: shell_path,
                kind: "pipe",
                note: "no pseudoconsole on this platform — pipe mode".to_string(),
                pid,
            };
            let done = Arc::new(AtomicBool::new(false));
            let bus2 = bus.clone();
            std::thread::spawn(move || {
                let mut codec = Codec::new(Wire::Utf8);
                let mut buf = [0u8; 4096];
                loop {
                    match stdout.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            let data = codec.decode(&buf[..n]);
                            if !data.is_empty() {
                                bus2.emit(
                                    "io",
                                    json!({ "type": "term.output", "instance": instance, "data": data }),
                                );
                            }
                        }
                    }
                }
                if !done.swap(true, Ordering::SeqCst) {
                    bus.emit("io", json!({ "type": "term.done", "instance": instance, "code": 0 }));
                }
            });
            if let Some(mut stderr) = stderr {
                let bus2 = bus.clone();
                std::thread::spawn(move || {
                    let mut codec = Codec::new(Wire::Utf8);
                    let mut buf = [0u8; 4096];
                    loop {
                        match stderr.read(&mut buf) {
                            Ok(0) | Err(_) => break,
                            Ok(n) => {
                                let data = codec.decode(&buf[..n]);
                                if !data.is_empty() {
                                    bus2.emit(
                                        "io",
                                        json!({ "type": "term.output", "instance": instance, "data": data }),
                                    );
                                }
                            }
                        }
                    }
                });
            }
            Ok(session)
        }

        pub fn write(&self, data: &[u8]) -> Result<(), String> {
            if self.torn_down.load(Ordering::SeqCst) {
                return Err("terminal closed".into());
            }
            self.pipe.write(data)
        }

        pub fn resize(&self, _cols: u16, _rows: u16) -> Result<(), String> {
            Ok(()) // pipes have no window size
        }

        /// A piped shell has no console to interrupt; 0x03 is the best effort.
        pub fn interrupt(&self) -> Result<u32, String> {
            self.write(b"\x03")?;
            Ok(0)
        }

        pub fn shutdown(&self) {
            if self.torn_down.swap(true, Ordering::SeqCst) {
                return;
            }
            self.pipe.shutdown();
        }
    }

    pub fn oem_to_utf8(bytes: &[u8]) -> String {
        String::from_utf8_lossy(bytes).to_string()
    }

    pub fn utf8_to_oem(text: &str) -> Vec<u8> {
        text.as_bytes().to_vec()
    }
}

use imp::TermSession;

fn clamp_size(cols: u16, rows: u16) -> (u16, u16) {
    (cols.clamp(20, 400), rows.clamp(5, 200))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_parse() {
        assert_eq!(ShellProfile::parse("pwsh"), ShellProfile::Pwsh);
        assert_eq!(ShellProfile::parse("powershell"), ShellProfile::PowerShell);
        assert_eq!(ShellProfile::parse("cmd"), ShellProfile::Cmd);
        assert_eq!(ShellProfile::parse("anything"), ShellProfile::Auto);
    }

    #[test]
    fn size_clamped() {
        assert_eq!(clamp_size(1, 1), (20, 5));
        assert_eq!(clamp_size(9999, 9999), (400, 200));
        assert_eq!(clamp_size(80, 24), (80, 24));
    }

    #[test]
    fn explicit_profile_resolves_to_that_shell() {
        let chain = resolve_shell(ShellProfile::Cmd);
        assert_eq!(chain.len(), 1);
        assert_eq!(chain[0].name, "cmd");
        assert!(Path::new(&chain[0].path).exists());
    }

    #[test]
    fn auto_profile_prefers_pwsh_then_powershell() {
        let chain = resolve_shell(ShellProfile::Auto);
        let names: Vec<&str> = chain.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"cmd"), "cmd is the last resort: {names:?}");
        if names.first() == Some(&"pwsh") {
            assert_eq!(names.get(1), Some(&"powershell"));
        }
    }

    #[test]
    fn echo_splits_typed_text_from_shell_bytes() {
        let mut echo = EchoState::default();
        let (forward, shown) = echo.split(b"echo hi");
        assert_eq!(shown, "echo hi");
        assert_eq!(forward, b"echo hi".to_vec());

        let (forward, shown) = echo.split(b"\r");
        assert_eq!(shown, "\r\n");
        assert_eq!(forward, b"\n".to_vec());
    }

    #[test]
    fn echo_handles_backspace() {
        let mut echo = EchoState::default();
        let (_, shown) = echo.split(b"abc");
        assert_eq!(shown, "abc");
        let (forward, shown) = echo.split(b"\x7f");
        // "abc" is already on screen; only erase the last column here.
        assert_eq!(shown, "\u{8} \u{8}");
        // The shell still receives the delete byte.
        assert_eq!(forward, vec![0x7f]);
        let (_, shown) = echo.split(b"d");
        assert_eq!(shown, "d");
    }

    #[test]
    fn echo_keeps_multibyte_characters_intact() {
        let mut echo = EchoState::default();
        let (forward, shown) = echo.split("中".as_bytes());
        assert_eq!(shown, "中");
        assert_eq!(forward, "中".as_bytes().to_vec());
    }

    #[test]
    fn echo_carries_split_multibyte_sequences() {
        let mut echo = EchoState::default();
        let bytes = "中".as_bytes();
        let (forward, shown) = echo.split(&bytes[..1]);
        assert!(shown.is_empty());
        assert!(forward.is_empty());
        let (forward, shown) = echo.split(&bytes[1..]);
        assert_eq!(shown, "中");
        assert_eq!(forward, bytes.to_vec());
    }

    #[test]
    fn utf8_codec_carries_split_sequences() {
        let mut codec = Codec::new(Wire::Utf8);
        let bytes = "中".as_bytes();
        assert_eq!(codec.decode(&bytes[..1]), "");
        assert_eq!(codec.decode(&bytes[1..]), "中");
    }

    #[test]
    fn utf8_codec_strips_bom() {
        let mut codec = Codec::new(Wire::Utf8);
        assert_eq!(codec.decode(b"\xef\xbb\xbfhello"), "hello");
    }

    #[test]
    fn oem_codec_strips_a_utf8_bom() {
        let mut codec = Codec::new(Wire::Oem);
        // cmd.exe prefixes its error text with a UTF-8 BOM.
        assert_eq!(codec.decode(b"\xef\xbb\xbfplain"), "plain");
    }

    #[test]
    fn oem_codec_waits_for_a_split_bom() {
        let mut codec = Codec::new(Wire::Oem);
        assert_eq!(codec.decode(b"\xef\xbb"), "");
        assert_eq!(codec.decode(b"\xbfplain"), "plain");
    }

    #[test]
    #[cfg(windows)]
    fn conpty_echo_roundtrip() {
        let bus = Bus::new();
        let rx = bus.subscribe();
        let reg = TermRegistry::new();
        let root = std::env::temp_dir();
        let info = reg
            .open(999, root, 80, 24, ShellProfile::Cmd, bus.clone())
            .expect("open terminal");
        assert!(!info.name.is_empty());
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        let mut all = String::new();
        let mut wrote = false;
        let mut seen = false;
        while std::time::Instant::now() < deadline {
            match rx.recv_timeout(std::time::Duration::from_millis(200)) {
                Ok(frame) => {
                    all.push_str(&frame);
                    all.push('\n');
                    // Wait until the shell is actually up before typing.
                    if !wrote && frame.contains("term.output") {
                        reg.write(999, b"echo PTY_PROBE\r").expect("write");
                        wrote = true;
                    }
                    if wrote && frame.contains("PTY_PROBE") && frame.contains("term.output") {
                        seen = true;
                        break;
                    }
                }
                Err(_) => continue,
            }
        }
        reg.kill(999);
        assert!(seen, "never saw PTY_PROBE in term.output; frames:\n{all}");
        assert!(reg.write(999, b"x").is_err(), "write after kill must fail");
    }

    #[test]
    #[cfg(windows)]
    fn pipe_session_echoes_and_runs_the_requested_shell() {
        let bus = Bus::new();
        let rx = bus.subscribe();
        let reg = TermRegistry::new();
        let info = reg
            .open(997, std::env::temp_dir(), 80, 24, ShellProfile::Cmd, bus.clone())
            .expect("open terminal");
        // Without a pseudoconsole this is the degraded path; with one it is a
        // real PTY. Either way the shell has to run the command.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        let mut all = String::new();
        let mut wrote = false;
        let mut ran = false;
        while std::time::Instant::now() < deadline {
            match rx.recv_timeout(std::time::Duration::from_millis(200)) {
                Ok(frame) => {
                    all.push_str(&frame);
                    if !wrote && frame.contains("term.output") {
                        reg.write(997, b"echo PIPE_PROBE\r").expect("write");
                        wrote = true;
                    }
                    if wrote && frame.contains("PIPE_PROBE") {
                        ran = true;
                        break;
                    }
                }
                Err(_) => continue,
            }
        }
        reg.kill(997);
        assert!(ran, "the shell never ran the command; frames:\n{all}");
        if info.kind == "pipe" {
            assert!(!info.note.is_empty(), "a degraded session must explain itself");
        }
    }

    #[test]
    #[cfg(windows)]
    fn a_shell_that_cannot_run_under_conpty_is_reported() {
        // An environment restriction can make one shell fail console init inside
        // a pseudoconsole. The PTY path must skip that shell, say so, and still
        // hand the user a working terminal (cmd).
        super::mark_pty_broken("powershell");
        let bus = Bus::new();
        let reg = TermRegistry::new();
        let info = reg
            .open(996, std::env::temp_dir(), 80, 24, ShellProfile::PowerShell, bus)
            .expect("open terminal");
        assert_eq!(info.name, "cmd", "the PTY path retries cmd instead of the broken shell");
        assert!(
            info.note.contains("powershell"),
            "the degradation must be reported: {:?}",
            info.note
        );
        reg.kill(996);
    }

    #[test]
    #[cfg(windows)]
    fn the_pipe_fallback_runs_the_requested_shell() {
        // A shell that cannot be hosted by a pseudoconsole is still the user's
        // choice: the pipe fallback must run it instead of switching to cmd.exe.
        let shell = resolve_shell(ShellProfile::PowerShell)
            .into_iter()
            .next()
            .expect("powershell is installed");
        let bus = Bus::new();
        let rx = bus.subscribe();
        let session = imp::pipe_spawn(995, std::env::temp_dir(), &shell, bus).expect("pipe session");
        assert_eq!(session.shell, "powershell");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        let mut wrote = false;
        let mut ran = false;
        while std::time::Instant::now() < deadline {
            match rx.recv_timeout(std::time::Duration::from_millis(200)) {
                Ok(frame) => {
                    if !wrote && frame.contains("term.output") {
                        session.write(b"echo PIPE_PROBE\r").expect("write");
                        wrote = true;
                    }
                    if wrote && frame.contains("PIPE_PROBE") {
                        ran = true;
                        break;
                    }
                }
                Err(_) => continue,
            }
        }
        session.shutdown();
        assert!(ran, "the pipe fallback never ran the command");
    }

    #[test]
    #[cfg(windows)]
    fn missing_shell_falls_back_to_cmd() {
        let bus = Bus::new();
        let bad = ShellInfo {
            name: "nope".into(),
            path: "C:\\pristem-no-such-shell\\nope.exe".into(),
            kind: "pty",
            note: String::new(),
        };
        // CreateProcessW fails for a missing image, so the retry chain has to
        // land on a live session (ConPTY + cmd, or the pipe fallback).
        let s = TermSession::spawn(4242, std::env::temp_dir(), 80, 24, &[bad], bus)
            .expect("fallback session");
        assert_eq!(s.shell, "cmd");
        s.shutdown();
    }

    #[test]
    #[cfg(windows)]
    fn conpty_resize_and_kill() {
        let bus = Bus::new();
        let reg = TermRegistry::new();
        reg.open(998, std::env::temp_dir(), 80, 24, ShellProfile::Cmd, bus)
            .expect("open");
        reg.resize(998, 120, 30).expect("resize");
        reg.kill(998);
        assert!(reg.write(998, b"x").is_err());
        reg.kill(998); // idempotent
    }
}
