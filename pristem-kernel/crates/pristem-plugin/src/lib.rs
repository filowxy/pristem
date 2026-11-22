//! # pristem-plugin — the plugin host and its per-mount-point permission spectrum (§9).
//!
//! Post-12:50 redesign: a **spectrum, not tiers**. Each mount point sits independently on
//! an `in-process ↔ out-of-process ↔ forbidden` continuum. The policy is a floor on how
//! far out the plugin must stay; mounting farther out is always allowed.
//!
//! Ratified `[TA]`: in-process is reserved for provider adapters, language analyzers
//! (tree-sitter wrappers) and encoders. The round loop, defense pipeline, answer gate,
//! sig DB, SOLO.md channel and archive writes are **sealed** — plugins may add senses and
//! tools, never a soul. Those points are hard-coded forbidden and cannot be loosened by
//! config, which is why `MountPolicy::validate` is called by the host on construction.
//!
//! Speed accounting: only provider adaptation and text scanning are hot paths; tool-class
//! calls are round-granular (ms-level IPC is noise there).

pub mod host;
pub mod mount;

pub use host::{PluginHost, PluginHostError};
pub use mount::{
    Isolation, MountPoint, MountPolicy, MountRule, Plugin, PluginDescriptor, IN_PROCESS_ALLOWLIST,
};
