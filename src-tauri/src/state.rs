use std::sync::Arc;

use crate::{
    mcp::server_manager::ServerManager,
    persistence::registry::WorkspacePoolRegistry,
    shared_config::store::SharedConfigStore,
};

#[derive(Clone)]
pub struct AppState {
    pub registry: Arc<WorkspacePoolRegistry>,
    pub shared_config: Arc<SharedConfigStore>,
    pub server_manager: Arc<ServerManager>,
}

impl AppState {
    pub fn new(
        registry: Arc<WorkspacePoolRegistry>,
        shared_config: SharedConfigStore,
        server_manager: ServerManager,
    ) -> Self {
        Self {
            registry,
            shared_config: Arc::new(shared_config),
            server_manager: Arc::new(server_manager),
        }
    }

    pub async fn pool(&self) -> crate::error::AppResult<sqlx::SqlitePool> {
        self.registry
            .get_or_init(crate::persistence::registry::DEFAULT_WORKSPACE)
            .await
    }
}
