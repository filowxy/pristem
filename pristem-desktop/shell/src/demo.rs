//! A deterministic, offline provider transport for the desktop first pass.
//!
//! It is a `pristem_provider::Transport` (an in-process allowed mount point), so the
//! REAL kernel round loop runs: assemble → complete → parse_calls → five gates →
//! execute → render_results → answer gate. No UI component ever calls a model.
//!
//! Swap for `CurlTransport` + a BYOK environment key to go live.

use std::sync::atomic::{AtomicUsize, Ordering};

use pristem_provider::{BoxFuture, HttpRequest, HttpResponse, ProviderError, Transport};
use tokio::sync::mpsc::UnboundedSender;

pub struct DemoTransport(AtomicUsize);

impl DemoTransport {
    pub fn new() -> Self {
        Self(AtomicUsize::new(0))
    }
}

fn user_text(body: &str) -> String {
    let v: serde_json::Value = serde_json::from_str(body).unwrap_or(serde_json::Value::Null);
    v.get("messages")
        .and_then(|m| m.as_array())
        .and_then(|a| {
            a.iter()
                .rev()
                .find(|m| m.get("role").and_then(|r| r.as_str()) == Some("user"))
        })
        .and_then(|m| m.get("content").and_then(|c| c.as_str()))
        .unwrap_or("")
        .chars()
        .take(150)
        .collect()
}

fn reply_body(n: usize, text: &str) -> String {
    let content = if n % 2 == 0 {
        // First pass of a round: real tool calls in the angle-tag protocol.
        "Reading the workspace before I change anything. <call tool=\"read\" path=\"src/main.rs\"/><call tool=\"search\" query=\"presence\"/>".to_string()
    } else {
        let t = if text.trim().is_empty() { "your request".to_string() } else { text.trim().to_string() };
        format!(
            "<answer>I traced “{}” through the workspace. The mode router swaps the tool table and resets the context partition on every mode entry — that is the seam I'd use here. I kept the execution stream visible and left the editor territory untouched.</answer>",
            t
        )
    };
    serde_json::json!({
        "id": "pristem-demo",
        "choices": [{ "message": { "role": "assistant", "content": content } }],
        "usage": { "prompt_tokens": 128, "completion_tokens": 42 }
    })
    .to_string()
}

impl Transport for DemoTransport {
    fn send<'a>(&'a self, req: HttpRequest) -> BoxFuture<'a, Result<HttpResponse, ProviderError>> {
        Box::pin(async move {
            let n = self.0.fetch_add(1, Ordering::Relaxed);
            let text = user_text(&req.body);
            Ok(HttpResponse::ok(reply_body(n, &text)))
        })
    }

    fn send_lines<'a>(
        &'a self,
        req: HttpRequest,
        tx: UnboundedSender<String>,
    ) -> BoxFuture<'a, Result<(), ProviderError>> {
        Box::pin(async move {
            let n = self.0.fetch_add(1, Ordering::Relaxed);
            let text = user_text(&req.body);
            let _ = tx.send(format!("data: {}", reply_body(n, &text)));
            let _ = tx.send("data: [DONE]".to_string());
            Ok(())
        })
    }
}
