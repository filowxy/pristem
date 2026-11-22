//! SSE fan-out. One frame = one `{channel, payload}` JSON line.

use std::sync::{mpsc, Arc, Mutex};

#[derive(Clone)]
pub struct Bus(Arc<Mutex<Vec<mpsc::Sender<String>>>>);

impl Bus {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(Vec::new())))
    }

    pub fn subscribe(&self) -> mpsc::Receiver<String> {
        let (tx, rx) = mpsc::channel();
        if let Ok(mut clients) = self.0.lock() {
            clients.push(tx);
        }
        rx
    }

    pub fn emit(&self, channel: &str, payload: serde_json::Value) {
        let frame = serde_json::json!({ "channel": channel, "payload": payload }).to_string();
        if let Ok(mut clients) = self.0.lock() {
            clients.retain(|c| c.send(frame.clone()).is_ok());
        }
    }
}
