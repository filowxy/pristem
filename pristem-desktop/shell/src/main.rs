//! pristem desktop client — a native tao/wry window, NOT Tauri, NOT a browser tab.
//!
//! Architecture (one process, no Node, no Electron):
//!   WebView (rendering only) ──HTTP/SSE──▶ this Rust shell ──▶ pristem_ipc::IpcServer
//!                                                          ──▶ pristem-core (all intelligence)
//!
//! The UI never decides mode semantics: it sends `ClientRequest` and re-renders only
//! when a `ServerEvent` arrives. Mode transitions come back as `mode_changed`.
//!
//! Run:
//!   cargo run                 → native desktop window (default)
//!   cargo run -- --no-window  → headless service, open http://127.0.0.1:8787

mod bus;
mod demo;
mod io;
mod models;
mod server;
mod term;

use std::{
    net::TcpListener,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use pristem_core::{Kernel, KernelConfig};
use pristem_ipc::{ClientConnection, IpcServer};
use pristem_provider::Transport;
use tao::{
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy},
    window::WindowBuilder,
};
use wry::WebViewBuilder;

use crate::bus::Bus;

#[derive(Debug, Clone, Copy)]
pub enum WindowOp {
    Minimize,
    Maximize,
    Close,
    Drag,
}

#[derive(Debug)]
pub enum UserEvent {
    Window(WindowOp),
}

pub struct AppState {
    pub bus: Bus,
    pub conn: Arc<ClientConnection>,
    pub root: Mutex<PathBuf>,
    pub ui_dir: PathBuf,
    pub term: term::TermRegistry,
    pub kernel_cfg: PathBuf,
    /// Endpoints the running kernel actually registered (pre-restart additions are absent).
    pub runtime_models: Vec<String>,
    pub runtime_default: String,
    /// True when no real key was found and the offline DemoTransport is serving.
    pub demo: bool,
    /// `--no-window`: there is no native window, so no native dialog either.
    pub headless: bool,
    // Mutex keeps AppState Sync even if the platform EventLoopProxy is Send-only.
    pub proxy: Mutex<EventLoopProxy<UserEvent>>,
}

impl AppState {
    pub fn window_op(&self, op: WindowOp) {
        if let Ok(proxy) = self.proxy.lock() {
            let _ = proxy.send_event(UserEvent::Window(op));
        }
    }
}

fn main() {
    // A shell that fails to initialize under ConPTY (0xC0000142) would otherwise
    // pop a system hard-error dialog and block the terminal. Suppress the dialog
    // process-wide; children inherit the error mode. term.rs then falls back.
    #[cfg(windows)]
    unsafe {
        windows_sys::Win32::System::Diagnostics::Debug::SetErrorMode(0x0001 | 0x0002 | 0x8000);
    }
    let no_window = std::env::args().any(|a| a == "--no-window");
    // The desktop suite attaches to the real WebView2 over CDP. Only when the
    // test asks for it; a normal launch keeps the debugging port closed.
    #[cfg(windows)]
    if let Ok(port) = std::env::var("PR_DEBUG_PORT") {
        let args = format!("--remote-debugging-port={port}");
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", args);
    }
    // Explicit port keeps automated suites isolated from a desktop instance on 8787.
    let requested_port = std::env::args()
        .position(|a| a == "--port")
        .and_then(|i| std::env::args().nth(i + 1))
        .and_then(|p| p.parse::<u16>().ok());
    let shell_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let desktop_dir = shell_dir.parent().unwrap().to_path_buf();
    let project_root = desktop_dir.parent().unwrap().to_path_buf();
    let kernel_dir = project_root.join("pristem-kernel");
    let ui_dir = desktop_dir.join("ui").join("dist");

    // IpcServer::connect() spawns onto Tokio, so the runtime must already be
    // entered before the kernel is bootstrapped.
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    let _rt_guard = rt.enter();

    // --- kernel bootstrap: real config, real sigdb, real six-mode router --------
    let mut cfg = KernelConfig::load(&kernel_dir.join("config").join("kernel.json"))
        .expect("load pristem-kernel/config/kernel.json");
    cfg.workspace_root = project_root.clone();
    cfg.sigdb_dir = kernel_dir.join("sigdb");

    // User-added endpoints and DPAPI-protected keys are applied before the registry is
    // built. The kernel sees them as ordinary endpoint configs; no key is ever written
    // into the repository or sent to the UI.
    models::apply(&mut cfg);

    // Live when any configured endpoint can authenticate (stored key or env var);
    // otherwise fall back to the offline demo transport and say so in the settings page.
    let live = cfg.provider.any_key_present();
    if !live {
        cfg.provider.api_key = Some("local-demo".into());
    }
    let runtime_models = cfg.provider.endpoint_ids();
    let runtime_default = cfg.provider.default.clone();

    let transport: Arc<dyn Transport> = if live {
        Arc::new(pristem_provider::CurlTransport::new(120))
    } else {
        Arc::new(demo::DemoTransport::new())
    };
    println!(
        "provider: {} · {} · model {}",
        cfg.provider.default,
        if live { "live (BYOK)" } else { "offline demo (no key found)" },
        cfg.provider.model
    );

    let manager = Kernel::with_config(cfg, transport).expect("kernel bootstrap failed");

    // Demo data in the SERVICE (not the UI): seed the cross-session REMINDER store
    // so list_reminders has real committed rules to present as a wake briefing.
    // Production gets these from the deepsleep digestion engine, not from here.
    manager.shared.harness.reminders.set_global(
        pristem_harness::reminder::Reminder::new(
            "demo-committed-rules",
            &[
                "Presence is spatial: dormant modes render no AI surface at all.",
                "Annotations are recorded, not endorsed — analysis is not approval.",
                "File work in goal mode stays silent (owner OPEN QUESTION).",
            ],
            "demo-bootstrap",
        ),
    );

    let ipc = IpcServer::new(manager);
    let conn = Arc::new(ipc.connect());
    let _keep_ipc_alive = ipc;

    let bus = Bus::new();
    let pump_conn = conn.clone();
    let pump_bus = bus.clone();
    rt.spawn(async move {
        while let Some(ev) = pump_conn.next_event().await {
            if let Ok(v) = serde_json::to_value(&ev) {
                pump_bus.emit("kernel", v);
            }
        }
    });

    // --- native window event loop (created even in --no-window so window ops
    //     from a browser session are harmless no-ops) -------------------------
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    // A real window reopens the workspace it last had (the VS Code habit).
    // Headless suites keep the repository root so their relative paths stay
    // deterministic; a missing store means the welcome screen, never the app's
    // own source folder.
    let initial_root = if no_window {
        project_root.clone()
    } else {
        io::last_workspace().unwrap_or_default()
    };

    let state = Arc::new(AppState {
        bus,
        conn,
        root: Mutex::new(initial_root.clone()),
        ui_dir: ui_dir.clone(),
        term: term::TermRegistry::new(),
        kernel_cfg: kernel_dir.join("config").join("kernel.json"),
        runtime_models,
        runtime_default,
        demo: !live,
        headless: no_window,
        proxy: Mutex::new(proxy),
    });

    let listener = match requested_port {
        Some(port) => TcpListener::bind(("127.0.0.1", port))
            .unwrap_or_else(|e| panic!("bind requested port {port}: {e}")),
        None => TcpListener::bind("127.0.0.1:8787")
            .or_else(|_| TcpListener::bind("127.0.0.1:0"))
            .expect("bind local service port"),
    };
    let port = listener.local_addr().unwrap().port();
    let url = format!("http://127.0.0.1:{port}/");
    // External edits (other tools, git) reach the same `fs.changed` path the
    // shell's own writes use, so the tree and clean buffers stay current.
    io::spawn_watcher(state.clone());
    {
        let st = state.clone();
        std::thread::spawn(move || server::run(listener, st));
    }
    println!("pristem service listening on {url}");
    println!("protocol: pristem.ipc/v0.3 · UI: {} · workspace: {}", ui_dir.display(), initial_root.display());

    if no_window {
        loop { std::thread::sleep(Duration::from_secs(3600)); }
    }

    // Taskbar / Alt-Tab identity. A gnullvm link has no Win32 resource section, so the
    // exe carries no default icon; hand tao a pre-rasterised RGBA (assets/make-app-icon.py).
    const ICON_RGBA: &[u8] = include_bytes!("../../assets/icon_128.rgba");
    let window_icon = tao::window::Icon::from_rgba(ICON_RGBA.to_vec(), 128, 128).ok();

    let window = WindowBuilder::new()
        .with_title("pristem")
        .with_window_icon(window_icon)
        .with_decorations(false)
        .with_inner_size(tao::dpi::LogicalSize::new(1440.0, 900.0))
        .with_min_inner_size(tao::dpi::LogicalSize::new(760.0, 560.0))
        .build(&event_loop)
        .expect("create native window");

    let webview = WebViewBuilder::new()
        .with_url(&url)
        .with_devtools(true)
        .build(&window)
        .expect("create WebView2");

    // The UI cannot ask Win32 for native window state, so the shell pushes it.
    let mut last_maximized = window.is_maximized();
    let push_window_state = |webview: &wry::WebView, maximized: bool| {
        let _ = webview.evaluate_script(&format!(
            "window.dispatchEvent(new CustomEvent('pristem:window-state',{{detail:{{maximized:{maximized}}}}}))"
        ));
    };

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        let _ = &webview;
        match event {
            Event::UserEvent(UserEvent::Window(op)) => match op {
                WindowOp::Minimize => window.set_minimized(true),
                WindowOp::Maximize => {
                    window.set_maximized(!window.is_maximized());
                    let maximized = window.is_maximized();
                    last_maximized = maximized;
                    push_window_state(&webview, maximized);
                }
                WindowOp::Close => {
                    state.term.kill_all();
                    *control_flow = ControlFlow::Exit;
                }
                WindowOp::Drag => { let _ = window.drag_window(); }
            },
            Event::WindowEvent { event: WindowEvent::Resized(_), .. } => {
                let maximized = window.is_maximized();
                if maximized != last_maximized {
                    last_maximized = maximized;
                    push_window_state(&webview, maximized);
                }
            }
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => {
                state.term.kill_all();
                *control_flow = ControlFlow::Exit;
            }
            _ => {}
        }
    });
}
