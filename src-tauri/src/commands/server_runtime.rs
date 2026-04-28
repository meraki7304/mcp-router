use serde_json::Value;
use tauri::State;

use crate::{
    error::AppResult,
    mcp::status::ServerStatus,
    persistence::repository::server::{ServerRepository, SqliteServerRepository},
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

/// Returns the server's tools, filtered by `tool_permissions`：
/// `tool_permissions[name] == false` 的工具会被排除（用户在 UI 关掉的）。
/// 默认（不在 map 里 / 值为 true）= 启用。
#[tauri::command]
pub async fn servers_list_tools(state: State<'_, AppState>, id: String) -> AppResult<Vec<Value>> {
    let raw = state.server_manager.list_tools(&id).await?;

    // 读 server.tool_permissions 来过滤
    let pool = state.pool().await?;
    let repo = SqliteServerRepository::new(pool);
    let perms = match repo.get(&id).await? {
        Some(server) => server.tool_permissions,
        None => return Ok(raw), // 服务器配置已被删但还在跑（罕见），不过滤
    };

    Ok(raw
        .into_iter()
        .filter(|tool_value| {
            // tool_value["name"] 是工具名；perms[name] == Some(false) 即禁用
            match tool_value.get("name").and_then(|v| v.as_str()) {
                Some(name) => !matches!(perms.get(name), Some(false)),
                None => true, // 没名字的工具留着（防御性）
            }
        })
        .collect())
}
