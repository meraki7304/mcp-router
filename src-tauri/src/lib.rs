pub mod commands;
pub mod error;
pub mod persistence;
pub mod shared_config;
pub mod state;

use tauri::{Manager, RunEvent};
use tracing::{error, info};
use tracing_subscriber::{fmt, EnvFilter};

use crate::{
    commands::ping::ping,
    persistence::registry::{WorkspacePoolRegistry, DEFAULT_WORKSPACE},
    shared_config::store::SharedConfigStore,
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
                let shared_config_path = app_data_dir.join("shared-config.json");
                let shared_config = match SharedConfigStore::open(shared_config_path).await {
                    Ok(s) => s,
                    Err(err) => {
                        error!(?err, "failed to open shared-config.json");
                        return;
                    }
                };

                let registry = WorkspacePoolRegistry::new(app_data_dir);
                match registry.get_or_init(DEFAULT_WORKSPACE).await {
                    Ok(_) => {
                        let state = AppState::new(registry, shared_config);
                        handle.manage(state);
                        info!("AppState initialized (registry + shared_config seeded)");
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
