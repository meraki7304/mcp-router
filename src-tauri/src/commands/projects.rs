use tauri::State;

use crate::{
    error::AppResult,
    persistence::{
        repository::project::{ProjectRepository, SqliteProjectRepository},
        types::project::{NewProject, Project, ProjectPatch},
    },
    state::AppState,
};

async fn repo(state: &State<'_, AppState>) -> AppResult<SqliteProjectRepository> {
    Ok(SqliteProjectRepository::new(state.pool().await?))
}

#[tauri::command]
pub async fn projects_list(state: State<'_, AppState>) -> AppResult<Vec<Project>> {
    repo(&state).await?.list().await
}

#[tauri::command]
pub async fn projects_get(state: State<'_, AppState>, id: String) -> AppResult<Option<Project>> {
    repo(&state).await?.get(&id).await
}

#[tauri::command]
pub async fn projects_find_by_name(
    state: State<'_, AppState>,
    name: String,
) -> AppResult<Option<Project>> {
    repo(&state).await?.find_by_name(&name).await
}

#[tauri::command]
pub async fn projects_create(
    state: State<'_, AppState>,
    input: NewProject,
) -> AppResult<Project> {
    repo(&state).await?.create(input).await
}

#[tauri::command]
pub async fn projects_update(
    state: State<'_, AppState>,
    id: String,
    patch: ProjectPatch,
) -> AppResult<Project> {
    repo(&state).await?.update(&id, patch).await
}

#[tauri::command]
pub async fn projects_delete(state: State<'_, AppState>, id: String) -> AppResult<bool> {
    repo(&state).await?.delete(&id).await
}
