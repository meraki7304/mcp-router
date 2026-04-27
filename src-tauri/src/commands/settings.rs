use tauri::State;

use crate::{
    error::AppResult,
    shared_config::types::AppSettings,
    state::AppState,
};

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> AppResult<AppSettings> {
    Ok(state.shared_config.get_settings().await)
}

#[tauri::command]
pub async fn settings_update(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> AppResult<()> {
    state.shared_config.update_settings(settings).await
}
