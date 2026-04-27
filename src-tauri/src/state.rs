use std::sync::Arc;

use sqlx::SqlitePool;

#[derive(Clone)]
pub struct AppState {
    pub pool: Arc<SqlitePool>,
}

impl AppState {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            pool: Arc::new(pool),
        }
    }
}
