use async_trait::async_trait;
use chrono::Utc;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use crate::{
    error::AppResult,
    persistence::types::project::{NewProject, Project, ProjectPatch},
};

#[async_trait]
pub trait ProjectRepository: Send + Sync {
    async fn list(&self) -> AppResult<Vec<Project>>;
    async fn get(&self, id: &str) -> AppResult<Option<Project>>;
    async fn find_by_name(&self, name: &str) -> AppResult<Option<Project>>;
    async fn create(&self, input: NewProject) -> AppResult<Project>;
    async fn update(&self, id: &str, patch: ProjectPatch) -> AppResult<Project>;
    async fn delete(&self, id: &str) -> AppResult<bool>;
}

pub struct SqliteProjectRepository {
    pool: SqlitePool,
}

impl SqliteProjectRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ProjectRepository for SqliteProjectRepository {
    async fn list(&self) -> AppResult<Vec<Project>> {
        let rows = sqlx::query("SELECT id, name, optimization, created_at, updated_at FROM projects ORDER BY name COLLATE NOCASE")
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(row_to_project).collect()
    }

    async fn get(&self, id: &str) -> AppResult<Option<Project>> {
        let row = sqlx::query("SELECT id, name, optimization, created_at, updated_at FROM projects WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        row.map(row_to_project).transpose()
    }

    async fn find_by_name(&self, name: &str) -> AppResult<Option<Project>> {
        let row = sqlx::query("SELECT id, name, optimization, created_at, updated_at FROM projects WHERE name = ? COLLATE NOCASE")
            .bind(name)
            .fetch_optional(&self.pool)
            .await?;
        row.map(row_to_project).transpose()
    }

    async fn create(&self, input: NewProject) -> AppResult<Project> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now();
        sqlx::query(
            "INSERT INTO projects(id, name, optimization, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&input.name)
        .bind(&input.optimization)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(Project {
            id,
            name: input.name,
            optimization: input.optimization,
            created_at: now,
            updated_at: now,
        })
    }

    async fn update(&self, id: &str, patch: ProjectPatch) -> AppResult<Project> {
        let now = Utc::now();
        // SQLite doesn't have nice "update only set" syntax in a single query; we read, mutate, write.
        let existing = self
            .get(id)
            .await?
            .ok_or_else(|| crate::error::AppError::NotFound(format!("project {id}")))?;

        let new_name = patch.name.unwrap_or(existing.name);
        let new_optimization = patch.optimization.or(existing.optimization);

        sqlx::query(
            "UPDATE projects SET name = ?, optimization = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&new_name)
        .bind(&new_optimization)
        .bind(now)
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(Project {
            id: id.to_string(),
            name: new_name,
            optimization: new_optimization,
            created_at: existing.created_at,
            updated_at: now,
        })
    }

    async fn delete(&self, id: &str) -> AppResult<bool> {
        let res = sqlx::query("DELETE FROM projects WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }
}

fn row_to_project(row: sqlx::sqlite::SqliteRow) -> AppResult<Project> {
    Ok(Project {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        optimization: row.try_get("optimization")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}
