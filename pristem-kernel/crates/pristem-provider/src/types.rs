//! Provider wire types, the four-tuple adapter trait, and the `Provider` trait.
//!
//! `[CHURN]` the model-facing wire protocol is expected to change; the kernel only ever
//! sees `CompletionRequest` / `CompletionResponse`, so a protocol swap stays inside this
//! crate.

use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;

pub use pristem_defense::ToolCall;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc::UnboundedSender;

use crate::registry::ProviderConfig;
use crate::transport::{HttpRequest, HttpResponse, Transport};

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    System,
    #[default]
    User,
    Assistant,
    Tool,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::User => "user",
            Self::Assistant => "assistant",
            Self::Tool => "tool",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

impl Message {
    pub fn new(role: Role, content: impl Into<String>) -> Self {
        Self {
            role,
            content: content.into(),
            name: None,
        }
    }
    pub fn system(content: impl Into<String>) -> Self {
        Self::new(Role::System, content)
    }
    pub fn user(content: impl Into<String>) -> Self {
        Self::new(Role::User, content)
    }
    pub fn assistant(content: impl Into<String>) -> Self {
        Self::new(Role::Assistant, content)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolDescriptor {
    pub name: String,
    pub description: String,
    pub arguments: Vec<String>,
}

/// Per-endpoint tuning that is not part of the legacy single-provider fields.
/// `None` means "not configured"; the loop then keeps its previous behaviour.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct EndpointTuning {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f32>,
    /// Value sent under `reasoning_param` (e.g. `high`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    /// Wire field carrying the effort value; defaults to `reasoning_effort`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_param: Option<String>,
    /// Input-context budget used to trim history before a request.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u32>,
    /// Per-endpoint tool-round cap; falls back to `KernelConfig::max_rounds`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tool_rounds: Option<usize>,
    /// Declared model capability, surfaced to clients.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_images: Option<bool>,
}

impl EndpointTuning {
    /// Endpoint fields win; unset endpoint fields inherit the global defaults.
    pub fn merged_with(&self, fallback: &Self) -> Self {
        Self {
            top_p: self.top_p.or(fallback.top_p),
            reasoning_effort: self
                .reasoning_effort
                .clone()
                .or_else(|| fallback.reasoning_effort.clone()),
            reasoning_param: self
                .reasoning_param
                .clone()
                .or_else(|| fallback.reasoning_param.clone()),
            context_window: self.context_window.or(fallback.context_window),
            max_tool_rounds: self.max_tool_rounds.or(fallback.max_tool_rounds),
            supports_images: self.supports_images.or(fallback.supports_images),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CompletionRequest {
    pub model: String,
    pub messages: Vec<Message>,
    #[serde(default)]
    pub tools: Vec<ToolDescriptor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_param: Option<String>,
    #[serde(default)]
    pub stream: bool,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
}

fn default_max_tokens() -> u32 {
    4096
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ThinkingVisibility {
    Full,
    Summary,
    #[default]
    None,
}

/// Auto-filled by the adapter, never by the model. `Full` only for adapters that expose
/// raw thinking blocks, `Summary` for ones that expose a summary, `None` otherwise.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThinkingPayload {
    pub visibility: ThinkingVisibility,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

impl Default for ThinkingPayload {
    fn default() -> Self {
        Self {
            visibility: ThinkingVisibility::None,
            text: None,
            summary: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    #[serde(default)]
    pub cached_tokens: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CompletionResponse {
    pub text: String,
    #[serde(default)]
    pub tool_calls: Vec<ToolCall>,
    #[serde(default)]
    pub thinking: ThinkingPayload,
    #[serde(default)]
    pub usage: Usage,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_id: Option<String>,
}

impl CompletionResponse {
    pub fn plain(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            tool_calls: Vec::new(),
            thinking: ThinkingPayload::default(),
            usage: Usage::default(),
            raw_id: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StreamChunk {
    pub delta: String,
    pub done: bool,
    #[serde(default)]
    pub tool_calls: Vec<ToolCall>,
}

impl StreamChunk {
    pub fn delta(s: impl Into<String>) -> Self {
        Self {
            delta: s.into(),
            done: false,
            tool_calls: Vec::new(),
        }
    }
    pub fn done() -> Self {
        Self {
            delta: String::new(),
            done: true,
            tool_calls: Vec::new(),
        }
    }
}

/// Static capability declaration. `thinking_visibility` is auto-filled here — a caller
/// never guesses it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AdapterCaps {
    pub thinking_visibility: ThinkingVisibility,
    pub streaming: bool,
    pub native_tool_calls: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("BYOK: no API key found. Set {0} (no bundled model access, no free tier)")]
    MissingApiKey(String),
    #[error("transport error: {0}")]
    Transport(String),
    #[error("provider returned HTTP {0}: {1}")]
    Http(u16, String),
    #[error("malformed provider response for {0}: {1}")]
    Malformed(&'static str, String),
    #[error("json error: {0}")]
    Json(String),
    #[error("unsupported operation: {0}")]
    Unsupported(String),
    #[error("plugin host rejected provider: {0}")]
    Plugin(String),
}

impl From<serde_json::Error> for ProviderError {
    fn from(e: serde_json::Error) -> Self {
        Self::Json(e.to_string())
    }
}

/// The four-tuple. One implementation per wire protocol; swapping a protocol never
/// touches the agent loop.
pub trait Adapter: Send + Sync {
    fn name(&self) -> &str;
    fn caps(&self) -> AdapterCaps;
    fn map_request(
        &self,
        req: &CompletionRequest,
        cfg: &ProviderConfig,
    ) -> Result<HttpRequest, ProviderError>;
    fn map_response(&self, resp: &HttpResponse) -> Result<CompletionResponse, ProviderError>;
    /// Text-only view of one SSE line. Kept separate from [`StreamTracker`] so the wire
    /// shape can be asserted line by line in tests.
    fn map_stream_chunk(&self, line: &str) -> Result<Option<StreamChunk>, ProviderError>;
    fn map_tool_calls(&self, value: &serde_json::Value) -> Result<Vec<ToolCall>, ProviderError>;
    /// Stateful assembler for a single streaming response. Every adapter ships one, so a
    /// streamed round yields the same `CompletionResponse` a non-streamed one would —
    /// including native tool calls that arrive as fragments.
    fn stream_tracker(&self) -> Box<dyn StreamTracker>;
}

/// Accumulates SSE lines into a final [`CompletionResponse`] while emitting the visible
/// deltas as they arrive.
pub trait StreamTracker: Send {
    /// Feed one raw line. `Ok(Some(chunk))` means "there is something to show/stop on".
    fn push(&mut self, line: &str) -> Result<Option<StreamChunk>, ProviderError>;
    /// The assembled response. Called once, after the stream ends.
    fn finish(self: Box<Self>) -> CompletionResponse;
}

/// What the kernel actually depends on. `id` (not `name`) avoids colliding with
/// `pristem_plugin::Plugin::name`.
pub trait Provider: Send + Sync {
    fn id(&self) -> &str;
    fn caps(&self) -> AdapterCaps;
    /// The model this endpoint is configured for. The loop asks the provider, not the
    /// global config, so switching provider also switches model.
    fn model(&self) -> &str;
    fn max_tokens(&self) -> u32;
    /// Sampling temperature for this endpoint (already merged with the global default).
    fn temperature(&self) -> Option<f32> {
        None
    }
    /// Endpoint tuning; the loop applies Top P, reasoning and context trimming from it.
    fn tuning(&self) -> EndpointTuning {
        EndpointTuning::default()
    }
    fn complete<'a>(
        &'a self,
        req: CompletionRequest,
    ) -> BoxFuture<'a, Result<CompletionResponse, ProviderError>>;
    /// Streams deltas into `tx` **and** returns the assembled response.
    fn stream<'a>(
        &'a self,
        req: CompletionRequest,
        tx: UnboundedSender<StreamChunk>,
    ) -> BoxFuture<'a, Result<CompletionResponse, ProviderError>>;
}

/// Generic glue: any `(Adapter, Transport)` pair becomes a `Provider`. This is also the
/// plugin instance mounted into `PluginHost`.
pub struct AdapterProvider {
    pub adapter: std::sync::Arc<dyn Adapter>,
    pub transport: std::sync::Arc<dyn Transport>,
    pub cfg: ProviderConfig,
    /// Endpoint id when several endpoints share one adapter (`openai-proxy` →
    /// `openai-chat`). Falls back to the adapter name.
    pub id_override: Option<String>,
}

impl AdapterProvider {
    pub fn new(
        adapter: std::sync::Arc<dyn Adapter>,
        transport: std::sync::Arc<dyn Transport>,
        cfg: ProviderConfig,
    ) -> Self {
        Self {
            adapter,
            transport,
            cfg,
            id_override: None,
        }
    }
}

impl Provider for AdapterProvider {
    fn id(&self) -> &str {
        self.id_override
            .as_deref()
            .unwrap_or_else(|| self.adapter.name())
    }
    fn caps(&self) -> AdapterCaps {
        self.adapter.caps()
    }
    fn model(&self) -> &str {
        &self.cfg.model
    }
    fn max_tokens(&self) -> u32 {
        self.cfg.max_tokens_or(4096)
    }
    fn temperature(&self) -> Option<f32> {
        self.cfg.temperature
    }
    fn tuning(&self) -> EndpointTuning {
        self.cfg.tuning.clone()
    }
    fn complete<'a>(
        &'a self,
        req: CompletionRequest,
    ) -> BoxFuture<'a, Result<CompletionResponse, ProviderError>> {
        Box::pin(async move {
            let http_req = self.adapter.map_request(&req, &self.cfg)?;
            let resp = self.transport.send(http_req).await?;
            if !(200..300).contains(&resp.status) {
                return Err(ProviderError::Http(resp.status, resp.body));
            }
            self.adapter.map_response(&resp)
        })
    }
    fn stream<'a>(
        &'a self,
        mut req: CompletionRequest,
        tx: UnboundedSender<StreamChunk>,
    ) -> BoxFuture<'a, Result<CompletionResponse, ProviderError>> {
        Box::pin(async move {
            if !self.adapter.caps().streaming {
                return Err(ProviderError::Unsupported("streaming".into()));
            }
            req.stream = true;
            let http_req = self.adapter.map_request(&req, &self.cfg)?;
            let mut tracker = self.adapter.stream_tracker();
            let (line_tx, mut line_rx) = tokio::sync::mpsc::unbounded_channel::<String>();

            // `send_lines` owns the pending transport future; `pump` owns the tracker.
            // Joining them keeps the borrow of `tracker` local, so `finish()` can move it.
            let mut pump_err: Option<ProviderError> = None;
            {
                let send = self.transport.send_lines(http_req, line_tx);
                let pump = async {
                    while let Some(line) = line_rx.recv().await {
                        match tracker.push(&line) {
                            Ok(Some(chunk)) => {
                                let done = chunk.done;
                                let _ = tx.send(chunk);
                                if done {
                                    break;
                                }
                            }
                            Ok(None) => {}
                            Err(e) => {
                                pump_err = Some(e);
                                break;
                            }
                        }
                    }
                };
                let (a, ()) = tokio::join!(send, pump);
                if let Some(e) = pump_err {
                    return Err(e);
                }
                a?;
            }
            Ok(tracker.finish())
        })
    }
}

impl pristem_plugin::Plugin for AdapterProvider {
    fn descriptor(&self) -> pristem_plugin::PluginDescriptor {
        pristem_plugin::PluginDescriptor {
            name: self.id().to_string(),
            point: pristem_plugin::MountPoint::ProviderAdapter,
            isolation: pristem_plugin::Isolation::InProcess,
        }
    }
}

/// Shared helper for the three adapters: turn a JSON `arguments` value into the flat
/// string map that the five gates validate.
pub fn args_from_json(value: &serde_json::Value) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    if let Some(obj) = value.as_object() {
        for (k, v) in obj {
            let s = match v {
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            out.insert(k.clone(), s);
        }
    }
    out
}

/// Shared helper: parse `{"name": "...", "arguments": {...}}` style tool calls.
pub fn tool_calls_from_array(
    adapter: &'static str,
    value: &serde_json::Value,
) -> Result<Vec<ToolCall>, ProviderError> {
    let arr = value
        .as_array()
        .ok_or_else(|| ProviderError::Malformed(adapter, "tool_calls is not an array".into()))?;
    let mut out = Vec::new();
    for item in arr {
        let name = item
            .get("name")
            .or_else(|| item.pointer("/function/name"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if name.is_empty() {
            continue;
        }
        let raw_args = item
            .get("arguments")
            .or_else(|| item.pointer("/function/arguments"))
            .or_else(|| item.get("input")) // Anthropic tool_use
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        let args = match &raw_args {
            serde_json::Value::String(s) => serde_json::from_str::<serde_json::Value>(s)
                .map(|v| args_from_json(&v))
                .unwrap_or_else(|_| {
                    let mut m = BTreeMap::new();
                    m.insert("command".into(), s.clone());
                    m
                }),
            other => args_from_json(other),
        };
        out.push(ToolCall {
            tool: name.to_string(),
            args,
            raw: item.to_string(),
        });
    }
    Ok(out)
}
