use std::path::Path;

use sqlx::{
    migrate::Migrator,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};
use tracing::info;

use crate::error::AppResult;

static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

pub async fn init_pool_at_path(db_path: &Path) -> AppResult<SqlitePool> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            crate::error::AppError::Internal(format!("create db dir: {e}"))
        })?;
    }

    let opts = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(opts)
        .await?;

    info!(path = %db_path.display(), "running sqlx migrations");
    MIGRATOR.run(&pool).await.map_err(|e| {
        crate::error::AppError::Internal(format!("migrate: {e}"))
    })?;

    Ok(pool)
}

// Compatibility alias — keeps Plan 1 lib.rs working until it switches to registry in Task 5.
pub async fn init_pool(db_path: &Path) -> AppResult<SqlitePool> {
    init_pool_at_path(db_path).await
}
