use tauri::State;

use crate::{
    error::AppResult,
    persistence::{
        repository::request_log::{RequestLogRepository, SqliteRequestLogRepository},
        types::request_log::{RequestLogPage, RequestLogQuery},
    },
    state::AppState,
};

async fn repo(state: &State<'_, AppState>) -> AppResult<SqliteRequestLogRepository> {
    Ok(SqliteRequestLogRepository::new(state.pool().await?))
}

#[tauri::command]
pub async fn logs_query(
    state: State<'_, AppState>,
    query: RequestLogQuery,
) -> AppResult<RequestLogPage> {
    repo(&state).await?.query(query).await
}

#[tauri::command]
pub async fn logs_trim(state: State<'_, AppState>, max_rows: u64) -> AppResult<u64> {
    repo(&state).await?.trim_to_max(max_rows).await
}
