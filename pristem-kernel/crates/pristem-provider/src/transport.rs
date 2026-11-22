//! Transport is deliberately a trait. The kernel never talks HTTP directly; network I/O
//! is a mount point, and the shipped `CurlTransport` shells out to the system `curl` so
//! BYOK works without bundling an HTTP/TLS stack (N1: memory < 1 GB).
//!
//! `StubTransport` is the deterministic transport used by every test and by the CLI's
//! `--stub` mode, so the whole round loop is exercisable with no API key at all.

use std::collections::{BTreeMap, VecDeque};
use std::process::Stdio;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc::UnboundedSender;

use crate::types::{BoxFuture, ProviderError};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct HttpRequest {
    pub url: String,
    pub headers: BTreeMap<String, String>,
    pub body: String,
}

impl HttpRequest {
    pub fn new(url: impl Into<String>, body: String) -> Self {
        Self {
            url: url.into(),
            headers: BTreeMap::new(),
            body,
        }
    }
    pub fn header(mut self, k: impl Into<String>, v: impl Into<String>) -> Self {
        self.headers.insert(k.into(), v.into());
        self
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

impl HttpResponse {
    pub fn ok(body: impl Into<String>) -> Self {
        Self {
            status: 200,
            body: body.into(),
        }
    }
}

pub trait Transport: Send + Sync {
    fn send<'a>(&'a self, req: HttpRequest) -> BoxFuture<'a, Result<HttpResponse, ProviderError>>;
    fn send_lines<'a>(
        &'a self,
        req: HttpRequest,
        tx: UnboundedSender<String>,
    ) -> BoxFuture<'a, Result<(), ProviderError>>;
}

/// Scripted responses, FIFO. Records every outbound request so the four-tuple request
/// mapping can be asserted without hitting a network.
pub struct StubTransport {
    responses: Mutex<VecDeque<String>>,
    requests: Mutex<Vec<HttpRequest>>,
    status: u16,
}

impl std::fmt::Debug for StubTransport {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StubTransport")
            .field(
                "queued",
                &self.responses.lock().map(|r| r.len()).unwrap_or(0),
            )
            .finish()
    }
}

impl Default for StubTransport {
    fn default() -> Self {
        Self::new(Vec::<String>::new())
    }
}

impl StubTransport {
    pub fn new(responses: Vec<impl Into<String>>) -> Self {
        Self {
            responses: Mutex::new(responses.into_iter().map(Into::into).collect()),
            requests: Mutex::new(Vec::new()),
            status: 200,
        }
    }
    pub fn with_status(mut self, status: u16) -> Self {
        self.status = status;
        self
    }
    pub fn push(&self, response: impl Into<String>) {
        if let Ok(mut q) = self.responses.lock() {
            q.push_back(response.into());
        }
    }
    pub fn last_request(&self) -> Option<HttpRequest> {
        self.requests.lock().ok()?.last().cloned()
    }
    pub fn requests(&self) -> Vec<HttpRequest> {
        self.requests.lock().map(|r| r.clone()).unwrap_or_default()
    }
    fn record(&self, req: &HttpRequest) -> String {
        if let Ok(mut r) = self.requests.lock() {
            r.push(req.clone());
        }
        self.responses
            .lock()
            .ok()
            .and_then(|mut q| q.pop_front())
            .unwrap_or_default()
    }
}

impl Transport for StubTransport {
    fn send<'a>(&'a self, req: HttpRequest) -> BoxFuture<'a, Result<HttpResponse, ProviderError>> {
        Box::pin(async move {
            Ok(HttpResponse {
                status: self.status,
                body: self.record(&req),
            })
        })
    }
    fn send_lines<'a>(
        &'a self,
        req: HttpRequest,
        tx: UnboundedSender<String>,
    ) -> BoxFuture<'a, Result<(), ProviderError>> {
        Box::pin(async move {
            let body = self.record(&req);
            for line in body.lines() {
                let _ = tx.send(line.to_string());
            }
            Ok(())
        })
    }
}

/// Real BYOK transport. The API key is injected into the request headers by the adapter
/// from `ProviderConfig::resolve_key()` — environment only, never conversation content.
#[derive(Clone, Debug, Default)]
pub struct CurlTransport {
    pub timeout_secs: u64,
}

impl CurlTransport {
    pub fn new(timeout_secs: u64) -> Self {
        Self { timeout_secs }
    }

    fn command(&self, req: &HttpRequest, streaming: bool) -> tokio::process::Command {
        let mut cmd = tokio::process::Command::new("curl");
        cmd.arg("-sS")
            .arg("-X")
            .arg("POST")
            .arg("--max-time")
            .arg(self.timeout_secs.max(1).to_string());
        if streaming {
            // -N: hand each SSE frame over as it arrives instead of buffering the body.
            cmd.arg("--no-buffer");
        }
        for (k, v) in &req.headers {
            cmd.arg("-H").arg(format!("{k}: {v}"));
        }
        // Status line sentinel: curl appends it after the body, so the adapter still sees a
        // byte-identical payload while the transport learns the real HTTP status. Without
        // this every 401 looked like "malformed JSON" instead of an auth failure.
        cmd.arg("-w")
            .arg(format!("\n{STATUS_SENTINEL}%{{http_code}}"))
            .arg("--data-binary")
            .arg("@-")
            .arg(&req.url)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        cmd
    }

    async fn spawn(
        &self,
        req: &HttpRequest,
        streaming: bool,
    ) -> Result<tokio::process::Child, ProviderError> {
        let mut child = self
            .command(req, streaming)
            .spawn()
            .map_err(|e| ProviderError::Transport(format!("cannot spawn curl: {e}")))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(req.body.as_bytes())
                .await
                .map_err(|e| ProviderError::Transport(format!("curl stdin: {e}")))?;
            drop(stdin);
        }
        Ok(child)
    }
}

pub const STATUS_SENTINEL: &str = "__pristem_status__";

/// Split curl's `-w` trailer off the body. Returns `(body, status)`.
fn split_status(text: &str) -> (String, u16) {
    match text.rsplit_once(STATUS_SENTINEL) {
        Some((body, tail)) => {
            let status = tail.trim().parse::<u16>().unwrap_or(200);
            (body.trim_end_matches('\n').to_string(), status)
        }
        None => (text.to_string(), 200),
    }
}

impl Transport for CurlTransport {
    fn send<'a>(&'a self, req: HttpRequest) -> BoxFuture<'a, Result<HttpResponse, ProviderError>> {
        Box::pin(async move {
            let child = self.spawn(&req, false).await?;
            let out = child
                .wait_with_output()
                .await
                .map_err(|e| ProviderError::Transport(format!("curl: {e}")))?;
            if !out.status.success() {
                return Err(ProviderError::Transport(
                    String::from_utf8_lossy(&out.stderr).trim().to_string(),
                ));
            }
            let raw = String::from_utf8_lossy(&out.stdout).to_string();
            let (body, status) = split_status(&raw);
            Ok(HttpResponse { status, body })
        })
    }

    fn send_lines<'a>(
        &'a self,
        req: HttpRequest,
        tx: UnboundedSender<String>,
    ) -> BoxFuture<'a, Result<(), ProviderError>> {
        Box::pin(async move {
            let mut child = self.spawn(&req, true).await?;
            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| ProviderError::Transport("curl stdout was not piped".into()))?;
            let mut lines = BufReader::new(stdout).lines();
            let mut status: u16 = 200;
            while let Some(line) = lines
                .next_line()
                .await
                .map_err(|e| ProviderError::Transport(format!("curl stream: {e}")))?
            {
                if let Some(code) = line.strip_prefix(STATUS_SENTINEL) {
                    status = code.trim().parse::<u16>().unwrap_or(200);
                    break;
                }
                if tx.send(line).is_err() {
                    break;
                }
            }
            let out = child
                .wait_with_output()
                .await
                .map_err(|e| ProviderError::Transport(format!("curl: {e}")))?;
            if !out.status.success() {
                let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                if status != 200 && !(200..300).contains(&status) {
                    return Err(ProviderError::Http(status, stderr));
                }
                if !stderr.is_empty() {
                    return Err(ProviderError::Transport(stderr));
                }
            }
            if !(200..300).contains(&status) {
                return Err(ProviderError::Http(status, String::new()));
            }
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn stub_is_fifo_and_records_requests() {
        let t = StubTransport::new(vec!["first", "second"]);
        let a = t
            .send(HttpRequest::new("https://x", "{}".into()))
            .await
            .unwrap();
        let b = t
            .send(HttpRequest::new("https://y", "{}".into()))
            .await
            .unwrap();
        assert_eq!(a.body, "first");
        assert_eq!(b.body, "second");
        assert_eq!(t.requests().len(), 2);
        assert_eq!(t.last_request().unwrap().url, "https://y");
    }

    #[tokio::test]
    async fn stub_streams_sse_lines() {
        let t = StubTransport::new(vec!["data: {\"x\":1}\n\ndata: [DONE]\n"]);
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        t.send_lines(HttpRequest::new("https://x", "{}".into()), tx)
            .await
            .unwrap();
        let mut lines = Vec::new();
        while let Ok(l) = rx.try_recv() {
            lines.push(l);
        }
        assert_eq!(lines[0], "data: {\"x\":1}");
        assert_eq!(lines[2], "data: [DONE]");
    }
}
