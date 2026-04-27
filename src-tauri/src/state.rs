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
}
