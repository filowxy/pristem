//! App-level model catalogue + DPAPI-protected key store.
//!
//! The kernel owns model access and never persists keys (N5). The desktop shell keeps
//! the user's extra endpoints and their keys outside the repository:
//!   %APPDATA%\pristem\models.json      endpoint catalogue (no secrets)
//!   %APPDATA%\pristem\model-keys.bin   DPAPI(CurrentUser) blob of `{ id: key }`
//!
//! At bootstrap the shell merges both into the kernel config, so the kernel resolves a
//! key exactly like an environment variable without ever learning where it came from.
//! The UI can list `key_present` / `key_source`, never the key itself.

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use pristem_core::KernelConfig;
use pristem_provider::{
    EndpointTuning, ProviderEndpoint, ANTHROPIC_MESSAGES, OPENAI_CHAT, OPENAI_RESPONSES,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ModelEntry {
    pub id: String,
    #[serde(default)]
    pub label: String,
    pub adapter: String,
    pub model: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_output_tokens: Option<u32>,
    #[serde(default)]
    pub top_p: Option<f32>,
    #[serde(default)]
    pub context_window: Option<u32>,
    #[serde(default)]
    pub max_tool_rounds: Option<u32>,
    #[serde(default)]
    pub supports_images: Option<bool>,
    #[serde(default)]
    pub reasoning_param: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
}

impl ModelEntry {
    fn blank(id: &str) -> Self {
        Self {
            id: id.to_string(),
            label: String::new(),
            adapter: String::new(),
            model: String::new(),
            base_url: None,
            temperature: None,
            max_output_tokens: None,
            top_p: None,
            context_window: None,
            max_tool_rounds: None,
            supports_images: None,
            reasoning_param: None,
            reasoning_effort: None,
        }
    }

    fn tuning(&self) -> EndpointTuning {
        EndpointTuning {
            top_p: self.top_p,
            reasoning_effort: self.reasoning_effort.clone(),
            reasoning_param: self.reasoning_param.clone(),
            context_window: self.context_window,
            max_tool_rounds: self.max_tool_rounds.map(|v| v as usize),
            supports_images: self.supports_images,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ModelStore {
    #[serde(default)]
    pub default: Option<String>,
    #[serde(default)]
    pub models: Vec<ModelEntry>,
}

pub(crate) fn app_dir() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("pristem")
}

fn store_path() -> PathBuf {
    app_dir().join("models.json")
}

fn keys_path() -> PathBuf {
    app_dir().join("model-keys.bin")
}

pub fn load_store() -> ModelStore {
    fs::read_to_string(store_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_store(store: &ModelStore) -> Result<(), String> {
    let dir = app_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let body = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(store_path(), body).map_err(|e| format!("write {}: {e}", store_path().display()))
}

pub fn load_keys() -> BTreeMap<String, String> {
    let Ok(blob) = fs::read(keys_path()) else { return BTreeMap::new() };
    let Ok(plain) = unprotect(&blob) else { return BTreeMap::new() };
    serde_json::from_slice(&plain).unwrap_or_default()
}

fn save_keys(keys: &BTreeMap<String, String>) -> Result<(), String> {
    let dir = app_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let plain = serde_json::to_vec(keys).map_err(|e| e.to_string())?;
    let blob = protect(&plain)?;
    fs::write(keys_path(), blob).map_err(|e| format!("write {}: {e}", keys_path().display()))
}

#[cfg(windows)]
fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    let ok = unsafe {
        CryptProtectData(
            &input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err("CryptProtectData failed".into());
    }
    let bytes = unsafe {
        std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec()
    };
    unsafe { LocalFree(output.pbData as *mut core::ffi::c_void) };
    Ok(bytes)
}

#[cfg(windows)]
fn unprotect(blob: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: blob.len() as u32,
        pbData: blob.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    let ok = unsafe {
        CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err("CryptUnprotectData failed".into());
    }
    let bytes = unsafe {
        std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec()
    };
    unsafe { LocalFree(output.pbData as *mut core::ffi::c_void) };
    Ok(bytes)
}

#[cfg(not(windows))]
fn protect(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("DPAPI is Windows-only".into())
}

#[cfg(not(windows))]
fn unprotect(_blob: &[u8]) -> Result<Vec<u8>, String> {
    Err("DPAPI is Windows-only".into())
}

fn key_env_for(adapter: &str) -> &'static str {
    if adapter == ANTHROPIC_MESSAGES {
        "ANTHROPIC_API_KEY"
    } else {
        "OPENAI_API_KEY"
    }
}

fn valid_adapter(adapter: &str) -> bool {
    matches!(adapter, OPENAI_CHAT | OPENAI_RESPONSES | ANTHROPIC_MESSAGES)
}

fn valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit() => {}
        _ => return false,
    }
    id.len() <= 48
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '_' | '.'))
}

fn valid_url(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

/// Optional bounded number: `null` clears it, a number is range-checked.
fn number(req: &Value, key: &str, min: f64, max: f64) -> Result<Option<f64>, String> {
    match req.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => match v.as_f64() {
            Some(n) if n.is_finite() && n >= min && n <= max => Ok(Some(n)),
            _ => Err(format!("invalid {key}")),
        },
    }
}

/// Wire field names stay in ASCII so they can never address an unexpected JSON path.
fn valid_param_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.'))
}

/// Merge the app catalogue into the kernel config and resolve stored keys into memory.
/// Call once, before the provider registry is built.
pub fn apply(cfg: &mut KernelConfig) {
    let store = load_store();
    let keys = load_keys();

    // Legacy configs (no `providers` map) expand to the shipped trio first, otherwise
    // adding a custom endpoint would hide the built-ins from `endpoints()`.
    if cfg.provider.providers.is_empty() {
        for id in [OPENAI_CHAT, OPENAI_RESPONSES, ANTHROPIC_MESSAGES] {
            let anthropic = id == ANTHROPIC_MESSAGES;
            cfg.provider.providers.insert(
                id.to_string(),
                ProviderEndpoint {
                    adapter: Some(id.to_string()),
                    model: if anthropic {
                        "claude-sonnet-4-5".into()
                    } else {
                        cfg.provider.model.clone()
                    },
                    api_key_env: Some(key_env_for(id).to_string()),
                    base_url: if anthropic { None } else { cfg.provider.base_url.clone() },
                    temperature: None,
                    max_tokens: None,
                    tuning: EndpointTuning::default(),
                    enabled: true,
                    api_key: None,
                },
            );
        }
    }

    for model in &store.models {
        cfg.provider.providers.insert(
            model.id.clone(),
            ProviderEndpoint {
                adapter: Some(model.adapter.clone()),
                model: model.model.clone(),
                api_key_env: Some(key_env_for(&model.adapter).to_string()),
                base_url: model.base_url.clone(),
                temperature: model.temperature,
                max_tokens: model.max_output_tokens,
                tuning: model.tuning(),
                enabled: true,
                api_key: keys.get(&model.id).cloned(),
            },
        );
    }

    for (id, endpoint) in cfg.provider.providers.iter_mut() {
        if endpoint.api_key.is_none() {
            endpoint.api_key = keys.get(id).cloned();
        }
    }

    if let Some(default) = store.default.as_ref() {
        if cfg.provider.providers.contains_key(default) {
            cfg.provider.default = default.clone();
        }
    }
}

/// JSON for the settings page. Keys are reduced to presence/source.
pub fn describe(
    kernel_cfg: &Path,
    runtime_ids: &[String],
    runtime_default: &str,
    demo: bool,
) -> Value {
    let store = load_store();
    let keys = load_keys();
    let parsed = KernelConfig::load(kernel_cfg).ok();

    let mut rows: BTreeMap<String, Value> = BTreeMap::new();
    if let Some(cfg) = parsed {
        if let Ok(endpoints) = cfg.provider.endpoints() {
            for (id, (adapter, endpoint)) in endpoints {
                let env_present = std::env::var(&endpoint.api_key_env)
                    .map(|v| !v.is_empty())
                    .unwrap_or(false);
                rows.insert(
                    id.clone(),
                    json!({
                        "id": id,
                        "label": id,
                        "adapter": adapter,
                        "model": endpoint.model,
                        "base_url": endpoint.base_url,
                        "source": "builtin",
                        "key_present": env_present,
                        "key_source": if env_present { "env" } else { "none" },
                        "key_env": endpoint.api_key_env,
                        "temperature": endpoint.temperature,
                        "max_output_tokens": endpoint.max_tokens,
                        "top_p": endpoint.tuning.top_p,
                        "context_window": endpoint.tuning.context_window,
                        "max_tool_rounds": endpoint.tuning.max_tool_rounds,
                        "supports_images": endpoint.tuning.supports_images,
                        "reasoning_param": endpoint.tuning.reasoning_param,
                        "reasoning_effort": endpoint.tuning.reasoning_effort,
                    }),
                );
            }
        }
    }

    for model in &store.models {
        let stored = keys.get(&model.id).map(|k| !k.is_empty()).unwrap_or(false);
        let env_present = std::env::var(key_env_for(&model.adapter))
            .map(|v| !v.is_empty())
            .unwrap_or(false);
        rows.insert(
            model.id.clone(),
            json!({
                "id": model.id,
                "label": if model.label.is_empty() { model.id.clone() } else { model.label.clone() },
                "adapter": model.adapter,
                "model": model.model,
                "base_url": model.base_url,
                "source": "custom",
                "key_present": stored || env_present,
                "key_source": if stored { "stored" } else if env_present { "env" } else { "none" },
                "key_env": key_env_for(&model.adapter),
                "temperature": model.temperature,
                "max_output_tokens": model.max_output_tokens,
                "top_p": model.top_p,
                "context_window": model.context_window,
                "max_tool_rounds": model.max_tool_rounds,
                "supports_images": model.supports_images,
                "reasoning_param": model.reasoning_param,
                "reasoning_effort": model.reasoning_effort,
            }),
        );
    }

    let models: Vec<Value> = rows
        .into_values()
        .map(|mut row| {
            let id = row.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let runtime = runtime_ids.iter().any(|r| r == id);
            row["runtime"] = json!(runtime);
            row
        })
        .collect();

    json!({
        "ok": true,
        "models": models,
        "default": runtime_default,
        "pending_default": store.default,
        "demo": demo,
        "store": store_path().to_string_lossy().replace('\\', "/"),
    })
}

/// Add/update/delete one endpoint and optionally replace its key.
pub fn save(req: &Value) -> Value {
    let mut store = load_store();
    let mut keys = load_keys();

    if req.get("delete").and_then(|v| v.as_bool()).unwrap_or(false) {
        let id = req.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if id.is_empty() {
            return json!({ "ok": false, "error": "missing id" });
        }
        store.models.retain(|m| m.id != id);
        keys.remove(id);
        if store.default.as_deref() == Some(id) {
            store.default = None;
        }
        if let Err(e) = save_store(&store).and_then(|_| save_keys(&keys)) {
            return json!({ "ok": false, "error": e });
        }
        return json!({ "ok": true, "restart": true });
    }

    let id = req.get("id").and_then(|v| v.as_str()).unwrap_or("").trim().to_lowercase();
    let adapter = req.get("adapter").and_then(|v| v.as_str()).unwrap_or("");
    let model = req.get("model").and_then(|v| v.as_str()).unwrap_or("").trim();
    let label = req
        .get("label")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .chars()
        .take(64)
        .collect::<String>();
    let base_url = req
        .get("base_url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .trim_end_matches('/')
        .to_string();
    let api_key = req.get("apiKey").and_then(|v| v.as_str()).unwrap_or("").trim();
    let make_default = req.get("makeDefault").and_then(|v| v.as_bool()).unwrap_or(false);

    if !valid_id(&id) {
        return json!({ "ok": false, "error": "invalid id" });
    }
    if !valid_adapter(adapter) {
        return json!({ "ok": false, "error": "invalid adapter" });
    }
    if model.is_empty() || model.len() > 200 {
        return json!({ "ok": false, "error": "invalid model" });
    }
    if !base_url.is_empty() && (!valid_url(&base_url) || base_url.len() > 500) {
        return json!({ "ok": false, "error": "invalid base_url" });
    }
    if api_key.len() > 512 || api_key.chars().any(|c| c.is_control()) {
        return json!({ "ok": false, "error": "invalid api key" });
    }

    // Editing keeps whatever this dialog did not send (e.g. the key-only dialog).
    let mut entry = store
        .models
        .iter()
        .find(|m| m.id == id)
        .cloned()
        .unwrap_or_else(|| ModelEntry::blank(&id));
    entry.id = id.clone();
    entry.label = if label.is_empty() { id.clone() } else { label };
    entry.adapter = adapter.to_string();
    entry.model = model.to_string();
    entry.base_url = (!base_url.is_empty()).then_some(base_url);

    if req.get("temperature").is_some() {
        match number(req, "temperature", 0.0, 2.0) {
            Ok(v) => entry.temperature = v.map(|n| n as f32),
            Err(e) => return json!({ "ok": false, "error": e }),
        }
    }
    if req.get("top_p").is_some() {
        match number(req, "top_p", 0.0, 1.0) {
            Ok(v) => entry.top_p = v.map(|n| n as f32),
            Err(e) => return json!({ "ok": false, "error": e }),
        }
    }
    if req.get("max_output_tokens").is_some() {
        match number(req, "max_output_tokens", 1.0, 131_072.0) {
            Ok(v) => entry.max_output_tokens = v.map(|n| n as u32),
            Err(e) => return json!({ "ok": false, "error": e }),
        }
    }
    if req.get("context_window").is_some() {
        match number(req, "context_window", 1_024.0, 4_000_000.0) {
            Ok(v) => entry.context_window = v.map(|n| n as u32),
            Err(e) => return json!({ "ok": false, "error": e }),
        }
    }
    if req.get("max_tool_rounds").is_some() {
        match number(req, "max_tool_rounds", 1.0, 1_000.0) {
            Ok(v) => entry.max_tool_rounds = v.map(|n| n as u32),
            Err(e) => return json!({ "ok": false, "error": e }),
        }
    }
    if req.get("supports_images").is_some() {
        match req.get("supports_images") {
            Some(Value::Bool(b)) => entry.supports_images = Some(*b),
            Some(Value::Null) => entry.supports_images = None,
            _ => return json!({ "ok": false, "error": "invalid supports_images" }),
        }
    }
    if req.get("reasoning_param").is_some() {
        let raw = req.get("reasoning_param").and_then(|v| v.as_str()).unwrap_or("").trim();
        if raw.is_empty() {
            entry.reasoning_param = None;
        } else if !valid_param_name(raw) {
            return json!({ "ok": false, "error": "invalid reasoning_param" });
        } else {
            entry.reasoning_param = Some(raw.to_string());
        }
    }
    if req.get("reasoning_effort").is_some() {
        let raw = req.get("reasoning_effort").and_then(|v| v.as_str()).unwrap_or("").trim();
        if raw.is_empty() {
            entry.reasoning_effort = None;
        } else if raw.len() > 64 || raw.chars().any(char::is_control) {
            return json!({ "ok": false, "error": "invalid reasoning_effort" });
        } else {
            entry.reasoning_effort = Some(raw.to_string());
        }
    }

    match store.models.iter_mut().find(|m| m.id == id) {
        Some(slot) => *slot = entry,
        None => store.models.push(entry),
    }
    if !api_key.is_empty() {
        keys.insert(id.clone(), api_key.to_string());
    }
    if make_default {
        store.default = Some(id.clone());
    }

    if let Err(e) = save_store(&store).and_then(|_| save_keys(&keys)) {
        return json!({ "ok": false, "error": e });
    }
    json!({ "ok": true, "restart": true })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_and_url_validation() {
        assert!(valid_id("deepseek"));
        assert!(valid_id("my-proxy.2"));
        assert!(!valid_id("DeepSeek"));
        assert!(!valid_id("-proxy"));
        assert!(!valid_id("bad id"));
        assert!(valid_adapter(OPENAI_CHAT));
        assert!(valid_adapter(ANTHROPIC_MESSAGES));
        assert!(!valid_adapter("openai"));
        assert!(valid_url("https://api.example.com/v1"));
        assert!(!valid_url("api.example.com"));
    }

    #[test]
    fn tuning_numbers_are_bounded_and_optional() {
        let req = json!({ "temperature": 0.7, "top_p": null, "context_window": 128_000 });
        assert_eq!(number(&req, "temperature", 0.0, 2.0).unwrap(), Some(0.7));
        assert_eq!(number(&req, "top_p", 0.0, 1.0).unwrap(), None);
        assert_eq!(number(&req, "context_window", 1024.0, 4_000_000.0).unwrap(), Some(128_000.0));
        assert!(number(&req, "missing", 0.0, 1.0).unwrap().is_none());

        let bad = json!({ "top_p": 1.5, "temperature": -0.1 });
        assert!(number(&bad, "top_p", 0.0, 1.0).is_err());
        assert!(number(&bad, "temperature", 0.0, 2.0).is_err());
    }

    #[test]
    fn reasoning_parameter_names_reject_json_injection() {
        assert!(valid_param_name("reasoning_effort"));
        assert!(valid_param_name("thinking.effort"));
        assert!(!valid_param_name(""));
        assert!(!valid_param_name("bad param"));
        assert!(!valid_param_name("a/b"));
        assert!(!valid_param_name("温度"));
    }

    #[cfg(windows)]
    #[test]
    fn dpapi_round_trip() {
        let plain = br#"{"deepseek":"sk-test-123"}"#;
        let blob = protect(plain).expect("protect");
        assert_ne!(blob, plain);
        let back = unprotect(&blob).expect("unprotect");
        assert_eq!(back, plain);
    }
}
