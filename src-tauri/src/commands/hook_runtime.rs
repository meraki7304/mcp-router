use serde_json::Value;
use tauri::State;

use crate::{
    error::{AppError, AppResult},
    persistence::repository::hook_module::{HookModuleRepository, SqliteHookModuleRepository},
    state::AppState,
};

#[tauri::command]
pub async fn hooks_run(
    state: State<'_, AppState>,
    id: String,
    input: Value,
) -> AppResult<Value> {
    let repo = SqliteHookModuleRepository::new(state.pool().await?);
    let hook = repo
        .get(&id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("hook_module {id}")))?;
    state.hook_runtime.evaluate(hook.script, input).await
}
