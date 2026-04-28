use serde_json::Value;
use tauri::State;

use crate::{
    error::AppResult,
    mcp::status::ServerStatus,
    state::AppState,
};

#[tauri::command]
pub async fn servers_start(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.server_manager.start(&id).await
}

#[tauri::command]
pub async fn servers_stop(state: State<'_, AppState>, id: String) -> AppResult<bool> {
    state.server_manager.stop(&id).await
}

#[tauri::command]
pub async fn servers_get_status(state: State<'_, AppState>, id: String) -> AppResult<ServerStatus> {
    Ok(state.server_manager.status(&id).await)
}

/// Returns ALL tools the server exposes — UI 用来展示带开关的列表。
/// 不按 tool_permissions 过滤；过滤只发生在对外的 Aggregator (HTTP /mcp) 那侧，
/// 这样禁用的工具仍然在 UI 里可见可切回来。
#[tauri::command]
pub async fn servers_list_tools(state: State<'_, AppState>, id: String) -> AppResult<Vec<Value>> {
    state.server_manager.list_tools(&id).await
}
