//! # pristem-ipc — one protocol, both clients (§10).
//!
//! Session open/close, mode switch, round streaming (`speech` / `call` / `result` /
//! `answer`), REMINDER presentation, and button / confirmation round-trips. CLI renders
//! the buttons as mouse-clickable ANSI/ESC OSC 8 hyperlinks; desktop renders real buttons.
//!
//! `ipc` knows `core`; nothing in `core` knows `ipc`. The kernel is client-agnostic — it
//! never sees a client identifier, so CLI and desktop have zero capability difference
//! `[TA §13.1]`. The three CLI modes are a menu the CLI draws for itself.

pub mod events;
pub mod server;

pub use events::{ButtonSpec, ClientKind, ClientRequest, ServerEvent};
pub use server::{ClientConnection, IpcError, IpcServer};

/// Wire-format version. `[CHURN: event schema]` — bump when the tagged enums change.
/// v0.4 adds `ServerEvent::Usage` and a `session` field on `ServerEvent::Error`.
pub const PROTOCOL_VERSION: &str = "pristem.ipc/v0.4";
