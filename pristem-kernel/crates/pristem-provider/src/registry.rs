//! Provider registry and BYOK configuration. Built-ins are installed **through the
//! plugin host**, not hard-wired into the kernel.
//!
//! Three built-in adapters ship by default — OpenAI **Chat Completions**, OpenAI
//! **Responses**, Anthropic **Messages** — and each one is configured independently
//! through `providers` in `config/kernel.json`. One entry = one endpoint, so a second
//! OpenAI-compatible service (proxy, gateway, local llama.cpp) is just another entry
//! with `"adapter": "openai-chat"` and its own `base_url` / `api_key_env`.

use std::collections::BTreeMap;
use std::sync::{Arc, RwLock};

use pristem_plugin::PluginHost;
use serde::{Deserialize, Serialize};

use crate::adapters::{AnthropicAdapter, OpenAiChatAdapter, OpenAiResponsesAdapter};
use crate::transport::Transport;
use crate::types::{Adapter, AdapterProvider, EndpointTuning, Provider, ProviderError};

pub const OPENAI_CHAT: &str = "openai-chat";
pub const OPENAI_RESPONSES: &str = "openai-responses";
pub const ANTHROPIC_MESSAGES: &str = "anthropic-messages";

fn default_true() -> bool {
    true
}

/// Per-endpoint configuration. `adapter` defaults to the map key, so the shipped trio
/// needs no `adapter` field at all.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ProviderEndpoint {
    /// Wire protocol to use: `openai-chat` | `openai-responses` | `anthropic-messages`.
    #[serde(default)]
    pub adapter: Option<String>,
    pub model: String,
    /// Environment variable holding the key (N5: keys never live in the config file).
    #[serde(default)]
    pub api_key_env: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub tuning: EndpointTuning,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Runtime-only override; never serialized, never sourced from conversation content.
    #[serde(default, skip_serializing)]
    pub api_key: Option<String>,
}

impl ProviderEndpoint {
    pub fn new(model: impl Into<String>) -> Self {
        Self {
            adapter: None,
            model: model.into(),
            api_key_env: None,
            base_url: None,
            temperature: None,
            max_tokens: None,
            tuning: EndpointTuning::default(),
            enabled: true,
            api_key: None,
        }
    }

    fn adapter_id(&self, id: &str) -> String {
        self.adapter.clone().unwrap_or_else(|| id.to_string())
    }

    /// OpenAI-compatible endpoints fall back to `OPENAI_API_KEY`; Anthropic to
    /// `ANTHROPIC_API_KEY`. Computed from the *adapter*, never from the entry name, so an
    /// entry called `openai-proxy` still resolves `OPENAI_API_KEY` unless it says otherwise.
    fn key_env_for(adapter: &str) -> &'static str {
        if adapter == ANTHROPIC_MESSAGES {
            "ANTHROPIC_API_KEY"
        } else {
            "OPENAI_API_KEY"
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub default: String,
    pub model: String,
    pub api_key_env: String,
    /// Runtime-only override. Never written back to the config file, never sourced from
    /// conversation content.
    #[serde(default, skip_serializing)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub temperature: Option<f32>,
    /// Answer length ceiling. Anthropic requires one; the kernel loop uses this value.
    #[serde(default)]
    pub max_tokens: Option<u32>,
    /// Per-endpoint tuning (Top P, reasoning, context budget, tool rounds, image support).
    #[serde(default)]
    pub tuning: EndpointTuning,
    /// Stream model output into `RoundEvent::SpeechDelta`. Off by default so existing
    /// scripted transports (which only emit whole bodies) keep working unchanged.
    #[serde(default)]
    pub stream: bool,
    /// Per-endpoint overrides. Empty means "derive the legacy trio from the fields above".
    #[serde(default)]
    pub providers: BTreeMap<String, ProviderEndpoint>,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            default: OPENAI_CHAT.into(),
            model: "gpt-4o".into(),
            api_key_env: "OPENAI_API_KEY".into(),
            api_key: None,
            base_url: None,
            temperature: Some(0.2),
            max_tokens: None,
            tuning: EndpointTuning::default(),
            stream: false,
            providers: BTreeMap::new(),
        }
    }
}

impl ProviderConfig {
    /// N5: BYOK only. Nothing is bundled and there is no free tier.
    pub fn resolve_key(&self) -> Result<String, ProviderError> {
        if let Some(k) = &self.api_key {
            if !k.is_empty() {
                return Ok(k.clone());
            }
        }
        std::env::var(&self.api_key_env)
            .map_err(|_| ProviderError::MissingApiKey(self.api_key_env.clone()))
    }

    pub fn max_tokens_or(&self, fallback: u32) -> u32 {
        self.max_tokens.unwrap_or(fallback)
    }

    /// True when at least one configured endpoint can authenticate right now. The desktop
    /// shell uses this to decide between the live transport and the offline demo one.
    pub fn any_key_present(&self) -> bool {
        if self.api_key.as_deref().is_some_and(|k| !k.is_empty()) {
            return true;
        }
        match self.endpoints() {
            Ok(eps) => eps.values().any(|(_, cfg)| {
                cfg.api_key.as_deref().is_some_and(|k| !k.is_empty())
                    || std::env::var(&cfg.api_key_env)
                        .map(|v| !v.is_empty())
                        .unwrap_or(false)
            }),
            Err(_) => false,
        }
    }

    pub fn endpoint_ids(&self) -> Vec<String> {
        self.endpoints()
            .map(|e| e.keys().cloned().collect())
            .unwrap_or_default()
    }

    pub fn from_env() -> Self {
        let mut cfg = Self::default();
        if let Ok(p) = std::env::var("PRISTEM_PROVIDER") {
            cfg.default = p;
        }
        if let Ok(m) = std::env::var("PRISTEM_MODEL") {
            cfg.model = m;
        }
        if let Ok(u) = std::env::var("PRISTEM_BASE_URL") {
            cfg.base_url = Some(u);
        }
        cfg
    }

    /// Expand `providers` into concrete endpoints. When the map is absent, the shipped
    /// trio is derived from the legacy single-provider fields — that keeps older config
    /// files (and every test written against them) working.
    pub fn endpoints(&self) -> Result<BTreeMap<String, (String, ProviderConfig)>, ProviderError> {
        let mut out = BTreeMap::new();
        if self.providers.is_empty() {
            let openai = self.clone();
            out.insert(
                OPENAI_CHAT.to_string(),
                (OPENAI_CHAT.to_string(), openai.clone()),
            );
            out.insert(
                OPENAI_RESPONSES.to_string(),
                (OPENAI_RESPONSES.to_string(), openai),
            );
            out.insert(
                ANTHROPIC_MESSAGES.to_string(),
                (ANTHROPIC_MESSAGES.to_string(), self.legacy_anthropic()),
            );
            return Ok(out);
        }

        for (id, ep) in &self.providers {
            if !ep.enabled {
                continue;
            }
            let adapter = ep.adapter_id(id);
            match adapter.as_str() {
                OPENAI_CHAT | OPENAI_RESPONSES | ANTHROPIC_MESSAGES => {}
                other => {
                    return Err(ProviderError::Unsupported(format!(
                        "provider `{id}` requests unknown adapter `{other}` (known: {OPENAI_CHAT}, {OPENAI_RESPONSES}, {ANTHROPIC_MESSAGES})"
                    )))
                }
            }
            let cfg = ProviderConfig {
                default: adapter.clone(),
                model: ep.model.clone(),
                api_key_env: ep
                    .api_key_env
                    .clone()
                    .unwrap_or_else(|| ProviderEndpoint::key_env_for(&adapter).to_string()),
                // A process-wide runtime key (CLI --stub, desktop demo) overrides every
                // endpoint; otherwise each endpoint resolves its own env var.
                api_key: ep.api_key.clone().or_else(|| self.api_key.clone()),
                base_url: ep.base_url.clone(),
                temperature: ep.temperature.or(self.temperature),
                max_tokens: ep.max_tokens.or(self.max_tokens),
                tuning: ep.tuning.merged_with(&self.tuning),
                stream: self.stream,
                providers: BTreeMap::new(),
            };
            out.insert(id.clone(), (adapter, cfg));
        }
        Ok(out)
    }

    /// The legacy trio's Anthropic leg. Model/`base_url` are NOT inherited: a base URL
    /// pointed at an OpenAI-compatible gateway must not leak into Anthropic.
    fn legacy_anthropic(&self) -> Self {
        Self {
            default: ANTHROPIC_MESSAGES.into(),
            model: if self.model.starts_with("claude") {
                self.model.clone()
            } else {
                "claude-sonnet-4-5".into()
            },
            api_key_env: "ANTHROPIC_API_KEY".into(),
            api_key: None,
            base_url: None,
            temperature: self.temperature,
            max_tokens: self.max_tokens,
            tuning: self.tuning.clone(),
            stream: self.stream,
            providers: BTreeMap::new(),
        }
    }
}

fn adapter_for(name: &str) -> Option<Arc<dyn Adapter>> {
    match name {
        OPENAI_CHAT => Some(Arc::new(OpenAiChatAdapter)),
        OPENAI_RESPONSES => Some(Arc::new(OpenAiResponsesAdapter)),
        ANTHROPIC_MESSAGES => Some(Arc::new(AnthropicAdapter)),
        _ => None,
    }
}

/// What a client needs to render a provider picker without touching secrets.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderInfo {
    pub id: String,
    pub adapter: String,
    pub model: String,
    pub api_key_env: String,
    pub base_url: Option<String>,
    /// Presence only — the key itself never leaves the process.
    pub key_present: bool,
    pub is_default: bool,
}

pub struct ProviderRegistry {
    providers: RwLock<BTreeMap<String, Arc<AdapterProvider>>>,
    default: RwLock<String>,
}

impl std::fmt::Debug for ProviderRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProviderRegistry")
            .field("ids", &self.ids())
            .field("default", &self.default_id())
            .finish()
    }
}

impl ProviderRegistry {
    pub fn new(default: impl Into<String>) -> Self {
        Self {
            providers: RwLock::new(BTreeMap::new()),
            default: RwLock::new(default.into()),
        }
    }

    /// Registering a provider is ALSO a plugin mount at `ProviderAdapter`, which the host
    /// validates against the in-process allowlist.
    pub fn insert(
        &self,
        provider: Arc<AdapterProvider>,
        host: &PluginHost,
    ) -> Result<(), ProviderError> {
        host.register(provider.as_ref() as &dyn pristem_plugin::Plugin)
            .map_err(|e| ProviderError::Plugin(e.to_string()))?;
        let id = provider.id().to_string();
        self.providers
            .write()
            .map_err(|_| ProviderError::Plugin("registry lock poisoned".into()))?
            .insert(id, provider);
        Ok(())
    }

    pub fn get(&self, id: &str) -> Option<Arc<dyn Provider>> {
        self.providers
            .read()
            .ok()?
            .get(id)
            .map(|p| p.clone() as Arc<dyn Provider>)
    }

    pub fn default(&self) -> Result<Arc<dyn Provider>, ProviderError> {
        let id = self.default_id();
        self.get(&id).ok_or_else(|| {
            ProviderError::Unsupported(format!("default provider `{id}` is not registered"))
        })
    }

    pub fn default_id(&self) -> String {
        self.default
            .read()
            .map(|d| d.clone())
            .unwrap_or_else(|_| OPENAI_CHAT.to_string())
    }

    /// Runtime switch. The agent loop reads the default on every round, so a switch takes
    /// effect on the next round — no session restart.
    pub fn set_default(&self, id: &str) -> Result<(), ProviderError> {
        if !self
            .providers
            .read()
            .map_err(|_| ProviderError::Plugin("registry lock poisoned".into()))?
            .contains_key(id)
        {
            return Err(ProviderError::Unsupported(format!(
                "provider `{id}` is not registered (have: {})",
                self.ids().join(", ")
            )));
        }
        *self
            .default
            .write()
            .map_err(|_| ProviderError::Plugin("registry lock poisoned".into()))? = id.to_string();
        Ok(())
    }

    pub fn ids(&self) -> Vec<String> {
        self.providers
            .read()
            .map(|p| p.keys().cloned().collect())
            .unwrap_or_default()
    }

    pub fn describe(&self) -> Vec<ProviderInfo> {
        let default = self.default_id();
        let Ok(map) = self.providers.read() else {
            return Vec::new();
        };
        map.values()
            .map(|p| {
                let cfg = &p.cfg;
                ProviderInfo {
                    id: p.id().to_string(),
                    adapter: p.adapter.name().to_string(),
                    model: cfg.model.clone(),
                    api_key_env: cfg.api_key_env.clone(),
                    base_url: cfg.base_url.clone(),
                    key_present: cfg.api_key.as_deref().is_some_and(|k| !k.is_empty())
                        || std::env::var(&cfg.api_key_env)
                            .map(|v| !v.is_empty())
                            .unwrap_or(false),
                    is_default: p.id() == default,
                }
            })
            .collect()
    }
}

/// Install every enabled endpoint, mounted as a plugin. `transport` is injected so the
/// CLI's `--stub` mode and every test use a deterministic transport.
pub fn install_builtins(
    cfg: &ProviderConfig,
    transport: Arc<dyn Transport>,
    host: &PluginHost,
) -> Result<ProviderRegistry, ProviderError> {
    let endpoints = cfg.endpoints()?;
    if endpoints.is_empty() {
        return Err(ProviderError::Unsupported(
            "no provider endpoints enabled".into(),
        ));
    }
    let default = cfg.default.clone();
    if !endpoints.contains_key(&default) {
        return Err(ProviderError::Unsupported(format!(
            "default provider `{default}` has no enabled endpoint (have: {})",
            endpoints.keys().cloned().collect::<Vec<_>>().join(", ")
        )));
    }

    let registry = ProviderRegistry::new(default);
    for (id, (adapter_name, endpoint_cfg)) in endpoints {
        let adapter = adapter_for(&adapter_name).ok_or_else(|| {
            ProviderError::Unsupported(format!("unknown adapter `{adapter_name}`"))
        })?;
        let mut provider = AdapterProvider::new(adapter, transport.clone(), endpoint_cfg);
        // `AdapterProvider::id()` reports the adapter name; the registry keys by endpoint
        // id so several endpoints may share one adapter.
        provider.id_override = Some(id);
        registry.insert(Arc::new(provider), host)?;
    }
    Ok(registry)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::StubTransport;
    use crate::types::{CompletionRequest, Message};

    #[test]
    fn config_file_deserializes_without_a_secret() {
        let json = include_str!("../../../config/kernel.json");
        let v: serde_json::Value = serde_json::from_str(json).unwrap();
        let cfg: ProviderConfig = serde_json::from_value(v["provider"].clone()).unwrap();
        assert_eq!(cfg.default, "openai-chat");
        assert_eq!(cfg.api_key_env, "OPENAI_API_KEY");
        assert!(cfg.api_key.is_none());
        assert!(serde_json::to_string(&cfg).unwrap().contains("api_key_env"));
        assert!(!serde_json::to_string(&cfg).unwrap().contains("api_key\":"));
    }

    #[tokio::test]
    async fn builtins_are_registered_as_plugins_and_are_callable() {
        let cfg = ProviderConfig {
            api_key: Some("stub-key".into()),
            ..Default::default()
        };
        let host = PluginHost::default();
        let transport = Arc::new(StubTransport::new(vec![
            r#"{"choices":[{"message":{"content":"ok"}}]}"#,
        ]));
        let registry = install_builtins(&cfg, transport, &host).unwrap();
        assert_eq!(
            registry.ids(),
            vec!["anthropic-messages", "openai-chat", "openai-responses"]
        );
        assert_eq!(
            host.mounted_at(pristem_plugin::MountPoint::ProviderAdapter)
                .len(),
            3
        );

        let reply = registry
            .default()
            .unwrap()
            .complete(CompletionRequest {
                model: "gpt-4o".into(),
                messages: vec![Message::user("hi")],
                tools: Vec::new(),
                temperature: None,
                top_p: None,
                reasoning_effort: None,
                reasoning_param: None,
                stream: false,
                max_tokens: 128,
            })
            .await
            .unwrap();
        assert_eq!(reply.text, "ok");
    }

    #[test]
    fn endpoint_tuning_overrides_global_defaults() {
        use crate::types::EndpointTuning;
        let cfg = ProviderConfig {
            temperature: Some(0.9),
            tuning: EndpointTuning {
                top_p: Some(0.5),
                context_window: Some(32_000),
                max_tool_rounds: Some(20),
                ..Default::default()
            },
            providers: [(
                "local".to_string(),
                ProviderEndpoint {
                    adapter: Some(OPENAI_CHAT.into()),
                    model: "m".into(),
                    temperature: Some(0.1),
                    tuning: EndpointTuning {
                        top_p: Some(0.1),
                        ..Default::default()
                    },
                    ..ProviderEndpoint::new("m")
                },
            )]
            .into_iter()
            .collect(),
            ..Default::default()
        };
        let eps = cfg.endpoints().unwrap();
        let (_, local) = &eps["local"];
        assert_eq!(local.temperature, Some(0.1), "endpoint temperature wins");
        assert_eq!(local.tuning.top_p, Some(0.1), "endpoint wins");
        assert_eq!(
            local.tuning.context_window,
            Some(32_000),
            "global inherited"
        );
        assert_eq!(local.tuning.max_tool_rounds, Some(20), "global inherited");
    }

    #[test]
    fn byok_key_comes_from_env_or_explicit_override_only() {
        let mut cfg = ProviderConfig {
            api_key_env: "PRISTEM_BYOK_TEST_KEY".into(),
            ..Default::default()
        };
        std::env::remove_var("PRISTEM_BYOK_TEST_KEY");
        assert!(matches!(
            cfg.resolve_key(),
            Err(ProviderError::MissingApiKey(_))
        ));
        std::env::set_var("PRISTEM_BYOK_TEST_KEY", "from-env");
        assert_eq!(cfg.resolve_key().unwrap(), "from-env");
        cfg.api_key = Some("override".into());
        assert_eq!(cfg.resolve_key().unwrap(), "override");
        std::env::remove_var("PRISTEM_BYOK_TEST_KEY");
    }

    fn three_endpoints() -> ProviderConfig {
        let mut cfg = ProviderConfig::default();
        cfg.providers.insert(
            OPENAI_CHAT.into(),
            ProviderEndpoint {
                model: "gpt-4o".into(),
                ..ProviderEndpoint::new("gpt-4o")
            },
        );
        cfg.providers
            .insert(OPENAI_RESPONSES.into(), ProviderEndpoint::new("gpt-4.1"));
        cfg.providers.insert(
            ANTHROPIC_MESSAGES.into(),
            ProviderEndpoint {
                model: "claude-sonnet-4-5".into(),
                ..ProviderEndpoint::new("claude-sonnet-4-5")
            },
        );
        cfg
    }

    #[test]
    fn two_openai_endpoints_and_one_anthropic_keep_their_own_model_and_key_env() {
        let cfg = three_endpoints();
        let eps = cfg.endpoints().unwrap();
        assert_eq!(eps.len(), 3);
        assert_eq!(eps[OPENAI_CHAT].1.model, "gpt-4o");
        assert_eq!(eps[OPENAI_CHAT].1.api_key_env, "OPENAI_API_KEY");
        assert_eq!(eps[OPENAI_RESPONSES].1.model, "gpt-4.1");
        assert_eq!(eps[ANTHROPIC_MESSAGES].1.model, "claude-sonnet-4-5");
        assert_eq!(eps[ANTHROPIC_MESSAGES].1.api_key_env, "ANTHROPIC_API_KEY");
    }

    #[test]
    fn a_second_openai_compatible_endpoint_can_share_the_chat_adapter() {
        let mut cfg = three_endpoints();
        cfg.providers.insert(
            "openai-proxy".into(),
            ProviderEndpoint {
                adapter: Some(OPENAI_CHAT.into()),
                model: "qwen3-coder".into(),
                api_key_env: Some("PROXY_API_KEY".into()),
                base_url: Some("http://127.0.0.1:8080/v1/chat/completions".into()),
                temperature: None,
                max_tokens: Some(2048),
                tuning: Default::default(),
                enabled: true,
                api_key: None,
            },
        );
        cfg.default = "openai-proxy".into();
        let host = PluginHost::default();
        let registry = install_builtins(
            &cfg,
            Arc::new(StubTransport::new(Vec::<String>::new())),
            &host,
        )
        .unwrap();
        assert_eq!(registry.ids().len(), 4);
        let p = registry.default().unwrap();
        assert_eq!(p.id(), "openai-proxy");
        assert_eq!(p.model(), "qwen3-coder");
        assert_eq!(p.max_tokens(), 2048);
    }

    #[test]
    fn disabled_endpoints_are_not_registered_and_a_bad_default_is_loud() {
        let mut cfg = three_endpoints();
        cfg.providers.get_mut(ANTHROPIC_MESSAGES).unwrap().enabled = false;
        let host = PluginHost::default();
        let registry = install_builtins(
            &cfg,
            Arc::new(StubTransport::new(Vec::<String>::new())),
            &host,
        )
        .unwrap();
        assert_eq!(registry.ids(), vec!["openai-chat", "openai-responses"]);

        cfg.default = ANTHROPIC_MESSAGES.into();
        let err = install_builtins(
            &cfg,
            Arc::new(StubTransport::new(Vec::<String>::new())),
            &host,
        )
        .unwrap_err();
        assert!(err.to_string().contains("has no enabled endpoint"));
    }

    #[test]
    fn default_can_be_switched_at_runtime() {
        let cfg = three_endpoints();
        let host = PluginHost::default();
        let registry = install_builtins(
            &cfg,
            Arc::new(StubTransport::new(Vec::<String>::new())),
            &host,
        )
        .unwrap();
        assert_eq!(registry.default_id(), OPENAI_CHAT);
        registry.set_default(ANTHROPIC_MESSAGES).unwrap();
        assert_eq!(registry.default().unwrap().id(), ANTHROPIC_MESSAGES);
        assert_eq!(registry.default().unwrap().model(), "claude-sonnet-4-5");
        assert!(registry.set_default("nope").is_err());
        assert_eq!(registry.default_id(), ANTHROPIC_MESSAGES);
    }

    #[test]
    fn describe_reports_key_presence_but_never_the_key() {
        let cfg = three_endpoints();
        let host = PluginHost::default();
        let registry = install_builtins(
            &cfg,
            Arc::new(StubTransport::new(Vec::<String>::new())),
            &host,
        )
        .unwrap();
        let info = registry.describe();
        assert_eq!(info.len(), 3);
        assert!(info.iter().all(|i| !i.key_present));
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("OPENAI_API_KEY"));
        assert!(!json.to_lowercase().contains("sk-"));
    }
}
