use std::{collections::HashMap, sync::Arc, sync::OnceLock};

use rmcp::{
    service::RunningService,
    transport::TokioChildProcess,
    RoleClient, ServiceExt,
};
use serde_json::Value;
use tokio::{process::Command, sync::RwLock};
use tracing::{info, warn};

use crate::{
    error::{AppError, AppResult},
    mcp::status::ServerStatus,
    persistence::{
        registry::{WorkspacePoolRegistry, DEFAULT_WORKSPACE},
        repository::server::{ServerRepository, SqliteServerRepository},
        types::server::{Server, ServerType},
    },
};

/// Lightweight info about a server that's currently running. Returned by `running_servers()`
/// for Aggregator consumption (avoids cloning the full Server config).
#[derive(Debug, Clone)]
pub struct RunningServerInfo {
    pub id: String,
    pub name: String,
}

/// Abstract sink for server-status-changed events. Concrete impl in `lib.rs` wraps
/// the real `tauri::AppHandle` (via `tauri::Emitter`); tests can leave the field empty.
///
/// Keeping the trait here (not pulling `tauri::AppHandle` into the lib's public surface)
/// avoids leaking tauri's WinAPI subclassing/manifest dependencies into the test
/// binaries that link `mcp_router_lib` — that surface causes
/// `STATUS_ENTRYPOINT_NOT_FOUND (0xC0000139)` on Windows when test bins run without
/// the Common Controls v6 activation context.
pub trait StatusEventSink: Send + Sync + 'static {
    fn emit_status_change(&self, server_id: &str, status: &ServerStatus);
}

pub struct ServerManager {
    registry: Arc<WorkspacePoolRegistry>,
    clients: RwLock<HashMap<String, RunningService<RoleClient, ()>>>,
    event_sink: OnceLock<Box<dyn StatusEventSink>>,
}

impl ServerManager {
    pub fn new(registry: Arc<WorkspacePoolRegistry>) -> Self {
        Self {
            registry,
            clients: RwLock::new(HashMap::new()),
            event_sink: OnceLock::new(),
        }
    }

    /// Setup 阶段调一次：注入事件发送实现（生产环境是 tauri::AppHandle 包装；测试可不注入）。
    pub fn set_event_sink(&self, sink: Box<dyn StatusEventSink>) {
        let _ = self.event_sink.set(sink);
    }

    fn emit_status_change(&self, server_id: &str, status: &ServerStatus) {
        if let Some(sink) = self.event_sink.get() {
            sink.emit_status_change(server_id, status);
        }
    }

    pub async fn status(&self, server_id: &str) -> ServerStatus {
        let clients = self.clients.read().await;
        if clients.contains_key(server_id) {
            ServerStatus::Running
        } else {
            ServerStatus::Stopped
        }
    }

    pub async fn start(&self, server_id: &str) -> AppResult<()> {
        // Reject if already running.
        {
            let clients = self.clients.read().await;
            if clients.contains_key(server_id) {
                return Err(AppError::InvalidInput(format!(
                    "server {server_id} is already running"
                )));
            }
        }

        // Look up the server config.
        let server = self
            .lookup_server(server_id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("server {server_id}")))?;

        if server.disabled {
            return Err(AppError::InvalidInput(format!(
                "server {server_id} is disabled"
            )));
        }

        let service: RunningService<RoleClient, ()> = match server.server_type {
            ServerType::Local => {
                let command_str = server.command.as_deref().ok_or_else(|| {
                    AppError::InvalidInput(format!("server {server_id} has no command"))
                })?;

                let mut cmd = Command::new(command_str);
                cmd.args(&server.args);
                for (k, v) in &server.env {
                    cmd.env(k, v);
                }
                if let Some(cwd) = server.context_path.as_deref() {
                    cmd.current_dir(cwd);
                }

                info!(server_id, command = %command_str, "spawning local mcp server subprocess");

                let transport = TokioChildProcess::new(cmd).map_err(|e| {
                    AppError::Upstream(format!("spawn mcp server subprocess: {e}"))
                })?;

                ()
                    .serve(transport)
                    .await
                    .map_err(|e| AppError::Upstream(format!("rmcp serve (stdio): {e}")))?
            }
            ServerType::Remote => {
                let url = server.remote_url.as_deref().ok_or_else(|| {
                    AppError::InvalidInput(format!(
                        "remote server {server_id} has no remote_url"
                    ))
                })?;

                info!(server_id, url, "connecting to remote mcp server (streamable http)");

                use rmcp::transport::streamable_http_client::StreamableHttpClientTransport;
                // NOTE(Plan 9d): bearer_token 还未注入 transport（rmcp 提供 auth_header
                // builder，但目前先用 URL-only 路径）；后续任务再接 Server.bearer_token。
                let transport = StreamableHttpClientTransport::from_uri(url.to_string());

                ()
                    .serve(transport)
                    .await
                    .map_err(|e| {
                        AppError::Upstream(format!("rmcp serve (streamable http): {e}"))
                    })?
            }
        };

        // Insert under write lock (re-checking idempotency to handle concurrent starts).
        let mut clients = self.clients.write().await;
        if clients.contains_key(server_id) {
            // Race: someone else started it. Tear ours down.
            drop(clients);
            warn!(server_id, "concurrent start detected; cancelling our service");
            let _ = service.cancel().await;
            return Err(AppError::InvalidInput(format!(
                "server {server_id} was started concurrently"
            )));
        }
        clients.insert(server_id.to_string(), service);
        info!(server_id, "mcp server running");
        drop(clients);
        self.emit_status_change(server_id, &ServerStatus::Running);
        Ok(())
    }

    pub async fn stop(&self, server_id: &str) -> AppResult<bool> {
        let removed = {
            let mut clients = self.clients.write().await;
            clients.remove(server_id)
        };
        match removed {
            Some(service) => {
                info!(server_id, "stopping mcp server (cancel)");
                if let Err(e) = service.cancel().await {
                    return Err(AppError::Upstream(format!("cancel mcp service: {e}")));
                }
                self.emit_status_change(server_id, &ServerStatus::Stopped);
                Ok(true)
            }
            None => Ok(false),
        }
    }

    pub async fn list_tools(&self, server_id: &str) -> AppResult<Vec<Value>> {
        let clients = self.clients.read().await;
        let service = clients.get(server_id).ok_or_else(|| {
            AppError::NotFound(format!("server {server_id} is not running"))
        })?;

        // RunningService derefs to Peer<RoleClient>; list_all_tools is on Peer.
        let tools = service
            .list_all_tools()
            .await
            .map_err(|e| AppError::Upstream(format!("list_all_tools: {e}")))?;

        // Serialize each rmcp::model::Tool to serde_json::Value.
        // The Tool type is #[non_exhaustive] so we can't construct it ourselves,
        // but Serialize lets us pass-through to JSON.
        tools
            .into_iter()
            .map(|t| {
                serde_json::to_value(&t).map_err(|e| {
                    AppError::Internal(format!("encode rmcp Tool to JSON: {e}"))
                })
            })
            .collect()
    }

    /// Return the (id, name) of every server currently running. Useful for the Aggregator
    /// to enumerate tools across servers. Names are looked up from the DB per call —
    /// not cached, since the user may rename a server while it's running (rare but possible).
    pub async fn running_servers(&self) -> AppResult<Vec<RunningServerInfo>> {
        let ids: Vec<String> = {
            let clients = self.clients.read().await;
            clients.keys().cloned().collect()
        };
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(server) = self.lookup_server(&id).await? {
                out.push(RunningServerInfo {
                    id: server.id,
                    name: server.name,
                });
            }
            // If lookup_server returns None, the server config was deleted while running.
            // Skip silently — the entry will be cleaned up on next stop.
        }
        Ok(out)
    }

    /// Returns the typed tool list for a running server. Plan 7b's Aggregator uses this to
    /// merge tools across servers without paying for serde_json round-trips.
    pub async fn list_tools_typed(&self, server_id: &str) -> AppResult<Vec<rmcp::model::Tool>> {
        let clients = self.clients.read().await;
        let service = clients.get(server_id).ok_or_else(|| {
            AppError::NotFound(format!("server {server_id} is not running"))
        })?;

        service
            .list_all_tools()
            .await
            .map_err(|e| AppError::Upstream(format!("list_all_tools: {e}")))
    }

    /// Call a tool on a running server. Returns the rmcp `CallToolResult` directly.
    /// Side effect: best-effort write to `request_logs` table (timing, params, response,
    /// error). Failures in the log insert are warned but never fail the call.
    pub async fn call_tool_typed(
        &self,
        server_id: &str,
        tool_name: &str,
        arguments: Option<serde_json::Map<String, serde_json::Value>>,
    ) -> AppResult<rmcp::model::CallToolResult> {
        let started_at = std::time::Instant::now();
        let timestamp = chrono::Utc::now();

        // Cache server name for log row (fail open — empty if lookup errors)
        let server_name = self
            .lookup_server(server_id)
            .await
            .ok()
            .flatten()
            .map(|s| s.name);

        // Run the actual rmcp call inside its own scope so the read lock drops before
        // we touch the registry to write the log row.
        let result = {
            let clients = self.clients.read().await;
            let service = clients.get(server_id).ok_or_else(|| {
                AppError::NotFound(format!("server {server_id} is not running"))
            })?;

            let mut req = rmcp::model::CallToolRequestParams::new(tool_name.to_owned());
            if let Some(args) = arguments.clone() {
                req = req.with_arguments(args);
            }

            service
                .call_tool(req)
                .await
                .map_err(|e| AppError::Upstream(format!("call_tool {tool_name}: {e}")))
        };

        let duration_ms = started_at.elapsed().as_millis() as i64;

        // Best-effort log insert; never fail the call because logging failed.
        if let Ok(pool) = self.registry.get_or_init(DEFAULT_WORKSPACE).await {
            use crate::persistence::{
                repository::request_log::{
                    RequestLogRepository, SqliteRequestLogRepository,
                },
                types::request_log::NewRequestLog,
            };
            let repo = SqliteRequestLogRepository::new(pool);

            let request_params = arguments
                .as_ref()
                .map(|a| serde_json::Value::Object(a.clone().into_iter().collect()));

            let response_data = match &result {
                Ok(r) => serde_json::to_value(r).ok(),
                Err(_) => None,
            };
            let response_status = Some(
                if result.is_ok() { "ok".to_string() } else { "error".to_string() },
            );
            let error_message = result.as_ref().err().map(|e| e.to_string());

            let entry = NewRequestLog {
                timestamp,
                client_id: None, // Plan 9d 暂不带 token client_id；Plan 7c 接 token-aware 时再填
                client_name: None,
                server_id: Some(server_id.to_string()),
                server_name,
                request_type: Some("tools/call".to_string()),
                request_params,
                response_data,
                response_status,
                duration_ms: Some(duration_ms),
                error_message,
            };
            if let Err(e) = repo.insert(entry).await {
                tracing::warn!(?e, "failed to insert request log row");
            }
        }

        result
    }

    // Internal: fetch a server config from the default workspace's DB.
    /// 暴露给 Aggregator 用：拿到指定 server 的 tool_permissions 表。
    /// `Some(false)` = 用户在 UI 显式禁用；其它（不存在 / Some(true)）= 启用。
    pub async fn tool_permissions(
        &self,
        server_id: &str,
    ) -> AppResult<HashMap<String, bool>> {
        match self.lookup_server(server_id).await? {
            Some(s) => Ok(s.tool_permissions),
            None => Ok(HashMap::new()),
        }
    }

    async fn lookup_server(&self, server_id: &str) -> AppResult<Option<Server>> {
        let pool = self.registry.get_or_init(DEFAULT_WORKSPACE).await?;
        let repo = SqliteServerRepository::new(pool);
        repo.get(server_id).await
    }

    /// 按 name 查 server，找不到返回 None。给 Aggregator 懒启动用。
    pub async fn find_server_by_name(
        &self,
        name: &str,
    ) -> AppResult<Option<Server>> {
        let pool = self.registry.get_or_init(DEFAULT_WORKSPACE).await?;
        let repo = SqliteServerRepository::new(pool);
        repo.find_by_name(name).await
    }
}
