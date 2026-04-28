use std::{collections::HashMap, sync::Arc};

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

pub struct ServerManager {
    registry: Arc<WorkspacePoolRegistry>,
    clients: RwLock<HashMap<String, RunningService<RoleClient, ()>>>,
}

impl ServerManager {
    pub fn new(registry: Arc<WorkspacePoolRegistry>) -> Self {
        Self {
            registry,
            clients: RwLock::new(HashMap::new()),
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

        if !matches!(server.server_type, ServerType::Local) {
            return Err(AppError::InvalidInput(format!(
                "server {server_id} is type {:?}; only Local stdio supported in Plan 6",
                server.server_type
            )));
        }
        if server.disabled {
            return Err(AppError::InvalidInput(format!(
                "server {server_id} is disabled"
            )));
        }

        let command_str = server
            .command
            .as_deref()
            .ok_or_else(|| AppError::InvalidInput(format!("server {server_id} has no command")))?;

        let mut cmd = Command::new(command_str);
        cmd.args(&server.args);
        for (k, v) in &server.env {
            cmd.env(k, v);
        }
        if let Some(cwd) = server.context_path.as_deref() {
            cmd.current_dir(cwd);
        }

        info!(server_id, command = %command_str, "spawning mcp server subprocess");

        let transport = TokioChildProcess::new(cmd).map_err(|e| {
            AppError::Upstream(format!("spawn mcp server subprocess: {e}"))
        })?;

        let service: RunningService<RoleClient, ()> = ()
            .serve(transport)
            .await
            .map_err(|e| AppError::Upstream(format!("rmcp serve: {e}")))?;

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
    pub async fn call_tool_typed(
        &self,
        server_id: &str,
        tool_name: &str,
        arguments: Option<serde_json::Map<String, serde_json::Value>>,
    ) -> AppResult<rmcp::model::CallToolResult> {
        let clients = self.clients.read().await;
        let service = clients.get(server_id).ok_or_else(|| {
            AppError::NotFound(format!("server {server_id} is not running"))
        })?;

        let mut req = rmcp::model::CallToolRequestParams::new(tool_name.to_owned());
        if let Some(args) = arguments {
            req = req.with_arguments(args);
        }

        service
            .call_tool(req)
            .await
            .map_err(|e| AppError::Upstream(format!("call_tool {tool_name}: {e}")))
    }

    // Internal: fetch a server config from the default workspace's DB.
    async fn lookup_server(&self, server_id: &str) -> AppResult<Option<Server>> {
        let pool = self.registry.get_or_init(DEFAULT_WORKSPACE).await?;
        let repo = SqliteServerRepository::new(pool);
        repo.get(server_id).await
    }
}
