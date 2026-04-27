use std::sync::Arc;

use crate::{
    persistence::registry::WorkspacePoolRegistry,
    shared_config::store::SharedConfigStore,
};

#[derive(Clone)]
pub struct AppState {
    pub registry: Arc<WorkspacePoolRegistry>,
    pub shared_config: Arc<SharedConfigStore>,
}

impl AppState {
    pub fn new(registry: WorkspacePoolRegistry, shared_config: SharedConfigStore) -> Self {
        Self {
            registry: Arc::new(registry),
            shared_config: Arc::new(shared_config),
        }
    }

    /// Convenience: returns the SqlitePool for the currently-active workspace.
    /// Plan 5 uses DEFAULT_WORKSPACE; Plan 6+ may evolve this when workspace switching commands land.
    pub async fn pool(&self) -> crate::error::AppResult<sqlx::SqlitePool> {
        self.registry
            .get_or_init(crate::persistence::registry::DEFAULT_WORKSPACE)
            .await
    }
}
