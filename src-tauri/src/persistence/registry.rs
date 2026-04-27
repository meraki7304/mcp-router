use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use sqlx::SqlitePool;
use tokio::sync::RwLock;
use tracing::info;

use crate::{
    error::AppResult,
    persistence::pool::init_pool_at_path,
};

pub const DEFAULT_WORKSPACE: &str = "default";

pub struct WorkspacePoolRegistry {
    base_dir: PathBuf,
    pools: RwLock<HashMap<String, SqlitePool>>,
}

impl WorkspacePoolRegistry {
    pub fn new(base_dir: PathBuf) -> Self {
        Self {
            base_dir,
            pools: RwLock::new(HashMap::new()),
        }
    }

    pub async fn get_or_init(&self, workspace_id: &str) -> AppResult<SqlitePool> {
        // fast path: already cached
        {
            let pools = self.pools.read().await;
            if let Some(pool) = pools.get(workspace_id) {
                return Ok(pool.clone());
            }
        }

        // slow path: create + insert. take write lock, double-check under it.
        let mut pools = self.pools.write().await;
        if let Some(pool) = pools.get(workspace_id) {
            return Ok(pool.clone());
        }

        let db_path = self.workspace_db_path(workspace_id);
        info!(workspace = workspace_id, path = %db_path.display(), "initializing workspace pool");

        let pool = init_pool_at_path(&db_path).await?;
        pools.insert(workspace_id.to_string(), pool.clone());
        Ok(pool)
    }

    pub async fn close(&self, workspace_id: &str) -> AppResult<()> {
        let mut pools = self.pools.write().await;
        if let Some(pool) = pools.remove(workspace_id) {
            pool.close().await;
        }
        Ok(())
    }

    pub async fn close_all(&self) {
        let mut pools = self.pools.write().await;
        let drained: Vec<_> = pools.drain().collect();
        drop(pools);
        for (_, pool) in drained {
            pool.close().await;
        }
    }

    fn workspace_db_path(&self, workspace_id: &str) -> PathBuf {
        if workspace_id == DEFAULT_WORKSPACE {
            self.base_dir.join("mcp-router.sqlite")
        } else {
            self.base_dir
                .join("workspaces")
                .join(format!("{workspace_id}.sqlite"))
        }
    }

    pub fn base_dir(&self) -> &Path {
        &self.base_dir
    }
}
