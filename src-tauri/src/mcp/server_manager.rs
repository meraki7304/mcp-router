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

    // Internal: fetch a server config from the default workspace's DB.
    async fn lookup_server(&self, server_id: &str) -> AppResult<Option<Server>> {
        let pool = self.registry.get_or_init(DEFAULT_WORKSPACE).await?;
        let repo = SqliteServerRepository::new(pool);
        repo.get(server_id).await
    }
}
