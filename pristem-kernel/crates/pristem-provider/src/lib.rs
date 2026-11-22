//! # pristem-provider — BYOK model access (§9).
//!
//! N5: **no bundled model access, no free tier**. Keys come only from the environment
//! (or an explicit runtime override), never from conversation content.
//!
//! Built-in trio: OpenAI **Chat Completions**, OpenAI **Responses**, Anthropic
//! **Messages**. Each adapter implements the four-tuple: request / response / streaming /
//! tool-call mapping, and auto-fills the thinking-visibility field (full / summary / none).
//!
//! **Provider IS a plugin** `[TA]`: the built-ins are merely adapters shipped by default,
//! mounted through `pristem-plugin` at `ProviderAdapter` (one of the three in-process
//! allowlisted mount points). See `registry::install_builtins`.

pub mod adapters;
pub mod registry;
pub mod transport;
pub mod types;

pub use adapters::{AnthropicAdapter, OpenAiChatAdapter, OpenAiResponsesAdapter};
pub use registry::{
    install_builtins, ProviderConfig, ProviderEndpoint, ProviderInfo, ProviderRegistry,
    ANTHROPIC_MESSAGES, OPENAI_CHAT, OPENAI_RESPONSES,
};
pub use transport::{CurlTransport, HttpRequest, HttpResponse, StubTransport, Transport};
pub use types::{
    Adapter, AdapterCaps, AdapterProvider, BoxFuture, CompletionRequest, CompletionResponse,
    EndpointTuning, Message, Provider, ProviderError, Role, StreamChunk, StreamTracker,
    ThinkingPayload, ThinkingVisibility, ToolDescriptor, Usage,
};
