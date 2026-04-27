use async_trait::async_trait;
use chrono::Utc;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use crate::{
    error::AppResult,
    persistence::types::hook_module::{HookModule, HookModulePatch, NewHookModule},
};

#[async_trait]
pub trait HookModuleRepository: Send + Sync {
    async fn list(&self) -> AppResult<Vec<HookModule>>;
    async fn get(&self, id: &str) -> AppResult<Option<HookModule>>;
    async fn find_by_name(&self, name: &str) -> AppResult<Option<HookModule>>;
    async fn create(&self, input: NewHookModule) -> AppResult<HookModule>;
    async fn update(&self, id: &str, patch: HookModulePatch) -> AppResult<HookModule>;
    async fn delete(&self, id: &str) -> AppResult<bool>;
}

pub struct SqliteHookModuleRepository {
    pool: SqlitePool,
}

impl SqliteHookModuleRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl HookModuleRepository for SqliteHookModuleRepository {
    async fn list(&self) -> AppResult<Vec<HookModule>> {
        let rows = sqlx::query("SELECT id, name, script, created_at, updated_at FROM hook_modules ORDER BY name COLLATE NOCASE")
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(row_to_hook).collect()
    }

    async fn get(&self, id: &str) -> AppResult<Option<HookModule>> {
        let row = sqlx::query("SELECT id, name, script, created_at, updated_at FROM hook_modules WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        row.map(row_to_hook).transpose()
    }

    async fn find_by_name(&self, name: &str) -> AppResult<Option<HookModule>> {
        let row = sqlx::query("SELECT id, name, script, created_at, updated_at FROM hook_modules WHERE name = ?")
            .bind(name)
            .fetch_optional(&self.pool)
            .await?;
        row.map(row_to_hook).transpose()
    }

    async fn create(&self, input: NewHookModule) -> AppResult<HookModule> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now();
        sqlx::query("INSERT INTO hook_modules(id, name, script, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
            .bind(&id)
            .bind(&input.name)
            .bind(&input.script)
            .bind(now)
            .bind(now)
            .execute(&self.pool)
            .await?;
        Ok(HookModule {
            id,
            name: input.name,
            script: input.script,
            created_at: now,
            updated_at: now,
        })
    }

    async fn update(&self, id: &str, patch: HookModulePatch) -> AppResult<HookModule> {
        let now = Utc::now();
        let existing = self
            .get(id)
            .await?
            .ok_or_else(|| crate::error::AppError::NotFound(format!("hook_module {id}")))?;
        let new_name = patch.name.unwrap_or(existing.name);
        let new_script = patch.script.unwrap_or(existing.script);
        sqlx::query("UPDATE hook_modules SET name = ?, script = ?, updated_at = ? WHERE id = ?")
            .bind(&new_name)
            .bind(&new_script)
            .bind(now)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(HookModule {
            id: id.to_string(),
            name: new_name,
            script: new_script,
            created_at: existing.created_at,
            updated_at: now,
        })
    }

    async fn delete(&self, id: &str) -> AppResult<bool> {
        let res = sqlx::query("DELETE FROM hook_modules WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }
}

fn row_to_hook(row: sqlx::sqlite::SqliteRow) -> AppResult<HookModule> {
    Ok(HookModule {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        script: row.try_get("script")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}
