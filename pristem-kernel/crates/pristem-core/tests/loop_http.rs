//! The whole chain, over real HTTP: agent loop → provider adapter → `CurlTransport` →
//! loopback mock server, with streaming on and a tool call in the middle.
//!
//! This is the test that would have caught "the loop only ever ran against a stub": two
//! rounds, two real POSTs, SSE on both, a tool call executed between them, and an answer
//! assembled from streamed fragments.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;

use pristem_core::{Kernel, KernelConfig, Mode, RoundEvent, RoundOutcome};
use pristem_provider::{CurlTransport, ProviderConfig, ProviderEndpoint, StubTransport, Transport};

struct MockApi {
    port: u16,
    seen: Arc<Mutex<Vec<String>>>,
}

impl MockApi {
    /// Serves `bodies` in order, one SSE response per request.
    fn new(bodies: Vec<String>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        thread::spawn(move || {
            for body in bodies {
                let Ok((stream, _)) = listener.accept() else {
                    return;
                };
                serve(stream, &body, &sink);
            }
        });
        Self { port, seen }
    }

    fn url(&self) -> String {
        format!("http://127.0.0.1:{}/v1/chat/completions", self.port)
    }

    fn requests(&self) -> Vec<String> {
        self.seen.lock().unwrap().clone()
    }
}

fn serve(mut stream: TcpStream, body: &str, sink: &Mutex<Vec<String>>) {
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut head = String::new();
    let mut len = 0usize;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
            break;
        }
        if let Some(rest) = line.to_ascii_lowercase().strip_prefix("content-length:") {
            len = rest.trim().parse().unwrap_or(0);
        }
        head.push_str(&line);
    }
    let mut payload = vec![0u8; len];
    let _ = reader.read_exact(&mut payload);
    sink.lock()
        .unwrap()
        .push(format!("{head}\n{}", String::from_utf8_lossy(&payload)));

    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn sse(content: &str) -> String {
    let chunk = serde_json::json!({ "choices": [{ "delta": { "content": content } }] });
    format!("data: {chunk}\n\ndata: [DONE]\n")
}

fn config(api: &MockApi) -> KernelConfig {
    let mut cfg = Kernel::test_config();
    let mut provider = ProviderConfig {
        default: "loopback".into(),
        stream: true,
        ..Default::default()
    };
    provider.providers.insert(
        "loopback".into(),
        ProviderEndpoint {
            adapter: Some("openai-chat".into()),
            model: "mock-model".into(),
            api_key_env: None,
            base_url: Some(api.url()),
            temperature: Some(0.0),
            max_tokens: Some(256),
            tuning: Default::default(),
            enabled: true,
            api_key: Some("test-key".into()),
        },
    );
    cfg.provider = provider;
    cfg
}

#[tokio::test]
async fn the_loop_talks_to_a_real_http_endpoint_streams_and_runs_a_tool_call() {
    let api = MockApi::new(vec![
        sse("<call tool=\"read\" path=\"note.txt\"/>"),
        sse("<answer>read it over http</answer>"),
    ]);
    let transport: Arc<dyn Transport> = Arc::new(CurlTransport::new(10));
    let kernel = Kernel::with_config(config(&api), transport).unwrap();
    std::fs::write(
        kernel.shared.workspace.root().join("note.txt"),
        "content over the wire",
    )
    .unwrap();

    let id = kernel.open(Mode::Coding).await.unwrap();
    let obs = pristem_core::RecordingObserver::default();
    let outcome = kernel.submit(id, "read note.txt", &obs).await.unwrap();
    assert_eq!(outcome, RoundOutcome::Answer("read it over http".into()));

    let requests = api.requests();
    assert_eq!(requests.len(), 2, "one POST per round");
    assert!(requests[0].contains("POST /v1/chat/completions"));
    assert!(requests[0]
        .to_ascii_lowercase()
        .contains("accept: text/event-stream"));
    assert!(requests[0].contains(r#""model":"mock-model""#));
    // Round two must carry the tool result back to the model.
    assert!(
        requests[1].contains("content over the wire"),
        "tool output never made it into the next request:\n{}",
        requests[1]
    );

    let events = obs.snapshot();
    let streamed: String = events
        .iter()
        .filter_map(|e| match e {
            RoundEvent::SpeechDelta(t) => Some(t.clone()),
            _ => None,
        })
        .collect();
    assert!(streamed.contains("read it over http"), "deltas: {streamed}");
    assert!(events
        .iter()
        .any(|e| matches!(e, RoundEvent::Call { tool, .. } if tool == "read")));
    assert!(events
        .iter()
        .any(|e| matches!(e, RoundEvent::Answer(t) if t == "read it over http")));
    kernel.close(id).unwrap();
}

/// A provider that is configured but unreachable must fail loudly, not answer something.
#[tokio::test]
async fn an_unreachable_endpoint_surfaces_as_a_provider_error() {
    let mut cfg = Kernel::test_config();
    let mut provider = ProviderConfig {
        default: "dead".into(),
        ..Default::default()
    };
    provider.providers.insert(
        "dead".into(),
        ProviderEndpoint {
            adapter: Some("openai-chat".into()),
            model: "mock-model".into(),
            api_key_env: None,
            // Port 1 is guaranteed closed; curl fails fast.
            base_url: Some("http://127.0.0.1:1/v1/chat/completions".into()),
            temperature: None,
            max_tokens: None,
            tuning: Default::default(),
            enabled: true,
            api_key: Some("test-key".into()),
        },
    );
    cfg.provider = provider;
    let kernel = Kernel::with_config(cfg, Arc::new(CurlTransport::new(5))).unwrap();
    let id = kernel.open(Mode::Goal).await.unwrap();
    let err = kernel
        .submit(id, "hi", &pristem_core::RecordingObserver::default())
        .await
        .unwrap_err();
    let text = err.to_string();
    assert!(
        text.contains("transport error") || text.contains("provider"),
        "unexpected error: {text}"
    );
    kernel.close(id).unwrap();
}

/// Guards the stub path against a streaming regression in the other direction.
#[tokio::test]
async fn the_blocking_path_still_works_when_stream_is_off() {
    let mut cfg = Kernel::test_config();
    cfg.provider.stream = false;
    let kernel = Kernel::with_config(
        cfg,
        Arc::new(StubTransport::new(vec![
            r#"{"choices":[{"message":{"content":"<answer>blocking</answer>"}}]}"#,
        ])),
    )
    .unwrap();
    let id = kernel.open(Mode::Goal).await.unwrap();
    let out = kernel
        .submit(id, "hi", &pristem_core::RecordingObserver::default())
        .await
        .unwrap();
    assert_eq!(out, RoundOutcome::Answer("blocking".into()));
    kernel.close(id).unwrap();
}
