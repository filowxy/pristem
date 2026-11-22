//! End-to-end transport proof with **no external network and no API key**.
//!
//! A loopback HTTP server plus the real [`CurlTransport`] covers what unit tests cannot:
//! that curl is actually spawned, that auth headers leave the process, that a 401 is
//! reported as a 401 instead of "malformed JSON", and that SSE frames survive the pipe
//! into the stream assembler. It is the same code path a live BYOK round takes — only the
//! host is `127.0.0.1`.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;

use pristem_plugin::PluginHost;
use pristem_provider::{
    install_builtins, CompletionRequest, CurlTransport, Message, ProviderConfig, ProviderEndpoint,
    ProviderError, StreamChunk,
};

const KEY: &str = "test-key-123";

struct Mock {
    port: u16,
    /// Raw `headers + body` of every request the mock received.
    seen: Arc<Mutex<Vec<String>>>,
    done: Option<thread::JoinHandle<()>>,
}

impl Mock {
    fn new(status: u16, content_type: &str, body: String) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
        let port = listener.local_addr().unwrap().port();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        let ct = content_type.to_string();
        let done = thread::spawn(move || {
            if let Ok((stream, _)) = listener.accept() {
                serve(stream, status, &ct, &body, &sink);
            }
        });
        Self {
            port,
            seen,
            done: Some(done),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{}", self.port, path)
    }

    fn request(&mut self) -> String {
        if let Some(h) = self.done.take() {
            let _ = h.join();
        }
        self.seen
            .lock()
            .unwrap()
            .first()
            .cloned()
            .unwrap_or_default()
    }
}

fn serve(mut stream: TcpStream, status: u16, ct: &str, body: &str, sink: &Mutex<Vec<String>>) {
    let mut reader = BufReader::new(stream.try_clone().expect("clone socket"));
    let mut head = String::new();
    let mut content_length = 0usize;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
            break;
        }
        let lower = line.to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix("content-length:") {
            content_length = rest.trim().parse().unwrap_or(0);
        }
        head.push_str(&line);
    }
    let mut payload = vec![0u8; content_length];
    let _ = reader.read_exact(&mut payload);
    sink.lock()
        .unwrap()
        .push(format!("{head}\n{}", String::from_utf8_lossy(&payload)));

    let response = format!(
        "HTTP/1.1 {status} status\r\nContent-Type: {ct}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn endpoint(id: &str, adapter: &str, base_url: String, model: &str) -> ProviderConfig {
    let mut cfg = ProviderConfig {
        default: id.to_string(),
        api_key: Some(KEY.to_string()),
        ..Default::default()
    };
    cfg.providers.insert(
        id.to_string(),
        ProviderEndpoint {
            adapter: Some(adapter.to_string()),
            model: model.to_string(),
            api_key_env: None,
            base_url: Some(base_url),
            temperature: None,
            max_tokens: Some(64),
            tuning: Default::default(),
            enabled: true,
            api_key: None,
        },
    );
    cfg
}

fn request(text: &str) -> CompletionRequest {
    CompletionRequest {
        model: String::new(),
        messages: vec![Message::user(text)],
        tools: Vec::new(),
        temperature: Some(0.0),
        top_p: None,
        reasoning_effort: None,
        reasoning_param: None,
        stream: false,
        max_tokens: 64,
    }
}

#[tokio::test]
async fn openai_chat_round_trips_through_real_curl() {
    let mut mock = Mock::new(
        200,
        "application/json",
        r#"{"id":"chatcmpl-1","choices":[{"message":{"role":"assistant","content":"hello from loopback"}}],"usage":{"prompt_tokens":5,"completion_tokens":3}}"#.into(),
    );
    let cfg = endpoint(
        "openai-chat",
        "openai-chat",
        mock.url("/v1/chat/completions"),
        "gpt-4o-mini",
    );
    let host = PluginHost::default();
    let registry = install_builtins(&cfg, Arc::new(CurlTransport::new(10)), &host).unwrap();
    let provider = registry.default().unwrap();

    let reply = provider.complete(request("ping")).await.unwrap();
    assert_eq!(reply.text, "hello from loopback");
    assert_eq!(reply.usage.input_tokens, 5);

    let seen = mock.request();
    let lower = seen.to_ascii_lowercase();
    assert!(
        lower.contains(&format!("authorization: bearer {}", KEY.to_lowercase())),
        "auth header missing:\n{seen}"
    );
    assert!(
        lower.contains("accept: application/json"),
        "accept header:\n{seen}"
    );
    assert!(
        seen.contains(r#""model":"gpt-4o-mini""#),
        "model from the endpoint config must reach the wire:\n{seen}"
    );
    assert!(seen.contains("POST /v1/chat/completions"), "path:\n{seen}");
}

/// The second OpenAI wire (Responses) must travel the same real path: different URL,
/// different body shape, same transport and auth.
#[tokio::test]
async fn openai_responses_round_trips_through_real_curl() {
    let mut mock = Mock::new(
        200,
        "application/json",
        r#"{"id":"resp_1","output":[{"type":"reasoning","summary":[{"text":"thought"}]},{"type":"message","content":[{"type":"output_text","text":"answered by responses"}]}],"usage":{"input_tokens":4,"output_tokens":2}}"#.into(),
    );
    let cfg = endpoint(
        "openai-responses",
        "openai-responses",
        mock.url("/v1/responses"),
        "gpt-4.1",
    );
    let host = PluginHost::default();
    let registry = install_builtins(&cfg, Arc::new(CurlTransport::new(10)), &host).unwrap();

    let reply = registry
        .default()
        .unwrap()
        .complete(request("ping"))
        .await
        .unwrap();
    assert_eq!(reply.text, "answered by responses");
    assert_eq!(reply.thinking.summary.as_deref(), Some("thought"));

    let seen = mock.request();
    let lower = seen.to_ascii_lowercase();
    assert!(
        lower.contains("authorization: bearer test-key-123"),
        "{seen}"
    );
    assert!(seen.contains("POST /v1/responses"), "{seen}");
    assert!(
        seen.contains("\"input\":["),
        "responses API uses input[], not messages[]:\n{seen}"
    );
    assert!(seen.contains(r#""model":"gpt-4.1""#), "{seen}");
}

#[tokio::test]
async fn a_401_is_reported_as_an_http_error_not_as_bad_json() {
    let mut mock = Mock::new(
        401,
        "application/json",
        r#"{"error":{"type":"authentication_error","message":"invalid x-api-key"}}"#.into(),
    );
    let cfg = endpoint(
        "anthropic-messages",
        "anthropic-messages",
        mock.url("/v1/messages"),
        "claude-sonnet-4-5",
    );
    let host = PluginHost::default();
    let registry = install_builtins(&cfg, Arc::new(CurlTransport::new(10)), &host).unwrap();

    let err = registry
        .default()
        .unwrap()
        .complete(request("ping"))
        .await
        .unwrap_err();
    match err {
        ProviderError::Http(status, body) => {
            assert_eq!(status, 401);
            assert!(body.contains("invalid x-api-key"), "{body}");
        }
        other => panic!("expected Http(401, ..), got {other:?}"),
    }

    let seen = mock.request();
    let lower = seen.to_ascii_lowercase();
    assert!(lower.contains("x-api-key: test-key-123"), "{seen}");
    assert!(lower.contains("anthropic-version: 2023-06-01"), "{seen}");
}

#[tokio::test]
async fn anthropic_sse_streams_through_curl_and_assembles_a_tool_call() {
    let sse = [
        r#"event: message_start"#,
        r#"data: {"type":"message_start","message":{"usage":{"input_tokens":9}}}"#,
        r#""#,
        r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"looking"}}"#,
        r#""#,
        r#"data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu_1","name":"read","input":{}}}"#,
        r#""#,
        r#"data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"path\":\"note.txt\"}"}}"#,
        r#""#,
        r#"data: {"type":"message_delta","usage":{"output_tokens":4}}"#,
        r#""#,
        r#"data: {"type":"message_stop"}"#,
        r#""#,
    ]
    .join("\n");
    let mut mock = Mock::new(200, "text/event-stream", sse);
    let cfg = endpoint(
        "anthropic-messages",
        "anthropic-messages",
        mock.url("/v1/messages"),
        "claude-sonnet-4-5",
    );
    let host = PluginHost::default();
    let registry = install_builtins(&cfg, Arc::new(CurlTransport::new(10)), &host).unwrap();
    let provider = registry.default().unwrap();

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<StreamChunk>();
    let mut liveness = Vec::new();
    let collect = async {
        while let Some(chunk) = rx.recv().await {
            if !chunk.delta.is_empty() {
                liveness.push(chunk.delta);
            }
        }
    };
    let (result, ()) = tokio::join!(provider.stream(request("look at note.txt"), tx), collect);
    let reply = result.unwrap();

    assert_eq!(liveness.join(""), "looking");
    assert_eq!(reply.text, "looking");
    assert_eq!(reply.tool_calls.len(), 1);
    assert_eq!(reply.tool_calls[0].tool, "read");
    assert_eq!(reply.tool_calls[0].args["path"], "note.txt");
    assert_eq!(reply.usage.input_tokens, 9);
    assert_eq!(reply.usage.output_tokens, 4);

    let seen = mock.request();
    let lower = seen.to_ascii_lowercase();
    assert!(lower.contains("accept: text/event-stream"), "{seen}");
    assert!(seen.contains(r#""stream":true"#), "{seen}");
}
