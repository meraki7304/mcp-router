use async_trait::async_trait;
use chrono::Utc;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use crate::{
    error::AppResult,
    persistence::types::agent_path::{AgentPath, AgentPathPatch, NewAgentPath},
};

#[async_trait]
pub trait AgentPathRepository: Send + Sync {
    async fn list(&self) -> AppResult<Vec<AgentPath>>;
    async fn get(&self, id: &str) -> AppResult<Option<AgentPath>>;
    async fn find_by_name(&self, name: &str) -> AppResult<Option<AgentPath>>;
    async fn create(&self, input: NewAgentPath) -> AppResult<AgentPath>;
    async fn update(&self, id: &str, patch: AgentPathPatch) -> AppResult<AgentPath>;
    async fn delete(&self, id: &str) -> AppResult<bool>;
}

pub struct SqliteAgentPathRepository {
    pool: SqlitePool,
}

impl SqliteAgentPathRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl AgentPathRepository for SqliteAgentPathRepository {
    async fn list(&self) -> AppResult<Vec<AgentPath>> {
        let rows = sqlx::query("SELECT id, name, path, created_at, updated_at FROM agent_paths ORDER BY name COLLATE NOCASE")
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(row_to_agent_path).collect()
    }

    async fn get(&self, id: &str) -> AppResult<Option<AgentPath>> {
        let row = sqlx::query("SELECT id, name, path, created_at, updated_at FROM agent_paths WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        row.map(row_to_agent_path).transpose()
    }

    async fn find_by_name(&self, name: &str) -> AppResult<Option<AgentPath>> {
        let row = sqlx::query("SELECT id, name, path, created_at, updated_at FROM agent_paths WHERE name = ?")
            .bind(name)
            .fetch_optional(&self.pool)
            .await?;
        row.map(row_to_agent_path).transpose()
    }

    async fn create(&self, input: NewAgentPath) -> AppResult<AgentPath> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now();
        sqlx::query("INSERT INTO agent_paths(id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
            .bind(&id)
            .bind(&input.name)
            .bind(&input.path)
            .bind(now)
            .bind(now)
            .execute(&self.pool)
            .await?;
        Ok(AgentPath {
            id,
            name: input.name,
            path: input.path,
            created_at: now,
            updated_at: now,
        })
    }

    async fn update(&self, id: &str, patch: AgentPathPatch) -> AppResult<AgentPath> {
        let now = Utc::now();
        let existing = self
            .get(id)
            .await?
            .ok_or_else(|| crate::error::AppError::NotFound(format!("agent_path {id}")))?;
        let new_name = patch.name.unwrap_or(existing.name);
        let new_path = patch.path.unwrap_or(existing.path);
        sqlx::query("UPDATE agent_paths SET name = ?, path = ?, updated_at = ? WHERE id = ?")
            .bind(&new_name)
            .bind(&new_path)
            .bind(now)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(AgentPath {
            id: id.to_string(),
            name: new_name,
            path: new_path,
            created_at: existing.created_at,
            updated_at: now,
        })
    }

    async fn delete(&self, id: &str) -> AppResult<bool> {
        let res = sqlx::query("DELETE FROM agent_paths WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }
}

fn row_to_agent_path(row: sqlx::sqlite::SqliteRow) -> AppResult<AgentPath> {
    Ok(AgentPath {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        path: row.try_get("path")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}
