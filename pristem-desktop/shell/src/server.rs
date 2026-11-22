//! Minimal HTTP + SSE transport. No framework, no Node process, no extra runtime.
//! The WebView sends `ClientRequest` JSON to /api/request and receives `ServerEvent`
//! JSON frames over /api/events. Everything else is static assets.

use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::Path,
    sync::{mpsc::RecvTimeoutError, Arc},
    time::Duration,
};

use pristem_ipc::ClientRequest;
use serde_json::{json, Value};

use crate::{io, AppState};

pub fn run(listener: TcpListener, state: Arc<AppState>) {
    for stream in listener.incoming() {
        if let Ok(stream) = stream {
            let st = state.clone();
            std::thread::spawn(move || handle_connection(stream, st));
        }
    }
}

fn handle_connection(mut stream: TcpStream, st: Arc<AppState>) {
    let _ = stream.set_nodelay(true);
    let reader_stream = match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    };
    let mut reader = BufReader::new(reader_stream);

    let mut first = String::new();
    if reader.read_line(&mut first).unwrap_or(0) == 0 { return; }
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let full_path = parts.next().unwrap_or("/").to_string();

    let mut content_len = 0usize;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 { break; }
        if line == "\r\n" || line == "\n" { break; }
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("content-length") {
                content_len = v.trim().parse().unwrap_or(0);
            }
        }
    }
    let mut body = vec![0u8; content_len.min(4 * 1024 * 1024)];
    if content_len > 0 { let _ = reader.read_exact(&mut body); }

    let path = full_path.split('?').next().unwrap_or("/").to_string();
    match (method.as_str(), path.as_str()) {
        ("GET", "/api/ping") => write_response(&mut stream, "200 OK", "text/plain", b"ok", ""),
        ("GET", "/api/events") => sse(&mut stream, &st),
        ("POST", "/api/request") => {
            match serde_json::from_slice::<ClientRequest>(&body) {
                Ok(req) => {
                    match st.conn.send(req) {
                        Ok(()) => write_response(&mut stream, "200 OK", "application/json", b"{\"ok\":true}", ""),
                        Err(e) => {
                            let out = json!({ "error": e.to_string() }).to_string();
                            write_response(&mut stream, "503 Service Unavailable", "application/json", out.as_bytes(), "");
                        }
                    }
                }
                Err(e) => {
                    let out = json!({ "error": format!("bad ClientRequest: {e}") }).to_string();
                    write_response(&mut stream, "400 Bad Request", "application/json", out.as_bytes(), "");
                }
            }
        }
        ("POST", "/api/io") => {
            let req: Value = serde_json::from_slice(&body).unwrap_or(json!({}));
            let out = io::handle(req, &st).to_string();
            write_response(&mut stream, "200 OK", "application/json", out.as_bytes(), "");
        }
        ("OPTIONS", _) => write_response(
            &mut stream, "204 No Content", "text/plain", b"",
            "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: content-type\r\n",
        ),
        ("GET", p) => serve_static(&mut stream, &st.ui_dir, p),
        _ => write_response(&mut stream, "404 Not Found", "text/plain", b"not found", ""),
    }
}

fn write_response(stream: &mut TcpStream, status: &str, ct: &str, body: &[u8], extra: &str) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {ct}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\nConnection: close\r\n{extra}\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn sse(stream: &mut TcpStream, st: &Arc<AppState>) {
    let rx = st.bus.subscribe();
    let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\nAccess-Control-Allow-Origin: *\r\nX-Accel-Buffering: no\r\n\r\n";
    if stream.write_all(head.as_bytes()).is_err() { return; }
    let _ = stream.write_all(b": connected\n\n");
    let _ = stream.flush();
    loop {
        match rx.recv_timeout(Duration::from_secs(15)) {
            Ok(frame) => {
                if stream.write_all(format!("data: {frame}\n\n").as_bytes()).is_err() { break; }
                if stream.flush().is_err() { break; }
            }
            Err(RecvTimeoutError::Timeout) => {
                if stream.write_all(b": ping\n\n").is_err() { break; }
                if stream.flush().is_err() { break; }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn content_type(p: &Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase().as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn serve_static(stream: &mut TcpStream, ui_dir: &Path, p: &str) {
    let rel = p.trim_start_matches('/');
    let rel = if rel.is_empty() { "index.html" } else { rel };
    if rel.contains("..") {
        write_response(stream, "404 Not Found", "text/plain", b"not found", "");
        return;
    }
    let mut file = ui_dir.join(rel);
    if !file.is_file() { file = ui_dir.join("index.html"); }
    match fs::read(&file) {
        Ok(data) => write_response(stream, "200 OK", content_type(&file), &data, ""),
        Err(_) => write_response(stream, "404 Not Found", "text/plain", b"ui/dist not built", ""),
    }
}
