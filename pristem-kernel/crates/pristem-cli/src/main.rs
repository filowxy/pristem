//! `pristem` — thin CLI client. IO and rendering only; all intelligence lives in the
//! kernel service. Runs `goal / coding / deepsleep` (§1). Pass `--stub` to exercise the
//! full round loop with a scripted provider and no API key.

mod render;

use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::sync::Arc;

use clap::Parser;
use pristem_core::{Kernel, KernelConfig, Mode};
use pristem_ipc::{ClientKind, ClientRequest, IpcServer, ServerEvent, PROTOCOL_VERSION};
use pristem_provider::{CompletionRequest, CurlTransport, Message, StubTransport};
use render::Renderer;

#[derive(Parser, Debug)]
#[command(
    name = "pristem",
    version,
    about = "pristem resident agent — thin CLI client"
)]
struct Args {
    /// Initial mode: goal | coding | deepsleep (CLI-visible subset).
    #[arg(short = 'M', long, default_value = "goal")]
    mode: String,

    /// Submit one message and exit (non-interactive).
    #[arg(long)]
    once: bool,

    /// The message for --once / the first interactive turn (`-m`).
    #[arg(short, long)]
    message: Option<String>,

    /// Use a scripted provider transport: no API key, no network.
    #[arg(long)]
    stub: bool,

    /// Disable ANSI colours and OSC 8 hyperlinks.
    #[arg(long)]
    no_ansi: bool,

    /// Kernel config file (defaults to the shipped config/kernel.json).
    #[arg(long)]
    config: Option<PathBuf>,

    /// Override the model.
    #[arg(long)]
    model: Option<String>,

    /// Override the provider base URL.
    #[arg(long)]
    base_url: Option<String>,

    /// Which configured endpoint to use (see `providers` in the kernel config).
    #[arg(long)]
    provider: Option<String>,

    /// Stream model output as it arrives (`speech_delta` events).
    #[arg(long)]
    stream: bool,

    /// Probe every configured provider: key presence, then a tiny live round-trip for the
    /// ones that have a key. No session is opened.
    #[arg(long)]
    probe: bool,
}

fn stub_responses() -> Vec<String> {
    // A canned answer in OpenAI Chat Completions wire shape. Enough to drive the whole
    // loop: assemble -> complete -> parse -> validate -> gate -> answer.
    let body = serde_json::json!({
        "id": "stub-1",
        "choices": [{ "message": { "role": "assistant", "content": "<answer>stub reply: the kernel loop completed without a model key</answer>" } }],
        "usage": { "prompt_tokens": 12, "completion_tokens": 9 }
    })
    .to_string();
    vec![body; 32]
}

fn build_config(args: &Args) -> Result<KernelConfig, String> {
    let mut cfg = match &args.config {
        Some(p) => KernelConfig::load(p).map_err(|e| e.to_string())?,
        None => {
            let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../config/kernel.json");
            KernelConfig::load(&path).map_err(|e| e.to_string())?
        }
    };
    if let Some(m) = &args.model {
        cfg.provider.model = m.clone();
    }
    if let Some(u) = &args.base_url {
        cfg.provider.base_url = Some(u.clone());
    }
    if let Some(p) = &args.provider {
        cfg.provider.default = p.clone();
    }
    if args.stream {
        cfg.provider.stream = true;
    }
    if args.stub {
        // N5 still holds: this is an explicit local override, not a bundled key.
        cfg.provider.api_key = Some("local-stub".into());
    }
    Ok(cfg)
}

#[tokio::main]
async fn main() {
    let args = Args::parse();
    let renderer = Renderer {
        ansi: !args.no_ansi,
    };
    let mode = Mode::parse(&args.mode).unwrap_or_else(|| {
        eprintln!(
            "unknown mode `{}`; CLI modes are goal / coding / deepsleep",
            args.mode
        );
        std::process::exit(2);
    });
    if !Mode::CLI_VISIBLE.contains(&mode) {
        eprintln!(
            "mode `{}` exists in the kernel but is not exposed by this CLI client",
            mode.as_str()
        );
        std::process::exit(2);
    }

    let cfg = match build_config(&args) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("config error: {e}");
            std::process::exit(1);
        }
    };
    let transport: Arc<dyn pristem_provider::Transport> = if args.stub {
        Arc::new(StubTransport::new(stub_responses()))
    } else {
        Arc::new(CurlTransport::new(120))
    };
    let sigdb_version = cfg.sigdb_dir.join("signatures.json");
    let manager = match Kernel::with_config(cfg, transport) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("kernel bootstrap failed: {e}");
            std::process::exit(1);
        }
    };
    if args.probe {
        std::process::exit(probe_providers(&manager).await);
    }

    let version = std::fs::read_to_string(sigdb_version)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v["version"].as_str().map(str::to_string))
        .unwrap_or_else(|| "unknown".into());

    print!(
        "{}",
        renderer.banner(
            PROTOCOL_VERSION,
            &version,
            &Mode::CLI_VISIBLE
                .iter()
                .map(|m| m.as_str().to_string())
                .collect::<Vec<_>>()
        )
    );
    let _ = io::stdout().flush();

    let server = IpcServer::new(manager);
    let conn = server.connect();
    if conn
        .send(ClientRequest::OpenSession {
            mode: mode.as_str().into(),
        })
        .is_err()
    {
        eprintln!("failed to open session");
        std::process::exit(1);
    }
    let mut session = 0u64;
    if let Some(opened) = conn.next_event().await {
        print!("{}", renderer.event(&opened));
        if let ServerEvent::SessionOpened { session: s, .. } = opened {
            session = s;
        }
        let _ = io::stdout().flush();
    }

    // Draw the mode menu as clickable buttons (presentation only, not a capability gate).
    if conn
        .send(ClientRequest::ListModes {
            client: ClientKind::Cli,
        })
        .is_ok()
    {
        if let Some(ev) = conn.next_event().await {
            print!("{}", renderer.event(&ev));
            let _ = io::stdout().flush();
        }
    }

    let first = args.message.clone().unwrap_or_else(|| {
        if args.once {
            "say hello".into()
        } else {
            String::new()
        }
    });
    if args.once || !first.is_empty() {
        run_turn(&conn, &renderer, session, &first).await;
        let _ = conn.send(ClientRequest::CloseSession { session });
        return;
    }

    // Interactive REPL. Lines starting with a digit answer the last button prompt.
    println!(
        "{}",
        renderer.event(&ServerEvent::Speech {
            session,
            text: "Type a message (or a button number), /provider to switch endpoints, empty line to quit.".into()
        })
    );
    let stdin = io::stdin();
    let mut last_buttons: Vec<(u64, String)> = Vec::new();
    loop {
        print!(
            "{}",
            if renderer.ansi {
                "\x1b[36m> \x1b[0m"
            } else {
                "> "
            }
        );
        let _ = io::stdout().flush();
        let mut line = String::new();
        if stdin.lock().read_line(&mut line).unwrap_or(0) == 0 {
            break;
        }
        let line = line.trim().to_string();
        if line.is_empty() {
            break;
        }
        if line == "/provider" || line.starts_with("/provider ") {
            let rest = line.trim_start_matches("/provider").trim().to_string();
            let req = if rest.is_empty() {
                ClientRequest::ListProviders {
                    client: ClientKind::Cli,
                }
            } else {
                ClientRequest::SetProvider {
                    session,
                    provider: rest,
                }
            };
            if conn.send(req).is_ok() {
                if let Some(ev) = conn.next_event().await {
                    print!("{}", renderer.event(&ev));
                    let _ = io::stdout().flush();
                }
            }
            continue;
        }
        if let Ok(n) = line.parse::<usize>() {
            if n >= 1 && n <= last_buttons.len() {
                let (id, choice) = last_buttons[n - 1].clone();
                let _ = conn.send(ClientRequest::Confirm {
                    session,
                    id,
                    choice,
                });
                if let Some(ev) = conn.next_event().await {
                    print!("{}", renderer.event(&ev));
                    let _ = io::stdout().flush();
                }
                continue;
            }
        }
        last_buttons = run_turn(&conn, &renderer, session, &line).await;
    }
    let _ = conn.send(ClientRequest::CloseSession { session });
}

/// Real connectivity check: which endpoints exist, whether a key is present, and — for
/// the ones that do have a key — one minimal live request. Exit code 0 iff at least one
/// endpoint answered.
async fn probe_providers(manager: &Arc<pristem_core::SessionManager>) -> i32 {
    let infos = manager.provider_infos();
    println!("providers ({} configured)", infos.len());
    let mut reachable = 0;
    for info in &infos {
        let marker = if info.is_default { "*" } else { " " };
        println!(
            "{marker} {:<20} adapter={:<20} model={:<24} key={:<7} ({})",
            info.id,
            info.adapter,
            info.model,
            if info.key_present {
                "present"
            } else {
                "MISSING"
            },
            info.api_key_env
        );
        if let Some(base) = &info.base_url {
            println!("    base_url: {base}");
        }
        if !info.key_present {
            continue;
        }
        let Some(provider) = manager.shared.providers.get(&info.id) else {
            continue;
        };
        let req = CompletionRequest {
            model: provider.model().to_string(),
            messages: vec![Message::user("Reply with the single word: ok")],
            tools: Vec::new(),
            temperature: Some(0.0),
            top_p: None,
            reasoning_effort: None,
            reasoning_param: None,
            stream: false,
            max_tokens: 16,
        };
        let started = std::time::Instant::now();
        match provider.complete(req).await {
            Ok(reply) => {
                reachable += 1;
                let text = reply.text.trim().replace('\n', " ");
                let shown: String = text.chars().take(60).collect();
                println!(
                    "    live: ok in {}ms · {:?} · {} in / {} out tokens",
                    started.elapsed().as_millis(),
                    shown,
                    reply.usage.input_tokens,
                    reply.usage.output_tokens
                );
            }
            Err(e) => println!(
                "    live: FAILED after {}ms · {e}",
                started.elapsed().as_millis()
            ),
        }
    }
    if reachable == 0 {
        println!();
        println!(
            "No endpoint answered. Set the key env var(s) above and re-run `pristem --probe`."
        );
        println!("Nothing is bundled by design (N5: BYOK, no free tier).");
        return 1;
    }
    println!();
    println!("{reachable} endpoint(s) answered.");
    0
}

async fn run_turn(
    conn: &pristem_ipc::ClientConnection,
    renderer: &Renderer,
    session: u64,
    text: &str,
) -> Vec<(u64, String)> {
    if conn
        .send(ClientRequest::SubmitRound {
            session,
            text: text.into(),
        })
        .is_err()
    {
        return Vec::new();
    }
    let mut buttons = Vec::new();
    // Drain until the round finishes. Each event is rendered as it streams in.
    for _ in 0..256 {
        let Some(ev) = conn.next_event().await else {
            break;
        };
        if let ServerEvent::Buttons { buttons: bs, .. } = &ev {
            buttons = bs.iter().map(|b| (b.id, b.choice.clone())).collect();
        }
        let finished = matches!(ev, ServerEvent::Finished { .. });
        print!("{}", renderer.event(&ev));
        let _ = io::stdout().flush();
        if finished {
            break;
        }
    }
    buttons
}
