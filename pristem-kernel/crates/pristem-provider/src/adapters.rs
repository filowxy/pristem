//! The built-in trio. Each is a full four-tuple: request, response, streaming and
//! tool-call mapping. Thinking visibility is auto-filled by `caps()` / `map_response()`.

use serde_json::{json, Value};

use crate::registry::ProviderConfig;
use crate::transport::{HttpRequest, HttpResponse};
use crate::types::{
    tool_calls_from_array, Adapter, AdapterCaps, CompletionRequest, CompletionResponse, Message,
    ProviderError, Role, StreamChunk, StreamTracker, ThinkingPayload, ThinkingVisibility, ToolCall,
    ToolDescriptor, Usage,
};

fn messages(messages: &[Message]) -> Vec<Value> {
    messages
        .iter()
        .map(|m| json!({ "role": m.role.as_str(), "content": m.content }))
        .collect()
}

fn schema_for(tool: &ToolDescriptor) -> Value {
    let mut props = serde_json::Map::new();
    for arg in &tool.arguments {
        props.insert(arg.clone(), json!({ "type": "string" }));
    }
    json!({ "type": "object", "properties": props, "required": tool.arguments })
}

fn openai_functions(tools: &[ToolDescriptor]) -> Vec<Value> {
    tools
        .iter()
        .map(|t| {
            json!({
                "type": "function",
                "function": { "name": t.name, "description": t.description, "parameters": schema_for(t) }
            })
        })
        .collect()
}

fn responses_functions(tools: &[ToolDescriptor]) -> Vec<Value> {
    tools
        .iter()
        .map(|t| {
            json!({ "type": "function", "name": t.name, "description": t.description, "parameters": schema_for(t) })
        })
        .collect()
}

fn anthropic_tools(tools: &[ToolDescriptor]) -> Vec<Value> {
    tools
        .iter()
        .map(|t| {
            json!({ "name": t.name, "description": t.description, "input_schema": schema_for(t) })
        })
        .collect()
}

fn sse_data(line: &str) -> Option<&str> {
    let line = line.trim();
    if line.is_empty() || line.starts_with(':') || line.starts_with("event:") {
        return None;
    }
    line.strip_prefix("data:").map(str::trim)
}

/// The endpoint owns the model: a caller that leaves `model` empty (a probe, a bench, a
/// test) still hits the model this endpoint is configured for.
fn model_for(req: &CompletionRequest, cfg: &ProviderConfig) -> String {
    if req.model.trim().is_empty() {
        cfg.model.clone()
    } else {
        req.model.clone()
    }
}

/// User-supplied wire field name: plain ASCII identifiers with dots only, so the
/// reasoning parameter can never inject an unexpected JSON path.
pub(crate) fn safe_param_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.'))
}

fn accept(streaming: bool) -> &'static str {
    if streaming {
        "text/event-stream"
    } else {
        "application/json"
    }
}

fn usage_from(input: Option<&Value>, output: Option<&Value>, cached: Option<&Value>) -> Usage {
    Usage {
        input_tokens: input.and_then(Value::as_u64).unwrap_or(0),
        output_tokens: output.and_then(Value::as_u64).unwrap_or(0),
        cached_tokens: cached.and_then(Value::as_u64).unwrap_or(0),
    }
}

// ────────────────────────────── streaming assembly ─────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
enum Flavor {
    Chat,
    Responses,
    Anthropic,
}

#[derive(Default, Clone)]
struct PartialCall {
    name: String,
    args: String,
}

/// One SSE assembler for all three wires. Native tool calls arrive as fragments (OpenAI
/// sends `{index, function.arguments}` slices, Anthropic sends `input_json_delta`), so a
/// streamed round must rebuild them or the five gates would never see the call.
struct SseTracker {
    flavor: Flavor,
    text: String,
    thinking: Option<String>,
    usage: Usage,
    calls: std::collections::BTreeMap<u64, PartialCall>,
    /// The Responses API addresses function calls by `item_id`.
    item_ids: std::collections::BTreeMap<String, u64>,
    next_index: u64,
}

impl SseTracker {
    fn new(flavor: Flavor) -> Self {
        Self {
            flavor,
            text: String::new(),
            thinking: None,
            usage: Usage::default(),
            calls: std::collections::BTreeMap::new(),
            item_ids: std::collections::BTreeMap::new(),
            next_index: 0,
        }
    }

    fn name(&self) -> &'static str {
        match self.flavor {
            Flavor::Chat => "openai-chat.sse",
            Flavor::Responses => "openai-responses.sse",
            Flavor::Anthropic => "anthropic-messages.sse",
        }
    }

    fn slot(&mut self, index: u64) -> &mut PartialCall {
        self.calls.entry(index).or_default()
    }

    fn text_delta(&mut self, delta: &str) -> Option<StreamChunk> {
        if delta.is_empty() {
            return None;
        }
        self.text.push_str(delta);
        Some(StreamChunk::delta(delta))
    }

    fn push_chat(&mut self, v: &Value) -> Option<StreamChunk> {
        if let Some(arr) = v
            .pointer("/choices/0/delta/tool_calls")
            .and_then(Value::as_array)
        {
            for (fallback, call) in arr.iter().enumerate() {
                let idx = call
                    .get("index")
                    .and_then(Value::as_u64)
                    .unwrap_or(fallback as u64);
                let name = call
                    .pointer("/function/name")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let args = call
                    .pointer("/function/arguments")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let slot = self.slot(idx);
                if let Some(n) = name {
                    slot.name = n;
                }
                if let Some(a) = args {
                    slot.args.push_str(&a);
                }
            }
        }
        // `stream_options.include_usage` puts the totals on the final chunk.
        if let Some(u) = v.get("usage").filter(|u| !u.is_null()) {
            self.usage = usage_from(
                u.get("prompt_tokens"),
                u.get("completion_tokens"),
                u.pointer("/prompt_tokens_details/cached_tokens"),
            );
        }
        let delta = v
            .pointer("/choices/0/delta/content")
            .and_then(Value::as_str)
            .unwrap_or("");
        self.text_delta(delta)
    }

    fn push_responses(&mut self, v: &Value) -> Option<StreamChunk> {
        let ty = v.get("type").and_then(Value::as_str).unwrap_or("");
        match ty {
            "response.output_text.delta" => {
                let delta = v.get("delta").and_then(Value::as_str).unwrap_or("");
                return self.text_delta(delta);
            }
            "response.output_item.added" => {
                let item = v.get("item").cloned().unwrap_or(Value::Null);
                if item.get("type").and_then(Value::as_str) == Some("function_call") {
                    let idx = v
                        .get("output_index")
                        .and_then(Value::as_u64)
                        .unwrap_or(self.next_index);
                    self.next_index = self.next_index.max(idx + 1);
                    let name = item
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let args = item
                        .get("arguments")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let slot = self.slot(idx);
                    slot.name = name;
                    slot.args.push_str(&args);
                    for key in ["id", "call_id"] {
                        if let Some(id) = item.get(key).and_then(Value::as_str) {
                            self.item_ids.insert(id.to_string(), idx);
                        }
                    }
                }
            }
            "response.function_call_arguments.delta" => {
                let idx = v
                    .get("item_id")
                    .and_then(Value::as_str)
                    .and_then(|id| self.item_ids.get(id).copied())
                    .unwrap_or(0);
                if let Some(d) = v.get("delta").and_then(Value::as_str) {
                    self.slot(idx).args.push_str(d);
                }
            }
            "response.completed" => {
                let u = v.pointer("/response/usage").unwrap_or(&Value::Null);
                self.usage = usage_from(
                    u.get("input_tokens"),
                    u.get("output_tokens"),
                    u.pointer("/input_tokens_details/cached_tokens"),
                );
                return Some(StreamChunk::done());
            }
            "response.failed" => return Some(StreamChunk::done()),
            _ => {}
        }
        None
    }

    fn push_anthropic(&mut self, v: &Value) -> Option<StreamChunk> {
        let ty = v.get("type").and_then(Value::as_str).unwrap_or("");
        match ty {
            "message_start" => {
                self.usage.input_tokens = v
                    .pointer("/message/usage/input_tokens")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                self.usage.cached_tokens = v
                    .pointer("/message/usage/cache_read_input_tokens")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
            }
            "content_block_start" => {
                let idx = v.get("index").and_then(Value::as_u64).unwrap_or(0);
                let block = v.get("content_block").cloned().unwrap_or(Value::Null);
                match block.get("type").and_then(Value::as_str).unwrap_or("") {
                    "tool_use" => {
                        let name = block
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        // `input` is `{}` at start; the real payload arrives as deltas.
                        let seeded = match block.get("input") {
                            Some(Value::Object(m)) if !m.is_empty() => block
                                .get("input")
                                .map(|i| i.to_string())
                                .unwrap_or_default(),
                            _ => String::new(),
                        };
                        let slot = self.slot(idx);
                        slot.name = name;
                        slot.args.push_str(&seeded);
                    }
                    "thinking" => {
                        if let Some(t) = block.get("thinking").and_then(Value::as_str) {
                            self.thinking.get_or_insert_with(String::new).push_str(t);
                        }
                    }
                    _ => {}
                }
            }
            "content_block_delta" => {
                let idx = v.get("index").and_then(Value::as_u64).unwrap_or(0);
                let delta = v.get("delta").cloned().unwrap_or(Value::Null);
                match delta.get("type").and_then(Value::as_str).unwrap_or("") {
                    "text_delta" => {
                        let t = delta.get("text").and_then(Value::as_str).unwrap_or("");
                        return self.text_delta(t);
                    }
                    "input_json_delta" => {
                        if let Some(p) = delta.get("partial_json").and_then(Value::as_str) {
                            self.slot(idx).args.push_str(p);
                        }
                    }
                    "thinking_delta" => {
                        if let Some(t) = delta.get("thinking").and_then(Value::as_str) {
                            self.thinking.get_or_insert_with(String::new).push_str(t);
                        }
                    }
                    _ => {}
                }
            }
            "message_delta" => {
                if let Some(out) = v.pointer("/usage/output_tokens").and_then(Value::as_u64) {
                    self.usage.output_tokens = out;
                }
            }
            "message_stop" => return Some(StreamChunk::done()),
            "error" => {
                return Some(StreamChunk::done());
            }
            _ => {}
        }
        None
    }
}

impl StreamTracker for SseTracker {
    fn push(&mut self, line: &str) -> Result<Option<StreamChunk>, ProviderError> {
        let Some(data) = sse_data(line) else {
            return Ok(None);
        };
        if data == "[DONE]" {
            return Ok(Some(StreamChunk::done()));
        }
        let v: Value = serde_json::from_str(data)
            .map_err(|e| ProviderError::Malformed(self.name(), e.to_string()))?;
        let chunk = match self.flavor {
            Flavor::Chat => self.push_chat(&v),
            Flavor::Responses => self.push_responses(&v),
            Flavor::Anthropic => self.push_anthropic(&v),
        };
        Ok(chunk)
    }

    fn finish(self: Box<Self>) -> CompletionResponse {
        let flavor = self.flavor;
        let mut partials: Vec<PartialCall> = self.calls.into_values().collect();
        partials.retain(|c| !c.name.is_empty());
        let arr = Value::Array(
            partials
                .into_iter()
                .map(|c| {
                    let args = if c.args.trim().is_empty() {
                        Value::Object(Default::default())
                    } else {
                        serde_json::from_str::<Value>(&c.args)
                            .unwrap_or_else(|_| Value::String(c.args.clone()))
                    };
                    json!({ "name": c.name, "arguments": args })
                })
                .collect(),
        );
        let label = match flavor {
            Flavor::Chat => "openai-chat",
            Flavor::Responses => "openai-responses",
            Flavor::Anthropic => "anthropic-messages",
        };
        let thinking = ThinkingPayload {
            visibility: if self.thinking.is_some() {
                ThinkingVisibility::Full
            } else {
                ThinkingVisibility::None
            },
            text: self.thinking,
            summary: None,
        };
        CompletionResponse {
            text: self.text,
            tool_calls: tool_calls_from_array(label, &arr).unwrap_or_default(),
            thinking,
            usage: self.usage,
            raw_id: None,
        }
    }
}

// ───────────────────────────── OpenAI Chat Completions ─────────────────────────

#[derive(Debug, Default, Clone, Copy)]
pub struct OpenAiChatAdapter;

impl Adapter for OpenAiChatAdapter {
    fn name(&self) -> &str {
        "openai-chat"
    }
    fn caps(&self) -> AdapterCaps {
        AdapterCaps {
            thinking_visibility: ThinkingVisibility::None,
            streaming: true,
            native_tool_calls: true,
        }
    }
    fn stream_tracker(&self) -> Box<dyn StreamTracker> {
        Box::new(SseTracker::new(Flavor::Chat))
    }
    fn map_request(
        &self,
        req: &CompletionRequest,
        cfg: &ProviderConfig,
    ) -> Result<HttpRequest, ProviderError> {
        let key = cfg.resolve_key()?;
        let url = cfg
            .base_url
            .clone()
            .unwrap_or_else(|| "https://api.openai.com/v1/chat/completions".into());
        let mut body = json!({
            "model": model_for(req, cfg),
            "messages": messages(&req.messages),
            "stream": req.stream,
        });
        if req.stream {
            // Without this the stream carries no token totals at all.
            body["stream_options"] = json!({ "include_usage": true });
        }
        if !req.tools.is_empty() {
            body["tools"] = json!(openai_functions(&req.tools));
        }
        if let Some(t) = req.temperature {
            body["temperature"] = json!(t);
        }
        if let Some(p) = req.top_p {
            body["top_p"] = json!(p);
        }
        if let (Some(name), Some(value)) = (
            req.reasoning_param.as_deref(),
            req.reasoning_effort.as_deref(),
        ) {
            if safe_param_name(name) {
                body[name] = json!(value);
            }
        }
        Ok(HttpRequest::new(url, body.to_string())
            .header("Authorization", format!("Bearer {key}"))
            .header("Content-Type", "application/json")
            .header("Accept", accept(req.stream)))
    }
    fn map_response(&self, resp: &HttpResponse) -> Result<CompletionResponse, ProviderError> {
        let v: Value = serde_json::from_str(&resp.body)
            .map_err(|e| ProviderError::Malformed("openai-chat", e.to_string()))?;
        let msg = v.pointer("/choices/0/message").ok_or_else(|| {
            ProviderError::Malformed("openai-chat", "missing choices[0].message".into())
        })?;
        let text = msg
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let tool_calls = match msg.get("tool_calls") {
            Some(tc) => tool_calls_from_array("openai-chat", tc)?,
            None => Vec::new(),
        };
        let thinking = match msg.get("reasoning_content").and_then(Value::as_str) {
            Some(summary) => ThinkingPayload {
                visibility: ThinkingVisibility::Summary,
                text: None,
                summary: Some(summary.to_string()),
            },
            None => ThinkingPayload::default(),
        };
        let usage = usage_from(
            v.pointer("/usage/prompt_tokens"),
            v.pointer("/usage/completion_tokens"),
            v.pointer("/usage/prompt_tokens_details/cached_tokens"),
        );
        Ok(CompletionResponse {
            text,
            tool_calls,
            thinking,
            usage,
            raw_id: v.get("id").and_then(Value::as_str).map(str::to_string),
        })
    }
    fn map_stream_chunk(&self, line: &str) -> Result<Option<StreamChunk>, ProviderError> {
        let Some(data) = sse_data(line) else {
            return Ok(None);
        };
        if data == "[DONE]" {
            return Ok(Some(StreamChunk::done()));
        }
        let v: Value = serde_json::from_str(data)
            .map_err(|e| ProviderError::Malformed("openai-chat.sse", e.to_string()))?;
        let delta = v
            .pointer("/choices/0/delta/content")
            .and_then(Value::as_str)
            .unwrap_or("");
        if delta.is_empty() {
            return Ok(None);
        }
        Ok(Some(StreamChunk::delta(delta)))
    }
    fn map_tool_calls(&self, value: &Value) -> Result<Vec<ToolCall>, ProviderError> {
        tool_calls_from_array("openai-chat", value)
    }
}

// ─────────────────────────────── OpenAI Responses ─────────────────────────────

#[derive(Debug, Default, Clone, Copy)]
pub struct OpenAiResponsesAdapter;

impl Adapter for OpenAiResponsesAdapter {
    fn name(&self) -> &str {
        "openai-responses"
    }
    fn caps(&self) -> AdapterCaps {
        AdapterCaps {
            thinking_visibility: ThinkingVisibility::Summary,
            streaming: true,
            native_tool_calls: true,
        }
    }
    fn stream_tracker(&self) -> Box<dyn StreamTracker> {
        Box::new(SseTracker::new(Flavor::Responses))
    }
    fn map_request(
        &self,
        req: &CompletionRequest,
        cfg: &ProviderConfig,
    ) -> Result<HttpRequest, ProviderError> {
        let key = cfg.resolve_key()?;
        let url = cfg
            .base_url
            .clone()
            .unwrap_or_else(|| "https://api.openai.com/v1/responses".into());
        let mut body = json!({
            "model": model_for(req, cfg),
            "input": messages(&req.messages),
            "stream": req.stream,
        });
        if !req.tools.is_empty() {
            body["tools"] = json!(responses_functions(&req.tools));
        }
        if let Some(t) = req.temperature {
            body["temperature"] = json!(t);
        }
        if let Some(p) = req.top_p {
            body["top_p"] = json!(p);
        }
        if let Some(effort) = req.reasoning_effort.as_deref() {
            body["reasoning"] = json!({ "effort": effort });
        }
        Ok(HttpRequest::new(url, body.to_string())
            .header("Authorization", format!("Bearer {key}"))
            .header("Content-Type", "application/json")
            .header("Accept", accept(req.stream)))
    }
    fn map_response(&self, resp: &HttpResponse) -> Result<CompletionResponse, ProviderError> {
        let v: Value = serde_json::from_str(&resp.body)
            .map_err(|e| ProviderError::Malformed("openai-responses", e.to_string()))?;
        let items = v.get("output").and_then(Value::as_array).ok_or_else(|| {
            ProviderError::Malformed("openai-responses", "missing output[]".into())
        })?;
        let mut text = String::new();
        let mut calls: Vec<Value> = Vec::new();
        let mut summary: Option<String> = None;
        for item in items {
            match item.get("type").and_then(Value::as_str).unwrap_or("") {
                "message" => {
                    if let Some(content) = item.get("content").and_then(Value::as_array) {
                        for c in content {
                            if c.get("type").and_then(Value::as_str) == Some("output_text") {
                                if let Some(t) = c.get("text").and_then(Value::as_str) {
                                    text.push_str(t);
                                }
                            }
                        }
                    }
                }
                "function_call" => calls.push(item.clone()),
                "reasoning" => {
                    if let Some(s) = item.pointer("/summary/0/text").and_then(Value::as_str) {
                        summary = Some(s.to_string());
                    }
                }
                _ => {}
            }
        }
        let thinking = ThinkingPayload {
            visibility: if summary.is_some() {
                ThinkingVisibility::Summary
            } else {
                ThinkingVisibility::None
            },
            text: None,
            summary,
        };
        let tool_calls = tool_calls_from_array("openai-responses", &Value::Array(calls))?;
        let usage = usage_from(
            v.pointer("/usage/input_tokens"),
            v.pointer("/usage/output_tokens"),
            v.pointer("/usage/input_tokens_details/cached_tokens"),
        );
        Ok(CompletionResponse {
            text,
            tool_calls,
            thinking,
            usage,
            raw_id: v.get("id").and_then(Value::as_str).map(str::to_string),
        })
    }
    fn map_stream_chunk(&self, line: &str) -> Result<Option<StreamChunk>, ProviderError> {
        let Some(data) = sse_data(line) else {
            return Ok(None);
        };
        if data == "[DONE]" {
            return Ok(Some(StreamChunk::done()));
        }
        let v: Value = serde_json::from_str(data)
            .map_err(|e| ProviderError::Malformed("openai-responses.sse", e.to_string()))?;
        let ty = v.get("type").and_then(Value::as_str).unwrap_or("");
        if ty == "response.completed" || ty == "response.failed" {
            return Ok(Some(StreamChunk::done()));
        }
        let delta = v.get("delta").and_then(Value::as_str).unwrap_or("");
        if delta.is_empty() {
            return Ok(None);
        }
        Ok(Some(StreamChunk::delta(delta)))
    }
    fn map_tool_calls(&self, value: &Value) -> Result<Vec<ToolCall>, ProviderError> {
        tool_calls_from_array("openai-responses", value)
    }
}

// ────────────────────────────── Anthropic Messages ────────────────────────────

#[derive(Debug, Default, Clone, Copy)]
pub struct AnthropicAdapter;

impl Adapter for AnthropicAdapter {
    fn name(&self) -> &str {
        "anthropic-messages"
    }
    fn caps(&self) -> AdapterCaps {
        AdapterCaps {
            thinking_visibility: ThinkingVisibility::Full,
            streaming: true,
            native_tool_calls: true,
        }
    }
    fn stream_tracker(&self) -> Box<dyn StreamTracker> {
        Box::new(SseTracker::new(Flavor::Anthropic))
    }
    fn map_request(
        &self,
        req: &CompletionRequest,
        cfg: &ProviderConfig,
    ) -> Result<HttpRequest, ProviderError> {
        let key = cfg.resolve_key()?;
        let url = cfg
            .base_url
            .clone()
            .unwrap_or_else(|| "https://api.anthropic.com/v1/messages".into());
        let system: Vec<&str> = req
            .messages
            .iter()
            .filter(|m| m.role == Role::System)
            .map(|m| m.content.as_str())
            .collect();
        let rest: Vec<Value> = req
            .messages
            .iter()
            .filter(|m| m.role != Role::System)
            .map(|m| json!({ "role": m.role.as_str(), "content": m.content }))
            .collect();
        let mut body = json!({
            "model": model_for(req, cfg),
            "max_tokens": req.max_tokens,
            "messages": rest,
            "stream": req.stream,
        });
        if !system.is_empty() {
            body["system"] = json!(system.join("\n\n"));
        }
        if !req.tools.is_empty() {
            body["tools"] = json!(anthropic_tools(&req.tools));
        }
        if let Some(t) = req.temperature {
            body["temperature"] = json!(t);
        }
        if let Some(p) = req.top_p {
            body["top_p"] = json!(p);
        }
        Ok(HttpRequest::new(url, body.to_string())
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .header("Accept", accept(req.stream)))
    }
    fn map_response(&self, resp: &HttpResponse) -> Result<CompletionResponse, ProviderError> {
        let v: Value = serde_json::from_str(&resp.body)
            .map_err(|e| ProviderError::Malformed("anthropic-messages", e.to_string()))?;
        let blocks = v.get("content").and_then(Value::as_array).ok_or_else(|| {
            ProviderError::Malformed("anthropic-messages", "missing content[]".into())
        })?;
        let mut text = String::new();
        let mut calls: Vec<Value> = Vec::new();
        let mut thinking_text: Option<String> = None;
        for b in blocks {
            match b.get("type").and_then(Value::as_str).unwrap_or("") {
                "text" => {
                    if let Some(t) = b.get("text").and_then(Value::as_str) {
                        text.push_str(t);
                    }
                }
                "thinking" => {
                    if let Some(t) = b.get("thinking").and_then(Value::as_str) {
                        thinking_text = Some(t.to_string());
                    }
                }
                "tool_use" => calls.push(b.clone()),
                _ => {}
            }
        }
        let thinking = ThinkingPayload {
            visibility: if thinking_text.is_some() {
                ThinkingVisibility::Full
            } else {
                ThinkingVisibility::None
            },
            text: thinking_text,
            summary: None,
        };
        let tool_calls = tool_calls_from_array("anthropic-messages", &Value::Array(calls))?;
        let usage = usage_from(
            v.pointer("/usage/input_tokens"),
            v.pointer("/usage/output_tokens"),
            v.pointer("/usage/cache_read_input_tokens"),
        );
        Ok(CompletionResponse {
            text,
            tool_calls,
            thinking,
            usage,
            raw_id: v.get("id").and_then(Value::as_str).map(str::to_string),
        })
    }
    fn map_stream_chunk(&self, line: &str) -> Result<Option<StreamChunk>, ProviderError> {
        let Some(data) = sse_data(line) else {
            return Ok(None);
        };
        if data == "[DONE]" {
            return Ok(Some(StreamChunk::done()));
        }
        let v: Value = serde_json::from_str(data)
            .map_err(|e| ProviderError::Malformed("anthropic-messages.sse", e.to_string()))?;
        let ty = v.get("type").and_then(Value::as_str).unwrap_or("");
        if ty == "message_stop" {
            return Ok(Some(StreamChunk::done()));
        }
        let delta = v
            .pointer("/delta/text")
            .and_then(Value::as_str)
            .unwrap_or("");
        if delta.is_empty() {
            return Ok(None);
        }
        Ok(Some(StreamChunk::delta(delta)))
    }
    fn map_tool_calls(&self, value: &Value) -> Result<Vec<ToolCall>, ProviderError> {
        tool_calls_from_array("anthropic-messages", value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Adapter;

    fn cfg() -> ProviderConfig {
        ProviderConfig {
            default: "openai-chat".into(),
            model: "gpt-4o".into(),
            api_key_env: "PRISTEM_TEST_KEY".into(),
            api_key: Some("test-key-123".into()),
            base_url: None,
            temperature: Some(0.2),
            max_tokens: None,
            tuning: Default::default(),
            stream: false,
            providers: Default::default(),
        }
    }
    fn req() -> CompletionRequest {
        CompletionRequest {
            model: "gpt-4o".into(),
            messages: vec![Message::system("be terse"), Message::user("read a.txt")],
            tools: vec![ToolDescriptor {
                name: "read".into(),
                description: "read a file".into(),
                arguments: vec!["path".into()],
            }],
            temperature: Some(0.2),
            top_p: None,
            reasoning_effort: None,
            reasoning_param: None,
            stream: false,
            max_tokens: 4096,
        }
    }

    #[test]
    fn chat_completions_four_tuple() {
        let a = OpenAiChatAdapter;
        let http = a.map_request(&req(), &cfg()).unwrap();
        assert!(http.url.ends_with("/chat/completions"));
        assert_eq!(http.headers["Authorization"], "Bearer test-key-123");
        let body: Value = serde_json::from_str(&http.body).unwrap();
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["tools"][0]["type"], "function");

        let reply = a
            .map_response(&HttpResponse::ok(
                r#"{"id":"chatcmpl-1","choices":[{"message":{"role":"assistant","content":"done","tool_calls":[{"function":{"name":"read","arguments":"{\"path\":\"a.txt\"}"}}]}}],"usage":{"prompt_tokens":10,"completion_tokens":4}}"#,
            ))
            .unwrap();
        assert_eq!(reply.text, "done");
        assert_eq!(reply.tool_calls.len(), 1);
        assert_eq!(reply.tool_calls[0].tool, "read");
        assert_eq!(reply.tool_calls[0].args["path"], "a.txt");
        assert_eq!(reply.usage.input_tokens, 10);
        assert_eq!(reply.thinking.visibility, ThinkingVisibility::None);

        let chunk = a
            .map_stream_chunk("data: {\"choices\":[{\"delta\":{\"content\":\"hel\"}}]}")
            .unwrap()
            .unwrap();
        assert_eq!(chunk.delta, "hel");
        assert!(a.map_stream_chunk("data: [DONE]").unwrap().unwrap().done);
    }

    #[test]
    fn tuning_reaches_the_wire_safely() {
        let a = OpenAiChatAdapter;
        let mut r = req();
        r.top_p = Some(0.4);
        r.reasoning_param = Some("reasoning_effort".into());
        r.reasoning_effort = Some("high".into());
        let http = a.map_request(&r, &cfg()).unwrap();
        let body: Value = serde_json::from_str(&http.body).unwrap();
        // f32 reaches JSON as f64, so compare with tolerance.
        assert!((body["top_p"].as_f64().unwrap() - 0.4).abs() < 1e-6);
        assert_eq!(body["reasoning_effort"], json!("high"));

        // An unsafe field name never reaches the JSON body.
        r.reasoning_param = Some("bad param".into());
        let http = a.map_request(&r, &cfg()).unwrap();
        let body: Value = serde_json::from_str(&http.body).unwrap();
        assert!(body.get("bad param").is_none());
    }

    #[test]
    fn responses_tuning_maps_effort_under_reasoning() {
        let a = OpenAiResponsesAdapter;
        let mut r = req();
        r.top_p = Some(0.9);
        r.reasoning_effort = Some("low".into());
        let http = a.map_request(&r, &cfg()).unwrap();
        let body: Value = serde_json::from_str(&http.body).unwrap();
        assert!((body["top_p"].as_f64().unwrap() - 0.9).abs() < 1e-6);
        assert_eq!(body["reasoning"]["effort"], json!("low"));
    }

    #[test]
    fn responses_api_exposes_reasoning_summary() {
        let a = OpenAiResponsesAdapter;
        let http = a.map_request(&req(), &cfg()).unwrap();
        assert!(http.url.ends_with("/responses"));
        let reply = a
            .map_response(&HttpResponse::ok(
                r#"{"id":"resp-1","output":[
                  {"type":"reasoning","summary":[{"text":"weighed options"}]},
                  {"type":"message","content":[{"type":"output_text","text":"answer"}]},
                  {"type":"function_call","name":"read","arguments":{"path":"a.txt"}}
                ],"usage":{"input_tokens":7,"output_tokens":3}}"#,
            ))
            .unwrap();
        assert_eq!(reply.text, "answer");
        assert_eq!(reply.thinking.visibility, ThinkingVisibility::Summary);
        assert_eq!(reply.thinking.summary.as_deref(), Some("weighed options"));
        assert_eq!(reply.tool_calls[0].args["path"], "a.txt");
    }

    #[test]
    fn anthropic_moves_system_out_and_exposes_full_thinking() {
        let a = AnthropicAdapter;
        let http = a.map_request(&req(), &cfg()).unwrap();
        assert_eq!(http.headers["x-api-key"], "test-key-123");
        assert_eq!(http.headers["anthropic-version"], "2023-06-01");
        let body: Value = serde_json::from_str(&http.body).unwrap();
        assert_eq!(body["system"], "be terse");
        assert_eq!(body["messages"].as_array().unwrap().len(), 1);
        assert_eq!(a.caps().thinking_visibility, ThinkingVisibility::Full);

        let reply = a
            .map_response(&HttpResponse::ok(
                r#"{"id":"msg-1","content":[
                  {"type":"thinking","thinking":"hmm"},
                  {"type":"text","text":"hi"},
                  {"type":"tool_use","name":"read","input":{"path":"a.txt"}}
                ],"usage":{"input_tokens":5,"output_tokens":2}}"#,
            ))
            .unwrap();
        assert_eq!(reply.text, "hi");
        assert_eq!(reply.thinking.visibility, ThinkingVisibility::Full);
        assert_eq!(reply.thinking.text.as_deref(), Some("hmm"));
        assert_eq!(reply.tool_calls[0].args["path"], "a.txt");
    }

    #[test]
    fn byok_never_embeds_a_key_when_none_is_configured() {
        let mut cfg = cfg();
        cfg.api_key = None;
        cfg.api_key_env = "PRISTEM_DEFINITELY_UNSET_KEY".into();
        std::env::remove_var("PRISTEM_DEFINITELY_UNSET_KEY");
        let err = OpenAiChatAdapter.map_request(&req(), &cfg).unwrap_err();
        assert!(matches!(err, ProviderError::MissingApiKey(_)));
        assert!(err.to_string().contains("no bundled model access"));
    }

    /// Streamed tool calls arrive as fragments. If the tracker drops them the five gates
    /// never see the call, so this asserts the assembled call survives.
    #[test]
    fn chat_stream_assembles_text_and_fragmented_tool_call() {
        let mut t = SseTracker::new(Flavor::Chat);
        let lines = [
            r#"data: {"choices":[{"delta":{"role":"assistant","content":"Hel"}}]}"#,
            r#"data: {"choices":[{"delta":{"content":"lo"}}]}"#,
            r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read","arguments":"{\"pa"}}]}}]}"#,
            r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\":\"a.txt\"}"}}]}}]}"#,
            r#"data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":9,"completion_tokens":4}}"#,
            "data: [DONE]",
        ];
        let mut deltas = String::new();
        let mut saw_done = false;
        for line in lines {
            if let Some(chunk) = t.push(line).unwrap() {
                deltas.push_str(&chunk.delta);
                saw_done |= chunk.done;
            }
        }
        assert_eq!(deltas, "Hello");
        assert!(saw_done);
        let done = Box::new(t).finish();
        assert_eq!(done.text, "Hello");
        assert_eq!(done.tool_calls.len(), 1);
        assert_eq!(done.tool_calls[0].tool, "read");
        assert_eq!(done.tool_calls[0].args["path"], "a.txt");
        assert_eq!(done.usage.input_tokens, 9);
        assert_eq!(done.usage.output_tokens, 4);
    }

    #[test]
    fn anthropic_stream_assembles_tool_use_from_json_deltas() {
        let mut t = SseTracker::new(Flavor::Anthropic);
        let lines = [
            r#"data: {"type":"message_start","message":{"usage":{"input_tokens":11,"cache_read_input_tokens":3}}}"#,
            r#"data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#,
            r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Let me "}}"#,
            r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"look."}}"#,
            r#"data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu_1","name":"read","input":{}}}"#,
            r#"data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"path\":"}}"#,
            r#"data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\"a.txt\"}"}}"#,
            r#"data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":17}}"#,
            r#"data: {"type":"message_stop"}"#,
        ];
        let mut saw_done = false;
        for line in lines {
            if let Some(chunk) = t.push(line).unwrap() {
                saw_done |= chunk.done;
            }
        }
        assert!(saw_done);
        let done = Box::new(t).finish();
        assert_eq!(done.text, "Let me look.");
        assert_eq!(done.tool_calls.len(), 1);
        assert_eq!(done.tool_calls[0].args["path"], "a.txt");
        assert_eq!(done.usage.input_tokens, 11);
        assert_eq!(done.usage.output_tokens, 17);
        assert_eq!(done.usage.cached_tokens, 3);
    }

    #[test]
    fn responses_stream_assembles_function_call_by_item_id() {
        let mut t = SseTracker::new(Flavor::Responses);
        let lines = [
            r#"data: {"type":"response.output_text.delta","delta":"checking"}"#,
            r#"data: {"type":"response.output_item.added","output_index":1,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"read","arguments":""}}"#,
            r#"data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"{\"path\":\"a"}"#,
            r#"data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":".txt\"}"}"#,
            r#"data: {"type":"response.completed","response":{"usage":{"input_tokens":21,"output_tokens":6}}}"#,
        ];
        let mut saw_done = false;
        for line in lines {
            if let Some(chunk) = t.push(line).unwrap() {
                saw_done |= chunk.done;
            }
        }
        assert!(saw_done);
        let done = Box::new(t).finish();
        assert_eq!(done.text, "checking");
        assert_eq!(done.tool_calls.len(), 1);
        assert_eq!(done.tool_calls[0].args["path"], "a.txt");
        assert_eq!(done.usage.input_tokens, 21);
    }

    #[test]
    fn streaming_requests_ask_for_sse_and_token_totals() {
        let mut r = req();
        r.stream = true;
        let chat = OpenAiChatAdapter.map_request(&r, &cfg()).unwrap();
        assert_eq!(chat.headers["Accept"], "text/event-stream");
        let body: Value = serde_json::from_str(&chat.body).unwrap();
        assert_eq!(body["stream_options"]["include_usage"], true);
        assert_eq!(body["stream"], true);

        let anth = AnthropicAdapter.map_request(&r, &cfg()).unwrap();
        assert_eq!(anth.headers["Accept"], "text/event-stream");
        assert_eq!(anth.headers["x-api-key"], "test-key-123");
    }
}
