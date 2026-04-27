use std::sync::Arc;

use crate::persistence::registry::WorkspacePoolRegistry;

#[derive(Clone)]
pub struct AppState {
    pub registry: Arc<WorkspacePoolRegistry>,
}

impl AppState {
    pub fn new(registry: WorkspacePoolRegistry) -> Self {
        Self {
            registry: Arc::new(registry),
        }
    }
}
