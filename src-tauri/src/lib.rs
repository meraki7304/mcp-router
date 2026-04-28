pub mod commands;
pub mod error;
pub mod http;
pub mod mcp;
pub mod persistence;
pub mod shared_config;
pub mod state;
pub mod workflow;

use tauri::{Manager, RunEvent};
use tracing::{error, info};
use tracing_subscriber::{fmt, EnvFilter};

use crate::{
    commands::{
        hook_runtime::hooks_run,
        hooks::{
            hooks_create, hooks_delete, hooks_find_by_name, hooks_get, hooks_list, hooks_update,
        },
        logs::{logs_query, logs_trim},
        ping::ping,
        projects::{
            projects_create, projects_delete, projects_find_by_name, projects_get, projects_list,
            projects_update,
        },
        server_runtime::{
            servers_get_status, servers_list_tools, servers_start, servers_stop,
        },
        servers::{
            servers_create, servers_delete, servers_find_by_name, servers_get,
            servers_list, servers_list_by_project, servers_update,
        },
        settings::{settings_get, settings_update},
        tokens::{
            tokens_delete, tokens_delete_client, tokens_get, tokens_list, tokens_save,
            tokens_update_server_access,
        },
        workflows::{
            workflows_create, workflows_delete, workflows_execute, workflows_get,
            workflows_list, workflows_list_by_type, workflows_list_enabled, workflows_update,
        },
    },
    http::serve::spawn_http_server,
    mcp::server_manager::ServerManager,
    persistence::registry::{WorkspacePoolRegistry, DEFAULT_WORKSPACE},
    shared_config::store::SharedConfigStore,
    state::AppState,
    workflow::hook_runtime::HookRuntime,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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

                let registry = std::sync::Arc::new(WorkspacePoolRegistry::new(app_data_dir));
                if let Err(err) = registry.get_or_init(DEFAULT_WORKSPACE).await {
                    error!(?err, "failed to seed default workspace pool");
                    return;
                }

                let server_manager = ServerManager::new(registry.clone());

                let hook_runtime = match HookRuntime::new() {
                    Ok(rt) => rt,
                    Err(err) => {
                        error!(?err, "failed to construct HookRuntime");
                        return;
                    }
                };

                let state = AppState::new(registry, shared_config, server_manager, hook_runtime);

                // Spawn the HTTP server BEFORE manage so we can use the components.
                let server_manager_arc = state.server_manager.clone();
                let shared_config_arc = state.shared_config.clone();
                if let Err(err) = spawn_http_server(server_manager_arc, shared_config_arc).await {
                    error!(?err, "failed to spawn MCP HTTP server (continuing without it)");
                }

                handle.manage(state);
                info!("AppState initialized (registry + shared_config + server_manager seeded; HTTP server on 127.0.0.1:3282)");
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            settings_get,
            settings_update,
            tokens_list,
            tokens_get,
            tokens_save,
            tokens_delete,
            tokens_delete_client,
            tokens_update_server_access,
            projects_list,
            projects_get,
            projects_find_by_name,
            projects_create,
            projects_update,
            projects_delete,
            servers_list,
            servers_list_by_project,
            servers_get,
            servers_find_by_name,
            servers_create,
            servers_update,
            servers_delete,
            servers_start,
            servers_stop,
            servers_get_status,
            servers_list_tools,
            logs_query,
            logs_trim,
            workflows_list,
            workflows_list_enabled,
            workflows_list_by_type,
            workflows_get,
            workflows_create,
            workflows_update,
            workflows_delete,
            workflows_execute,
            hooks_list,
            hooks_get,
            hooks_find_by_name,
            hooks_create,
            hooks_update,
            hooks_delete,
            hooks_run,
        ])
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
