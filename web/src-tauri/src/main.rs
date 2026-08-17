// Prevents an additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpListener;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{Manager, RunEvent, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Connection details the web layer needs in order to reach the bundled daemon.
#[derive(Clone, Serialize)]
struct DaemonConfig {
    port: u16,
    token: String,
}

/// Owns the spawned daemon so it can be shut down with the app.
#[derive(Default)]
struct DaemonProcess(Mutex<Option<CommandChild>>);

/// Asks the OS for an unused port by binding to port 0 and reading back the
/// assignment. There is a small race between releasing and the daemon binding,
/// which is acceptable for a desktop app on loopback.
fn pick_free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .map(|addr| addr.port())
        .unwrap_or(8080)
}

/// Generates a per-launch API token so nothing else on the machine can drive
/// the daemon while the app is running.
fn generate_token() -> String {
    use rand::Rng;
    const HEX: &[u8] = b"0123456789abcdef";
    let mut rng = rand::thread_rng();
    (0..48)
        .map(|_| HEX[rng.gen_range(0..HEX.len())] as char)
        .collect()
}

/// Directory the daemon's tools are allowed to read and write.
///
/// A bundled app starts with a working directory that is meaningless (often `/`),
/// so the sandbox root is set explicitly. AGENTUI_WORKSPACE overrides it.
fn workspace_dir() -> String {
    if let Ok(dir) = std::env::var("AGENTUI_WORKSPACE") {
        if !dir.trim().is_empty() {
            return dir;
        }
    }
    dirs_home().unwrap_or_else(|| ".".to_string())
}

fn dirs_home() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE").ok()
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").ok()
    }
}

#[tauri::command]
fn daemon_config(config: State<'_, DaemonConfig>) -> DaemonConfig {
    config.inner().clone()
}

fn main() {
    let config = DaemonConfig {
        port: pick_free_port(),
        token: generate_token(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(config.clone())
        .manage(DaemonProcess::default())
        .invoke_handler(tauri::generate_handler![daemon_config])
        .setup(move |app| {
            let workspace = workspace_dir();
            log::log(&format!(
                "starting agentui-daemon on port {} with workspace {}",
                config.port, workspace
            ));

            let sidecar = app
                .shell()
                .sidecar("agentui-daemon")?
                .args([
                    "-port",
                    &config.port.to_string(),
                    "-api-token",
                    &config.token,
                    "-workspace",
                    &workspace,
                    // Tauri serves the UI itself; the daemon is API-only here.
                    "-static-dir",
                    "",
                    // Belt and braces alongside the kill on exit: if this app is
                    // force-quit or crashes, the exit handler never runs, but the
                    // stdin pipe closes and the daemon shuts itself down.
                    "-shutdown-on-stdin-close",
                ]);

            let (mut rx, child) = sidecar.spawn()?;

            app.state::<DaemonProcess>()
                .0
                .lock()
                .expect("daemon process lock poisoned")
                .replace(child);

            // Surface daemon output in the app's own logs; without this a
            // failure to start would be completely silent.
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                            log::log(&format!("daemon: {}", String::from_utf8_lossy(&line).trim()));
                        }
                        CommandEvent::Terminated(payload) => {
                            log::log(&format!("daemon exited: {:?}", payload.code));
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building AgentUI Studio")
        .run(|app_handle, event| {
            // Leaving the daemon running after the window closes would strand a
            // process holding a port and the user's workspace.
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                if let Some(child) = app_handle
                    .state::<DaemonProcess>()
                    .0
                    .lock()
                    .ok()
                    .and_then(|mut guard| guard.take())
                {
                    let _ = child.kill();
                }
            }
        });
}

mod log {
    /// Minimal stderr logging; the app has no logging framework and this keeps
    /// startup diagnostics visible when launched from a terminal.
    pub fn log(message: &str) {
        eprintln!("[agentui-studio] {message}");
    }
}
