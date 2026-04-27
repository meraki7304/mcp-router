use tauri::State;

use crate::{
    error::AppResult,
    persistence::{
        repository::server::{ServerRepository, SqliteServerRepository},
        types::server::{NewServer, Server, ServerPatch},
    },
    state::AppState,
};

async fn repo(state: &State<'_, AppState>) -> AppResult<SqliteServerRepository> {
    Ok(SqliteServerRepository::new(state.pool().await?))
}

#[tauri::command]
pub async fn servers_list(state: State<'_, AppState>) -> AppResult<Vec<Server>> {
    repo(&state).await?.list().await
}

#[tauri::command]
pub async fn servers_list_by_project(
    state: State<'_, AppState>,
    project_id: String,
) -> AppResult<Vec<Server>> {
    repo(&state).await?.list_by_project(&project_id).await
}

#[tauri::command]
pub async fn servers_get(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<Option<Server>> {
    repo(&state).await?.get(&id).await
}

#[tauri::command]
pub async fn servers_find_by_name(
    state: State<'_, AppState>,
    name: String,
) -> AppResult<Option<Server>> {
    repo(&state).await?.find_by_name(&name).await
}

#[tauri::command]
pub async fn servers_create(
    state: State<'_, AppState>,
    input: NewServer,
) -> AppResult<Server> {
    repo(&state).await?.create(input).await
}

#[tauri::command]
pub async fn servers_update(
    state: State<'_, AppState>,
    id: String,
    patch: ServerPatch,
) -> AppResult<Server> {
    repo(&state).await?.update(&id, patch).await
}

#[tauri::command]
pub async fn servers_delete(state: State<'_, AppState>, id: String) -> AppResult<bool> {
    repo(&state).await?.delete(&id).await
}
