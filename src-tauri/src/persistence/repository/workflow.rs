use async_trait::async_trait;
use chrono::Utc;
use serde_json::Value;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    persistence::types::workflow::{NewWorkflow, Workflow, WorkflowPatch},
};

#[async_trait]
pub trait WorkflowRepository: Send + Sync {
    async fn list(&self) -> AppResult<Vec<Workflow>>;
    async fn list_enabled(&self) -> AppResult<Vec<Workflow>>;
    async fn list_by_type(&self, workflow_type: &str) -> AppResult<Vec<Workflow>>;
    async fn get(&self, id: &str) -> AppResult<Option<Workflow>>;
    async fn create(&self, input: NewWorkflow) -> AppResult<Workflow>;
    async fn update(&self, id: &str, patch: WorkflowPatch) -> AppResult<Workflow>;
    async fn delete(&self, id: &str) -> AppResult<bool>;
}

pub struct SqliteWorkflowRepository {
    pool: SqlitePool,
}

impl SqliteWorkflowRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

const SELECT_COLS: &str = "id, name, description, workflow_type, nodes_json, edges_json, enabled, created_at, updated_at";

#[async_trait]
impl WorkflowRepository for SqliteWorkflowRepository {
    async fn list(&self) -> AppResult<Vec<Workflow>> {
        let q = format!("SELECT {SELECT_COLS} FROM workflows ORDER BY updated_at DESC");
        let rows = sqlx::query(&q).fetch_all(&self.pool).await?;
        rows.into_iter().map(row_to_workflow).collect()
    }

    async fn list_enabled(&self) -> AppResult<Vec<Workflow>> {
        let q = format!("SELECT {SELECT_COLS} FROM workflows WHERE enabled = 1 ORDER BY updated_at DESC");
        let rows = sqlx::query(&q).fetch_all(&self.pool).await?;
        rows.into_iter().map(row_to_workflow).collect()
    }

    async fn list_by_type(&self, workflow_type: &str) -> AppResult<Vec<Workflow>> {
        let q = format!("SELECT {SELECT_COLS} FROM workflows WHERE workflow_type = ? ORDER BY updated_at DESC");
        let rows = sqlx::query(&q)
            .bind(workflow_type)
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(row_to_workflow).collect()
    }

    async fn get(&self, id: &str) -> AppResult<Option<Workflow>> {
        let q = format!("SELECT {SELECT_COLS} FROM workflows WHERE id = ?");
        let row = sqlx::query(&q).bind(id).fetch_optional(&self.pool).await?;
        row.map(row_to_workflow).transpose()
    }

    async fn create(&self, input: NewWorkflow) -> AppResult<Workflow> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now();
        let nodes_json = serde_json::to_string(&input.nodes)
            .map_err(|e| AppError::Internal(format!("encode nodes: {e}")))?;
        let edges_json = serde_json::to_string(&input.edges)
            .map_err(|e| AppError::Internal(format!("encode edges: {e}")))?;
        let enabled_i = if input.enabled { 1 } else { 0 };

        sqlx::query("INSERT INTO workflows(id, name, description, workflow_type, nodes_json, edges_json, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(&id)
            .bind(&input.name)
            .bind(&input.description)
            .bind(&input.workflow_type)
            .bind(&nodes_json)
            .bind(&edges_json)
            .bind(enabled_i)
            .bind(now)
            .bind(now)
            .execute(&self.pool)
            .await?;

        Ok(Workflow {
            id,
            name: input.name,
            description: input.description,
            workflow_type: input.workflow_type,
            nodes: input.nodes,
            edges: input.edges,
            enabled: input.enabled,
            created_at: now,
            updated_at: now,
        })
    }

    async fn update(&self, id: &str, patch: WorkflowPatch) -> AppResult<Workflow> {
        let now = Utc::now();
        let existing = self
            .get(id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("workflow {id}")))?;

        let new_name = patch.name.unwrap_or(existing.name);
        let new_description = patch.description.or(existing.description);
        let new_type = patch.workflow_type.or(existing.workflow_type);
        let new_nodes = patch.nodes.unwrap_or(existing.nodes);
        let new_edges = patch.edges.unwrap_or(existing.edges);
        let new_enabled = patch.enabled.unwrap_or(existing.enabled);

        let nodes_json = serde_json::to_string(&new_nodes)
            .map_err(|e| AppError::Internal(format!("encode nodes: {e}")))?;
        let edges_json = serde_json::to_string(&new_edges)
            .map_err(|e| AppError::Internal(format!("encode edges: {e}")))?;
        let enabled_i = if new_enabled { 1 } else { 0 };

        sqlx::query("UPDATE workflows SET name = ?, description = ?, workflow_type = ?, nodes_json = ?, edges_json = ?, enabled = ?, updated_at = ? WHERE id = ?")
            .bind(&new_name)
            .bind(&new_description)
            .bind(&new_type)
            .bind(&nodes_json)
            .bind(&edges_json)
            .bind(enabled_i)
            .bind(now)
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(Workflow {
            id: id.to_string(),
            name: new_name,
            description: new_description,
            workflow_type: new_type,
            nodes: new_nodes,
            edges: new_edges,
            enabled: new_enabled,
            created_at: existing.created_at,
            updated_at: now,
        })
    }

    async fn delete(&self, id: &str) -> AppResult<bool> {
        let res = sqlx::query("DELETE FROM workflows WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }
}

fn row_to_workflow(row: sqlx::sqlite::SqliteRow) -> AppResult<Workflow> {
    let nodes_json: String = row.try_get("nodes_json")?;
    let edges_json: String = row.try_get("edges_json")?;
    let enabled_i: i64 = row.try_get("enabled")?;
    let nodes: Value = serde_json::from_str(&nodes_json)
        .map_err(|e| AppError::Internal(format!("decode nodes: {e}")))?;
    let edges: Value = serde_json::from_str(&edges_json)
        .map_err(|e| AppError::Internal(format!("decode edges: {e}")))?;

    Ok(Workflow {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        description: row.try_get("description")?,
        workflow_type: row.try_get("workflow_type")?,
        nodes,
        edges,
        enabled: enabled_i != 0,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}
