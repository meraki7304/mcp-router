pub mod commands;
pub mod error;
pub mod http;
pub mod mcp;
pub mod persistence;
pub mod shared_config;
pub mod state;
pub mod workflow;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, RunEvent, WindowEvent,
};
use tracing::{error, info};
use tracing_subscriber::{fmt, EnvFilter};

use crate::{
    commands::{
        autostart::{autostart_disable, autostart_enable, autostart_is_enabled},
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
    mcp::{
        server_manager::{ServerManager, StatusEventSink},
        status::ServerStatus,
    },
    persistence::registry::{WorkspacePoolRegistry, DEFAULT_WORKSPACE},
    shared_config::store::SharedConfigStore,
    state::AppState,
    workflow::hook_runtime::HookRuntime,
};

/// Tauri-backed implementation of `StatusEventSink`. Wraps an `AppHandle` and uses
/// `tauri::Emitter` to push `server-status-changed` events to the frontend.
struct TauriStatusSink {
    handle: tauri::AppHandle,
}

impl TauriStatusSink {
    fn new(handle: tauri::AppHandle) -> Self {
        Self { handle }
    }
}

impl StatusEventSink for TauriStatusSink {
    fn emit_status_change(&self, server_id: &str, status: &ServerStatus) {
        use tauri::Emitter;
        let payload = serde_json::json!({ "id": server_id, "status": status });
        if let Err(e) = self.handle.emit("server-status-changed", payload) {
            tracing::warn!(?e, "emit server-status-changed failed");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--silent"]),
        ))
        .on_window_event(|window, event| {
            // 关闭按钮：拦下 close，改为隐藏到托盘；下次从托盘点回来 show()。
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            // 命令行：开机自启路径会带 --silent，决定是否显示主窗口。
            let silent_start = std::env::args().any(|a| a == "--silent");

            // 托盘图标 + 菜单（显示主窗口 / 退出）。Single-click 也呼出主窗口。
            let show_item =
                MenuItem::with_id(app, "show", "显示 MCP Router", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().expect("no default icon").clone())
                .tooltip("MCP Router")
                .menu(&tray_menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("resolve app data dir");

            let handle = app.handle().clone();

            // 非静默启动（手动双击/快捷方式）：立即显示窗口，不等任何异步初始化，
            // 避免双击图标后白屏几百毫秒的体感。
            if !silent_start {
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }

            tauri::async_runtime::spawn(async move {
                // 1. 打开 SharedConfigStore（轻量 IO）
                let shared_config_path = app_data_dir.join("shared-config.json");
                let shared_config = match SharedConfigStore::open(shared_config_path).await {
                    Ok(s) => s,
                    Err(err) => {
                        error!(?err, "failed to open shared-config.json");
                        return;
                    }
                };

                // 2. 静默启动路径：根据 showWindowOnStartup 决定是否露面。
                //    默认 true，与"开机自启时显示主窗口"开关含义一致。
                if silent_start {
                    let show_window = shared_config
                        .get_settings()
                        .await
                        .show_window_on_startup
                        .unwrap_or(true);
                    if show_window {
                        if let Some(window) = handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }

                // 3. 必要的核心组件（尽量轻量，让 manage 早点发生）
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
                state
                    .server_manager
                    .set_event_sink(Box::new(TauriStatusSink::new(handle.clone())));

                // 4. 立刻 manage，让 #[tauri::command] 可服务。
                //    此前若前端发起 invoke 会撞 "state not managed" → 显示 "Error loading apps"。
                handle.manage(state.clone());
                info!("AppState managed; commands now serviceable");

                // 5. 余下任务全部独立 spawn，互不阻塞 manage。

                // 5a. auto-start 扫描：拉起配置标记的本地 MCP 服务器，
                //     每台逐个启动可能秒级耗时，必须独立 spawn。
                {
                    let registry = state.registry.clone();
                    let server_manager = state.server_manager.clone();
                    tauri::async_runtime::spawn(async move {
                        use crate::persistence::repository::server::{
                            ServerRepository, SqliteServerRepository,
                        };
                        let pool = match registry.get_or_init(DEFAULT_WORKSPACE).await {
                            Ok(p) => p,
                            Err(err) => {
                                tracing::warn!(?err, "auto-start: get pool failed");
                                return;
                            }
                        };
                        let repo = SqliteServerRepository::new(pool);
                        let servers = match repo.list().await {
                            Ok(s) => s,
                            Err(err) => {
                                tracing::warn!(?err, "auto-start scan: list servers failed");
                                return;
                            }
                        };
                        for s in servers {
                            if s.auto_start && !s.disabled {
                                if let Err(err) = server_manager.start(&s.id).await {
                                    tracing::warn!(
                                        server_id = %s.id,
                                        server_name = %s.name,
                                        ?err,
                                        "auto-start failed"
                                    );
                                } else {
                                    info!(
                                        server_id = %s.id,
                                        server_name = %s.name,
                                        "auto-start ok"
                                    );
                                }
                            }
                        }
                    });
                }

                // 5b. HTTP server 启动（端口占用时只发事件，不阻塞 invoke）。
                {
                    let server_manager = state.server_manager.clone();
                    let shared_config = state.shared_config.clone();
                    let handle_for_http = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(err) =
                            spawn_http_server(server_manager, shared_config).await
                        {
                            error!(
                                ?err,
                                "failed to spawn MCP HTTP server (continuing without it)"
                            );
                            use tauri::Emitter;
                            let payload = serde_json::json!({
                                "port": 3282,
                                "reason": err.to_string(),
                            });
                            if let Err(e) =
                                handle_for_http.emit("http-server-failed", payload)
                            {
                                tracing::warn!(?e, "emit http-server-failed failed");
                            }
                        }
                    });
                }

                // 5c. 周期裁剪 request_logs。
                {
                    let registry_for_trim = state.registry.clone();
                    let shared_config_for_trim = state.shared_config.clone();
                    tauri::async_runtime::spawn(async move {
                        use crate::persistence::repository::request_log::{
                            RequestLogRepository, SqliteRequestLogRepository,
                        };
                        let mut interval = tokio::time::interval(
                            std::time::Duration::from_secs(5 * 60),
                        );
                        // 跳过第一次立即触发
                        interval.tick().await;
                        loop {
                            interval.tick().await;
                            let max_rows = shared_config_for_trim
                                .get_settings()
                                .await
                                .max_request_log_rows
                                .unwrap_or(50_000);
                            let pool = match registry_for_trim
                                .get_or_init(DEFAULT_WORKSPACE)
                                .await
                            {
                                Ok(p) => p,
                                Err(err) => {
                                    tracing::warn!(?err, "trim job: get pool failed");
                                    continue;
                                }
                            };
                            let repo = SqliteRequestLogRepository::new(pool);
                            match repo.trim_to_max(max_rows).await {
                                Ok(0) => {}
                                Ok(deleted) => {
                                    info!(deleted, max_rows, "request_logs trimmed");
                                }
                                Err(err) => {
                                    tracing::warn!(?err, "trim_to_max failed");
                                }
                            }
                        }
                    });
                }

                info!("AppState initialized; background tasks scheduled");
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
            autostart_is_enabled,
            autostart_enable,
            autostart_disable,
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
        .run(|_app_handle, event| match event {
            RunEvent::ExitRequested { .. } => {
                info!("exit requested");
            }
            // 所有窗口都关了也不退应用，留在托盘后台
            RunEvent::WindowEvent {
                event: WindowEvent::CloseRequested { .. },
                ..
            } => {}
            _ => {}
        });
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,mcp_router_lib=debug"));
    let _ = fmt().with_env_filter(filter).try_init();
}
