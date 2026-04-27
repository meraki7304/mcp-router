use std::collections::HashMap;

use tauri::State;

use crate::{
    error::AppResult,
    shared_config::types::Token,
    state::AppState,
};

#[tauri::command]
pub async fn tokens_list(state: State<'_, AppState>) -> AppResult<Vec<Token>> {
    Ok(state.shared_config.list_tokens().await)
}

#[tauri::command]
pub async fn tokens_get(state: State<'_, AppState>, id: String) -> AppResult<Option<Token>> {
    Ok(state.shared_config.get_token(&id).await)
}

#[tauri::command]
pub async fn tokens_save(state: State<'_, AppState>, token: Token) -> AppResult<()> {
    state.shared_config.save_token(token).await
}

#[tauri::command]
pub async fn tokens_delete(state: State<'_, AppState>, id: String) -> AppResult<bool> {
    state.shared_config.delete_token(&id).await
}

#[tauri::command]
pub async fn tokens_delete_client(
    state: State<'_, AppState>,
    client_id: String,
) -> AppResult<u32> {
    state.shared_config.delete_client_tokens(&client_id).await
}

#[tauri::command]
pub async fn tokens_update_server_access(
    state: State<'_, AppState>,
    id: String,
    server_access: HashMap<String, bool>,
) -> AppResult<bool> {
    state
        .shared_config
        .update_token_server_access(&id, server_access)
        .await
}
