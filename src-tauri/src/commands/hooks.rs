use tauri::State;

use crate::{
    error::AppResult,
    persistence::{
        repository::hook_module::{HookModuleRepository, SqliteHookModuleRepository},
        types::hook_module::{HookModule, HookModulePatch, NewHookModule},
    },
    state::AppState,
};

async fn repo(state: &State<'_, AppState>) -> AppResult<SqliteHookModuleRepository> {
    Ok(SqliteHookModuleRepository::new(state.pool().await?))
}

#[tauri::command]
pub async fn hooks_list(state: State<'_, AppState>) -> AppResult<Vec<HookModule>> {
    repo(&state).await?.list().await
}

#[tauri::command]
pub async fn hooks_get(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<Option<HookModule>> {
    repo(&state).await?.get(&id).await
}

#[tauri::command]
pub async fn hooks_find_by_name(
    state: State<'_, AppState>,
    name: String,
) -> AppResult<Option<HookModule>> {
    repo(&state).await?.find_by_name(&name).await
}

#[tauri::command]
pub async fn hooks_create(
    state: State<'_, AppState>,
    input: NewHookModule,
) -> AppResult<HookModule> {
    repo(&state).await?.create(input).await
}

#[tauri::command]
pub async fn hooks_update(
    state: State<'_, AppState>,
    id: String,
    patch: HookModulePatch,
) -> AppResult<HookModule> {
    repo(&state).await?.update(&id, patch).await
}

#[tauri::command]
pub async fn hooks_delete(state: State<'_, AppState>, id: String) -> AppResult<bool> {
    repo(&state).await?.delete(&id).await
}
