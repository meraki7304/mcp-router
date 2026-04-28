use std::sync::Arc;

use serde_json::Value;
use tauri::State;

use crate::{
    error::AppResult,
    persistence::{
        repository::{
            hook_module::{HookModuleRepository, SqliteHookModuleRepository},
            workflow::{SqliteWorkflowRepository, WorkflowRepository},
        },
        types::workflow::{NewWorkflow, Workflow, WorkflowPatch},
    },
    state::AppState,
    workflow::executor::WorkflowExecutor,
};

async fn repo(state: &State<'_, AppState>) -> AppResult<SqliteWorkflowRepository> {
    Ok(SqliteWorkflowRepository::new(state.pool().await?))
}

#[tauri::command]
pub async fn workflows_list(state: State<'_, AppState>) -> AppResult<Vec<Workflow>> {
    repo(&state).await?.list().await
}

#[tauri::command]
pub async fn workflows_list_enabled(
    state: State<'_, AppState>,
) -> AppResult<Vec<Workflow>> {
    repo(&state).await?.list_enabled().await
}

#[tauri::command]
pub async fn workflows_list_by_type(
    state: State<'_, AppState>,
    workflow_type: String,
) -> AppResult<Vec<Workflow>> {
    repo(&state).await?.list_by_type(&workflow_type).await
}

#[tauri::command]
pub async fn workflows_get(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<Option<Workflow>> {
    repo(&state).await?.get(&id).await
}

#[tauri::command]
pub async fn workflows_create(
    state: State<'_, AppState>,
    input: NewWorkflow,
) -> AppResult<Workflow> {
    repo(&state).await?.create(input).await
}

#[tauri::command]
pub async fn workflows_update(
    state: State<'_, AppState>,
    id: String,
    patch: WorkflowPatch,
) -> AppResult<Workflow> {
    repo(&state).await?.update(&id, patch).await
}

#[tauri::command]
pub async fn workflows_delete(state: State<'_, AppState>, id: String) -> AppResult<bool> {
    repo(&state).await?.delete(&id).await
}

#[tauri::command]
pub async fn workflows_execute(
    state: State<'_, AppState>,
    id: String,
    input: Value,
) -> AppResult<Value> {
    let pool = state.pool().await?;
    let workflow = SqliteWorkflowRepository::new(pool.clone())
        .get(&id)
        .await?
        .ok_or_else(|| crate::error::AppError::NotFound(format!("workflow {id}")))?;

    let hooks: Arc<dyn HookModuleRepository> =
        Arc::new(SqliteHookModuleRepository::new(pool));

    let executor = WorkflowExecutor::new(
        hooks,
        state.hook_runtime.clone(),
        state.server_manager.clone(),
    );
    executor.execute(&workflow, input).await
}
