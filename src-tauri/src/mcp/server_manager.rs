use std::{collections::HashMap, sync::Arc};

use rmcp::{service::RunningService, RoleClient};
use serde_json::Value;
use tokio::sync::RwLock;
use tracing::info;

use crate::{
    error::{AppError, AppResult},
    mcp::status::ServerStatus,
    persistence::registry::WorkspacePoolRegistry,
};

pub struct ServerManager {
    #[allow(dead_code)] // populated in Task 3
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

    /// Returns the runtime status of `server_id`. Stopped if not in the active map.
    pub async fn status(&self, server_id: &str) -> ServerStatus {
        let clients = self.clients.read().await;
        if clients.contains_key(server_id) {
            ServerStatus::Running
        } else {
            ServerStatus::Stopped
        }
    }

    /// Skeleton: implemented in Task 3.
    pub async fn start(&self, _server_id: &str) -> AppResult<()> {
        Err(AppError::Internal(
            "ServerManager::start not implemented yet (Plan 6 Task 3)".into(),
        ))
    }

    /// Stop a running server. Idempotent: returns `false` if it wasn't running.
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

    /// Skeleton: implemented in Task 3.
    pub async fn list_tools(&self, server_id: &str) -> AppResult<Vec<Value>> {
        let clients = self.clients.read().await;
        if !clients.contains_key(server_id) {
            return Err(AppError::NotFound(format!(
                "server {server_id} is not running"
            )));
        }
        Err(AppError::Internal(
            "ServerManager::list_tools not implemented yet (Plan 6 Task 3)".into(),
        ))
    }
}
