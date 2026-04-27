use std::collections::HashMap;

use async_trait::async_trait;
use chrono::Utc;
use serde_json::Value;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    persistence::types::server::{NewServer, Server, ServerPatch, ServerType},
};

#[async_trait]
pub trait ServerRepository: Send + Sync {
    async fn list(&self) -> AppResult<Vec<Server>>;
    async fn list_by_project(&self, project_id: &str) -> AppResult<Vec<Server>>;
    async fn get(&self, id: &str) -> AppResult<Option<Server>>;
    async fn find_by_name(&self, name: &str) -> AppResult<Option<Server>>;
    async fn create(&self, input: NewServer) -> AppResult<Server>;
    async fn update(&self, id: &str, patch: ServerPatch) -> AppResult<Server>;
    async fn delete(&self, id: &str) -> AppResult<bool>;
}

pub struct SqliteServerRepository {
    pool: SqlitePool,
}

impl SqliteServerRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

const SELECT_COLS: &str = "id, name, server_type, description, version, latest_version, verification_status, command, args_json, env_json, context_path, remote_url, bearer_token, auto_start, disabled, auto_approve, input_params_json, required_params_json, tool_permissions_json, project_id, created_at, updated_at";

#[async_trait]
impl ServerRepository for SqliteServerRepository {
    async fn list(&self) -> AppResult<Vec<Server>> {
        let q = format!("SELECT {SELECT_COLS} FROM servers ORDER BY name COLLATE NOCASE");
        let rows = sqlx::query(&q).fetch_all(&self.pool).await?;
        rows.into_iter().map(row_to_server).collect()
    }

    async fn list_by_project(&self, project_id: &str) -> AppResult<Vec<Server>> {
        let q = format!("SELECT {SELECT_COLS} FROM servers WHERE project_id = ? ORDER BY name COLLATE NOCASE");
        let rows = sqlx::query(&q)
            .bind(project_id)
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(row_to_server).collect()
    }

    async fn get(&self, id: &str) -> AppResult<Option<Server>> {
        let q = format!("SELECT {SELECT_COLS} FROM servers WHERE id = ?");
        let row = sqlx::query(&q).bind(id).fetch_optional(&self.pool).await?;
        row.map(row_to_server).transpose()
    }

    async fn find_by_name(&self, name: &str) -> AppResult<Option<Server>> {
        let q = format!("SELECT {SELECT_COLS} FROM servers WHERE name = ?");
        let row = sqlx::query(&q).bind(name).fetch_optional(&self.pool).await?;
        row.map(row_to_server).transpose()
    }

    async fn create(&self, input: NewServer) -> AppResult<Server> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now();
        let args_json = serde_json::to_string(&input.args)
            .map_err(|e| AppError::Internal(format!("encode args: {e}")))?;
        let env_json = serde_json::to_string(&input.env)
            .map_err(|e| AppError::Internal(format!("encode env: {e}")))?;
        let input_params_json = serde_json::to_string(&input.input_params)
            .map_err(|e| AppError::Internal(format!("encode input_params: {e}")))?;
        let required_params_json = serde_json::to_string(&input.required_params)
            .map_err(|e| AppError::Internal(format!("encode required_params: {e}")))?;
        let tool_permissions_json = serde_json::to_string(&input.tool_permissions)
            .map_err(|e| AppError::Internal(format!("encode tool_permissions: {e}")))?;

        sqlx::query(
            "INSERT INTO servers(id, name, server_type, description, command, args_json, env_json, context_path, remote_url, bearer_token, auto_start, disabled, auto_approve, input_params_json, required_params_json, tool_permissions_json, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&input.name)
        .bind(server_type_to_str(input.server_type))
        .bind(&input.description)
        .bind(&input.command)
        .bind(&args_json)
        .bind(&env_json)
        .bind(&input.context_path)
        .bind(&input.remote_url)
        .bind(&input.bearer_token)
        .bind(input.auto_start as i64)
        .bind(input.disabled as i64)
        .bind(&input.auto_approve)
        .bind(&input_params_json)
        .bind(&required_params_json)
        .bind(&tool_permissions_json)
        .bind(&input.project_id)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;

        Ok(Server {
            id,
            name: input.name,
            server_type: input.server_type,
            description: input.description,
            version: None,
            latest_version: None,
            verification_status: None,
            command: input.command,
            args: input.args,
            env: input.env,
            context_path: input.context_path,
            remote_url: input.remote_url,
            bearer_token: input.bearer_token,
            auto_start: input.auto_start,
            disabled: input.disabled,
            auto_approve: input.auto_approve,
            input_params: input.input_params,
            required_params: input.required_params,
            tool_permissions: input.tool_permissions,
            project_id: input.project_id,
            created_at: now,
            updated_at: now,
        })
    }

    async fn update(&self, id: &str, patch: ServerPatch) -> AppResult<Server> {
        let now = Utc::now();
        let existing = self
            .get(id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("server {id}")))?;

        let new_name = patch.name.unwrap_or(existing.name);
        let new_description = patch.description.or(existing.description);
        let new_version = patch.version.or(existing.version);
        let new_latest_version = patch.latest_version.or(existing.latest_version);
        let new_verification_status = patch.verification_status.or(existing.verification_status);
        let new_command = patch.command.or(existing.command);
        let new_args = patch.args.unwrap_or(existing.args);
        let new_env = patch.env.unwrap_or(existing.env);
        let new_context_path = patch.context_path.or(existing.context_path);
        let new_remote_url = patch.remote_url.or(existing.remote_url);
        let new_bearer_token = patch.bearer_token.or(existing.bearer_token);
        let new_auto_start = patch.auto_start.unwrap_or(existing.auto_start);
        let new_disabled = patch.disabled.unwrap_or(existing.disabled);
        let new_auto_approve = patch.auto_approve.or(existing.auto_approve);
        let new_input_params = patch.input_params.unwrap_or(existing.input_params);
        let new_required_params = patch.required_params.unwrap_or(existing.required_params);
        let new_tool_permissions = patch.tool_permissions.unwrap_or(existing.tool_permissions);
        let new_project_id = patch.project_id.or(existing.project_id);

        let args_json = serde_json::to_string(&new_args)
            .map_err(|e| AppError::Internal(format!("encode args: {e}")))?;
        let env_json = serde_json::to_string(&new_env)
            .map_err(|e| AppError::Internal(format!("encode env: {e}")))?;
        let input_params_json = serde_json::to_string(&new_input_params)
            .map_err(|e| AppError::Internal(format!("encode input_params: {e}")))?;
        let required_params_json = serde_json::to_string(&new_required_params)
            .map_err(|e| AppError::Internal(format!("encode required_params: {e}")))?;
        let tool_permissions_json = serde_json::to_string(&new_tool_permissions)
            .map_err(|e| AppError::Internal(format!("encode tool_permissions: {e}")))?;

        sqlx::query(
            "UPDATE servers SET name = ?, description = ?, version = ?, latest_version = ?, verification_status = ?, command = ?, args_json = ?, env_json = ?, context_path = ?, remote_url = ?, bearer_token = ?, auto_start = ?, disabled = ?, auto_approve = ?, input_params_json = ?, required_params_json = ?, tool_permissions_json = ?, project_id = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&new_name)
        .bind(&new_description)
        .bind(&new_version)
        .bind(&new_latest_version)
        .bind(&new_verification_status)
        .bind(&new_command)
        .bind(&args_json)
        .bind(&env_json)
        .bind(&new_context_path)
        .bind(&new_remote_url)
        .bind(&new_bearer_token)
        .bind(new_auto_start as i64)
        .bind(new_disabled as i64)
        .bind(&new_auto_approve)
        .bind(&input_params_json)
        .bind(&required_params_json)
        .bind(&tool_permissions_json)
        .bind(&new_project_id)
        .bind(now)
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(Server {
            id: id.to_string(),
            name: new_name,
            server_type: existing.server_type,
            description: new_description,
            version: new_version,
            latest_version: new_latest_version,
            verification_status: new_verification_status,
            command: new_command,
            args: new_args,
            env: new_env,
            context_path: new_context_path,
            remote_url: new_remote_url,
            bearer_token: new_bearer_token,
            auto_start: new_auto_start,
            disabled: new_disabled,
            auto_approve: new_auto_approve,
            input_params: new_input_params,
            required_params: new_required_params,
            tool_permissions: new_tool_permissions,
            project_id: new_project_id,
            created_at: existing.created_at,
            updated_at: now,
        })
    }

    async fn delete(&self, id: &str) -> AppResult<bool> {
        let res = sqlx::query("DELETE FROM servers WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }
}

fn server_type_to_str(ty: ServerType) -> &'static str {
    match ty {
        ServerType::Local => "local",
        ServerType::Remote => "remote",
    }
}

fn server_type_from_str(s: &str) -> AppResult<ServerType> {
    match s {
        "local" => Ok(ServerType::Local),
        "remote" => Ok(ServerType::Remote),
        other => Err(AppError::Internal(format!("unknown server_type: {other}"))),
    }
}

fn row_to_server(row: sqlx::sqlite::SqliteRow) -> AppResult<Server> {
    let server_type_str: String = row.try_get("server_type")?;
    let auto_start_i: i64 = row.try_get("auto_start")?;
    let disabled_i: i64 = row.try_get("disabled")?;

    let args_json: String = row.try_get("args_json")?;
    let env_json: String = row.try_get("env_json")?;
    let input_params_json: String = row.try_get("input_params_json")?;
    let required_params_json: String = row.try_get("required_params_json")?;
    let tool_permissions_json: String = row.try_get("tool_permissions_json")?;

    let args: Vec<String> = serde_json::from_str(&args_json)
        .map_err(|e| AppError::Internal(format!("decode args: {e}")))?;
    let env: HashMap<String, String> = serde_json::from_str(&env_json)
        .map_err(|e| AppError::Internal(format!("decode env: {e}")))?;
    let input_params: Value = serde_json::from_str(&input_params_json)
        .map_err(|e| AppError::Internal(format!("decode input_params: {e}")))?;
    let required_params: Vec<String> = serde_json::from_str(&required_params_json)
        .map_err(|e| AppError::Internal(format!("decode required_params: {e}")))?;
    let tool_permissions: HashMap<String, bool> = serde_json::from_str(&tool_permissions_json)
        .map_err(|e| AppError::Internal(format!("decode tool_permissions: {e}")))?;

    Ok(Server {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        server_type: server_type_from_str(&server_type_str)?,
        description: row.try_get("description")?,
        version: row.try_get("version")?,
        latest_version: row.try_get("latest_version")?,
        verification_status: row.try_get("verification_status")?,
        command: row.try_get("command")?,
        args,
        env,
        context_path: row.try_get("context_path")?,
        remote_url: row.try_get("remote_url")?,
        bearer_token: row.try_get("bearer_token")?,
        auto_start: auto_start_i != 0,
        disabled: disabled_i != 0,
        auto_approve: row.try_get("auto_approve")?,
        input_params,
        required_params,
        tool_permissions,
        project_id: row.try_get("project_id")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}
