pub mod commands;
pub mod error;
pub mod persistence;
pub mod state;

use tauri::{Manager, RunEvent};
use tracing::{error, info};
use tracing_subscriber::{fmt, EnvFilter};

use crate::{
    commands::ping::ping,
    persistence::registry::{WorkspacePoolRegistry, DEFAULT_WORKSPACE},
    state::AppState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("resolve app data dir");

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let registry = WorkspacePoolRegistry::new(app_data_dir);
                match registry.get_or_init(DEFAULT_WORKSPACE).await {
                    Ok(_) => {
                        let state = AppState::new(registry);
                        handle.manage(state);
                        info!("AppState initialized (registry seeded with default workspace)");
                    }
                    Err(err) => {
                        error!(?err, "failed to init AppState — default workspace pool failed");
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ping])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                info!("exit requested");
            }
        });
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,mcp_router_lib=debug"));
    let _ = fmt().with_env_filter(filter).try_init();
}
