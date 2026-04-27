use async_trait::async_trait;
use chrono::Utc;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    persistence::types::workspace::{
        LocalWorkspaceConfig, NewWorkspace, RemoteWorkspaceConfig, Workspace, WorkspaceDisplayInfo,
        WorkspacePatch, WorkspaceType,
    },
};

#[async_trait]
pub trait WorkspaceRepository: Send + Sync {
    async fn list(&self) -> AppResult<Vec<Workspace>>;
    async fn get(&self, id: &str) -> AppResult<Option<Workspace>>;
    async fn get_active(&self) -> AppResult<Option<Workspace>>;
    async fn create(&self, input: NewWorkspace) -> AppResult<Workspace>;
    async fn update(&self, id: &str, patch: WorkspacePatch) -> AppResult<Workspace>;
    async fn set_active(&self, id: &str) -> AppResult<Workspace>;
    async fn delete(&self, id: &str) -> AppResult<bool>;
}

pub struct SqliteWorkspaceRepository {
    pool: SqlitePool,
}

impl SqliteWorkspaceRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

const SELECT_COLS: &str = "id, name, workspace_type, is_active, local_config_json, remote_config_json, display_info_json, created_at, last_used_at";

#[async_trait]
impl WorkspaceRepository for SqliteWorkspaceRepository {
    async fn list(&self) -> AppResult<Vec<Workspace>> {
        let q = format!("SELECT {SELECT_COLS} FROM workspaces ORDER BY last_used_at DESC");
        let rows = sqlx::query(&q).fetch_all(&self.pool).await?;
        rows.into_iter().map(row_to_workspace).collect()
    }

    async fn get(&self, id: &str) -> AppResult<Option<Workspace>> {
        let q = format!("SELECT {SELECT_COLS} FROM workspaces WHERE id = ?");
        let row = sqlx::query(&q).bind(id).fetch_optional(&self.pool).await?;
        row.map(row_to_workspace).transpose()
    }

    async fn get_active(&self) -> AppResult<Option<Workspace>> {
        let q = format!("SELECT {SELECT_COLS} FROM workspaces WHERE is_active = 1 LIMIT 1");
        let row = sqlx::query(&q).fetch_optional(&self.pool).await?;
        row.map(row_to_workspace).transpose()
    }

    async fn create(&self, input: NewWorkspace) -> AppResult<Workspace> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now();
        let local_json = input
            .local_config
            .as_ref()
            .map(|c| serde_json::to_string(c))
            .transpose()
            .map_err(|e| AppError::Internal(format!("encode local_config: {e}")))?;
        let remote_json = input
            .remote_config
            .as_ref()
            .map(|c| serde_json::to_string(c))
            .transpose()
            .map_err(|e| AppError::Internal(format!("encode remote_config: {e}")))?;
        let display_json = input
            .display_info
            .as_ref()
            .map(|c| serde_json::to_string(c))
            .transpose()
            .map_err(|e| AppError::Internal(format!("encode display_info: {e}")))?;

        sqlx::query("INSERT INTO workspaces(id, name, workspace_type, is_active, local_config_json, remote_config_json, display_info_json, created_at, last_used_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)")
            .bind(&id)
            .bind(&input.name)
            .bind(workspace_type_to_str(input.workspace_type))
            .bind(&local_json)
            .bind(&remote_json)
            .bind(&display_json)
            .bind(now)
            .bind(now)
            .execute(&self.pool)
            .await?;

        Ok(Workspace {
            id,
            name: input.name,
            workspace_type: input.workspace_type,
            is_active: false,
            local_config: input.local_config,
            remote_config: input.remote_config,
            display_info: input.display_info,
            created_at: now,
            last_used_at: now,
        })
    }

    async fn update(&self, id: &str, patch: WorkspacePatch) -> AppResult<Workspace> {
        let existing = self
            .get(id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("workspace {id}")))?;

        let new_name = patch.name.unwrap_or(existing.name);
        let new_local = patch.local_config.or(existing.local_config);
        let new_remote = patch.remote_config.or(existing.remote_config);
        let new_display = patch.display_info.or(existing.display_info);

        let local_json = new_local
            .as_ref()
            .map(|c| serde_json::to_string(c))
            .transpose()
            .map_err(|e| AppError::Internal(format!("encode local_config: {e}")))?;
        let remote_json = new_remote
            .as_ref()
            .map(|c| serde_json::to_string(c))
            .transpose()
            .map_err(|e| AppError::Internal(format!("encode remote_config: {e}")))?;
        let display_json = new_display
            .as_ref()
            .map(|c| serde_json::to_string(c))
            .transpose()
            .map_err(|e| AppError::Internal(format!("encode display_info: {e}")))?;

        sqlx::query("UPDATE workspaces SET name = ?, local_config_json = ?, remote_config_json = ?, display_info_json = ? WHERE id = ?")
            .bind(&new_name)
            .bind(&local_json)
            .bind(&remote_json)
            .bind(&display_json)
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(Workspace {
            id: id.to_string(),
            name: new_name,
            workspace_type: existing.workspace_type,
            is_active: existing.is_active,
            local_config: new_local,
            remote_config: new_remote,
            display_info: new_display,
            created_at: existing.created_at,
            last_used_at: existing.last_used_at,
        })
    }

    async fn set_active(&self, id: &str) -> AppResult<Workspace> {
        let now = Utc::now();
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE workspaces SET is_active = 0 WHERE is_active = 1")
            .execute(&mut *tx)
            .await?;
        let res = sqlx::query("UPDATE workspaces SET is_active = 1, last_used_at = ? WHERE id = ?")
            .bind(now)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        if res.rows_affected() == 0 {
            return Err(AppError::NotFound(format!("workspace {id}")));
        }
        tx.commit().await?;

        self.get(id)
            .await?
            .ok_or_else(|| AppError::Internal("workspace vanished after set_active".into()))
    }

    async fn delete(&self, id: &str) -> AppResult<bool> {
        let res = sqlx::query("DELETE FROM workspaces WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }
}

fn workspace_type_to_str(ty: WorkspaceType) -> &'static str {
    match ty {
        WorkspaceType::Local => "local",
        WorkspaceType::Remote => "remote",
    }
}

fn workspace_type_from_str(s: &str) -> AppResult<WorkspaceType> {
    match s {
        "local" => Ok(WorkspaceType::Local),
        "remote" => Ok(WorkspaceType::Remote),
        other => Err(AppError::Internal(format!("unknown workspace_type: {other}"))),
    }
}

fn row_to_workspace(row: sqlx::sqlite::SqliteRow) -> AppResult<Workspace> {
    let workspace_type_str: String = row.try_get("workspace_type")?;
    let is_active_i: i64 = row.try_get("is_active")?;

    let local_json: Option<String> = row.try_get("local_config_json")?;
    let local_config: Option<LocalWorkspaceConfig> = local_json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|e| AppError::Internal(format!("decode local_config: {e}")))?;

    let remote_json: Option<String> = row.try_get("remote_config_json")?;
    let remote_config: Option<RemoteWorkspaceConfig> = remote_json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|e| AppError::Internal(format!("decode remote_config: {e}")))?;

    let display_json: Option<String> = row.try_get("display_info_json")?;
    let display_info: Option<WorkspaceDisplayInfo> = display_json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|e| AppError::Internal(format!("decode display_info: {e}")))?;

    Ok(Workspace {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        workspace_type: workspace_type_from_str(&workspace_type_str)?,
        is_active: is_active_i != 0,
        local_config,
        remote_config,
        display_info,
        created_at: row.try_get("created_at")?,
        last_used_at: row.try_get("last_used_at")?,
    })
}
